"""Core agentic orchestration engine for Upgrade Pilot.

Implements the pure-Python closed-loop migration pipeline:
1. Baseline test run on upgraded dependency -> collect failures
2. Nemotron 3 Ultra: Migration plan from code + test traces
3. Tavily search: 2-4 targeted queries for breaking APIs + Nemotron 3 Nano summarization
4. Nemotron 3 Super: Proposes structured edits (file, search, replace) with repair/retry
5. Sandbox pytest verification loop (up to 5 iterations, token budget cap)
6. Nemotron 3 Ultra: Final diff review and PR-style summary
"""

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Dict, Generator, List, Optional, Tuple

from upgrade_pilot.config import Settings, get_settings
from upgrade_pilot.llm.client import NebiusClient
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.models import (
    AgentEvent,
    EventPayload,
    ResearchItem,
    StructuredPatchEdit,
    TestSummaryPayload,
)
from upgrade_pilot.orchestrator.events import create_event
from upgrade_pilot.research.tavily_client import TavilySearchClient
from upgrade_pilot.sandbox.patcher import SandboxPatcher
from upgrade_pilot.sandbox.runner import SandboxEnvironment

logger = logging.getLogger(__name__)


def read_repo_code(repo_dir: Path) -> Dict[str, str]:
    """Read all non-venv, non-cache Python source files from the repo."""
    code_files: Dict[str, str] = {}
    for py_file in repo_dir.rglob("*.py"):
        if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
            continue
        rel_path = str(py_file.relative_to(repo_dir))
        try:
            code_files[rel_path] = py_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"Could not read {rel_path}: {e}")
    return code_files


def format_code_context(code_files: Dict[str, str]) -> str:
    """Format dictionary of file contents into a markdown string."""
    blocks: List[str] = []
    for rel_path, content in sorted(code_files.items()):
        blocks.append(f"### File: `{rel_path}`\n```python\n{content}\n```")
    return "\n\n".join(blocks)


def parse_structured_edits(raw_text: str, default_file: Optional[str] = None) -> List[StructuredPatchEdit]:
    """Parse structured edits from model output, supporting Search/Replace blocks, Full-File blocks, and JSON."""
    edits: List[StructuredPatchEdit] = []

    # 1. Try FULL_FILE replacement blocks
    full_pattern = r"(?:FILE:\s*([^\n\r]+)\s*)?<{5,9}\s*FULL_FILE\s*\n([\s\S]*?)\n>{5,9}\s*FULL_FILE"
    for match in re.finditer(full_pattern, raw_text):
        file_match = match.group(1)
        f_name = file_match.strip().strip("`\"'") if file_match else (default_file or "")
        edits.append(
            StructuredPatchEdit(
                file=f_name,
                search="*",
                replace=match.group(2),
                explanation="Full file replacement",
            )
        )
    if edits:
        return edits

    # 2. Try Search/Replace blocks (Aider / Diff format)
    block_pattern = (
        r"(?:FILE:\s*([^\n\r]+)\s*)?<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n={5,9}\s*\n([\s\S]*?)\n>{5,9}\s*REPLACE"
    )
    current_file = default_file
    for match in re.finditer(block_pattern, raw_text):
        file_match = match.group(1)
        if file_match and file_match.strip():
            current_file = file_match.strip().strip("`\"'")
        search_text = match.group(2)
        replace_text = match.group(3)
        if current_file and search_text:
            edits.append(
                StructuredPatchEdit(
                    file=current_file,
                    search=search_text,
                    replace=replace_text,
                    explanation="Search/Replace block edit",
                )
            )

    if edits:
        return edits

    # 3. Try JSON Array parsing
    cleaned = raw_text.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json")[1].split("```")[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```")[1].split("```")[0].strip()

    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1:
        cleaned_json = cleaned[start : end + 1]
        try:
            data = json.loads(cleaned_json)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "search" in item and "replace" in item:
                        edits.append(
                            StructuredPatchEdit(
                                file=item.get("file", default_file or ""),
                                search=item.get("search", ""),
                                replace=item.get("replace", ""),
                                explanation=item.get("explanation"),
                            )
                        )
                if edits:
                    return edits
        except Exception:
            pass

    # 3. Lenient regex fallback for JSON-like objects
    obj_pattern = r'\{\s*"file"\s*:\s*"([^"]+)"\s*,\s*"search"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"replace"\s*:\s*"((?:[^"\\]|\\.)*)"'
    for m in re.finditer(obj_pattern, raw_text):
        f_name = m.group(1)
        try:
            s_text = m.group(2).encode().decode("unicode-escape", errors="ignore").replace("\\n", "\n")
            r_text = m.group(3).encode().decode("unicode-escape", errors="ignore").replace("\\n", "\n")
            edits.append(
                StructuredPatchEdit(
                    file=f_name,
                    search=s_text,
                    replace=r_text,
                    explanation="Regex extracted edit",
                )
            )
        except Exception:
            pass

    if edits:
        return edits

    raise ValueError("Could not parse structured edits from model output.")


def generate_targeted_queries(demo_id: str, error_text: str, plan_text: str) -> List[str]:
    """Generate 2 to 4 targeted documentation search queries based on errors and plan."""
    queries: List[str] = []
    err_lower = error_text.lower()
    demo_lower = demo_id.lower()

    if "pydantic" in demo_lower:
        if "regex" in err_lower or "pattern" in err_lower:
            queries.append("pydantic v2 migration guide regex pattern Field replacement")
        if "dict" in err_lower or "model_dump" in err_lower:
            queries.append("pydantic v2 migration guide .dict() to .model_dump()")
        if "parse_obj" in err_lower or "model_validate" in err_lower:
            queries.append("pydantic v2 migration guide parse_obj to model_validate")
        if "validator" in err_lower:
            queries.append("pydantic v2 migration guide @validator to @field_validator")
        if len(queries) < 2:
            queries.append("pydantic v2 migration guide breaking changes ConfigDict")
    elif "sql" in demo_lower or "alchemy" in demo_lower:
        if "execute" in err_lower:
            queries.append("sqlalchemy 2.0 migration guide engine.execute removed replacement")
        if "query" in err_lower or "scalars" in err_lower:
            queries.append("sqlalchemy 2.0 migration guide session.query select scalars")
        if "get" in err_lower:
            queries.append("sqlalchemy 2.0 migration guide session.get legacy query.get")
        if len(queries) < 2:
            queries.append("sqlalchemy 2.0 migration guide DeclarativeBase declarative_base")
    else:
        queries.append(f"{demo_id} migration guide breaking changes")
        queries.append(f"{demo_id} upgrade errors troubleshooting")

    return queries[:4]


def run_upgrade_pipeline(
    demo_name: str,
    settings: Optional[Settings] = None,
    cost_tracker: Optional[CostTracker] = None,
    nebius_client: Optional[NebiusClient] = None,
    tavily_client: Optional[TavilySearchClient] = None,
) -> Generator[AgentEvent, None, None]:
    """Main closed-loop agent pipeline generator.
    
    Yields typed AgentEvent instances at each phase for live UI or CLI streaming.
    """
    settings = settings or get_settings()
    cost_tracker = cost_tracker or CostTracker(settings)
    nebius = nebius_client or NebiusClient(settings=settings, cost_tracker=cost_tracker)
    tavily = tavily_client or TavilySearchClient(settings=settings)

    run_id = f"run_{uuid.uuid4().hex[:10]}"
    root_dir = Path(__file__).resolve().parent.parent.parent.parent

    # Resolve demo directory
    demo_dir = root_dir / "demos" / demo_name
    if not demo_dir.is_dir():
        # Check alternative naming
        candidate = root_dir / "demos" / f"demo_{demo_name}"
        if candidate.is_dir():
            demo_dir = candidate
        else:
            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="INIT",
                status="error",
                message=f"Demo directory '{demo_name}' not found under demos/.",
                cost_tracker=cost_tracker,
            )
            return

    req_after = demo_dir / "requirements-after.txt"
    if not req_after.exists():
        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="INIT",
            status="error",
            message=f"requirements-after.txt not found in {demo_dir}.",
            cost_tracker=cost_tracker,
        )
        return

    # -------------------------------------------------------------------------
    # STEP 1: Sandbox Initialization & Baseline Test Failure Verification
    # -------------------------------------------------------------------------
    yield create_event(
        run_id=run_id,
        demo_id=demo_name,
        step="INIT",
        status="running",
        message=f"Provisioning isolated sandbox for '{demo_name}' with upgraded dependencies...",
        cost_tracker=cost_tracker,
    )

    with SandboxEnvironment(demo_dir=demo_dir, requirements_path=req_after) as sandbox:
        patcher = SandboxPatcher(sandbox.run_dir)
        baseline_res = sandbox.run_pytest(timeout_seconds=settings.SANDBOX_TIMEOUT_SECONDS)

        test_payload = TestSummaryPayload(
            total=baseline_res.total_tests,
            passed=baseline_res.passed_tests,
            failed=baseline_res.failed_tests,
            failed_test_names=baseline_res.failed_test_names,
            output_tail=baseline_res.error_text[:1200],
        )

        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="BASELINE_TEST",
            status="running" if not baseline_res.success else "success",
            message=(
                f"Baseline verification complete: {baseline_res.passed_tests} passed, "
                f"{baseline_res.failed_tests} failed out of {baseline_res.total_tests}."
            ),
            payload=EventPayload(test_summary=test_payload),
            cost_tracker=cost_tracker,
        )

        if baseline_res.success:
            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="COMPLETED",
                status="success",
                message="All tests are already passing on the upgraded version! No migration necessary.",
                cost_tracker=cost_tracker,
            )
            return

        # ---------------------------------------------------------------------
        # STEP 2: Nemotron 3 Ultra — Migration Planning
        # ---------------------------------------------------------------------
        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="PLANNING",
            status="running",
            message="Nemotron 3 Ultra is analyzing the codebase and pytest failures to draft a migration plan...",
            cost_tracker=cost_tracker,
        )

        current_code = read_repo_code(sandbox.run_dir)
        code_context = format_code_context(current_code)

        ultra_plan_prompt = (
            f"You are Nemotron 3 Ultra, a world-class Python software architect.\n"
            f"We are upgrading the codebase from an older library version to the latest major version.\n\n"
            f"### Pytest Failure Traces:\n```\n{baseline_res.error_text}\n```\n\n"
            f"### Current Codebase:\n{code_context}\n\n"
            f"Provide a clear, concrete, step-by-step architectural migration plan:\n"
            f"1. Identify the breaking API changes that caused these test failures.\n"
            f"2. Specify exactly what imports, decorators, classes, and methods need to be replaced.\n"
            f"3. Outline the order of file modifications to minimize regression."
        )

        resp_plan = nebius.call_ultra(
            prompt=ultra_plan_prompt,
            system_prompt="You are Nemotron 3 Ultra, an expert in Python dependency migrations and AST refactoring.",
            max_tokens=2048,
        )

        plan_markdown = resp_plan.text
        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="PLANNING",
            status="success",
            message="Nemotron 3 Ultra generated the migration plan.",
            payload=EventPayload(plan_markdown=plan_markdown),
            cost_tracker=cost_tracker,
            last_llm_response=resp_plan,
        )

        # ---------------------------------------------------------------------
        # STEP 3: Tavily Grounding & Nemotron 3 Nano Summarization
        # ---------------------------------------------------------------------
        queries = generate_targeted_queries(demo_name, baseline_res.error_text, plan_markdown)
        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="RESEARCH",
            status="running",
            message=f"Querying Tavily API for {len(queries)} breaking change documentation queries...",
            cost_tracker=cost_tracker,
        )

        research_items: List[ResearchItem] = []
        for q in queries:
            tav_res = tavily.search(query=q, max_results=2)
            for item in tav_res.results:
                nano_prompt = (
                    f"Summarize this documentation snippet into a 1-sentence migration rule for Python developers:\n\n"
                    f"Snippet:\n{item.content[:800]}"
                )
                resp_nano = nebius.call_nano(
                    prompt=nano_prompt,
                    system_prompt="You are Nemotron 3 Nano, an ultra-fast summarizer of technical documentation.",
                    max_tokens=250,
                )
                research_items.append(
                    ResearchItem(
                        query=q,
                        source_url=item.url,
                        title=item.title,
                        note=resp_nano.text.strip(),
                    )
                )

        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="RESEARCH",
            status="success",
            message=f"Tavily search complete. Nemotron 3 Nano synthesized {len(research_items)} migration rules.",
            payload=EventPayload(research_findings=research_items),
            cost_tracker=cost_tracker,
        )

        # ---------------------------------------------------------------------
        # STEP 4 & 5: Nemotron 3 Super Iterative Patching & Verification Loop
        # ---------------------------------------------------------------------
        iteration = 0
        max_iterations = settings.MAX_ITERATIONS
        all_passed = False
        last_test_res = baseline_res

        notes_str = "\n".join(
            f"- [{r.title or r.query}]({r.source_url}): {r.note}" for r in research_items
        )

        while iteration < max_iterations:
            iteration += 1

            # Check Token Budget Cap
            summary = cost_tracker.get_summary()
            if summary.total_tokens >= settings.MAX_TOKEN_BUDGET:
                yield create_event(
                    run_id=run_id,
                    demo_id=demo_name,
                    step="PATCHING",
                    iteration=iteration,
                    max_iterations=max_iterations,
                    status="error",
                    message=f"Token budget cap ({settings.MAX_TOKEN_BUDGET} tokens) reached. Halting loop.",
                    cost_tracker=cost_tracker,
                )
                break

            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="PATCHING",
                iteration=iteration,
                max_iterations=max_iterations,
                status="running",
                message=f"[Iteration {iteration}/{max_iterations}] Nemotron 3 Super is generating code patches...",
                cost_tracker=cost_tracker,
            )

            current_code = read_repo_code(sandbox.run_dir)
            code_context = format_code_context(current_code)

            # Determine primary target file from test errors if possible
            default_target_file = None
            for fname in current_code.keys():
                if "test" not in fname.lower():
                    default_target_file = fname
                    break

            super_prompt = (
                f"You are Nemotron 3 Super, an expert Python code patcher.\n\n"
                f"### Migration Plan (Nemotron 3 Ultra):\n{plan_markdown}\n\n"
                f"### Official Migration Rules (Tavily & Nano):\n{notes_str}\n\n"
                f"### Current Pytest Failures:\n```\n{last_test_res.error_text}\n```\n\n"
                f"### Current Codebase:\n{code_context}\n\n"
                f"Generate targeted edits to fix the breaking changes and make tests pass.\n"
                f"You can format your edits in either of these formats:\n\n"
                f"FORMAT 1 (Search/Replace blocks — keep SEARCH blocks under 10 lines):\n"
                f"FILE: <path/to/file.py>\n"
                f"<<<<<<< SEARCH\n"
                f"<exact existing lines to replace>\n"
                f"=======\n"
                f"<new replacement lines>\n"
                f">>>>>>> REPLACE\n\n"
                f"FORMAT 2 (Full file replacement):\n"
                f"FILE: <path/to/file.py>\n"
                f"<<<<<<< FULL_FILE\n"
                f"<complete updated python code for this file>\n"
                f">>>>>>> FULL_FILE\n\n"
                f"FORMAT 3 (JSON array of edits):\n"
                f"```json\n"
                f"[{{\"file\": \"file.py\", \"search\": \"...\", \"replace\": \"...\"}}]\n"
                f"```\n"
                f"CRITICAL RULES:\n"
                f"1. `SEARCH` lines must match existing lines in the target file.\n"
                f"2. Ensure valid Python syntax.\n"
                f"3. Address the specific cause of the failing tests."
            )

            resp_super = nebius.call_super(
                prompt=super_prompt,
                system_prompt="You are Nemotron 3 Super. Output precise search-and-replace code edits.",
                max_tokens=4096,
            )

            # Parse edits with Repair / Retry step if malformed
            edits: List[StructuredPatchEdit] = []
            parse_error = None

            # First try parsing content, then fallback to reasoning if content is empty
            text_to_parse = resp_super.text
            if not text_to_parse.strip() and resp_super.reasoning:
                text_to_parse = resp_super.reasoning

            try:
                edits = parse_structured_edits(text_to_parse, default_file=default_target_file)
            except Exception as e:
                parse_error = str(e)
                logger.warning(f"Super output malformed: {e}. Attempting repair step...")

            if parse_error or not edits:
                # REPAIR STEP: Re-prompt Super to repair its output
                repair_prompt = (
                    f"Your previous output could not be parsed into edits. Error: {parse_error}\n"
                    f"Previous output preview:\n{text_to_parse[:600]}\n\n"
                    f"Please re-output your edits using Search/Replace blocks:\n"
                    f"FILE: {default_target_file or 'file.py'}\n"
                    f"<<<<<<< SEARCH\n"
                    f"<exact existing lines to replace>\n"
                    f"=======\n"
                    f"<new replacement lines>\n"
                    f">>>>>>> REPLACE\n"
                )
                resp_repair = nebius.call_super(
                    prompt=repair_prompt,
                    system_prompt="Output ONLY Search/Replace blocks for the code edits.",
                    max_tokens=4096,
                )
                repair_text = resp_repair.text or resp_repair.reasoning or ""
                try:
                    edits = parse_structured_edits(repair_text, default_file=default_target_file)
                    parse_error = None
                except Exception as e2:
                    yield create_event(
                        run_id=run_id,
                        demo_id=demo_name,
                        step="PATCHING",
                        iteration=iteration,
                        max_iterations=max_iterations,
                        status="error",
                        message=f"Failed to parse patch edits after repair attempt: {e2}",
                        cost_tracker=cost_tracker,
                        last_llm_response=resp_repair,
                    )
                    continue

            # Apply edits to the sandbox
            applied_summaries, patch_err = patcher.apply_edits(edits)

            if patch_err:
                yield create_event(
                    run_id=run_id,
                    demo_id=demo_name,
                    step="PATCHING",
                    iteration=iteration,
                    max_iterations=max_iterations,
                    status="error",
                    message=f"Patch application failed: {patch_err}",
                    cost_tracker=cost_tracker,
                    last_llm_response=resp_super,
                )

            current_diff = patcher.get_unified_diff()

            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="PATCHING",
                iteration=iteration,
                max_iterations=max_iterations,
                status="success" if not patch_err else "error",
                message=f"Applied {len(applied_summaries)} patch edits.",
                payload=EventPayload(patches=edits, diff=current_diff),
                cost_tracker=cost_tracker,
                last_llm_response=resp_super,
            )

            # Re-run pytest in sandbox
            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="VERIFYING",
                iteration=iteration,
                max_iterations=max_iterations,
                status="running",
                message=f"[Iteration {iteration}/{max_iterations}] Running sandbox pytest suite...",
                cost_tracker=cost_tracker,
            )

            test_res = sandbox.run_pytest(timeout_seconds=settings.SANDBOX_TIMEOUT_SECONDS)
            last_test_res = test_res

            test_payload = TestSummaryPayload(
                total=test_res.total_tests,
                passed=test_res.passed_tests,
                failed=test_res.failed_tests,
                failed_test_names=test_res.failed_test_names,
                output_tail=test_res.error_text[:1200],
            )

            yield create_event(
                run_id=run_id,
                demo_id=demo_name,
                step="VERIFYING",
                iteration=iteration,
                max_iterations=max_iterations,
                status="success" if test_res.success else "error",
                message=(
                    f"Test run completed: {test_res.passed_tests} passed, "
                    f"{test_res.failed_tests} failed out of {test_res.total_tests}."
                ),
                payload=EventPayload(test_summary=test_payload, diff=current_diff),
                cost_tracker=cost_tracker,
            )

            if test_res.success:
                all_passed = True
                break

        # ---------------------------------------------------------------------
        # STEP 6: Nemotron 3 Ultra — Final Diff Review & PR Summary
        # ---------------------------------------------------------------------
        final_diff = patcher.get_unified_diff()

        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="REVIEW",
            status="running",
            message="Nemotron 3 Ultra is reviewing the final diff and generating the PR summary...",
            cost_tracker=cost_tracker,
        )

        sources_formatted = "\n".join(f"- {r.title}: {r.source_url}" for r in research_items)

        review_prompt = (
            f"You are Nemotron 3 Ultra, a principal software engineer and tech lead.\n\n"
            f"Review this completed dependency migration diff:\n"
            f"```diff\n{final_diff}\n```\n\n"
            f"Test Suite Outcome: {last_test_res.passed_tests} passed, {last_test_res.failed_tests} failed.\n\n"
            f"Official Documentation Sources Consulted:\n{sources_formatted}\n\n"
            f"Write a GitHub Pull Request description in markdown format:\n"
            f"- **Title & Executive Summary**\n"
            f"- **Breaking Changes Addressed**\n"
            f"- **Detailed Code Changes**\n"
            f"- **Verification & Safety Checks**\n"
            f"- **Official Documentation & Migration Guides Used** (link the sources)"
        )

        resp_review = nebius.call_ultra(
            prompt=review_prompt,
            system_prompt="You are Nemotron 3 Ultra. Write a crisp, production-grade GitHub PR description in markdown.",
            max_tokens=2048,
        )

        pr_summary_md = resp_review.text

        final_status = "success" if all_passed else "warning"
        final_msg = (
            f"Migration {'succeeded' if all_passed else 'completed with warnings'} in {iteration} iteration(s). "
            f"Final tests: {last_test_res.passed_tests}/{last_test_res.total_tests} passed."
        )

        yield create_event(
            run_id=run_id,
            demo_id=demo_name,
            step="COMPLETED",
            status=final_status,
            message=final_msg,
            payload=EventPayload(
                diff=final_diff,
                pr_summary=pr_summary_md,
                test_summary=TestSummaryPayload(
                    total=last_test_res.total_tests,
                    passed=last_test_res.passed_tests,
                    failed=last_test_res.failed_tests,
                    failed_test_names=last_test_res.failed_test_names,
                ),
            ),
            cost_tracker=cost_tracker,
            last_llm_response=resp_review,
        )
