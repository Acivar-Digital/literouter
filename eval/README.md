# 🛡️ LiteRouter Model Evaluation Gauntlet

> **Pragmatic, Zero-Overhead Evaluation Harness for Real-World AI Agents & Web Generation**

LiteRouter's evaluation suite provides empirical, fail-fast verification of LLM capabilities across agentic coding, protocol resilience, streaming speed, and frontend website generation.

Unlike synthetic or heavyweight benchmarks (e.g. SWE-bench, HumanEval) that require multi-gigabyte Docker sandboxes, headless Chromium browsers, or hours of runtime, LiteRouter's gauntlet runs **100% natively in Bun in <60 seconds**.

---

## 🏛️ Architecture & The Three Pillars

```
eval/
├── eval.ts              # 🎯 Master Orchestrator (coordinates suites, outputs reports)
├── speed.ts             # ⚡ Speed & Latency Benchmark (TTFT, throughput, slot headroom)
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
| **⚡ Speed** | `eval/speed.ts` | Time to First Token (TTFT), tokens/sec throughput, concurrency slots | ~10–20s |
| **💻 Code & Agentic** | `eval/code.ts` | 12k context hydration, Pydantic schemas, 3-turn state loop, surgical `str_replace`, prompt injection | ~40–90s |
| **🌐 Web Frontend** | `eval/web.ts` | Semantic landmarks, responsive Tailwind grid collapse, React state hooks, code hygiene, WCAG a11y | ~60–120s |

---

## 🚀 Quickstart for Developers & Agents

### 1. Run the Full Gauntlet (Master Runner)
Run all 3 suites and generate an executive Markdown report card in `eval/reports/`:
```bash
bun run eval/eval.ts <model_name>
```

**Examples:**
```bash
# Evaluate Thinking Machines Inkling on OpenRouter
bun run eval/eval.ts thinkingmachines/inkling:free

# Evaluate Muse Spark on Zen Responses API
bun run eval/eval.ts muse-spark-1.3-contributor-free --wire rs

# Run with reasoning disabled for faster throughput
bun run eval/eval.ts thinkingmachines/inkling:free --reasoning none
```

### 2. Targeted Suite Runs
```bash
# Run only speed and web benchmarks
bun run eval/eval.ts <model_name> --suites speed,web

# Run isolated speed benchmark
bun run eval/speed.ts <model_name>

# Run isolated coding stage 4 (surgical patching)
bun run eval/code.ts <model_name> --stage 4

# Run isolated web stage 2 (mobile responsiveness)
bun run eval/web.ts <model_name> --stage 2
```

---

## 🧠 Architectural Role Classification

Based on empirical test scores, `eval/eval.ts` automatically classifies models into specific agent roles:

| Role | Required Qualifications | Typical Use Case |
|---|---|---|
| 🧠 **Orchestrator** | High Pydantic schema score, durable multi-turn state loop, precise surgical patch fidelity (`str_replace`) | Task decomposition, ticket generation, PR review, architecture design |
| 💻 **General Coder** | High surgical patch fidelity, zero package hallucinations, clean AST syntax | Implementing code changes, fixing bugs, refactoring modules |
| ⚡ **Explorer** | Fast TTFT (<2s), high streaming throughput (>100 tok/s), large context window | Codebase navigation, symbol search, log ingestion, read-only research |

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
