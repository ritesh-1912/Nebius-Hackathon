#!/usr/bin/env python3
"""Build and populate the local wheelhouse with pre-downloaded wheels.

Ensures that all dependency versions for both before/after demo repos
can be installed completely offline in sandboxes without PyPI network calls.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
WHEELHOUSE_DIR = ROOT_DIR / "wheelhouse"

TARGET_GROUPS = [
    # Demo 1: Pydantic v1
    ["pydantic>=1.10.17,<2.0.0"],
    # Demo 1: Pydantic v2
    ["pydantic>=2.7.0,<3.0.0"],
    # Demo 2: SQLAlchemy 1.4
    ["sqlalchemy>=1.4.50,<2.0.0"],
    # Demo 2: SQLAlchemy 2.0
    ["sqlalchemy>=2.0.30,<2.1.0"],
    # Test runner & common dependencies
    ["pytest>=8.0.0", "typing-extensions>=4.12.0", "annotated-types>=0.6.0", "iniconfig>=2.0.0", "packaging>=24.0", "pluggy>=1.5.0"],
]


def build_wheelhouse():
    WHEELHOUSE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Building wheelhouse at: {WHEELHOUSE_DIR}")
    print(f"Target groups: {len(TARGET_GROUPS)}")

    for group in TARGET_GROUPS:
        print(f"\nBuilding wheels for: {group}")
        cmd = [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            "--no-cache-dir",
            "--retries",
            "5",
            "--timeout",
            "60",
            "--wheel-dir",
            str(WHEELHOUSE_DIR),
            *group,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"ERROR building group {group}:\n{result.stderr}")
            sys.exit(result.returncode)

    wheels = list(WHEELHOUSE_DIR.glob("*.whl"))
    print(f"\nSuccessfully populated wheelhouse with {len(wheels)} wheels:")
    for w in sorted(wheels):
        print(f" - {w.name} ({w.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    build_wheelhouse()
