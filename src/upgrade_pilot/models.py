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
    """Cumulative usage and cost across all model tiers."""

    tiers: Dict[str, TierCostSummary] = Field(default_factory=dict)
    total_tokens: int = 0
    total_cost_usd: float = 0.0


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
