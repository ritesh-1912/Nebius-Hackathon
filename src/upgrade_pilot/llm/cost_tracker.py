"""Cost and token tracking across Nemotron model tiers."""

from typing import Dict, Optional
from upgrade_pilot.config import Settings, get_settings
from upgrade_pilot.models import CostSummary, LLMResponse, TierCostSummary, TokenUsage


class CostTracker:
    """Tracks token consumption and computes estimated USD cost per model tier."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._tiers: Dict[str, TierCostSummary] = {
            "ultra": TierCostSummary(tier="ultra"),
            "super": TierCostSummary(tier="super"),
            "nano": TierCostSummary(tier="nano"),
        }
        self.tavily_calls: int = 0

    def record_tavily_call(self, count: int = 1) -> None:
        """Record an execution of Tavily Search API."""
        self.tavily_calls += count

    def calculate_cost(self, tier: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Calculate USD cost for a specific token usage using configured pricing."""
        pricing = self.settings.get_tier_pricing(tier)
        input_cost = (prompt_tokens * pricing["input"]) / 1_000_000.0
        output_cost = (completion_tokens * pricing["output"]) / 1_000_000.0
        return round(input_cost + output_cost, 6)

    def record_usage(
        self,
        tier: str,
        usage: TokenUsage,
    ) -> float:
        """Record a TokenUsage object for a tier and return incremental cost in USD."""
        return self.record(
            tier=tier,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            reasoning_tokens=usage.reasoning_tokens,
        )

    def record(
        self,
        tier: str,
        prompt_tokens: int,
        completion_tokens: int,
        reasoning_tokens: int = 0,
    ) -> float:
        """Record token counts for a tier and return the cost of this specific call in USD."""
        norm_tier = tier.lower()
        if norm_tier not in self._tiers:
            self._tiers[norm_tier] = TierCostSummary(tier=norm_tier)

        tier_summary = self._tiers[norm_tier]
        cost = self.calculate_cost(norm_tier, prompt_tokens, completion_tokens)

        tier_summary.prompt_tokens += prompt_tokens
        tier_summary.completion_tokens += completion_tokens
        tier_summary.reasoning_tokens += reasoning_tokens
        tier_summary.total_tokens += prompt_tokens + completion_tokens
        tier_summary.cost_usd = round(tier_summary.cost_usd + cost, 6)

        return cost

    def record_response(self, response: LLMResponse) -> float:
        """Record an LLMResponse directly into the tracker."""
        return self.record_usage(response.tier, response.usage)

    def get_summary(self) -> CostSummary:
        """Return the cumulative summary across all tiers and external tools."""
        total_tokens = sum(t.total_tokens for t in self._tiers.values())
        total_cost = round(sum(t.cost_usd for t in self._tiers.values()), 6)

        return CostSummary(
            tiers={k: v.model_copy() for k, v in self._tiers.items()},
            total_tokens=total_tokens,
            total_cost_usd=total_cost,
            tavily_calls=self.tavily_calls,
        )

    def reset(self) -> None:
        """Reset all counters to zero."""
        for tier in self._tiers.values():
            tier.prompt_tokens = 0
            tier.completion_tokens = 0
            tier.reasoning_tokens = 0
            tier.total_tokens = 0
            tier.cost_usd = 0.0
        self.tavily_calls = 0
