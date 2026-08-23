import { parseResetDelay } from "./cooldown";

export interface UpstreamErrorInfo {
  readonly provider: string;
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly bodyText?: string;
  readonly consecutiveAuthFailures?: number;
}

export interface ErrorDisposition {
  readonly action: "retry_rotate" | "fail_fast";
  readonly quarantineTtlSec: number;
  readonly reason: string;
  readonly isRetryable?: boolean;
}

export type ErrorClassification = ErrorDisposition;

const MAX_BODY_SCAN_BYTES = 4096;
const SEVEN_DAYS_SEC = 604800;

function isRetryable400(text: string): boolean {
  return (
    text.includes("no available provider") ||
    text.includes("temporarily unavailable")
  );
}

function isQuotaExhausted429(text: string): boolean {
  return (
    text.includes("insufficient_quota") ||
    text.includes("credit_limit") ||
    text.includes("out of balance")
  );
}

export function classifyTransportError(error: unknown): ErrorDisposition {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("ttft") ||
    lower.includes("timed out waiting for first chunk") ||
    lower.includes("noresponse")
  ) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 2,
      reason: "ttft_timeout_exceeded",
      isRetryable: true,
    };
  }

  return {
    action: "retry_rotate",
    quarantineTtlSec: 2,
    reason: "transport_reset_cooldown",
    isRetryable: true,
  };
}

export function classifyUpstreamError(input: UpstreamErrorInfo): ErrorDisposition {
  const { status, headers, bodyText } = input;
  const rawBody = bodyText ?? "";
  const text = rawBody.slice(0, MAX_BODY_SCAN_BYTES).toLowerCase();

  // 0. Status 0: Network / transport error before response headers
  if (status === 0) {
    if (text.includes("ttft") || text.includes("timeout") || text.includes("noresponse")) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: 2,
        reason: "ttft_timeout_exceeded",
        isRetryable: true,
      };
    }
    return {
      action: "retry_rotate",
      quarantineTtlSec: 2,
      reason: "transport_reset_cooldown",
      isRetryable: true,
    };
  }

  // 1. Status 400: Check provider retryable vs client-side fail fast
  if (status === 400) {
    if (isRetryable400(text)) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: 0,
        reason: "Upstream provider temporary failure (retryable 400)",
        isRetryable: true,
      };
    }
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Client request error (non-retryable 400)",
      isRetryable: false,
    };
  }

  // 2. Status 429: Check quota exhaustion vs standard rate limit
  if (status === 429) {
    if (isQuotaExhausted429(text)) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: SEVEN_DAYS_SEC,
        reason: "Quota or credit exhaustion (429)",
        isRetryable: true,
      };
    }

    const reset = parseResetDelay(headers, rawBody);
    const ttlSec = Math.round(reset.delayMs / 1000);
    return {
      action: "retry_rotate",
      quarantineTtlSec: ttlSec,
      reason: "Rate limit reached (429)",
      isRetryable: true,
    };
  }

  // 3. Status 401 & 403: Auth errors (tiered quarantine: 300s -> 1800s -> 86400s)
  if (status === 401 || status === 403) {
    const authCount = input.consecutiveAuthFailures ?? 1;
    let ttlSec = 300;
    if (authCount === 2) ttlSec = 1800;
    else if (authCount >= 3) ttlSec = 86400;

    return {
      action: "retry_rotate",
      quarantineTtlSec: ttlSec,
      reason: "auth_failure_key_quarantined",
      isRetryable: true,
    };
  }

  // 4. Status 404: Not found (fail fast)
  if (status === 404) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Resource or model not found (404)",
      isRetryable: false,
    };
  }

  // 5. Status 5xx (500, 502, 503, 504, etc.): Transient server error (10s)
  if (status >= 500 && status < 600) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 10,
      reason: `Transient upstream server error (${status})`,
      isRetryable: true,
    };
  }

  // 6. Other 4xx client errors: fail fast
  if (status >= 400 && status < 500) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: `Client error (${status})`,
      isRetryable: false,
    };
  }

  // 7. Any other status code (< 400)
  return {
    action: "fail_fast",
    quarantineTtlSec: 0,
    reason: `Status ${status}`,
    isRetryable: false,
  };
}
