/**
 * Backwards-compatibility forwarding shim.
 * Canonical implementation now lives in `scripts/update-user-agent.ts`.
 */
import { getOpencodeVersion, main, updateUserAgent } from "../scripts/update-user-agent";

export { getOpencodeVersion, updateUserAgent, main };

if (import.meta.main) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [WARN] Unexpected error in get_opencode_ver shim: ${msg}`);
    process.exit(0);
  });
}
