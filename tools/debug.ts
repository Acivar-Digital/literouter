import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Configuration
const DEBUG_MODE = (Bun.env.DEBUG ?? "").toLowerCase();
const IS_ENABLED = DEBUG_MODE === "on" || DEBUG_MODE === "true" || DEBUG_MODE === "1";
const LOG_FILE_PATH = Bun.env.DEBUG_LOG_FILE ?? "./logs/network-debug.log";
const TARGET_URL = Bun.env.DEBUG_TARGET_URL ?? "https://api.openai.com/v1/models";
const REQUEST_INTERVAL_MS = Number.parseInt(Bun.env.DEBUG_INTERVAL_MS ?? "1000", 10);
const AUTH_HEADER = Bun.env.DEBUG_AUTH_HEADER ?? (Bun.env.OPENAI_API_KEY ? `Bearer ${Bun.env.OPENAI_API_KEY}` : "");

if (!IS_ENABLED) {
  console.log("ℹ️  DEBUG mode is OFF. Set DEBUG=on in your .env or environment to activate network telemetry.");
  process.exit(0);
}

// Ensure logs directory exists
await mkdir(dirname(LOG_FILE_PATH), { recursive: true });

// Initialize high-performance Bun File Writer
const fileHandle = Bun.file(LOG_FILE_PATH);
const writer = fileHandle.writer();

function extractHeader(headers: Headers, candidates: readonly string[]): string {
  for (const name of candidates) {
    const val = headers.get(name);
    if (val) {
      return `${name}=${val}`;
    }
  }
  return "none";
}

async function logEntry(entry: string): Promise<void> {
  const line = `${entry}\n`;
  writer.write(line);
  await writer.flush();
  process.stdout.write(line);
}

// Graceful cleanup on termination
let isRunning = true;
const shutdown = async () => {
  if (!isRunning) return;
  isRunning = false;
  await logEntry(`[${new Date().toISOString()}] Telemetry session ended. Flushing buffers.`);
  await writer.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await logEntry(`[${new Date().toISOString()}] 🚀 Network Telemetry Watcher Started`);
await logEntry(`[${new Date().toISOString()}] Target: ${TARGET_URL} | Interval: ${REQUEST_INTERVAL_MS}ms | Log: ${LOG_FILE_PATH}`);

let sequence = 0;

while (isRunning) {
  sequence += 1;
  const start = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Bun-Network-Telemetry/1.0",
      "Accept": "application/json",
    };
    if (AUTH_HEADER) {
      headers["Authorization"] = AUTH_HEADER;
    }

    const response = await fetch(TARGET_URL, {
      method: "GET",
      headers,
    });

    const durationMs = Math.round(performance.now() - start);

    // Extract Upstream Node Identifiers
    const nodeHeader = extractHeader(response.headers, [
      "cf-ray",
      "x-amz-cf-id",
      "x-served-by",
      "x-backend-server",
      "server",
      "x-envoy-upstream-service-time",
      "via",
    ]);

    // Extract Rate Limit Headers
    const remainingHeader = extractHeader(response.headers, [
      "x-ratelimit-remaining",
      "ratelimit-remaining",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-remaining-tokens",
    ]);

    const resetHeader = extractHeader(response.headers, [
      "x-ratelimit-reset",
      "ratelimit-reset",
      "x-ratelimit-reset-requests",
      "retry-after",
    ]);

    const statusTag = response.status === 429
      ? "🚨 429 TOO MANY REQUESTS"
      : response.ok
      ? `✅ ${response.status} OK`
      : `⚠️ ${response.status} ${response.statusText}`;

    const formattedLog = `[${timestamp}] [#${sequence}] ${statusTag} (${durationMs}ms) | Node: [${nodeHeader}] | Remaining: [${remainingHeader}] | Reset: [${resetHeader}]`;

    await logEntry(formattedLog);

    // If 429 is encountered, log response text snapshot for rate-limit context
    if (response.status === 429) {
      try {
        const errorText = await response.text();
        await logEntry(`  └── 429 Body Preview: ${errorText.slice(0, 300)}`);
      } catch (readErr: unknown) {
        const readMsg = readErr instanceof Error ? readErr.message : String(readErr);
        await logEntry(`  └── Failed to read 429 body: ${readMsg}`);
      }
    }
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logEntry(`[${timestamp}] [#${sequence}] ❌ Network Error (${durationMs}ms): ${errorMsg}`);
  }

  if (isRunning) {
    await Bun.sleep(REQUEST_INTERVAL_MS);
  }
}
