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
