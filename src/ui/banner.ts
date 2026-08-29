export interface KeyPoolSummary {
  readonly provider: string;
  readonly activeKeys: number;
}

export interface BannerOptions {
  readonly port: number;
  readonly tlsEnabled: boolean;
  readonly stripReasoning: boolean;
  readonly keyPools: readonly KeyPoolSummary[];
}

function formatPoolLine(pool: KeyPoolSummary): string {
  const label = pool.provider.padEnd(14, " ");
  return `  • ${label}: ${pool.activeKeys} active key(s)`;
}

function renderKeyPoolsSection(pools: readonly KeyPoolSummary[]): string[] {
  if (pools.length === 0) {
    return ["  • (No active key pools loaded from .env.local)"];
  }
  return pools.map((p) => formatPoolLine(p));
}

function buildBannerLines(options: BannerOptions): string[] {
  const protocol = options.tlsEnabled ? "HTTP/2 (h2 ALPN) & HTTP/1.1 TLS" : "HTTP/1.1 Cleartext";
  const poolLines = renderKeyPoolsSection(options.keyPools);

  return [
    "================================================================================",
    "🚀 LITEROUTER v3.1 GATEWAY [BUN RUNTIME]",
    "================================================================================",
    `Port           : ${options.port}`,
    `Protocol       : ${protocol}`,
    `TLS Enabled    : ${options.tlsEnabled}`,
    `Auth Mode      : API-Key Declarative Directive (lr-xx-xx-xx-xx / lr-fse-xxxx)`,
    `Strip Reasoning: ${options.stripReasoning} (Global default; overridable via 'ts' nuance)`,
    "",
    "Key Pools Loaded:",
    ...poolLines,
    "",
    "Endpoints Registered:",
    "  • /v1/chat/completions        (OpenAI Chat Completions)",
    "  • /v1/messages                (Anthropic Claude Messages)",
    "  • /v1/messages/count_tokens   (Anthropic Token Counter)",
    "  • /v1/models                  (Dynamic Model Discovery)",
    "  • /v1beta/openai/*            (Google OpenAI-Compat Beta)",
    "  • /v1beta/models/*            (Google Native RPC)",
    "  • /reset                      (Hard Flush / Key Unfreeze)",
    "  • /health                     (Health Check Probe)",
    "================================================================================",
  ];
}

export function printBanner(options: BannerOptions): void {
  const lines = buildBannerLines(options);
  console.log(lines.join("\n"));
}
