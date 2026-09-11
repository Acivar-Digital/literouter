/**
 * eval/stages_web/stage2_responsive.ts
 *
 * Stage 2: Responsive Design & Scaling Rules
 * Evaluates:
 *   2.1 Responsive breakpoint modifiers (sm:, md:, lg:, xl: or media queries)
 *   2.2 Mobile stack behavior (grid-cols-1 md:grid-cols-3, flex-col md:flex-row, responsive visibility)
 *   2.3 Horizontal overflow prevention (absence of rigid w-[1400px] / min-w-[1000px], fluid w-full / max-w-*)
 */

import type { StageContext, StageResult, SubCheck } from "./types";
import { DEFAULT_DASHBOARD_MOCKUP } from "./types";
import { extractCodeBlock } from "./stage1_structure";

export interface ResponsiveEvaluation {
  score: number;
  passed: boolean;
  checks: SubCheck[];
  details: Record<string, unknown>;
  notes: string[];
}

/**
 * Checks for responsive breakpoint modifiers.
 * Max score: 30 points.
 */
export function checkBreakpoints(code: string): SubCheck & { score: number } {
  let score = 0;
  const detected: string[] = [];

  const hasSm = /\bsm:[\w[\]-]+/i.test(code);
  const hasMd = /\bmd:[\w[\]-]+/i.test(code);
  const hasLg = /\blg:[\w[\]-]+/i.test(code);
  const hasXl = /\bxl:[\w[\]-]+/i.test(code);
  const hasMedia = /@media\s*\([^)]+\)/i.test(code);

  if (hasMd) {
    score += 10;
    detected.push("md:");
  }
  if (hasSm) {
    score += 8;
    detected.push("sm:");
  }
  if (hasLg) {
    score += 8;
    detected.push("lg:");
  }
  if (hasXl || hasMedia) {
    score += 4;
    detected.push(hasXl ? "xl:" : "@media");
  }

  return {
    name: "Breakpoint Modifiers (sm/md/lg/xl)",
    passed: score >= 18,
    score,
    detail: `Score: ${score}/30. Detected breakpoints: ${detected.length > 0 ? detected.join(", ") : "none"}`,
  };
}

/**
 * Checks mobile stack behavior: collapsing grids and flex direction.
 * Max score: 40 points.
 */
export function checkMobileStack(code: string): SubCheck & { score: number } {
  let score = 0;
  const features: string[] = [];

  // Collapsing grid: grid-cols-1 on mobile, multi-column on md/lg
  const hasCollapsingGrid =
    /\bgrid-cols-1\b[^"']*\b(?:sm|md|lg):grid-cols-[2-6]\b/i.test(code) ||
    /\b(?:sm|md|lg):grid-cols-[2-6]\b[^"']*\bgrid-cols-1\b/i.test(code) ||
    (/\bgrid-cols-1\b/i.test(code) && /\b(?:md|lg):grid-cols-/i.test(code));

  if (hasCollapsingGrid) {
    score += 15;
    features.push("collapsing grid (grid-cols-1 -> md:grid-cols-*)");
  }

  // Collapsing flex: flex-col on mobile, flex-row on desktop
  const hasCollapsingFlex =
    /\bflex-col\b[^"']*\b(?:sm|md|lg):flex-row\b/i.test(code) ||
    /\b(?:sm|md|lg):flex-row\b[^"']*\bflex-col\b/i.test(code);

  if (hasCollapsingFlex) {
    score += 15;
    features.push("collapsing flex (flex-col -> md:flex-row)");
  }

  // Responsive visibility: hidden md:block, md:hidden, or hidden lg:flex
  const hasResponsiveVisibility =
    /\bhidden\b[^"']*\b(?:sm|md|lg):(?:block|flex|grid)\b/i.test(code) ||
    /\b(?:sm|md|lg):hidden\b/i.test(code);

  if (hasResponsiveVisibility) {
    score += 10;
    features.push("responsive visibility toggles");
  }

  return {
    name: "Mobile Stack Behavior (Collapsing Grids & Flex)",
    passed: score >= 25,
    score,
    detail: `Score: ${score}/40. Responsive stack patterns: ${features.length > 0 ? features.join("; ") : "none detected"}`,
  };
}

/**
 * Checks horizontal overflow prevention and absence of rigid fixed widths.
 * Max score: 30 points.
 */
export function checkOverflowPrevention(code: string): SubCheck & { score: number } {
  let score = 0;
  const notes: string[] = [];

  // Look for rigid fixed widths > 800px on containers
  const rigidWidthRegex =
    /\b(?:w|min-w)-\[\s*(?:1[0-9]{3}|[89][0-9]{2})\s*px\]|\b(?:width|min-width)\s*:\s*(?:1[0-9]{3}|[89][0-9]{2})\s*px/gi;
  const rigidMatches = code.match(rigidWidthRegex) || [];

  if (rigidMatches.length === 0) {
    score += 15;
    notes.push("Zero rigid fixed-width container anti-patterns");
  } else {
    notes.push(`Rigid fixed width detected: ${rigidMatches.slice(0, 3).join(", ")}`);
  }

  // Check for fluid width wrappers
  const hasFluidWidth = /\bw-full\b|\bmax-w-(?:[0-9]?[a-z]+|screen-[\w]+|\[\w+\])/i.test(code);
  if (hasFluidWidth) {
    score += 10;
    notes.push("Fluid width classes (w-full / max-w-*) present");
  }

  // Check for centering or overflow containment
  const hasContainment = /\bmx-auto\b|\boverflow-hidden\b|\boverflow-x-hidden\b|\bcontainer\b/i.test(code);
  if (hasContainment) {
    score += 5;
    notes.push("Container centering / overflow containment present");
  }

  return {
    name: "Horizontal Overflow Prevention & Fluid Containers",
    passed: score >= 20,
    score,
    detail: `Score: ${score}/30. ${notes.join("; ")}`,
  };
}

/**
 * Evaluates responsive design rules synchronously.
 */
export function evaluateResponsive(code: string): ResponsiveEvaluation {
  const breakpoints = checkBreakpoints(code);
  const mobileStack = checkMobileStack(code);
  const overflow = checkOverflowPrevention(code);

  const totalScore = breakpoints.score + mobileStack.score + overflow.score;
  const passed = totalScore >= 70;

  const checks: SubCheck[] = [
    { name: breakpoints.name, passed: breakpoints.passed, detail: breakpoints.detail },
    { name: mobileStack.name, passed: mobileStack.passed, detail: mobileStack.detail },
    { name: overflow.name, passed: overflow.passed, detail: overflow.detail },
  ];

  const notes: string[] = [
    breakpoints.detail || "",
    mobileStack.detail || "",
    overflow.detail || "",
  ];

  return {
    score: totalScore,
    passed,
    checks,
    details: {
      breakpointsScore: breakpoints.score,
      mobileStackScore: mobileStack.score,
      overflowScore: overflow.score,
    },
    notes,
  };
}

/**
 * Helper to construct messages payload for model invocation.
 */
function buildMessages(imageUri: string) {
  const promptText = `
You are a senior frontend engineer specializing in responsive web design.
Implement a modern, fully mobile-responsive dashboard using HTML and Tailwind CSS based on the provided mockup.
Key requirements:
1. Breakpoint modifiers: Use sm:, md:, lg:, and xl: modifiers appropriately.
2. Mobile stack: Multi-column grids must collapse to a single column on mobile (grid-cols-1 md:grid-cols-3) and flex containers must collapse (flex-col md:flex-row). Include responsive visibility for mobile navigation.
3. Overflow prevention: Do NOT use rigid fixed widths like w-[1400px] or min-w-[1000px]. Use fluid containers (w-full, max-w-7xl, mx-auto, overflow-hidden).
Output only the clean HTML/Tailwind code block.
`.trim();

  return [
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: imageUri } },
      ],
    },
  ];
}

/**
 * Executes Stage 2: Responsive Design & Scaling against gateway.
 */
export async function runStage2Responsive(ctx: StageContext): Promise<StageResult> {
  const startTime = Date.now();
  const imageUri = ctx.imageInput || ctx.imageUri || DEFAULT_DASHBOARD_MOCKUP;

  console.log(`\n========================================================================`);
  console.log(`📱 STAGE 2: RESPONSIVE DESIGN & MOBILE SCALING`);
  console.log(`========================================================================`);
  console.log(`   [2.1] Querying model for responsive dashboard code...`);

  try {
    const response = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        max_tokens: 4096,
        messages: buildMessages(imageUri),
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        stageNumber: 2,
        stageName: "Stage 2: Responsive Design & Mobile Scaling",
        passed: false,
        score: 0,
        durationMs: Date.now() - startTime,
        checks: [
          { name: "HTTP Gateway Response", passed: false, detail: `HTTP ${response.status}: ${errorText.slice(0, 100)}` },
        ],
        error: `HTTP ${response.status}: ${errorText}`,
        notes: [`Request failed with status ${response.status}`],
      };
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content || "";
    const cleanCode = extractCodeBlock(rawContent);

    const evalResult = evaluateResponsive(cleanCode);
    const durationMs = Date.now() - startTime;

    console.log(`   Score: ${evalResult.score}/100 - Passed: ${evalResult.passed}`);
    for (const chk of evalResult.checks) {
      const symbol = chk.passed ? "✅" : "❌";
      console.log(`     ${symbol} ${chk.name}: ${chk.detail}`);
    }

    return {
      stageNumber: 2,
      stageName: "Stage 2: Responsive Design & Mobile Scaling",
      passed: evalResult.passed,
      score: evalResult.score,
      durationMs,
      checks: evalResult.checks,
      rawOutput: rawContent.slice(0, 500),
      details: evalResult.details,
      notes: evalResult.notes,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const msg = String(err);
    console.log(`   ❌ Exception in Stage 2: ${msg}`);

    return {
      stageNumber: 2,
      stageName: "Stage 2: Responsive Design & Mobile Scaling",
      passed: false,
      score: 0,
      durationMs,
      checks: [
        { name: "Execution Exception", passed: false, detail: msg },
      ],
      error: msg,
      notes: [msg],
    };
  }
}
