# 06 Fetch sh

Documentation for `advisor/fetch/views.sh`, a shell-based stealth fetch wrapper that produces clean HTML/markdown views for agent consumption.

## a. Inputs & Dependencies

- **Source File**: `advisor/fetch/views.sh`
- **PROFILE Variable**:
  - Configured via `ADVISOR_PROFILE` env variable or defaults to `$HOME/.advisor_tools/profile` (`advisor/fetch/views.sh:9`).
  - Automatically creates profile directory with `mkdir -p "$PROFILE"` (`advisor/fetch/views.sh:10`).
  - Re-exported back into the environment as `ADVISOR_PROFILE` (`advisor/fetch/views.sh:11`).
- **Command Line Options** (`advisor/fetch/views.sh:17-23`):
  - `--ai-targeted`: Sets `TARGETED=1` flag (`advisor/fetch/views.sh:19`).
  - `-s <selectors>`: Stores CSS/DOM target selectors into `SELECTORS` (`advisor/fetch/views.sh:20`).
  - `<url>`: Positional target URL (`advisor/fetch/views.sh:21`).
- **Binary Dependencies**:
  - `bash` running in strict mode (`set -euo pipefail`, `advisor/fetch/views.sh:6`).
  - `mktemp` (`advisor/fetch/views.sh:25`).
  - `scrapling` CLI tool (optional, detected at `advisor/fetch/views.sh:27`).

## b. Transformation

- **Temporary File Allocation**: Generates scratch file `TMPFILE=$(mktemp /tmp/advisor_views.XXXXXX)` (`advisor/fetch/views.sh:25`).
- **Scrapling Wrapper (Primary Path)**:
  - Checks if `scrapling` is installed using `command -v scrapling` (`advisor/fetch/views.sh:27`).
  - Executes stealth extraction:
    `scrapling extract stealthy-fetch "$URL" "$TMPFILE.md" --ai-targeted ${SELECTORS:+-s "$SELECTORS"}` (`advisor/fetch/views.sh:29`).
  - Ensures no secrets or credentials are passed on the CLI; passes only URL and optional selectors (`advisor/fetch/views.sh:28-29`).
- **Fallback Stub (Secondary Path)**:
  - Triggered if `scrapling` is missing (`advisor/fetch/views.sh:32-38`).
  - Synthesizes mock content into `$TMPFILE` recording targeted state and selectors (`advisor/fetch/views.sh:34-35`):
    - `Fetching $URL with selectors: $SELECTORS (ai-targeted=$TARGETED)` (`advisor/fetch/views.sh:34`).
    - `<!-- cleaned view -->` (`advisor/fetch/views.sh:35`).

## c. Outputs & Dependencies

- **Emitted Artifacts**:
  - Emits the path of the generated output file to standard output:
    - Scrapling mode: echoes `$TMPFILE.md` (`advisor/fetch/views.sh:30`).
    - Fallback mode: echoes `$TMPFILE` (`advisor/fetch/views.sh:36`).
- **Cleanup Trap Lifecycle**:
  - Registers shell `EXIT` traps to immediately unlink temporary files when the script terminates:
    - Scrapling mode: `trap 'rm -f "$TMPFILE" "$TMPFILE.md"' EXIT` (`advisor/fetch/views.sh:31`).
    - Fallback stub mode: `trap 'rm -f "$TMPFILE"' EXIT` (`advisor/fetch/views.sh:37`).
- **Downstream Consumers**:
  - Calling agents or CLI wrappers capture the stdout file path and read rendered markdown views prior to process termination.
