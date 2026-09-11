/**
 * eval/stages_web/stage3_state.ts
 *
 * Stage 3: Interactive State & Event Architecture
 * Evaluates React & JS state management:
 *   3.1 Uses `useState`, `useReducer`, or reactive state variables
 *   3.2 Controlled inputs with `value` + `onChange`
 *   3.3 Real form submission handlers (`onSubmit`, `handleSubmit`) rather than no-op `() => {}`
 *   3.4 State toggle for interactive elements (error messages, modal visibility, loading spinner)
 */

import {
  type StageContext,
  type StageResult,
  type SubCheck,
  buildStageHeaders,
  extractCompletionText,
  isResponsesEndpoint,
} from "./types";

export interface StateAnalysisResult {
  score: number;
  passed: boolean;
  checks: SubCheck[];
  subChecks: {
    stateHooks: {
      passed: boolean;
      count: number;
      points: number;
      declaredHooks: string[];
    };
    controlledInputs: {
      passed: boolean;
      points: number;
      inputCount: number;
      controlledCount: number;
    };
    submissionHandler: {
      passed: boolean;
      hasPreventDefault: boolean;
      hasStateUpdate: boolean;
      isNoop: boolean;
      points: number;
    };
    interactiveToggles: {
      passed: boolean;
      togglesFound: string[];
      points: number;
    };
  };
  notes: string[];
}

/**
 * Extracts raw code from potential markdown code fences.
 */
export function extractCodeSnippet(text: string): string {
  const codeBlockRegex = /```(?:tsx|jsx|typescript|javascript|html)?\s*([\s\S]*?)```/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const snippet = match[1]?.trim();
    if (snippet && snippet.length > 0) {
      matches.push(snippet);
    }
  }

  if (matches.length > 0) {
    // Pick the block that looks most like a React component
    const reactBlock = matches.find(
      (m) =>
        m.includes("useState") ||
        m.includes("React") ||
        m.includes("return") ||
        m.includes("export default") ||
        m.includes("<")
    );
    return reactBlock ?? matches[0] ?? text.trim();
  }

  return text.trim();
}

/**
 * Deterministically analyzes React component code for interactive state architecture.
 */
export function analyzeStateManagement(code: string): StateAnalysisResult {
  const notes: string[] = [];

  // --- Sub-check 3.1: Reactive State Hooks (useState, useReducer) ---
  const hookRegex = /(?:const|let)\s+\[\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*\]\s*=\s*(?:React\.)?(?:useState|useReducer)(?:<[^>]+>)?\s*\(/g;
  const singleHookRegex = /(?:React\.)?(?:useState|useReducer)(?:<[^>]+>)?\s*\(/g;

  const declaredHooks: string[] = [];
  let hookMatch: RegExpExecArray | null;
  while ((hookMatch = hookRegex.exec(code)) !== null) {
    const varName = hookMatch[1];
    const setterName = hookMatch[2];
    if (varName && setterName) {
      declaredHooks.push(`${varName}, ${setterName}`);
    }
  }

  const rawHookMatches = code.match(singleHookRegex) ?? [];
  const hookCount = Math.max(declaredHooks.length, rawHookMatches.length);

  let statePoints = 0;
  if (hookCount >= 2) {
    statePoints = 25;
    notes.push(`Found ${hookCount} state hook declarations (full reactive state architecture).`);
  } else if (hookCount === 1) {
    statePoints = 15;
    notes.push(`Found 1 state hook declaration (minimal state coverage).`);
  } else {
    statePoints = 0;
    notes.push(`Missing reactive state hooks (no useState or useReducer detected).`);
  }

  // --- Sub-check 3.2: Controlled Inputs (value + onChange) ---
  const inputTagRegex = /<(?:input|textarea|select)\b([^>]*)\/?>/gi;
  let inputCount = 0;
  let controlledCount = 0;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = inputTagRegex.exec(code)) !== null) {
    inputCount++;
    const attrs = tagMatch[1] ?? "";
    const hasValue = /\bvalue\s*=\s*(?:\{[^}]+\}|"[^"]*")/i.test(attrs);
    const hasOnChange = /\bonChange\s*=\s*\{[^}]+\}/i.test(attrs);

    if (hasValue && hasOnChange) {
      controlledCount++;
    }
  }

  let inputPoints = 0;
  if (inputCount > 0 && controlledCount > 0 && controlledCount === inputCount) {
    inputPoints = 25;
    notes.push(`All ${inputCount} input/textarea elements are fully controlled (value + onChange).`);
  } else if (inputCount > 0 && controlledCount > 0) {
    inputPoints = 18;
    notes.push(`${controlledCount}/${inputCount} input elements are controlled.`);
  } else if (code.includes("onChange") && (code.includes("value=") || code.includes("value:"))) {
    inputPoints = 15;
    notes.push(`Detected onChange and value bindings in markup.`);
  } else if (inputCount > 0) {
    inputPoints = 5;
    notes.push(`Input elements found but lack controlled value + onChange binding.`);
  } else {
    inputPoints = 0;
    notes.push(`No interactive form input elements detected.`);
  }

  // --- Sub-check 3.3: Real Form Submission Handler ---
  const hasSubmitBinding =
    /\bonSubmit\s*=\s*\{([^}]+)\}/i.test(code) ||
    /<button[^>]*type\s*=\s*["']submit["'][^>]*onClick\s*=\s*\{([^}]+)\}/i.test(code);

  const hasPreventDefault = /preventDefault\s*\(\s*\)/.test(code);

  const noopRegex = /(?:onSubmit|handleSubmit|onSubmitForm|handleRegistration|handleFeedback)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{\s*\}/;
  const isNoop = noopRegex.test(code);

  const hasStateUpdateInHandler =
    /(?:set[A-Z][a-zA-Z0-9_$]*|dispatch)\s*\([^)]*\)/.test(code) &&
    (code.includes("handleSubmit") || code.includes("onSubmit") || code.includes("preventDefault"));

  let submitPoints = 0;
  if (isNoop) {
    submitPoints = 0;
    notes.push(`Form submission handler is a no-op empty function () => {}.`);
  } else if (hasSubmitBinding && hasPreventDefault && hasStateUpdateInHandler) {
    submitPoints = 25;
    notes.push(`Real form submission handler implemented with preventDefault() and state dispatch.`);
  } else if (hasSubmitBinding && (hasPreventDefault || hasStateUpdateInHandler)) {
    submitPoints = 18;
    notes.push(`Form submission handler attached with partial validation or event prevention.`);
  } else if (hasSubmitBinding) {
    submitPoints = 10;
    notes.push(`Form submission binding exists but missing preventDefault or state progression.`);
  } else {
    submitPoints = 0;
    notes.push(`Missing form submission handler (onSubmit/handleSubmit).`);
  }

  // --- Sub-check 3.4: Interactive Element Toggles ---
  const togglesFound: string[] = [];

  if (
    /\{(?:isOpen|showModal|isVisible|open|visible)\s*&&/.test(code) ||
    /\{(?:isOpen|showModal|isVisible|open|visible)\s*\?/.test(code)
  ) {
    togglesFound.push("modal_visibility_toggle");
  }

  if (
    /\{(?:loading|isLoading|isSubmitting|submitting)\s*\?/.test(code) ||
    /disabled\s*=\s*\{(?:loading|isLoading|isSubmitting|submitting)\}/.test(code) ||
    /\{(?:loading|isLoading|isSubmitting)\s*&&/.test(code)
  ) {
    togglesFound.push("loading_state_toggle");
  }

  if (
    /\{(?:error|errorMessage|errors|errorText|isError)\s*&&/.test(code) ||
    /\{(?:error|errorMessage|errors|errorText|isError)\s*\?/.test(code) ||
    /\{(?:success|isSuccess)\s*&&/.test(code)
  ) {
    togglesFound.push("feedback_message_toggle");
  }

  if (/set[A-Z][a-zA-Z0-9_$]*\s*\(\s*(?:false|true|![a-zA-Z0-9_$]+)\s*\)/.test(code)) {
    togglesFound.push("state_setter_toggle_action");
  }

  let togglePoints = 0;
  if (togglesFound.length >= 3) {
    togglePoints = 25;
    notes.push(`Rich interactive toggles verified: ${togglesFound.join(", ")}.`);
  } else if (togglesFound.length >= 1) {
    togglePoints = 15;
    notes.push(`Basic interactive toggles detected: ${togglesFound.join(", ")}.`);
  } else {
    togglePoints = 0;
    notes.push(`No interactive element toggles or conditional state branches found.`);
  }

  const totalScore = Math.min(100, statePoints + inputPoints + submitPoints + togglePoints);
  const passed = totalScore >= 70;

  const checks: SubCheck[] = [
    {
      name: "Reactive State Hooks",
      passed: statePoints >= 15,
      detail: `${statePoints}/25 pts. Found ${hookCount} hook(s).`,
    },
    {
      name: "Controlled Inputs",
      passed: inputPoints >= 15,
      detail: `${inputPoints}/25 pts. ${controlledCount}/${inputCount} controlled input(s).`,
    },
    {
      name: "Form Submission Handler",
      passed: submitPoints >= 15,
      detail: `${submitPoints}/25 pts. PreventDefault: ${hasPreventDefault}, StateUpdate: ${hasStateUpdateInHandler}, Noop: ${isNoop}.`,
    },
    {
      name: "Interactive Element Toggles",
      passed: togglePoints >= 15,
      detail: `${togglePoints}/25 pts. Toggles: ${togglesFound.join(", ") || "none"}.`,
    },
  ];

  return {
    score: totalScore,
    passed,
    checks,
    subChecks: {
      stateHooks: {
        passed: statePoints >= 15,
        count: hookCount,
        points: statePoints,
        declaredHooks,
      },
      controlledInputs: {
        passed: inputPoints >= 15,
        points: inputPoints,
        inputCount,
        controlledCount,
      },
      submissionHandler: {
        passed: submitPoints >= 15,
        hasPreventDefault,
        hasStateUpdate: hasStateUpdateInHandler,
        isNoop,
        points: submitPoints,
      },
      interactiveToggles: {
        passed: togglePoints >= 15,
        togglesFound,
        points: togglePoints,
      },
    },
    notes,
  };
}

/**
 * Stage 3 Runner: Interactive State & Event Architecture
 */
export async function runStage3State(ctx: StageContext): Promise<StageResult> {
  const startTime = performance.now();
  const details: Record<string, unknown> = {};
  const notes: string[] = [];

  console.log(`\n========================================================================`);
  console.log(`🎛️  STAGE 3: INTERACTIVE STATE & EVENT ARCHITECTURE`);
  console.log(`========================================================================`);
  console.log(`   [3.1] Generating Interactive React Component & Auditing State Bindings...`);

  const prompt = `
You are an expert React and TypeScript frontend architect.
Generate a complete, self-contained, and interactive React component in TSX: a "Feedback & Bug Report Modal".

Requirements:
1. State Management: Use React hooks (useState or useReducer) to manage:
   - Form field inputs (name, email, feedback category, description)
   - Modal visibility state (isOpen)
   - Form status (idle, loading/submitting, error message, success message)
2. Controlled Inputs: Every <input>, <textarea>, or <select> must be strictly controlled with 'value' and 'onChange'.
3. Real Form Submission: Implement a genuine 'handleSubmit' or 'onSubmit' that:
   - Prevents default event behavior (e.preventDefault())
   - Validates that email and description are not empty
   - Toggles loading state during submission
   - Updates error state if invalid or sets success state upon completion
   - NEVER use an empty no-op handler like '() => {}'.
4. Interactive Toggles:
   - Modal visibility toggle: clicking Close or the backdrop updates state to close the modal.
   - Conditional rendering for loading spinner/disabled button while submitting.
   - Conditional error banner displaying the error message when validation fails.

Return the complete, working TSX code inside a \`\`\`tsx ... \`\`\` block.
`.trim();

  try {
    const imageUri = ctx.imageInput || ctx.imageUri;
    const userMessageContent: string | Array<Record<string, unknown>> = imageUri
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUri } },
        ]
      : prompt;

    const isResponses = isResponsesEndpoint(ctx.gatewayUrl, ctx.directiveKey);
    const bodyPayload = isResponses
      ? {
          model: ctx.model,
          stream: false,
          max_output_tokens: ctx.maxTokens ?? 8192,
          input: [{ role: "user", content: prompt }],
        }
      : {
          model: ctx.model,
          stream: false,
          max_tokens: ctx.maxTokens ?? 8192,
          ...(ctx.reasoningEffort ? { reasoning: { effort: ctx.reasoningEffort } } : {}),
          messages: [{ role: "user", content: userMessageContent }],
        };

    const resp = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: buildStageHeaders(ctx),
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 180000),
    });

    const latencyMs = Math.round(performance.now() - startTime);
    details["latency_ms"] = latencyMs;

    if (!resp.ok) {
      const errBody = await resp.text();
      const failNote = `Gateway request failed with HTTP ${resp.status}: ${errBody.slice(0, 160)}`;
      notes.push(failNote);
      console.log(`         ❌ Stage 3 Failed: HTTP ${resp.status}`);
      return {
        stageNumber: 3,
        stageName: "Stage 3: Interactive State & Event Architecture",
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

    const data = (await resp.json()) as any;

    if (data.error) {
      const errMsg = typeof data.error === "object" ? data.error.message || JSON.stringify(data.error) : data.error;
      notes.push(`Upstream error: ${errMsg}`);
      console.log(`         ❌ Stage 3 Failed: ${errMsg}`);
      return {
        stageNumber: 3,
        stageName: "Stage 3: Interactive State & Event Architecture",
        passed: false,
        score: 0,
        durationMs: latencyMs,
        checks: [{ name: "Upstream Response", passed: false, detail: errMsg }],
        error: errMsg,
        details,
        notes,
      };
    }

    const rawContent = extractCompletionText(data);

    if (!rawContent) {
      notes.push("Model returned empty response content.");
      console.log(`         ❌ Stage 3 Failed: Empty response content.`);
      return {
        stageNumber: 3,
        stageName: "Stage 3: Interactive State & Event Architecture",
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
    const analysis = analyzeStateManagement(extractedCode);

    notes.push(...analysis.notes);
    details["subChecks"] = analysis.subChecks;
    details["codeLength"] = extractedCode.length;
    details["rawOutputPreview"] = extractedCode.slice(0, 300);

    console.log(`         Latency: ${latencyMs}ms`);
    console.log(`         Score: ${analysis.score}/100 (Passed: ${analysis.passed})`);
    console.log(
      `         Sub-checks -> StateHooks: ${analysis.subChecks.stateHooks.points}pts, Inputs: ${analysis.subChecks.controlledInputs.points}pts, Submit: ${analysis.subChecks.submissionHandler.points}pts, Toggles: ${analysis.subChecks.interactiveToggles.points}pts`
    );

    if (analysis.passed) {
      console.log(`         ✅ Stage 3 Passed: Comprehensive reactive state & event architecture verified.`);
    } else {
      console.log(`         ⚠️ Stage 3 Deficiencies detected: ${notes.join("; ")}`);
    }

    return {
      stageNumber: 3,
      stageName: "Stage 3: Interactive State & Event Architecture",
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
    notes.push(`Stage 3 execution exception: ${errorMsg}`);
    console.log(`         ❌ Stage 3 Exception: ${errorMsg}`);
    return {
      stageNumber: 3,
      stageName: "Stage 3: Interactive State & Event Architecture",
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
