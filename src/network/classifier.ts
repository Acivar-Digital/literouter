import { parseResetDelay } from "./cooldown";

export interface UpstreamErrorInfo {
  readonly provider: string;
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly bodyText?: string;
}

export interface ErrorDisposition {
  readonly action: "retry_rotate" | "fail_fast";
  readonly quarantineTtlSec: number;
  readonly reason: string;
}

export type ErrorClassification = ErrorDisposition;

const MAX_BODY_SCAN_BYTES = 4096;

export function classifyUpstreamError(input: UpstreamErrorInfo): ErrorDisposition {
  const { status, headers, bodyText } = input;
  const rawBody = bodyText ?? "";
  const text = rawBody.slice(0, MAX_BODY_SCAN_BYTES).toLowerCase();

  // 1. Status 400: Check provider retryable vs client-side fail fast
  if (status === 400) {
    if (
      text.includes("provider returned error") ||
      text.includes("no available provider") ||
      text.includes("temporarily unavailable")
    ) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: 0,
        reason: "Upstream provider temporary failure (retryable 400)",
      };
    }
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Client request error (non-retryable 400)",
    };
  }

  // 2. Status 429: Check quota exhaustion vs standard rate limit
  if (status === 429) {
    if (
      text.includes("insufficient_quota") ||
      text.includes("credit_limit") ||
      text.includes("out of balance")
    ) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: 604800, // 7 days
        reason: "Quota or credit exhaustion (429)",
      };
    }

    const reset = parseResetDelay(headers, rawBody);
    const ttlSec = Math.round(reset.delayMs / 1000);
    return {
      action: "retry_rotate",
      quarantineTtlSec: ttlSec,
      reason: "Rate limit reached (429)",
    };
  }

  // 3. Status 401 & 403: Auth errors (7 days quarantine)
  if (status === 401 || status === 403) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 604800, // 7 days
      reason: `Authentication or authorization failure (${status})`,
    };
  }

  // 4. Status 404: Not found (fail fast)
  if (status === 404) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Resource or model not found (404)",
    };
  }

  // 5. Status 5xx (500, 502, 503, 504, etc.): Transient server error (10s)
  if (status >= 500 && status < 600) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 10,
      reason: `Transient upstream server error (${status})`,
    };
  }

  // 6. Other 4xx client errors: fail fast
  if (status >= 400 && status < 500) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: `Client error (${status})`,
    };
  }

  // 7. Any other status code (< 400)
  return {
    action: "fail_fast",
    quarantineTtlSec: 0,
    reason: `Status ${status}`,
  };
}
