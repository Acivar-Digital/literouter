#!/usr/bin/env bash
# ==============================================================================
# LiteRouter Pre-Commit Secret Scanner
# Blocks commits if staged files contain live API key patterns.
# ==============================================================================

set -euo pipefail

# Patterns for sensitive keys
# Allowed mock prefixes/substrings: "mock", "test-stub", "key1", "key2", "key3", "key6", "REALKEY", "NEWNIMKEY", "XXXX"
PATTERNS=(
  "nvapi-[A-Za-z0-9_-]{25,}"
  "sk-or-v1-[A-Za-z0-9_-]{25,}"
  "AIzaSy[A-Za-z0-9_-]{33}"
  "sk-ant-api[A-Za-z0-9_-]{25,}"
  "sk-proj-[A-Za-z0-9_-]{25,}"
)

# Get staged files (added, copied, modified)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "${STAGED_FILES}" ]; then
  exit 0
fi

FAILED=0

for file in ${STAGED_FILES}; do
  if [ ! -f "${file}" ]; then
    continue
  fi

  for pattern in "${PATTERNS[@]}"; do
    MATCHES=$(git diff --cached "${file}" | grep -E "^\+" | grep -v "^\+\+\+" | grep -E "${pattern}" || true)
    if [ -n "${MATCHES}" ]; then
      # Check if match is a benign mock
      REAL_MATCHES=$(echo "${MATCHES}" | grep -v -E "mock|test-stub|key[0-9]|REALKEY|NEWNIMKEY|XXXX|placeholder|<REDACTED" || true)
      if [ -n "${REAL_MATCHES}" ]; then
        echo "🚨 [SECRET SCANNER] Potential secret detected in staged file: ${file}"
        echo "   Pattern: ${pattern}"
        echo "   Matches:"
        echo "${REAL_MATCHES}" | head -n 5 | sed 's/^/     /'
        echo "⛔ Commit aborted! Please remove secrets or use mocked test stubs before committing."
        FAILED=1
      fi
    fi
  done
done

if [ "${FAILED}" -ne 0 ]; then
  exit 1
fi

exit 0
