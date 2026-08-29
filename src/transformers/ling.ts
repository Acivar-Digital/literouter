import type { OpenAIMessage, OpenAIToolCall } from "./nuances";

export interface LingParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
  readonly reasoningContent?: string;
}

export type DotsParseResult = LingParseResult;

export interface LingStreamState {
  buffer: string;
  toolCallIndex: number;
  hasEmittedToolCalls: boolean;
  hasEmittedFinishReason: boolean;
  isInThinkTag: boolean;
  id?: string;
  model?: string;
  usage?: Record<string, unknown>;
}

export type DotsStreamState = LingStreamState;

/**
 * Universal Leaked Control/Template Token Regex.
 * Captures Ling-3.0, ChatML, DeepSeek, GLM, and standard LLM control markers.
 */
export const LEAKED_TEMPLATE_REGEX =
  /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>|<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>|<\/?(?:tool_call|tool_response|tool_result|arg_key|arg_value|argument_name|argument_value|parameter|parameter_name|parameter_value|invoke|function|think|thought|thinking)[^>]*>|<\|(?:role_end|startoftext|endoftext|im_end|im_start|fim_start|fim_hole|fim_end|start_of_turn|end_of_turn|eot_id|start_header_id|end_header_id)\|>|<｜(?:System|User|Assistant|begin of sentence|end of sentence)｜>|\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>/gi;

/**
 * Bounded streaming lookahead regex.
 * Specifically targets plausible opening/closing tag prefixes at chunk boundaries.
 * Will NOT match mathematical comparisons like "x < y" or "a < 10".
 */
export const STREAM_PARTIAL_TAG_REGEX =
  /<\/?(?:t(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l)?)?)?|r(?:e(?:s(?:p(?:o(?:n(?:s(?:e)?)?)?)?|u(?:l(?:t)?)?)?)?)?)?)?)?)?|h(?:i(?:n(?:k)?)?)?|h(?:o(?:u(?:g(?:h(?:t)?)?)?)?)?)?|r(?:o(?:l(?:e)?)?)?|a(?:r(?:g(?:_(?:k(?:e(?:y)?)?|v(?:a(?:l(?:u(?:e)?)?)?)?))?)?)?|i(?:n(?:v(?:o(?:k(?:e)?)?)?)?)?|p(?:a(?:r(?:a(?:m(?:e(?:t(?:e(?:r)?)?)?)?)?)?)?)?|f(?:u(?:n(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?)?|\|[a-z0-9_]*|｜[a-z0-9_]*)$/i;

const EXCLUDED_TAG_NAMES = new Set([
  "tool_call",
  "tool_calls",
  "invoke",
  "function_call",
  "function_calls",
  "minimax:tool_call",
  "think",
  "thought",
  "thinking",
  "role",
  "tool_response",
  "tool_result",
  "arg_key",
  "arg_value",
  "parameter",
  "function",
  "p",
  "div",
  "span",
  "pre",
  "code",
  "b",
  "i",
  "strong",
  "em",
  "table",
  "tr",
  "td",
  "th",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

export function stripLeakedTemplateTags(text: string): string {
  return text.replace(LEAKED_TEMPLATE_REGEX, "");
}

export function stripLingLeakedTemplateTags(text: string): string {
  return stripLeakedTemplateTags(text);
}

export function stripLingUnclosedTemplateTags(text: string): string {
  return text.replace(STREAM_PARTIAL_TAG_REGEX, "");
}

function generateCallId(): string {
  return `call_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36).substring(4)}`;
}

function parseJsonTolerant(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const sanitized = raw.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
        match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
      );
      return JSON.parse(sanitized);
    } catch {
      return null;
    }
  }
}

export function castValue(raw: string): unknown {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null") return null;
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const parsed = parseFloat(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    const parsed = parseJsonTolerant(trimmed);
    if (parsed !== null) return parsed;
  }
  return trimmed;
}

export const coerceLingValue = castValue;

export function parseParameters(body: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // 1. Qwen Parameter Format: <parameter=path>value</parameter>
  const qwenParamRegex =
    /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter|<\/(?:function|tool_call)>|$))/gi;
  let qpMatch = qwenParamRegex.exec(body);
  while (qpMatch !== null) {
    const key = (qpMatch[1] ?? "").trim();
    const val = (qpMatch[2] ?? "").trim();
    if (key.length > 0 && !(key in params)) params[key] = castValue(val);
    qpMatch = qwenParamRegex.exec(body);
  }

  // 2. Ling-3.0 / GLM Key-Value: <arg_key>k</arg_key><arg_value>v</arg_value>
  const kvRegex =
    /<(?:arg_key|argument_name|parameter_name)>([\s\S]*?)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;
  let kvMatch = kvRegex.exec(body);
  while (kvMatch !== null) {
    const key = (kvMatch[1] ?? "").trim();
    const val = (kvMatch[2] ?? "").trim();
    if (key.length > 0 && !(key in params)) params[key] = castValue(val);
    kvMatch = kvRegex.exec(body);
  }

  // 3. Named parameter tags: <parameter name="k">v</parameter>
  const paramRegex =
    /<parameter\s+name=["']?([^"'\s>]+)["']?>([\s\S]*?)(?:<\/parameter>|(?=<parameter|<\/(?:invoke|tool_call)>|$))/gi;
  let pMatch = paramRegex.exec(body);
  while (pMatch !== null) {
    const key = (pMatch[1] ?? "").trim();
    const val = (pMatch[2] ?? "").trim();
    if (key.length > 0 && !(key in params)) params[key] = castValue(val);
    pMatch = paramRegex.exec(body);
  }

  // 4. Custom child tags: <path>src/index.js</path>
  if (Object.keys(params).length === 0) {
    const childTagRegex = /<([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/\1>/g;
    let childMatch = childTagRegex.exec(body);
    while (childMatch !== null) {
      const tag = (childMatch[1] ?? "").trim();
      const val = (childMatch[2] ?? "").trim();
      if (
        !EXCLUDED_TAG_NAMES.has(tag.toLowerCase()) &&
        tag.length > 0 &&
        !(tag in params)
      ) {
        params[tag] = castValue(val);
      }
      childMatch = childTagRegex.exec(body);
    }
  }

  return params;
}

export function parseLingXml(content: string): LingParseResult {
  const sanitized = content;
  const toolCalls: OpenAIToolCall[] = [];
  let remainingText = sanitized;

  // 1. Ling-3.0 / GLM: <tool_call>name<arg_key>...</arg_value></tool_call>
  const glmPattern =
    /(?:<tool_call>)?\s*([a-zA-Z0-9_\-]+)\s*(<arg_key>[\s\S]*?<\/arg_value>(?:\s*<arg_key>[\s\S]*?<\/arg_value>)*)\s*(?:<\/tool_call>)?/gi;
  let gMatch = glmPattern.exec(remainingText);
  while (gMatch !== null) {
    const fnName = (gMatch[1] ?? "").trim().toLowerCase();
    const argsObj = parseParameters(gMatch[2] ?? "");
    if (Object.keys(argsObj).length > 0) {
      toolCalls.push({
        id: generateCallId(),
        type: "function",
        function: { name: fnName, arguments: JSON.stringify(argsObj) },
      });
      remainingText = remainingText.replace(gMatch[0], "");
    }
    gMatch = glmPattern.exec(remainingText);
  }

  // 2. Qwen Format: <function=name>...</function>
  const qwenFuncRegex = /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;
  let qMatch = qwenFuncRegex.exec(remainingText);
  while (qMatch !== null) {
    const fnName = (qMatch[1] ?? "").trim();
    const argsObj = parseParameters(qMatch[2] ?? "");
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: { name: fnName, arguments: JSON.stringify(argsObj) },
    });
    remainingText = remainingText.replace(qMatch[0], "");
    qMatch = qwenFuncRegex.exec(remainingText);
  }

  // 3. DeepSeek / MiniMax: <invoke name="...">...</invoke>
  const invokeRegex =
    /<invoke\s+name=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/invoke>/gi;
  let iMatch = invokeRegex.exec(remainingText);
  while (iMatch !== null) {
    const fnName = (iMatch[1] ?? "").trim();
    const argsObj = parseParameters(iMatch[2] ?? "");
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: { name: fnName, arguments: JSON.stringify(argsObj) },
    });
    remainingText = remainingText.replace(iMatch[0], "");
    iMatch = invokeRegex.exec(remainingText);
  }

  // 4. JSON-in-XML: <tool_call>{"name": ..., "arguments": ...}</tool_call>
  const jsonXmlRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  let jMatch = jsonXmlRegex.exec(remainingText);
  while (jMatch !== null) {
    const parsed = parseJsonTolerant(jMatch[1] ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      const name = String(payload.name || payload.function || "tool");
      const args = payload.arguments ?? payload.parameters ?? {};
      toolCalls.push({
        id: generateCallId(),
        type: "function",
        function: {
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
      });
      remainingText = remainingText.replace(jMatch[0], "");
    }
    jMatch = jsonXmlRegex.exec(remainingText);
  }

  // Extract Thinking Content
  let reasoningContent: string | undefined = undefined;
  const thinkMatch =
    /<(?:think|thought|thinking)>([\s\S]*?)(?:<\/(?:think|thought|thinking)>|(?=<(?:tool_call|invoke|function=))|$)/i.exec(
      remainingText
    );
  if (thinkMatch) {
    const rawThink = (thinkMatch[1] ?? "").trim();
    if (rawThink.length > 0) {
      reasoningContent = stripLeakedTemplateTags(rawThink);
    }
    remainingText = remainingText.replace(thinkMatch[0], "");
  }

  const cleanText = stripLeakedTemplateTags(remainingText).trim();

  return { cleanText, toolCalls, reasoningContent };
}

export const parseDotsXml = parseLingXml;

/**
 * Serializes conversation history using Ling-3.0's native <tool_response> tags
 * and enforces strict turn alternation.
 */
export function serializeLingToolHistory(
  messages: readonly OpenAIMessage[]
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  const pendingToolResponses: string[] = [];

  const flushToolResponses = () => {
    if (pendingToolResponses.length > 0) {
      result.push({
        role: "user",
        content: pendingToolResponses.join("\n\n"),
      });
      pendingToolResponses.length = 0;
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const isLastTurn = i >= messages.length - 2;

    if (msg.role === "tool") {
      const toolId = msg.tool_call_id || "call_unknown";
      const text =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content ?? "");
      // Ling-3.0 Native Token 156898 & 156899
      pendingToolResponses.push(
        `<tool_response id="${toolId}">\n${text}\n</tool_response>`
      );
      continue;
    }

    flushToolResponses();

    const cleanMsg = { ...msg };
    // Prune reasoning from older turns to prevent context bloat while preserving active turn Jinja integrity
    if (!isLastTurn && cleanMsg.reasoning_content) {
      delete (cleanMsg as Record<string, unknown>).reasoning_content;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      let callXml = "";
      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        const args = parseParameters(tc.function.arguments);
        callXml += `\n<tool_call>${fnName}`;
        for (const [k, v] of Object.entries(args)) {
          const valStr =
            typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
          callXml += `<arg_key>${k}</arg_key><arg_value>${valStr}</arg_value>`;
        }
        callXml += `</tool_call>`;
      }
      const baseText = typeof msg.content === "string" ? msg.content : "";
      cleanMsg.content = (baseText + callXml).trim() || " ";
      result.push(cleanMsg);
    } else {
      result.push(cleanMsg);
    }
  }

  flushToolResponses();
  return result;
}

export const serializeDotsToolHistory = serializeLingToolHistory;

export function injectLingToolsSchemaSystemPrompt(
  messages: readonly OpenAIMessage[],
  tools?: readonly unknown[]
): readonly OpenAIMessage[] {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return messages;

  const toolSchemas = tools
    .map((t: unknown) => {
      if (typeof t === "object" && t !== null) {
        const item = t as Record<string, unknown>;
        return JSON.stringify(
          item.type === "function" && item.function ? item.function : item
        );
      }
      return "";
    })
    .filter((s) => s.length > 0);

  if (toolSchemas.length === 0) return messages;

  const toolSystemPrompt =
    `\n\n# Tools\nYou have access to the following tools:\n<tools>\n` +
    toolSchemas.join("\n") +
    `\n</tools>\nTo invoke a tool, output:\n<tool_call>tool_name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>`;

  const result = [...messages];
  const sysIndex = result.findIndex((m) => m.role === "system");
  if (sysIndex >= 0) {
    const existing = result[sysIndex]!;
    const existingText =
      typeof existing.content === "string" ? existing.content : "";
    if (!existingText.includes("<tools>")) {
      result[sysIndex] = {
        ...existing,
        content: existingText + toolSystemPrompt,
      };
    }
  } else {
    result.unshift({ role: "system", content: toolSystemPrompt.trim() });
  }
  return result;
}

export const injectToolsSchemaSystemPrompt = injectLingToolsSchemaSystemPrompt;

export function createLingStreamState(): LingStreamState {
  return {
    buffer: "",
    toolCallIndex: 0,
    hasEmittedToolCalls: false,
    hasEmittedFinishReason: false,
    isInThinkTag: false,
  };
}

export const createDotsStreamState = createLingStreamState;

export function formatOpenAIToolCallDelta(
  toolCall: OpenAIToolCall,
  index: number,
  id?: string,
  model?: string
): string {
  return `data: ${JSON.stringify({
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index,
              id: toolCall.id,
              type: "function",
              function: toolCall.function,
            },
          ],
        },
      },
    ],
  })}\n\n`;
}

export function formatOpenAIReasoningDelta(
  reasoning: string,
  id?: string,
  model?: string
): string {
  return `data: ${JSON.stringify({
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [{ index: 0, delta: { reasoning_content: reasoning } }],
  })}\n\n`;
}

export function formatOpenAITextDelta(
  text: string,
  id?: string,
  model?: string
): string {
  return `data: ${JSON.stringify({
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [{ index: 0, delta: { content: text } }],
  })}\n\n`;
}

export function formatOpenAIFinishDelta(
  finishReason: string,
  id?: string,
  model?: string,
  usage?: Record<string, unknown>
): string {
  const payload: Record<string, unknown> = {
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function processLingStreamChunk(
  chunk: string,
  state: LingStreamState
): string {
  state.buffer += chunk;
  let output = "";

  // 1. Thinking state management with immediate tool breakout
  if (state.isInThinkTag) {
    const thinkEndMatch = /<\/(?:think|thought|thinking)>/i.exec(state.buffer);
    const toolBreakoutMatch = /<(?:tool_call|invoke|function=)/i.exec(state.buffer);

    if (thinkEndMatch) {
      const thoughtText = state.buffer.slice(0, thinkEndMatch.index);
      state.buffer = state.buffer.slice(
        thinkEndMatch.index + thinkEndMatch[0].length
      );
      state.isInThinkTag = false;
      const cleanThought = stripLeakedTemplateTags(thoughtText);
      if (cleanThought)
        output += formatOpenAIReasoningDelta(cleanThought, state.id, state.model);
    } else if (toolBreakoutMatch) {
      // Direct breakout into tool calling without closing </think>
      const thoughtText = state.buffer.slice(0, toolBreakoutMatch.index);
      state.buffer = state.buffer.slice(toolBreakoutMatch.index);
      state.isInThinkTag = false;
      const cleanThought = stripLeakedTemplateTags(thoughtText);
      if (cleanThought)
        output += formatOpenAIReasoningDelta(cleanThought, state.id, state.model);
    } else {
      const holdMatch = STREAM_PARTIAL_TAG_REGEX.exec(state.buffer);
      if (holdMatch) {
        const streamable = state.buffer.slice(0, holdMatch.index);
        state.buffer = state.buffer.slice(holdMatch.index);
        const cleanThought = stripLeakedTemplateTags(streamable);
        if (cleanThought)
          output += formatOpenAIReasoningDelta(cleanThought, state.id, state.model);
      } else {
        const cleanThought = stripLeakedTemplateTags(state.buffer);
        state.buffer = "";
        if (cleanThought)
          output += formatOpenAIReasoningDelta(cleanThought, state.id, state.model);
      }
      return output;
    }
  }

  // 2. Detect entry into <think>
  if (!state.isInThinkTag) {
    const thinkStartMatch = /<(?:think|thought|thinking)>/i.exec(state.buffer);
    if (thinkStartMatch) {
      const beforeText = state.buffer.slice(0, thinkStartMatch.index);
      state.buffer = state.buffer.slice(
        thinkStartMatch.index + thinkStartMatch[0].length
      );
      state.isInThinkTag = true;
      const cleanBefore = stripLeakedTemplateTags(beforeText);
      if (cleanBefore)
        output += formatOpenAITextDelta(cleanBefore, state.id, state.model);
      return output + processLingStreamChunk("", state);
    }
  }

  // 3. Process Completed Tool Containers
  const hasToolClosingTag =
    /<\/(?:tool_call|invoke|function)>\s*$/i.test(state.buffer) ||
    (state.buffer.includes("</arg_value>") &&
      !state.buffer.includes("<arg_key>") &&
      /<\/(?:arg_value)>\s*$/i.test(state.buffer));

  if (hasToolClosingTag) {
    const { cleanText, toolCalls, reasoningContent } = parseLingXml(state.buffer);
    state.buffer = "";

    if (reasoningContent)
      output += formatOpenAIReasoningDelta(reasoningContent, state.id, state.model);
    if (cleanText)
      output += formatOpenAITextDelta(cleanText, state.id, state.model);
    for (const tc of toolCalls) {
      output += formatOpenAIToolCallDelta(
        tc,
        state.toolCallIndex,
        state.id,
        state.model
      );
      state.toolCallIndex += 1;
      state.hasEmittedToolCalls = true;
    }
    return output;
  }

  // 4. Safe streaming forward (Hold back only true partial tag prefixes)
  const partialMatch = STREAM_PARTIAL_TAG_REGEX.exec(state.buffer);
  if (partialMatch) {
    const emitText = state.buffer.slice(0, partialMatch.index);
    state.buffer = state.buffer.slice(partialMatch.index);
    const cleanText = stripLeakedTemplateTags(emitText);
    if (cleanText)
      output += formatOpenAITextDelta(cleanText, state.id, state.model);
  } else if (!state.buffer.includes("<")) {
    const cleanText = stripLeakedTemplateTags(state.buffer);
    state.buffer = "";
    if (cleanText)
      output += formatOpenAITextDelta(cleanText, state.id, state.model);
  }

  return output;
}

export const processDotsStreamChunk = processLingStreamChunk;

export function createLingStreamTransformer(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const state = createLingStreamState();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";

  function flushPending(): string {
    let out = "";
    if (state.buffer.length > 0) {
      const { cleanText, toolCalls, reasoningContent } = parseLingXml(
        state.buffer
      );
      state.buffer = "";
      if (reasoningContent)
        out += formatOpenAIReasoningDelta(
          reasoningContent,
          state.id,
          state.model
        );
      if (cleanText)
        out += formatOpenAITextDelta(cleanText, state.id, state.model);
      for (const tc of toolCalls) {
        out += formatOpenAIToolCallDelta(
          tc,
          state.toolCallIndex,
          state.id,
          state.model
        );
        state.toolCallIndex += 1;
        state.hasEmittedToolCalls = true;
      }
    }
    return out;
  }

  function getFinishSse(): string {
    if (!state.hasEmittedFinishReason) {
      state.hasEmittedFinishReason = true;
      const finishReason = state.hasEmittedToolCalls ? "tool_calls" : "stop";
      return formatOpenAIFinishDelta(
        finishReason,
        state.id,
        state.model,
        state.usage
      );
    }
    return "";
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }

        if (trimmed === "data: [DONE]") {
          const pending = flushPending();
          if (pending) controller.enqueue(encoder.encode(pending));
          const finishSse = getFinishSse();
          if (finishSse) controller.enqueue(encoder.encode(finishSse));
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.id) state.id = data.id;
            if (data.model) state.model = data.model;
            if (data.usage) state.usage = data.usage;

            const choice = data.choices?.[0];
            const content = choice?.delta?.content;
            const incomingFinishReason = choice?.finish_reason;

            if (typeof content === "string") {
              const processed = processLingStreamChunk(content, state);
              if (processed) controller.enqueue(encoder.encode(processed));
            }

            if (incomingFinishReason) {
              const pending = flushPending();
              if (pending) controller.enqueue(encoder.encode(pending));
              const finishSse = getFinishSse();
              if (finishSse) controller.enqueue(encoder.encode(finishSse));
              // Swallowed raw upstream finish line to prevent double finish_reason collision
              continue;
            }
          } catch {
            controller.enqueue(encoder.encode(line + "\n"));
          }
        } else {
          controller.enqueue(encoder.encode(line + "\n"));
        }
      }
    },
    flush(controller) {
      const pending = flushPending();
      if (pending) controller.enqueue(encoder.encode(pending));
      const finishSse = getFinishSse();
      if (finishSse) controller.enqueue(encoder.encode(finishSse));
      if (lineBuffer.length > 0) controller.enqueue(encoder.encode(lineBuffer));
    },
  });
}

export const createDotsStreamTransformer = createLingStreamTransformer;
