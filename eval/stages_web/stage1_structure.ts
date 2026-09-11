/**
 * eval/stages_web/stage1_structure.ts
 *
 * Stage 1: Visual-to-DOM Structural Fidelity
 * Evaluates:
 *   1.1 Layout hierarchy & semantic landmarks (<header>, <nav>, <main>, <aside>, <footer>)
 *   1.2 Modern layout systems (CSS Grid & Flexbox primitives)
 *   1.3 Spatial card layout (3-column dashboard card grid without absolute overlap hacks)
 */

import type { StageContext, StageResult, SubCheck } from "./types";
import { DEFAULT_DASHBOARD_MOCKUP } from "./types";

export interface StructureEvaluation {
  score: number;
  passed: boolean;
  checks: SubCheck[];
  details: Record<string, unknown>;
  notes: string[];
}

/**
 * Extracts HTML/JSX code block from markdown or returns trimmed string.
 */
export function extractCodeBlock(raw: string): string {
  // First try complete fenced code blocks: ```...```
  const codeBlockRegex = /```(?:html|tsx|jsx|javascript|typescript)?\s*([\s\S]*?)```/i;
  const match = codeBlockRegex.exec(raw);
  if (match && match[1]) {
    return match[1].trim();
  }

  // If the model truncated mid-generation (e.g. finish_reason: "length"), extract everything after the opening fence
  const unclosedFenceRegex = /```(?:html|tsx|jsx|javascript|typescript)?\s*([\s\S]*)$/i;
  const unclosedMatch = unclosedFenceRegex.exec(raw);
  if (unclosedMatch && unclosedMatch[1] && unclosedMatch[1].trim().length > 0) {
    return unclosedMatch[1].trim();
  }

  return raw.trim();
}

/**
 * Evaluates semantic landmarks and hierarchy in DOM.
 * Max score: 30 points.
 */
export function checkLayoutHierarchy(code: string): SubCheck & { score: number } {
  const landmarks = [
    { name: "header", regex: /<header\b|role=["']banner["']|\bclass=["'][^"']*\bheader\b/i },
    { name: "nav", regex: /<nav\b|role=["']navigation["']|\bclass=["'][^"']*\b(nav|navbar)\b/i },
    { name: "main", regex: /<main\b|role=["']main["']|\bclass=["'][^"']*\bmain\b/i },
    { name: "aside/sidebar", regex: /<aside\b|role=["']complementary["']|\bclass=["'][^"']*\b(aside|sidebar)\b/i },
    { name: "footer", regex: /<footer\b|role=["']contentinfo["']|\bclass=["'][^"']*\bfooter\b/i },
  ];

  const matched = landmarks.filter((lm) => lm.regex.test(code));
  const score = matched.length * 6; // up to 30 points
  const passed = matched.length >= 3;

  return {
    name: "Layout Hierarchy & Landmarks",
    passed,
    score,
    detail: `Found ${matched.length}/5 structural landmarks: ${matched.map((m) => m.name).join(", ")}`,
  };
}

/**
 * Evaluates CSS Grid and Flexbox layout usage.
 * Max score: 35 points.
 */
export function checkModernLayout(code: string): SubCheck & { score: number } {
  let score = 0;
  const features: string[] = [];

  const hasGrid = /\bgrid\b|display:\s*grid/i.test(code);
  const hasGridCols = /\bgrid-cols-[\w[\]]+|grid-template-columns/i.test(code);
  const hasFlex = /\bflex\b|display:\s*flex/i.test(code);
  const hasFlexDir = /\bflex-(col|row)\b|flex-direction/i.test(code);
  const hasAlignment = /\bitems-(center|start|end|stretch)\b|\bjustify-(between|center|around|start|end)\b|align-items|justify-content/i.test(code);

  if (hasGrid) {
    score += 7;
    features.push("CSS Grid");
  }
  if (hasGridCols) {
    score += 7;
    features.push("Grid Columns");
  }
  if (hasFlex) {
    score += 7;
    features.push("Flexbox");
  }
  if (hasFlexDir) {
    score += 7;
    features.push("Flex Direction");
  }
  if (hasAlignment) {
    score += 7;
    features.push("Alignment/Justify");
  }

  return {
    name: "Modern Layout Systems (Grid & Flexbox)",
    passed: score >= 21,
    score,
    detail: `Score: ${score}/35. Modern layout features detected: ${features.length > 0 ? features.join(", ") : "none"}`,
  };
}

/**
 * Detects presence of 3-column card grid and absence of absolute positioning hacks.
 * Max score: 35 points.
 */
export function checkSpatialCardLayout(code: string): SubCheck & { score: number } {
  let score = 0;
  const notes: string[] = [];

  // Check 3-column grid declaration
  const hasThreeColGrid = /\b(?:[a-z0-9]+:)?grid-cols-3\b|repeat\(\s*3\s*,/i.test(code);
  if (hasThreeColGrid) {
    score += 15;
    notes.push("3-column card grid found");
  } else {
    notes.push("Missing 3-column grid specification (grid-cols-3)");
  }

  // Check card elements
  const cardMatches = code.match(/class=["'][^"']*\b(?:card|rounded|shadow|bg-slate|bg-gray|p-4|p-6)\b[^"']*["']/gi) || [];
  const hasMultipleCards = cardMatches.length >= 3;
  if (hasMultipleCards) {
    score += 10;
    notes.push(`${cardMatches.length} card-like elements detected`);
  }

  // Check for absolute overlap hacks (e.g. positioning cards with absolute top/left coordinates)
  const hasAbsoluteOverlapHack = /position:\s*absolute;[^"']*(?:top|left):\s*\d+px/i.test(code) ||
    /absolute\s+top-\[\d+px\]\s+left-\[\d+px\]/i.test(code);

  if (!hasAbsoluteOverlapHack) {
    score += 10;
    notes.push("Clean flow without broken absolute overlap hacks");
  } else {
    notes.push("Warning: absolute positioning overlap hack detected on layout cards");
  }

  return {
    name: "Spatial Card Layout & Anti-Overlap",
    passed: score >= 25,
    score,
    detail: `Score: ${score}/35. ${notes.join("; ")}`,
  };
}

/**
 * Evaluates web structure and layout fidelity synchronously.
 */
export function evaluateStructure(code: string): StructureEvaluation {
  const hierarchy = checkLayoutHierarchy(code);
  const modernLayout = checkModernLayout(code);
  const spatialCards = checkSpatialCardLayout(code);

  const totalScore = hierarchy.score + modernLayout.score + spatialCards.score;
  const passed = totalScore >= 70;

  const checks: SubCheck[] = [
    { name: hierarchy.name, passed: hierarchy.passed, detail: hierarchy.detail },
    { name: modernLayout.name, passed: modernLayout.passed, detail: modernLayout.detail },
    { name: spatialCards.name, passed: spatialCards.passed, detail: spatialCards.detail },
  ];

  const notes: string[] = [
    hierarchy.detail || "",
    modernLayout.detail || "",
    spatialCards.detail || "",
  ];

  return {
    score: totalScore,
    passed,
    checks,
    details: {
      hierarchyScore: hierarchy.score,
      modernLayoutScore: modernLayout.score,
      spatialCardsScore: spatialCards.score,
    },
    notes,
  };
}

/**
 * Helper to construct messages payload for model invocation.
 */
function buildMessages(imageUri: string) {
  const promptText = `
You are a senior frontend engineer. Implement a complete, concise, self-contained single-page component for the provided dashboard mockup using semantic HTML and Tailwind CSS.
Strict Rules:
1. Wrap the entire layout in semantic landmarks: <header>, <nav>, <main>, <aside>, and <footer>.
2. Use modern layout primitives: CSS Grid (grid, grid-cols-3) and Flexbox (flex, flex-col, items-center, justify-between).
3. Ensure you create a 3-column metric card grid (grid-cols-3) without absolute positioning hacks.
4. Keep the code compact and focused on the key layout so that it completes within 1000 tokens without getting cut off.
Output only the clean HTML/Tailwind code block inside \`\`\`html and \`\`\`.
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
 * Executes Stage 1: DOM Structure & Layout Fidelity against gateway.
 */
export async function runStage1Structure(ctx: StageContext): Promise<StageResult> {
  const startTime = Date.now();
  const imageUri = ctx.imageInput || ctx.imageUri || DEFAULT_DASHBOARD_MOCKUP;

  console.log(`\n========================================================================`);
  console.log(`🏛️  STAGE 1: DOM STRUCTURE & LAYOUT FIDELITY`);
  console.log(`========================================================================`);
  console.log(`   [1.1] Querying model for dashboard structure...`);

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
        stageNumber: 1,
        stageName: "Stage 1: DOM Structure & Layout Fidelity",
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

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>;
      error?: { message?: string; code?: number } | string;
    };

    if (data.error) {
      const errMsg = typeof data.error === "object" ? data.error.message || JSON.stringify(data.error) : data.error;
      console.log(`   ❌ Upstream provider error: ${errMsg}`);
      return {
        stageNumber: 1,
        stageName: "Stage 1: DOM Structure & Layout Fidelity",
        passed: false,
        score: 0,
        durationMs: Date.now() - startTime,
        checks: [{ name: "Upstream Availability", passed: false, detail: errMsg }],
        error: errMsg,
        notes: [errMsg],
      };
    }

    const rawContent = data.choices?.[0]?.message?.content || "";
    const cleanCode = extractCodeBlock(rawContent);

    const evalResult = evaluateStructure(cleanCode);
    const durationMs = Date.now() - startTime;

    console.log(`   Score: ${evalResult.score}/100 - Passed: ${evalResult.passed}`);
    for (const chk of evalResult.checks) {
      const symbol = chk.passed ? "✅" : "❌";
      console.log(`     ${symbol} ${chk.name}: ${chk.detail}`);
    }

    return {
      stageNumber: 1,
      stageName: "Stage 1: DOM Structure & Layout Fidelity",
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
    console.log(`   ❌ Exception in Stage 1: ${msg}`);

    return {
      stageNumber: 1,
      stageName: "Stage 1: DOM Structure & Layout Fidelity",
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
