#!/usr/bin/env python3
"""
agent_guardrail.py — Post-edit checkpoint → lint → sanitize pipeline.

Workflow:
    1. checkpoint   — snapshot the file before LLM edits
    2. [LLM edits]  — (external step, not handled here)
    3. lint         — uv run ruff check <file>
    4. if lint fails — diff current vs checkpoint, report to LLM for correction
    5. if lint passes — run agent_sanitizer to fix escape artifacts

Usage:
    # Step 1: Before LLM edits
    uv run python admin/code_hygiene/agent_guardrail.py checkpoint <file>

    # Step 2: After LLM edits (lint + sanitize)
    uv run python admin/code_hygiene/agent_guardrail.py validate <file>

    # Step 3: If lint failed, get the diff for LLM context
    uv run python admin/code_hygiene/agent_guardrail.py diff <file>

    # Full pipeline (checkpoint → you edit → validate)
    uv run python admin/code_hygiene/agent_guardrail.py full <file>
"""

import difflib
import logging
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("AgentGuardrail")

# ---------------------------------------------------------------------------
# Path sanitization
# ---------------------------------------------------------------------------
_SAFE_METACHAR_RE = re.compile(r'[;&|`$(){}[\]<>\'"\n\r\t\\]')

def _sanitize_path(file_path: str) -> Path:
    """Resolve and validate a user-provided file path.

    Raises ValueError if the path contains shell metacharacters or escapes
    the project root directory.
    """
    if _SAFE_METACHAR_RE.search(file_path):
        raise ValueError(f"File path contains invalid characters: {file_path!r}")

    path = Path(file_path).resolve()

    try:
        path.relative_to(PROJECT_ROOT)
    except ValueError:
        raise ValueError(f"File path escapes project root: {file_path!r}")

    return path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent  # admin/code_hygiene/
PROJECT_ROOT = SCRIPT_DIR.parent.parent  # literouter/
CHECKPOINT_DIR = PROJECT_ROOT / ".checkpoints"
SANITIZER = SCRIPT_DIR / "agent_sanitizer.py"


# ---------------------------------------------------------------------------
# Step 1: Checkpoint
# ---------------------------------------------------------------------------
def checkpoint(file_path: str) -> str | None:
    """Create a timestamped snapshot of the file before LLM edits."""
    try:
        path = _sanitize_path(file_path)
        if not path.exists():
            logger.error(f"File not found: {path}")
            return None

        CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        stem = path.stem
        suffix = path.suffix
        backup_path = CHECKPOINT_DIR / f"{stem}_{ts}{suffix}.bak"

        shutil.copy2(str(path), str(backup_path))
        logger.info(f"✅ Checkpoint created: {backup_path}")
        return str(backup_path)
    except Exception as e:
        logger.error(f"Checkpoint failed for {file_path}: {e}")
        return None


# ---------------------------------------------------------------------------
# Step 3: Lint (ruff check)
# ---------------------------------------------------------------------------
def _check_syntax(path: Path) -> dict[str, Any] | None:
    """Validate Python syntax for .py files. Returns error dict or None on OK."""
    if path.suffix != ".py":
        return None

    try:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
    except SyntaxError as e:
        return {"success": False, "syntax_ok": False, "message": f"Syntax error: {e}"}
    return None


def _find_ruff_cmd() -> list[str]:
    """Determine the ruff command to use."""
    venv_ruff = PROJECT_ROOT / ".venv" / "bin" / "ruff"
    if venv_ruff.exists():
        return [str(venv_ruff), "check"]

    if shutil.which("uv") is not None:
        return ["uv", "run", "ruff", "check"]

    return ["ruff", "check"]


def _run_ruff(ruff_cmd: list[str], path: Path) -> dict[str, Any]:
    """Execute ruff check and return the result dict."""
    try:
        result = subprocess.run(
            [*ruff_cmd, str(path)],
            capture_output=True,
            cwd=str(PROJECT_ROOT),
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "ruff check timed out"}

    return {
        "success": result.returncode == 0,
        "syntax_ok": True,
        "ruff_exit": result.returncode,
        "ruff_output": (
            result.stdout[-1000:]
            if result.stdout
            else (result.stderr[-1000:] if result.stderr else "")
        ),
    }


def lint_file(file_path: str) -> dict[str, Any]:
    """Run ruff check on the file. Returns structured result."""
    try:
        path = _sanitize_path(file_path)
        if not path.exists():
            return {"success": False, "message": f"File not found: {path}"}

        syntax_error = _check_syntax(path)
        if syntax_error is not None:
            return syntax_error

        if path.suffix != ".py":
            return {
                "success": True,
                "syntax_ok": True,
                "ruff_exit": 0,
                "ruff_output": "Skipped ruff check for non-Python file.",
            }

        ruff_cmd = _find_ruff_cmd()
        return _run_ruff(ruff_cmd, path)
    except Exception as e:
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Step 4: Diff against checkpoint
# ---------------------------------------------------------------------------
def _find_latest_checkpoint(stem: str, suffix: str) -> Path | None:
    """Find the most recent checkpoint backup for a file stem/suffix."""
    if not CHECKPOINT_DIR.exists():
        return None

    backups = sorted(
        CHECKPOINT_DIR.glob(f"{stem}_*{suffix}.bak"), reverse=True
    )
    return backups[0] if backups else None


def _generate_diff(path: Path, latest: Path) -> str:
    """Generate a unified diff between checkpoint and current file."""
    checkpoint_content = latest.read_text(encoding="utf-8").splitlines(
        keepends=True
    )
    current_content = path.read_text(encoding="utf-8").splitlines(
        keepends=True
    )

    diff = difflib.unified_diff(
        checkpoint_content,
        current_content,
        fromfile=f"checkpoint/{latest.name}",
        tofile=f"current/{path.name}",
        lineterm="",
    )

    diff_text = "\n".join(diff)
    if not diff_text:
        return "No changes detected between checkpoint and current file."
    return diff_text


def diff_against_checkpoint(file_path: str) -> str:
    """Diff current file vs most recent checkpoint. Returns unified diff."""
    try:
        path = _sanitize_path(file_path)
        if not path.exists():
            return f"Error: File not found: {path}"

        stem = path.stem
        suffix = path.suffix
        latest = _find_latest_checkpoint(stem, suffix)

        if latest is None:
            if not CHECKPOINT_DIR.exists():
                return "Error: No checkpoint directory found"
            return f"Error: No checkpoint found for {path.name}"

        return _generate_diff(path, latest)
    except Exception as e:
        return f"Error generating diff: {e}"


# ---------------------------------------------------------------------------
# Step 5: Sanitize (escape artifacts)
# ---------------------------------------------------------------------------
def sanitize(file_path: str) -> dict[str, Any]:
    """Run agent_sanitizer on the file. Returns result dict."""
    try:
        path = _sanitize_path(file_path)
        if not path.exists():
            return {"success": False, "message": f"File not found: {path}"}

        result = subprocess.run(
            [sys.executable, str(SANITIZER), str(path)],
            capture_output=True,
            cwd=str(PROJECT_ROOT),
            text=True,
            timeout=15,
        )

        output = result.stdout.strip()
        return {"success": result.returncode == 0, "output": output}
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Sanitizer timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------
def full_pipeline(file_path: str) -> dict[str, Any]:
    """
    Run the complete guardrail pipeline:
    checkpoint → lint → (diff on fail | sanitize on pass)
    """
    path = Path(file_path).resolve()
    logger.info(f"🛡️  Guardrail pipeline for: {path.name}")

    cp_path = checkpoint(str(path))
    if not cp_path:
        return {
            "success": False,
            "stage": "checkpoint",
            "message": "Failed to create checkpoint",
        }

    logger.info("⏸️  Checkpoint saved. Make your edits now, then run:")
    logger.info(
        f'   uv run python admin/code_hygiene/agent_guardrail.py validate {shlex.quote(str(path))}'
    )

    return {
        "success": True,
        "stage": "checkpoint",
        "checkpoint": cp_path,
        "message": "Checkpoint created. Edit the file, then run validate.",
    }


def validate(file_path: str) -> dict[str, Any]:
    """
    Run post-edit validation:
    lint → (diff on fail | sanitize on pass)
    """
    path = Path(file_path).resolve()
    logger.info(f"🔍 Validating: {path.name}")

    lint_result = lint_file(str(path))
    if not lint_result["success"]:
        logger.error(f"❌ Lint failed for {path.name}")
        logger.error(
            f"   ruff output:\n{lint_result.get('ruff_output', lint_result.get('message', ''))}"
        )

        diff_text = diff_against_checkpoint(str(path))
        logger.info(f"📋 Diff for LLM context:\n{diff_text}")

        return {
            "success": False,
            "stage": "lint",
            "lint_result": lint_result,
            "diff": diff_text,
            "message": "Lint failed. Feed the diff above back to the LLM for correction.",
        }

    logger.info(f"✅ Lint passed for {path.name}")

    san_result = sanitize(str(path))
    if san_result["success"]:
        logger.info(f"🧹 Sanitizer: {san_result.get('output', 'Done')}")
    else:
        logger.warning(
            f"⚠️  Sanitizer issue: {san_result.get('message', san_result.get('output', ''))}"
        )

    return {
        "success": True,
        "stage": "complete",
        "lint_result": lint_result,
        "sanitize_result": san_result,
        "message": "All checks passed. File is clean.",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _print_help() -> None:
    print(__doc__)
    print("\nCommands:")
    print("  checkpoint <file>  — Create pre-edit checkpoint")
    print("  validate <file>    — Lint + sanitize after edits")
    print("  diff <file>        — Show diff vs last checkpoint")
    print("  sanitize <file>    — Run sanitizer only")
    print("  full <file>        → checkpoint (then instruct to edit + validate)")


def _dispatch_checkpoint(file_path: str) -> int:
    result: str | None = checkpoint(file_path)
    return 0 if result else 1


def _dispatch_validate(file_path: str) -> int:
    result: dict[str, Any] = validate(file_path)
    return 0 if result["success"] else 1


def _dispatch_diff(file_path: str) -> int:
    print(diff_against_checkpoint(file_path))
    return 0


def _dispatch_sanitize(file_path: str) -> int:
    result: dict[str, Any] = sanitize(file_path)
    print(result.get("output", result.get("message", "")))
    return 0 if result["success"] else 1


def _dispatch_full(file_path: str) -> int:
    result: dict[str, Any] = full_pipeline(file_path)
    return 0 if result["success"] else 1


_DISPATCH: dict[str, Any] = {
    "checkpoint": _dispatch_checkpoint,
    "validate": _dispatch_validate,
    "diff": _dispatch_diff,
    "sanitize": _dispatch_sanitize,
    "full": _dispatch_full,
}


def main() -> None:
    if len(sys.argv) < 3:
        _print_help()
        sys.exit(1)

    command = sys.argv[1]
    file_path = sys.argv[2]

    handler = _DISPATCH.get(command)
    if handler is None:
        print(f"Unknown command: {command}")
        sys.exit(1)

    sys.exit(handler(file_path))


if __name__ == "__main__":
    main()
