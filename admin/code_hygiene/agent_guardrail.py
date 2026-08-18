#!/usr/bin/env python3
"""agent_guardrail.py — Post-edit checkpoint → lint → sanitize pipeline.

Workflow:
    1. checkpoint     — snapshot the file before LLM edits
    2. [LLM edits]    — (external step)
    3. sandbox-check  — reject src/ edits, enforce workspace boundaries
    3d. kill-tries    — Kill-Tries Protocol: AST nesting depth (≤3) & CC (≤5) combined gate
    4. ast-slop       — anti-slop gate (no bare except, no swallowed pass)
    5. ast-style      — Google style (no mutable defaults, no unsafe open, type hints)
    6. cc-check       — cyclomatic complexity gate (CC < 6)
    7. lint           — uv run ruff check <file>
    8. typecheck      — uv run pyright <file> (scoped to this file)
    9. dupe-check     — anti-LLM-duplication gate
    10. pydantic-check— 100% pydantic compliance gate
    11. if all pass   — run agent_sanitizer to fix escape artifacts

Usage:
    uv run python TEST/agent_guardrail.py checkpoint <file>
    uv run python TEST/agent_guardrail.py validate <file>
    uv run python TEST/agent_guardrail.py diff <file>
    uv run python TEST/agent_guardrail.py full <file>
    uv run python TEST/agent_guardrail.py cc-check <file>
    uv run python TEST/agent_guardrail.py pydantic-check <file>
    uv run python TEST/agent_guardrail.py kill-tries <file>
    uv run python TEST/agent_guardrail.py sanitize <file>
"""

import ast
import difflib
import importlib.util
import json
import logging
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

SCRIPT_DIR = Path(__file__).resolve().parent
# Gate lives at admin/code_hygiene (one level deeper than bazi's TEST/), so the
# repo root is two levels up, not one.
PROJECT_ROOT = SCRIPT_DIR.parent.parent
CLEAN_PY_DIR = PROJECT_ROOT / "tools" / "clean_py"
if str(CLEAN_PY_DIR) not in sys.path:
    sys.path.insert(0, str(CLEAN_PY_DIR))

if importlib.util.find_spec("clean_py") is not None:
    from clean_py.ast_rules import (
        check_ast_slop,
        check_duplicate_functions,
        check_pydantic_compliance,
        check_style_violations,
    )
else:
    check_ast_slop = None
    check_duplicate_functions = None
    check_pydantic_compliance = None
    check_style_violations = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("AgentGuardrail")

CHECKPOINT_DIR = PROJECT_ROOT / ".checkpoints"
SANITIZER = SCRIPT_DIR / "agent_sanitizer.py"
HARNESS_DIR = PROJECT_ROOT / "admin"
_HARNESS_SCAN_DIRS = ("code_hygiene", "studio")

CC_THRESHOLD = 6
CC_FAIL_THRESHOLD = 5  # Kill-Tries: CC must be <= 5

AST_MAX_DEPTH = 3  # Kill-Tries: nesting depth must be <= 3

# AST node types that increase nesting depth (control-flow / compound blocks)
_NESTING_NODE_TYPES = (
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.If,
    ast.IfExp,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.TryStar,
    ast.ExceptHandler,
)


PYDANTIC_BASES = frozenset({"BaseModel", "RootModel", "GenericModel", "BaseSettings"})
ALLOWED_NON_PYDANTIC_BASES = frozenset(
    {"Enum", "IntEnum", "StrEnum", "Exception", "ValueError", "TypeError", "KeyError"}
)
PYDANTIC_SUBCLASSES = frozenset({"IERResult"})
EXCEPTIONS_PATH = SCRIPT_DIR / "agent_guardrail.json"


def _parse_exception_keys(items: list[dict[str, Any]], field: str) -> set[str]:
    keys: set[str] = set()
    for e in items:
        if "file" in e and field in e:
            norm = str(e["file"]).replace("\\", "/").lstrip("./")
            keys.add(f"{norm}:{e[field]}")
    return keys


def _safe_read_and_transform(path: Path, transform: Callable[[str], Any] | None = None) -> Any:
    """Read file content and optionally apply a transform function.

    Returns None on OSError, SyntaxError, or ValueError (JSONDecodeError is
    a subclass of ValueError). Consolidates file-read error handling.
    """
    try:
        text = path.read_text(encoding="utf-8")
        if transform is not None:
            return transform(text)
        return text
    except (OSError, SyntaxError, ValueError):
        return None


def _load_exceptions() -> dict[str, set[str]]:
    if not EXCEPTIONS_PATH.exists():
        return {"pydantic": set(), "cc": set()}
    data = _safe_read_and_transform(EXCEPTIONS_PATH, json.loads)
    if data is None:
        return {"pydantic": set(), "cc": set()}
    return {
        "pydantic": _parse_exception_keys(data.get("pydantic_exceptions", []), "class"),
        "cc": _parse_exception_keys(data.get("cc_exceptions", []), "function"),
    }


_EXCEPTIONS = _load_exceptions()


def _is_pydantic_exception(file_path: str, class_name: str) -> bool:
    norm_path = file_path.replace("\\", "/").lstrip("./")
    key = f"{norm_path}:{class_name}"
    return key in _EXCEPTIONS["pydantic"]


def _is_cc_exception(file_path: str, func_name: str) -> bool:
    norm_path = file_path.replace("\\", "/").lstrip("./")
    key = f"{norm_path}:{func_name}"
    return key in _EXCEPTIONS["cc"]


class CheckResult(BaseModel):
    success: bool
    stage: str | None = None
    message: str = ""


class CCViolation(BaseModel):
    name: str
    cc: int
    line: int


class CCResult(CheckResult):
    violations: list[CCViolation] = []
    count: int = 0


class NestingViolation(BaseModel):
    name: str
    depth: int
    line: int


class KillTriesResult(CheckResult):
    nesting_violations: list[NestingViolation] = []
    cc_violations: list[CCViolation] = []
    nesting_count: int = 0
    cc_count: int = 0


class KillTriesViolation(BaseModel):
    """Detailed violation for the Kill-Tries Protocol step 3d."""
    name: str
    cc: int
    max_depth: int
    line: int


class PydanticClass(BaseModel):
    name: str
    line: int
    bases: list[str]
    decorators: list[str]


class PydanticResult(CheckResult):
    file: str = ""
    total_classes: int = 0
    non_pydantic_classes: list[PydanticClass] = []


def _resolve(path: str) -> Path:
    return Path(path).resolve()


def checkpoint(file_path: str) -> str | None:
    path = _resolve(file_path)
    if not path.exists():
        logger.error(f"File not found: {path}")
        return None
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = CHECKPOINT_DIR / f"{path.stem}_{ts}{path.suffix}.bak"
    shutil.copy2(str(path), str(backup_path))
    logger.info(f"Checkpoint created: {backup_path}")
    return str(backup_path)


def _check_sandbox_boundary(path: Path) -> CheckResult | None:
    # Divergence from baziforecaster: bazi treats src/ as read-only gold and
    # routes agent edits to TEST/. LiteRouter's src/ IS the gateway source we
    # edit, so only the outside-workspace boundary is enforced here.
    if not path.is_relative_to(PROJECT_ROOT):
        return CheckResult(
            success=False,
            stage="sandbox",
            message=f"SECURITY VIOLATION: '{path}' resolves outside workspace.",
        )
    return None


def _run_slop_gate(code: str, rel: str) -> CheckResult | None:
    if not check_ast_slop:
        return None
    errors = check_ast_slop(code, rel)
    if not errors:
        return None
    return CheckResult(success=False, stage="ast-slop", message="\n".join(errors))


def _run_style_gate(code: str, rel: str) -> CheckResult | None:
    if not check_style_violations:
        return None
    errors = check_style_violations(code, rel)
    if not errors:
        return None
    return CheckResult(success=False, stage="ast-style", message="\n".join(errors))


def _check_ast_slop_and_style(path: Path) -> CheckResult | None:
    if path.suffix != ".py":
        return None
    code = _safe_read_and_transform(path)
    if code is None:
        return CheckResult(success=False, stage="ast-read", message="Failed to read file")

    rel = str(path.relative_to(PROJECT_ROOT))
    slop_res = _run_slop_gate(code, rel)
    if slop_res is not None:
        return slop_res
    return _run_style_gate(code, rel)


def _ruff_cmd() -> list[str]:
    venv_ruff = PROJECT_ROOT / ".venv" / "bin" / "ruff"
    if venv_ruff.exists():
        return [str(venv_ruff), "check"]
    if shutil.which("uv"):
        return ["uv", "run", "ruff", "check"]
    return ["ruff", "check"]


def _run_ruff(path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [*_ruff_cmd(), str(path)],
        capture_output=True,
        cwd=str(PROJECT_ROOT),
        text=True,
        timeout=30,
    )


def _syntax_ok(path: Path) -> bool:
    return path.suffix == ".py"


def _lint_result(path: Path) -> CheckResult:
    result = _run_ruff(path)
    if result.returncode == 0:
        return CheckResult(success=True, message="Ruff check passed.")
    output = result.stdout[-1000:] if result.stdout else (result.stderr[-1000:] if result.stderr else "")
    return CheckResult(success=False, stage="lint", message=f"Ruff failed:\n{output}")


def _lint_precheck(path: Path) -> CheckResult | None:
    if not path.exists():
        return CheckResult(success=False, message=f"File not found: {path}")
    if path.suffix != ".py":
        return CheckResult(success=True, message="Skipped ruff check for non-Python file.")
    return None


def lint_file(file_path: str) -> CheckResult:
    path = _resolve(file_path)
    pre = _lint_precheck(path)
    if pre is not None:
        return pre
    if not _syntax_ok(path):
        return CheckResult(success=False, message="Syntax error in file.")
    return _lint_result(path)


def _pyright_errors(path: Path, output: str) -> list[str]:
    fname = path.name
    return [ln for ln in output.splitlines() if fname in ln and "error" in ln.lower()]


def _typecheck_run(path: Path) -> subprocess.CompletedProcess | None:
    if shutil.which("uv") is None and shutil.which("pyright") is None:
        return None
    cmd = ["uv", "run", "pyright", str(path)] if shutil.which("uv") else ["pyright", str(path)]
    return subprocess.run(
        cmd,
        capture_output=True,
        cwd=str(PROJECT_ROOT),
        text=True,
        timeout=180,
    )


def _typecheck_result(path: Path, result: subprocess.CompletedProcess) -> CheckResult:
    output = (result.stdout or "") + (result.stderr or "")
    errors = _pyright_errors(path, output)
    if errors:
        return CheckResult(
            success=False,
            stage="typecheck",
            message=f"Pyright errors in {path.name}:\n" + "\n".join(errors),
        )
    return CheckResult(success=True, message="No type errors in this file.")


def _typecheck_precheck(path: Path) -> CheckResult | None:
    if not path.exists():
        return CheckResult(success=True, message=f"File not found: {path} (skipped)")
    if path.suffix != ".py":
        return CheckResult(success=True, message="Skipped type check for non-Python file.")
    return None


def typecheck_file(file_path: str) -> CheckResult:
    path = _resolve(file_path)
    pre = _typecheck_precheck(path)
    if pre is not None:
        return pre
    result = _typecheck_run(path)
    if result is None:
        return CheckResult(success=True, message="pyright not installed; skipped.")
    return _typecheck_result(path, result)


def _get_base_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return _get_subscript_base(node)


def _get_subscript_base(node: ast.AST) -> str:
    if isinstance(node, ast.Subscript):
        return _get_base_name(node.value)
    return ""


def _has_pydantic_base(base_names: list[str]) -> bool:
    return bool(set(base_names) & PYDANTIC_BASES)


def _has_allowed_base(base_names: list[str]) -> bool:
    return bool(set(base_names) & ALLOWED_NON_PYDANTIC_BASES)


def _has_pydantic_subclass(base_names: list[str]) -> bool:
    return bool(set(base_names) & PYDANTIC_SUBCLASSES)


def _class_is_pydantic(node: ast.ClassDef) -> bool:
    base_names = [_get_base_name(b) for b in node.bases]
    return _has_pydantic_base(base_names) or _has_allowed_base(base_names) or _has_pydantic_subclass(base_names)


def _decorator_name(dec: ast.AST) -> str | None:
    if isinstance(dec, ast.Name):
        return dec.id
    if isinstance(dec, ast.Attribute):
        return f"{_get_base_name(dec.value)}.{dec.attr}"
    if isinstance(dec, ast.Call):
        return _decorator_name(dec.func)
    return None


def _get_decorator_names(decorator_list: Sequence[ast.AST]) -> list[str]:
    return [n for d in decorator_list if (n := _decorator_name(d)) is not None]


def _is_pydantic_dataclass(decorator_names: list[str]) -> bool:
    return any(
        d in {"pydantic.dataclass", "pydantic.dataclasses.dataclass"}
        for d in decorator_names
    )


def _inspect_class(node: ast.ClassDef, known_bases: set[str]) -> PydanticClass | None:
    decorator_names = _get_decorator_names(node.decorator_list)
    base_names = [_get_base_name(b) for b in node.bases]
    is_compliant = (
        bool(set(base_names) & known_bases)
        or _is_pydantic_dataclass(decorator_names)
        or _has_allowed_base(base_names)
    )
    if is_compliant:
        known_bases.add(node.name)
        return None
    return PydanticClass(
        name=node.name,
        line=node.lineno,
        bases=base_names,
        decorators=decorator_names,
    )


def _scan_pydantic(tree: ast.Module) -> tuple[int, list[PydanticClass]]:
    total = 0
    non_pydantic: list[PydanticClass] = []
    known_bases: set[str] = set(PYDANTIC_BASES) | set(PYDANTIC_SUBCLASSES)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            total += 1
            pydantic_class = _inspect_class(node, known_bases)
            if pydantic_class is not None:
                non_pydantic.append(pydantic_class)
    return total, non_pydantic


def _filter_pydantic_exceptions(
    classes: list[PydanticClass], rel_path: str
) -> list[PydanticClass]:
    return [pc for pc in classes if not _is_pydantic_exception(rel_path, pc.name)]


def _pydantic_scan(path: Path) -> PydanticResult:
    if not path.exists() or not path.is_file():
        return PydanticResult(success=False, file=str(path), message=f"File not found: {path}")
    tree = _parse_file(path)
    if tree is None:
        return PydanticResult(success=False, file=str(path), message="Parse error in file.")
    total, raw_non_pydantic = _scan_pydantic(tree)
    rel = str(path.relative_to(PROJECT_ROOT))
    non_pydantic = _filter_pydantic_exceptions(raw_non_pydantic, rel)
    ok = len(non_pydantic) == 0
    msg = "100% Pydantic compliant." if ok else f"{len(non_pydantic)} non-Pydantic class(es) found."
    return PydanticResult(
        success=ok,
        file=str(path),
        total_classes=total,
        non_pydantic_classes=non_pydantic,
        message=msg,
    )


def pydantic_check(file_path: str) -> PydanticResult:
    path = _resolve(file_path)
    if not path.exists():
        return PydanticResult(success=False, file=file_path, message=f"File not found: {path}")
    return _pydantic_scan(path)


def _get_cc_violations(source: str) -> list[CCViolation]:
    from radon.complexity import cc_visit
    results = cc_visit(source)
    return [
        CCViolation(name=v.name, cc=v.complexity, line=v.lineno)
        for v in results
        if v.complexity >= CC_THRESHOLD
    ]


def _format_violations(violations: list[CCViolation]) -> str:
    lines = [f"  CC {v.cc} `{v.name}` line {v.line}" for v in violations]
    return "\n".join(lines)


def _cc_message(violations: list[CCViolation]) -> str:
    count = len(violations)
    return (
        f"CC check failed — {count} function(s) with CC >= {CC_THRESHOLD}.\n"
        + _format_violations(violations)
    )


def _cc_precheck(path: Path) -> CCResult | None:
    result = _cc_precheck_guard(path)
    if result is not None:
        return result
    tree = _parse_file(path)
    if tree is None:
        return CCResult(success=False, message="Syntax error in file.")
    return None


def _cc_precheck_guard(path: Path) -> CCResult | None:
    if not path.exists():
        return CCResult(success=False, message=f"File not found: {path}")
    if not _radon_available():
        return CCResult(success=True, message="radon not available; skipping CC check.")
    return None


def check_cc(file_path: str) -> CCResult:
    path = _resolve(file_path)
    pre = _cc_precheck(path)
    if pre is not None:
        return pre
    source = path.read_text(encoding="utf-8")
    violations = _get_cc_violations(source)
    rel = str(path.relative_to(PROJECT_ROOT))
    violations = [
        v for v in violations
        if not _is_cc_exception(rel, v.name)
    ]
    violations.sort(key=lambda v: v.cc, reverse=True)
    if violations:
        return CCResult(
            success=False,
            stage="cc-check",
            count=len(violations),
            violations=violations,
            message=_cc_message(violations),
        )
    return CCResult(success=True, message=f"All functions have CC < {CC_THRESHOLD}.")


def _radon_available() -> bool:
    return importlib.util.find_spec("radon") is not None


# ──────────────────────────────────────────────────────────────────────
# Step 3d — Kill-Tries Protocol: AST nesting depth (≤3) & CC (≤5)
# ──────────────────────────────────────────────────────────────────────


def _max_nesting_depth(
    tree: ast.AST, node_types: tuple[type, ...]) -> tuple[int, ast.AST | None]:
    """Return (max_depth, deepest_node) via DFS tracking current depth."""
    max_depth = 0
    deepest: ast.AST | None = None

    def _walk(node: ast.AST, depth: int) -> None:
        nonlocal max_depth, deepest
        if isinstance(node, node_types):
            depth += 1
        if depth > max_depth:
            max_depth = depth
            deepest = node
        for child in ast.iter_child_nodes(node):
            _walk(child, depth)

    _walk(tree, 0)
    return max_depth, deepest


def _get_func_name(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return node.name
    if isinstance(node, ast.ClassDef):
        return node.name
    return "<expr>"


def _check_nesting_depth(tree: ast.Module) -> list[NestingViolation]:
    violations: list[NestingViolation] = []
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        max_depth, _ = _max_nesting_depth(node, _NESTING_NODE_TYPES)
        if max_depth > AST_MAX_DEPTH:
            violations.append(
                NestingViolation(
                    name=node.name,
                    depth=max_depth,
                    line=node.lineno,
                )
            )
    return violations


def _check_kill_tries_cc(source: str) -> list[CCViolation]:
    """CC violations for the Kill-Tries Protocol: CC must be <= 5."""
    from radon.complexity import cc_visit

    if not importlib.util.find_spec("radon"):
        return []
    results = cc_visit(source)
    return [
        CCViolation(name=v.name, cc=v.complexity, line=v.lineno)
        for v in results
        if v.complexity > CC_FAIL_THRESHOLD
    ]


def _kt_precheck(path: Path) -> KillTriesResult | None:
    result = KillTriesResult(success=False, stage="kill-tries")
    if not path.exists():
        result.message = f"File not found: {path}"
        return result
    if path.suffix != ".py":
        result.success = True
        result.message = "Skipped kill-tries for non-Python file."
        return result
    tree = _parse_file(path)
    if tree is None:
        result.message = "Syntax error in file."
        return result
    return None


def _kt_format_violations(
    nesting: list[NestingViolation], cc_v: list[CCViolation]
) -> CheckResult:
    parts: list[str] = []
    if nesting:
        parts.append(
            f"{len(nesting)} function(s) exceed nesting depth > {AST_MAX_DEPTH}:"
        )
        parts.extend(
            f"  depth {v.depth} `{v.name}` line {v.line}" for v in nesting
        )
    if cc_v:
        parts.append(
            f"{len(cc_v)} function(s) exceed CC > {CC_FAIL_THRESHOLD}:"
        )
        parts.extend(
            f"  CC {v.cc} `{v.name}` line {v.line}" for v in cc_v
        )
    return CheckResult(success=False, message="\n".join(parts))


def kill_tries_check(file_path: str) -> KillTriesResult:
    """Step 3d: Kill-Tries Protocol — combined nesting depth & CC gate.

    Fails fast when:
      • Any function exceeds AST nesting depth (>3)
      • Any function exceeds CC threshold (>5)
    """
    path = _resolve(file_path)
    pre = _kt_precheck(path)
    if pre is not None:
        return pre

    source = path.read_text(encoding="utf-8")
    tree = _parse_file(path)
    assert tree is not None  # _kt_precheck already checked syntax
    nesting_violations = _check_nesting_depth(tree)
    cc_violations = _check_kill_tries_cc(source)

    result = KillTriesResult(success=False, stage="kill-tries")
    result.nesting_violations = nesting_violations
    result.cc_violations = cc_violations
    result.nesting_count = len(nesting_violations)
    result.cc_count = len(cc_violations)

    if nesting_violations or cc_violations:
        fail = _kt_format_violations(nesting_violations, cc_violations)
        return KillTriesResult(
            success=False,
            stage="kill-tries",
            nesting_violations=nesting_violations,
            cc_violations=cc_violations,
            nesting_count=len(nesting_violations),
            cc_count=len(cc_violations),
            message=fail.message,
        )
    result.success = True
    result.message = (
        f"Kill-Tries passed — nesting depth ≤ {AST_MAX_DEPTH} "
        f"and CC ≤ {CC_FAIL_THRESHOLD} verified."
    )
    return result


def _latest_backup(path: Path) -> Path | None:
    if not CHECKPOINT_DIR.exists():
        return None
    backups = sorted(CHECKPOINT_DIR.glob(f"{path.stem}_*{path.suffix}.bak"), reverse=True)
    return backups[0] if backups else None


def diff_against_checkpoint(file_path: str) -> str:
    path = _resolve(file_path)
    if not path.exists():
        return f"Error: File not found: {path}"
    latest = _latest_backup(path)
    if latest is None:
        return "Error: No checkpoint found"
    old = latest.read_text(encoding="utf-8").splitlines(keepends=True)
    new = path.read_text(encoding="utf-8").splitlines(keepends=True)
    diff = difflib.unified_diff(
        old,
        new,
        fromfile=f"checkpoint/{latest.name}",
        tofile=f"current/{path.name}",
        lineterm="",
    )
    text = "\n".join(diff)
    return text if text else "No changes detected."


def _index_harness_dir(sub: str) -> dict[str, set[str]]:
    d = HARNESS_DIR / sub
    if not d.is_dir():
        return {}
    result: dict[str, set[str]] = {}
    for p in sorted(d.glob("*.py")):
        _add_harness_file(p, result)
    return result


def _add_harness_file(p: Path, result: dict[str, set[str]]) -> None:
    tree = _parse_file(p)
    if tree is not None:
        result[str(p)] = _module_level_funcs(tree)


def _harness_names() -> dict[str, set[str]]:
    index: dict[str, set[str]] = {}
    for sub in _HARNESS_SCAN_DIRS:
        index.update(_index_harness_dir(sub))
    return index


def _parse_file(path: Path) -> ast.Module | None:
    if not path.exists():
        return None
    return _safe_read_and_transform(path, ast.parse)


def _module_level_funcs(tree: ast.Module) -> set[str]:
    return {
        n.name
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        and getattr(n, "col_offset", 0) == 0
    }


def _module_level_defs(file_path: str) -> list[str]:
    tree = _parse_file(Path(file_path))
    if tree is None:
        return []
    return sorted(_module_level_funcs(tree))


def _latest_checkpoint(file_path: str) -> str | None:
    path = Path(file_path)
    if not CHECKPOINT_DIR.exists():
        return None
    backups = sorted(CHECKPOINT_DIR.glob(f"{path.stem}_*{path.suffix}.bak"), reverse=True)
    return str(backups[0]) if backups else None


def _find_new_dups(edited: set[str], before: set[str], existing: set[str]) -> set[str]:
    return {n for n in edited - before if n in existing}


def _find_within_dups(edited_list: list[str]) -> set[str]:
    seen: dict[str, int] = {}
    for n in edited_list:
        seen[n] = seen.get(n, 0) + 1
    return {n for n, c in seen.items() if c > 1}


def _collect_dups(
    edited_list: list[str], checkpoint_path: str | None, existing: set[str]
) -> tuple[set[str], set[str]]:
    edited = set(edited_list)
    within = _find_within_dups(edited_list)
    new_dups: set[str] = set()
    if checkpoint_path:
        before = set(_module_level_defs(checkpoint_path))
        new_dups = _find_new_dups(edited, before, existing)
    return new_dups, within


def _build_existing(index: dict[str, set[str]], target: Path) -> set[str]:
    existing: set[str] = set()
    for fpath, names in index.items():
        if Path(fpath).resolve() == target:
            continue
        existing |= names
    return existing


def _dup_message(new_dups: set[str], within: set[str]) -> str:
    parts: list[str] = []
    if new_dups:
        parts.append(
            "NEW duplicate — import canonical from admin.orchestrator.common: "
            + ", ".join(sorted(new_dups))
        )
    if within:
        parts.append("defined more than once in this file: " + ", ".join(sorted(within)))
    return "; ".join(parts)


def detect_duplicate_functions(file_path: str, checkpoint_path: str | None = None) -> CheckResult:
    target = _resolve(file_path)
    index = _harness_names()
    existing = _build_existing(index, target)
    edited_list = _module_level_defs(str(target))
    new_dups, within = _collect_dups(edited_list, checkpoint_path, existing)
    if not within and not new_dups:
        return CheckResult(success=True, message="No duplicate function definitions.")
    return CheckResult(success=False, stage="dup-check", message=_dup_message(new_dups, within))


def sanitize(file_path: str) -> CheckResult:
    path = _resolve(file_path)
    if not path.exists():
        return CheckResult(success=False, message=f"File not found: {path}")
    try:
        result = subprocess.run(
            [sys.executable, str(SANITIZER), str(path)],
            capture_output=True,
            cwd=str(PROJECT_ROOT),
            text=True,
            timeout=15,
        )
        output = result.stdout.strip()
        return CheckResult(success=result.returncode == 0, message=output)
    except subprocess.TimeoutExpired:
        return CheckResult(success=False, message="Sanitizer timed out")
    except Exception as e:
        return CheckResult(success=False, message=str(e))


def full_pipeline(file_path: str) -> CheckResult:
    path = _resolve(file_path)
    logger.info(f"Guardrail pipeline for: {path.name}")
    cp_path = checkpoint(str(path))
    if not cp_path:
        return CheckResult(success=False, stage="checkpoint", message="Failed to create checkpoint")
    logger.info("Checkpoint saved. Validating...")
    return validate(str(path))


def _run_cc_check(path: Path) -> CheckResult:
    cc_result = check_cc(str(path))
    if not cc_result.success:
        logger.error(f"CC check failed for {path.name}: {cc_result.message}")
    return cc_result


def _run_lint_check(path: Path) -> CheckResult:
    lint_result = lint_file(str(path))
    if not lint_result.success:
        logger.error(f"Lint failed for {path.name}: {lint_result.message}")
        diff_text = diff_against_checkpoint(str(path))
        logger.info(f"Diff for LLM context:\n{diff_text}")
    return lint_result


def _run_typecheck(path: Path) -> CheckResult:
    tc_result = typecheck_file(str(path))
    if not tc_result.success:
        logger.error(f"Type check failed for {path.name}: {tc_result.message}")
    return tc_result


def _run_dup_check(path: Path, dup_cp: str | None) -> CheckResult:
    dup_result = detect_duplicate_functions(str(path), dup_cp)
    if not dup_result.success:
        logger.error(f"Duplicate check failed for {path.name}: {dup_result.message}")
    return dup_result


def _run_pydantic_check(path: Path) -> CheckResult:
    pydantic_result = pydantic_check(str(path))
    if not pydantic_result.success:
        logger.error(f"Pydantic check failed for {path.name}: {pydantic_result.message}")
    return pydantic_result


def _run_sanitize(path: Path) -> None:
    san_result = sanitize(str(path))
    if san_result.success:
        logger.info(f"Sanitizer: {san_result.message}")
    else:
        logger.warning(f"Sanitizer issue: {san_result.message}")


def _check_or_fail(
    result: CheckResult, stage: str, pass_msg: str, path: Path
) -> CheckResult | None:
    if not result.success:
        return CheckResult(success=False, stage=stage, message=result.message)
    logger.info(f"{pass_msg} for {path.name}")
    return None


def _run_gate_stages(path: Path) -> CheckResult | None:
    checks = [
        (_run_cc_check(path), "cc-check", "CC check passed"),
        (_run_lint_check(path), "lint", "Lint passed"),
        (_run_typecheck(path), "typecheck", "Type check passed"),
        (_run_dup_check(path, _latest_checkpoint(str(path))), "dup-check", "Duplicate check passed"),
    ]
    for result, stage, msg in checks:
        failed = _check_or_fail(result, stage, msg, path)
        if failed is not None:
            return failed
    return None


def _kill_tries_gate(path: Path) -> CheckResult | None:
    """Step 3d: Kill-Tries Protocol — fail-fast nesting depth & CC combined check."""
    if path.suffix != ".py":
        return None
    kt_result = kill_tries_check(str(path))
    if not kt_result.success:
        logger.error(f"Kill-Tries Protocol failed for {path.name}: {kt_result.message}")
        return CheckResult(
            success=False,
            stage="kill-tries",
            message=kt_result.message,
        )
    logger.info(f"Kill-Tries Protocol passed for {path.name}")
    return None


def _fail_if(
    result: CheckResult | None, stage: str
) -> CheckResult | None:
    """Return the result if it failed (success=False), else None."""
    if result is not None and not result.success:
        return CheckResult(success=False, stage=stage, message=result.message)
    return None


def _ts_cli_path() -> Path | None:
    """Locate the clean_ts CLI, or None if it is absent."""
    clean_ts = PROJECT_ROOT / "node_modules" / "clean_ts" / "dist" / "cli.js"
    return clean_ts if clean_ts.exists() else None


def _ts_failure(path: Path, message: str) -> CheckResult:
    logger.error(f"TypeScript check failed for {path.name}: {message}")
    return CheckResult(success=False, stage="ts-check", message=message)


def _ts_ok(path: Path) -> None:
    logger.info(f"TypeScript check passed for {path.name}")


def _run_clean_ts(path: Path) -> subprocess.CompletedProcess:
    """Invoke the clean_ts CLI on a file and return the completed process."""
    cli = _ts_cli_path()
    if cli is None:
        return subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="clean_ts CLI not found"
        )
    return subprocess.run(
        ["node", str(cli), "validate", str(path)],
        capture_output=True,
        cwd=str(PROJECT_ROOT),
        text=True,
        timeout=120,
    )


def _ts_parse_output(output: str) -> dict[str, Any] | None:
    """Parse clean_ts JSON output, or None if it is not valid JSON."""
    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _ts_non_json_result(path: Path, result: subprocess.CompletedProcess) -> CheckResult | None:
    """Handle a clean_ts run whose stdout was not valid JSON."""
    output = (result.stdout or "").strip()
    if result.returncode == 0:
        _ts_ok(path)
        return None
    return _ts_failure(path, f"clean_ts failed:\n{output[-1000:]}")

def _ts_json_result(path: Path, data: dict[str, Any]) -> CheckResult | None:
    """Handle a clean_ts run whose stdout parsed as JSON."""
    if data.get("valid"):
        _ts_ok(path)
        return None
    errs = data.get("errors") or []
    return _ts_failure(path, "clean_ts rejected:\n" + "\n".join(str(e) for e in errs))

def _ts_parse_result(path: Path, result: subprocess.CompletedProcess) -> CheckResult | None:
    """Interpret a clean_ts run: None on success, CheckResult on failure."""
    output = (result.stdout or "").strip()
    data = _ts_parse_output(output)
    if data is None:
        return _ts_non_json_result(path, result)
    return _ts_json_result(path, data)


def _run_ts_check(path: Path) -> CheckResult | None:
    """Delegate .ts/.tsx validation to clean_ts (tsc strict + AST anti-slop).

    Divergence from baziforecaster: bazi's pipeline is Python-only, so TS
    files fell through to a hard "Syntax error" failure. LiteRouter's gateway
    is TypeScript, so route it to clean_ts instead.
    """
    if path.suffix not in {".ts", ".tsx"}:
        return None
    return _ts_parse_result(path, _run_clean_ts(path))


def _first_failure(gates: list[tuple[CheckResult | None, str]]) -> CheckResult | None:
    """Return the first failed gate result, or None if every gate passed."""
    for result, stage in gates:
        if result is not None and not result.success:
            return CheckResult(success=False, stage=stage, message=result.message)
    return None


def _run_checks(path: Path) -> CheckResult | None:
    # TypeScript files are validated by clean_ts and skip the Python-only
    # stages (CC/pydantic/kill-tries) which would hard-fail on TS syntax.
    if path.suffix in {".ts", ".tsx"}:
        return _run_ts_check(path)
    pre_fail = _check_sandbox_boundary(path)
    style_fail = _check_ast_slop_and_style(path)
    kt_fail = _kill_tries_gate(path)
    failed = _first_failure(
        [
            (pre_fail, "sandbox"),
            (style_fail, "ast-style"),
            (kt_fail, "kill-tries"),
        ]
    )
    if failed is not None:
        return failed
    return _run_gate_stages(path) or _run_pydantic_and_sanitize(path)


def _run_pydantic_and_sanitize(path: Path) -> CheckResult | None:
    pydantic_result = _run_pydantic_check(path)
    if not pydantic_result.success:
        return CheckResult(success=False, stage="pydantic-check", message=pydantic_result.message)
    logger.info(f"Pydantic check passed for {path.name}")

    _run_sanitize(path)
    return None


def validate(file_path: str) -> CheckResult:
    path = _resolve(file_path)
    logger.info(f"Validating: {path.name}")

    failed = _run_checks(path)
    if failed is not None:
        return failed

    return CheckResult(success=True, stage="complete", message="All checks passed.")


def _check_result_exit(result: CheckResult) -> int:
    return 0 if result.success else 1


def _result_to_exit(result: CheckResult | int | str | None) -> int:
    if isinstance(result, CheckResult):
        return _check_result_exit(result)
    if isinstance(result, str | None):
        return 0 if result else 1
    return 0 if result else 1


def _dispatch(command: str, file_path: str) -> int:
    return _result_to_exit(_handle_command(command, file_path))


def _cmd_sanitize(file_path: str) -> int:
    result = sanitize(file_path)
    print(result.message)
    return 0 if result.success else 1


def _cmd_cc_check(file_path: str) -> int:
    result = check_cc(file_path)
    print(result.message)
    return 0 if result.success else 1


def _cmd_pydantic_check(file_path: str) -> int:
    result = pydantic_check(file_path)
    print(result.message)
    return 0 if result.success else 1


def _cmd_kill_tries(file_path: str) -> int:
    result = kill_tries_check(file_path)
    print(result.message)
    return 0 if result.success else 1


def _cmd_checkpoint(file_path: str) -> str | None:
    return checkpoint(file_path)


def _cmd_validate(file_path: str) -> CheckResult:
    return validate(file_path)


def _cmd_diff(file_path: str) -> int:
    print(diff_against_checkpoint(file_path))
    return 0


def _handle_command(command: str, file_path: str) -> CheckResult | int | str | None:
    handlers: dict[str, Callable[[str], CheckResult | int | str | None]] = {
        "checkpoint": _cmd_checkpoint,
        "validate": _cmd_validate,
        "diff": _cmd_diff,
        "sanitize": _cmd_sanitize,
        "cc-check": _cmd_cc_check,
        "pydantic-check": _cmd_pydantic_check,
        "kill-tries": _cmd_kill_tries,
        "full": full_pipeline,
    }
    handler = handlers.get(command)
    if handler is None:
        print(f"Unknown command: {command}")
        return None
    return handler(file_path)


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        print("\nCommands:")
        print("  checkpoint <file>  — Create pre-edit checkpoint")
        print("  validate <file>    — Run all checks")
        print("  diff <file>        — Show diff vs last checkpoint")
        print("  sanitize <file>    — Run sanitizer only")
        print("  cc-check <file>    — Check CC only")
        print("  pydantic-check <file> — Check pydantic compliance only")
        print("  kill-tries <file>     — Kill-Tries Protocol: nesting depth & CC combined check")
        print("  full <file>        — Checkpoint then validate")
        sys.exit(1)
    sys.exit(_dispatch(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
