/**
 * LiteRouter Domain-Partitioned Parallel Test Runner
 *
 * Slices tests into isolated domain subcommands and executes them
 * concurrently in parallel subprocesses via Bun.spawn.
 * Enforces strict output suppression: clean 1-line summary on pass,
 * isolated failure details (test name, diff, stack trace) on failure.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type DomainName =
  | "handlers"
  | "network"
  | "stream"
  | "engine"
  | "telemetry"
  | "legacy"
  | "core"
  | "eval";

export const DOMAINS: readonly DomainName[] = [
  "handlers",
  "network",
  "stream",
  "engine",
  "telemetry",
  "legacy",
  "core",
  "eval",
] as const;

export const UNIT_DOMAINS: readonly DomainName[] = [
  "handlers",
  "network",
  "stream",
  "engine",
  "telemetry",
  "legacy",
  "core",
] as const;

export interface RunTestsOptions {
  subcommand?: string;
  filter?: string;
  silent?: boolean;
}

export interface DomainRunResult {
  domain: string;
  files: string[];
  passed: number;
  failed: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  failureDetails?: string;
}

export interface RunTestsResult {
  success: boolean;
  totalPassed: number;
  totalFailed: number;
  domainCount: number;
  elapsedSec: number;
  summary: string;
  failures: string[];
  details: DomainRunResult[];
}

/**
 * Recursively scans directory for *.test.ts files.
 */
export function scanTestFiles(dir: string, baseDir: string = process.cwd()): string[] {
  const fullPath = join(baseDir, dir);
  if (!existsSync(fullPath)) {
    return [];
  }
  let results: string[] = [];
  const entries = readdirSync(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanTestFiles(rel, baseDir));
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(rel);
    }
  }
  return results.sort();
}

/**
 * Partitions tests into discrete domains.
 */
export function categorizeTests(baseDir: string = process.cwd()): Record<DomainName, string[]> {
  const unitFiles = scanTestFiles("tests/unit", baseDir);
  const evalFiles = scanTestFiles("tests/eval", baseDir);

  const domains: Record<DomainName, string[]> = {
    handlers: [],
    network: [],
    stream: [],
    engine: [],
    telemetry: [],
    legacy: [],
    core: [],
    eval: evalFiles,
  };

  const networkSpecific = new Set([
    "tests/unit/pacer.test.ts",
    "tests/unit/cooldown.test.ts",
    "tests/unit/pool.test.ts",
    "tests/unit/fetcher.test.ts",
    "tests/unit/pacer_cooldown_integration.test.ts",
    "tests/unit/gcp_pacer_conveyor.test.ts",
  ]);

  const streamSpecific = new Set([
    "tests/unit/midstream_retry.test.ts",
    "tests/unit/safe_close.test.ts",
    "tests/unit/tool_call_stream_regression.test.ts",
    "tests/unit/responses_transformer.test.ts",
    "tests/unit/thinking_transformer.test.ts",
    "tests/unit/thought_signature.test.ts",
    "tests/unit/gemma_transformer.test.ts",
    "tests/unit/ling_transformer.test.ts",
  ]);

  const assigned = new Set<string>();

  for (const file of unitFiles) {
    if (file.startsWith("tests/unit/handlers/")) {
      domains.handlers.push(file);
      assigned.add(file);
    } else if (file.startsWith("tests/unit/legacy/")) {
      domains.legacy.push(file);
      assigned.add(file);
    } else if (
      file.startsWith("tests/unit/engine/") ||
      file === "tests/unit/engine_dual_path.test.ts"
    ) {
      domains.engine.push(file);
      assigned.add(file);
    } else if (
      file.startsWith("tests/unit/telemetry/") ||
      file === "tests/unit/visual_telemetry.test.ts"
    ) {
      domains.telemetry.push(file);
      assigned.add(file);
    } else if (
      file.startsWith("tests/unit/network/") ||
      networkSpecific.has(file)
    ) {
      domains.network.push(file);
      assigned.add(file);
    } else if (
      file.startsWith("tests/unit/transformers/") ||
      streamSpecific.has(file) ||
      /^tests\/unit\/dots_.*\.test\.ts$/.test(file) ||
      /^tests\/unit\/gold_xml_.*\.test\.ts$/.test(file) ||
      /^tests\/unit\/test_.*xml.*\.test\.ts$/.test(file)
    ) {
      domains.stream.push(file);
      assigned.add(file);
    }
  }

  // All unassigned unit tests belong to core
  for (const file of unitFiles) {
    if (!assigned.has(file)) {
      domains.core.push(file);
    }
  }

  return domains;
}

/**
 * Extracts only failing test names, error diffs, and stack trace lines.
 * Suppresses passing noise, version headers, and runtime log lines.
 */
export function extractFailureOutput(stderr: string, stdout: string = ""): string {
  const combined = (stderr + "\n" + stdout).replace(/\r\n/g, "\n");
  const lines = combined.split("\n");
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Suppress passing assertions
    if (/^\(pass\)/.test(trimmed)) {
      continue;
    }

    // Suppress runtime server logger emojis unless error-related
    if (
      /^[🔄🟢🏁⚡⚠️🎯🤖🔵]/.test(trimmed) &&
      !trimmed.includes("error:") &&
      !trimmed.includes("(fail)")
    ) {
      continue;
    }

    // Suppress bun test banner
    if (/^bun test v[\d.]+/.test(trimmed)) {
      continue;
    }

    // Suppress generic summary line from bun test
    if (/^Ran \d+ tests across \d+ files/.test(trimmed)) {
      continue;
    }

    filtered.push(line);
  }

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Parses pass and fail test count from bun test output.
 */
function parseTestCounts(output: string): { passed: number; failed: number } {
  const passMatch = output.match(/(\d+)\s+pass/);
  const failMatch = output.match(/(\d+)\s+fail/);
  const passed = passMatch && passMatch[1] ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch && failMatch[1] ? parseInt(failMatch[1], 10) : 0;
  return { passed, failed };
}

/**
 * Programmatic test runner helper.
 * Executes domain slices in parallel subprocesses via Bun.spawn.
 */
export async function runTests(options: RunTestsOptions = {}): Promise<RunTestsResult> {
  const { subcommand, filter, silent = false } = options;
  const categorized = categorizeTests();
  const startTime = performance.now();

  // Determine domain targets or custom pattern
  let domainTargets: { domain: string; files: string[] }[] = [];
  let isCustomPattern = false;
  let customArgs: string[] = [];

  const rawTarget = subcommand?.trim().toLowerCase();

  if (DOMAINS.includes(rawTarget as DomainName)) {
    // Specific domain requested
    const dom = rawTarget as DomainName;
    let files = categorized[dom];
    if (filter) {
      const fLower = filter.toLowerCase();
      files = files.filter((p) => p.toLowerCase().includes(fLower));
    }
    domainTargets = [{ domain: dom, files }];
  } else if (!rawTarget || rawTarget === "all" || rawTarget === "unit") {
    if (filter) {
      // Global filter across all files
      isCustomPattern = true;
      const pattern = filter.trim();
      const allFiles = Object.values(categorized).flat();
      const matchedFiles = allFiles.filter((p) =>
        p.toLowerCase().includes(pattern.toLowerCase())
      );
      if (matchedFiles.length > 0) {
        domainTargets = [{ domain: `filter:${pattern}`, files: matchedFiles }];
      } else {
        domainTargets = [{ domain: `filter:${pattern}`, files: [] }];
        customArgs = [pattern];
      }
    } else {
      // Default: run the 7 unit domains in parallel
      domainTargets = UNIT_DOMAINS.map((d) => ({
        domain: d,
        files: categorized[d],
      }));
    }
  } else {
    // Custom filter/pattern mode from subcommand
    isCustomPattern = true;
    const pattern = subcommand || filter || "";
    const allFiles = Object.values(categorized).flat();
    const matchedFiles = allFiles.filter((p) =>
      p.toLowerCase().includes(pattern.toLowerCase())
    );

    if (matchedFiles.length > 0) {
      domainTargets = [{ domain: `pattern:${pattern}`, files: matchedFiles }];
    } else {
      // Pass directly to bun test
      domainTargets = [{ domain: `pattern:${pattern}`, files: [] }];
      customArgs = [pattern];
    }
  }

  // Execute subprocesses in parallel
  const execPromises = domainTargets.map(async (target): Promise<DomainRunResult> => {
    let spawnArgs: string[];
    if (isCustomPattern && customArgs.length > 0) {
      spawnArgs = ["bun", "test", ...customArgs];
    } else {
      if (target.files.length === 0) {
        return {
          domain: target.domain,
          files: [],
          passed: 0,
          failed: 0,
          exitCode: 0,
          stdout: "",
          stderr: "No matching test files found.",
        };
      }
      spawnArgs = ["bun", "test", ...target.files];
    }

    const proc = Bun.spawn(spawnArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const combinedOutput = stderr + "\n" + stdout;
    const { passed, failed } = parseTestCounts(combinedOutput);

    const result: DomainRunResult = {
      domain: target.domain,
      files: target.files,
      passed,
      failed,
      exitCode,
      stdout,
      stderr,
    };

    if (exitCode !== 0) {
      result.failureDetails = extractFailureOutput(stderr, stdout);
    }

    return result;
  });

  const details = await Promise.all(execPromises);
  const elapsedSec = (performance.now() - startTime) / 1000;

  const totalPassed = details.reduce((acc, d) => acc + d.passed, 0);
  const totalFailed = details.reduce((acc, d) => acc + d.failed, 0);
  const allExit0 = details.every((d) => d.exitCode === 0);
  const domainCount = details.length;

  const failures: string[] = [];
  for (const d of details) {
    if (d.exitCode !== 0 && d.failureDetails) {
      failures.push(`--- [${d.domain}] Failure ---\n${d.failureDetails}`);
    }
  }

  let summary: string;
  if (allExit0) {
    const domainText = domainCount === 1 ? "1 domain" : `${domainCount} domains`;
    summary = `✓ All tests passed (${totalPassed} tests across ${domainText} in ${elapsedSec.toFixed(2)}s)`;
    if (!silent) {
      console.log(summary);
    }
  } else {
    const domainText = domainCount === 1 ? "1 domain" : `${domainCount} domains`;
    summary = `✗ Tests failed: ${totalFailed} failed, ${totalPassed} passed across ${domainText} in ${elapsedSec.toFixed(2)}s`;
    if (!silent) {
      console.error(summary);
      for (const failMsg of failures) {
        console.error("\n" + failMsg);
      }
    }
  }

  return {
    success: allExit0,
    totalPassed,
    totalFailed,
    domainCount,
    elapsedSec,
    summary,
    failures,
    details,
  };
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const silent = args.includes("--silent");
  const nonFlags = args.filter((a) => !a.startsWith("-"));

  const subcommand = nonFlags[0];
  const filter = nonFlags[1];

  const result = await runTests({ subcommand, filter, silent });
  if (!result.success) {
    process.exit(1);
  }
}
