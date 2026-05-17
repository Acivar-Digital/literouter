#!/bin/bash
cd "$(dirname "$0")/.."
echo "Starting LiteRouter..."
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 --reload
