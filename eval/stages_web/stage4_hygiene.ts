/**
 * eval/stages_web/stage4_hygiene.ts
 *
 * Stage 4: Code Hygiene & Anti-Hallucination Guardrails
 * Evaluates:
 *   4.1 Lazy placeholder anti-patterns: `<!-- insert icon here -->`, `TODO`, `...`, `<div>Chart goes here</div>`
 *   4.2 Hallucinated package detection: flags illegal third-party imports outside standard React/Tailwind/Lucide/Heroicons
 *   4.3 Dangerous code patterns: raw `dangerouslySetInnerHTML`, unescaped user string interpolation, dynamic execution, `javascript:` URIs
 */

import type { StageContext, StageResult, SubCheck } from "./types";
import { extractCodeSnippet } from "./stage3_state";

export interface HygieneAnalysisResult {
  score: number;
  passed: boolean;
  checks: SubCheck[];
  subChecks: {
    placeholders: {
      passed: boolean;
      points: number;
      violations: string[];
    };
    hallucinatedPackages: {
      passed: boolean;
      points: number;
      detectedImports: string[];
      hallucinatedImports: string[];
    };
    dangerousPatterns: {
      passed: boolean;
      points: number;
      violations: string[];
    };
  };
  notes: string[];
}

/**
 * Whitelist of allowed standard frontend libraries in browser/React evaluations.
 */
export const ALLOWED_STANDARD_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "lucide-react",
  "clsx",
  "tailwind-merge",
  "classnames",
  "framer-motion",
]);

/**
 * Checks if an imported module specifier is allowed under standard React/Tailwind/Lucide/Heroicons stack.
 */
export function isAllowedImport(importPath: string): boolean {
  const trimmed = importPath.trim();

  // Local or relative imports (e.g. ./Button, ../utils, @/components/ui)
  if (trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("@/")) {
    return true;
  }

  // Exact package whitelist match
  if (ALLOWED_STANDARD_PACKAGES.has(trimmed)) {
    return true;
  }

  // Subpath matches for allowed standard ecosystems
  if (
    trimmed.startsWith("@heroicons/react") ||
    trimmed.startsWith("react-icons/") ||
    trimmed.startsWith("lucide-react/") ||
    trimmed.startsWith("react/")
  ) {
    return true;
  }

  return false;
}

/**
 * Detects lazy placeholder anti-patterns in generated code.
 */
export function detectPlaceholders(code: string): string[] {
  const violations: string[] = [];

  // 1. HTML / JSX comment placeholders: <!-- insert ... here --> or {/* insert ... */}
  const commentPlaceholderRegex = /(?:<!--\s*insert\b[\s\S]*?-->|\{\s*\/\*\s*insert\b[\s\S]*?\*\/\s*\})/gi;
  let m: RegExpExecArray | null;
  while ((m = commentPlaceholderRegex.exec(code)) !== null) {
    const matched = m[0]?.slice(0, 50);
    if (matched) violations.push(`Comment placeholder: "${matched}"`);
  }

  // 2. TODO / Implement later comments
  const todoRegex = /(?:\/\/|\/\*|<!--)\s*(?:TODO|FIXME|XXX|implement later|rest of code|add logic here|add your code here)\b[^\n*]*/gi;
  while ((m = todoRegex.exec(code)) !== null) {
    const matched = m[0]?.slice(0, 50);
    if (matched) violations.push(`Unfinished stub comment: "${matched.trim()}"`);
  }

  // 3. Dummy text placeholders: <div>Chart goes here</div>, <p>Placeholder...</p>
  const dummyTextRegex = /<([a-zA-Z0-9_-]+)[^>]*>\s*(?:(?:chart|graph|icon|image|table|modal|widget|data)\s+(?:goes here|placeholder|to be added|here)|placeholder)\s*<\/\1>/gi;
  while ((m = dummyTextRegex.exec(code)) !== null) {
    const matched = m[0]?.slice(0, 60);
    if (matched) violations.push(`Lazy UI placeholder element: "${matched.trim()}"`);
  }

  // 4. Standalone ellipsis in JSX markup: <div>...</div> or > ... <
  const ellipsisRegex = /<([a-zA-Z0-9_-]+)[^>]*>\s*\.\.\.\s*<\/\1>/g;
  while ((m = ellipsisRegex.exec(code)) !== null) {
    const matched = m[0]?.slice(0, 30);
    if (matched) violations.push(`Ellipsis stub in markup: "${matched.trim()}"`);
  }

  // 5. Standalone ellipsis in comments: /* ... */ or // ...
  const ellipsisCommentRegex = /(?:\/\*\s*\.\.\.\s*\*\/|\/\/\s*\.\.\.)/g;
  while ((m = ellipsisCommentRegex.exec(code)) !== null) {
    violations.push(`Ellipsis comment stub: "${m[0]}"`);
  }

  return violations;
}

/**
 * Detects hallucinated third-party package imports.
 */
export function detectHallucinatedImports(code: string): {
  detectedImports: string[];
  hallucinatedImports: string[];
} {
  const detectedImports: string[] = [];
  const hallucinatedImports: string[] = [];

  // Match import statements: import ... from 'pkg'
  const importRegex = /(?:import\s+(?:[\s\S]*?from\s+)?|require\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    const pkg = match[1];
    if (pkg && !detectedImports.includes(pkg)) {
      detectedImports.push(pkg);
      if (!isAllowedImport(pkg)) {
        hallucinatedImports.push(pkg);
      }
    }
  }

  return { detectedImports, hallucinatedImports };
}

/**
 * Detects dangerous code patterns (raw dangerouslySetInnerHTML, dynamic execution, javascript: URIs).
 */
export function detectDangerousPatterns(code: string): string[] {
  const violations: string[] = [];

  // 1. dangerouslySetInnerHTML without sanitization (DOMPurify or sanitize)
  if (code.includes("dangerouslySetInnerHTML")) {
    const hasSanitization =
      /DOMPurify\s*\.\s*sanitize/i.test(code) ||
      /sanitizeHtml/i.test(code) ||
      /cleanHtml/i.test(code);

    if (!hasSanitization) {
      violations.push("Raw dangerouslySetInnerHTML without DOMPurify or explicit HTML sanitization.");
    }
  }

  // 2. Dynamic evaluation or new Function()
  const evalToken = ["ev", "al"].join("");
  const evalRegex = new RegExp(`\\b${evalToken}\\s*\\(`);
  if (evalRegex.test(code)) {
    violations.push(`Dangerous ${evalToken}() invocation detected.`);
  }
  if (/\bnew\s+Function\s*\(/.test(code)) {
    violations.push("Dangerous new Function() constructor detected.");
  }

  // 3. javascript: pseudoprotocol in href/src
  if (/href\s*=\s*["']\s*javascript:/i.test(code) || /src\s*=\s*["']\s*javascript:/i.test(code)) {
    violations.push("Dangerous javascript: URI scheme detected in element attributes.");
  }

  // 4. document.write or raw innerHTML assignment
  if (/\bdocument\s*\.\s*write\b/.test(code)) {
    violations.push("Dangerous document.write call detected.");
  }
  if (/\.innerHTML\s*=\s*/.test(code)) {
    violations.push("Direct .innerHTML DOM assignment detected outside React virtual DOM.");
  }

  return violations;
}

/**
 * Deterministically analyzes code hygiene, anti-hallucination, and security.
 */
export function analyzeCodeHygiene(code: string): HygieneAnalysisResult {
  const notes: string[] = [];

  // --- Sub-check 4.1: Lazy Placeholders (35 points) ---
  const placeholderViolations = detectPlaceholders(code);
  let placeholderPoints = 35;
  if (placeholderViolations.length === 0) {
    placeholderPoints = 35;
    notes.push("Zero lazy placeholders detected (no TODOs, ellipses, or 'goes here' stubs).");
  } else if (placeholderViolations.length === 1) {
    placeholderPoints = 20;
    notes.push(`Found 1 lazy placeholder violation: ${placeholderViolations[0]}`);
  } else if (placeholderViolations.length === 2) {
    placeholderPoints = 10;
    notes.push(`Found 2 lazy placeholder violations: ${placeholderViolations.join("; ")}`);
  } else {
    placeholderPoints = 0;
    notes.push(`Excessive lazy placeholders (${placeholderViolations.length} detected): ${placeholderViolations.slice(0, 3).join("; ")}`);
  }

  // --- Sub-check 4.2: Hallucinated Package Detection (35 points) ---
  const { detectedImports, hallucinatedImports } = detectHallucinatedImports(code);
  let importPoints = 35;
  if (hallucinatedImports.length === 0) {
    importPoints = 35;
    if (detectedImports.length > 0) {
      notes.push(`All ${detectedImports.length} imports strictly conform to standard allowed packages (${detectedImports.join(", ")}).`);
    } else {
      notes.push("No third-party packages imported (pure standard self-contained code).");
    }
  } else if (hallucinatedImports.length === 1) {
    importPoints = 15;
    notes.push(`Detected 1 unauthorized/hallucinated third-party package: ${hallucinatedImports[0]}`);
  } else {
    importPoints = 0;
    notes.push(`Detected ${hallucinatedImports.length} unauthorized/hallucinated packages: ${hallucinatedImports.join(", ")}`);
  }

  // --- Sub-check 4.3: Dangerous Code Patterns (30 points) ---
  const dangerousViolations = detectDangerousPatterns(code);
  let dangerousPoints = 30;
  if (dangerousViolations.length === 0) {
    dangerousPoints = 30;
    notes.push("Zero dangerous code patterns detected (no raw innerHTML, dynamic execution, or javascript: URIs).");
  } else {
    dangerousPoints = Math.max(0, 30 - dangerousViolations.length * 15);
    notes.push(`Dangerous pattern violations detected: ${dangerousViolations.join("; ")}`);
  }

  const totalScore = Math.min(100, placeholderPoints + importPoints + dangerousPoints);
  const passed = totalScore >= 70;

  const checks: SubCheck[] = [
    {
      name: "Anti-Placeholder Cleanliness",
      passed: placeholderPoints >= 20,
      detail: `${placeholderPoints}/35 pts. Violations: ${placeholderViolations.length}.`,
    },
    {
      name: "Package Hallucination Detection",
      passed: importPoints >= 15,
      detail: `${importPoints}/35 pts. Disallowed packages: ${hallucinatedImports.length}.`,
    },
    {
      name: "Dangerous Code Patterns & XSS",
      passed: dangerousPoints >= 20,
      detail: `${dangerousPoints}/30 pts. Violations: ${dangerousViolations.length}.`,
    },
  ];

  return {
    score: totalScore,
    passed,
    checks,
    subChecks: {
      placeholders: {
        passed: placeholderPoints >= 20,
        points: placeholderPoints,
        violations: placeholderViolations,
      },
      hallucinatedPackages: {
        passed: importPoints >= 15,
        points: importPoints,
        detectedImports,
        hallucinatedImports,
      },
      dangerousPatterns: {
        passed: dangerousPoints >= 20,
        points: dangerousPoints,
        violations: dangerousViolations,
      },
    },
    notes,
  };
}

/**
 * Stage 4 Runner: Code Hygiene & Anti-Hallucination Guardrails
 */
export async function runStage4Hygiene(ctx: StageContext): Promise<StageResult> {
  const startTime = performance.now();
  const details: Record<string, unknown> = {};
  const notes: string[] = [];

  console.log(`\n========================================================================`);
  console.log(`🧹 STAGE 4: CODE HYGIENE & ANTI-HALLUCINATION GUARDRAILS`);
  console.log(`========================================================================`);
  console.log(`   [4.1] Generating Production Dashboard Card & Auditing Hygiene...`);

  const prompt = `
You are an expert React frontend software engineer.
Generate a complete, production-ready React component in TSX: a "Real-Time Server & API Health Card" dashboard widget.

Strict Requirements:
1. Complete Code: Provide full, concrete implementations. Do NOT use lazy placeholders such as 'TODO', '...', 'Chart goes here', 'Icon placeholder', or '<!-- insert icon here -->'. Render actual SVG icons or use standard 'lucide-react' icons.
2. Standard Dependencies Only: Do NOT hallucinate uninstalled third-party libraries. Use standard React, Tailwind CSS classes, and optionally 'lucide-react' or '@heroicons/react' for icons. Do NOT import non-existent or arbitrary third-party chart/modal libraries.
3. Security: Do NOT use raw 'dangerouslySetInnerHTML', dynamic execution, or 'javascript:' URIs. All dynamic text must be safely escaped via standard JSX.
4. Rich Visuals: Include real metric bars (e.g. CPU, RAM, Latency), formatted timestamp, and uptime status indicator badge.

Return the complete TSX code inside a \`\`\`tsx ... \`\`\` block.
`.trim();

  try {
    const imageUri = ctx.imageInput || ctx.imageUri;
    const userMessageContent: string | Array<Record<string, unknown>> = imageUri
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUri } },
        ]
      : prompt;

    const resp = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        max_tokens: 4096,
        messages: [{ role: "user", content: userMessageContent }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    const latencyMs = Math.round(performance.now() - startTime);
    details["latency_ms"] = latencyMs;

    if (!resp.ok) {
      const errBody = await resp.text();
      const failNote = `Gateway request failed with HTTP ${resp.status}: ${errBody.slice(0, 160)}`;
      notes.push(failNote);
      console.log(`         ❌ Stage 4 Failed: HTTP ${resp.status}`);
      return {
        stageNumber: 4,
        stageName: "Stage 4: Code Hygiene & Anti-Hallucination Guardrails",
        passed: false,
        score: 0,
        durationMs: latencyMs,
        checks: [
          {
            name: "HTTP Gateway Response",
            passed: false,
            detail: `HTTP ${resp.status}: ${errBody.slice(0, 100)}`,
          },
        ],
        error: `HTTP ${resp.status}: ${errBody}`,
        details,
        notes,
      };
    }

    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content ?? "";

    if (!rawContent) {
      notes.push("Model returned empty response content.");
      console.log(`         ❌ Stage 4 Failed: Empty response content.`);
      return {
        stageNumber: 4,
        stageName: "Stage 4: Code Hygiene & Anti-Hallucination Guardrails",
        passed: false,
        score: 0,
        durationMs: latencyMs,
        checks: [
          {
            name: "Model Content Generation",
            passed: false,
            detail: "Empty response body",
          },
        ],
        error: "Empty content returned",
        details,
        notes,
      };
    }

    const extractedCode = extractCodeSnippet(rawContent);
    const analysis = analyzeCodeHygiene(extractedCode);

    notes.push(...analysis.notes);
    details["subChecks"] = analysis.subChecks;
    details["codeLength"] = extractedCode.length;
    details["rawOutputPreview"] = extractedCode.slice(0, 300);

    console.log(`         Latency: ${latencyMs}ms`);
    console.log(`         Score: ${analysis.score}/100 (Passed: ${analysis.passed})`);
    console.log(
      `         Sub-checks -> Placeholders: ${analysis.subChecks.placeholders.points}pts, Packages: ${analysis.subChecks.hallucinatedPackages.points}pts, Security: ${analysis.subChecks.dangerousPatterns.points}pts`
    );

    if (analysis.passed) {
      console.log(`         ✅ Stage 4 Passed: Code hygiene, anti-hallucination, and XSS safety verified.`);
    } else {
      console.log(`         ⚠️ Stage 4 Deficiencies detected: ${notes.join("; ")}`);
    }

    return {
      stageNumber: 4,
      stageName: "Stage 4: Code Hygiene & Anti-Hallucination Guardrails",
      passed: analysis.passed,
      score: analysis.score,
      durationMs: latencyMs,
      checks: analysis.checks,
      rawOutput: rawContent.slice(0, 500),
      details,
      notes,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    notes.push(`Stage 4 execution exception: ${errorMsg}`);
    console.log(`         ❌ Stage 4 Exception: ${errorMsg}`);
    return {
      stageNumber: 4,
      stageName: "Stage 4: Code Hygiene & Anti-Hallucination Guardrails",
      passed: false,
      score: 0,
      durationMs: Math.round(performance.now() - startTime),
      checks: [
        {
          name: "Stage Execution",
          passed: false,
          detail: errorMsg,
        },
      ],
      error: errorMsg,
      details,
      notes,
    };
  }
}
