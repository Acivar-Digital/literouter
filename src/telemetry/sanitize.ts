/**
 * Telemetry Secret Redaction & Header Allowlisting Pipeline
 *
 * Implements the security architecture defined in docs/redesign02.md §10.2:
 * - Structural guarantee: Allowlist-only header retention; novel/unknown headers dropped.
 * - Sensitive headers redacted to "[REDACTED]".
 * - Defense-in-depth secondary pass: regex scrubbing of known API keys in payload bodies.
 */

export const ALLOWED_HEADERS: ReadonlySet<string> = new Set<string>([
  "content-type",
  "accept",
  "user-agent",
  "x-title",
  "http-referer",
  "referer",
  "x-request-id",
  "x-literouter-model",
  "x-literouter-tier",
  "x-literouter-chain",
  "x-session-id",
  "anthropic-version",
  "retry-after",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
]);

export const REDACTED_HEADERS: ReadonlySet<string> = new Set<string>([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "cookie",
  "set-cookie",
]);

export const SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[a-zA-Z0-9_.-]+/g,
  /sk-or-v1-[a-zA-Z0-9]{64}/g,
  /nvapi-[a-zA-Z0-9_-]{64}/g,
  /AIzaSy[a-zA-Z0-9_-]{33}/g,
  /sk-lr-[a-zA-Z0-9_-]+/g,
] as const;

export const SECRET_REGEX =
  /(?:Bearer\s+[a-zA-Z0-9_.-]+|sk-or-v1-[a-zA-Z0-9]{64}|nvapi-[a-zA-Z0-9_-]{64}|AIzaSy[a-zA-Z0-9_-]{33}|sk-lr-[a-zA-Z0-9_-]+)/g;

/**
 * Sanitize headers using allowlist guarantee.
 * - Headers in REDACTED_HEADERS -> "[REDACTED]"
 * - Headers in ALLOWED_HEADERS -> value preserved
 * - All other headers -> silently dropped from traces
 */
export function sanitizeHeaders(
  headers: Headers | Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }

  const entries =
    headers instanceof Headers ? headers.entries() : Object.entries(headers);

  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      continue;
    }
    const lower = key.toLowerCase();
    if (REDACTED_HEADERS.has(lower)) {
      result[lower] = "[REDACTED]";
    } else if (ALLOWED_HEADERS.has(lower)) {
      result[lower] = value;
    }
  }

  return result;
}

/**
 * Sanitize body content using defense-in-depth regex scrubbing.
 * Converts input to string (JSON if object) and scrubs known secret patterns.
 */
export function sanitizeBody(body: unknown): string {
  if (body === undefined) {
    return "";
  }

  let text: string;
  if (typeof body === "string") {
    text = body;
  } else {
    try {
      text = JSON.stringify(body) ?? "";
    } catch {
      text = String(body);
    }
  }

  return text.replace(SECRET_REGEX, "[REDACTED_KEY]");
}
