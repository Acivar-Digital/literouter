# 🪦 anyio (Python async abstraction)

**Status**: 🪦 **Canned**

## Context

anyio is a Python async I/O abstraction layer — a portable API over `asyncio`
and `trio` (plus threading helpers), letting you write async code that runs on
either event loop. A user asked whether LiteRouter should adopt it.

Investigation of the repo:

- The gateway itself is **Bun/TypeScript** (`src/index.ts`) — it uses Bun's
  native `fetch`/streams, not Python async. anyio (a Python library) cannot
  apply to the gateway at all.
- The only Python left is thin glue: pytest smoke tests (`tests/integration/`)
  and admin scripts (`scripts/`, `admin/`). No long-running async service.
- anyio is already present in `.venv/` — but **only as a transitive
  dependency** pulled in by `pydantic-ai>=2.4.0`, which uses anyio as its
  async backend. There is **zero** `import anyio` in our own code.
- The Python test side already works with `pytest-asyncio`; no trio/asyncio
  portability requirement exists.

## Decision — Canned

We will **not** promote anyio to a direct dependency or write any anyio-based
code. Reasons:

1. **Wrong runtime:** the gateway is TS/Bun. anyio is Python-only and has no
   surface there.
2. **YAGNI / speculative architecture (AGENTS.md):** there is no code that
   needs asyncio/trio portability. Adding it "just to use it" is exactly the
   future-proofing the repo forbids.
3. **Transitive, not needed directly:** it rides in via pydantic-ai. No reason
   to pin or import it ourselves.

The only hypothetical where anyio would be the right tool — Python integration
tests that must run identically under both `asyncio` and `trio` — does not
apply; `pytest-asyncio` is sufficient and already wired.

## Rejected Options

- Promote anyio to a direct dependency — rejected (no consumer in our code).
- Rewrite Python tests/scripts on anyio's portable API — rejected (YAGNI;
  `pytest-asyncio` + `httpx` already cover the smoke-test needs).
- Use anyio for the gateway — rejected (gateway is not Python).
