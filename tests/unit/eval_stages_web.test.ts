/**
 * tests/unit/eval_stages_web.test.ts
 *
 * Unit tests for eval/stages_web/stage1_structure.ts and stage2_responsive.ts
 */

import { describe, expect, it } from "bun:test";
import {
  checkLayoutHierarchy,
  checkModernLayout,
  checkSpatialCardLayout,
  evaluateStructure,
  extractCodeBlock,
  runStage1Structure,
} from "../../eval/stages_web/stage1_structure";
import {
  checkBreakpoints,
  checkMobileStack,
  checkOverflowPrevention,
  evaluateResponsive,
  runStage2Responsive,
} from "../../eval/stages_web/stage2_responsive";
import type { StageContext } from "../../eval/stages_web/types";

describe("Web Evaluation - Stage 1: DOM Structure & Layout Fidelity", () => {
  const validDashboardHtml = `
\`\`\`html
<div class="min-h-screen bg-slate-900 text-white flex flex-col">
  <header class="w-full bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <span class="font-bold text-xl text-sky-400">CloudDashboard</span>
    </div>
    <nav class="flex items-center gap-6">
      <a href="#overview" class="text-sm font-medium hover:text-sky-400">Overview</a>
      <a href="#settings" class="text-sm font-medium hover:text-sky-400">Settings</a>
    </nav>
  </header>

  <div class="flex-1 flex">
    <aside class="w-64 bg-slate-800 p-6 hidden md:block">
      <ul class="flex flex-col gap-3">
        <li class="p-2 rounded bg-slate-700">Analytics</li>
        <li class="p-2 rounded hover:bg-slate-700">Clusters</li>
      </ul>
    </aside>

    <main class="flex-1 p-8">
      <h1 class="text-2xl font-bold mb-6">Metrics Overview</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="card p-6 rounded-xl bg-slate-800 border border-slate-700 shadow">
          <p class="text-sm text-slate-400">Total Invocations</p>
          <p class="text-3xl font-bold">12.4M</p>
        </div>
        <div class="card p-6 rounded-xl bg-slate-800 border border-slate-700 shadow">
          <p class="text-sm text-slate-400">P99 Latency</p>
          <p class="text-3xl font-bold">142ms</p>
        </div>
        <div class="card p-6 rounded-xl bg-slate-800 border border-slate-700 shadow">
          <p class="text-sm text-slate-400">Availability</p>
          <p class="text-3xl font-bold">99.99%</p>
        </div>
      </div>
    </main>
  </div>

  <footer class="bg-slate-800 py-4 px-6 text-center text-xs text-slate-500 border-t border-slate-700">
    &copy; 2026 CloudMetrics Inc. All rights reserved.
  </footer>
</div>
\`\`\`
`;

  const brokenAbsoluteLayoutHtml = `
<div style="width: 1400px;">
  <div style="position: absolute; top: 100px; left: 50px;">Card 1</div>
  <div style="position: absolute; top: 100px; left: 350px;">Card 2</div>
  <div style="position: absolute; top: 100px; left: 650px;">Card 3</div>
</div>
`;

  it("extractCodeBlock extracts content from markdown code fences", () => {
    const extracted = extractCodeBlock(validDashboardHtml);
    expect(extracted).not.toContain("```html");
    expect(extracted).toContain("<header");
    expect(extracted).toContain("<footer");
  });

  it("checkLayoutHierarchy detects HTML5 semantic landmarks", () => {
    const clean = extractCodeBlock(validDashboardHtml);
    const result = checkLayoutHierarchy(clean);
    expect(result.score).toBe(30);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("5/5 structural landmarks");
  });

  it("checkModernLayout verifies CSS Grid and Flexbox attributes", () => {
    const clean = extractCodeBlock(validDashboardHtml);
    const result = checkModernLayout(clean);
    expect(result.score).toBe(35);
    expect(result.passed).toBe(true);
  });

  it("checkSpatialCardLayout verifies 3-column grid and clean flow without absolute overlap hacks", () => {
    const clean = extractCodeBlock(validDashboardHtml);
    const result = checkSpatialCardLayout(clean);
    expect(result.score).toBe(35);
    expect(result.passed).toBe(true);
  });

  it("evaluateStructure scores a well-architected dashboard above passing threshold", () => {
    const clean = extractCodeBlock(validDashboardHtml);
    const evalRes = evaluateStructure(clean);
    expect(evalRes.score).toBe(100);
    expect(evalRes.passed).toBe(true);
    expect(evalRes.checks.length).toBe(3);
  });

  it("evaluateStructure penalizes broken layouts with absolute coordinate hacks", () => {
    const evalRes = evaluateStructure(brokenAbsoluteLayoutHtml);
    expect(evalRes.score).toBeLessThan(50);
    expect(evalRes.passed).toBe(false);
  });

  it("runStage1Structure handles unreachable gateway gracefully", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error("Connection refused (ECONNREFUSED)");
    };
    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage1Structure(ctx);
      expect(result.stageNumber).toBe(1);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.error).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("runStage1Structure succeeds with valid model completion", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: validDashboardHtml,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://localhost:7766/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage1Structure(ctx);
      expect(result.stageNumber).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.checks.length).toBe(3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("Web Evaluation - Stage 2: Responsive Design & Mobile Scaling", () => {
  const responsiveHtml = `
\`\`\`html
<div class="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-hidden">
  <div class="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
    <h1 class="text-2xl font-bold">Billing & Usage</h1>
    <div class="hidden md:flex gap-3">
      <button class="px-4 py-2 bg-sky-500 rounded">Export</button>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div class="p-6 bg-white rounded-lg shadow sm:p-4 lg:p-8">Tier A</div>
    <div class="p-6 bg-white rounded-lg shadow sm:p-4 lg:p-8">Tier B</div>
    <div class="p-6 bg-white rounded-lg shadow sm:p-4 lg:p-8">Tier C</div>
  </div>
</div>
\`\`\`
`;

  const nonResponsiveRigidHtml = `
<div class="w-[1400px] min-w-[1200px] flex">
  <div class="grid-cols-3 flex-row">
    <div>Static Column 1</div>
    <div>Static Column 2</div>
    <div>Static Column 3</div>
  </div>
</div>
`;

  it("checkBreakpoints identifies responsive prefixes", () => {
    const clean = extractCodeBlock(responsiveHtml);
    const result = checkBreakpoints(clean);
    expect(result.score).toBeGreaterThanOrEqual(24);
    expect(result.passed).toBe(true);
  });

  it("checkMobileStack identifies collapsing grids and flex stacks", () => {
    const clean = extractCodeBlock(responsiveHtml);
    const result = checkMobileStack(clean);
    expect(result.score).toBe(40);
    expect(result.passed).toBe(true);
  });

  it("checkOverflowPrevention rewards fluid containers and detects absence of rigid widths", () => {
    const clean = extractCodeBlock(responsiveHtml);
    const result = checkOverflowPrevention(clean);
    expect(result.score).toBe(30);
    expect(result.passed).toBe(true);
  });

  it("evaluateResponsive scores responsive code above passing threshold", () => {
    const clean = extractCodeBlock(responsiveHtml);
    const evalRes = evaluateResponsive(clean);
    expect(evalRes.score).toBeGreaterThanOrEqual(80);
    expect(evalRes.passed).toBe(true);
  });

  it("evaluateResponsive penalizes rigid fixed widths and missing breakpoints", () => {
    const evalRes = evaluateResponsive(nonResponsiveRigidHtml);
    expect(evalRes.score).toBeLessThan(50);
    expect(evalRes.passed).toBe(false);
  });

  it("runStage2Responsive handles unreachable gateway gracefully", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error("Connection refused (ECONNREFUSED)");
    };
    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://127.0.0.1:59999/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage2Responsive(ctx);
      expect(result.stageNumber).toBe(2);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.error).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("runStage2Responsive succeeds with valid model completion", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: responsiveHtml,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const ctx: StageContext = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://localhost:7766/v1/chat/completions",
        runs: 1,
      };
      const result = await runStage2Responsive(ctx);
      expect(result.stageNumber).toBe(2);
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
