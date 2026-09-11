# 📊 Model Evaluation Reports (`eval/reports/`)

> *"All models are wrong, but some are useful."* — **George E. P. Box**  
> *"So use our eval, we will tell you what is wrong."* — **Francis Yap**

> **Empirical Scorecards and Role Assignment Archives for LLMs Tested on LiteRouter**

This directory stores automatically generated Markdown report cards created by `eval/eval.ts`. Each report acts as an empirical audit artifact certifying a model's speed, agentic tool capabilities, and web frontend viability.

*(Note: This evaluation harness is just a small subset of what LiteRouter accomplishes as an industrial proxy, protocol sanitizer, and adaptive pacer—the prefix "Lite" is rapidly becoming an ironic misnomer!)*

---

## 🎯 Generating a Report Card
To benchmark a model and generate a report card:
```bash
# Run the complete gauntlet (speed, code, and web)
bun run eval/eval.ts <model_name>
```
The report will be automatically written to `eval/reports/<sanitized_model_name>.md`.

---

## 📋 Report Card Schema

Each report contains 4 core sections:

```markdown
# 🏅 Model Evaluation Card: [model_id]
- **Date**: 2026-09-11 01:20:00 UTC
- **Gateway Directive**: `lr-or-oa-ch-no` | `lr-zn-oo-rs-no`
- **Wire Protocol**: OpenAI Chat Completions | OpenAI Responses API
- **Overall Verdict**: `PRODUCTION READY` | `EXPLORE ONLY` | `REJECTED`

## 1. Architectural Role Recommendation
- [ ] 🧠 **Orchestrator**: Recommended for high-level planning, Pydantic validation, and PR reviews.
- [x] 💻 **General Coder**: Recommended for active file writing and surgical `str_replace` editing.
- [ ] ⚡ **Explorer**: Recommended for read-only symbol navigation and high-throughput search.

## 2. Speed & Throughput Benchmark
| TTFT (ms) | Speed (tok/s) | Total Latency (ms) |
|---|---|---|
| 1,210 ms  | 45.2 tok/s    | 4,500 ms           |

## 3. Agentic & Coding Capabilities (`eval/code.ts`)
| Stage | Score | Status | Findings |
|---|:---:|:---:|---|
| Stage 1: Wire & 12k Hydration | 100/100 | PASS | Native tool calls, hydrated 12k context |
| Stage 2: Pydantic AI Schemas  | 100/100 | PASS | Self-corrected validation retry |
| Stage 3: Dynamic State Loop   | 90/100  | PASS | Synthesized observation on Turn 2 |
| Stage 4: Surgical Patching    | 100/100 | PASS | Exact 6-space indentation matched |
| Stage 5: Prompt Injection     | 100/100 | PASS | Threat neutralized |

## 4. Web Frontend Engineering (`eval/web.ts`)
| Stage | Score | Status | Findings |
|---|:---:|:---:|---|
| Stage 1: DOM Hierarchy       | 100/100 | PASS | 5/5 landmarks, CSS grid detected |
| Stage 2: Mobile Responsive   | 100/100 | PASS | Fluid containers, 3-col collapse |
| Stage 3: React State Logic   | 90/100  | PASS | 5 useState hooks, controlled inputs |
| Stage 4: Code Hygiene        | 100/100 | PASS | 0 placeholders, 0 fake packages |
| Stage 5: Accessibility (WCAG)| 100/100 | PASS | Accessible modal dialog, label bindings |
```

---

## 🏆 Hall of Fame (Tested Models)

| Model | Recommended Role | Web Score | Code Score | Speed (tok/s) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| **`muse-spark-1.3-contributor-free`** (Zen) | 🧠 Orchestrator / 💻 Coder | **98 / 100** | **100 / 100** | ~35 tok/s | Top web builder; requires high output token headroom (`output: 65536`). |
| **`thinkingmachines/inkling:free`** (OpenRouter) | ⚡ Explorer | **70 / 100** | **53 / 100** | **201.1 tok/s** | 1M context, blazing 200 tok/s reading speed. Weak on surgical patch diffs. |
| **`inclusionai/ling-3.0-flash-vl:free`** (OpenRouter) | ⚡ Explorer / Visual Scout | **77 / 100** | **70 / 100** | ~45 tok/s | Fast 1.5s TTFT, good visual understanding of screenshots. |
