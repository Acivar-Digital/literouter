const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const SESSION_HEADER_KEYS = [
  "session-id",
  "x-session-id",
  "x-opencode-session",
  "x-opencode-session-id",
  "opencode-session-id",
  "opencode-session",
] as const;

export function generateOpenCodeSessionId(): string {
  const hexBytes = new Uint8Array(4);
  crypto.getRandomValues(hexBytes);
  let hex8 = "";
  for (let i = 0; i < 4; i++) {
    hex8 += (hexBytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  const tailBytes = new Uint8Array(14);
  crypto.getRandomValues(tailBytes);
  let tail14 = "";
  for (let i = 0; i < 14; i++) {
    tail14 += BASE62_CHARS.charAt((tailBytes[i] ?? 0) % BASE62_CHARS.length);
  }
  return `ses_${hex8}8ffe${tail14}`;
}

function getFromHeadersObject(headers: Headers, key: string): string | undefined {
  const val = headers.get(key);
  return val ?? undefined;
}

function getFromRecord(rec: Record<string, string>, targetKey: string): string | undefined {
  const target = targetKey.toLowerCase();
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === target && v) {
      return v;
    }
  }
  return undefined;
}

export function getHeaderValue(
  headers: Headers | Record<string, string> | undefined,
  targetKey: string
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return getFromHeadersObject(headers as Headers, targetKey);
  }
  return getFromRecord(headers as Record<string, string>, targetKey);
}

export function extractClientSessionId(
  headers?: Headers | Record<string, string>
): string | undefined {
  if (!headers) return undefined;
  for (const key of SESSION_HEADER_KEYS) {
    const val = getHeaderValue(headers, key);
    if (val) {
      return val;
    }
  }
  return undefined;
}

export function ensureSessionHeaders(
  targetHeaders: Record<string, string>,
  clientHeaders?: Headers | Record<string, string>
): void {
  const clientSession = extractClientSessionId(clientHeaders);
  const targetSession = extractClientSessionId(targetHeaders);
  const activeSession = clientSession ?? targetSession;

  if (activeSession) {
    targetHeaders["session-id"] = activeSession;
    const existingXSession =
      getHeaderValue(clientHeaders, "x-session-id") ??
      getHeaderValue(targetHeaders, "x-session-id");
    if (existingXSession) {
      targetHeaders["x-session-id"] = existingXSession;
    }
    return;
  }

  const generated = generateOpenCodeSessionId();
  targetHeaders["session-id"] = generated;
  targetHeaders["x-session-id"] = generated;
}
