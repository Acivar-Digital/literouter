/**
 * eval/stages_web/stage5_a11y.ts
 *
 * Stage 5: Semantic Accessibility & ARIA Compliance
 * Tests:
 * 1. Semantic Clickable Elements:
 *    - Flags anti-pattern `<div onClick>` or `<span onClick>` lacking `role="button"` or `tabIndex`.
 *    - Validates use of native `<button>` or accessible elements.
 * 2. Image Accessibility:
 *    - Flags `<img>` tags missing `alt` attributes (even empty `alt=""` is required for decorative images).
 * 3. Form Control Labels:
 *    - Validates `<input>`, `<select>`, `<textarea>` have associated `<label htmlFor="...">`, `aria-label`, or `aria-labelledby`.
 * 4. Dialog / Modal Accessibility:
 *    - If modal structures exist, verifies presence of `role="dialog"` or `role="alertdialog"`, `aria-modal="true"`, and accessible names.
 * 5. Scoring 0 - 100 based on zero critical accessibility violations.
 */

import {
  type StageContext,
  type StageResult,
  buildStageHeaders,
  extractCompletionText,
  isResponsesEndpoint,
} from "./types";
import { FIXTURES } from "./fixtures";
import { verifyTsxCompiles } from "./ast_verify";

export interface A11yViolation {
  rule: string;
  severity: "critical" | "warning";
  snippet: string;
  message: string;
}

export interface A11yAuditReport {
  score: number;
  passed: boolean;
  violations: A11yViolation[];
  metrics: {
    interactiveDivsCount: number;
    nativeButtonsCount: number;
    totalImages: number;
    imagesWithAlt: number;
    totalInputs: number;
    labeledInputs: number;
    modalPresent: boolean;
    modalAriaCompliant: boolean;
  };
}

/**
 * Parses and audits raw HTML/JSX code for key WCAG 2.1 AA semantic and ARIA compliance rules.
 */
export function auditA11y(code: string): A11yAuditReport {
  const violations: A11yViolation[] = [];

  // 1. Interactive Divs / Spans (<div onClick=...> or <span onClick=...>)
  const clickDivRegex = /<(div|span)[^>]*?\bonClick\b[^>]*>/gi;
  let clickDivMatch: RegExpExecArray | null;
  let interactiveDivsCount = 0;

  while ((clickDivMatch = clickDivRegex.exec(code)) !== null) {
    const fullTag = clickDivMatch[0];
    const hasRoleButton = /role\s*=\s*["'](?:button|link|menuitem|tab)["']/i.test(fullTag);
    const hasTabIndex = /tabIndex\s*=\s*["'{]?-?\d+["'}]?/i.test(fullTag);

    if (!hasRoleButton || !hasTabIndex) {
      interactiveDivsCount++;
      violations.push({
        rule: "no-interactive-element-to-div",
        severity: "critical",
        snippet: fullTag.slice(0, 80),
        message: "Unsemantic non-interactive element (<div/span onClick>) used without role='button' and tabIndex. Use native <button> instead.",
      });
    }
  }

  const nativeButtonsCount = (code.match(/<button\b[^>]*>/gi) || []).length;

  // 2. Image alt text
  const imgRegex = /<img\b([^>]*)\/?>/gi;
  let imgMatch: RegExpExecArray | null;
  let totalImages = 0;
  let imagesWithAlt = 0;

  while ((imgMatch = imgRegex.exec(code)) !== null) {
    totalImages++;
    const attrs = imgMatch[1] ?? "";
    const hasAlt = /\balt\s*=\s*["'{]/i.test(attrs) || /\baria-label\s*=\s*["'{]/i.test(attrs);
    if (hasAlt) {
      imagesWithAlt++;
    } else {
      violations.push({
        rule: "image-alt-missing",
        severity: "critical",
        snippet: imgMatch[0].slice(0, 80),
        message: "<img> element is missing an alt attribute. Provide descriptive alt text or alt='' for decorative images.",
      });
    }
  }

  // 3. Form controls associated labels or aria-label
  // Look for input tags excluding type="hidden" or type="submit" or type="button"
  const inputRegex = /<(input|textarea|select)\b([^>]*)\/?>/gi;
  let inputMatch: RegExpExecArray | null;
  let totalInputs = 0;
  let labeledInputs = 0;

  while ((inputMatch = inputRegex.exec(code)) !== null) {
    const tag = (inputMatch[1] ?? "input").toLowerCase();
    const attrs = inputMatch[2] ?? "";

    // Ignore type="hidden" or type="submit" or type="button"
    if (/type\s*=\s*["'](?:hidden|submit|button|reset)["']/i.test(attrs)) {
      continue;
    }

    totalInputs++;
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    const inputId = idMatch ? idMatch[1] : null;

    const hasAriaLabel = /\baria-label\s*=\s*["'{]/i.test(attrs);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'{]/i.test(attrs);
    const hasExplicitLabel = inputId ? new RegExp(`<label[^>]*?\\bhtmlFor\\s*=\\s*["']${inputId}["']`, "i").test(code) : false;
    const hasPlaceholderOnly = /\bplaceholder\s*=\s*["'{]/i.test(attrs);

    if (hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel) {
      labeledInputs++;
    } else {
      violations.push({
        rule: "form-control-missing-label",
        severity: hasPlaceholderOnly ? "warning" : "critical",
        snippet: inputMatch[0].slice(0, 80),
        message: `<${tag}> control lacks an associated <label htmlFor="...">, aria-label, or aria-labelledby.`,
      });
    }
  }

  // 4. Modal / Dialog ARIA attributes
  const modalPresent = /(?:modal|dialog|backdrop|overlay)/i.test(code);
  let modalAriaCompliant = false;

  if (modalPresent) {
    const hasDialogRole = /role\s*=\s*["'](?:dialog|alertdialog)["']/i.test(code);
    const hasAriaModal = /aria-modal\s*=\s*["']?true["']?/i.test(code);
    const hasDialogTag = /<dialog\b/i.test(code);

    if (hasDialogRole || hasAriaModal || hasDialogTag) {
      modalAriaCompliant = true;
    } else {
      violations.push({
        rule: "modal-dialog-missing-aria",
        severity: "critical",
        snippet: "Modal markup detected without role='dialog' or aria-modal='true'",
        message: "Overlay or modal container must include role='dialog' (or <dialog>) and aria-modal='true'.",
      });
    }
  } else {
    modalAriaCompliant = true; // Not applicable
  }

  // Scoring logic:
  // Base 100.
  // Each critical violation penalizes 25 points.
  // Each warning violation penalizes 10 points.
  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  let score = 100 - (criticalCount * 25 + warningCount * 10);
  if (score < 0) score = 0;

  const passed = criticalCount === 0 && score >= 75;

  return {
    score,
    passed,
    violations,
    metrics: {
      interactiveDivsCount,
      nativeButtonsCount,
      totalImages,
      imagesWithAlt,
      totalInputs,
      labeledInputs,
      modalPresent,
      modalAriaCompliant,
    },
  };
}

/**
 * Stage 5 Runner:
 * Sends the Auth Modal with error state mockup fixture to the model,
 * requests semantic and fully accessible React/Tailwind code,
 * and audits the response against WCAG semantic markup and ARIA rules.
 */
export async function runStage5A11y(ctx: StageContext): Promise<StageResult> {
  const startTime = Date.now();
  const notes: string[] = [];

  const result: StageResult = {
    stageNumber: 5,
    stageName: "Stage 5: Semantic Accessibility & ARIA Compliance",
    passed: false,
    score: 0,
    durationMs: 0,
    checks: [],
    details: {},
    notes,
  };

  console.log(`\n========================================================================`);
  console.log(`♿ STAGE 5: ACCESSIBILITY & ARIA COMPLIANCE`);
  console.log(`========================================================================`);
  console.log(`   Model: ${ctx.model}`);
  console.log(`   Target: Modal & Form Accessibility with Semantic Controls...`);

  const mockup = FIXTURES.authModalError;
  const imageUri = ctx.imageInput || ctx.imageUri || mockup?.dataUri || "";

  const prompt = [
    {
      role: "system",
      content:
        "You are an expert frontend engineer producing WCAG 2.1 AA accessible React and Tailwind CSS components. " +
        "Always use semantic HTML (<button>, <label htmlFor=...>, <input>), accessible ARIA attributes (role='dialog', aria-modal='true', aria-live='assertive' for errors), " +
        "and never use <div onClick> for interactive elements. Return only the React component code.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Implement the following authentication modal dialog with error state. Ensure strict ARIA compliance, semantic buttons, labeled inputs, and dialog roles:",
        },
        {
          type: "image_url",
          image_url: {
            url: imageUri,
          },
        },
      ],
    },
  ];

  try {
    const isResponses = isResponsesEndpoint(ctx.gatewayUrl, ctx.directiveKey);
    const bodyPayload = isResponses
      ? {
          model: ctx.model,
          stream: false,
          max_output_tokens: ctx.maxTokens ?? 8192,
          ...(ctx.extraPayload ?? {}),
          input: [
            {
              role: "system",
              content:
                "You are an expert frontend engineer producing WCAG 2.1 AA accessible React and Tailwind CSS components. " +
                "Always use semantic HTML (<button>, <label htmlFor=...>, <input>), accessible ARIA attributes (role='dialog', aria-modal='true', aria-live='assertive' for errors), " +
                "and never use <div onClick> for interactive elements. Return only the React component code.",
            },
            {
              role: "user",
              content:
                "Implement the following authentication modal dialog with error state. Ensure strict ARIA compliance, semantic buttons, labeled inputs, and dialog roles.",
            },
          ],
        }
      : {
          model: ctx.model,
          messages: prompt,
          stream: false,
          max_tokens: ctx.maxTokens ?? 8192,
          ...(ctx.reasoningEffort ? { reasoning: { effort: ctx.reasoningEffort } } : {}),
          temperature: 0.1,
          ...(ctx.extraPayload ?? {}),
        };

    let resp = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: buildStageHeaders(ctx),
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 180000),
    });

    let modalityFallbackTriggered = false;

    if (!resp.ok && !isResponses) {
      const errText = await resp.text();
      const lower = errText.toLowerCase();
      const isImageRejection =
        resp.status === 400 &&
        (lower.includes("image") ||
          lower.includes("vision") ||
          lower.includes("modality") ||
          lower.includes("unsupported") ||
          lower.includes("not support") ||
          lower.includes("invalid message content") ||
          lower.includes("multimodal"));

      if (isImageRejection) {
        console.log(`   ⚠️ Vision input unsupported in Stage 5 (HTTP 400). Retrying with text-only prompt fallback...`);
        modalityFallbackTriggered = true;
        const textPrompt = [
          prompt[0],
          {
            role: "user",
            content:
              "Implement an authentication modal dialog with error state. Ensure strict ARIA compliance, semantic buttons, labeled inputs, and dialog roles.",
          },
        ];
        const textPayload = {
          model: ctx.model,
          messages: textPrompt,
          stream: false,
          max_tokens: ctx.maxTokens ?? 8192,
          ...(ctx.reasoningEffort ? { reasoning: { effort: ctx.reasoningEffort } } : {}),
          temperature: 0.1,
          ...(ctx.extraPayload ?? {}),
        };
        resp = await fetch(ctx.gatewayUrl, {
          method: "POST",
          headers: buildStageHeaders(ctx),
          body: JSON.stringify(textPayload),
          signal: AbortSignal.timeout(ctx.timeoutMs ?? 180000),
        });
      } else {
        notes.push(`Gateway returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        result.error = errText;
        result.details = { status: resp.status, error: errText };
        result.checks.push({
          name: "Gateway Response",
          passed: false,
          detail: `HTTP ${resp.status}`,
        });
        return result;
      }
    }

    result.durationMs = Date.now() - startTime;

    if (!resp.ok) {
      const errText = await resp.text();
      notes.push(`Gateway returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      result.error = errText;
      result.details = { status: resp.status, error: errText };
      result.checks.push({
        name: "Gateway Response",
        passed: false,
        detail: `HTTP ${resp.status}`,
      });
      return result;
    }

    const json = (await resp.json()) as Record<string, unknown>;

    if (json.error) {
      let errMsg = String(json.error);
      if (json.error && typeof json.error === "object") {
        if ("message" in json.error && typeof json.error.message === "string") {
          errMsg = json.error.message;
        } else {
          errMsg = JSON.stringify(json.error);
        }
      }
      notes.push(`Upstream error: ${errMsg}`);
      result.checks.push({
        name: "Upstream Response",
        passed: false,
        detail: errMsg,
      });
      result.error = errMsg;
      return result;
    }

    const generatedCode = extractCompletionText(json);
    result.rawOutput = generatedCode;

    if (!generatedCode) {
      notes.push("Model returned empty completion content.");
      result.checks.push({
        name: "Code Generation",
        passed: false,
        detail: "Empty completion content",
      });
      return result;
    }

    const ast = verifyTsxCompiles(generatedCode);
    const audit = auditA11y(generatedCode);

    if (!ast.valid) {
      result.score = Math.min(audit.score, 30);
      result.passed = false;
      notes.push(`TSX compilation failed: ${ast.error}`);
    } else {
      result.score = audit.score;
      result.passed = audit.passed;
    }

    result.details = {
      codeSnippet: generatedCode.slice(0, 250),
      metrics: audit.metrics,
      violations: audit.violations,
      astValid: ast.valid,
      ...(ast.error ? { astError: ast.error } : {}),
      ...(modalityFallbackTriggered ? { modality: "Text-to-UI (Vision Unsupported)" } : {}),
    };

    result.checks.push({
      name: "Semantic Clickable Elements (<button> vs <div onClick>)",
      passed: audit.metrics.interactiveDivsCount === 0,
      detail: `${audit.metrics.nativeButtonsCount} native buttons, ${audit.metrics.interactiveDivsCount} invalid clickable divs`,
    });

    result.checks.push({
      name: "Image Alt Text Coverage",
      passed: audit.metrics.totalImages === 0 || audit.metrics.imagesWithAlt === audit.metrics.totalImages,
      detail: `${audit.metrics.imagesWithAlt}/${audit.metrics.totalImages} images have alt attributes`,
    });

    result.checks.push({
      name: "Form Controls Labeled (htmlFor / aria-label)",
      passed: audit.metrics.totalInputs === 0 || audit.metrics.labeledInputs === audit.metrics.totalInputs,
      detail: `${audit.metrics.labeledInputs}/${audit.metrics.totalInputs} inputs properly labeled`,
    });

    result.checks.push({
      name: "Modal Dialog ARIA Compliance (role='dialog' & aria-modal)",
      passed: audit.metrics.modalAriaCompliant,
      detail: audit.metrics.modalPresent ? (audit.metrics.modalAriaCompliant ? "Accessible dialog" : "Missing dialog attributes") : "N/A",
    });

    if (audit.passed) {
      notes.push(`WCAG semantic compliance passed with score ${audit.score}/100.`);
    } else {
      notes.push(
        `Accessibility violations found (${audit.violations.length}): ${audit.violations.map((v) => `[${v.severity}] ${v.rule}`).join(", ")}`
      );
    }

    return result;
  } catch (err: unknown) {
    result.durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    notes.push(`Execution failure: ${message}`);
    result.error = message;
    result.details = { error: message };
    result.checks.push({
      name: "Execution",
      passed: false,
      detail: message,
    });
    return result;
  }
}
