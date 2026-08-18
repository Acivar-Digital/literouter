#!/usr/bin/env bash
# Claude Code PostToolUse hook.
#
# Runs after every Edit/Write so slop code is caught and reported to the
# model instead of silently landing on disk. Delegates to agent_guardrail.py,
# the meaner 11-stage gate (sandbox -> kill-tries -> ast-slop/style -> CC ->
# ruff -> pyright -> dupe -> pydantic -> sanitize).
#
# Exit code is always 0: this is a REMINDER, not a hard block. The validator
# output is written to stderr so Claude Code feeds it back as additional
# context and the model can self-correct on the next turn.
set -uo pipefail

INPUT="$(cat)"
if [ -z "$INPUT" ]; then
  exit 0
fi

# Extract file_path from the hook's JSON payload.
FILE_PATH="$(node -e '
  const fs = require("fs");
  let raw = "";
  process.stdin.on("data", d => (raw += d));
  process.stdin.on("end", () => {
    try {
      const d = JSON.parse(raw);
      const ti = d && (d.tool_input || {});
      process.stdout.write(ti.file_path || "");
    } catch { process.stdout.write(""); }
  });
' <<<"$INPUT")"

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 0

OUT="$(".venv/bin/python admin/code_hygiene/agent_guardrail.py validate "$FILE_PATH" 2>&1)"
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  exit 0
fi

{
  echo "SLOP GUARD — agent_guardrail rejected $FILE_PATH (do not ship this code as-is):"
  printf '%s\n' "$OUT"
  echo "Fix the issues above before proceeding. Re-run the validator after editing."
} >&2
exit 0