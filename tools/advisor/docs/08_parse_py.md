# 08 Parse py

Documentation for `advisor/fetch/parse_view.py`, a standard library CLI utility that parses markdown input from standard input into structured JSON sections.

## a. Inputs & Dependencies

- **Source File**: `advisor/fetch/parse_view.py` (`advisor/fetch/parse_view.py:1-93`).
- **Dependencies**: Python 3 standard library only (`argparse`, `json`, `re`, `sys` at `advisor/fetch/parse_view.py:9-12`). Zero third-party packages, zero network calls, zero token consumption.
- **Input Stream**: Markdown text delivered via standard input (`sys.stdin.read()` at `advisor/fetch/parse_view.py:74`).
- **CLI Arguments** (`advisor/fetch/parse_view.py:56-72`):
  - `--diet`: Enables script/style noise stripping and heading-based sectioning (`advisor/fetch/parse_view.py:59-65`).
  - `--keep-all`: Preserves raw input without noise stripping or sectioning (`advisor/fetch/parse_view.py:66-71`).
  - **Default Behavior**: Raw mode (`diet=False` default raw at `advisor/fetch/parse_view.py:63,70,83-88`).

## b. Transformation

- **Noise Stripping (`strip_noise`)** (`advisor/fetch/parse_view.py:19-25`):
  - Function defined across lines 19-25 (`advisor/fetch/parse_view.py:19-25`).
  - Regex stripping script tags: `text = SCRIPT_RE.sub("", text)` (`advisor/fetch/parse_view.py:14,22`).
  - Regex stripping style tags: `text = STYLE_RE.sub("", text)` (`advisor/fetch/parse_view.py:15,23`).
  - Regex stripping self-closing tags: `text = SELF_CLOSING_RE.sub("", text)` (`advisor/fetch/parse_view.py:16,24`).
- **Section Parsing (`parse_sections`)** (`advisor/fetch/parse_view.py:28-52`):
  - Iterates over lines and detects markdown headings via `HEADING_RE = r"^(#{1,6})\s+(.*)$"` (`advisor/fetch/parse_view.py:17,36`).
  - Collects heading title (`h`) and accumulator lines (`body`) into section dictionaries (`advisor/fetch/parse_view.py:38-51`).
- **Branching**:
  - Diet mode (`args.diet=True`): Executes `strip_noise()` then `parse_sections()` (`advisor/fetch/parse_view.py:75-82`).
  - Raw mode (`args.diet=False`): Wraps input directly in `[{"h": "raw", "body": raw_input}]` (`advisor/fetch/parse_view.py:83-88`).

## c. Outputs & Dependencies

- **Output Stream**: Serialized JSON string with newline emitted to standard output (`sys.stdout.write(json.dumps(payload) + "\n")` at `advisor/fetch/parse_view.py:89`).
- **Output JSON Schema** (`advisor/fetch/parse_view.py:78-88`):
  - `sections`: List of section objects containing `"h"` (heading text) and `"body"` (content) (`advisor/fetch/parse_view.py:79,85`).
  - `chars`: Integer character count of processed text (`advisor/fetch/parse_view.py:80,86`).
  - `diet`: Boolean flag representing active mode (`advisor/fetch/parse_view.py:81,87`).
- **Downstream Consumers**:
  - Downstream Copilot view parsers, review scripts, and agent analyzers consuming normalized markdown sections.
