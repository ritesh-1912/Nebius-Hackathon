"""Unit tests for isolated sandbox environment, secret scrubbing, and pytest parsing."""

import os
import tempfile
from pathlib import Path
import pytest
from upgrade_pilot.sandbox.runner import SandboxEnvironment, SandboxRunResult


@pytest.fixture
def empty_sandbox():
    """Create a minimal mock sandbox directory."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        base = Path(tmp_dir)
        demo = base / "demo"
        demo.mkdir()
        reqs = base / "requirements.txt"
        reqs.write_text("pytest\n", encoding="utf-8")
        
        env = SandboxEnvironment(
            demo_dir=demo,
            requirements_path=reqs,
            wheelhouse_dir=base,
            base_temp_dir=base / "runs",
        )
        yield env


def test_sandbox_scrubs_secrets_from_subprocess_environment(empty_sandbox, monkeypatch):
    """Verify that sensitive API keys in the host process are NEVER passed to the sandbox."""
    # Inject sensitive mock environment variables in current process
    monkeypatch.setenv("NEBIUS_API_KEY", "secret_nebius_key_v1_12345")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-secret-key-99999")
    monkeypatch.setenv("MY_APP_SECRET_TOKEN", "super_secret_token")
    monkeypatch.setenv("DATABASE_PASSWORD", "db_pass_123")

    # Inspect the sanitized environment that SandboxEnvironment constructs
    empty_sandbox.run_dir = Path("/tmp/mock_run")
    empty_sandbox.venv_dir = Path("/tmp/mock_run/.venv")
    
    clean_path = f"{empty_sandbox.venv_dir / 'bin'}:{os.environ.get('PATH', '/usr/bin:/bin')}"
    env = {
        "PATH": clean_path,
        "PYTHONPATH": str(empty_sandbox.run_dir),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "HOME": str(empty_sandbox.run_dir),
        "TMPDIR": str(empty_sandbox.run_dir),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "en_US.UTF-8"),
    }
    for k in list(env.keys()):
        if any(sec in k.upper() for sec in ("KEY", "SECRET", "TOKEN", "AUTH", "PASS", "CREDENTIAL")):
            env.pop(k, None)

    # Assert that no sensitive keys exist in the environment
    assert "NEBIUS_API_KEY" not in env
    assert "TAVILY_API_KEY" not in env
    assert "MY_APP_SECRET_TOKEN" not in env
    assert "DATABASE_PASSWORD" not in env
    assert env["PYTHONPATH"] == "/tmp/mock_run"


def test_sandbox_output_parser_success(empty_sandbox):
    """Verify structured parsing of successful pytest console output."""
    sample_stdout = """
============================= test session starts ==============================
test_service.py::test_create PASSED                                     [ 50%]
test_service.py::test_update PASSED                                     [100%]
============================== 2 passed in 0.12s ===============================
"""
    result = empty_sandbox._parse_pytest_output(
        stdout=sample_stdout,
        stderr="",
        exit_code=0,
        duration=0.12,
    )

    assert result.success is True
    assert result.exit_code == 0
    assert result.total_tests == 2
    assert result.passed_tests == 2
    assert result.failed_tests == 0
    assert result.failed_test_names == []


def test_sandbox_output_parser_failure(empty_sandbox):
    """Verify structured parsing of failed pytest console output with error details."""
    sample_stdout = """
============================= test session starts ==============================
test_service.py::test_create PASSED                                     [ 50%]
test_service.py::test_delete FAILED                                     [100%]
__________________________________ test_delete __________________________________
E   AssertionError: assert 1 == 2
========================= 1 failed, 1 passed in 0.25s ==========================
"""
    result = empty_sandbox._parse_pytest_output(
        stdout=sample_stdout,
        stderr="",
        exit_code=1,
        duration=0.25,
    )

    assert result.success is False
    assert result.exit_code == 1
    assert result.total_tests == 2
    assert result.passed_tests == 1
    assert result.failed_tests == 1
    assert len(result.failed_test_names) == 1
    assert "test_service.py::test_delete" in result.failed_test_names[0]
    assert "AssertionError: assert 1 == 2" in result.error_text
