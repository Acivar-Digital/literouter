# 🪦 LLM "Response Healing" Proposal — App-Layer Advice, Not Gateway-Layer

**Status**: 🪦 **Canned — out of gateway scope**
**Captured**: 2026-07-17
**Source**: User-pasted generic blueprint ("implement jsonrepair + Zod + reflection loop + zod-stream in your Bun router").
**Why this file exists**: A critical review concluded the proposal is **application-layer structured-output logic**, not proxy-layer logic. LiteRouter is a **transparent proxy** — it owns no client schema, no prompt, and streams bytes through. Recorded so it is NOT re-litigated.

---

## The proposal (paraphrased)

1. **Syntactic healing** — `jsonrepair` on raw response, strip markdown fences, close truncated JSON.
2. **Structural healing** — Zod `safeParse` with `z.coerce` / `.default()` / `.catch()` to "fix" types.
3. **Feedback healing** — on Zod failure, re-prompt the LLM with the `ZodError.issues` and retry (reflection loop).
4. **Streaming healing** — `zod-stream` / `partial-json-parser` to validate/emit partial objects mid-stream.
5. **Architectural robustness** — force native tool/function calling; `zodsheriff` to prune invalid schema parts.
6. **Recommended stack** — `zod` + `jsonrepair` + `zod-stream` + `zod-to-prompt`.

---

## Verdict by section (grounded in `src/index.ts`)

| Section | Reality in LiteRouter | Verdict |
| :--- | :--- | :--- |
| 1. `jsonrepair` | Proxy parses response JSON in **one** place only — the streaming `TransformStream` (`src/index.ts:555`) that rewrites `reasoning_content`→`<thought>` and re-emits deltas. It does **not** reconstruct/validate full objects. Buffering whole bodies to repair adds a latency tax on **all** traffic and is impossible for streaming. | 🪦 Reject — violates transparent-proxy + fail-loud; would corrupt provider-specific fields (e.g. our `thought_signature` re-injection). |
| 2. Zod structural | Gateway has **no client schema** — `models.json` is a registry, not an output contract. | 🪦 Reject — app-layer concern. |
| 3. Reflection loop | Gateway owns no message history and no prompt to resend. | 🪦 Reject — architecturally impossible at proxy layer. |
| 4. Streaming heal | Streaming is a chunk-by-chunk `TransformStream` passthrough. Buffering to rebuild partial objects kills the streaming guarantee. | 🪦 Reject — app-layer concern. |
| 5. Forced tool-calling | Native tool/function calling already passes through transparently (Google `thought_signature` handling). `zodsheriff` needs a schema. | ✅ Already-supported / N/A. |
| 6. Stack | All libs (`zod`, `jsonrepair`, `zod-stream`, `zod-to-prompt`) are app-layer; none belong in the proxy. | 🪦 Reject. |

---

## Net

The blueprint conflates "router" (proxy) with "application using an LLM." Its one honest nugget — *forced tool-calling beats free-form JSON* — is a **prompt-design rule for the calling app**, not something the gateway implements, and native tool calls already pass through.

**Do not re-litigate.** LiteRouter stays a transparent, fail-loud proxy. Output-contract enforcement (jsonrepair/Zod/reflection) is the **client app's** job.
