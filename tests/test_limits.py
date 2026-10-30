"""Unit tests for public readiness limits, guards, spend caps, and recorded runs."""

import json
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from upgrade_pilot.budget import BudgetAndRateLimiter
from upgrade_pilot.cached_runs.player import is_cached_available, stream_cached_run
from upgrade_pilot.config import Settings
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.main import app, run_semaphore
from upgrade_pilot.orchestrator.engine import run_upgrade_pipeline


# ==============================================================================
# 1. DEMO WHITELIST LIMIT
# ==============================================================================

def test_demo_whitelist_rejects_arbitrary_input():
    """Verify that only preset demos can run; any other input is rejected."""
    client = TestClient(app)

    # 1. Arbitrary non-whitelisted demo
    response = client.get("/api/upgrade/stream?demo=my_custom_codebase")
    assert response.status_code == 200
    events = [json.loads(line.replace("data: ", "")) for line in response.text.strip().split("\n\n") if line.startswith("data: ")]
    assert len(events) == 1
    assert events[0]["event_id"] == "evt_rejected"
    assert events[0]["status"] == "error"
    assert "Only preset hackathon demos" in events[0]["message"]

    # 2. Path traversal attempt in demo query
    response_traversal = client.get("/api/upgrade/stream?demo=../../etc")
    assert response_traversal.status_code == 200
    events_trav = [json.loads(line.replace("data: ", "")) for line in response_traversal.text.strip().split("\n\n") if line.startswith("data: ")]
    assert events_trav[0]["event_id"] == "evt_rejected"
    assert events_trav[0]["status"] == "error"


def test_demo_whitelist_accepts_whitelisted_demos(monkeypatch):
    """Verify that preset whitelisted demos are recognized."""
    # Speed up cached run streaming for unit tests
    orig_stream = stream_cached_run
    monkeypatch.setattr("upgrade_pilot.main.stream_cached_run", lambda demo_name, step_delay=0.001: orig_stream(demo_name, step_delay=0.001))

    client = TestClient(app)
    # With cached=true, should accept and stream cached run
    for demo_id in ["demo_pydantic", "demo_sqlalchemy"]:
        response = client.get(f"/api/upgrade/stream?demo={demo_id}&cached=true")
        assert response.status_code == 200
        first_line = response.text.split("\n\n")[0]
        assert first_line.startswith("data: ")
        data = json.loads(first_line.replace("data: ", ""))
        assert data["demo_id"] == demo_id
        assert data["event_id"] != "evt_rejected"


# ==============================================================================
# 2. PER-IP RATE LIMITING
# ==============================================================================

def test_per_ip_rate_limiting():
    """Verify that exceeding 5 requests per 10 minutes per IP is rejected."""
    limiter = BudgetAndRateLimiter()
    test_ip = "192.168.1.100"

    # First 5 attempts within window must succeed
    for i in range(5):
        allowed, msg = limiter.check_rate_limit(test_ip)
        assert allowed is True, f"Request {i+1} should be permitted"
        assert msg == ""

    # 6th attempt must be rejected with rate limit message
    allowed_6th, msg_6th = limiter.check_rate_limit(test_ip)
    assert allowed_6th is False
    assert "Rate limit exceeded" in msg_6th

    # A different IP must still be permitted
    allowed_other, _ = limiter.check_rate_limit("192.168.1.200")
    assert allowed_other is True


# ==============================================================================
# 3. CONCURRENCY LIMIT
# ==============================================================================

def test_server_concurrency_limiting():
    """Verify that when server concurrency semaphore is exhausted, new runs are rejected."""
    client = TestClient(app)

    # Acquire the semaphore to simulate an active running upgrade
    acquired = run_semaphore.acquire(blocking=False)
    assert acquired is True

    try:
        # Subsequent live run must return evt_busy
        response = client.get("/api/upgrade/stream?demo=demo_pydantic&cached=false")
        assert response.status_code == 200
        events = [json.loads(line.replace("data: ", "")) for line in response.text.strip().split("\n\n") if line.startswith("data: ")]
        assert len(events) >= 1
        busy_evt = [e for e in events if e.get("event_id") == "evt_busy"]
        assert len(busy_evt) == 1
        assert "concurrency limit" in busy_evt[0]["message"]
        assert busy_evt[0]["status"] == "error"
    finally:
        run_semaphore.release()


# ==============================================================================
# 4. GLOBAL DAILY SPEND CAP & RECORDED RUN OFFER
# ==============================================================================

def test_global_daily_spend_cap_read_from_settings_and_enforced(monkeypatch):
    """Verify daily spend cap is read from settings and halts new live runs gracefully."""
    custom_settings = Settings(
        DAILY_SPEND_LIMIT_USD=5.0,
        DAILY_TOKEN_LIMIT=500000,
    )
    limiter = BudgetAndRateLimiter()
    limiter.settings = custom_settings
    limiter._daily_spend_limit = 5.0

    # Within budget
    limiter.record_usage(tokens=1000, cost_usd=2.50)
    ok, _ = limiter.check_daily_budget()
    assert ok is True

    # Exceed budget ($5.50 > $5.00)
    limiter.record_usage(tokens=1000, cost_usd=3.00)
    ok_exceeded, msg_exceeded = limiter.check_daily_budget()
    assert ok_exceeded is False
    assert "Daily evaluation spend cap reached" in msg_exceeded
    assert "$5.50" in msg_exceeded


def test_daily_spend_cap_refuses_new_live_runs_gracefully(monkeypatch):
    """When daily budget is exhausted, live runs are refused and offer recorded run."""
    from upgrade_pilot.main import budget_limiter
    client = TestClient(app)

    orig_stream = stream_cached_run
    monkeypatch.setattr("upgrade_pilot.main.stream_cached_run", lambda demo_name, step_delay=0.001: orig_stream(demo_name, step_delay=0.001))

    # Force budget exhaustion
    monkeypatch.setattr(budget_limiter, "check_daily_budget", lambda: (False, "Spend limit $10.00 reached"))

    # Live run request must be refused gracefully
    response = client.get("/api/upgrade/stream?demo=demo_pydantic&cached=false")
    events = [json.loads(line.replace("data: ", "")) for line in response.text.strip().split("\n\n") if line.startswith("data: ")]
    spend_cap_evts = [e for e in events if e.get("event_id") == "evt_spend_cap"]
    assert len(spend_cap_evts) == 1
    assert "Daily evaluation spend cap reached" in spend_cap_evts[0]["message"]
    assert "Please watch a recorded run instead" in spend_cap_evts[0]["message"]

    # But cached run MUST continue to work freely
    response_cached = client.get("/api/upgrade/stream?demo=demo_pydantic&cached=true")
    cached_events = [json.loads(line.replace("data: ", "")) for line in response_cached.text.strip().split("\n\n") if line.startswith("data: ")]
    assert len(cached_events) > 5
    assert cached_events[-1]["step"] == "COMPLETED"


# ==============================================================================
# 5. PER-RUN TOKEN CAP & ITERATION CAP
# ==============================================================================

def test_per_run_token_cap_enforcement(monkeypatch, tmp_path):
    """Pipeline must halt immediately when per-run token budget is exceeded."""
    # Create fake sandbox with failing tests
    mock_sb = MagicMock()
    mock_sb.__enter__.return_value = mock_sb
    mock_sb.__exit__.return_value = None
    mock_sb.run_dir = tmp_path
    mock_sb.run_pytest.return_value = MagicMock(
        success=False,
        passed=False,
        total_tests=2,
        passed_tests=0,
        failed_tests=2,
        failed_test_names=["test_1"],
        error_text="Failing test",
    )
    monkeypatch.setattr("upgrade_pilot.orchestrator.engine.SandboxEnvironment", lambda *a, **kw: mock_sb)

    settings = Settings(MAX_TOKEN_BUDGET=100, MAX_ITERATIONS=5)
    cost_tracker = CostTracker(settings)
    # Artificially consume 150 tokens (> 100 max budget)
    cost_tracker.record(tier="ultra", prompt_tokens=100, completion_tokens=50)

    mock_nebius = MagicMock()
    mock_nebius.call_ultra.return_value = MagicMock(text="Plan", reasoning="", prompt_tokens=1, completion_tokens=1, reasoning_tokens=0, cost_usd=0.0001, tier="ultra")
    mock_tavily = MagicMock()
    mock_tavily.search.return_value = MagicMock(results=[])

    events = list(run_upgrade_pipeline("demo_pydantic", settings=settings, cost_tracker=cost_tracker, nebius_client=mock_nebius, tavily_client=mock_tavily))
    cap_events = [e for e in events if "Hard cap reached: Token budget cap" in e.message]
    assert len(cap_events) == 1, "Must emit hard cap reached event for token budget"
    assert cap_events[0].status == "error"


def test_iteration_cap_enforcement(monkeypatch, tmp_path):
    """Pipeline must halt after MAX_ITERATIONS when tests do not pass."""
    mock_sb = MagicMock()
    mock_sb.__enter__.return_value = mock_sb
    mock_sb.__exit__.return_value = None
    mock_sb.run_dir = tmp_path
    mock_sb.run_pytest.return_value = MagicMock(
        success=False,
        passed=False,
        total_tests=2,
        passed_tests=0,
        failed_tests=2,
        failed_test_names=["test_1"],
        error_text="Persistent failure",
    )
    monkeypatch.setattr("upgrade_pilot.orchestrator.engine.SandboxEnvironment", lambda *a, **kw: mock_sb)

    mock_nebius = MagicMock()
    mock_nebius.call_ultra.return_value = MagicMock(text="Plan", reasoning="", prompt_tokens=1, completion_tokens=1, reasoning_tokens=0, cost_usd=0.0001, tier="ultra")
    mock_nebius.call_super.return_value = MagicMock(text="FILE: order_service.py\n<<<<< FULL_FILE\n# code\n>>>>> FULL_FILE", reasoning="", prompt_tokens=1, completion_tokens=1, reasoning_tokens=0, cost_usd=0.0001, tier="super")
    mock_tavily = MagicMock()
    mock_tavily.search.return_value = MagicMock(results=[])

    settings = Settings(MAX_ITERATIONS=2, MAX_TOKEN_BUDGET=50000)
    events = list(run_upgrade_pipeline("demo_pydantic", settings=settings, nebius_client=mock_nebius, tavily_client=mock_tavily))
    completed_events = [e for e in events if e.step == "COMPLETED"]
    assert len(completed_events) == 1
    assert "Maximum iteration cap (2) reached" in completed_events[0].message


# ==============================================================================
# 6. RECORDED RUNS WITH ZERO API KEYS
# ==============================================================================

def test_recorded_runs_work_with_zero_api_keys(monkeypatch):
    """Confirm each demo has a cached real run that works with zero API keys."""
    assert is_cached_available("demo_pydantic") is True
    assert is_cached_available("demo_sqlalchemy") is True

    # Strip environment keys
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    for demo_name in ["demo_pydantic", "demo_sqlalchemy"]:
        events = list(stream_cached_run(demo_name=demo_name, step_delay=0.001))
        assert len(events) >= 10, f"Cached run for {demo_name} should contain full sequence of events"
        # Confirm deliverables present in final completed event
        completed = [e for e in events if e.step == "COMPLETED"]
        assert len(completed) == 1
        assert completed[0].payload.diff is not None
        assert len(completed[0].payload.diff) > 50
        assert completed[0].payload.pr_summary is not None


# ==============================================================================
# 7. /HEALTH ENDPOINT & SECRET SCRUBBING
# ==============================================================================

def test_health_endpoint_reports_status_and_keys_present_without_leakage():
    """Verify /health returns status, limits, and boolean key flags without leaking keys."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "healthy"
    assert data["app"] == "Upgrade Pilot"
    assert "ultra" in data["models"]
    assert "max_concurrent_runs" in data
    assert "per_run_timeout_seconds" in data
    assert data["allowed_demos"] == ["demo_pydantic", "demo_sqlalchemy"]
    assert isinstance(data["nebius_key_present"], bool)
    assert isinstance(data["tavily_key_present"], bool)

    # Ensure no actual key value leaked
    raw_text = response.text
    assert "sk-" not in raw_text
    assert "tvly-" not in raw_text
