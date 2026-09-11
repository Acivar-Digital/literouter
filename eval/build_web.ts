#!/usr/bin/env bun
/**
 * eval/build_web.ts
 *
 * Backward-compatibility forwarding stub.
 * Delegates directly to eval/web.ts.
 */

export * from "./web";
export { runWebEvaluation as default } from "./web";

import { main } from "./web";

if (import.meta.main) {
  main().catch((err) => {
    console.error("\x1b[31mExecution error in build_web stub:\x1b[0m", err);
    process.exit(1);
  });
}
