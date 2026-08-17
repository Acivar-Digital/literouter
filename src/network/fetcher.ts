export interface FetcherOptions {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly clientSignal?: AbortSignal;
  readonly provider: string;
  readonly keyIndex: number;
}

export interface StreamChunkResult {
  readonly stream: ReadableStream<Uint8Array>;
  readonly ttftMs: number;
  readonly initialBuffer: Uint8Array;
}

export interface UsageCallbackPayload {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
}

export interface StreamCallbacks {
  readonly onUsage?: (usage: UsageCallbackPayload) => void;
}

export class NoResponseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NoResponseError";
  }
}

export class StreamStallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StreamStallError";
  }
}

export const TTFT_TIMEOUT_MS = 5000;
export const STREAM_IDLE_TIMEOUT_MS = 30000;
export const MAX_HTTP_TIMEOUT_MS = 300000;
export const KEEPALIVE_INTERVAL_MS = 15000;
export const STREAM_STALL_MAX_RESENDS = 2;

const TOKEN_SIGNATURES: readonly string[] = Object.freeze([
  "content",
  "reasoning_content",
  "reasoning",
  "thought",
  "tool_calls",
  "parts",
  "choices",
  "candidates",
  "text",
  "delta",
  "message",
  "id",
  "object",
  "data:",
  ":",
  "{",
]);

export function hasContentToken(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  for (const sig of TOKEN_SIGNATURES) {
    if (trimmed.includes(sig)) {
      return true;
    }
  }
  return trimmed.length > 0;
}

function mergeSignals(client?: AbortSignal, timeoutMs: number = MAX_HTTP_TIMEOUT_MS): AbortSignal {
  const timeoutSig = AbortSignal.timeout(timeoutMs);
  if (!client) {
    return timeoutSig;
  }
  return AbortSignal.any([client, timeoutSig]);
}

function createKeepAliveChunk(): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(": keep-alive\n\n");
}

type IntervalHandle = ReturnType<typeof setInterval>;

function tryEnqueueKeepAlive(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.enqueue(createKeepAliveChunk());
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`[KeepAlive] Enqueue error: ${err.message}`);
    }
  }
}

function startKeepAliveTimer(
  controller: ReadableStreamDefaultController<Uint8Array>
): IntervalHandle | null {
  try {
    return setInterval(() => tryEnqueueKeepAlive(controller), KEEPALIVE_INTERVAL_MS);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`[KeepAlive] Timer error: ${err.message}`);
    }
    return null;
  }
}

function clearTimer(timer: IntervalHandle | null): void {
  if (timer !== null) {
    clearInterval(timer);
  }
}

type DefaultReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

async function readFirstChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<DefaultReadResult> {
  const readPromise = reader.read();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new NoResponseError(`TTFT exceeded ${TTFT_TIMEOUT_MS}ms`)), TTFT_TIMEOUT_MS);
  });
  return Promise.race([readPromise, timeoutPromise]);
}

function isChunkEmpty(firstRead: DefaultReadResult): boolean {
  return !firstRead.value || firstRead.value.length === 0 || Boolean(firstRead.done);
}

function isGhostResponse(status: number, value: Uint8Array): boolean {
  if (status !== 200) {
    return false;
  }
  const decoded = new TextDecoder().decode(value);
  return !hasContentToken(decoded);
}

function validateFirstChunk(
  firstRead: DefaultReadResult,
  status: number
): Uint8Array {
  if (isChunkEmpty(firstRead)) {
    throw new NoResponseError("Upstream emitted 0 bytes before closing");
  }
  const val = firstRead.value as Uint8Array;
  if (isGhostResponse(status, val)) {
    throw new NoResponseError("HTTP 200 returned ghost response with 0 content tokens");
  }
  return val;
}

export function extractUsageFromChunk(chunk: Uint8Array): UsageCallbackPayload | null {
  const text = new TextDecoder().decode(chunk);
  if (!text.includes("usage") && !text.includes("usageMetadata")) {
    return null;
  }
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") {
      continue;
    }
    const jsonStr = trimmed.slice(5).trim();
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;
      if (data.usage && typeof data.usage === "object") {
        const u = data.usage as Record<string, unknown>;
        const promptTokens = typeof u.prompt_tokens === "number"
          ? u.prompt_tokens
          : typeof u.input_tokens === "number"
            ? u.input_tokens
            : 0;
        const completionTokens = typeof u.completion_tokens === "number"
          ? u.completion_tokens
          : typeof u.output_tokens === "number"
            ? u.output_tokens
            : 0;
        const totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
        let reasoningTokens: number | undefined;
        if (u.completion_tokens_details && typeof u.completion_tokens_details === "object") {
          const details = u.completion_tokens_details as Record<string, unknown>;
          if (typeof details.reasoning_tokens === "number") {
            reasoningTokens = details.reasoning_tokens;
          }
        } else if (u.output_tokens_details && typeof u.output_tokens_details === "object") {
          const details = u.output_tokens_details as Record<string, unknown>;
          if (typeof details.thinking_tokens === "number") {
            reasoningTokens = details.thinking_tokens;
          }
        }
        return { promptTokens, completionTokens, totalTokens, reasoningTokens };
      }
      if (data.usageMetadata && typeof data.usageMetadata === "object") {
        const u = data.usageMetadata as Record<string, unknown>;
        const promptTokens = typeof u.promptTokenCount === "number" ? u.promptTokenCount : 0;
        const completionTokens = typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : 0;
        const totalTokens = typeof u.totalTokenCount === "number" ? u.totalTokenCount : promptTokens + completionTokens;
        return { promptTokens, completionTokens, totalTokens };
      }
    } catch {
      // Continue parsing lines
    }
  }
  return null;
}

export async function fetchWithTtftGuard(
  options: FetcherOptions
): Promise<{ response: Response; ttftMs: number; firstChunk: Uint8Array; rawReader: ReadableStreamDefaultReader<Uint8Array> }> {
  const signal = mergeSignals(options.clientSignal, MAX_HTTP_TIMEOUT_MS);
  const startTime = Date.now();
  const response = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal,
  });

  if (!response.body) {
    throw new NoResponseError("Upstream response has no body stream");
  }

  const reader = response.body.getReader();
  let firstChunk: Uint8Array;
  try {
    const firstRead = await readFirstChunkWithTimeout(reader);
    firstChunk = validateFirstChunk(firstRead, response.status);
  } catch (err: unknown) {
    reader.releaseLock();
    throw err;
  }

  const ttftMs = Date.now() - startTime;
  return { response, ttftMs, firstChunk, rawReader: reader };
}

export function createResilientStream(
  firstChunk: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks?: StreamCallbacks
): ReadableStream<Uint8Array> {
  let keepAliveTimer: IntervalHandle | null = null;
  let usageEmitted = false;

  const initialUsage = extractUsageFromChunk(firstChunk);
  if (initialUsage && callbacks?.onUsage) {
    usageEmitted = true;
    callbacks.onUsage(initialUsage);
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      keepAliveTimer = startKeepAliveTimer(controller);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimer(keepAliveTimer);
          controller.close();
          return;
        }
        if (value && value.length > 0) {
          if (!usageEmitted && callbacks?.onUsage) {
            const usage = extractUsageFromChunk(value);
            if (usage) {
              usageEmitted = true;
              callbacks.onUsage(usage);
            }
          }
          controller.enqueue(value);
        }
      } catch (err: unknown) {
        clearTimer(keepAliveTimer);
        controller.error(err);
      }
    },
    cancel() {
      clearTimer(keepAliveTimer);
      reader.cancel().catch((err: unknown) => {
        if (err instanceof Error) {
          console.error(`[StreamCancel] Cancel error: ${err.message}`);
        }
      });
    },
  });
}
