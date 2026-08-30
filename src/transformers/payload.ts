import type {
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIRequestPayload,
} from "./nuances";
import { applyNuanceModifiers } from "./nuances";
import { serializeDotsToolHistory, injectToolsSchemaSystemPrompt } from "./dots";
import { transformLingRequest } from "./ling";
import {
  injectThoughtSignatures,
  shouldStripReasoning,
  stripReasoningParameters,
} from "./thinking";
import {
  normalizeToolContent,
  stripClientMetadata,
  stripToolMetadata,
  scrubReasoningFromMessage,
  scrubReasoningFromMessages,
} from "./opencode_adapter";
import {
  DEFAULT_SAFE_CONTEXT_TOKENS,
  DEFAULT_MAX_CONTEXT_TOKENS,
  estimateTextTokens,
  estimateAnthropicTokens,
  estimateOpenAITokens,
  isContextLengthError,
  extractContextLimit,
  pruneAnthropicPayload,
  pruneOpenAIPayload,
} from "./context_pruner";

export {
  normalizeToolContent,
  stripClientMetadata,
  stripToolMetadata,
  scrubReasoningFromMessage,
  scrubReasoningFromMessages,
  DEFAULT_SAFE_CONTEXT_TOKENS,
  DEFAULT_MAX_CONTEXT_TOKENS,
  estimateTextTokens,
  estimateAnthropicTokens,
  estimateOpenAITokens,
  isContextLengthError,
  extractContextLimit,
  pruneAnthropicPayload,
  pruneOpenAIPayload,
};

export interface ModelCapabilities {
  readonly supportsThinking?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsSystemMessage?: boolean;
  readonly maxContextTokens?: number;
}

export interface PayloadTransformOptions {
  readonly nuances?: readonly string[];
  readonly targetWire?: "oa" | "cl" | "gg" | "rs" | "ao";
  readonly globalStripReasoning?: boolean;
  readonly aoStripReasoning?: boolean;
  readonly capabilities?: ModelCapabilities;
  readonly enableScrubbing?: boolean;
}

const LATEX_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\\times\b/g, "×"],
  [/\\rightarrow\b/g, "→"],
  [/\\leftarrow\b/g, "←"],
  [/\\leq\b/g, "≤"],
  [/\\geq\b/g, "≥"],
  [/\\neq\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\pm\b/g, "±"],
  [/\\infty\b/g, "∞"],
  [/\\cdot\b/g, "·"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\theta\b/g, "θ"],
  [/\\pi\b/g, "π"],
  [/\\mu\b/g, "μ"],
  [/\\sigma\b/g, "σ"],
  [/\\Delta\b/g, "Δ"],
  [/\\Omega\b/g, "Ω"],
];

export function normalizeLatex(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of LATEX_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function normalizePartLatex(part: OpenAIContentPart): OpenAIContentPart {
  if (part.type === "text" && typeof part.text === "string") {
    return { ...part, text: normalizeLatex(part.text) };
  }
  return part;
}

function normalizeMessageLatex(msg: OpenAIMessage): OpenAIMessage {
  if (typeof msg.content === "string") {
    return { ...msg, content: normalizeLatex(msg.content) };
  }
  if (Array.isArray(msg.content)) {
    return { ...msg, content: msg.content.map(normalizePartLatex) };
  }
  return msg;
}

export function applyLatexNormalization(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  return messages.map(normalizeMessageLatex);
}

function extractSystemText(msg: OpenAIMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function prependSystemContext(
  systemText: string,
  userMsg: OpenAIMessage
): OpenAIMessage {
  const prefix = `[System Context: ${systemText}]\n\n`;
  if (typeof userMsg.content === "string") {
    return { ...userMsg, content: `${prefix}${userMsg.content}` };
  }
  if (Array.isArray(userMsg.content)) {
    const textPart: OpenAIContentPart = { type: "text", text: prefix };
    return { ...userMsg, content: [textPart, ...userMsg.content] };
  }
  return { ...userMsg, content: prefix };
}

function mergeSystemIntoUserMessages(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  const systemMessages = messages.filter((m) => m.role === "system");
  if (systemMessages.length === 0) {
    return messages;
  }

  const combinedSystemText = systemMessages.map(extractSystemText).join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const firstUserIdx = nonSystem.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) {
    const newFirstUser: OpenAIMessage = {
      role: "user",
      content: `[System Context: ${combinedSystemText}]`,
    };
    return [newFirstUser, ...nonSystem];
  }

  return nonSystem.map((msg, idx) => {
    if (idx === firstUserIdx) {
      return prependSystemContext(combinedSystemText, msg);
    }
    return msg;
  });
}

function toContentParts(c: string | null | readonly OpenAIContentPart[]): readonly OpenAIContentPart[] {
  if (Array.isArray(c)) {
    return c;
  }
  const s = typeof c === "string" ? c : "";
  return [{ type: "text", text: s }];
}

function mergeTwoContents(
  c1: string | null | readonly OpenAIContentPart[],
  c2: string | null | readonly OpenAIContentPart[]
): string | readonly OpenAIContentPart[] {
  if (typeof c1 === "string" && typeof c2 === "string") {
    return `${c1}\n\n${c2}`.trim();
  }
  const parts1 = toContentParts(c1);
  const parts2 = toContentParts(c2);
  return [...parts1, ...parts2];
}

function mergeTwoMessages(m1: OpenAIMessage, m2: OpenAIMessage): OpenAIMessage {
  const mergedContent = mergeTwoContents(m1.content, m2.content);
  const toolCalls = [...(m1.tool_calls ?? []), ...(m2.tool_calls ?? [])];
  return {
    ...m1,
    content: mergedContent,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function stepMergeConsecutive(
  acc: OpenAIMessage[],
  current: OpenAIMessage,
  next: OpenAIMessage
): OpenAIMessage {
  if (current.role === next.role) {
    return mergeTwoMessages(current, next);
  }
  acc.push(current);
  return next;
}

export function mergeConsecutiveMessages(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  if (messages.length <= 1) {
    return messages;
  }

  const result: OpenAIMessage[] = [];
  let current: OpenAIMessage = messages[0] as OpenAIMessage;

  for (let i = 1; i < messages.length; i += 1) {
    const next = messages[i] as OpenAIMessage;
    current = stepMergeConsecutive(result, current, next);
  }

  result.push(current);
  return result;
}

export function applyGemmaConstraints(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  const withoutSystem = mergeSystemIntoUserMessages(messages);
  return mergeConsecutiveMessages(withoutSystem);
}

function scrubGemmaParameters(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...payload };
  delete cleaned.presence_penalty;
  delete cleaned.frequency_penalty;
  delete cleaned.logit_bias;
  delete cleaned.thinkingConfig;
  return cleaned;
}

export function scrubUnsupportedParameters(
  payload: OpenAIRequestPayload,
  capabilities?: ModelCapabilities,
  enableScrubbing = false
): OpenAIRequestPayload {
  const cleaned: Record<string, unknown> = { ...payload };
  delete cleaned.prompt_cache_key;
  delete cleaned.prompt_cache_retrieval;
  delete cleaned.prompt_cache_reset;

  if (typeof cleaned.max_tokens === "number" && cleaned.max_tokens > 65536) {
    cleaned.max_tokens = 65536;
  }

  if (!enableScrubbing) {
    return cleaned as unknown as OpenAIRequestPayload;
  }

  if (capabilities && !capabilities.supportsThinking) {
    delete cleaned.thinking;
    delete cleaned.thinkingConfig;
    delete cleaned.thinking_config;
    delete cleaned.reasoning_effort;
  }
  if (capabilities && !capabilities.supportsTools) {
    delete cleaned.tools;
    delete cleaned.tool_choice;
  }
  return cleaned as unknown as OpenAIRequestPayload;
}

function transformMessages(
  messages: readonly OpenAIMessage[],
  nuances: readonly string[],
  model?: string,
  tools?: readonly unknown[]
): readonly OpenAIMessage[] {
  let res = scrubReasoningFromMessages(messages);
  res = applyLatexNormalization(res);
  if (nuances.includes("gm")) {
    res = applyGemmaConstraints(res);
  }
  if (nuances.includes("ts")) {
    res = injectThoughtSignatures(res);
  }
  if (
    nuances.includes("tc") ||
    (model && model.toLowerCase().includes("dots"))
  ) {
    res = injectToolsSchemaSystemPrompt(res, tools);
    res = serializeDotsToolHistory(res);
    res = mergeConsecutiveMessages(res);
  }
  return res;
}

function applyReasoningStripIfNeeded(
  payload: Record<string, unknown>,
  globalStrip: boolean,
  nuances: readonly string[],
  targetWire?: string,
  aoStripReasoning?: boolean
): Record<string, unknown> {
  if (shouldStripReasoning(globalStrip, nuances, targetWire, aoStripReasoning)) {
    return stripReasoningParameters(payload);
  }
  return payload;
}

export function sanitizeAndTransformPayload(
  payload: OpenAIRequestPayload,
  options: PayloadTransformOptions = {}
): OpenAIRequestPayload {
  const nuances = options.nuances ?? [];
  const targetWire = options.targetWire ?? "oa";
  const globalStrip = options.globalStripReasoning ?? false;
  const aoStripReasoning = options.aoStripReasoning;
  const enableScrubbing = options.enableScrubbing ?? false;

  let currentPayload = payload;
  const isLing =
    nuances.includes("lg") ||
    (Boolean(payload.model && payload.model.toLowerCase().includes("ling")) && !nuances.includes("tc") && !nuances.includes("no"));

  if (isLing) {
    currentPayload = transformLingRequest(currentPayload);
  }

  const transformedMessages = transformMessages(
    currentPayload.messages,
    nuances,
    currentPayload.model,
    currentPayload.tools as readonly unknown[] | undefined
  );
  let transformed: Record<string, unknown> = { ...currentPayload, messages: transformedMessages };

  if (enableScrubbing && nuances.includes("gm")) {
    transformed = scrubGemmaParameters(transformed);
  }

  const withModifiers = applyNuanceModifiers(
    transformed as unknown as OpenAIRequestPayload,
    nuances,
    targetWire
  );
  const finalPayload = (enableScrubbing || targetWire === "ao")
    ? applyReasoningStripIfNeeded(
        withModifiers as unknown as Record<string, unknown>,
        globalStrip,
        nuances,
        targetWire,
        aoStripReasoning
      )
    : withModifiers;

  return scrubUnsupportedParameters(
    finalPayload as unknown as OpenAIRequestPayload,
    options.capabilities,
    enableScrubbing
  );
}

export function cleanOpenAIBody(
  body: OpenAIRequestPayload,
  options?: PayloadTransformOptions
): OpenAIRequestPayload {
  return sanitizeAndTransformPayload(body, options);
}
