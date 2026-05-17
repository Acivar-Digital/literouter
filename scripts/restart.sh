#!/bin/bash
pkill -f "uvicorn src.main:app" 2>/dev/null
sleep 1
cd "$(dirname "$0")/.."
echo "Restarting LiteRouter..."
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 --reload
