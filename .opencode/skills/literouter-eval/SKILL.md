---
name: literouter-eval
description: Empirical Model Evaluation Gauntlet for LiteRouter. Instant operational runbook for benchmarking, testing, and profiling any LLM model across Speed, Agentic Coding, and Web Frontend pillars natively in Bun against http://literouter.lan:7766. Use whenever asked to test, evaluate, benchmark, run gauntlet, or profile a model.
---

# Skill: literouter-eval

> **TARGET AUDIENCE**: Any AI agent or developer in this repository tasked with testing, evaluating, benchmarking, or profiling an LLM.
>
> **CORE OBJECTIVE**: **ZERO FILE-READING REFLEX**. When given a model name (e.g. `stealth/space-bunny-alpha`), execute the exact CLI command immediately with the right provider, directive key, and flags.

---

## ⛔ Absolute Invariants

1. **NEVER USE `localhost`**: The LiteRouter gateway host is ALWAYS:
   $$\mathbf{http://literouter.lan:7766}$$
   (All evaluation scripts automatically default to this base URL).
2. **NEVER DIG THROUGH SOURCE CODE**: All provider mappings, directive keys, and CLI switches are codified below in §1 and §2.
3. **ALWAYS USE `--continue` IN PREVIEWS**: Stealth / free preview models can have transient drops; `--continue` ensures every stage executes and reports empirical scores.

---

## §1. Instant Provider & Directive Key Lookup

Identify the provider from the model identifier:

| Target Model Format | Provider Slug | Directive Key | Full Command Template |
|---|---|---|---|
| Vendor prefix (`stealth/*`, `thinkingmachines/*`, `poolside/*`, `anthropic/*`, `meta-llama/*`, `*:free`, etc.) | `openrouter` | `lr-or-oa-ch-no` | `bun run eval/eval.ts <model> openrouter lr-or-oa-ch-no --continue` |
| Google Gemini (`gemini-3.5-flash-lite`, `gemini-2.5-flash`, etc.) | `google` | `lr-gg-gg-gc-no` | `bun run eval/eval.ts <model> google lr-gg-gg-gc-no --continue` |
| NVIDIA NIM (`meta/llama-3.3-70b-instruct`, etc.) | `nvidia` | `lr-nv-oa-ch-no` | `bun run eval/eval.ts <model> nvidia lr-nv-oa-ch-no --continue` |
| Zen models (`muse-*`, `zen/*`) | `zen` | `lr-zn-cl-ms-no` | `bun run eval/eval.ts <model> zen lr-zn-cl-ms-no --continue` |
| GCP Vertex AI | `gcp` | `lr-gc-oa-ch-no` | `bun run eval/eval.ts <model> gcp lr-gc-oa-ch-no --continue` |

> 💡 **Directive Key Decoder**:
> - `lr`: LiteRouter prefix
> - `or` / `gg` / `nv` / `zn` / `gc`: Provider code (OpenRouter, Google, NVIDIA, Zen, GCP)
> - `oa` / `gg` / `cl`: Client format (OpenAI, Google GenAI, Claude)
> - `ch` / `rs` / `ms`: Wire protocol (`ch` = chat completions, `rs` = responses, `ms` = messages)
> - `no` / `ts`: Reasoning mode (`no` = default, `ts` = transcript nuance / preservation)

---

## §2. Canonical Execution Commands

### 1. Full 3-Pillar Gauntlet (Speed + Code + Web)
Default master runner executes all 3 suites sequentially and produces an executive markdown report:

```bash
# General OpenRouter model (e.g. stealth/space-bunny-alpha)
bun run eval/eval.ts stealth/space-bunny-alpha openrouter lr-or-oa-ch-no --continue

# Google native model
bun run eval/eval.ts gemini-3.5-flash-lite google lr-gg-gg-gc-no --continue

# NVIDIA model
bun run eval/eval.ts meta/llama-3.3-70b-instruct nvidia lr-nv-oa-ch-no --continue
```

### 2. Isolated Suite Execution
When asked to test only a specific pillar:

```bash
# Speed & Latency ONLY (TTFT, tok/s, concurrency)
bun run eval/eval.ts <model> <provider> <directive_key> --suites speed

# Agentic Coding ONLY (Wire, Pydantic, Loop, str_replace, Security)
bun run eval/eval.ts <model> <provider> <directive_key> --suites code --continue

# Web Frontend ONLY (DOM layout, Responsive, State hooks, Hygiene, A11y)
bun run eval/eval.ts <model> <provider> <directive_key> --suites web --continue
```

### 3. Targeted Stage Debugging (Surgical Probe)
When isolating a specific stage (1–5) to diagnose a failure:

```bash
# Isolated Coding Stage 4 (surgical str_replace indentation check)
bun run eval/code.ts <model> --stage 4 --directive lr-or-oa-ch-no

# Isolated Coding Stage 2 (Pydantic schema conformity)
bun run eval/code.ts <model> --stage 2 --directive lr-or-oa-ch-no

# Isolated Web Stage 2 (mobile grid collapse)
bun run eval/web.ts <model> --stage 2 --directive lr-or-oa-ch-no
```

### 4. Reasoning & Thinking Controls
For reasoning / thinking models:

```bash
# Force disable thinking (for maximum tok/s throughput)
bun run eval/eval.ts <model> <provider> <key> --reasoning none --continue

# Moderate thinking effort
bun run eval/eval.ts <model> <provider> <key> --reasoning medium --continue

# Maximum thinking effort
bun run eval/eval.ts <model> <provider> <key> --reasoning high --continue

# Preserve thinking transcript in output report
bun run eval/eval.ts <model> <provider> lr-or-oa-ch-ts --reasoning-transcript --continue
```

---

## §3. The Three Pillars Breakdown

```
eval/
├── speed.ts       # ⚡ Speed & Latency: TTFT (<2s target), tok/s (>30 target)
├── code.ts        # 💻 Agentic Coding (5 Stages):
│                  #    Stage 1: Wire & Protocol resilience
│                  #    Stage 2: Pydantic Schema fidelity
│                  #    Stage 3: Multi-turn State loop (3 turns)
│                  #    Stage 4: Surgical Patching (`str_replace` indentation preservation)
│                  #    Stage 5: Security / Indirect Prompt Injection defense
└── web.ts         # 🌐 Web Frontend (5 Stages):
                   #    Stage 1: DOM structure & visual layout fidelity
                   #    Stage 2: Mobile & desktop Tailwind grid collapse
                   #    Stage 3: React interactive state & event hooks
                   #    Stage 4: Code hygiene (zero hallucinated packages, zero TODOs)
                   #    Stage 5: Semantic ARIA accessibility & WCAG compliance
```

---

## §4. Output Reports & Role Classification

Reports are automatically generated and saved to:
`eval/reports/<sanitized_model_name>.md`

Based on composite scores, models are assigned:
- 🧠 **Orchestrator**: High Pydantic score, robust 3-turn state loop, perfect surgical patch fidelity (`str_replace`).
- 💻 **General Coder**: High surgical patch fidelity, zero package hallucinations, clean AST syntax.
- ⚡ **Explorer**: Fast TTFT (<2s), high streaming throughput (>100 tok/s), large context window.

---

## §5. Copy-Paste Cheat Sheet for Common Commands

```bash
# Batch mode: reads eval/reports/test-models.txt and runs multi-wire matrix for all models
bun run eval/eval.ts --continue

# Test stealth/space-bunny-alpha (OpenRouter)
bun run eval/eval.ts stealth/space-bunny-alpha openrouter lr-or-oa-ch-no --continue

# Test thinkingmachines/inkling:free (OpenRouter)
bun run eval/eval.ts thinkingmachines/inkling:free openrouter lr-or-oa-ch-no --continue

# Test gemini-3.5-flash-lite (Google AI Studio)
bun run eval/eval.ts gemini-3.5-flash-lite google lr-gg-gg-gc-no --continue

# Check gateway health before running
curl -s http://literouter.lan:7766/health
```
