#!/usr/bin/env python3
"""Verification script for Upgrade Pilot Sandbox.

Proves that:
1. For both demos, all pytest tests PASS on the "before" requirements.
2. For both demos, several tests FAIL after upgrading dependencies without patches.
"""

import sys
from pathlib import Path

# Ensure `src` is in sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / "src"))

from upgrade_pilot.sandbox.runner import SandboxEnvironment


def print_banner(title: str):
    print("\n" + "=" * 76)
    print(f" {title.upper()}")
    print("=" * 76)


def print_run_result(label: str, result):
    status = "✅ ALL TESTS PASSED" if result.success else "❌ TESTS FAILED (EXPECTED FOR UPGRADE)"
    print(f"\n--- [{label}] ---")
    print(f"Status:   {status}")
    print(f"Summary:  {result.passed_tests} passed, {result.failed_tests} failed out of {result.total_tests} total")
    print(f"Duration: {result.duration_seconds:.2f}s | Exit Code: {result.exit_code}")

    if result.failed_test_names:
        print(f"Failed Tests ({len(result.failed_test_names)}):")
        for name in result.failed_test_names:
            print(f"  • {name}")

    if result.error_text:
        # Print snippet of error output
        lines = [line for line in result.error_text.splitlines() if line.strip()]
        preview = "\n".join(lines[:12])
        print(f"\nError Details Preview:\n{preview}")
        if len(lines) > 12:
            print(f"  ... (+ {len(lines) - 12} more lines of traceback)")


def verify_demo(demo_name: str, demo_path: Path):
    print_banner(f"Verifying Demo: {demo_name}")
    req_before = demo_path / "requirements-before.txt"
    req_after = demo_path / "requirements-after.txt"

    # 1. Run Before Version (Must pass 100%)
    print(f"\n[1/2] Creating sandbox with BEFORE requirements: {req_before.name}...")
    with SandboxEnvironment(demo_dir=demo_path, requirements_path=req_before) as sandbox_before:
        res_before = sandbox_before.run_pytest()
    print_run_result(f"{demo_name} — BEFORE UPGRADE", res_before)

    # 2. Run After Version (Must fail tests)
    print(f"\n[2/2] Creating sandbox with AFTER requirements: {req_after.name}...")
    with SandboxEnvironment(demo_dir=demo_path, requirements_path=req_after) as sandbox_after:
        res_after = sandbox_after.run_pytest()
    print_run_result(f"{demo_name} — AFTER UPGRADE (UNPATCHED)", res_after)

    return res_before, res_after


def main():
    print_banner("UPGRADE PILOT — SANDBOX RUNNER PROOF OF CONCEPT")
    print("Running end-to-end sandbox verification from local wheelhouse...")

    demos_dir = root_dir / "demos"
    pydantic_dir = demos_dir / "demo_pydantic"
    sqlalchemy_dir = demos_dir / "demo_sqlalchemy"

    # Verify Demo 1: Pydantic
    pyd_before, pyd_after = verify_demo("Pydantic (v1 -> v2)", pydantic_dir)

    # Verify Demo 2: SQLAlchemy
    sql_before, sql_after = verify_demo("SQLAlchemy (1.4 -> 2.0)", sqlalchemy_dir)

    # Final Verification Assertions
    print_banner("SANDBOX VERIFICATION SUMMARY TABLE")
    table_header = f"{'DEMO':<28} | {'PHASE':<16} | {'PASSED':<8} | {'FAILED':<8} | {'STATUS'}"
    print(table_header)
    print("-" * len(table_header))
    print(f"{'Pydantic (v1 -> v2)':<28} | {'Before (v1)':<16} | {pyd_before.passed_tests:<8} | {pyd_before.failed_tests:<8} | {'PASS (100%)' if pyd_before.success else 'FAIL'}")
    print(f"{'Pydantic (v1 -> v2)':<28} | {'After (v2)':<16} | {pyd_after.passed_tests:<8} | {pyd_after.failed_tests:<8} | {'BREAKAGE CONFIRMED' if not pyd_after.success else 'UNEXPECTED PASS'}")
    print("-" * len(table_header))
    print(f"{'SQLAlchemy (1.4 -> 2.0)':<28} | {'Before (1.4)':<16} | {sql_before.passed_tests:<8} | {sql_before.failed_tests:<8} | {'PASS (100%)' if sql_before.success else 'FAIL'}")
    print(f"{'SQLAlchemy (1.4 -> 2.0)':<28} | {'After (2.0)':<16} | {sql_after.passed_tests:<8} | {sql_after.failed_tests:<8} | {'BREAKAGE CONFIRMED' if not sql_after.success else 'UNEXPECTED PASS'}")
    print("-" * len(table_header))

    assert pyd_before.success, "Pydantic demo must pass all tests on v1!"
    assert not pyd_after.success, "Pydantic demo must fail tests on v2 before patch!"
    assert sql_before.success, "SQLAlchemy demo must pass all tests on 1.4!"
    assert not sql_after.success, "SQLAlchemy demo must fail tests on 2.0 before patch!"

    print("\n✅ PROOF COMPLETE: Both demo repos pass 100% on old versions and fail realistically after upgrade.")


if __name__ == "__main__":
    main()
