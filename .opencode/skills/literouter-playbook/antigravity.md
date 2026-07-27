# Antigravity Agent Guide (`antigravity-preview-05-2026`)

## 1. Overview & Paradigm Difference

`antigravity-preview-05-2026` is an **Agent execution engine** that runs inside a sandboxed Linux container in Google Cloud. It is **NOT** a standard text-generation language model.

- **Standard Models (`gemini-3.5-flash`, `gemini-3.6-flash`):** Take text/vision prompts and return text completions via standard text endpoints (`:generateContent` or OpenAI-compat `/v1/chat/completions`).
- **Antigravity Agent (`antigravity-preview-05-2026`):** Provisions a remote Linux VM equipped with bash, python, node, and git, executing multi-file edits, terminal commands, and web interactions autonomously.

### Why Standard Text Endpoints Fail
Calling Antigravity through standard text generation endpoints (`:generateContent` or `/v1/chat/completions`) triggers an immediate HTTP 400 error:
```json
HTTP 400 Bad Request
{
  "error": {
    "code": 400,
    "message": "This model only supports Interactions API.",
    "status": "INVALID_ARGUMENT"
  }
}
```

---

## 2. API Usage: Google Interactions API (`/v1beta/interactions`)

Programmatic usage of Antigravity requires Google's **Interactions API** endpoint:

### cURL / REST Request
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "antigravity-preview-05-2026",
    "input": "Clone https://github.com/example/repo.git, run pytest, fix any failing tests, and report results.",
    "environment": "remote"
  }'
```

### Python SDK (`google-genai`)
```python
from google import genai

client = genai.Client()

interaction = client.interactions.create(
    agent="antigravity-preview-05-2026",
    input="Build a simple express server with a /health endpoint in a new index.js file",
    environment="remote"
)

# Output includes execution step summaries, created file artifacts, and stdout
print(interaction.output_text)
```

---

## 3. Key Differences at a Glance

| Feature | Standard Models (`gemini-3.5-flash` / `3.6-flash`) | Antigravity Agent (`antigravity-preview-05-2026`) |
| :--- | :--- | :--- |
| **Type** | Text / Vision Completion Model | Sandboxed Agent Engine |
| **Primary Endpoint** | `:generateContent` / `/v1/chat/completions` | `/v1beta/interactions` |
| **Output** | String / JSON response | Execution results, code changes, logs |
| **Environment** | Stateless model inference | Full Linux sandbox container in Google Cloud |
| **Timing** | Fast TTFT (< 1s) | Multi-step task execution (15s – 5min) |

---

## 4. Primary Use Cases

1. **Deep Research & Repository Investigation:** Give Antigravity a Git URL or research task. It clones repos, browses documentation, runs python data processing scripts, and returns a verified Markdown report.
2. **Autonomous Project Scaffolding:** Scaffolds full multi-file applications (`package.json`, source files, test suites), runs dependency installs (`npm install`, `pip install`), and verifies builds.
3. **Self-Healing Bug Fixes & Refactoring:** Runs test suites (`pytest`, `bun test`), parses stack traces, applies multi-file code fixes, and re-tests until all tests pass.
4. **Environment & Dependency Validation:** Tests version compatibility by installing packages in its isolated VM and running runtime checks.

---

## 5. Execution Guardrails & Hard Limits

While 1 API request triggers an autonomous loop, Google builds physical circuit breakers into the environment to stop runaways:

### 1. Session Execution Timeouts
An interaction sent to `/v1beta/interactions` has a strict per-turn execution timeout (**5 to 10 minutes** of wall-clock time). If an agent gets stuck in a recursive loop, the remote sandbox forcefully terminates execution and returns partial logs.

### 2. Max Step Count (Loop Limits)
The agent harness caps internal tool cycles (typically **20–30 tool calls** like bash execution, file edits, or web fetches) per interaction request. Once it hits the turn limit, it stops, summarizes what it did, and waits for the next prompt.

### 3. Token Limits per Interaction (TPM)
Accumulating large file diffs and terminal output consumes token quota. Saturating Token Per Minute (TPM) limits or model context windows forces the interaction to halt or summarize early.

### 4. Sandbox Isolation & Local Filesystem Boundaries
The execution environment is a **sandboxed container in Google Cloud**, NOT your local machine:
- It cannot read or modify your local workstation's filesystem directly.
- Local hygiene tasks (like local `git status`, local `git push`, or modifying local `pyproject.toml`) require local agents (e.g. Pydantic AI with `GeminiModel` or LiteRouter).

---

## 6. Multi-Turn Architecture & State Persistence

To perform large tasks without hitting turn limits or execution timeouts, use a **sliced multi-turn loop** with `environment_id`:

```
[ User / Orchestrator ]
       │
       ├─► Turn 1: "Scan repository structure and generate a refactoring plan."
       │            └─► Returns Plan + environment_id: "env_abc123"
       │
       ├─► Turn 2: (pass environment_id: "env_abc123") "Execute phase 1: Refactor src/utils/."
       │            └─► Edits files & runs tests inside sandbox
       │
       └─► Turn 3: (pass environment_id: "env_abc123") "Execute phase 2: Update callers & verify build."
                    └─► Edits files & confirms clean build
```

### Passing `environment_id`
```json
{
  "agent": "antigravity-preview-05-2026",
  "input": "Now run npm test to verify the changes",
  "environment_id": "env_abc123"
}
```
Re-using `environment_id` keeps all installed dependencies, edited files, and workspace state intact across interaction calls.

---

## 7. Deterministic Orchestration & Artifact Extraction (PEP 723)

### A. Modular Research Prompt (`research_prompt.md`)
Separate prompt logic (Markdown instruction file) from execution logic (Python script):

```markdown
# Deep Research Task: [Insert Topic Here]

## Objective
Conduct a deep dive research into [Specific Topic, e.g., solid-state EV batteries]. 

## Scope & Steps
1. **Search & Scrape:** Find recent credible industry reports or technical articles.
2. **Synthesize:** Extract key players, technical bottlenecks, and commercialization timelines.
3. **Data Processing:** Run a Python script to format quantitative metrics into a structured markdown table.
4. **Output Generation:** Compile all findings into a comprehensive research report.

## Constraints
- Focus on data from 2024 to 2026.
- Ensure all factual claims are backed by source URLs.
```

### B. Python Orchestration Script (`run_research.py`)
Deterministic runner with PEP 723 metadata for `uv`:

```python
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai",
# ]
# ///

import base64
import os
import sys
from pathlib import Path
from google import genai
from google.genai.errors import APIError

PROMPT_FILE = "research_prompt.md"
OUTPUT_FILE = "research_report.md"
AGENT_ID = "antigravity-preview-05-2026"

def run_deep_research():
    if "GEMINI_API_KEY" not in os.environ and "LITEROUTER_AUTH_KEY" not in os.environ:
        print("Error: API Key environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    prompt_path = Path(PROMPT_FILE)
    if not prompt_path.exists():
        print(f"Error: Prompt file '{PROMPT_FILE}' not found.", file=sys.stderr)
        sys.exit(1)

    research_instructions = prompt_path.read_text(encoding="utf-8")
    print(f"[*] Loaded instructions from {PROMPT_FILE}")
    print(f"[*] Dispatching task to {AGENT_ID} (remote sandbox execution)...")

    client = genai.Client()

    try:
        interaction = client.interactions.create(
            agent=AGENT_ID,
            input=research_instructions,
            environment="remote",
        )

        # 1. Save main text output locally
        final_output = interaction.output_text or ""
        output_path = Path(OUTPUT_FILE)
        output_path.write_text(final_output, encoding="utf-8")
        print(f"[+] Text report saved to {OUTPUT_FILE}")

        # 2. Extract generated files/artifacts (CSVs, charts, images) from remote sandbox
        for i, output in enumerate(getattr(interaction, "outputs", [])):
            out_type = getattr(output, "type", "")
            if out_type in ["image", "file"]:
                file_name = getattr(output, "name", f"agent_artifact_{i}")
                data_b64 = getattr(output, "data", "")
                if data_b64:
                    with open(file_name, "wb") as f:
                        f.write(base64.b64decode(data_b64))
                    print(f"[+] Downloaded artifact from remote sandbox: {file_name}")

    except APIError as e:
        print(f"[!] API Error occurred: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[!] Unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    run_deep_research()
```

### C. Prompt Engineering Constraint Alternative
To avoid Base64 decoding, add this constraint to `research_prompt.md`:
> *"If you generate any data tables, CSVs, or code scripts, do NOT save them as separate files. Instead, print their raw contents directly inside markdown code blocks in your final text response."*

### D. Execution via `uv`
```bash
export GEMINI_API_KEY="your_api_key"
uv run run_research.py
```
