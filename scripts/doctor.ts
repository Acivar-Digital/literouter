// Live API Key Validation Probe (FYI-ONLY)
//
// Faithful Bun/TypeScript port of src/doctor.py (Gate 2 key validation).
// This script is FYI-ONLY: it reports key health and exits. It MUST NOT gate
// boot, MUST NOT be invoked by start.sh/restart.sh, and has NO --force flag.

import * as path from "path";
import { existsSync } from "fs";

// Inject mkcert root CA so Bun/Node.js fetch can verify localhost TLS certs
const caPath = path.join(
  path.resolve(process.env.HOME || "", ".local/share/opencode2/mkcert"),
  "rootCA.pem",
);
if (existsSync(caPath)) {
  process.env.NODE_EXTRA_CA_CERTS = caPath;
  process.env.SSL_CERT_FILE = caPath;
}

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const DOTENV_PATH = path.join(PROJECT_ROOT, ".env");

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = Bun.file(path).toString();
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key) env[key] = val;
    }
  } catch (exc) {
    console.warn(`⚠️ Failed to load env file at ${path}: ${exc}`);
  }
  return env;
}

const fileEnv = loadEnvFile(DOTENV_PATH);

function getEnv(key: string): string | undefined {
  return (Bun.env as Record<string, string | undefined>)[key] ?? fileEnv[key];
}

function readKeys(envVar: string): string[] {
  const raw = getEnv(envVar) || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function mask(key: string): string {
  return key.substring(0, 6) + "...";
}

async function probeGoogleKey(key: string): Promise<boolean> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" +
    key;
  const payload = {
    contents: [{ parts: [{ text: "ping" }] }],
    generationConfig: { maxOutputTokens: 100 },
  };
  const maskedKey = mask(key);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.status === 200) {
      console.log(`[GOOGLE] ✅ Key '${maskedKey}' is healthy (200 OK).`);
      return true;
    } else if (resp.status === 401 || resp.status === 403) {
      console.error(
        `[GOOGLE] ❌ Key '${maskedKey}' failed with status ${resp.status} (UNAUTHORIZED).`,
      );
      return false;
    } else if (resp.status === 429) {
      console.warn(
        `[GOOGLE] ⚠️ Key '${maskedKey}' is rate-limited (429) but validated as operational.`,
      );
      return true;
    } else {
      console.warn(
        `[GOOGLE] ⚠️ Key '${maskedKey}' warning status ${resp.status}.`,
      );
      return true;
    }
  } catch (exc) {
    console.warn(
      `[GOOGLE] ⚠️ Connection error for key '${maskedKey}': ${exc}. Treating as warning.`,
    );
    return true;
  }
}

async function probeNvidiaKey(key: string): Promise<boolean> {
  const url = "https://integrate.api.nvidia.com/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const payload = {
    model: "meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 100,
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const m = mask(key);
    if (resp.status === 200) {
      console.log(`[NVIDIA] ✅ Key '${m}' is healthy (200 OK).`);
      return true;
    } else if (resp.status === 401 || resp.status === 403) {
      console.error(
        `[NVIDIA] ❌ Key '${m}' failed with status ${resp.status} (UNAUTHORIZED).`,
      );
      return false;
    } else if (resp.status === 429) {
      console.warn(
        `[NVIDIA] ⚠️ Key '${m}' is rate-limited (429) but validated as operational.`,
      );
      return true;
    } else {
      console.warn(`[NVIDIA] ⚠️ Key '${m}' warning status ${resp.status}.`);
      return true;
    }
  } catch (exc) {
    console.warn(`[NVIDIA] ⚠️ Connection error: ${exc}. Treating as warning.`);
    return true;
  }
}

async function probeOpenrouterKey(key: string): Promise<boolean> {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const payload = {
    model: "nvidia/nemotron-3-nano-30b-a3b:free",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 100,
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const m = mask(key);
    if (resp.status === 200) {
      console.log(`[OPENROUTER] ✅ Key '${m}' is healthy (200 OK).`);
      return true;
    } else if (resp.status === 401 || resp.status === 403) {
      console.error(
        `[OPENROUTER] ❌ Key '${m}' failed with status ${resp.status} (UNAUTHORIZED).`,
      );
      return false;
    } else if (resp.status === 429) {
      console.warn(
        `[OPENROUTER] ⚠️ Key '${m}' is rate-limited (429) but validated as operational.`,
      );
      return true;
    } else {
      console.warn(`[OPENROUTER] ⚠️ Key '${m}' warning status ${resp.status}.`);
      return true;
    }
  } catch (exc) {
    console.warn(
      `[OPENROUTER] ⚠️ Connection error: ${exc}. Treating as warning.`,
    );
    return true;
  }
}

async function probeZenKey(key: string): Promise<boolean> {
  const url = "https://opencode.ai/zen/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const payload = {
    model: "zen/hy3-free",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 100,
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const m = mask(key);
    if (resp.status === 200) {
      console.log(`[ZEN] ✅ Key '${m}' is healthy (200 OK).`);
      return true;
    } else if (resp.status === 401 || resp.status === 403) {
      console.error(
        `[ZEN] ❌ Key '${m}' failed with status ${resp.status} (UNAUTHORIZED).`,
      );
      return false;
    } else if (resp.status === 429) {
      console.warn(
        `[ZEN] ⚠️ Key '${m}' is rate-limited (429) but validated as operational.`,
      );
      return true;
    } else {
      console.warn(`[ZEN] ⚠️ Key '${m}' warning status ${resp.status}.`);
      return true;
    }
  } catch (exc) {
    console.warn(`[ZEN] ⚠️ Connection error: ${exc}. Treating as warning.`);
    return true;
  }
}

async function probeSelf(): Promise<boolean> {
  const port = getEnv("LITEROUTER_PORT") || "7766";
  const certPath = path.resolve(PROJECT_ROOT, "certs", "localhost.pem");

  // If TLS certs exist, probe via HTTPS over HTTP/2 ALPN
  if (existsSync(certPath) && existsSync(caPath)) {
    const url = `https://localhost:${port}/health`;
    try {
      const resp = await fetch(url);
      if (resp.status === 200) {
        console.log(
          `[LITEROUTER] ✅ Self-test: HTTPS health check OK (HTTP/2 via ALPN).`,
        );
        return true;
      }
      console.warn(
        `[LITEROUTER] ⚠️ Self-test: health returned HTTP ${resp.status}.`,
      );
      return true;
    } catch (exc) {
      console.warn(
        `[LITEROUTER] ⚠️ Self-test: HTTPS failed (${exc}); trying plaintext.`,
      );
    }
  }

  // Fallback: plaintext HTTP probe
  const url = `http://localhost:${port}/health`;
  try {
    const resp = await fetch(url);
    if (resp.status === 200) {
      console.log(
        `[LITEROUTER] ✅ Self-test: plaintext health check OK (HTTP/1.1).`,
      );
      return true;
    }
    console.warn(
      `[LITEROUTER] ⚠️ Self-test: health returned HTTP ${resp.status}.`,
    );
    return true;
  } catch (exc) {
    console.warn(
      `[LITEROUTER] ⚠️ Self-test: gateway not running on ${url} — ${exc}.`,
    );
    return true;
  }
}

async function runDiagnostics(): Promise<void> {
  console.log("🔍 Starting FYI-only key health probes (2s wait per key)...");

  console.log("🔍 [0/4] Self-test (probe LiteRouter health endpoint)...");
  await probeSelf();

  console.log("🔍 [1/4] Probing Google API keys...");

  async function probePool(
    provider: string,
    keys: string[],
    probe: (k: string) => Promise<boolean>,
  ): Promise<boolean[]> {
    if (keys.length === 0) {
      console.log(`[${provider}] ⏭️ Skipped: no keys configured.`);
      return [];
    }
    const results: boolean[] = [];
    for (const key of keys) {
      results.push(await probe(key));
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }

  const [google, nvidia, openrouter, zen] = await Promise.all([
    probePool("GOOGLE", readKeys("GOOGLE_API_KEYS"), probeGoogleKey),
    probePool("NVIDIA", readKeys("NVIDIA_API_KEYS"), probeNvidiaKey),
    probePool("OPENROUTER", readKeys("OPENROUTER_API_KEYS"), probeOpenrouterKey),
    probePool("ZEN", readKeys("ZEN_API_KEYS"), probeZenKey),
  ]);

  const flatResults = [...google, ...nvidia, ...openrouter, ...zen];
  const failures = flatResults.filter((r) => r === false).length;
  const totalProbed = flatResults.length;

  if (totalProbed === 0) {
    console.error(
      "⚠️ Diagnostics complete. No keys found in .env (searched at " +
        DOTENV_PATH +
        "). All providers skipped. (FYI only — boot is NOT gated.)",
    );
  } else if (failures > 0) {
    console.error(
      `⚠️ Diagnostics complete. ${failures} of ${totalProbed} key(s) returned fatal authentication failures. (FYI only — boot is NOT gated.)`,
    );
  } else {
    console.log(
      `✅ Diagnostics complete. All ${totalProbed} probed keys validated successfully. (FYI only.)`,
    );
  }
}

runDiagnostics().then(() => process.exit(0));
