import json
import logging
from pathlib import Path

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


def _strip_free(model_id):
    """Remove :free / -free suffixes from the id."""
    s = model_id
    for suf in FREE_SUFFIXES:
        if s.endswith(suf):
            s = s[: -len(suf)]
    return s


def _remap_org(model_id):
    """Replace first path segment via ORG_MAP if present."""
    if "/" in model_id:
        org, rest = model_id.split("/", 1)
        if org in ORG_MAP:
            return f"{ORG_MAP[org]}/{rest}"
    return model_id


def _zen_deepseek(model_id):
    """zen/deepseek-X-free -> deepseek/deepseek-X."""
    if model_id.startswith("zen/deepseek"):
        rest = model_id.split("/", 1)[1]      # deepseek-v4-flash-free
        rest = _strip_free(rest)                # deepseek-v4-flash
        return f"{ZEN_DEEPSEEK_ORG}/{rest}"     # deepseek/deepseek-v4-flash
    return None


def match_openrouter(or_catalog, sys_id, upstream_id):
    """Normalize ids (strip free, remap org) and find in OpenRouter catalog."""
    candidates = []
    for cid in (sys_id, upstream_id):
        if not cid:
            continue
        # original with only provider prefix dropped (keeps :free if present)
        if "/" in cid:
            candidates.append(cid.split("/", 1)[1])
        base = _strip_free(cid)
        candidates.append(base)                       # full normalized id
        if "/" in base:
            candidates.append(base.split("/", 1)[1])  # drop provider prefix
        remapped = _remap_org(base)
        if remapped != base:
            candidates.append(remapped)              # org-remapped id
            if "/" in remapped:
                candidates.append(remapped.split("/", 1)[1])
    # zen/deepseek special case
    z = _zen_deepseek(sys_id)
    if z:
        candidates.append(z)

    for c in candidates:
        if c in or_catalog:
            return or_catalog[c]
    return None

def main():
    with open(MODELS_JSON) as f:
        registry = json.load(f)

    # Fetch OpenRouter full catalog (single public call, no key needed)
    logger.info("Fetching OpenRouter full catalog...")
    r = httpx.get("https://openrouter.ai/api/v1/models", timeout=20)
    or_data = {m["id"]: m for m in r.json().get("data", [])}
    logger.info(f"  catalog size: {len(or_data)}")

    updated = 0
    unmatched = []

    for m in registry:
        provider = m["provider"]
        if provider == "google":
            continue  # user asked to leave google alone

        sys_id = m["system_id"]
        upstream = m.get("upstream_id", "")
        match = match_openrouter(or_data, sys_id, upstream)

        if not match:
            unmatched.append(sys_id)
            continue

        # Save detail file into the provider's folder
        prov_dir = MODELS_DIR / provider
        prov_dir.mkdir(parents=True, exist_ok=True)
        safe = sys_id.replace("/", "_").replace(":", "_") + ".json"
        with open(prov_dir / safe, "w") as f:
            json.dump(match, f, indent=2)

        # Map OpenRouter detail -> our models.json fields
        #   context_length        -> context
        #   max_completion_tokens -> max_output
        tp = match.get("top_provider") or {}
        ctx = match.get("context_length") or tp.get("context_length")
        max_out = tp.get("max_completion_tokens") or match.get("max_completion_tokens")
        if ctx:
            m["context"] = ctx
        if max_out:
            m["max_output"] = max_out
        updated += 1

    with open(MODELS_JSON, "w") as f:
        json.dump(registry, f, indent=2)

    logger.info(f"Updated {updated} models from OpenRouter catalog.")
    if unmatched:
        logger.warning(f"{len(unmatched)} models NOT found on OpenRouter:")
        for u in unmatched:
            logger.warning(f"  - {u}")

if __name__ == "__main__":
    main()
