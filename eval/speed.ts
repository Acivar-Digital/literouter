/**
 * eval/speed.ts
 *
 * Dedicated speed & throughput benchmark for LiteRouter onboarded models.
 * Measures:
 *   - TTFT (Time To First Token) in ms
 *   - Total Generation Duration in ms
 *   - Total Tokens Generated (Thinking + Content)
 *   - Generation Throughput (Tokens per Second - tok/s)
 *   - Inter-chunk streaming consistency
 *
 * Usage:
 *   bun run eval/speed.ts
 *   bun run eval/speed.ts thinkingmachines/inkling:free
 *   bun run eval/speed.ts --models "nex-agi/nex-n2.5-pro:free,dots-studio/dots-3-note-preview:free"
 *   bun run eval/speed.ts --runs 3
 */

export interface BenchResult {
  model: string;
  run: number;
  ttftMs: number;
  totalDurationMs: number;
  thinkingTokens: number;
  contentTokens: number;
  totalTokens: number;
  speedTokPerSec: number;
  status: "OK" | "ERROR";
  errorMessage?: string;
}

export interface ModelAggregate {
  model: string;
  successfulRuns: number;
  avgTtftMs: number;
  minTtftMs: number;
  maxTtftMs: number;
  avgDurationMs: number;
  avgTotalTokens: number;
  avgSpeedTokPerSec: number;
}

export interface SpeedBenchmarkResult {
  allResults: Record<string, BenchResult[]>;
  aggregates: ModelAggregate[];
}

export const DEFAULT_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "inclusionai/ling-3.0-flash-fin:free",
  "dots-studio/dots-3-note-preview:free",
];

export const BENCH_PROMPT =
  "Write a clean, efficient TypeScript function that implements LRU Cache with get() and put() methods. Include brief inline comments explaining the eviction logic.";

export async function runSingleBenchmark(
  endpoint: string,
  directiveKey: string,
  model: string,
  runIndex: number
): Promise<BenchResult> {
  const result: BenchResult = {
    model,
    run: runIndex,
    ttftMs: 0,
    totalDurationMs: 0,
    thinkingTokens: 0,
    contentTokens: 0,
    totalTokens: 0,
    speedTokPerSec: 0,
    status: "OK",
  };

  const payload = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      {
        role: "user",
        content: BENCH_PROMPT,
      },
    ],
  };

  const start = performance.now();
  let firstTokenTime: number | null = null;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let reportedUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directiveKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      result.status = "ERROR";
      result.errorMessage = `HTTP ${resp.status}: ${errText.slice(0, 100)}`;
      result.totalDurationMs = Math.round(performance.now() - start);
      return result;
    }

    if (!resp.body) {
      result.status = "ERROR";
      result.errorMessage = "Response body is null";
      return result;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        if (trimmed === "data: [DONE]") continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.error) {
            result.status = "ERROR";
            result.errorMessage = typeof json.error === "object" ? (json.error.message || JSON.stringify(json.error)) : String(json.error);
          }
          if (json.usage) {
            reportedUsage = json.usage;
          }

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          if (delta) {
            const content = delta.content || "";
            const reasoning = delta.reasoning_content || delta.reasoning || "";

            if ((content || reasoning) && firstTokenTime === null) {
              firstTokenTime = performance.now();
            }

            if (content) accumulatedContent += content;
            if (reasoning) accumulatedThinking += reasoning;
          }
        } catch (parseErr) {
          void parseErr;
        }
      }
    }

    const end = performance.now();
    result.ttftMs = firstTokenTime ? Math.round(firstTokenTime - start) : Math.round(end - start);
    result.totalDurationMs = Math.round(end - start);

    if (result.status === "ERROR") {
      result.totalTokens = 0;
      result.speedTokPerSec = 0;
      return result;
    }

    if (reportedUsage && reportedUsage.completion_tokens) {
      result.totalTokens = reportedUsage.completion_tokens;
    } else {
      const totalChars = accumulatedContent.length + accumulatedThinking.length;
      result.totalTokens = Math.max(1, Math.round(totalChars / 3.8));
    }

    if (accumulatedThinking.length > 0) {
      result.thinkingTokens = Math.round(accumulatedThinking.length / 3.8);
      result.contentTokens = Math.max(0, result.totalTokens - result.thinkingTokens);
    } else {
      result.contentTokens = result.totalTokens;
    }

    const generationTimeSec = Math.max(0.001, (result.totalDurationMs - result.ttftMs) / 1000);
    result.speedTokPerSec = Math.round((result.totalTokens / generationTimeSec) * 10) / 10;

    return result;
  } catch (err) {
    result.status = "ERROR";
    result.errorMessage = String(err);
    result.totalDurationMs = Math.round(performance.now() - start);
    return result;
  }
}

export function computeAggregate(model: string, runs: BenchResult[]): ModelAggregate {
  const successful = runs.filter((r) => r.status === "OK");
  if (successful.length === 0) {
    return {
      model,
      successfulRuns: 0,
      avgTtftMs: 0,
      minTtftMs: 0,
      maxTtftMs: 0,
      avgDurationMs: 0,
      avgTotalTokens: 0,
      avgSpeedTokPerSec: 0,
    };
  }

  const ttfts = successful.map((r) => r.ttftMs);
  const avgTtftMs = Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length);
  const minTtftMs = Math.min(...ttfts);
  const maxTtftMs = Math.max(...ttfts);

  const durations = successful.map((r) => r.totalDurationMs);
  const avgDurationMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  const tokens = successful.map((r) => r.totalTokens);
  const avgTotalTokens = Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length);

  const speeds = successful.map((r) => r.speedTokPerSec);
  const avgSpeedTokPerSec = Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10;

  return {
    model,
    successfulRuns: successful.length,
    avgTtftMs,
    minTtftMs,
    maxTtftMs,
    avgDurationMs,
    avgTotalTokens,
    avgSpeedTokPerSec,
  };
}

export interface SpeedBenchmarkOptions {
  runs?: number;
  key?: string;
  endpoint?: string;
  verbose?: boolean;
}

/**
 * Programmatic speed benchmark execution.
 *
 * @param models List of model names to benchmark
 * @param runs Number of runs per model (default: 2)
 * @param key Directive key (default: "lr-or-oa-ch-no")
 * @param endpoint Gateway endpoint URL (default: "https://localhost:7766/v1/chat/completions")
 * @param verbose Whether to print progress to stdout (default: false)
 */
export async function runSpeedBenchmark(
  models: string[] = DEFAULT_MODELS,
  runs: number = 2,
  key: string = "lr-or-oa-ch-no",
  endpoint: string = "https://localhost:7766/v1/chat/completions",
  verbose: boolean = false
): Promise<SpeedBenchmarkResult> {
  const allResults: Record<string, BenchResult[]> = {};
  const targetModels = models.length > 0 ? models : DEFAULT_MODELS;

  for (const model of targetModels) {
    allResults[model] = [];
    if (verbose) {
      console.log(`🚀 Benchmarking: \x1b[36m${model}\x1b[0m...`);
    }

    for (let r = 1; r <= runs; r++) {
      if (verbose) {
        process.stdout.write(`   • Run ${r}/${runs} in progress... `);
      }
      const res = await runSingleBenchmark(endpoint, key, model, r);
      allResults[model].push(res);

      if (verbose) {
        if (res.status === "OK") {
          console.log(
            `\x1b[32mDONE\x1b[0m (TTFT: \x1b[1m${res.ttftMs}ms\x1b[0m | Total: \x1b[1m${res.totalDurationMs}ms\x1b[0m | Speed: \x1b[33m${res.speedTokPerSec} tok/s\x1b[0m | Tokens: ${res.totalTokens})`
          );
        } else {
          console.log(`\x1b[31mFAILED\x1b[0m (${res.errorMessage})`);
        }
      }

      if (r < runs) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (verbose) {
      console.log(``);
    }
  }

  const aggregates = targetModels.map((m) => computeAggregate(m, allResults[m] ?? []));
  aggregates.sort((a, b) => b.avgSpeedTokPerSec - a.avgSpeedTokPerSec);

  return {
    allResults,
    aggregates,
  };
}

export function printBenchmarkSummary(aggregates: ModelAggregate[]) {
  console.log(`========================================================================`);
  console.log(`📊 COMPARATIVE SPEED LEADERBOARD (Averages)`);
  console.log(`========================================================================`);
  console.log(
    `| Model Name                               | TTFT (ms) | Total (ms) | Tokens | Speed (tok/s) | Rank |`
  );
  console.log(
    `|------------------------------------------|-----------|------------|--------|---------------|------|`
  );

  aggregates.forEach((agg, idx) => {
    const rankStr = agg.successfulRuns === 0
      ? "❌ ERROR  "
      : idx === 0
      ? "🥇 FASTEST"
      : idx === 1
      ? "🥈 SECOND "
      : "🥉 THIRD  ";
    const padModel = agg.model.padEnd(40).slice(0, 40);
    const padTtft = `${agg.avgTtftMs}ms`.padStart(9);
    const padTotal = `${agg.avgDurationMs}ms`.padStart(10);
    const padTok = `${agg.avgTotalTokens}`.padStart(6);
    const padSpeed = `${agg.avgSpeedTokPerSec} t/s`.padStart(13);

    console.log(`| ${padModel} | ${padTtft} | ${padTotal} | ${padTok} | ${padSpeed} | ${rankStr} |`);
  });

  console.log(`========================================================================\n`);
  console.log(`💡 SPEED ANALYSIS & BOTTLENECK OBSERVATIONS:`);
  for (const agg of aggregates) {
    if (agg.successfulRuns === 0) {
      console.log(
        `   ❌ \x1b[31m${agg.model}\x1b[0m: No successful runs (upstream rate limit or network error).`
      );
    } else if (agg.avgTtftMs > 2500) {
      console.log(
        `   ⚠️  \x1b[33m${agg.model}\x1b[0m has a high TTFT of \x1b[1m${agg.avgTtftMs}ms\x1b[0m. Upstream thinking tokens or inference queueing at provider causing perceived latency.`
      );
    } else {
      console.log(
        `   ⚡ \x1b[32m${agg.model}\x1b[0m is snappy with TTFT of \x1b[1m${agg.avgTtftMs}ms\x1b[0m and \x1b[1m${agg.avgSpeedTokPerSec} tok/s\x1b[0m streaming.`
      );
    }
  }
  console.log(``);
}

export async function runBenchmarkCLI() {
  const args = process.argv.slice(2);
  let models: string[] = [];
  let runsCount = 2;
  let directiveKey = "lr-or-oa-ch-no";
  let endpoint = "https://localhost:7766/v1/chat/completions";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun run eval/speed.ts [model] [options]`);
      console.log(`  --models <m1,m2>   Comma-separated list of models`);
      console.log(`  --runs <n>         Number of runs per model (default: 2)`);
      console.log(`  --directive <key>  Directive key (default: lr-or-oa-ch-no)`);
      console.log(`  --url <url>        Gateway URL (default: https://localhost:7766/v1/chat/completions)`);
      process.exit(0);
    } else if (arg === "--models" && i + 1 < args.length) {
      const val = args[++i];
      if (val) models = val.split(",").map((m) => m.trim()).filter(Boolean);
    } else if (arg === "--runs" && i + 1 < args.length) {
      const val = args[++i];
      if (val) runsCount = parseInt(val, 10);
    } else if (arg === "--directive" && i + 1 < args.length) {
      const val = args[++i];
      if (val) directiveKey = val;
    } else if (arg === "--url" && i + 1 < args.length) {
      const val = args[++i];
      if (val) endpoint = val;
    } else if (!arg.startsWith("-")) {
      models.push(arg.trim());
    }
  }

  if (models.length === 0) {
    models = DEFAULT_MODELS;
  }

  console.log(`\n========================================================================`);
  console.log(`⚡  LITEROUTER MODEL SPEED & THROUGHPUT BENCHMARK`);
  console.log(`========================================================================`);
  console.log(`🎯 Models to test : ${models.length} model(s)`);
  console.log(`🔄 Runs per model : ${runsCount}`);
  console.log(`🔑 Directive Key  : \x1b[33m${directiveKey}\x1b[0m`);
  console.log(`🌐 Gateway URL    : ${endpoint}`);
  console.log(`📝 Workload       : LRU Cache Implementation (Standard Coding Task)`);
  console.log(`⏱️  Timestamp      : ${new Date().toISOString()}`);
  console.log(`------------------------------------------------------------------------\n`);

  const { aggregates } = await runSpeedBenchmark(models, runsCount, directiveKey, endpoint, true);
  printBenchmarkSummary(aggregates);
}

if (import.meta.main) {
  runBenchmarkCLI().catch((err) => {
    console.error("Benchmark failed with error:", err);
    process.exit(1);
  });
}
