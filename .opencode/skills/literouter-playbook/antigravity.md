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
