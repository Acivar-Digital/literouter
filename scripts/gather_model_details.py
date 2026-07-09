import json
import logging
from pathlib import Path
import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("gather_details")

MODELS_JSON = Path(__file__).resolve().parent.parent / "models.json"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

def match_openrouter(or_catalog, sys_id, upstream_id):
    """Try to find a model in OpenRouter's catalog by several ID variants."""
    candidates = [sys_id, upstream_id, sys_id.split("/", 1)[-1], upstream_id.split("/", 1)[-1]]
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

        # Update context / max_output
        ctx = match.get("context_length")
        max_out = (match.get("top_provider") or {}).get("max_completion_tokens")
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
