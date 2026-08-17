export interface OpenAIToolCallFunction {
  readonly name: string;
  readonly arguments: string;
}

export interface OpenAIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: OpenAIToolCallFunction;
  readonly extra_content?: Record<string, unknown>;
}

export interface OpenAIContentPart {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface OpenAIMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null | readonly OpenAIContentPart[];
  readonly name?: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly OpenAIToolCall[];
  readonly [key: string]: unknown;
}

export interface OpenAIRequestPayload {
  readonly model: string;
  readonly messages: readonly OpenAIMessage[];
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly thinking?: { readonly budget_tokens?: number };
  readonly thinkingConfig?: { readonly thinkingBudget?: number };
  readonly reasoning_effort?: string;
  readonly tool_choice?: unknown;
  readonly tools?: readonly unknown[];
  readonly [key: string]: unknown;
}

function isPartEmpty(part: OpenAIContentPart): boolean {
  if (part.type === "text") {
    return !part.text || part.text.trim().length === 0;
  }
  return false;
}

function isArrayContentEmpty(arr: readonly OpenAIContentPart[]): boolean {
  return arr.length === 0 || arr.every(isPartEmpty);
}

export function isContentEmpty(
  content: string | null | readonly OpenAIContentPart[] | undefined
): boolean {
  if (!content) {
    return true;
  }
  if (typeof content === "string") {
    return content.trim().length === 0;
  }
  if (Array.isArray(content)) {
    return isArrayContentEmpty(content);
  }
  return false;
}

function patchContentPart(part: OpenAIContentPart): OpenAIContentPart {
  if (part.type === "text" && (!part.text || part.text.trim().length === 0)) {
    return { ...part, text: "." };
  }
  return part;
}

function applyDotToArray(
  arr: readonly OpenAIContentPart[]
): readonly OpenAIContentPart[] {
  if (arr.length === 0) {
    return [{ type: "text", text: "." }];
  }
  return arr.map(patchContentPart);
}

export function applyDotPromptToContent(
  content: string | null | readonly OpenAIContentPart[]
): string | readonly OpenAIContentPart[] {
  if (!content) {
    return ".";
  }
  if (typeof content === "string") {
    return content.trim().length === 0 ? "." : content;
  }
  if (Array.isArray(content)) {
    return applyDotToArray(content);
  }
  return content;
}

function patchMessageWithDot(msg: OpenAIMessage): OpenAIMessage {
  if (isContentEmpty(msg.content)) {
    return {
      ...msg,
      content: applyDotPromptToContent(msg.content),
    };
  }
  return msg;
}

export function applyDotPrompt(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  return messages.map(patchMessageWithDot);
}

export function cleanGoogle3Nuance(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...payload };
  delete cleaned.thinkingConfig;
  delete cleaned.thinking_config;
  delete cleaned.reasoning_effort;
  return cleaned;
}

function normalizeToolChoiceOpenAI(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") {
    return toolChoice === "any" ? "required" : toolChoice;
  }
  if (typeof toolChoice === "object" && toolChoice !== null) {
    return toolChoice;
  }
  return "auto";
}

function extractFunctionName(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const record = obj as Record<string, unknown>;
  const fnObj = record.function as { name?: string } | undefined;
  return fnObj?.name ?? null;
}

function normalizeToolChoiceAnthropic(toolChoice: unknown): unknown {
  if (toolChoice === "none") {
    return undefined;
  }
  if (toolChoice === "any" || toolChoice === "required") {
    return { type: "any" };
  }
  const fnName = extractFunctionName(toolChoice);
  if (fnName) {
    return { type: "tool", name: fnName };
  }
  return { type: "auto" };
}

function normalizeToolChoiceGoogle(toolChoice: unknown): unknown {
  if (toolChoice === "none") {
    return { mode: "NONE" };
  }
  if (toolChoice === "any" || toolChoice === "required") {
    return { mode: "ANY" };
  }
  const fnName = extractFunctionName(toolChoice);
  if (fnName) {
    return { mode: "ANY", allowedFunctionNames: [fnName] };
  }
  return { mode: "AUTO" };
}

export function normalizeToolChoice(
  toolChoice: unknown,
  targetWire: "oa" | "cl" | "gg" | "rs"
): unknown {
  if (toolChoice === undefined || toolChoice === null) {
    return undefined;
  }
  if (targetWire === "cl") {
    return normalizeToolChoiceAnthropic(toolChoice);
  }
  if (targetWire === "gg") {
    return normalizeToolChoiceGoogle(toolChoice);
  }
  return normalizeToolChoiceOpenAI(toolChoice);
}

export function applyNuanceModifiers(
  payload: OpenAIRequestPayload,
  nuances: readonly string[],
  targetWire: "oa" | "cl" | "gg" | "rs" = "oa"
): OpenAIRequestPayload {
  let modified: Record<string, unknown> = { ...payload };

  if (nuances.includes("dp")) {
    modified.messages = applyDotPrompt(payload.messages);
  }
  if (nuances.includes("g3")) {
    modified = cleanGoogle3Nuance(modified);
  }
  if (nuances.includes("tc") && payload.tool_choice !== undefined) {
    modified.tool_choice = normalizeToolChoice(payload.tool_choice, targetWire);
  }

  return modified as unknown as OpenAIRequestPayload;
}
