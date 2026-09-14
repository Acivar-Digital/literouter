import { maskKey } from "../src/config/keys";

export interface ZenProbeResult {
  readonly provider: string;
  readonly maskedKey: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly message: string;
  readonly statusCode?: number;
}

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateZenSessionId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const b of bytes) {
    tail += BASE62[b % 62];
  }
  return `ses_${tail}`;
}

export function buildZenSessionHeaders(sessionId: string): Record<string, string> {
  const referer = process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai";
  const title = process.env.LITEROUTER_X_TITLE || "OpenCode";
  const agent = process.env.LITEROUTER_USER_AGENT || "OpenCode/1.18.29";
  const clientVersion = agent.includes("/") ? agent.split("/")[1]! : "1.18.29";
  return {
    "Content-Type": "application/json",
    "HTTP-Referer": referer,
    Referer: referer,
    "X-Title": title,
    "User-Agent": agent,
    "session-id": sessionId,
    "x-session-id": sessionId,
    "x-opencode-session": sessionId,
    "x-opencode-session-id": sessionId,
    "opencode-session-id": sessionId,
    "opencode-session": sessionId,
    "x-client-version": clientVersion,
    "x-client-name": "opencode",
  };
}

export async function probeZenKeyWithFreshSession(key: string): Promise<ZenProbeResult> {
  const masked = maskKey(key);
  const url = "https://opencode.ai/zen/v1/chat/completions";
  const payload = {
    model: "big-pickle",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 10,
  };
  const sessionId = generateZenSessionId();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        ...buildZenSessionHeaders(sessionId),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 200) {
      return { provider: "Zen", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "Zen", maskedKey: masked, status: "FAIL", message: `HTTP ${res.status} Unauthorized / Forbidden`, statusCode: res.status };
    }
    if (res.status === 429) {
      let msg = "HTTP 429 Rate Limited (Active)";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) msg = `HTTP 429: ${body.error.message}`;
      } catch (err) {
        void err;
      }
      return { provider: "Zen", maskedKey: masked, status: "WARN", message: msg, statusCode: 429 };
    }
    let detail = `HTTP ${res.status} Upstream Warning`;
    try {
      const body = (await res.text()).slice(0, 300);
      if (body) detail = `HTTP ${res.status}: ${body}`;
    } catch (err) {
      void err;
    }
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: detail, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}
