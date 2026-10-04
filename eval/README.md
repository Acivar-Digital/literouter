# 🛡️ LiteRouter Model Evaluation Gauntlet

> *"All models are wrong, but some are useful."* — **George E. P. Box**  
> *"So use our eval, we will tell you what is wrong."* — **Francis Yap**

> **Pragmatic, Zero-Overhead Evaluation Harness for Real-World AI Agents & Web Generation**

LiteRouter's evaluation suite provides empirical, fail-fast verification of LLM capabilities across agentic coding, protocol resilience, streaming speed, and frontend website generation.

> ℹ️ **Scope & The "Lite" Irony:**  
> This evaluation gauntlet is merely a targeted subset of LiteRouter's broader mission. LiteRouter operates as an industrial-grade multi-provider gateway, intelligent pacer, protocol scrubber, key rotator, circuit breaker, and sticky fallback orchestrator. Given the depth of its proxy architecture and autonomous agent routing, the name **"Lite"Router** is becoming delightfully ironic.

Unlike synthetic or heavyweight benchmarks (e.g. SWE-bench, HumanEval) that require multi-gigabyte Docker sandboxes, headless Chromium browsers, or hours of runtime, LiteRouter's gauntlet runs **100% natively in Bun in <60 seconds**.

---

## 🏛️ Architecture & The Three Pillars

```
eval/
├── eval.ts              # 🎯 Master Orchestrator (coordinates suites, outputs reports)
├── speed.ts             # ⚡ Speed & Latency Benchmark (TTFT, duration, tokens, tok/s — sequential runs, no concurrency slots)
├── code.ts              # 💻 5-Stage Agentic & Coding Harness (Chat + Responses API)
├── web.ts               # 🌐 5-Stage Web Vision-Language Harness (AST & DOM audit)
├── stages/              # Coding stages (Wire, Pydantic, Loop, str_replace, Security)
├── stages_rs/           # OpenAI Responses API (/v1/responses) stage variants
├── stages_web/          # Web generation stages (Structure, Responsive, State, Hygiene, A11y)
└── reports/             # Generated Markdown model report cards
```

### The Three Pillars

| Suite | Entry Point | Target Capabilities | Runtime |
|---|---|---|:---:|
| **⚡ Speed** | `eval/speed.ts` | Time to First Token (TTFT), total duration, token counts, tokens/sec throughput. Sequential loop over models/runs — **no concurrency or slot headroom** | ~10–20s |
| **💻 Code & Agentic** | `eval/code.ts` | 12k context hydration, Pydantic schemas, 3-turn state loop, surgical `str_replace`, prompt injection | ~40–90s |
| **🌐 Web Frontend** | `eval/web.ts` | Semantic landmarks, responsive Tailwind grid collapse, React state hooks, code hygiene, WCAG a11y | ~60–120s |

---

## 🚀 Quickstart for Developers & Agents

### 1. Run the Full Gauntlet (Master Runner)
`eval/eval.ts` requires **three positional arguments in exact order** — `<model_name> <provider> <api_key>` — or a **2-positional form** `<model_name> <directive_key>` (provider auto-inferred from the key), or a **file path** pointing at a model list. A bare `bun run eval/eval.ts <model_name>` aborts with `Missing required argument #2: <provider>` (`eval/validate_cli.ts:563`).

Run all 3 suites and generate a report card in `eval/reports/`:
```bash
# 3-positional form (provider + directive key explicit)
bun run eval/eval.ts thinkingmachines/inkling:free openrouter lr-or-oa-ch-no

# 2-positional form (provider inferred from the directive key)
bun run eval/eval.ts muse-spark-1.3-contributor-free lr-zn-oo-rs-no

# Explicit single wire instead of the default 3-wire matrix
bun run eval/eval.ts muse-spark-1.3-contributor-free zen lr-zn-oo-rs-no --wire rs

# Run with reasoning disabled for faster throughput
bun run eval/eval.ts thinkingmachines/inkling:free openrouter lr-or-oa-ch-no --reasoning none
```

> ℹ️ **Default output is the Consolidated Multi-Wire report**, not a single executive summary: `parseCliArgs` defaults `allWires = true` (`eval/eval.ts`), so a bare run executes the 3-wire sequential matrix (Chat → Responses → Messages) and writes `# 🏛️ Consolidated Multi-Wire Evaluation Report: \`<model>\`` (`eval/eval.ts:1354`) with a 3-column `📊 Cross-Wire Comparison Matrix` (`eval/eval.ts:1403-1406`) plus a unified role recommendation. Pass `--wire <chat|rs|ms>` to narrow execution to a single wire.

### 2. Master Runner Flags (verbatim from `--help`)
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

### 3. Targeted Suite Runs
`eval/code.ts` and `eval/web.ts` run the **same** `validateStrictEvalArgs` gate as `eval/eval.ts` and therefore also require the `<model> <provider> <api_key>` (or `<model> <directive_key>`) positional form. `eval/speed.ts` does **not** use that gate — it takes a bare `<model>` positional plus `--models`.
```bash
# Master runner, suites subset
bun run eval/eval.ts <model_name> <provider> <directive_key> --suites speed,web

# Isolated speed benchmark (speed.ts takes a bare model positional)
bun run eval/speed.ts <model_name> --runs 2

# Isolated coding stage 4 (surgical patching)
bun run eval/code.ts <model_name> <provider> <directive_key> --stage 4

# Isolated web stage 2 (mobile responsiveness)
bun run eval/web.ts <model_name> <provider> <directive_key> --stage 2
```

### 4. Isolated-Suite Flags (verbatim from `--help`)
`eval/code.ts` — note it **does** support transcript capture (`--reasoning-transcript` is default-ON):
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

`eval/web.ts` — **`web.ts` has no transcript support at all** (zero occurrences of `transcript` in `eval/web.ts`), so `--reasoning-transcript` / `--no-reasoning-transcript` are **not** valid `web.ts` flags:
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

`eval/speed.ts`:
```
Usage: bun run eval/speed.ts [model] [options]
  --models <m1,m2>   Comma-separated list of models
  --runs <n>         Number of runs per model (default: 2)
  --directive <key>  Directive key (default: lr-or-oa-ch-no)
  --url <url>        Gateway URL (default: http://literouter.lan:7766/v1/chat/completions)
```

---

## 🧠 Architectural Role Classification

Based on empirical test scores, `eval/eval.ts` automatically classifies models into specific agent roles:

| Role | Required Qualifications | Typical Use Case |
|---|---|---|
| 🧠 **Orchestrator** | High Pydantic schema score, durable multi-turn state loop, precise surgical patch fidelity (`str_replace`) | Task decomposition, ticket generation, PR review, architecture design |
| 💻 **General Coder** | High surgical patch fidelity, zero package hallucinations, clean AST syntax | Implementing code changes, fixing bugs, refactoring modules |
| ⚡ **Explorer** | **Enforced (multi-wire path): TTFT < 2000 ms.** A wire qualifies only if `tokPerSec > 0 && ttftMs > 0 && ttftMs < EXPLORER_MAX_TTFT_MS` (`eval/eval.ts:63` constant, skip condition at `eval/eval.ts:1312`); among qualifying wires the highest tok/s wins. Throughput is a **tie-breaker only** — there is **no** `>100 tok/s` threshold and **no** context-window check anywhere in `eval/`. Context window and high sustained throughput are **non-enforced qualitative guidance** only. | Codebase navigation, symbol search, log ingestion, read-only research |

> ℹ️ **Single-wire path caveat:** per-wire role classification in `determineArchitecturalRole` (`eval/eval.ts:512`) ends in an **unconditional Explorer fallback** (`eval/eval.ts:605-615`) that inspects no speed or TTFT data. The 2000 ms gate lives only in the cross-wire "Best Wire for Explorer" selection (`eval/eval.ts:1298-1316`), which runs after all wires have been evaluated.
>
> ℹ️ **The code comment at `eval/eval.ts:58-62` explicitly defers to this README's Explorer row** ("Fast TTFT (<2s)"), which is why the 2000 ms ceiling exists at all.

---

## 🤝 Call for Community Contributions

**This harness is an MVP (Minimum Viable Product) designed to be extended.** We welcome PRs proposing more rigorous tests, additional stages, and edge-case assertions!

### How to Add a New Stage:
Each stage implements a standardized interface:
```typescript
export interface StageResult {
  stage: number;
  name: string;
  passed: boolean;
  score: number; // 0 to 100
  durationMs: number;
  notes: string[];
  details: Record<string, unknown>;
}
```

1. **Agentic / Coding Stage**: Add `eval/stages/stage6_<name>.ts` exporting `runStage6(ctx: StageContext): Promise<StageResult>`.
2. **Web Generation Stage**: Add `eval/stages_web/stage6_<name>.ts` exporting `runStage6(ctx: StageContext): Promise<StageResult>`.
3. Register the new stage in `eval/code.ts` or `eval/web.ts`.
4. Run `bun test && bun run typecheck` to verify.
