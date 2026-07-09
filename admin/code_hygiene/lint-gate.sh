#!/usr/bin/env bash
# LiteRouter code-hygiene gate.
#
# Fails (exit 1) if `ruff check .` is not clean. This is the single source of
# truth that a commit / CI run has not regressed lint. It intentionally only
# checks `ruff check` (the errors E/F/I we enforce in pyproject.toml) — NOT
# full `ruff format`, because the repo is not wholesale-formatted yet.
#
# Used by:
#   - .github/workflows/lint.yml  (CI on push / PR)
#   - local developers:  bash admin/code_hygiene/lint-gate.sh
set -euo pipefail

# Resolve to repo root (this script lives in admin/code_hygiene/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> uv run ruff check ."
if uv run ruff check .; then
  echo "OK: code-hygiene gate passed (ruff check clean)"
else
  echo "FAIL: ruff check reported errors — fix them before pushing." >&2
  echo "      Local fix:  uv run ruff check --fix ." >&2
  exit 1
fi
