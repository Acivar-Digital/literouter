#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# LiteRouter x OpenCode v2 - Multi-Provider Model Test Suite
# ==============================================================================
# Tests representative models across configured LiteRouter providers
# using opencode2 CLI with the -m / --model flag.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
BOLD="\033[1m"
NC="\033[0m"

echo -e "${BOLD}${CYAN}================================================================================${NC}"
echo -e "${BOLD}${CYAN}🧪 OpenCode v2 Multi-Provider Model Verification Suite${NC}"
echo -e "${BOLD}${CYAN}================================================================================${NC}"

# Check gateway health
if ! curl -sk https://localhost:7766/health >/dev/null 2>&1; then
  echo -e "${RED}❌ LiteRouter gateway is not responding at https://localhost:7766/health${NC}"
  echo -e "${YELLOW}Please start it using: bash scripts/start.sh${NC}"
  exit 1
fi
echo -e "${GREEN}✓ LiteRouter Gateway is healthy on port 7766${NC}\n"

# Define test matrix: Array of "Provider_Label|Model_Identifier|Test_Prompt"
TEST_MODELS=(
  "LR-NV (Nvidia)|lr-nv/meta/llama-3.1-8b-instruct|What is 2+2? Answer in one short sentence."
  "LR-OR (OpenRouter)|lr-or/liquid/lfm-2.5-2.6b:free|Reply with exactly the word PONG."
)

TOTAL=${#TEST_MODELS[@]}
PASSED=0
FAILED=0

declare -a RESULTS=()

for item in "${TEST_MODELS[@]}"; do
  IFS="|" read -r LABEL MODEL PROMPT <<< "${item}"
  echo -e "${BOLD}Testing Provider:${NC} ${CYAN}${LABEL}${NC}"
  echo -e "  • Model:  ${YELLOW}${MODEL}${NC}"
  echo -e "  • Prompt: \"${PROMPT}\""

  START_TIME=$(date +%s%N)
  
  # Run via opencode2 CLI with standalone mode
  OUTPUT=""
  EXIT_CODE=0
  if OUTPUT=$(opencode2 run --standalone --format json -m "${MODEL}" "${PROMPT}" 2>&1); then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi
  
  END_TIME=$(date +%s%N)
  ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))

  # Check if output contains text or completed step
  if [ ${EXIT_CODE} -eq 0 ] && (echo "${OUTPUT}" | grep -q '"type":"text"' || echo "${OUTPUT}" | grep -q '"type":"step_finish"'); then
    RESPONSE_TEXT=$(echo "${OUTPUT}" | grep '"type":"text"' | sed -E 's/.*"text":"([^"]*)".*/\1/' | tr '\n' ' ' | head -c 80 || echo "[Completed]")
    echo -e "  • Result: ${GREEN}PASS${NC} (${ELAPSED_MS}ms)"
    echo -e "  • Output: ${BOLD}${RESPONSE_TEXT:-[Response verified]}${NC}"
    RESULTS+=("${LABEL}|${MODEL}|PASS|${ELAPSED_MS}ms|${RESPONSE_TEXT:-[OK]}")
    PASSED=$((PASSED + 1))
  else
    ERR_MSG=$(echo "${OUTPUT}" | grep -o '"message":"[^"]*"' | head -n 1 | cut -d':' -f2- | tr -d '"' || echo "Exit code ${EXIT_CODE}")
    echo -e "  • Result: ${RED}FAIL${NC} (${ELAPSED_MS}ms)"
    echo -e "  • Error:  ${RED}${ERR_MSG:-Command failed}${NC}"
    RESULTS+=("${LABEL}|${MODEL}|FAIL|${ELAPSED_MS}ms|${ERR_MSG:-Error}")
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo -e "${BOLD}${CYAN}================================================================================${NC}"
echo -e "${BOLD}${CYAN}📊 Verification Summary Matrix${NC}"
echo -e "${BOLD}${CYAN}================================================================================${NC}"
printf "%-22s %-40s %-8s %-10s\n" "PROVIDER" "MODEL" "STATUS" "LATENCY"
echo "--------------------------------------------------------------------------------"

for res in "${RESULTS[@]}"; do
  IFS="|" read -r P M S L O <<< "${res}"
  if [ "${S}" == "PASS" ]; then
    printf "%-22s %-40s ${GREEN}%-8s${NC} %-10s\n" "${P}" "${M}" "${S}" "${L}"
  else
    printf "%-22s %-40s ${RED}%-8s${NC} %-10s\n" "${P}" "${M}" "${S}" "${L}"
  fi
done

echo "--------------------------------------------------------------------------------"
echo -e "Total: ${TOTAL} | Passed: ${GREEN}${PASSED}${NC} | Failed: ${RED}${FAILED}${NC}\n"

if [ ${FAILED} -gt 0 ]; then
  exit 1
fi
exit 0
