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
Default master runner executes the **3-wire sequential matrix** (Chat → Responses → Messages) and produces the **Consolidated Multi-Wire report** — a `# 🏛️ Consolidated Multi-Wire Evaluation Report: \`<model>\`` (`eval/eval.ts:1354`) containing a 3-column `📊 Cross-Wire Comparison Matrix` (Directive Key, Endpoint, Overall Verdict, Throughput Speed, Avg TTFT, Avg Latency, Code/Web Pass Rate, Wire Role — `eval/eval.ts:1403-1415`) plus one **Unified Role Recommendation** across all wires. This is the default because `parseCliArgs` defaults `allWires = true`. Pass `--wire <chat|rs|ms>` to narrow to a single wire instead.

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
# Speed & Latency ONLY (sequential TTFT, duration, tokens, tok/s — no concurrency)
bun run eval/eval.ts <model> <provider> <directive_key> --suites speed

# Isolated speed benchmark (speed.ts takes a bare model positional; no provider arg)
bun run eval/speed.ts <model> --directive lr-or-oa-ch-no

# Agentic Coding ONLY (Wire, Pydantic, Loop, str_replace, Security)
bun run eval/eval.ts <model> <provider> <directive_key> --suites code --continue

# Web Frontend ONLY (DOM layout, Responsive, State hooks, Hygiene, A11y)
bun run eval/eval.ts <model> <provider> <directive_key> --suites web --continue
```

### 3. Targeted Stage Debugging (Surgical Probe)
When isolating a specific stage (1–5) to diagnose a failure. `eval/code.ts` and `eval/web.ts` run the **same** `validateStrictEvalArgs` gate as `eval/eval.ts`, so they also require the `<model> <provider> <directive_key>` (or `<model> <directive_key>`) positional form — a bare `bun run eval/code.ts <model>` aborts with `Missing required argument #2: <provider>` (`eval/validate_cli.ts:563`).

```bash
# Isolated Coding Stage 4 (surgical str_replace indentation check)
bun run eval/code.ts <model> openrouter lr-or-oa-ch-no --stage 4

# Isolated Coding Stage 2 (Pydantic schema conformity)
bun run eval/code.ts <model> openrouter lr-or-oa-ch-no --stage 2

# Isolated Web Stage 2 (mobile grid collapse)
bun run eval/web.ts <model> openrouter lr-or-oa-ch-no --stage 2
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

> ⚠️ **Transcript support is NOT universal.** `--reasoning-transcript` / `--no-reasoning-transcript` exist on **`eval/eval.ts`** (default ON) and **`eval/code.ts`** (default ON). **`eval/web.ts` has zero transcript support** — those flags are not in its `--help` and passing them there has no effect. There is no transcript flag on `eval/speed.ts` either.

### 5. Flag Reference (verbatim from each script's `--help`)

`bun run eval/eval.ts --help`:
```
  --all-wires            Execute full 3-wire sequential matrix (Chat -> Responses -> Messages) (default)
  --suites <list>        Comma-separated benchmark suites to execute:
                         speed, code, web (default: speed,code,web)
  --url <url>            LiteRouter gateway endpoint URL (default: http://literouter.lan:7766)
  --wire <chat|rs|ms>    Wire protocol ('chat', 'rs'/'responses', 'messages'/'ms')
  --stage <n>            Run ONLY a specific stage (1-5) for code / web suites
  --reasoning <effort>   Reasoning effort for thinking models: none, medium, high
  --reasoning-transcript Preserve upstream thinking (ts-nuance key) and append transcripts
  --no-reasoning-transcript Scrub thinking, no transcript appendix
  --runs <n>             Number of benchmark iterations per test (default: 2)
  --continue             Continue suite execution on stage failure (Diagnostic Mode)
  --skip-report          Do not write Markdown report card to eval/reports/
  --image <path_or_url>  Custom image input for web vision-language evaluation
  -h, --help             Show this help manual and exit
```

`bun run eval/code.ts --help`:
```
  --wire <chat|rs>    Wire protocol ('chat' or 'rs'/'responses', auto-detected if omitted)
  --directive <key>   Directive key (default: lr-or-oa-ch-no for chat, lr-zn-oo-rs-no for responses)
  --url <url>         Gateway endpoint
  --stage <n>         Run ONLY a specific stage (1, 2, 3, 4, or 5)
  --continue          Do not abort on failure; run all stages (Diagnostic Mode)
  --runs <n>          Number of benchmark iterations (default: 2)
  --cooldown <ms>     Cooldown delay between stages in milliseconds (default: 2000)
  --timeout <ms>      Stage execution timeout in milliseconds (default: 120000)
  --reasoning-transcript    Preserve upstream thinking via ts-nuance key and capture
                            transcripts into the report appendix (default: ON)
  --no-reasoning-transcript Scrub thinking (default no-nuance key), no transcripts
  -h, --help          Show this help screen
```

`bun run eval/web.ts --help` (note: **no transcript flags**):
```
  --directive <key>     Gateway directive key (default: lr-or-oa-ch-no)
  --url <url>           Gateway chat completions URL (default: http://literouter.lan:7766/v1/chat/completions)
  --image <uri_or_path> Image input (URL, data URI, or path; defaults to internal SaaS dashboard SVG)
  --stage <n>           Run ONLY stage n (1 to 5)
  --continue            Run all stages even if failure occurs (diagnostic mode)
  --runs <n>            Number of test runs/iterations per check (default: 2)
  --cooldown <ms>       Cooldown delay between stages in milliseconds (default: 2000)
  --timeout <ms>        HTTP request timeout per stage in ms (default: 180000)
  --max-tokens <n>      Max completion tokens (default: 8192)
  --reasoning <effort>  Reasoning effort: high, medium, none
  -h, --help            Show this help menu and exit
```

`bun run eval/speed.ts --help`:
```
Usage: bun run eval/speed.ts [model] [options]
  --models <m1,m2>   Comma-separated list of models
  --runs <n>         Number of runs per model (default: 2)
  --directive <key>  Directive key (default: lr-or-oa-ch-no)
  --url <url>        Gateway URL (default: http://literouter.lan:7766/v1/chat/completions)
```

---

## §3. The Three Pillars Breakdown

```
eval/
├── speed.ts       # ⚡ Speed & Latency: sequential loop over models/runs measuring TTFT,
│                  #    total duration, token counts and tok/s. No concurrency, no parallel slots.
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

**Default output shape is the Consolidated Multi-Wire report** (3-column `📊 Cross-Wire Comparison Matrix` + one `🎯 Unified Role Recommendation`) because `parseCliArgs` defaults `allWires = true`; `--wire <chat|rs|ms>` narrows the run to a single wire.

Based on composite scores, models are assigned:
- 🧠 **Orchestrator**: High Pydantic score, robust 3-turn state loop, perfect surgical patch fidelity (`str_replace`).
- 💻 **General Coder**: High surgical patch fidelity, zero package hallucinations, clean AST syntax.
- ⚡ **Explorer**: The only **enforced** criterion is **TTFT < 2000 ms** (`EXPLORER_MAX_TTFT_MS`, `eval/eval.ts:63`), applied when picking the best Explorer wire across a multi-wire run (`eval/eval.ts:1298-1316`); throughput is a tie-breaker, not a threshold. There is **no** `>100 tok/s` gate and **no** context-window check in `eval/` — treat those as non-enforced qualitative guidance. Note the per-wire classifier ends in an **unconditional Explorer fallback** (`eval/eval.ts:605-615`) that inspects no speed data, so a single-wire run labels the wire Explorer by default.

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

# Narrow to a SINGLE wire instead of the default 3-wire matrix
bun run eval/eval.ts muse-spark-1.3-contributor-free zen lr-zn-oo-rs-no --wire rs --continue

# 2-positional form: provider is auto-inferred from the directive key
bun run eval/eval.ts thinkingmachines/inkling:free lr-or-oo-rs-no --continue

# Check gateway health before running
curl -s http://literouter.lan:7766/health
```
