import { getEnv } from "../src/config/env";
import { formatTimestamp } from "../src/ui/logger";

async function flushState(): Promise<void> {
  const port = getEnv().LITEROUTER_PORT;
  const url = `http://localhost:${port}/reset`;
  const ts = formatTimestamp();

  console.log(`🔄 ${ts} Invoking hard reset flush at ${url}...`);
  try {
    const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as { message?: string };
      console.log(`🟢 ${ts} Reset succeeded: ${data.message || "State unquarantined."}`);
    } else {
      console.warn(`⚠️ ${ts} Flush returned status ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connection failed";
    console.error(`💥 ${ts} Could not connect to running gateway: ${msg}`);
  }
}

if (import.meta.main) {
  flushState();
}
