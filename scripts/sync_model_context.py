import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("sync_context")

MODELS_JSON = Path(__file__).resolve().parent.parent / "models.json"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

def main():
    with open(MODELS_JSON) as f:
        registry = json.load(f)

    updated = 0
    skipped_nvidia = 0

    for m in registry:
        provider = m["provider"]
        if provider == "openrouter":
            safe = m["system_id"].replace("/", "_").replace(":", "_") + ".json"
            fpath = MODELS_DIR / "openrouter" / safe
            if not fpath.exists():
                continue
            with open(fpath) as f:
                data = json.load(f)
            ctx = data.get("context_length")
            max_out = (data.get("top_provider") or {}).get("max_completion_tokens")
            if ctx:
                m["context"] = ctx
            if max_out:
                m["max_output"] = max_out
            updated += 1
        elif provider == "nvidia":
            # Public /v1/models list does NOT return context_length.
            # NVIDIA values stay as manually configured until a richer source is used.
            skipped_nvidia += 1

    with open(MODELS_JSON, "w") as f:
        json.dump(registry, f, indent=2)

    logger.info(f"Synced context/max_output for {updated} OpenRouter models.")
    logger.info(f"Skipped {skipped_nvidia} NVIDIA models (public API lacks context_length).")

if __name__ == "__main__":
    main()
