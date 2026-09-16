#!/usr/bin/env python3
"""Poll OpenRouter key metadata and write a daily usage report.

Reads keys from the OPENROUTER_API_KEYS environment variable
(comma-separated, same convention as the gateway). Keys are only
held in memory; the report contains only the masked labels that
OpenRouter itself returns (e.g. sk-or-v1-f95...730).

Usage:
    OPENROUTER_API_KEYS=sk-or-v1-a,sk-or-v1-b uv run python scripts/gen-usage.py
    OPENROUTER_API_KEYS=... uv run python scripts/gen-usage.py --out-dir /tmp/usage

Output:
    usage/Daily_Usage_YYMMDD-HHMM.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

KEY_URL = "https://openrouter.ai/api/v1/key"
ENV_VAR = "OPENROUTER_API_KEYS"


def load_dotenv_fallback() -> None:
    """Mirror doctor.ts: explicit env wins, else read repo .env.local, else .env.

    Read-only parse; never writes. Keys stay in process memory only.
    """
    if os.environ.get(ENV_VAR):
        return
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name in (".env.local", ".env"):
        path = os.path.join(root, name)
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    if k.strip() == ENV_VAR:
                        v = v.strip().strip("'").strip('"')
                        if v:
                            os.environ[ENV_VAR] = v
                        return
        except FileNotFoundError:
            continue


def fetch_key_info(key: str, timeout: int) -> dict:
    """GET /api/v1/key for one key. Raises on HTTP/network failure."""
    req = urllib.request.Request(
        KEY_URL,
        headers={"Authorization": f"Bearer {key}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fmt_num(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def bar(used, limit, width: int = 10) -> str:
    if not limit:
        return "n/a"
    frac = max(0.0, min(1.0, used / limit))
    filled = round(frac * width)
    return "█" * filled + "░" * (width - filled) + f" {frac:.0%}"


def build_report(rows: list[dict], errors: list[dict], now: datetime) -> str:
    lines: list[str] = []
    lines.append(f"# OpenRouter Daily Usage — {now:%Y-%m-%d %H:%M %Z}")
    lines.append("")
    lines.append(
        f"Source: `GET /api/v1/key` × {len(rows) + len(errors)} key(s) "
        f"from `{ENV_VAR}`. Labels are OpenRouter-masked; no key material stored."
    )
    lines.append("")

    lines.append("## Free-model daily quota (`:free` models)")
    lines.append("")
    lines.append("| Key | Funded (≥$10)? | Used / Limit | Remaining | Use |")
    lines.append("|---|---|---|---|---|")
    for r in rows:
        free = r.get("free") or {}
        # is_free_tier is a legacy label decoupled from enforcement;
        # the reported ceiling (50 vs 1000) is the ground truth.
        funded = "yes" if free.get("limit") == 1000 else ("no" if free.get("limit") == 50 else "?")
        lines.append(
            f"| {r['label']} | {funded} | {free.get('used', 'n/a')} / "
            f"{free.get('limit', 'n/a')} | {free.get('remaining', 'n/a')} | "
            f"{bar(free.get('used') or 0, free.get('limit') or 0)} |"
        )
    if not rows:
        lines.append("| _(none)_ | — | — | — | — |")
    lines.append("")
    lines.append(
        "> Note: free-model counters are account-global — every key under one "
        "account reports the same numbers. Extra keys do not add quota."
    )
    lines.append("")

    lines.append("## Credit usage (OpenRouter credits)")
    lines.append("")
    lines.append("| Key | Cap | Remaining | Used total | Today | Week | Month |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in rows:
        lines.append(
            f"| {r['label']} | {fmt_num(r.get('limit'))} | "
            f"{fmt_num(r.get('limit_remaining'))} | {fmt_num(r.get('usage'))} | "
            f"{fmt_num(r.get('usage_daily'))} | {fmt_num(r.get('usage_weekly'))} | "
            f"{fmt_num(r.get('usage_monthly'))} |"
        )
    if not rows:
        lines.append("| _(none)_ | — | — | — | — | — | — |")
    lines.append("")

    lines.append("## BYOK usage (USD billed by external providers)")
    lines.append("")
    lines.append("| Key | Today | Week | Month | Total |")
    lines.append("|---|---|---|---|---|")
    for r in rows:
        lines.append(
            f"| {r['label']} | {fmt_num(r.get('byok_daily'))} | "
            f"{fmt_num(r.get('byok_weekly'))} | {fmt_num(r.get('byok_monthly'))} | "
            f"{fmt_num(r.get('byok_total'))} |"
        )
    if not rows:
        lines.append("| _(none)_ | — | — | — | — |")
    lines.append("")

    lines.append("## Errors")
    lines.append("")
    if errors:
        for e in errors:
            lines.append(f"- key #{e['index']}: {e['message']}")
    else:
        lines.append("None — all keys polled successfully.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Write daily OpenRouter usage report.")
    parser.add_argument("--out-dir", default="usage", help="Report directory.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout secs.")
    parser.add_argument("--sleep", type=float, default=1.0, help="Pause between keys.")
    args = parser.parse_args()

    load_dotenv_fallback()
    raw = os.environ.get(ENV_VAR, "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        print(f"ERROR: {ENV_VAR} is empty or unset.", file=sys.stderr)
        return 2

    rows: list[dict] = []
    errors: list[dict] = []
    for i, key in enumerate(keys, start=1):
        try:
            data = fetch_key_info(key, args.timeout).get("data", {})
            rows.append(
                {
                    "label": data.get("label", f"key-#{i}"),
                    "limit": data.get("limit"),
                    "limit_remaining": data.get("limit_remaining"),
                    "usage": data.get("usage"),
                    "usage_daily": data.get("usage_daily"),
                    "usage_weekly": data.get("usage_weekly"),
                    "usage_monthly": data.get("usage_monthly"),
                    "byok_total": data.get("byok_usage"),
                    "byok_daily": data.get("byok_usage_daily"),
                    "byok_weekly": data.get("byok_usage_weekly"),
                    "byok_monthly": data.get("byok_usage_monthly"),
                    "is_free_tier": data.get("is_free_tier"),
                    "free": data.get("free_model_daily_requests"),
                }
            )
        except urllib.error.HTTPError as e:
            errors.append({"index": i, "message": f"HTTP {e.code}"})
        except Exception as e:  # noqa: BLE001 — report, don't crash
            errors.append({"index": i, "message": f"{type(e).__name__}"})
        if i < len(keys):
            time.sleep(args.sleep)

    now = datetime.now().astimezone()
    report = build_report(rows, errors, now)
    os.makedirs(args.out_dir, exist_ok=True)
    path = os.path.join(args.out_dir, f"Daily_Usage_{now:%y%m%d-%H%M}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Wrote {path} ({len(rows)} ok, {len(errors)} errors)")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
