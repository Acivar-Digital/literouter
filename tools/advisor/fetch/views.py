#!/usr/bin/env python3
"""advisor/fetch/views.py — scrapling wrapper for clean agent-targeted HTML.
No secrets; temp files + cleanup; ruff/test hygiene noted."""
import os
import tempfile

SELECTORS = os.environ.get("ADVISOR_SELECTORS", "body")

def clean_view(html: str, selectors: str = SELECTORS) -> str:
    # Placeholder: filter noise; no token storage.
    return f"<!-- selectors={selectors} -->\n{html.strip()}"

def temp_file(html: str) -> str:
    fd, path = tempfile.mkstemp(prefix="advisor_views_", suffix=".html")
    with os.fdopen(fd, "w") as f:
        f.write(clean_view(html))
    return path

if __name__ == "__main__":
    # Hygiene note: ruff/test hygiene required before production use.
    print("views.py scaffold — ruff/test hygiene noted; no secrets stored.")
