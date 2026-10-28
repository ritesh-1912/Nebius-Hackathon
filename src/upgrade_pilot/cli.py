"""Command-line interface for Upgrade Pilot.

Usage:
    python -m upgrade_pilot.cli demo_pydantic
    python -m upgrade_pilot.cli demo_sqlalchemy
"""

import argparse
import sys
from typing import Optional

from upgrade_pilot.config import get_settings
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.orchestrator.engine import run_upgrade_pipeline


def print_rule(char: str = "=", length: int = 76):
    print(char * length)


def print_banner(text: str):
    print("\n" + "=" * 76)
    print(f"  {text.upper()}")
    print("=" * 76)


def print_telemetry_table(cost_tracker: CostTracker):
    summary = cost_tracker.get_summary()
    print_rule("-")
    header = f"{'MODEL TIER':<12} | {'PROMPT':<10} | {'COMPL':<10} | {'REASONING':<10} | {'TOTAL':<8} | {'EST. COST ($)':<12}"
    print(header)
    print_rule("-")
    for tier_name, tier_data in summary.tiers.items():
        print(
            f"{tier_name.upper():<12} | "
            f"{tier_data.prompt_tokens:<10} | "
            f"{tier_data.completion_tokens:<10} | "
            f"{tier_data.reasoning_tokens:<10} | "
            f"{tier_data.total_tokens:<8} | "
            f"${tier_data.cost_usd:<11.6f}"
        )
    print_rule("-")
    print(f"{'OVERALL':<12} | {'':<10} | {'':<10} | {'':<10} | {summary.total_tokens:<8} | ${summary.total_cost_usd:<11.6f}")
    print_rule("-")


def main():
    parser = argparse.ArgumentParser(
        description="Upgrade Pilot — Autonomous Python dependency migration agent.",
    )
    parser.add_argument(
        "demo",
        nargs="?",
        default="demo_pydantic",
        help="Demo directory name to migrate (default: demo_pydantic, or demo_sqlalchemy)",
    )
    args = parser.parse_args()

    demo_name = args.demo
    settings = get_settings()
    cost_tracker = CostTracker(settings)

    print_banner(f"Upgrade Pilot — CLI Execution: {demo_name}")
    print(f"Target Demo:      {demo_name}")
    print(f"Nebius Base URL:  {settings.NEBIUS_BASE_URL}")
    print(f"Model Ultra:      {settings.MODEL_ULTRA}")
    print(f"Model Super:      {settings.MODEL_SUPER}")
    print(f"Model Nano:       {settings.MODEL_NANO}")
    print(f"Token Budget:     {settings.MAX_TOKEN_BUDGET} tokens max")

    pipeline = run_upgrade_pipeline(
        demo_name=demo_name,
        settings=settings,
        cost_tracker=cost_tracker,
    )

    last_completed_event = None

    for event in pipeline:
        step_tag = f"[{event.step}]"
        if event.iteration > 0:
            step_tag += f" (Iter {event.iteration}/{event.max_iterations})"

        status_icon = {
            "pending": "⏳",
            "running": "⚡",
            "success": "✅",
            "error": "❌",
            "warning": "⚠️",
        }.get(event.status, "•")

        print(f"\n{status_icon} {step_tag:<26} {event.message}")

        # Detail printouts based on event step
        if event.step == "BASELINE_TEST" and event.payload.test_summary:
            ts = event.payload.test_summary
            print(f"   Tests: {ts.passed} passed, {ts.failed} failed of {ts.total}")
            if ts.failed_test_names:
                for f_name in ts.failed_test_names[:3]:
                    print(f"     ❌ {f_name}")

        elif event.step == "PLANNING" and event.status == "success" and event.payload.plan_markdown:
            print("\n   --- Migration Plan Preview ---")
            lines = event.payload.plan_markdown.splitlines()[:10]
            print("\n".join(f"   {l}" for l in lines))
            if len(event.payload.plan_markdown.splitlines()) > 10:
                print("   ...")

        elif event.step == "RESEARCH" and event.status == "success" and event.payload.research_findings:
            print(f"\n   --- Research Findings ({len(event.payload.research_findings)}) ---")
            for item in event.payload.research_findings:
                print(f"   • {item.query}")
                print(f"     Rule: {item.note}")
                print(f"     Source: {item.source_url}")

        elif event.step == "PATCHING" and event.status == "success" and event.payload.patches:
            print(f"\n   --- Applied Patches ({len(event.payload.patches)}) ---")
            for p in event.payload.patches:
                print(f"   • File: {p.file}")
                if p.explanation:
                    print(f"     Why: {p.explanation}")

        elif event.step == "VERIFYING" and event.payload.test_summary:
            ts = event.payload.test_summary
            print(f"   Outcome: {ts.passed} passed, {ts.failed} failed of {ts.total}")
            if ts.failed > 0 and ts.output_tail:
                print("   --- Error Details Preview ---")
                for err_line in ts.output_tail.splitlines()[:6]:
                    print(f"     {err_line}")

        elif event.step == "COMPLETED":
            last_completed_event = event

    # Print final PR Summary and Diff if available
    if last_completed_event and last_completed_event.payload:
        if last_completed_event.payload.diff:
            print_banner("Final Unified Diff")
            print(last_completed_event.payload.diff)

        if last_completed_event.payload.pr_summary:
            print_banner("GitHub Pull Request Summary (Generated by Nemotron 3 Ultra)")
            print(last_completed_event.payload.pr_summary)

    # Print final Cost Telemetry Table
    print_banner("Final Token & Cost Telemetry Per Model Tier")
    print_telemetry_table(cost_tracker)


if __name__ == "__main__":
    main()
