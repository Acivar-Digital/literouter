#!/usr/bin/env python3
"""advisor/fetch/parse_view.py — Stdin markdown to stdout JSON section parser.

Reads markdown from sys.stdin, strips <script> and <style> noise via regex,
splits content into sections by markdown headings, and outputs JSON with
sections and character count. Stdlib only; no network, no browser, no tokens.
"""

import argparse
import json
import re
import sys

SCRIPT_RE = re.compile(r"<script\b[^>]*>[\s\S]*?</script>", re.IGNORECASE)
STYLE_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.IGNORECASE)
SELF_CLOSING_RE = re.compile(r"<(script|style)\b[^>]*/>", re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def strip_noise(text: str) -> str:
    """Strip script and style tag noise from input text."""
    text = SCRIPT_RE.sub("", text)
    text = STYLE_RE.sub("", text)
    text = SELF_CLOSING_RE.sub("", text)
    return text


def parse_sections(text: str) -> list[dict[str, str]]:
    """Split markdown text into sections by headings."""
    lines = text.splitlines()
    sections: list[dict[str, str]] = []
    current_h = ""
    current_body_lines: list[str] = []

    for line in lines:
        match = HEADING_RE.match(line)
        if match:
            if current_h or current_body_lines:
                body = "\n".join(current_body_lines).strip()
                if current_h or body:
                    sections.append({"h": current_h, "body": body})
            current_h = match.group(2).strip()
            current_body_lines = []
        else:
            current_body_lines.append(line)

    if current_h or current_body_lines:
        body = "\n".join(current_body_lines).strip()
        if current_h or body:
            sections.append({"h": current_h, "body": body})

    return sections


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stdin markdown to stdout JSON section parser."
    )
    parser.add_argument(
        "--diet",
        dest="diet",
        action="store_true",
        default=False,
        help="Strip script/style noise and split into heading sections.",
    )
    parser.add_argument(
        "--keep-all",
        dest="diet",
        action="store_false",
        help="Keep raw input without noise stripping or sectioning (default).",
    )
    args = parser.parse_args()

    raw_input = sys.stdin.read()
    if args.diet:
        cleaned = strip_noise(raw_input)
        sections = parse_sections(cleaned)
        payload = {
            "sections": sections,
            "chars": len(cleaned),
            "diet": True,
        }
    else:
        payload = {
            "sections": [{"h": "raw", "body": raw_input}],
            "chars": len(raw_input),
            "diet": False,
        }
    sys.stdout.write(json.dumps(payload) + "\n")


if __name__ == "__main__":
    main()
