#!/usr/bin/env bash
# ==============================================================================
# DEEP RESEARCH BATCH RUNNER
# ==============================================================================
# This script executes the deep-research.py script for a list of prompts.
# Best used for scheduling weekly cron jobs.
#
# Usage:
#   ./research/run.sh
# ==============================================================================

set -e # Exit immediately if any command fails

# Get the directory of this script, then the root directory
RESEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$RESEARCH_DIR")"

echo "========================================"
echo "🚀 Starting Batch Deep Research"
echo "========================================"
echo "Running in: $ROOT_DIR"

cd "$ROOT_DIR"

# Define the list of prompts you want to run here
# (Do not include the .md extension, although the script handles it if you do)
PROMPTS=(
    "AI_Infrastructure_Mid_2026"
    # "Direction_of_JPY"
)

for PROMPT in "${PROMPTS[@]}"; do
    echo ""
    echo "----------------------------------------"
    echo "▶️ Processing: $PROMPT"
    echo "----------------------------------------"
    
    # We use uv run for standard dependency management
    uv run python research/deep-research.py "$PROMPT"
done

echo ""
echo "✅ Batch Deep Research complete! Check the research/reports directory."
