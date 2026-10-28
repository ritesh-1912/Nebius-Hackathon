"""Safe file patcher with AST syntax validation and unified diff tracking."""

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
        """Resolve a filename or relative path inside the sandbox."""
        clean_name = filename.strip().lstrip("/")
        # Try direct relative path
        candidate = self.sandbox_dir / clean_name
        if candidate.is_file():
            return candidate

        # Try matching basename
        for py_file in self.sandbox_dir.rglob("*.py"):
            if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
                continue
            if py_file.name == Path(clean_name).name:
                return py_file

        return None

    def apply_edits(self, edits: List[StructuredPatchEdit]) -> Tuple[List[str], Optional[str]]:
        """Apply a list of structured edits.
        
        Returns:
            Tuple of (list_of_applied_summaries, error_message_if_any)
        """
        applied: List[str] = []

        for i, edit in enumerate(edits, start=1):
            target_path = self.find_file(edit.file)
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
