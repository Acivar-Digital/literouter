/**
 * scripts/bench_speed.ts
 *
 * Backward-compatibility forwarding stub.
 * Canonical implementation has moved to eval/speed.ts.
 *
 * Usage:
 *   bun run scripts/bench_speed.ts [model] [options]
 */

import { runBenchmarkCLI } from "../eval/speed";

export * from "../eval/speed";

if (import.meta.main) {
  runBenchmarkCLI().catch((err) => {
    console.error("Benchmark failed with error:", err);
    process.exit(1);
  });
}
