import { type ConserveRule, parseResetDelay, resolveConserveTtlSec } from "./cooldown";
import { isProviderQuarantineEnabled } from "./pool";
import { getEnv } from "../config/env";

export interface UpstreamErrorInfo {
  readonly provider: string;
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly bodyText?: string;
  readonly consecutiveAuthFailures?: number;
  readonly conserveRules?: readonly ConserveRule[];
}

export interface ErrorDisposition {
  readonly action: "retry_rotate" | "fail_fast";
  readonly quarantineTtlSec: number;
  readonly reason: string;
  readonly isRetryable?: boolean;
  readonly isConserve?: boolean;
  readonly errorType?: string;
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
    text.includes("insufficient credits") ||
    text.includes("credit_limit") ||
    text.includes("out of balance") ||
    text.includes("credits exhausted") ||
    text.includes("out of credits") ||
    text.includes("free limit exceeded") ||
    text.includes("account has no balance")
  );
}

function isStreamCanceledError(text: string): boolean {
  return (
    text.includes("the pending stream has been canceled") ||
    text.includes("the pending stream has been cancelled") ||
    text.includes("stream canceled") ||
    text.includes("stream cancelled") ||
    text.includes("err_http2_stream_cancel") ||
    text.includes("err_http2_stream_error") ||
    text.includes("rst_stream")
  );
}

function strField(obj: unknown, key: string): string | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

/**
 * Parse the canonical typed `error_type` from an upstream body across 3 skins:
 * chat `error.metadata.error_type`, anthropic `error.error_type`,
 * responses top-level `error_type`. Returns undefined when absent/unparseable.
 */
export function parseCanonicalErrorType(bodyText: string | undefined): string | undefined {
  if (!bodyText) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const root = parsed as Record<string, unknown>;
  return (
    strField(root, "error_type") ??
    strField(root.error, "error_type") ??
    strField((root.error as Record<string, unknown> | undefined)?.metadata, "error_type")
  );
}

function resolveAuthTtl(consecutiveAuthFailures?: number): number {
  const count = consecutiveAuthFailures ?? 1;
  if (count === 2) {
    return 1800;
  }
  if (count >= 3) {
    return 86400;
  }
  return 300;
}

const ERROR_TYPE_RETRY_TTL_SEC: Readonly<Record<string, number>> = {
  timeout: 0,
  provider_overloaded: 10,
  provider_unavailable: 10,
  server: 10,
  unmapped: 10,
};

const ERROR_TYPE_FAIL_FAST_ZERO: ReadonlySet<string> = new Set([
  "context_length_exceeded",
  "max_tokens_exceeded",
  "token_limit_exceeded",
  "string_too_long",
  "invalid_request",
  "invalid_prompt",
  "not_found",
  "precondition_failed",
  "payload_too_large",
  "unprocessable",
  "invalid_image",
  "image_too_large",
  "image_too_small",
  "unsupported_image_format",
  "image_not_found",
  "image_download_failed",
  "permission_denied",
  "content_policy_violation",
  "refusal",
  "payment_required",
]);

function dispositionForErrorType(
  errorType: string,
  input: UpstreamErrorInfo
): ErrorDisposition | undefined {
  if (errorType === "authentication") {
    return {
      action: "retry_rotate",
      quarantineTtlSec: resolveAuthTtl(input.consecutiveAuthFailures),
      reason: "auth_failure_key_quarantined",
      isRetryable: true,
      errorType,
    };
  }
  if (errorType === "rate_limit_exceeded") {
    const reset = parseResetDelay(input.headers, input.bodyText);
    const ttlSec =
      !isProviderQuarantineEnabled(input.provider) || getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC === 0
        ? 0
        : Math.round(reset.delayMs / 1000);
    return {
      action: "retry_rotate",
      quarantineTtlSec: ttlSec,
      reason: "Rate limit reached (429)",
      isRetryable: true,
      errorType,
    };
  }
  const retryTtl = ERROR_TYPE_RETRY_TTL_SEC[errorType];
  if (retryTtl !== undefined) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: retryTtl,
      reason: `Upstream typed error (${errorType})`,
      isRetryable: true,
      errorType,
    };
  }
  if (ERROR_TYPE_FAIL_FAST_ZERO.has(errorType)) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: `Upstream typed error (${errorType})`,
      isRetryable: false,
      errorType,
    };
  }
  return undefined;
}

export function classifyTransportError(error: unknown): ErrorDisposition {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (isStreamCanceledError(lower)) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 0,
      reason: "transport_stream_canceled_immediate_retry",
      isRetryable: true,
    };
  }

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

  // 0. Stream cancellation or transport abort in body/message -> immediate 0s retry
  if (isStreamCanceledError(text)) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 0,
      reason: "transport_stream_canceled_immediate_retry",
      isRetryable: true,
    };
  }

  // 0b. Status 0: Network / transport error before response headers
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

  // 1. Conserve rules FIRST: custom per-provider quota/parking rules
  if (input.conserveRules && input.conserveRules.length > 0) {
    for (const rule of input.conserveRules) {
      if (status === rule.status && text.includes(rule.contains.toLowerCase())) {
        const ttlSec = resolveConserveTtlSec(rule.ttl);
        return {
          action: "retry_rotate",
          quarantineTtlSec: ttlSec,
          reason: rule.reason,
          isRetryable: true,
          isConserve: true,
        };
      }
    }
  }

  // 1b. Canonical error_type wins over status (3 skins); fallback to status below.
  const errorType = parseCanonicalErrorType(rawBody);
  if (errorType) {
    const typed = dispositionForErrorType(errorType, input);
    if (typed) {
      return typed;
    }
  }

  // 2. Status 400: Check provider retryable vs client-side fail fast
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

  // 2b. Status 408: request timeout — retry_rotate with zero quarantine
  // (delay is scheduled by the caller's providers.json request_retry, not here).
  if (status === 408) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 0,
      reason: "Request timeout (408)",
      isRetryable: true,
      errorType,
    };
  }

  // 3. Status 429: Check quota exhaustion vs standard rate limit
  if (status === 429) {
    if (isQuotaExhausted429(text)) {
      return {
        action: "retry_rotate",
        quarantineTtlSec: !isProviderQuarantineEnabled(input.provider) ? 0 : SEVEN_DAYS_SEC,
        reason: "Quota or credit exhaustion (429)",
        isRetryable: true,
      };
    }

    const reset = parseResetDelay(headers, rawBody);
    const ttlSec =
      !isProviderQuarantineEnabled(input.provider) || getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC === 0
        ? 0
        : Math.round(reset.delayMs / 1000);
    return {
      action: "retry_rotate",
      quarantineTtlSec: ttlSec,
      reason: "Rate limit reached (429)",
      isRetryable: true,
    };
  }

  // 4. Status 403: forbidden — fail_fast with zero quarantine (never park the key).
  if (status === 403) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Client error (403)",
      isRetryable: false,
      errorType,
    };
  }

  // 5. Status 401: auth failure — tiered key quarantine (300s -> 1800s -> 86400s).
  if (status === 401) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: resolveAuthTtl(input.consecutiveAuthFailures),
      reason: "auth_failure_key_quarantined",
      isRetryable: true,
      errorType,
    };
  }

  // 6. Status 404: Not found (fail fast)
  if (status === 404) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Resource or model not found (404)",
      isRetryable: false,
    };
  }

  // 6b. Status 402: Payment required — insufficient credits (fail fast, never park the key).
  if (status === 402) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: "Payment required (402) - insufficient credits",
      isRetryable: false,
      errorType,
    };
  }

  // 7. Status 5xx (500, 502, 503, 504, etc.): Transient server error (10s)
  if (status >= 500 && status < 600) {
    return {
      action: "retry_rotate",
      quarantineTtlSec: 10,
      reason: `Transient upstream server error (${status})`,
      isRetryable: true,
    };
  }

  // 8. Other 4xx client errors: fail fast
  if (status >= 400 && status < 500) {
    return {
      action: "fail_fast",
      quarantineTtlSec: 0,
      reason: `Client error (${status})`,
      isRetryable: false,
    };
  }

  // 9. Any other status code (< 400)
  return {
    action: "fail_fast",
    quarantineTtlSec: 0,
    reason: `Status ${status}`,
    isRetryable: false,
  };
}
