"""AST-based quality rules: Anti-slop, Google style, 100% Pydantic, and Anti-duplication."""

import ast
from collections import defaultdict

from .allowlist import ExceptionAllowlist

PYDANTIC_BASES = frozenset({"BaseModel", "RootModel", "GenericModel", "BaseSettings"})
ALLOWED_NON_PYDANTIC_BASES = frozenset(
    {"Enum", "IntEnum", "StrEnum", "Exception", "ValueError", "TypeError", "KeyError"}
)
PYDANTIC_SUBCLASSES = frozenset({"IERResult"})
FLAG_FILES_WITHOUT_CLASSES = False


class SlopVisitor(ast.NodeVisitor):
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.errors: list[str] = []

    def visit_Try(self, node: ast.Try) -> None:
        for handler in node.handlers:
            self._check_handler(handler)
        self.generic_visit(node)

    def _check_handler(self, handler: ast.ExceptHandler) -> None:
        if handler.type is None:
            self.errors.append(
                f"[AST POLICY] line {handler.lineno}: bare 'except:' is forbidden"
            )
            return

        is_broad = False
        if isinstance(handler.type, ast.Name) and handler.type.id in (
            "Exception",
            "BaseException",
        ):
            is_broad = True
        elif isinstance(handler.type, ast.Tuple):
            is_broad = any(
                isinstance(elt, ast.Name) and elt.id in ("Exception", "BaseException")
                for elt in handler.type.elts
            )

        if is_broad and self._is_swallowed_body(handler.body):
            self.errors.append(
                f"[AST POLICY] line {handler.lineno}: swallowed broad exception with 'pass' is forbidden"
            )

    def _is_swallowed_body(self, body: list[ast.stmt]) -> bool:
        if not body:
            return True
        if len(body) == 1:
            stmt = body[0]
            if isinstance(stmt, ast.Pass):
                return True
            if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is Ellipsis:
                return True
        return False


class StyleVisitor(ast.NodeVisitor):
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.errors: list[str] = []
        self.safe_opens: set[int] = set()

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            if isinstance(item.context_expr, ast.Call):
                call = item.context_expr
                if isinstance(call.func, ast.Name) and call.func.id == "open":
                    self.safe_opens.add(call.lineno)
        self.generic_visit(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        for item in node.items:
            if isinstance(item.context_expr, ast.Call):
                call = item.context_expr
                if isinstance(call.func, ast.Name) and call.func.id == "open":
                    self.safe_opens.add(call.lineno)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id == "open":
            if node.lineno not in self.safe_opens:
                self.errors.append(
                    f"[STYLE ERROR] line {node.lineno}: open() called outside 'with' context manager"
                )
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._check_function(node)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._check_function(node)
        self.generic_visit(node)

    def _check_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        # Check mutable defaults
        all_defaults = list(node.args.defaults)
        all_defaults.extend([d for d in node.args.kw_defaults if d is not None])
        for default in all_defaults:
            if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                self.errors.append(
                    f"[STYLE ERROR] line {node.lineno}: mutable default argument in '{node.name}'"
                )

        # Check missing type annotations
        has_missing = False
        if not node.returns and node.name not in ("__init__", "__new__"):
            has_missing = True

        all_args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
        for arg in all_args:
            if arg.arg not in ("self", "cls") and not arg.annotation:
                has_missing = True

        if has_missing:
            self.errors.append(
                f"[STYLE ERROR] line {node.lineno}: function '{node.name}' missing type annotations"
            )


def get_base_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return get_base_name(node.value)
    return ""


def _build_attr_string(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_build_attr_string(node.value)}.{node.attr}"
    return ""


def _get_decorator_names(decorators: list[ast.expr]) -> list[str]:
    names: list[str] = []
    for dec in decorators:
        if isinstance(dec, ast.Call):
            dec = dec.func
        if isinstance(dec, ast.Name):
            names.append(dec.id)
        elif isinstance(dec, ast.Attribute):
            names.append(_build_attr_string(dec))
    return names


class PydanticVisitor(ast.NodeVisitor):
    def __init__(self, filepath: str, allowlist: ExceptionAllowlist | None = None):
        self.filepath = filepath
        self.allowlist = allowlist
        self.errors: list[str] = []
        self.total_classes: int = 0
        self.known_pydantic_classes: set[str] = set(PYDANTIC_BASES) | set(PYDANTIC_SUBCLASSES)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.total_classes += 1
        base_names = {get_base_name(b) for b in node.bases}
        decorator_names = set(_get_decorator_names(node.decorator_list))

        is_pydantic_dataclass = any(
            dec in {"pydantic.dataclass", "pydantic.dataclasses.dataclass"}
            for dec in decorator_names
        )

        is_compliant = (
            bool(base_names & self.known_pydantic_classes)
            or is_pydantic_dataclass
            or bool(base_names & ALLOWED_NON_PYDANTIC_BASES)
        )

        if not is_compliant:
            if self.allowlist and self.allowlist.is_pydantic_exempt(self.filepath, node.name):
                is_compliant = True

        if is_compliant:
            self.known_pydantic_classes.add(node.name)
        else:
            self.errors.append(
                f"[PYDANTIC ERROR] line {node.lineno}: class '{node.name}' does not inherit from BaseModel/RootModel"
            )

        self.generic_visit(node)


class DuplicationVisitor(ast.NodeVisitor):
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.errors: list[str] = []
        self._scope_stack: list[dict[str, int]] = [defaultdict(int)]

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._record_function(node.name, node.lineno)
        self._scope_stack.append(defaultdict(int))
        self.generic_visit(node)
        self._scope_stack.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._record_function(node.name, node.lineno)
        self._scope_stack.append(defaultdict(int))
        self.generic_visit(node)
        self._scope_stack.pop()

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._scope_stack.append(defaultdict(int))
        self.generic_visit(node)
        self._scope_stack.pop()

    def _record_function(self, name: str, lineno: int) -> None:
        current_scope = self._scope_stack[-1]
        current_scope[name] += 1
        if current_scope[name] == 2:
            self.errors.append(
                f"[DUP ERROR] line {lineno}: function '{name}' defined multiple times in this file"
            )


def check_ast_slop(code: str, filepath: str = "<string>") -> list[str]:
    try:
        tree = ast.parse(code, filename=filepath)
    except SyntaxError as e:
        return [f"[SYNTAX ERROR] line {e.lineno}: {e.msg}"]
    visitor = SlopVisitor(filepath)
    visitor.visit(tree)
    return visitor.errors


def check_style_violations(code: str, filepath: str = "<string>") -> list[str]:
    try:
        tree = ast.parse(code, filename=filepath)
    except SyntaxError as e:
        return [f"[SYNTAX ERROR] line {e.lineno}: {e.msg}"]
    visitor = StyleVisitor(filepath)
    visitor.visit(tree)
    return visitor.errors


def check_pydantic_compliance(
    code: str, filepath: str = "<string>", allowlist: ExceptionAllowlist | None = None
) -> list[str]:
    try:
        tree = ast.parse(code, filename=filepath)
    except SyntaxError as e:
        return [f"[SYNTAX ERROR] line {e.lineno}: {e.msg}"]
    visitor = PydanticVisitor(filepath, allowlist)
    visitor.visit(tree)
    if FLAG_FILES_WITHOUT_CLASSES and visitor.total_classes == 0:
        return [f"[PYDANTIC ERROR] {filepath}: file contains no class definitions"]
    return visitor.errors


def check_duplicate_functions(code: str, filepath: str = "<string>") -> list[str]:
    try:
        tree = ast.parse(code, filename=filepath)
    except SyntaxError as e:
        return [f"[SYNTAX ERROR] line {e.lineno}: {e.msg}"]
    visitor = DuplicationVisitor(filepath)
    visitor.visit(tree)
    return visitor.errors


BANNED_IMPORTS = frozenset({"src.config.config"})


def check_banned_imports(code: str, filepath: str = "<string>") -> list[str]:
    try:
        tree = ast.parse(code, filename=filepath)
    except SyntaxError as e:
        return [f"[SYNTAX ERROR] line {e.lineno}: {e.msg}"]
    errors: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in BANNED_IMPORTS:
                    errors.append(f"[RUFF ERROR] line {node.lineno}: banned API '{alias.name}'")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if mod in BANNED_IMPORTS or any(mod.startswith(f"{b}.") for b in BANNED_IMPORTS):
                errors.append(f"[RUFF ERROR] line {node.lineno}: banned API '{mod}'")
    return errors
