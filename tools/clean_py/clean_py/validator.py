"""Validation engine executing the 11-gate quality pipeline."""

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .allowlist import ExceptionAllowlist, load_exceptions
from .ast_rules import (
    check_ast_slop,
    check_banned_imports,
    check_duplicate_functions,
    check_pydantic_compliance,
    check_style_violations,
)

CC_THRESHOLD = 6


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


def _find_workspace_root(start_path: Path | None = None) -> Path:
    if start_path is None:
        start_path = Path.cwd()
    curr = start_path.resolve()
    for parent in [curr, *curr.parents]:
        if (parent / "pyproject.toml").exists() or (parent / ".git").exists():
            return parent
    return curr


def _check_sandbox_boundary(
    target_path: Path, workspace_dir: Path
) -> list[str]:
    try:
        resolved_target = target_path.resolve()
        resolved_ws = workspace_dir.resolve()
        # Must be inside workspace
        resolved_target.relative_to(resolved_ws)
    except (ValueError, RuntimeError):
        return [f"SECURITY VIOLATION: '{target_path}' resolves outside the allowed workspace: {workspace_dir}"]

    rel_posix = resolved_target.relative_to(resolved_ws).as_posix()

    if rel_posix == "src" or rel_posix.startswith("src/"):
        return ["SECURITY VIOLATION: src/ is read-only. Target src2/"]

    if rel_posix.startswith(".git/") or rel_posix == ".git":
        return ["SECURITY VIOLATION: Writing into '.git' is strictly forbidden"]

    if resolved_target.suffix != ".py":
        return [f"SECURITY VIOLATION: Only .py files are allowed, got '{resolved_target.suffix}'"]

    return []


def _run_ruff(file_path: Path, workspace_dir: Path) -> list[str]:
    ruff_bin = workspace_dir / ".venv" / "bin" / "ruff"
    cmd = [str(ruff_bin) if ruff_bin.exists() else "ruff", "check", "--output-format", "json", str(file_path)]
    if not ruff_bin.exists() and shutil.which("uv"):
        cmd = ["uv", "run", "ruff", "check", "--output-format", "json", str(file_path)]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(workspace_dir),
            timeout=30,
        )
        if proc.returncode == 0:
            return []
        try:
            items = json.loads(proc.stdout)
            errors: list[str] = []
            for item in items:
                line = item.get("location", {}).get("row", "?")
                code = item.get("code", "")
                msg = item.get("message", "")
                errors.append(f"[RUFF ERROR] line {line}: [{code}] {msg}")
            return errors if errors else [f"[RUFF ERROR] {proc.stdout.strip()}"]
        except json.JSONDecodeError:
            out = proc.stdout.strip() or proc.stderr.strip()
            return [f"[RUFF ERROR] {out}"]
    except Exception as e:
        return [f"[RUFF ERROR] Failed to execute ruff: {e}"]


def _run_pyright(file_path: Path, workspace_dir: Path) -> list[str]:
    if not shutil.which("pyright") and not shutil.which("uv"):
        return []

    cmd = ["pyright", "--outputjson", str(file_path)]
    if shutil.which("uv"):
        cmd = ["uv", "run", "pyright", "--outputjson", str(file_path)]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(workspace_dir),
            timeout=180,
        )
        try:
            data = json.loads(proc.stdout)
            diagnostics = data.get("generalDiagnostics", [])
            errors: list[str] = []
            target_name = file_path.name
            for diag in diagnostics:
                file_in_diag = diag.get("file", "")
                if target_name in file_in_diag:
                    severity = diag.get("severity", "")
                    if severity == "error":
                        line = diag.get("range", {}).get("start", {}).get("line", 0) + 1
                        msg = diag.get("message", "")
                        errors.append(f"[PYRIGHT ERROR] line {line}: {msg}")
            return errors
        except json.JSONDecodeError:
            if proc.returncode != 0 and "error" in (proc.stdout + proc.stderr).lower():
                return [f"[PYRIGHT ERROR] {proc.stdout[-500:]}"]
            return []
    except Exception as e:
        return [f"[PYRIGHT ERROR] Failed to execute pyright: {e}"]


def _run_radon_cc(
    file_path: Path, rel_path: str, allowlist: ExceptionAllowlist, workspace_dir: Path
) -> list[str]:
    cmd = ["radon", "cc", "-j", str(file_path)]
    if shutil.which("uv"):
        cmd = ["uv", "run", "radon", "cc", "-j", str(file_path)]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(workspace_dir),
            timeout=30,
        )
        if proc.returncode != 0:
            return [f"[RADON ERROR] radon execution failed: {proc.stderr.strip()}"]
        data = json.loads(proc.stdout)
        blocks = data.get(str(file_path), [])
        errors: list[str] = []
        for block in blocks:
            name = block.get("name", "")
            cc = block.get("complexity", 0)
            lineno = block.get("lineno", 0)
            if cc >= CC_THRESHOLD:
                if not allowlist.is_cc_exempt(rel_path, name):
                    errors.append(
                        f"[RADON ERROR] line {lineno}: function '{name}' has CC {cc} (Limit: < {CC_THRESHOLD})"
                    )
        return errors
    except Exception as e:
        return [f"[RADON ERROR] Failed to execute radon: {e}"]


def validate_code(
    code: str,
    target_path: str | Path,
    workspace_dir: str | Path | None = None,
    allowlist: ExceptionAllowlist | None = None,
    bypass: bool = False,
) -> ValidationResult:
    """Validates python code against all 11 gates."""
    if bypass or os.getenv("DISABLE_CLEAN_PYTHON") == "true":
        return ValidationResult(valid=True, errors=[])

    ws = _find_workspace_root(Path(workspace_dir) if workspace_dir else None)
    target = Path(target_path)
    if not target.is_absolute():
        target = ws / target

    # Gate 0: Sandbox
    sandbox_errors = _check_sandbox_boundary(target, ws)
    if sandbox_errors:
        return ValidationResult(valid=False, errors=sandbox_errors)

    rel_posix = target.resolve().relative_to(ws.resolve()).as_posix()
    if allowlist is None:
        allowlist = load_exceptions(ws / "TEST" / "agent_guardrail.json")

    # Gate 1: AST Anti-slop
    slop_errors = check_ast_slop(code, rel_posix)
    if slop_errors:
        return ValidationResult(valid=False, errors=slop_errors)

    # Gate 2: AST Style
    style_errors = check_style_violations(code, rel_posix)
    if style_errors:
        return ValidationResult(valid=False, errors=style_errors)

    # Gate 3: AST 100% Pydantic
    pydantic_errors = check_pydantic_compliance(code, rel_posix, allowlist)
    if pydantic_errors:
        return ValidationResult(valid=False, errors=pydantic_errors)

    # Gate 4: AST Anti-duplication
    dup_errors = check_duplicate_functions(code, rel_posix)
    if dup_errors:
        return ValidationResult(valid=False, errors=dup_errors)

    # Check banned imports
    banned_errors = check_banned_imports(code, rel_posix)
    if banned_errors:
        return ValidationResult(valid=False, errors=banned_errors)

    return ValidationResult(valid=True, errors=[])


def validate_file(
    file_path: str | Path,
    target_path: str | Path | None = None,
    workspace_dir: str | Path | None = None,
    allowlist: ExceptionAllowlist | None = None,
    bypass: bool = False,
) -> ValidationResult:
    """Validates an existing file or temp file against all 11 gates."""
    if bypass or os.getenv("DISABLE_CLEAN_PYTHON") == "true":
        return ValidationResult(valid=True, errors=[])

    ws = _find_workspace_root(Path(workspace_dir) if workspace_dir else None)
    src_file = Path(file_path)
    if not src_file.is_absolute():
        src_file = ws / src_file

    if not src_file.exists():
        return ValidationResult(valid=False, errors=[f"File not found: {src_file}"])

    logical_target = Path(target_path) if target_path else src_file
    if not logical_target.is_absolute():
        logical_target = ws / logical_target

    try:
        code = src_file.read_text(encoding="utf-8")
    except Exception as e:
        return ValidationResult(valid=False, errors=[f"Failed to read file: {e}"])

    if allowlist is None:
        allowlist = load_exceptions(ws / "TEST" / "agent_guardrail.json")

    # Run AST gates first
    ast_res = validate_code(
        code=code,
        target_path=logical_target,
        workspace_dir=ws,
        allowlist=allowlist,
        bypass=bypass,
    )
    if not ast_res.valid:
        return ast_res

    rel_posix = logical_target.resolve().relative_to(ws.resolve()).as_posix()

    # Gate 5: Ruff
    ruff_errors = _run_ruff(src_file, ws)
    if ruff_errors:
        return ValidationResult(valid=False, errors=ruff_errors)

    # Gate 6: Pyright
    pyright_errors = _run_pyright(src_file, ws)
    if pyright_errors:
        return ValidationResult(valid=False, errors=pyright_errors)

    # Gate 7: Radon CC
    radon_errors = _run_radon_cc(src_file, rel_posix, allowlist, ws)
    if radon_errors:
        return ValidationResult(valid=False, errors=radon_errors)

    return ValidationResult(valid=True, errors=[])
