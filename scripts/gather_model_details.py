import json
import logging
from pathlib import Path
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("gather_details")

MODELS_JSON = Path(__file__).resolve().parent.parent / "models.json"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# --- ONE-TIME STATIC SETUP (top of script) ---

# 1. Strip these suffixes before matching (OpenRouter has no -free / :free variants)
FREE_SUFFIXES = (":free", "-free")

# 2. Org remap: our upstream org -> OpenRouter's org.
#    These do not change (NVIDIA/zen vs OpenRouter naming conventions).
ORG_MAP = {
    "meta": "meta-llama",
    "minimaxai": "minimax",
    "deepseek-ai": "deepseek",
    "stepfun-ai": "stepfun",
}

# 3. zen/deepseek* -> OpenRouter deepseek catalog entry (org remap + suffix strip)
ZEN_DEEPSEEK_ORG = "deepseek"


def _strip_free(model_id: str) -> str:
    """Remove :free / -free suffixes from the id."""
    s = model_id
    for suf in FREE_SUFFIXES:
        if s.endswith(suf):
            s = s[: -len(suf)]
    return s


def _remap_org(model_id: str) -> str:
    """Replace first path segment via ORG_MAP if present."""
    if "/" in model_id:
        org, rest = model_id.split("/", 1)
        if org in ORG_MAP:
            return f"{ORG_MAP[org]}/{rest}"
    return model_id


def _zen_deepseek(model_id: str) -> str | None:
    """zen/deepseek-X-free -> deepseek/deepseek-X."""
    if model_id.startswith("zen/deepseek"):
        rest = model_id.split("/", 1)[1]
        rest = _strip_free(rest)
        return f"{ZEN_DEEPSEEK_ORG}/{rest}"
    return None


def _build_candidates(cid: str) -> list[str]:
    """Build normalization candidates for a single model id."""
    candidates: list[str] = []
    if "/" in cid:
        candidates.append(cid.split("/", 1)[1])
    base = _strip_free(cid)
    candidates.append(base)
    if "/" in base:
        candidates.append(base.split("/", 1)[1])
    remapped = _remap_org(base)
    if remapped != base:
        candidates.append(remapped)
        if "/" in remapped:
            candidates.append(remapped.split("/", 1)[1])
    return candidates


def _search_catalog(candidates: list[str], or_catalog: dict[str, Any]) -> Any | None:
    """Find first candidate in OpenRouter catalog."""
    for c in candidates:
        if c in or_catalog:
            return or_catalog[c]
    return None


def match_openrouter(
    or_catalog: dict[str, Any], sys_id: str, upstream_id: str
) -> Any | None:
    """Normalize ids (strip free, remap org) and find in OpenRouter catalog."""
    candidates: list[str] = []
    for cid in (sys_id, upstream_id):
        if not cid:
            continue
        candidates.extend(_build_candidates(cid))
    z = _zen_deepseek(sys_id)
    if z:
        candidates.append(z)
    return _search_catalog(candidates, or_catalog)


def _load_registry() -> list[dict[str, Any]]:
    """Load models.json registry."""
    with open(MODELS_JSON) as f:
        data: list[dict[str, Any]] = json.load(f)
    return data


def _fetch_or_catalog() -> dict[str, Any]:
    """Fetch OpenRouter full catalog (no key needed)."""
    logger.info("Fetching OpenRouter full catalog...")
    r = httpx.get("https://openrouter.ai/api/v1/models", timeout=20)
    return {m["id"]: m for m in r.json().get("data", [])}


def _process_model(
    m: dict[str, Any], or_data: dict[str, Any], unmatched: list[str]
) -> int:
    """Match a single model against OpenRouter catalog. Returns 1 if updated."""
    provider = m["provider"]
    if provider == "google":
        return 0
    sys_id = m["system_id"]
    upstream = m.get("upstream_id", "")
    match = match_openrouter(or_data, sys_id, upstream)
    if not match:
        unmatched.append(sys_id)
        return 0
    _save_model_detail(match, provider, sys_id, m)
    return 1


def _write_detail_json(match: dict[str, Any], provider: str, sys_id: str) -> None:
    """Write model detail JSON to provider folder."""
    prov_dir = MODELS_DIR / provider
    prov_dir.mkdir(parents=True, exist_ok=True)
    safe = sys_id.replace("/", "_").replace(":", "_") + ".json"
    with open(prov_dir / safe, "w") as f:
        json.dump(match, f, indent=2)


def _extract_model_fields(match: dict[str, Any]) -> tuple[Any, Any]:
    """Extract context_length and max_completion_tokens from match."""
    tp = match.get("top_provider") or {}
    ctx = match.get("context_length") or tp.get("context_length")
    max_out = tp.get("max_completion_tokens") or match.get("max_completion_tokens")
    return ctx, max_out


def _update_registry_fields(match: dict[str, Any], m: dict[str, Any]) -> None:
    """Map OpenRouter detail fields to models.json entries."""
    ctx, max_out = _extract_model_fields(match)
    if ctx:
        m["context"] = ctx
    if max_out:
        m["max_output"] = max_out


def _save_model_detail(
    match: dict[str, Any], provider: str, sys_id: str, m: dict[str, Any]
) -> None:
    """Save detail file and update models.json fields."""
    _write_detail_json(match, provider, sys_id)
    _update_registry_fields(match, m)


def main() -> None:
    registry = _load_registry()
    or_data = _fetch_or_catalog()
    logger.info(f"  catalog size: {len(or_data)}")
    updated = 0
    unmatched: list[str] = []
    for m in registry:
        updated += _process_model(m, or_data, unmatched)
    with open(MODELS_JSON, "w") as f:
        json.dump(registry, f, indent=2)
    logger.info(f"Updated {updated} models from OpenRouter catalog.")
    _log_unmatched(unmatched)


def _log_unmatched(unmatched: list[str]) -> None:
    """Log unmatched model ids."""
    if not unmatched:
        return
    logger.warning(f"{len(unmatched)} models NOT found on OpenRouter:")
    for u in unmatched:
        logger.warning(f"  - {u}")
