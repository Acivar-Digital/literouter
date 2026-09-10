/**
 * eval/stages_web/types.ts
 *
 * Data contracts and types for modular Web/Frontend Vision-Language Model evaluation stages.
 */

export interface StageContext {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  runs: number;
  imageInput?: string; // URL or data URI
  imageUri?: string;   // Backward-compatibility alias
}

export interface SubCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface StageResult {
  stageNumber: number;
  stageName: string;
  passed: boolean;
  score: number; // 0 to 100
  durationMs: number;
  checks: SubCheck[];
  rawOutput?: string;
  error?: string;
  details?: Record<string, unknown>;
  notes?: string[];
}

export type StageRunner = (ctx: StageContext) => Promise<StageResult>;

/**
 * Standard self-contained SVG dashboard mockup data URI for visual/web evaluations
 * when no custom --image argument is provided.
 */
export const DEFAULT_DASHBOARD_MOCKUP =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <rect width="1200" height="800" fill="#0f172a" />
  <!-- Sidebar -->
  <rect x="0" y="0" width="240" height="800" fill="#1e293b" />
  <text x="32" y="52" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="20" font-weight="bold">CloudMetrics</text>
  <rect x="24" y="90" width="192" height="40" rx="8" fill="#334155" />
  <text x="48" y="115" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="14">Overview</text>
  <text x="48" y="165" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Analytics</text>
  <text x="48" y="215" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Infrastructure</text>
  <text x="48" y="265" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Settings</text>
  
  <!-- Topbar -->
  <rect x="240" y="0" width="960" height="70" fill="#1e293b" />
  <text x="272" y="42" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="600">Production Cluster Status</text>
  <circle cx="1140" cy="35" r="18" fill="#3b82f6" />
  <text x="1134" y="40" fill="#ffffff" font-family="system-ui, sans-serif" font-size="14">AD</text>

  <!-- Metric Cards -->
  <g transform="translate(270, 100)">
    <!-- Card 1 -->
    <rect x="0" y="0" width="270" height="120" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1" />
    <text x="24" y="36" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Total Requests</text>
    <text x="24" y="78" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="28" font-weight="bold">2.4M</text>
    <text x="24" y="102" fill="#22c55e" font-family="system-ui, sans-serif" font-size="12">↑ 12.4% vs last week</text>

    <!-- Card 2 -->
    <rect x="310" y="0" width="270" height="120" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1" />
    <text x="334" y="36" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Avg Latency (TTFT)</text>
    <text x="334" y="78" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="28" font-weight="bold">84ms</text>
    <text x="334" y="102" fill="#22c55e" font-family="system-ui, sans-serif" font-size="12">↓ 5.1ms improvement</text>

    <!-- Card 3 -->
    <rect x="620" y="0" width="270" height="120" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1" />
    <text x="644" y="36" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">Error Rate</text>
    <text x="644" y="78" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="28" font-weight="bold">0.01%</text>
    <text x="644" y="102" fill="#22c55e" font-family="system-ui, sans-serif" font-size="12">Healthy &amp; Stable</text>
  </g>

  <!-- Chart & Activity Panel -->
  <rect x="270" y="250" width="890" height="490" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1" />
  <text x="300" y="295" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="600">Throughput &amp; Resource Allocation</text>
  <path d="M 320 650 Q 450 480 600 520 T 900 380 T 1120 340" fill="none" stroke="#38bdf8" stroke-width="3" />
  <line x1="320" y1="670" x2="1120" y2="670" stroke="#334155" stroke-width="1" />
  <text x="320" y="695" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">00:00</text>
  <text x="520" y="695" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">06:00</text>
  <text x="720" y="695" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">12:00</text>
  <text x="920" y="695" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">18:00</text>
  <text x="1100" y="695" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">24:00</text>
</svg>`);
