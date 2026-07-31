export class NoResponseError extends Error {
  constructor(msg = "upstream sent no response") {
    super(msg);
    this.name = "NoResponseError";
  }
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
      const firstReadPromise = reader.read();

      const firstRead = await Promise.race([
        firstReadPromise,
        new Promise<never>((_, reject) => {
          ctrl.signal.addEventListener(
            "abort",
            () => reject(ctrl.signal.reason || new Error("aborted")),
            { once: true },
          );
        }),
      ]);

      clearTimeout(firstByte);

      if (firstRead.done) {
        throw new NoResponseError("upstream returned empty body");
      }

      const firstChunk = firstRead.value;
      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(firstChunk);
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
      throw new NoResponseError();
    }
    throw e;
  }
}
