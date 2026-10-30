"""Pydantic models for Upgrade Pilot schemas."""

from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class TokenUsage(BaseModel):
    """Detailed token usage for an LLM call."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0


class LLMResponse(BaseModel):
    """Normalized response from any Nebius model tier."""

    text: str
    tier: str  # "ultra", "super", or "nano"
    model: str
    usage: TokenUsage
    estimated_cost_usd: float = 0.0
    reasoning: Optional[str] = None


class TierCostSummary(BaseModel):
    """Token and cost accumulator for a specific model tier."""

    tier: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class CostSummary(BaseModel):
    """Cumulative usage and cost across all model tiers and external tools."""

    tiers: Dict[str, TierCostSummary] = Field(default_factory=dict)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    tavily_calls: int = 0


class TavilySearchResultItem(BaseModel):
    """Single Tavily web search result item."""

    title: str
    url: str
    content: str
    score: Optional[float] = None


class TavilySearchResponse(BaseModel):
    """Aggregated response from Tavily search."""

    query: str
    results: List[TavilySearchResultItem] = Field(default_factory=list)
    raw_answer: Optional[str] = None
    is_mock: bool = False


class StructuredPatchEdit(BaseModel):
    """A single structured edit: search text and its replacement."""

    file: str
    search: str
    replace: str
    explanation: Optional[str] = None


class TestSummaryPayload(BaseModel):
    """Structured test outcome summary for events."""

    __test__ = False
    total: int = 0
    passed: int = 0
    failed: int = 0
    failed_test_names: List[str] = Field(default_factory=list)
    output_tail: str = ""


class ResearchItem(BaseModel):
    """Summarized research finding with source URL."""

    query: str
    source_url: str
    title: str = ""
    note: str


class CallTelemetry(BaseModel):
    """Telemetry for a single LLM invocation."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0


class EventTelemetry(BaseModel):
    """Telemetry snapshot included with events."""

    current_tier: Optional[str] = None
    call_tokens: Optional[CallTelemetry] = None
    cumulative: Optional[CostSummary] = None


class EventPayload(BaseModel):
    """Payload data associated with an agent event."""

    test_summary: Optional[TestSummaryPayload] = None
    research_findings: Optional[List[ResearchItem]] = None
    plan_markdown: Optional[str] = None
    patches: Optional[List[StructuredPatchEdit]] = None
    diff: Optional[str] = None
    pr_summary: Optional[str] = None
    changed_files: List[str] = Field(default_factory=list)
    no_test_files_modified: bool = True


class AgentEvent(BaseModel):
    """Typed event streamed during the agent migration loop."""

    event_id: str
    run_id: str
    demo_id: str
    step: str  # INIT | BASELINE_TEST | RESEARCH | PLANNING | PATCHING | VERIFYING | REVIEW | COMPLETED | FAILED
    iteration: int = 0
    max_iterations: int = 5
    status: str  # pending | running | success | error
    message: str
    timestamp: str
    payload: EventPayload = Field(default_factory=EventPayload)
    telemetry: EventTelemetry = Field(default_factory=EventTelemetry)

