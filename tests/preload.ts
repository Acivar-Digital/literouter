/**
 * Global air-gap test preload harness for LiteRouter test suite.
 * Registered via bunfig.toml [test] preload = ["./tests/preload.ts"].
 *
 * 1. Sanitizes process.env provider API keys with synthetic mock stubs.
 * 2. Sets NODE_ENV = "test" and LITEROUTER_TEST_MODE = "true".
 * 3. Enforces an outbound network safety barrier on globalThis.fetch to block
 *    unmocked calls to external LLM provider endpoints.
 */

export class UnmockedOutboundCallError extends Error {
  constructor(url: string) {
    super(`Outbound live API request blocked in test environment to: ${url}`);
    this.name = "UnmockedOutboundCallError";
  }
}

// Make UnmockedOutboundCallError globally available
(globalThis as unknown as Record<string, unknown>).UnmockedOutboundCallError = UnmockedOutboundCallError;

// 1. In-memory environment sanitization
process.env.NODE_ENV = "test";
process.env.LITEROUTER_TEST_MODE = "true";
if (!process.env.LITEROUTER_ENGINE) {
  process.env.LITEROUTER_ENGINE = "legacy";
}

const MOCK_PROVIDER_KEYS: Readonly<Record<string, string>> = {
  GOOGLE_API_KEYS: "mock-gg-stub-key-01,mock-gg-stub-key-02",
  GCP_KEYS: "mock-gc-stub-key-01,mock-gc-stub-key-02",
  GCP_API_KEYS: "mock-gc-stub-key-01,mock-gc-stub-key-02",
  OPENROUTER_API_KEYS: "mock-or-stub-key-01,mock-or-stub-key-02",
  NVIDIA_API_KEYS: "mock-nv-stub-key-01,mock-nv-stub-key-02",
  ZEN_API_KEYS: "mock-zn-stub-key-01,mock-zn-stub-key-02",
  ANTHROPIC_API_KEYS: "mock-an-stub-key-01,mock-an-stub-key-02",
  OPENAI_API_KEYS: "mock-oa-stub-key-01,mock-oa-stub-key-02",
  GROQ_API_KEYS: "mock-gq-stub-key-01,mock-gq-stub-key-02",
  CEREBRAS_API_KEYS: "mock-cb-stub-key-01,mock-cb-stub-key-02",
  DEEPSEEK_API_KEYS: "mock-ds-stub-key-01,mock-ds-stub-key-02",
  MISTRAL_API_KEYS: "mock-ms-stub-key-01,mock-ms-stub-key-02",
  TOGETHER_API_KEYS: "mock-tg-stub-key-01,mock-tg-stub-key-02",
};

for (const [key, stub] of Object.entries(MOCK_PROVIDER_KEYS)) {
  process.env[key] = stub;
  if (typeof Bun !== "undefined" && Bun.env) {
    Bun.env[key] = stub;
  }
}

// 2. Global outbound network air-gap barrier
function extractUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (
    input !== null &&
    typeof input === "object" &&
    "url" in input &&
    typeof (input as { url: unknown }).url === "string"
  ) {
    return (input as { url: string }).url;
  }
  return String(input);
}

function isLoopbackOrTestDouble(urlStr: string): boolean {
  if (urlStr.startsWith("/")) {
    return true;
  }
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".test")
    );
  } catch {
    const lower = urlStr.toLowerCase();
    return (
      lower.startsWith("localhost") ||
      lower.startsWith("127.0.0.1") ||
      lower.startsWith("http://localhost") ||
      lower.startsWith("https://localhost") ||
      lower.startsWith("http://127.0.0.1") ||
      lower.startsWith("https://127.0.0.1")
    );
  }
}

const originalFetch = globalThis.fetch;

export function airGapFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const targetUrl = extractUrl(input);
  if (!isLoopbackOrTestDouble(targetUrl)) {
    throw new UnmockedOutboundCallError(targetUrl);
  }
  return originalFetch.call(globalThis, input as RequestInfo, init);
}

globalThis.fetch = airGapFetch as typeof fetch;
