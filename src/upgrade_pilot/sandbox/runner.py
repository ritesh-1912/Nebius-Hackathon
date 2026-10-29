"""Isolated execution sandbox for running pytest suites against wheelhouse dependencies."""

import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

try:
    import resource
except ImportError:
    resource = None

logger = logging.getLogger(__name__)


@dataclass
class SandboxRunResult:
    """Structured results from a sandbox pytest run."""

    success: bool
    exit_code: int
    total_tests: int
    passed_tests: int
    failed_tests: int
    error_text: str
    stdout: str
    stderr: str
    duration_seconds: float
    failed_test_names: List[str] = field(default_factory=list)


class SandboxEnvironment:
    """Manages an ephemeral directory, venv, and subprocess execution with resource limits."""

    def __init__(
        self,
        demo_dir: Path,
        requirements_path: Path,
        wheelhouse_dir: Optional[Path] = None,
        base_temp_dir: Optional[Path] = None,
    ):
        self.demo_dir = Path(demo_dir).resolve()
        self.requirements_path = Path(requirements_path).resolve()

        if wheelhouse_dir:
            self.wheelhouse_dir = Path(wheelhouse_dir).resolve()
        else:
            # Default to repo root wheelhouse/
            self.wheelhouse_dir = (Path(__file__).resolve().parent.parent.parent.parent / "wheelhouse").resolve()

        self.run_id = f"run_{uuid.uuid4().hex[:10]}"
        self.base_temp_dir = Path(base_temp_dir) if base_temp_dir else Path("/tmp/upgrade_pilot_runs")
        self.run_dir: Optional[Path] = None
        self.venv_dir: Optional[Path] = None
        self.python_bin: Optional[Path] = None
        self.pytest_bin: Optional[Path] = None

    def __enter__(self):
        self.setup()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()

    def setup(self) -> Path:
        """Create ephemeral run dir, copy demo files, and initialize venv from wheelhouse."""
        self.base_temp_dir.mkdir(parents=True, exist_ok=True)
        self.run_dir = Path(tempfile.mkdtemp(prefix=f"{self.run_id}_", dir=str(self.base_temp_dir)))
        logger.info(f"Setting up sandbox in {self.run_dir}")

        # Copy demo repository files into run directory
        for item in self.demo_dir.iterdir():
            if item.name.startswith((".", "__pycache__")):
                continue
            dest = self.run_dir / item.name
            if item.is_dir():
                shutil.copytree(item, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            else:
                shutil.copy2(item, dest)

        # Create virtual environment
        self.venv_dir = self.run_dir / ".venv"
        cmd_venv = [sys.executable, "-m", "venv", str(self.venv_dir)]
        subprocess.run(cmd_venv, check=True, capture_output=True)

        self.python_bin = self.venv_dir / "bin" / "python"
        self.pip_bin = self.venv_dir / "bin" / "pip"
        self.pytest_bin = self.venv_dir / "bin" / "pytest"

        # Install dependencies strictly offline from local wheelhouse
        cmd_install = [
            str(self.pip_bin),
            "install",
            "--no-index",
            f"--find-links={str(self.wheelhouse_dir)}",
            "-r",
            str(self.requirements_path),
        ]
        install_res = subprocess.run(cmd_install, capture_output=True, text=True)
        if install_res.returncode != 0:
            raise RuntimeError(
                f"Failed to install requirements from wheelhouse into sandbox venv:\n{install_res.stderr}\n{install_res.stdout}"
            )

        return self.run_dir

    def run_pytest(self, timeout_seconds: int = 25) -> SandboxRunResult:
        """Execute pytest in the isolated venv with timeout and resource limits."""
        if not self.run_dir or not self.pytest_bin or not self.pytest_bin.exists():
            raise RuntimeError("Sandbox environment is not set up.")

        # Build sanitized, leak-proof environment for the sandbox subprocess
        # Ensures NO API keys, tokens, or parent process secrets are accessible to sandbox code
        clean_path = f"{self.venv_dir / 'bin'}:{os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')}"
        env = {
            "PATH": clean_path,
            "PYTHONPATH": str(self.run_dir),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
            "HOME": str(self.run_dir),
            "TMPDIR": str(self.run_dir),
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", "en_US.UTF-8"),
        }

        # Explicitly scrub all secret-like environment variables as defense in depth
        for k in list(env.keys()):
            if any(sec in k.upper() for sec in ("KEY", "SECRET", "TOKEN", "AUTH", "PASS", "CREDENTIAL")):
                env.pop(k, None)

        cmd = [str(self.pytest_bin), "-v", "--tb=short", "--color=no"]

        def _set_limits():
            """Set process group and POSIX resource limits."""
            os.setsid()
            if resource:
                try:
                    # Limit CPU time to timeout + 5s
                    resource.setrlimit(resource.RLIMIT_CPU, (timeout_seconds + 5, timeout_seconds + 10))
                except Exception:
                    pass
                try:
                    # 10MB file size limit
                    resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 15 * 1024 * 1024))
                except Exception:
                    pass

        start_time = time.time()
        proc = subprocess.Popen(
            cmd,
            cwd=str(self.run_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            preexec_fn=_set_limits if hasattr(os, "setsid") else None,
        )

        try:
            stdout, stderr = proc.communicate(timeout=timeout_seconds)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            # Kill the entire process group
            try:
                if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                else:
                    proc.kill()
            except Exception:
                pass
            stdout, stderr = proc.communicate()
            duration = time.time() - start_time
            return SandboxRunResult(
                success=False,
                exit_code=-1,
                total_tests=0,
                passed_tests=0,
                failed_tests=1,
                error_text=f"Pytest execution timed out after {timeout_seconds} seconds.",
                stdout=stdout,
                stderr=stderr,
                duration_seconds=round(duration, 3),
                failed_test_names=["TIMEOUT"],
            )

        duration = time.time() - start_time
        return self._parse_pytest_output(stdout, stderr, exit_code, duration)

    def _parse_pytest_output(
        self,
        stdout: str,
        stderr: str,
        exit_code: int,
        duration: float,
    ) -> SandboxRunResult:
        """Extract structured test metrics from pytest console output."""
        passed = 0
        failed = 0
        failed_names: List[str] = []

        # Find individual test results: e.g., "test_order_service.py::test_01 PASSED"
        for line in stdout.splitlines():
            if "::" in line:
                if "PASSED" in line:
                    passed += 1
                elif "FAILED" in line:
                    failed += 1
                    # Extract test identifier
                    parts = line.split()
                    for p in parts:
                        if "::" in p:
                            failed_names.append(p.strip())
                            break

        total = passed + failed

        # Extract failure or collection error section
        error_lines: List[str] = []
        capture = False
        for line in stdout.splitlines():
            if ("FAILURES" in line or "ERRORS" in line) and "=" in line:
                capture = True
                continue
            if capture:
                if "short test summary info" in line or ("=" in line and ("failed" in line or "passed" in line or "error" in line)):
                    capture = False
                else:
                    error_lines.append(line)

        # Handle collection-time errors (e.g. exit code 2 where tests could not even be collected)
        if exit_code != 0 and total == 0:
            failed = 1
            total = 1
            # Look for error lines in short test summary info or stdout
            for line in stdout.splitlines():
                if line.startswith("ERROR "):
                    failed_names.append(line.strip())
            if not failed_names:
                failed_names.append("collection_error")

        error_text = "\n".join(error_lines).strip()
        if not error_text and failed > 0:
            error_text = stdout[-1500:].strip()

        success = (exit_code == 0) and (failed == 0) and (total > 0)

        return SandboxRunResult(
            success=success,
            exit_code=exit_code,
            total_tests=total,
            passed_tests=passed,
            failed_tests=failed,
            error_text=error_text,
            stdout=stdout,
            stderr=stderr,
            duration_seconds=round(duration, 3),
            failed_test_names=failed_names,
        )

    def cleanup(self) -> None:
        """Remove the ephemeral run directory."""
        if self.run_dir and self.run_dir.exists():
            try:
                shutil.rmtree(self.run_dir)
                logger.info(f"Cleaned up sandbox {self.run_dir}")
            except Exception as e:
                logger.warning(f"Failed to remove sandbox dir {self.run_dir}: {e}")
            self.run_dir = None
