import { getEnv } from "../config/env";
import { getHttp2Pool } from "./h2_pool";

export interface FetcherOptions {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly clientSignal?: AbortSignal;
  readonly provider: string;
  readonly keyIndex: number;
  readonly model?: string;
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
  readonly retryProvider?: RetryProvider;
  readonly nextAttemptProvider?: RetryProvider;
  readonly protocol?: "anthropic" | "openai" | string;
}

export interface NextAttemptResult {
  readonly firstChunk: Uint8Array;
  readonly rawReader?: ReadableStreamDefaultReader<Uint8Array>;
  readonly reader?: ReadableStreamDefaultReader<Uint8Array>;
}

export type RetryProvider = (
  reason: string
) => Promise<NextAttemptResult | null>;

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

export const TTFT_TIMEOUT_MS = 15000;
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
  const interval = getEnv().KEEPALIVE_INTERVAL_MS || KEEPALIVE_INTERVAL_MS;
  try {
    return setInterval(() => tryEnqueueKeepAlive(controller), interval);
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

export function resolveTtftTimeout(model?: string, envTimeoutMs?: number): number {
  const base = envTimeoutMs && envTimeoutMs > 0 ? envTimeoutMs : 15000;
  if (!model) return base;
  const isReasoningModel = /o1|o3|deepseek|r1|dots|thinking|preview|coder|reasoning|thought/i.test(model);
  if (isReasoningModel) {
    return Math.max(60000, base);
  }
  return base;
}

export function formatMidstreamErrorFrame(protocol: "anthropic" | "openai" | string, message: string): Uint8Array {
  const encoder = new TextEncoder();
  if (protocol === "anthropic" || protocol === "cl") {
    return encoder.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`);
  }
  return encoder.encode(`data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\ndata: [DONE]\n\n`);
}

export async function readFirstChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number = TTFT_TIMEOUT_MS
): Promise<DefaultReadResult> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const readPromise = reader.read();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new NoResponseError(`TTFT exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array(0);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function readFirstContentChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number = TTFT_TIMEOUT_MS,
  status: number = 200
): Promise<Uint8Array> {
  const startTime = Date.now();
  const bufferedChunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let fullBufferedText = "";

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = Math.max(1, timeoutMs - elapsed);
    const readResult = await readFirstChunkWithTimeout(reader, remainingMs);

    if (readResult.done) {
      if (bufferedChunks.length === 0) {
        throw new NoResponseError("Upstream emitted 0 bytes before closing");
      }
      const combined = concatUint8Arrays(bufferedChunks);
      if (status === 200 && !hasContentToken(fullBufferedText)) {
        throw new NoResponseError("HTTP 200 returned ghost response with 0 content tokens");
      }
      return combined;
    }

    if (readResult.value && readResult.value.length > 0) {
      bufferedChunks.push(readResult.value);
      fullBufferedText += decoder.decode(readResult.value, { stream: true });
      if (hasContentToken(fullBufferedText)) {
        return concatUint8Arrays(bufferedChunks);
      }
    }
  }
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
    } catch (err: unknown) {
      void err;
    }
  }
  return null;
}

export const HOP_BY_HOP_AND_ENCODING_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

export function sanitizeDownstreamHeaders(
  upstreamHeaders: Headers,
  bodyLength?: number
): Headers {
  const sanitized = new Headers();
  upstreamHeaders.forEach((value, key) => {
    if (!HOP_BY_HOP_AND_ENCODING_HEADERS.has(key.toLowerCase())) {
      sanitized.set(key, value);
    }
  });
  if (typeof bodyLength === "number") {
    sanitized.set("content-length", String(bodyLength));
  }
  return sanitized;
}

export async function executeH2Fetch(
  options: FetcherOptions,
  signal: AbortSignal
): Promise<Response> {
  const url = new URL(options.url);
  const origin = url.origin;
  const pool = getHttp2Pool();
  const session = await pool.acquireSession(origin);

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const reqHeaders: Record<string, string | number | string[]> = {
      ":method": options.method,
      ":path": url.pathname + url.search,
      ":scheme": url.protocol.replace(":", ""),
      ":authority": url.host,
    };

    for (const [k, v] of Object.entries(options.headers)) {
      const lower = k.toLowerCase();
      if (!HOP_BY_HOP_AND_ENCODING_HEADERS.has(lower) && !lower.startsWith(":")) {
        reqHeaders[lower] = v;
      }
    }

    let stream: ReturnType<typeof session.request>;
    try {
      stream = session.request(reqHeaders);
    } catch (reqErr) {
      return reject(reqErr);
    }

    pool.attachStreamGuard(origin, session, stream);

    const abortListener = () => {
      if (!settled) {
        settled = true;
        try {
          stream.destroy();
        } catch (_err: unknown) {
          console.debug("[H2 Fetcher] Stream destroy on abort error:", _err);
        }
        reject(new Error("Request aborted"));
      }
    };

    if (signal.aborted) {
      abortListener();
      return;
    }

    signal.addEventListener("abort", abortListener, { once: true });

    stream.on("response", (headers) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abortListener);

      const status = Number(headers[":status"]) || 200;
      const respHeaders = new Headers();
      for (const [k, v] of Object.entries(headers)) {
        if (!k.startsWith(":") && v !== undefined) {
          if (Array.isArray(v)) {
            for (const item of v) respHeaders.append(k, item);
          } else {
            respHeaders.set(k, String(v));
          }
        }
      }

      let isClosed = false;
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on("data", (chunk: Buffer | Uint8Array) => {
            if (!isClosed) {
              try {
                controller.enqueue(new Uint8Array(chunk));
              } catch (_err: unknown) {
                console.debug("[H2 Fetcher] Enqueue error on closed stream:", _err);
              }
            }
          });
          stream.on("end", () => {
            if (!isClosed) {
              isClosed = true;
              try {
                controller.close();
              } catch (_err: unknown) {
                console.debug("[H2 Fetcher] Controller close error:", _err);
              }
            }
          });
          stream.on("error", (err) => {
            if (!isClosed) {
              isClosed = true;
              try {
                controller.error(err);
              } catch (_err: unknown) {
                console.debug("[H2 Fetcher] Controller error dispatch:", _err);
              }
            }
          });
        },
        cancel() {
          isClosed = true;
          try {
            stream.destroy();
          } catch (_err: unknown) {
            console.debug("[H2 Fetcher] Stream destroy error:", _err);
          }
        },
      });

      const response = new Response(webStream, {
        status,
        headers: respHeaders,
      });
      resolve(response);
    });

    stream.on("error", (err) => {
      if (!settled) {
        settled = true;
        signal.removeEventListener("abort", abortListener);
        reject(err);
      }
    });

    if (options.body) {
      stream.write(options.body);
    }
    stream.end();
  });
}

const NATIVE_FETCH = globalThis.fetch;

export function isFetchMocked(): boolean {
  return globalThis.fetch !== NATIVE_FETCH;
}

export type OutboundProtocol = "HTTP/2" | "HTTP/1.1";

export async function fetchWithTtftGuard(
  options: FetcherOptions
): Promise<{
  response: Response;
  ttftMs: number;
  firstChunk: Uint8Array;
  rawReader: ReadableStreamDefaultReader<Uint8Array>;
  protocol: OutboundProtocol;
}> {
  const timeoutMs = getEnv().LITEROUTER_HTTP_TIMEOUT_MS || MAX_HTTP_TIMEOUT_MS;
  const signal = mergeSignals(options.clientSignal, timeoutMs);
  const startTime = Date.now();
  const requestHeaders = new Headers(options.headers);
  if (!requestHeaders.has("accept-encoding")) {
    requestHeaders.set("accept-encoding", "identity");
  }
  let response: Response;
  let protocol: OutboundProtocol = "HTTP/1.1";
  const useH2 = getEnv().LITEROUTER_H2_OUTBOUND && options.url.startsWith("https://") && !isFetchMocked();

  if (useH2) {
    try {
      response = await executeH2Fetch(options, signal);
      protocol = "HTTP/2";
    } catch (h2Err: unknown) {
      if (options.clientSignal?.aborted) {
        throw h2Err;
      }
      // Clean fallback to standard fetch (HTTP/1.1 keep-alive) if H2 fails
      try {
        response = await fetch(options.url, {
          method: options.method,
          headers: requestHeaders,
          body: options.body,
          signal,
        });
        protocol = "HTTP/1.1";
      } catch (fetchErr: unknown) {
        if (options.clientSignal?.aborted) {
          throw fetchErr;
        }
        throw new NoResponseError(`Network transport failure: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
      }
    }
  } else {
    try {
      response = await fetch(options.url, {
        method: options.method,
        headers: requestHeaders,
        body: options.body,
        signal,
      });
      protocol = "HTTP/1.1";
    } catch (err: unknown) {
      if (options.clientSignal?.aborted) {
        throw err;
      }
      throw new NoResponseError(`Network transport failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!response.body) {
    throw new NoResponseError("Upstream response has no body stream");
  }

  const reader = response.body.getReader();
  const envTtft = getEnv().LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
  const ttftTimeoutMs = resolveTtftTimeout(options.model, envTtft);
  let firstChunk: Uint8Array;
  try {
    firstChunk = await readFirstContentChunkWithTimeout(reader, ttftTimeoutMs, response.status);
  } catch (err: unknown) {
    reader.releaseLock();
    throw err;
  }

  const ttftMs = Date.now() - startTime;
  return { response, ttftMs, firstChunk, rawReader: reader, protocol };
}

export function isInBandErrorChunk(chunk: Uint8Array): { isError: boolean; message?: string } {
  if (!chunk || chunk.length === 0) {
    return { isError: false };
  }
  const text = new TextDecoder().decode(chunk).trim();
  if (!text) {
    return { isError: false };
  }

  // Fast check for explicit mid-response server error strings
  if (text.includes("Server error mid-response")) {
    return { isError: true, message: "Server error mid-response" };
  }

  // Check JSON / SSE error payloads line by line
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === ": keep-alive" || trimmed === "data: [DONE]") {
      continue;
    }
    let jsonStr = trimmed;
    if (trimmed.startsWith("data:")) {
      jsonStr = trimmed.slice(5).trim();
      if (jsonStr === "[DONE]") {
        continue;
      }
    }
    if (jsonStr.startsWith("{") && jsonStr.endsWith("}")) {
      try {
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
        if (parsed.error && typeof parsed.error === "object") {
          const errObj = parsed.error as Record<string, unknown>;
          const msg = typeof errObj.message === "string"
            ? errObj.message
            : typeof errObj.type === "string"
              ? errObj.type
              : "In-band upstream error";
          return { isError: true, message: msg };
        }
        if (parsed.type === "error") {
          const msg = typeof parsed.message === "string" ? parsed.message : "In-band upstream error";
          return { isError: true, message: msg };
        }
      } catch (err: unknown) {
        void err;
      }
    }
  }

  const errorSubstrings = [
    "Internal Server Error",
    "internal_server_error",
    "server_error",
    "overloaded_error",
    "internal_error",
  ];
  for (const sub of errorSubstrings) {
    if (text.includes(sub)) {
      return { isError: true, message: sub };
    }
  }

  const codeRegex = /"(?:code|status)"\s*:\s*(500|502|503|504|"internal_error"|"server_error"|"overloaded_error")/i;
  if (codeRegex.test(text)) {
    return { isError: true, message: "In-band error code match" };
  }

  return { isError: false };
}

export function createResilientStream(
  firstChunk: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks?: StreamCallbacks
): ReadableStream<Uint8Array> {
  let currentReader = reader;
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
        const { done, value } = await currentReader.read();
        if (done) {
          clearTimer(keepAliveTimer);
          controller.close();
          return;
        }
        if (value && value.length > 0) {
          const errCheck = isInBandErrorChunk(value);
          if (errCheck.isError) {
            const provider = callbacks?.retryProvider ?? callbacks?.nextAttemptProvider;
            if (provider) {
              const reason = errCheck.message ?? "In-band error detected";
              const next = await provider(reason);
              if (next) {
                const nextReader = next.rawReader ?? next.reader;
                if (nextReader) {
                  currentReader = nextReader;
                }
                if (next.firstChunk && next.firstChunk.length > 0) {
                  if (!usageEmitted && callbacks?.onUsage) {
                    const usage = extractUsageFromChunk(next.firstChunk);
                    if (usage) {
                      usageEmitted = true;
                      callbacks.onUsage(usage);
                    }
                  }
                  controller.enqueue(next.firstChunk);
                }
                return;
              } else {
                clearTimer(keepAliveTimer);
                if (callbacks?.protocol) {
                  controller.enqueue(formatMidstreamErrorFrame(callbacks.protocol, reason));
                  controller.close();
                  return;
                }
                controller.error(new Error(reason));
                return;
              }
            } else {
              clearTimer(keepAliveTimer);
              if (callbacks?.protocol) {
                controller.enqueue(formatMidstreamErrorFrame(callbacks.protocol, errCheck.message ?? "In-band upstream error"));
                controller.close();
                return;
              }
              controller.error(new Error(errCheck.message ?? "In-band upstream error"));
              return;
            }
          }

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
        const provider = callbacks?.retryProvider ?? callbacks?.nextAttemptProvider;
        if (provider) {
          try {
            const reason = err instanceof Error ? err.message : String(err);
            const next = await provider(reason);
            if (next) {
              const nextReader = next.rawReader ?? next.reader;
              if (nextReader) {
                currentReader = nextReader;
              }
              if (next.firstChunk && next.firstChunk.length > 0) {
                if (!usageEmitted && callbacks?.onUsage) {
                  const usage = extractUsageFromChunk(next.firstChunk);
                  if (usage) {
                    usageEmitted = true;
                    callbacks.onUsage(usage);
                  }
                }
                controller.enqueue(next.firstChunk);
              }
              return;
            } else {
              clearTimer(keepAliveTimer);
              if (callbacks?.protocol) {
                controller.enqueue(formatMidstreamErrorFrame(callbacks.protocol, reason));
                controller.close();
                return;
              }
              controller.error(err);
              return;
            }
          } catch (retryErr: unknown) {
            clearTimer(keepAliveTimer);
            if (callbacks?.protocol) {
              const reason = retryErr instanceof Error ? retryErr.message : String(retryErr);
              controller.enqueue(formatMidstreamErrorFrame(callbacks.protocol, reason));
              controller.close();
              return;
            }
            controller.error(retryErr);
            return;
          }
        }
        clearTimer(keepAliveTimer);
        if (callbacks?.protocol) {
          const reason = err instanceof Error ? err.message : String(err);
          controller.enqueue(formatMidstreamErrorFrame(callbacks.protocol, reason));
          controller.close();
          return;
        }
        controller.error(err);
      }
    },
    cancel() {
      clearTimer(keepAliveTimer);
      currentReader.cancel().catch((err: unknown) => {
        if (err instanceof Error) {
          console.error(`[StreamCancel] Cancel error: ${err.message}`);
        }
      });
    },
  });
}
