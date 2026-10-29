"""Benchmark runner to execute each demo 3 times and record telemetry.

Outputs structured results:
- Success rate (X/3)
- Iterations per run
- Tokens per tier (Ultra, Super, Nano)
- Cost per tier and overall cost ($)
- Duration
"""

import os
import sys
import time
from pathlib import Path

# Ensure src is on pythonpath
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from upgrade_pilot.orchestrator.engine import run_upgrade_pipeline


def run_benchmark():
    demos = ["demo_pydantic", "demo_sqlalchemy"]
    num_runs = 3

    print("=" * 80, flush=True)
    print("UPGRADE PILOT — 3x RELIABILITY & QUALITY BENCHMARK", flush=True)
    print("=" * 80, flush=True)

    results = []

    for demo in demos:
        print(f"\n>>> Benchmarking Demo: {demo} (3 Consecutive Executions)...", flush=True)
        demo_results = []

        for run_idx in range(1, num_runs + 1):
            print(f"\n--- [{demo}] Run {run_idx}/{num_runs} Starting ---", flush=True)
            start_time = time.time()

            events = []
            for event in run_upgrade_pipeline(demo_name=demo):
                events.append(event)
                # Print milestone events
                if event.step in ("BASELINE_TEST", "PLANNING", "RESEARCH", "REVIEW", "COMPLETED"):
                    if event.status in ("success", "error"):
                        print(f"    [{event.step}] {event.message[:90]}", flush=True)
                elif event.step in ("PATCHING", "VERIFYING") and event.status in ("success", "error"):
                    print(f"    [{event.step} (Iter {event.iteration})] {event.message[:90]}", flush=True)

            duration = round(time.time() - start_time, 2)

            # Analyze last completed event
            completed_events = [e for e in events if e.step == "COMPLETED"]
            last_event = completed_events[-1] if completed_events else events[-1]

            # Find last test summary
            verifying_events = [e for e in events if e.step == "VERIFYING" and e.payload and e.payload.test_summary]
            last_test = verifying_events[-1].payload.test_summary if verifying_events else None

            # Get final cost telemetry from event
            cum = last_event.telemetry.cumulative if (last_event.telemetry and last_event.telemetry.cumulative) else None

            success = last_event.status == "success"
            iterations = last_event.iteration
            passed = last_test.passed if last_test else 0
            total = last_test.total if last_test else 0

            ultra_tokens = cum.tiers["ultra"].total_tokens if (cum and "ultra" in cum.tiers) else 0
            super_tokens = cum.tiers["super"].total_tokens if (cum and "super" in cum.tiers) else 0
            nano_tokens = cum.tiers["nano"].total_tokens if (cum and "nano" in cum.tiers) else 0
            total_tokens = cum.total_tokens if cum else 0
            total_cost = cum.total_cost_usd if cum else 0.0
            tavily_calls = cum.tavily_calls if cum else 0

            run_data = {
                "demo": demo,
                "run": run_idx,
                "success": success,
                "iterations": iterations,
                "passed": passed,
                "total": total,
                "duration_s": duration,
                "ultra_tokens": ultra_tokens,
                "super_tokens": super_tokens,
                "nano_tokens": nano_tokens,
                "total_tokens": total_tokens,
                "total_cost": total_cost,
                "tavily_calls": tavily_calls,
            }
            demo_results.append(run_data)
            results.append(run_data)

            status_symbol = "✅ PASS" if success else "❌ FAIL"
            print(
                f"\n>>> [{demo}] Run {run_idx}/{num_runs} Result: {status_symbol} | "
                f"Tests: {passed}/{total} | Iterations: {iterations} | "
                f"Tokens: {total_tokens:,} | Cost: ${total_cost:.5f} | Time: {duration}s\n",
                flush=True,
            )

    # Print summary table
    print("\n" + "=" * 95, flush=True)
    print("BENCHMARK SUMMARY TABLE (3x RUNS PER DEMO)", flush=True)
    print("=" * 95, flush=True)
    header = (
        f"{'DEMO':<16} | {'RUN':<4} | {'STATUS':<7} | {'TESTS':<7} | "
        f"{'ITERS':<5} | {'ULTRA':<7} | {'SUPER':<7} | {'NANO':<6} | "
        f"{'TOTAL TOK':<9} | {'COST ($)':<9} | {'TAVILY':<6}"
    )
    print(header, flush=True)
    print("-" * 95, flush=True)
    for r in results:
        status_str = "PASS" if r["success"] else "FAIL"
        tests_str = f"{r['passed']}/{r['total']}"
        print(
            f"{r['demo']:<16} | #{r['run']:<3} | {status_str:<7} | {tests_str:<7} | "
            f"{r['iterations']:<5} | {r['ultra_tokens']:<7} | {r['super_tokens']:<7} | {r['nano_tokens']:<6} | "
            f"{r['total_tokens']:<9} | ${r['total_cost']:<8.5f} | {r['tavily_calls']:<6}",
            flush=True,
        )
    print("-" * 95, flush=True)

    # Calculate success rates
    for demo in demos:
        demo_runs = [r for r in results if r["demo"] == demo]
        pass_count = sum(1 for r in demo_runs if r["success"])
        avg_cost = sum(r["total_cost"] for r in demo_runs) / len(demo_runs)
        avg_tokens = sum(r["total_tokens"] for r in demo_runs) / len(demo_runs)
        print(
            f"SUMMARY {demo}: Success Rate: {pass_count}/{len(demo_runs)} ({pass_count/len(demo_runs)*100:.1f}%) | "
            f"Avg Tokens: {avg_tokens:,.0f} | Avg Cost: ${avg_cost:.5f}",
            flush=True,
        )
    print("=" * 95, flush=True)


if __name__ == "__main__":
    run_benchmark()
