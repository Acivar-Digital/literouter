#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🔄 Restarting LiteRouter..."
bash scripts/stop.sh
sleep 1
bash scripts/start.sh
