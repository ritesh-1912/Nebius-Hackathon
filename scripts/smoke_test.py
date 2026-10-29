#!/usr/bin/env python3
"""Smoke test script for Upgrade Pilot.

Calls each of the three Nemotron model tiers (Ultra, Super, Nano) via Nebius Token Factory
and Tavily search once, then prints responses, token usage, and cumulative cost.
"""

import os
import sys
from pathlib import Path

# Ensure `src` is in sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / "src"))

from upgrade_pilot.config import get_settings
from upgrade_pilot.llm.client import NebiusClient
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.research.tavily_client import TavilySearchClient


def print_banner(title: str):
    print("\n" + "=" * 70)
    print(f" {title.upper()}")
    print("=" * 70)


def main():
    settings = get_settings()
    cost_tracker = CostTracker(settings)
    nebius = NebiusClient(settings=settings, cost_tracker=cost_tracker)
    tavily = TavilySearchClient(settings=settings)

    print_banner("Upgrade Pilot — Nebius & Tavily Smoke Test")
    print(f"Nebius Base URL: {settings.NEBIUS_BASE_URL}")
    print(f"Model Ultra:     {settings.MODEL_ULTRA}")
    print(f"Model Super:     {settings.MODEL_SUPER}")
    print(f"Model Nano:      {settings.MODEL_NANO}")
    print(f"Tavily API Key:  {'Configured' if settings.TAVILY_API_KEY else 'Not set (using offline knowledge fallback)'}")

    # 1. Nemotron 3 Ultra (Planning & Review)
    print_banner("1. Testing Nemotron 3 Ultra (Planning / Architectural)")
    ultra_prompt = (
        "Draft a concise 2-step migration plan for upgrading a model from Pydantic v1 to Pydantic v2. "
        "Keep it under 60 words."
    )
    print(f"Prompt: {ultra_prompt}\n")
    try:
        resp_ultra = nebius.call_ultra(prompt=ultra_prompt, max_tokens=1024)
        print(f"[Ultra Response]:\n{resp_ultra.text}\n")
        print(
            f"Tokens: Prompt={resp_ultra.usage.prompt_tokens}, "
            f"Completion={resp_ultra.usage.completion_tokens} "
            f"(Reasoning={resp_ultra.usage.reasoning_tokens}), "
            f"Total={resp_ultra.usage.total_tokens} | Cost: ${resp_ultra.estimated_cost_usd:.6f}"
        )
    except Exception as e:
        print(f"[ERROR calling Ultra]: {e}")

    # 2. Nemotron 3 Super (Code Patching)
    print_banner("2. Testing Nemotron 3 Super (Code Patching)")
    super_prompt = (
        "Convert these two Pydantic v1 lines to Pydantic v2:\n"
        "1. data = user.dict()\n"
        "2. user = User.parse_obj(payload)\n"
        "Output only the 2 converted Python lines."
    )
    print(f"Prompt: {super_prompt}\n")
    try:
        resp_super = nebius.call_super(prompt=super_prompt, max_tokens=300)
        print(f"[Super Response]:\n{resp_super.text}\n")
        print(
            f"Tokens: Prompt={resp_super.usage.prompt_tokens}, "
            f"Completion={resp_super.usage.completion_tokens} "
            f"(Reasoning={resp_super.usage.reasoning_tokens}), "
            f"Total={resp_super.usage.total_tokens} | Cost: ${resp_super.estimated_cost_usd:.6f}"
        )
    except Exception as e:
        print(f"[ERROR calling Super]: {e}")

    # 3. Nemotron 3 Nano (Fast Summarization)
    print_banner("3. Testing Nemotron 3 Nano (Fast Summarization)")
    nano_prompt = (
        "Summarize this in one sentence: "
        "'In SQLAlchemy 2.0, legacy session.query() is removed and replaced by session.scalars(select()).'"
    )
    print(f"Prompt: {nano_prompt}\n")
    try:
        resp_nano = nebius.call_nano(prompt=nano_prompt, max_tokens=250)
        print(f"[Nano Response]:\n{resp_nano.text}\n")
        print(
            f"Tokens: Prompt={resp_nano.usage.prompt_tokens}, "
            f"Completion={resp_nano.usage.completion_tokens} "
            f"(Reasoning={resp_nano.usage.reasoning_tokens}), "
            f"Total={resp_nano.usage.total_tokens} | Cost: ${resp_nano.estimated_cost_usd:.6f}"
        )
    except Exception as e:
        print(f"[ERROR calling Nano]: {e}")

    # 4. Tavily Search
    print_banner("4. Testing Tavily Web Search (Real API Call)")
    tavily_query = "pydantic v2 migration guide .dict() replacement"
    preferred_domains = ["docs.pydantic.dev", "pydantic.dev"]
    print(f"Query: {tavily_query}")
    print(f"Preferred Domains: {preferred_domains}\n")
    try:
        tavily_resp = tavily.search(
            query=tavily_query,
            max_results=3,
            include_domains=preferred_domains,
        )
        cost_tracker.record_tavily_call(1)
        print(f"Status: SUCCESS (is_mock={tavily_resp.is_mock})")
        print(f"Returned Results: {len(tavily_resp.results)}")
        if tavily_resp.raw_answer:
            print(f"Answer: {tavily_resp.raw_answer}\n")
        for i, item in enumerate(tavily_resp.results, start=1):
            print(f"  Result {i}: {item.title}")
            print(f"  URL:      {item.url}")
            print(f"  Snippet:  {item.content[:140]}...\n")
    except Exception as e:
        print(f"[ERROR searching Tavily]: {e}")

    # 5. Cost Tracker Summary
    print_banner("5. Cumulative Token & Cost Telemetry Summary")
    summary = cost_tracker.get_summary()

    header = f"{'TIER':<10} | {'PROMPT TOKENS':<14} | {'COMPL TOKENS':<13} | {'REASONING':<10} | {'TOTAL':<8} | {'EST. COST ($)':<12}"
    print(header)
    print("-" * len(header))
    for tier_name, tier_data in summary.tiers.items():
        print(
            f"{tier_name.upper():<10} | "
            f"{tier_data.prompt_tokens:<14} | "
            f"{tier_data.completion_tokens:<13} | "
            f"{tier_data.reasoning_tokens:<10} | "
            f"{tier_data.total_tokens:<8} | "
            f"${tier_data.cost_usd:<11.6f}"
        )
    print("-" * len(header))
    print(f"{'OVERALL':<10} | {'':<14} | {'':<13} | {'':<10} | {summary.total_tokens:<8} | ${summary.total_cost_usd:<11.6f}")
    print(f"Tavily Search API Calls: {summary.tavily_calls}\n")
    print("Smoke test finished successfully!")


if __name__ == "__main__":
    main()
