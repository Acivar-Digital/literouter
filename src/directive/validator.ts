import { parseDirective, type ParsedDirective } from "./parser";

export const DIRECTIVE_ERROR_CODE = "invalid_api_key";
export const DIRECTIVE_ERROR_TYPE = "invalid_request_error";

export interface ValidationSuccess {
  readonly valid: true;
  readonly directive: ParsedDirective;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface StandardErrorPayload {
  readonly error: {
    readonly message: string;
    readonly type: "invalid_request_error";
    readonly code: "invalid_api_key";
  };
}

function extractFromAuthHeader(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function extractFromQuery(urlStr: string): string | null {
  const urlObj = new URL(urlStr, "http://localhost:7766");
  const keyParam = urlObj.searchParams.get("key");
  if (keyParam) {
    return keyParam;
  }
  const apiKeyParam = urlObj.searchParams.get("api_key");
  if (apiKeyParam) {
    return apiKeyParam;
  }
  const tokenParam = urlObj.searchParams.get("token");
  if (tokenParam) {
    return tokenParam;
  }
  return null;
}

export function extractDirectiveToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  const fromAuth = extractFromAuthHeader(authHeader);
  if (fromAuth) {
    return fromAuth;
  }
  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey.trim();
  }
  const xGoogApiKey = req.headers.get("x-goog-api-key");
  if (xGoogApiKey) {
    return xGoogApiKey.trim();
  }
  return extractFromQuery(req.url);
}

export function normalizeKey(rawKey: string): string {
  return rawKey.trim().toLowerCase();
}

export function validateDirective(
  rawKey: string | null | undefined
): ValidationResult {
  if (!rawKey) {
    return {
      valid: false,
      error: "Missing API key directive. Pass via Authorization, x-api-key, or ?key=",
    };
  }
  const normalized = normalizeKey(rawKey);
  const directive = parseDirective(normalized);
  if (!directive) {
    return {
      valid: false,
      error: `Invalid API key directive '${rawKey}'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>`,
    };
  }
  return {
    valid: true,
    directive,
  };
}

export function createUnauthorizedResponse(message?: string): Response {
  const detail =
    message ??
    "Invalid API key directive. Must conform to lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>";
  const payload: StandardErrorPayload = {
    error: {
      message: detail,
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  };
  return new Response(JSON.stringify(payload, null, 2), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer error="invalid_token"',
    },
  });
}
