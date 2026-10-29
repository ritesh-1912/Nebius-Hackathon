"""Unit tests for agent event schema serialization, validation, and typing."""

import json
import pytest
from upgrade_pilot.models import (
    AgentEvent,
    CallTelemetry,
    CostSummary,
    EventPayload,
    EventTelemetry,
    ResearchItem,
    StructuredPatchEdit,
    TestSummaryPayload,
    TierCostSummary,
    TokenUsage,
)


def test_agent_event_minimal_schema():
    """Verify serialization and parsing of a minimal AgentEvent."""
    event = AgentEvent(
        event_id="evt_test_01",
        run_id="run_12345",
        demo_id="demo_pydantic",
        step="INIT",
        status="running",
        message="Starting sandbox initialization...",
        timestamp="2026-10-29T20:00:00Z",
    )

    data = event.model_dump()
    assert data["event_id"] == "evt_test_01"
    assert data["step"] == "INIT"
    assert data["status"] == "running"

    # Round trip via JSON
    json_str = event.model_dump_json()
    parsed = AgentEvent.model_validate_json(json_str)
    assert parsed.event_id == event.event_id
    assert parsed.demo_id == event.demo_id


def test_agent_event_full_payload_schema():
    """Verify serialization of an event containing complete payload and telemetry."""
    event = AgentEvent(
        event_id="evt_completed_01",
        run_id="run_999",
        demo_id="demo_pydantic",
        step="COMPLETED",
        iteration=1,
        max_iterations=5,
        status="success",
        message="Migration succeeded in 1 iteration(s).",
        timestamp="2026-10-29T20:05:00Z",
        payload=EventPayload(
            diff="--- a/order.py\n+++ b/order.py\n@@ -1 +1 @@",
            pr_summary="# Title: Pydantic v2 Migration",
            changed_files=["order_service.py"],
            test_summary=TestSummaryPayload(
                total=10,
                passed=10,
                failed=0,
                failed_test_names=[],
                output_tail="10 passed in 0.5s",
            ),
            research_findings=[
                ResearchItem(
                    query="pydantic regex replacement",
                    source_url="https://docs.pydantic.dev",
                    title="Field Migration",
                    note="Use pattern instead of regex",
                )
            ],
            patches=[
                StructuredPatchEdit(
                    file="order_service.py",
                    search="regex=",
                    replace="pattern=",
                    explanation="Fix removed kwarg",
                )
            ],
        ),
        telemetry=EventTelemetry(
            current_tier="ultra",
            call_tokens=CallTelemetry(
                prompt_tokens=100,
                completion_tokens=50,
                reasoning_tokens=20,
                cost_usd=0.0005,
            ),
            cumulative=CostSummary(
                tiers={
                    "ultra": TierCostSummary(
                        tier="ultra",
                        prompt_tokens=100,
                        completion_tokens=50,
                        total_tokens=150,
                        cost_usd=0.0005,
                    )
                },
                total_tokens=150,
                total_cost_usd=0.0005,
                tavily_calls=2,
            ),
        ),
    )

    json_str = event.model_dump_json()
    assert "order_service.py" in json_str
    assert "pattern=" in json_str

    parsed = AgentEvent.model_validate_json(json_str)
    assert parsed.payload.changed_files == ["order_service.py"]
    assert parsed.payload.test_summary.passed == 10
    assert parsed.telemetry.cumulative.tavily_calls == 2
    assert parsed.telemetry.cumulative.tiers["ultra"].total_tokens == 150


def test_event_schema_handles_empty_fields_cleanly():
    """Ensure optional payload fields default to None or empty without raising errors."""
    payload = EventPayload()
    assert payload.test_summary is None
    assert payload.diff is None
    assert payload.changed_files == []

    telemetry = EventTelemetry()
    assert telemetry.current_tier is None
    assert telemetry.call_tokens is None
    assert telemetry.cumulative is None
