"""Allowlist loader for agent_guardrail.json exceptions."""

import json
from pathlib import Path
from pydantic import BaseModel, Field


class PydanticException(BaseModel):
    file: str
    class_name: str = Field(alias="class")
    reason: str = ""


class CCException(BaseModel):
    file: str
    function: str
    cc: int = 0
    reason: str = ""


class ExceptionAllowlist(BaseModel):
    pydantic_exceptions: set[str] = Field(default_factory=set)
    cc_exceptions: set[str] = Field(default_factory=set)

    def is_pydantic_exempt(self, rel_path: str, class_name: str) -> bool:
        normalized_path = rel_path.replace("\\", "/").lstrip("./")
        key = f"{normalized_path}:{class_name}"
        return key in self.pydantic_exceptions

    def is_cc_exempt(self, rel_path: str, func_name: str) -> bool:
        normalized_path = rel_path.replace("\\", "/").lstrip("./")
        key = f"{normalized_path}:{func_name}"
        return key in self.cc_exceptions


def load_exceptions(config_path: Path | str | None = None) -> ExceptionAllowlist:
    """Loads exceptions from TEST/agent_guardrail.json."""
    if config_path is None:
        # Default search path
        default_p = Path(__file__).resolve().parents[3] / "TEST" / "agent_guardrail.json"
        config_path = default_p

    path = Path(config_path).resolve()
    if not path.exists() or not path.is_file():
        return ExceptionAllowlist()

    try:
        raw_text = path.read_text(encoding="utf-8")
        raw_json = json.loads(raw_text)

        pydantic_keys = {
            f"{e['file'].replace(chr(92), '/').lstrip('./')}:{e['class']}"
            for e in raw_json.get("pydantic_exceptions", [])
            if "file" in e and "class" in e
        }
        cc_keys = {
            f"{e['file'].replace(chr(92), '/').lstrip('./')}:{e['function']}"
            for e in raw_json.get("cc_exceptions", [])
            if "file" in e and "function" in e
        }
        return ExceptionAllowlist(
            pydantic_exceptions=pydantic_keys,
            cc_exceptions=cc_keys,
        )
    except (json.JSONDecodeError, OSError):
        return ExceptionAllowlist()
