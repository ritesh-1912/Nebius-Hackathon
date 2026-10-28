"""FastAPI application entrypoint for Upgrade Pilot.

Serves the REST API, SSE live event stream, and single-page frontend.
Includes:
- Strict demo whitelist (only demo_pydantic & demo_sqlalchemy allowed)
- Per-IP rate limiting
- Global daily token budget (graceful fallback to cached runs)
- Cached demonstration run fallback for judge evaluations
- Server concurrency limits and per-run timeout guards
"""

import asyncio
import json
import logging
import queue
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from upgrade_pilot.budget import budget_limiter
from upgrade_pilot.cached_runs.player import is_cached_available, stream_cached_run
from upgrade_pilot.config import get_settings
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.orchestrator.engine import run_upgrade_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("upgrade_pilot")

settings = get_settings()
cost_tracker = CostTracker(settings)

# Server Concurrency Lock (guards heavy sandboxes & LLM quotas)
run_semaphore = threading.Semaphore(settings.MAX_CONCURRENT_RUNS)

# Whitelisted Demos
ALLOWED_DEMOS = {
    "demo_pydantic": "demo_pydantic",
    "pydantic_v1_to_v2": "demo_pydantic",
    "pydantic": "demo_pydantic",
    "demo_sqlalchemy": "demo_sqlalchemy",
    "sqlalchemy_v1_to_v2": "demo_sqlalchemy",
    "sqlalchemy": "demo_sqlalchemy",
}

app = FastAPI(
    title="Upgrade Pilot",
    description="Autonomous Python dependency migration agent powered by NVIDIA Nemotron on Nebius Token Factory",
    version="0.1.0",
)

# CORS middleware for open hosted access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files directory
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def get_index():
    """Serve the single-page frontend."""
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend static files not found.")
    return FileResponse(index_file)


@app.get("/health")
def health_check():
    """Comprehensive health check confirming API status, models, budget, and limits."""
    return {
        "status": "healthy",
        "app": "Upgrade Pilot",
        "models": {
            "ultra": settings.MODEL_ULTRA,
            "super": settings.MODEL_SUPER,
            "nano": settings.MODEL_NANO,
        },
        "nebius_base_url": settings.NEBIUS_BASE_URL,
        "max_concurrent_runs": settings.MAX_CONCURRENT_RUNS,
        "per_run_timeout_seconds": settings.PER_RUN_TIMEOUT_SECONDS,
        "allowed_demos": ["demo_pydantic", "demo_sqlalchemy"],
        "budget_telemetry": budget_limiter.get_status(),
        "cached_runs_available": {
            "demo_pydantic": is_cached_available("demo_pydantic"),
            "demo_sqlalchemy": is_cached_available("demo_sqlalchemy"),
        },
    }


@app.get("/api/demos")
def get_demos():
    """Return list of prepared demo repositories."""
    return [
        {
            "id": "demo_pydantic",
            "alias": "pydantic_v1_to_v2",
            "name": "Pydantic v1 → v2 Migration",
            "description": "E-Commerce order service. Migrates Field(regex=...) → pattern=..., @validator → @field_validator, class Config → model_config ConfigDict, and .dict() → .model_dump().",
            "library": "pydantic",
            "from_version": "1.10.17",
            "to_version": "2.14.1",
            "tests_count": 10,
            "severity": "High (Breaking)",
        },
        {
            "id": "demo_sqlalchemy",
            "alias": "sqlalchemy_v1_to_v2",
            "name": "SQLAlchemy 1.4 → 2.0 Migration",
            "description": "Project task management service. Migrates engine.execute(...) → connection.execute(text(...)), legacy session.query() → session.scalars(select()), and declarative_base.",
            "library": "sqlalchemy",
            "from_version": "1.4.54",
            "to_version": "2.0.55",
            "tests_count": 8,
            "severity": "High (Breaking)",
        },
    ]


@app.get("/api/pricing")
def get_pricing():
    """Return current configured pricing per 1M tokens."""
    return {
        "ultra": settings.get_tier_pricing("ultra"),
        "super": settings.get_tier_pricing("super"),
        "nano": settings.get_tier_pricing("nano"),
    }


@app.get("/api/upgrade/stream")
async def stream_upgrade(
    request: Request,
    demo: str = Query("demo_pydantic", description="Demo repository identifier"),
    cached: bool = Query(False, description="Force pre-recorded cached demonstration run"),
):
    """Server-Sent Events endpoint streaming real-time upgrade events.
    
    Guarded by:
    1. Demo Whitelist: Rejects anything other than demo_pydantic and demo_sqlalchemy.
    2. Rate Limiter: Max 5 runs per 10 minutes per client IP.
    3. Global Daily Token Budget: Gracefully falls back to cached run when limit is met.
    4. Server Concurrency Semaphore: Prevents resource exhaustion.
    5. Per-run Timeout: Hard cap to terminate runaway loops.
    """
    raw_demo = demo.strip().lower()

    # 1. Reject anything not in the preset whitelist
    if raw_demo not in ALLOWED_DEMOS:
        async def invalid_demo_error():
            err_evt = {
                "event_id": "evt_rejected",
                "run_id": "run_rejected",
                "demo_id": raw_demo,
                "step": "INIT",
                "status": "error",
                "message": (
                    f"Access Denied: Only preset hackathon demos ('demo_pydantic', 'demo_sqlalchemy') "
                    f"are permitted. Uploaded or arbitrary codebases are disabled for security."
                ),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "payload": {},
                "telemetry": {},
            }
            yield f"data: {json.dumps(err_evt)}\n\n"

        return StreamingResponse(invalid_demo_error(), media_type="text/event-stream")

    canonical_demo = ALLOWED_DEMOS[raw_demo]

    # Client IP for rate limiting
    client_ip = request.client.host if request.client else "127.0.0.1"

    async def sse_event_publisher():
        # 2. Check Rate Limiter
        allowed_rate, rate_msg = budget_limiter.check_rate_limit(client_ip)
        if not allowed_rate:
            err_evt = {
                "event_id": "evt_ratelimit",
                "run_id": "run_ratelimit",
                "demo_id": canonical_demo,
                "step": "INIT",
                "status": "error",
                "message": rate_msg,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "payload": {},
                "telemetry": {},
            }
            yield f"data: {json.dumps(err_evt)}\n\n"
            return

        # 3. Check Daily Token Budget & Cached Fallback
        budget_ok, budget_msg = budget_limiter.check_daily_budget()
        use_cached = cached or (not budget_ok) or (not settings.NEBIUS_API_KEY)

        if use_cached:
            logger.info(f"Serving cached run for {canonical_demo}. Reason: cached={cached}, budget_ok={budget_ok}")
            if not budget_ok:
                notice = {
                    "event_id": "evt_notice",
                    "run_id": "run_notice",
                    "demo_id": canonical_demo,
                    "step": "INIT",
                    "status": "running",
                    "message": f"[Notice] {budget_msg}",
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "payload": {},
                    "telemetry": {},
                }
                yield f"data: {json.dumps(notice)}\n\n"

            for event in stream_cached_run(demo_name=canonical_demo, step_delay=0.35):
                yield f"data: {event.model_dump_json()}\n\n"
                await asyncio.sleep(0.01)
            return

        # 4. Enforce Server Concurrency Limit
        acquired = run_semaphore.acquire(blocking=False)
        if not acquired:
            busy_event = {
                "event_id": "evt_busy",
                "run_id": "run_busy",
                "demo_id": canonical_demo,
                "step": "INIT",
                "iteration": 0,
                "max_iterations": 5,
                "status": "error",
                "message": (
                    f"Server is currently running an upgrade for another user "
                    f"(concurrency limit: {settings.MAX_CONCURRENT_RUNS}). "
                    f"Please wait 30 seconds and retry."
                ),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "payload": {},
                "telemetry": {},
            }
            yield f"data: {json.dumps(busy_event)}\n\n"
            return

        q: queue.Queue = queue.Queue()
        stop_signal = object()

        # 5. Worker Thread for Sandbox & LLM Execution
        def worker():
            try:
                for event in run_upgrade_pipeline(demo_name=canonical_demo):
                    q.put(event)
            except Exception as e:
                logger.error(f"Error in pipeline worker: {e}", exc_info=True)
                q.put(e)
            finally:
                q.put(stop_signal)

        worker_thread = threading.Thread(target=worker, daemon=True)
        worker_thread.start()

        start_time = time.time()
        max_duration = settings.PER_RUN_TIMEOUT_SECONDS

        try:
            while True:
                # 6. Enforce Per-Run Timeout
                elapsed = time.time() - start_time
                if elapsed > max_duration:
                    timeout_event = {
                        "event_id": "evt_timeout",
                        "run_id": "run_timeout",
                        "demo_id": canonical_demo,
                        "step": "COMPLETED",
                        "iteration": 0,
                        "max_iterations": 5,
                        "status": "error",
                        "message": f"Upgrade process exceeded maximum allowed duration of {max_duration} seconds.",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "payload": {},
                        "telemetry": {},
                    }
                    yield f"data: {json.dumps(timeout_event)}\n\n"
                    break

                try:
                    item = await asyncio.to_thread(q.get, timeout=1.0)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue

                if item is stop_signal:
                    break
                elif isinstance(item, Exception):
                    # Graceful fallback to cached run if live API quota fails
                    logger.warning(f"Live run failed with exception ({item}); switching to cached demonstration.")
                    err_event = {
                        "event_id": "evt_fallback",
                        "run_id": "run_fallback",
                        "demo_id": canonical_demo,
                        "step": "INIT",
                        "status": "running",
                        "message": f"[Fallback Activated] Live call error: {str(item)[:120]}. Displaying verified cached run for evaluation.",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "payload": {},
                        "telemetry": {},
                    }
                    yield f"data: {json.dumps(err_event)}\n\n"
                    for cached_evt in stream_cached_run(demo_name=canonical_demo, step_delay=0.3):
                        yield f"data: {cached_evt.model_dump_json()}\n\n"
                    break
                else:
                    # Record tokens into daily budget
                    if hasattr(item, "telemetry") and item.telemetry and item.telemetry.call_tokens:
                        budget_limiter.record_tokens(
                            item.telemetry.call_tokens.prompt_tokens + item.telemetry.call_tokens.completion_tokens
                        )
                    yield f"data: {item.model_dump_json()}\n\n"

        finally:
            run_semaphore.release()

    return StreamingResponse(
        sse_event_publisher(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
