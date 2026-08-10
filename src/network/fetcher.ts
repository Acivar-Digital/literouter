import {
  EMOJI,
  KEEPALIVE_INTERVAL_MS,
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS,
  STREAM_STALL_MAX_RESENDS,
  logWarn,
} from "../config/env";

export class NoResponseError extends Error {
  constructor(msg = "upstream sent no response") {
    super(msg);
    this.name = "NoResponseError";
  }
}

function hasContentToken(chunkBytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(chunkBytes);
  if (text.includes("data: ")) {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.substring(6).trim();
      if (!dataStr || dataStr === "[DONE]") continue;
      try {
        const json = JSON.parse(dataStr);
        const delta = json?.choices?.[0]?.delta;
        if (
          (typeof delta?.content === "string" && delta.content.length > 0) ||
          (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) ||
          (typeof delta?.thought === "string" && delta.thought.length > 0) ||
          (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) ||
          (Array.isArray(json?.choices?.[0]?.message?.tool_calls) && json.choices[0].message.tool_calls.length > 0)
        ) {
          return true;
        }
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts) && parts.some((p: any) => p?.text || p?.functionCall)) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  if (text.trim().startsWith("{")) {
    try {
      const json = JSON.parse(text);
      if (json?.choices || json?.candidates || json?.id || json?.object) {
        return true;
      }
    } catch {}
  }

  return text.trim().length > 0;
}

export async function fetchWithFirstByteTimeout(
  url: string,
  init: RequestInit,
  opts: {
    noResponseTimeoutMs: number;
    totalTimeoutMs: number;
    idleTimeoutMs?: number;
    clientSignal?: AbortSignal;
  },
): Promise<Response> {
  const { noResponseTimeoutMs, totalTimeoutMs, idleTimeoutMs = noResponseTimeoutMs, clientSignal } = opts;
  const ctrl = new AbortController();
  const totalSignal = clientSignal
    ? AbortSignal.any([clientSignal, AbortSignal.timeout(totalTimeoutMs)])
    : AbortSignal.timeout(totalTimeoutMs);

  totalSignal.addEventListener("abort", () => ctrl.abort());
  if (clientSignal) {
    clientSignal.addEventListener("abort", () => ctrl.abort());
  }

  const firstByte = setTimeout(() => ctrl.abort(), noResponseTimeoutMs);

  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });

    if (resp.ok && resp.body) {
      const reader = resp.body.getReader();
      const bufferedChunks: Uint8Array[] = [];
      let foundContentToken = false;

      while (!foundContentToken) {
        const readPromise = reader.read();
        const readResult = await Promise.race([
          readPromise,
          new Promise<never>((_, reject) => {
            ctrl.signal.addEventListener(
              "abort",
              () => reject(ctrl.signal.reason || new Error("aborted")),
              { once: true },
            );
          }),
        ]);

        if (readResult.done) break;

        bufferedChunks.push(readResult.value);
        if (hasContentToken(readResult.value)) {
          foundContentToken = true;
          break;
        }
      }

      clearTimeout(firstByte);

      if (bufferedChunks.length === 0) {
        throw new NoResponseError("upstream returned empty body");
      }

      if (!foundContentToken && bufferedChunks.length > 0) {
        throw new NoResponseError("upstream sent 0 content tokens");
      }

      const MAX_IDLE_RESENDS = STREAM_STALL_MAX_RESENDS;

      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of bufferedChunks) {
            controller.enqueue(chunk);
          }

          let currentReader = reader;
          let idleResends = 0;

          try {
            while (true) {
              const readPromise = currentReader.read();
              let timer: ReturnType<typeof setTimeout> | null = null;

              const timeoutPromise = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  reject(new NoResponseError("stream idle timeout"));
                }, idleTimeoutMs);
              });

              let result: ReadableStreamReadResult<Uint8Array>;
              try {
                result = await Promise.race([readPromise, timeoutPromise]);
                clearTimeout(timer!);
              } catch (err: any) {
                clearTimeout(timer!);
                // suppress the orphaned readPromise rejection
                readPromise.catch(() => {});

                if (err instanceof NoResponseError && idleResends < MAX_IDLE_RESENDS) {
                  idleResends++;
                  logWarn(
                    EMOJI.retry,
                    `[STREAM_STALL] provider went silent for ${idleTimeoutMs}ms, resending same key (attempt ${idleResends}/${MAX_IDLE_RESENDS})`,
                  );
                  try {
                    currentReader.cancel().catch(() => {});
                  } catch {}
                  const freshResp = await fetch(url, init);
                  if (!freshResp.ok || !freshResp.body) {
                    controller.close();
                    return;
                  }
                  currentReader = freshResp.body.getReader();
                  continue;
                }

                // exhausted resends or non-idle error — close cleanly
                if (idleResends >= MAX_IDLE_RESENDS) {
                  logWarn(
                    EMOJI.exhausted,
                    `[STREAM_STALL] provider kept stalling after ${MAX_IDLE_RESENDS} resends, closing stream`,
                  );
                }
                const doneMarker = new TextEncoder().encode("data: [DONE]\n\n");
                controller.enqueue(doneMarker);
                controller.close();
                return;
              }

              if (result.done) break;
              idleResends = 0; // reset on successful chunk
              controller.enqueue(result.value);
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
        cancel(reason) {
          reader.cancel(reason);
        },
      });

      return new Response(combinedStream, {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers,
      });
    }

    clearTimeout(firstByte);
    return resp;
  } catch (e: any) {
    clearTimeout(firstByte);
    if (ctrl.signal.aborted && !totalSignal.aborted && !clientSignal?.aborted) {
      throw new NoResponseError("upstream sent 0 content tokens within timeout");
    }
    throw e;
  }
}
