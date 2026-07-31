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
    clientSignal?: AbortSignal;
  },
): Promise<Response> {
  const { noResponseTimeoutMs, totalTimeoutMs, clientSignal } = opts;
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

      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of bufferedChunks) {
            controller.enqueue(chunk);
          }
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
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
