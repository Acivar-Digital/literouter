#!/usr/bin/env bash
# LiteRouter Log Viewer - compact recent entries viewer
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_FILE="logs/gateway.log"
NUM_BLOCKS=3
FOLLOW=0
ERRORS_ONLY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--lines)
            NUM_BLOCKS="$2"
            shift 2
            ;;
        -f|--follow)
            FOLLOW=1
            shift
            ;;
        -e|--errors)
            ERRORS_ONLY=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-n <num_blocks_or_lines>] [-f|--follow] [-e|--errors]"
            exit 0
            ;;
        *)
            if [[ "$1" =~ ^[0-9]+$ ]]; then
                NUM_BLOCKS="$1"
            fi
            shift
            ;;
    esac
done

if [ ! -f "$LOG_FILE" ]; then
    echo "⚠️ Log file not found: $LOG_FILE"
    exit 1
fi

if [ "$FOLLOW" -eq 1 ]; then
    echo "👀 Tailing $LOG_FILE (Ctrl+C to stop)..."
    tail -f -n 50 "$LOG_FILE"
    exit 0
fi

if [ "$ERRORS_ONLY" -eq 1 ]; then
    echo "🔍 Recent Errors/Warnings from $LOG_FILE:"
    grep -E "⚠️|❌|ERROR|429|400|500|LIMIT|ROTATE" "$LOG_FILE" | tail -n 30
    exit 0
fi

# Print last N request blocks (split by divider)
echo "📋 Last $NUM_BLOCKS request blocks from $LOG_FILE:"
echo "================================================================================"
# If awk is available, extract the last N blocks separated by horizontal rules or 🔵 markers
awk -v n="$NUM_BLOCKS" '
    BEGIN { RS="────────────────────────────────────────────────────────────────────────────────\n" }
    { blocks[NR] = $0 }
    END {
        start = (NR - n + 1 > 1) ? NR - n + 1 : 1
        for (i = start; i <= NR; i++) {
            if (blocks[i] != "") {
                print blocks[i]
                if (i < NR) print "────────────────────────────────────────────────────────────────────────────────"
            }
        }
    }
' "$LOG_FILE"
