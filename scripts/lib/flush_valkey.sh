# Shared Valkey flush function with structured logging and error handling.
# Source this file from start.sh / stop.sh after cd'ing to the project root.
# Usage: flush_valkey

flush_valkey() {
    local logfile="logs/flush.log"
    mkdir -p logs

    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Flushing Valkey/Redis..." >> "$logfile"

    uv run python -c "
import dotenv, os, redis
dotenv.load_dotenv()
r = redis.Redis(
    host=os.getenv('REDIS_HOST', '127.0.0.1'),
    port=int(os.getenv('REDIS_PORT', 6379)),
    password=os.getenv('REDIS_PASSWORD') or None,
)
count = r.dbsize()
r.flushall()
print(f'Flushed {count} keys')
" >> "$logfile" 2>&1

    local status=$?
    if [ $status -eq 0 ]; then
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Valkey flush SUCCESS" >> "$logfile"
        echo "  → logged to $logfile"
    else
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Valkey flush FAILED (exit $status, continuing)" >> "$logfile"
        echo "  ⚠ Valkey flush failed (exit $status) — see $logfile"
    fi

    return $status
}
