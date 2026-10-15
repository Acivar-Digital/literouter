import { createHash, timingSafeEqual } from "node:crypto";
import { parseDirective, type ParsedDirective } from "./parser";
import { getEnv } from "../config/env";

export const DIRECTIVE_ERROR_CODE = "invalid_api_key";
export const DIRECTIVE_ERROR_TYPE = "invalid_request_error";

export function verifyMasterSecret(candidate: string, expected: string): boolean {
  if (!candidate || !expected) {
    return false;
  }
  const candHash = createHash("sha256").update(candidate).digest();
  const expHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candHash, expHash);
}

export interface ResolvedInferenceAuth {
  readonly valid: boolean;
  readonly directiveStr: string;
  readonly error?: string;
}

export function resolveInferenceAuth(req: Request, candidateToken?: string): ResolvedInferenceAuth {
  const authKey = getEnv().LITEROUTER_AUTH_KEY;
  const token = (candidateToken || extractDirectiveToken(req) || "").trim();
  const headerDirective = req.headers.get("x-literouter-directive") || req.headers.get("x-directive");
  const headerMasterKey = req.headers.get("x-literouter-key") || req.headers.get("x-auth-key");

  if (!authKey) {
    // Permissive ergonomics when LITEROUTER_AUTH_KEY is not configured
    const directiveStr = headerDirective?.trim() || token;
    return { valid: true, directiveStr };
  }

  // When LITEROUTER_AUTH_KEY is configured:
  // Option 1: Authorization: Bearer <authKey> with x-literouter-directive: lr-...
  if (verifyMasterSecret(token, authKey)) {
    if (headerDirective && headerDirective.trim()) {
      return { valid: true, directiveStr: headerDirective.trim() };
    }
    return {
      valid: false,
      directiveStr: "",
      error: "Master key accepted, but missing routing directive in 'x-literouter-directive' header",
    };
  }

  // Option 2: Authorization: Bearer <directive> with x-literouter-key: <authKey>
  if (headerMasterKey && verifyMasterSecret(headerMasterKey.trim(), authKey)) {
    return { valid: true, directiveStr: token };
  }

  return {
    valid: false,
    directiveStr: "",
    error: "Authentication failed: valid LITEROUTER_AUTH_KEY required",
  };
}

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
  if (!trimmed || trimmed.toLowerCase() === "bearer") {
    return null;
  }
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    const token = trimmed.slice(7).trim();
    return token.length > 0 ? token : null;
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
