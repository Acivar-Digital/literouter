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
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("AgentGuardrail")

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
        path = Path(file_path).resolve()
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
def lint_file(file_path: str) -> dict:
    """Run ruff check on the file. Returns structured result."""
    try:
        path = Path(file_path).resolve()
        if not path.exists():
            return {"success": False, "message": f"File not found: {path}"}

        # Syntax check first (only for Python files)
        if path.suffix == ".py":
            try:
                compile(path.read_text(encoding="utf-8"), str(path), "exec")
            except SyntaxError as e:
                return {
                    "success": False,
                    "syntax_ok": False,
                    "message": f"Syntax error: {e}",
                }

        # Ruff check is only applicable for Python files
        if path.suffix != ".py":
            return {
                "success": True,
                "syntax_ok": True,
                "ruff_exit": 0,
                "ruff_output": "Skipped ruff check for non-Python file.",
            }

        # Try to find ruff
        venv_ruff = PROJECT_ROOT / ".venv" / "bin" / "ruff"
        if venv_ruff.exists():
            ruff_cmd = [str(venv_ruff), "check"]
        else:
            ruff_cmd = ["uv", "run", "ruff", "check"]
            # Fallback if uv is not in PATH (common in some restricted environments)
            if shutil.which("uv") is None:
                if shutil.which("ruff"):
                    ruff_cmd = ["ruff", "check"]
                else:
                    # Last resort: try common locations or just fail gracefully
                    ruff_cmd = ["ruff", "check"]

        result = subprocess.run(
            [*ruff_cmd, str(path)],
            capture_output=True,
            cwd=str(PROJECT_ROOT),
            text=True,
            timeout=30,
        )

        return {
            "success": result.returncode == 0,
            "syntax_ok": True,
            "ruff_exit": result.returncode,
            "ruff_output": result.stdout[-1000:] if result.stdout else (result.stderr[-1000:] if result.stderr else ""),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "ruff check timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Step 4: Diff against checkpoint
# ---------------------------------------------------------------------------
def diff_against_checkpoint(file_path: str) -> str:
    """Diff current file vs most recent checkpoint. Returns unified diff."""
    try:
        path = Path(file_path).resolve()
        if not path.exists():
            return f"Error: File not found: {path}"

        if not CHECKPOINT_DIR.exists():
            return "Error: No checkpoint directory found"

        stem = path.stem
        suffix = path.suffix
        backups = sorted(
            CHECKPOINT_DIR.glob(f"{stem}_*{suffix}.bak"), reverse=True
        )

        if not backups:
            return f"Error: No checkpoint found for {path.name}"

        latest = backups[0]
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
    except Exception as e:
        return f"Error generating diff: {e}"


# ---------------------------------------------------------------------------
# Step 5: Sanitize (escape artifacts)
# ---------------------------------------------------------------------------
def sanitize(file_path: str) -> dict:
    """Run agent_sanitizer on the file. Returns result dict."""
    try:
        path = Path(file_path).resolve()
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
        return {
            "success": result.returncode == 0,
            "output": output,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Sanitizer timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------
def full_pipeline(file_path: str) -> dict:
    """
    Run the complete guardrail pipeline:
    checkpoint → lint → (diff on fail | sanitize on pass)
    """
    path = Path(file_path).resolve()
    logger.info(f"🛡️  Guardrail pipeline for: {path.name}")

    # Step 1: Checkpoint
    cp_path = checkpoint(str(path))
    if not cp_path:
        return {"success": False, "stage": "checkpoint", "message": "Failed to create checkpoint"}

    logger.info("⏸️  Checkpoint saved. Make your edits now, then run:")
    logger.info(f'   uv run python TEST/agent_guardrail.py validate "{path}"')

    return {
        "success": True,
        "stage": "checkpoint",
        "checkpoint": cp_path,
        "message": "Checkpoint created. Edit the file, then run validate.",
    }


def validate(file_path: str) -> dict:
    """
    Run post-edit validation:
    lint → (diff on fail | sanitize on pass)
    """
    path = Path(file_path).resolve()
    logger.info(f"🔍 Validating: {path.name}")

    # Step 3: Lint
    lint_result = lint_file(str(path))
    if not lint_result["success"]:
        logger.error(f"❌ Lint failed for {path.name}")
        logger.error(f"   ruff output:\n{lint_result.get('ruff_output', lint_result.get('message', ''))}")

        # Step 4: Diff for LLM context
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

    # Step 5: Sanitize
    san_result = sanitize(str(path))
    if san_result["success"]:
        logger.info(f"🧹 Sanitizer: {san_result.get('output', 'Done')}")
    else:
        logger.warning(f"⚠️  Sanitizer issue: {san_result.get('message', san_result.get('output', ''))}")

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
def main():
    if len(sys.argv) < 3:
        print(__doc__)
        print("\nCommands:")
        print("  checkpoint <file>  — Create pre-edit checkpoint")
        print("  validate <file>    — Lint + sanitize after edits")
        print("  diff <file>        — Show diff vs last checkpoint")
        print("  sanitize <file>    — Run sanitizer only")
        print("  full <file>        → checkpoint (then instruct to edit + validate)")
        sys.exit(1)

    command = sys.argv[1]
    file_path = sys.argv[2]

    match command:
        case "checkpoint":
            result = checkpoint(file_path)
            sys.exit(0 if result else 1)
        case "validate":
            result = validate(file_path)
            sys.exit(0 if result["success"] else 1)
        case "diff":
            print(diff_against_checkpoint(file_path))
        case "sanitize":
            result = sanitize(file_path)
            print(result.get("output", result.get("message", "")))
            sys.exit(0 if result["success"] else 1)
        case "full":
            result = full_pipeline(file_path)
            sys.exit(0 if result["success"] else 1)
        case _:
            print(f"Unknown command: {command}")
            sys.exit(1)


if __name__ == "__main__":
    main()
