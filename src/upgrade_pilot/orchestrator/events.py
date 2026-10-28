"""Event creation and formatting helpers for Upgrade Pilot."""

import datetime
import uuid
from typing import Optional
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.models import (
    AgentEvent,
    CallTelemetry,
    EventPayload,
    EventTelemetry,
    LLMResponse,
)


def create_event(
    run_id: str,
    demo_id: str,
    step: str,
    status: str,
    message: str,
    iteration: int = 0,
    max_iterations: int = 5,
    payload: Optional[EventPayload] = None,
    cost_tracker: Optional[CostTracker] = None,
    last_llm_response: Optional[LLMResponse] = None,
) -> AgentEvent:
    """Factory function for creating strongly-typed AgentEvents."""
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    event_id = f"evt_{uuid.uuid4().hex[:12]}"

    telemetry = EventTelemetry()
    if last_llm_response:
        telemetry.current_tier = last_llm_response.tier
        telemetry.call_tokens = CallTelemetry(
            prompt_tokens=last_llm_response.usage.prompt_tokens,
            completion_tokens=last_llm_response.usage.completion_tokens,
            reasoning_tokens=last_llm_response.usage.reasoning_tokens,
            cost_usd=last_llm_response.estimated_cost_usd,
        )

    if cost_tracker:
        telemetry.cumulative = cost_tracker.get_summary()

    return AgentEvent(
        event_id=event_id,
        run_id=run_id,
        demo_id=demo_id,
        step=step,
        iteration=iteration,
        max_iterations=max_iterations,
        status=status,
        message=message,
        timestamp=timestamp,
        payload=payload or EventPayload(),
        telemetry=telemetry,
    )
