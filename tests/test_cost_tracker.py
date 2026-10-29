"""Unit tests for multi-tier LLM token accounting and cost calculation."""

import pytest
from upgrade_pilot.config import Settings
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.models import TokenUsage


@pytest.fixture
def test_settings():
    """Configured pricing settings for testing."""
    return Settings(
        PRICE_ULTRA_INPUT=2.00,
        PRICE_ULTRA_OUTPUT=6.00,
        PRICE_SUPER_INPUT=0.60,
        PRICE_SUPER_OUTPUT=1.80,
        PRICE_NANO_INPUT=0.10,
        PRICE_NANO_OUTPUT=0.20,
    )


def test_cost_tracker_initialization(test_settings):
    """Verify clean initial state of cost tracker."""
    tracker = CostTracker(test_settings)
    summary = tracker.get_summary()

    assert summary.total_tokens == 0
    assert summary.total_cost_usd == 0.0
    assert summary.tavily_calls == 0
    assert "ultra" in summary.tiers
    assert "super" in summary.tiers
    assert "nano" in summary.tiers


def test_cost_tracker_ultra_calculation(test_settings):
    """Verify cost calculation for Nemotron 3 Ultra (Tier 1)."""
    tracker = CostTracker(test_settings)
    
    # 10,000 prompt tokens ($2/M) = $0.02
    # 5,000 completion tokens ($6/M) = $0.03
    # Expected cost = $0.05
    usage = TokenUsage(
        prompt_tokens=10_000,
        completion_tokens=5_000,
        reasoning_tokens=2_000,
        total_tokens=15_000,
    )
    cost = tracker.record_usage(tier="ultra", usage=usage)

    assert pytest.approx(cost, rel=1e-5) == 0.05
    summary = tracker.get_summary()
    assert summary.tiers["ultra"].prompt_tokens == 10_000
    assert summary.tiers["ultra"].completion_tokens == 5_000
    assert summary.tiers["ultra"].reasoning_tokens == 2_000
    assert summary.tiers["ultra"].total_tokens == 15_000
    assert pytest.approx(summary.tiers["ultra"].cost_usd, rel=1e-5) == 0.05


def test_cost_tracker_multi_tier_accumulation(test_settings):
    """Verify cumulative accumulation across all 3 Nemotron tiers and Tavily."""
    tracker = CostTracker(test_settings)

    # Ultra: 1M prompt ($2.00), 1M completion ($6.00) = $8.00
    tracker.record_usage(
        tier="ultra",
        usage=TokenUsage(prompt_tokens=1_000_000, completion_tokens=1_000_000, total_tokens=2_000_000),
    )

    # Super: 1M prompt ($0.60), 1M completion ($1.80) = $2.40
    tracker.record_usage(
        tier="super",
        usage=TokenUsage(prompt_tokens=1_000_000, completion_tokens=1_000_000, total_tokens=2_000_000),
    )

    # Nano: 1M prompt ($0.10), 1M completion ($0.20) = $0.30
    tracker.record_usage(
        tier="nano",
        usage=TokenUsage(prompt_tokens=1_000_000, completion_tokens=1_000_000, total_tokens=2_000_000),
    )

    # Tavily calls
    tracker.record_tavily_call(2)

    summary = tracker.get_summary()
    assert summary.total_tokens == 6_000_000
    assert pytest.approx(summary.total_cost_usd, rel=1e-5) == 10.70
    assert summary.tavily_calls == 2
