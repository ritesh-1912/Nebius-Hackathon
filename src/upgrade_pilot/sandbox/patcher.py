"""Safe file patcher with AST syntax validation, path traversal defense, and test protection."""

import ast
import difflib
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from upgrade_pilot.models import StructuredPatchEdit

logger = logging.getLogger(__name__)


class PatchApplicationError(Exception):
    """Raised when a patch cannot be cleanly applied or fails syntax checks."""
    pass


class PatchIntegrityViolationError(Exception):
    """Raised when a patch attempts to modify protected test files or configuration."""
    pass


class PathTraversalError(Exception):
    """Raised when a patch specifies a target outside the isolated sandbox directory."""
    pass


PROTECTED_TEST_CONFIG_PATTERNS = {
    "conftest.py",
    "pytest.ini",
    "setup.cfg",
    "tox.ini",
    ".coveragerc",
    "pyproject.toml",
}


def is_protected_file(filename_or_path: str) -> bool:
    """Determine if a file path targets test files, test configuration, conftest, or pytest settings.
    
    The agent may only modify application source code, never tests or harness configurations.
    """
    clean = filename_or_path.strip().replace("\\", "/")
    p = Path(clean)
    name = p.name.lower()

    if name in PROTECTED_TEST_CONFIG_PATTERNS:
        return True

    # Check test file naming conventions
    if name.startswith("test_") or name.endswith("_test.py") or name == "tests.py":
        return True

    # Check if inside a test directory
    parts = [part.lower() for part in p.parts]
    if any(part in ("tests", "test", "testing") for part in parts):
        return True

    return False


class SandboxPatcher:
    """Applies structured search-and-replace edits to files within a sandbox."""

    def __init__(self, sandbox_dir: Path):
        self.sandbox_dir = Path(sandbox_dir).resolve()
        self.original_files: Dict[str, str] = {}
        self._record_original_state()

    def _record_original_state(self) -> None:
        """Cache original content of all Python files in the sandbox."""
        for py_file in self.sandbox_dir.rglob("*.py"):
            if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
                continue
            rel_path = str(py_file.relative_to(self.sandbox_dir))
            try:
                self.original_files[rel_path] = py_file.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning(f"Could not read {rel_path}: {e}")

    def find_file(self, filename: str) -> Optional[Path]:
        """Resolve a filename or relative path inside the sandbox.
        
        Enforces:
        1. Path traversal defense (target must resolve strictly inside self.sandbox_dir).
        2. Test/config file immutability (modifying tests or test configs is forbidden).
        """
        clean_name = filename.strip()
        raw_path = Path(clean_name)

        # 1. Enforce strict path traversal defense
        if raw_path.is_absolute():
            try:
                candidate = raw_path.resolve()
                candidate.relative_to(self.sandbox_dir)
            except ValueError:
                raise PathTraversalError(
                    f"Security error: Path traversal detected in absolute path '{filename}'. "
                    f"Target resolves outside the sandbox directory."
                )
        elif ".." in raw_path.parts:
            try:
                candidate = (self.sandbox_dir / raw_path).resolve()
                candidate.relative_to(self.sandbox_dir)
            except ValueError:
                raise PathTraversalError(
                    f"Security error: Path traversal detected in relative path '{filename}'. "
                    f"Target resolves outside the sandbox directory."
                )
        else:
            candidate = (self.sandbox_dir / raw_path).resolve()
            try:
                candidate.relative_to(self.sandbox_dir)
            except ValueError:
                raise PathTraversalError(
                    f"Security error: Path traversal detected in '{filename}'."
                )

        # 2. Enforce Rule 1: Agent may only modify application source files
        if is_protected_file(clean_name):
            raise PatchIntegrityViolationError(
                f"Patch integrity violation: Modifying test files or test configuration ('{filename}') "
                f"is strictly prohibited. The agent may only modify application source files."
            )

        if candidate.is_file():
            # Double check canonical resolved path against protection
            rel = str(candidate.relative_to(self.sandbox_dir))
            if is_protected_file(rel):
                raise PatchIntegrityViolationError(
                    f"Patch integrity violation: Modifying test files or test configuration ('{rel}') "
                    f"is strictly prohibited."
                )
            return candidate

        # Try matching basename in sandbox
        for py_file in self.sandbox_dir.rglob("*.py"):
            if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
                continue
            if py_file.name == raw_path.name:
                rel_path = str(py_file.relative_to(self.sandbox_dir))
                if is_protected_file(rel_path):
                    raise PatchIntegrityViolationError(
                        f"Patch integrity violation: Modifying test file '{rel_path}' is strictly prohibited."
                    )
                return py_file

        return None

    def apply_edits(self, edits: List[StructuredPatchEdit]) -> Tuple[List[str], Optional[str]]:
        """Apply a list of structured edits.
        
        Returns:
            Tuple of (list_of_applied_summaries, error_message_if_any)
        """
        applied: List[str] = []

        for i, edit in enumerate(edits, start=1):
            try:
                target_path = self.find_file(edit.file)
            except (PatchIntegrityViolationError, PathTraversalError) as sec_err:
                logger.error(f"Patch security violation: {sec_err}")
                raise sec_err

            if not target_path:
                return applied, f"File '{edit.file}' not found in sandbox directory."

            try:
                current_text = target_path.read_text(encoding="utf-8")
            except Exception as e:
                return applied, f"Failed to read '{edit.file}': {e}"

            search_block = edit.search
            replace_block = edit.replace

            # Case A: Full file replacement
            if not search_block or search_block.strip() in ("*", "[ALL]", "[FULL_FILE]", "ALL"):
                new_text = replace_block
            else:
                new_text = None

                # 1. Exact match
                if search_block in current_text:
                    new_text = current_text.replace(search_block, replace_block, 1)

                # 2. Normalized line endings and trailing whitespace
                if new_text is None:
                    clean_search = "\n".join(line.rstrip() for line in search_block.splitlines())
                    clean_curr = "\n".join(line.rstrip() for line in current_text.splitlines())
                    if clean_search in clean_curr:
                        clean_replace = "\n".join(line.rstrip() for line in replace_block.splitlines())
                        new_text = clean_curr.replace(clean_search, clean_replace, 1)

                # 3. Fuzzy sliding window match (for slight whitespace/comment divergences)
                if new_text is None:
                    curr_lines = current_text.splitlines(keepends=True)
                    s_lines = search_block.splitlines(keepends=True)
                    n_lines = len(s_lines)
                    best_ratio = 0.0
                    best_range = None

                    # Search within sliding window +/- 2 lines
                    for window_size in range(max(1, n_lines - 2), n_lines + 3):
                        for start_idx in range(len(curr_lines) - window_size + 1):
                            candidate = "".join(curr_lines[start_idx : start_idx + window_size])
                            ratio = difflib.SequenceMatcher(None, search_block, candidate).ratio()
                            if ratio > best_ratio:
                                best_ratio = ratio
                                best_range = (start_idx, start_idx + window_size)

                    if best_ratio >= 0.80 and best_range:
                        new_lines = (
                            curr_lines[: best_range[0]]
                            + [replace_block if replace_block.endswith("\n") else replace_block + "\n"]
                            + curr_lines[best_range[1] :]
                        )
                        new_text = "".join(new_lines)
                        logger.info(f"Fuzzy matched search block with ratio {best_ratio:.2f}")

            if new_text is None:
                return applied, (
                    f"Search block not found in '{edit.file}'.\n"
                    f"Target search text preview:\n{search_block[:200]}..."
                )

            # 4. AST Syntax check before writing to disk
            if target_path.suffix == ".py":
                try:
                    ast.parse(new_text, filename=str(target_path))
                except SyntaxError as syn_err:
                    return applied, (
                        f"Patch in '{edit.file}' introduced SyntaxError at line {syn_err.lineno}: {syn_err.msg}.\n"
                        f"Erroneous line: {syn_err.text}"
                    )

            # Write out modified file
            try:
                target_path.write_text(new_text, encoding="utf-8")
                applied.append(f"Successfully applied edit #{i} to {target_path.name}")
            except Exception as e:
                return applied, f"Failed to write changes to '{edit.file}': {e}"

        return applied, None

    def get_changed_files(self) -> List[str]:
        """Return a sorted list of all relative file paths modified in the sandbox."""
        changed: List[str] = []
        for rel_path, original_content in self.original_files.items():
            curr_path = self.sandbox_dir / rel_path
            if not curr_path.exists():
                changed.append(rel_path)
            else:
                try:
                    curr_content = curr_path.read_text(encoding="utf-8")
                    if curr_content != original_content:
                        changed.append(rel_path)
                except Exception:
                    pass
        return sorted(changed)

    def get_unified_diff(self) -> str:
        """Generate unified diff between original baseline files and current sandbox state."""
        diff_lines: List[str] = []

        for rel_path, original_content in self.original_files.items():
            curr_path = self.sandbox_dir / rel_path
            if not curr_path.exists():
                curr_content = ""
            else:
                try:
                    curr_content = curr_path.read_text(encoding="utf-8")
                except Exception:
                    curr_content = ""

            if original_content != curr_content:
                file_diff = difflib.unified_diff(
                    original_content.splitlines(keepends=True),
                    curr_content.splitlines(keepends=True),
                    fromfile=f"a/{rel_path}",
                    tofile=f"b/{rel_path}",
                )
                diff_lines.extend(file_diff)

        return "".join(diff_lines)
