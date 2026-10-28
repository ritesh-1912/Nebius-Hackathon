"""FastAPI application entrypoint for Upgrade Pilot.

Serves the REST API, SSE live event stream, and the single-page frontend.
Includes concurrency limits and per-run timeout protection.
"""

import asyncio
import json
import logging
import queue
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

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
    """Health check endpoint confirming API status and configured models."""
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
async def stream_upgrade(demo: str = Query("demo_pydantic", description="Demo repository identifier")):
    """Server-Sent Events endpoint streaming real-time upgrade events.
    
    Protected by a server concurrency limit and a per-run timeout.
    """
    # Normalize demo name
    demo_name = demo.strip()
    if demo_name in ("pydantic_v1_to_v2", "pydantic"):
        demo_name = "demo_pydantic"
    elif demo_name in ("sqlalchemy_v1_to_v2", "sqlalchemy"):
        demo_name = "demo_sqlalchemy"

    async def sse_event_publisher():
        # 1. Enforce Server Concurrency Limit
        acquired = run_semaphore.acquire(blocking=False)
        if not acquired:
            busy_event = {
                "event_id": "evt_busy",
                "run_id": "run_busy",
                "demo_id": demo_name,
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

        # 2. Worker Thread for Sandbox & LLM Execution
        def worker():
            try:
                for event in run_upgrade_pipeline(demo_name=demo_name):
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
                # 3. Enforce Per-Run Timeout
                elapsed = time.time() - start_time
                if elapsed > max_duration:
                    timeout_event = {
                        "event_id": "evt_timeout",
                        "run_id": "run_timeout",
                        "demo_id": demo_name,
                        "step": "COMPLETED",
                        "iteration": 0,
                        "max_iterations": 5,
                        "status": "error",
                        "message": f"Upgrade process exceeded maximum allowed run duration of {max_duration} seconds.",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "payload": {},
                        "telemetry": {},
                    }
                    yield f"data: {json.dumps(timeout_event)}\n\n"
                    break

                try:
                    # Non-blocking async queue fetch
                    item = await asyncio.to_thread(q.get, timeout=1.0)
                except queue.Empty:
                    # Yield SSE keep-alive ping to prevent browser / proxy disconnects
                    yield ": keep-alive\n\n"
                    continue

                if item is stop_signal:
                    break
                elif isinstance(item, Exception):
                    err_event = {
                        "event_id": "evt_error",
                        "run_id": "run_err",
                        "demo_id": demo_name,
                        "step": "COMPLETED",
                        "status": "error",
                        "message": f"Pipeline failure: {str(item)}",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "payload": {},
                        "telemetry": {},
                    }
                    yield f"data: {json.dumps(err_event)}\n\n"
                    break
                else:
                    # Normal typed event
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
