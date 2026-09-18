import { maskKey } from "../../src/config/keys";
import { generateOpenCodeSessionId } from "../../src/engine/session_id";
import { buildZenHeaders, getZenProbeTools } from "../../src/engine/zen";

export interface ZenProbeResult {
  readonly provider: string;
  readonly maskedKey: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly message: string;
  readonly statusCode?: number;
}

export function generateZenSessionId(): string {
  return generateOpenCodeSessionId();
}

export function buildZenSessionHeaders(sessionId: string): Record<string, string> {
  return buildZenHeaders(undefined, sessionId);
}

export async function probeZenKeyWithFreshSession(key: string): Promise<ZenProbeResult> {
  const masked = maskKey(key);
  const url = "https://opencode.ai/zen/v1/chat/completions";
  const payload = {
    model: "big-pickle",
    messages: [{ role: "user", content: "ping" }],
    tools: getZenProbeTools(),
    tool_choice: "auto",
    stream: true,
    stream_options: { include_usage: true },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        Authorization: `Bearer ${key}`,
        ...buildZenHeaders(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 200) {
      try {
        await res.body?.cancel();
      } catch (cancelErr) {
        void cancelErr;
      }
      return { provider: "Zen", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }

    if (res.status === 401 || res.status === 403) {
      let detail = `HTTP ${res.status} Unauthorized / Forbidden`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) detail += `: ${body.error.message}`;
      } catch (jsonErr) {
        void jsonErr;
      }
      return { provider: "Zen", maskedKey: masked, status: "FAIL", message: detail, statusCode: res.status };
    }

    if (res.status === 429) {
      let msg = "HTTP 429 Rate Limited (Active)";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) msg = `HTTP 429: ${body.error.message}`;
      } catch (jsonErr) {
        void jsonErr;
      }
      return { provider: "Zen", maskedKey: masked, status: "WARN", message: msg, statusCode: 429 };
    }

    let detail = `HTTP ${res.status} Upstream Warning`;
    try {
      const body = (await res.text()).slice(0, 300);
      if (body) detail = `HTTP ${res.status}: ${body}`;
    } catch (textErr) {
      void textErr;
    }
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: detail, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}
