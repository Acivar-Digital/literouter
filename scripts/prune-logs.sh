#!/usr/bin/env bash
# prune-logs.sh - keep 30 days of logs/gateway.log on start/restart.
# Keeps ALL untimestamped lines (banner, ===, Port:, Directive/Model
# continuations without [MM-DD-]). Drops only timestamped lines whose
# MM-DD is older than (today - 30 days). Atomic rewrite via tmp + mv.
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_FILE="${1:-logs/gateway.log}"

# Cutoff as MM-DD: GNU date first, python3 fallback for BSD date.
CUTOFF="$(date -d "30 days ago" +%m-%d 2>/dev/null || python3 -c 'from datetime import date,timedelta; print((date.today()-timedelta(days=30)).strftime("%m-%d"))')"
TODAY="$(date +%m-%d 2>/dev/null || python3 -c 'from datetime import date; print(date.today().strftime("%m-%d"))')"

if [ ! -f "$LOG_FILE" ]; then
  echo "prune-logs: $LOG_FILE missing, nothing to do (cutoff=$CUTOFF)"
  exit 0
fi

# Binary-safe counts (log contains emoji bytes).
BEFORE="$(grep -a -c '' "$LOG_FILE" || true)"

TMP="$(mktemp "${LOG_FILE}.prune.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

PYOUT="$(CUTOFF="$CUTOFF" TODAY="$TODAY" LOG_FILE="$LOG_FILE" TMP="$TMP" python3 - <<'PYEOF'
import os, re
log = os.environ["LOG_FILE"]
tmp = os.environ["TMP"]
cutoff = os.environ["CUTOFF"]
today = os.environ["TODAY"]
pat = re.compile(r"\[([0-9]{2})-([0-9]{2})-")

def doy(mmdd):
    m, d = int(mmdd[:2]), int(mmdd[3:5])
    # Day-of-year anchored to a non-leap year (2023); valid for ordering only.
    months = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    return sum(months[:m - 1]) + d

cut_doy, today_doy = doy(cutoff), doy(today)
wrapped = cut_doy > today_doy  # Dec-Jan year boundary

def keep_mmdd(mmdd):
    v = doy(mmdd)
    if wrapped:
        return v >= cut_doy or v <= today_doy
    return v >= cut_doy

kept = dropped = 0
with open(log, "r", encoding="utf-8", errors="replace") as fin, \
     open(tmp, "w", encoding="utf-8", errors="replace") as fout:
    for line in fin:
        m = pat.search(line)
        if not m:
            fout.write(line)  # untimestamped: always keep
            kept += 1
        elif keep_mmdd("%s-%s" % (m.group(1), m.group(2))):
            fout.write(line)
            kept += 1
        else:
            dropped += 1
print("kept=%d dropped=%d" % (kept, dropped))
PYEOF
)"
KEPT="$(echo "$PYOUT" | grep -a -o 'kept=[0-9]*' | cut -d= -f2)"
DROPPED="$(echo "$PYOUT" | grep -a -o 'dropped=[0-9]*' | cut -d= -f2)"

# Atomic replace: never truncate the live fd in place.
mv -f "$TMP" "$LOG_FILE"
trap - EXIT

echo "prune-logs: cutoff=$CUTOFF kept=$KEPT dropped=$DROPPED (before=$BEFORE)"
