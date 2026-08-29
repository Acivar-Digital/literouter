import type { OpenAIMessage, OpenAIToolCall } from "./nuances";

export interface DotsParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
}

export const LEAKED_TEMPLATE_REGEX =
  /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)<\/role>|<\/?(?:role|im_start|im_end|endoftext|start_of_turn|end_of_turn)(?:\s+[^>]*)?>|<\|(?:im_start|im_end|endoftext|start_of_turn|end_of_turn)\b[^|]*\|>|\[\/?INST\]|<<\/?SYS>>|(?:\b(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\b\s*)?<\/(?:role|im_end|end_of_turn)>|<(?:role|im_start|start_of_turn)>\s*(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\b/gi;

export function stripLeakedTemplateTags(text: string): string {
  return text.replace(LEAKED_TEMPLATE_REGEX, "");
}

export class TagSanitizerStreamBuffer {
  private buffer = "";

  public process(incoming: string): string {
    this.buffer += incoming;

    const openRoleMatch = /<role>(?:(?!<\/role>)[\s\S]){0,30}$/i.exec(this.buffer);
    if (openRoleMatch && !this.buffer.slice(openRoleMatch.index).toLowerCase().includes("</role>")) {
      const safePrefix = this.buffer.slice(0, openRoleMatch.index);
      this.buffer = this.buffer.slice(openRoleMatch.index);
      return stripLeakedTemplateTags(safePrefix);
    }

    const cleaned = stripLeakedTemplateTags(this.buffer);
    const partialTagMatch = /(?:<[^>]*|\[[^\]]*|<<[^>]*|<\|[^|]*)$/.exec(cleaned);
    if (partialTagMatch && partialTagMatch.index !== undefined) {
      const emitText = cleaned.slice(0, partialTagMatch.index);
      this.buffer = cleaned.slice(partialTagMatch.index);
      return emitText;
    }

    this.buffer = "";
    return cleaned;
  }

  public flush(): string {
    const finalCleaned = stripLeakedTemplateTags(this.buffer);
    this.buffer = "";
    return finalCleaned;
  }
}

const INVOKE_BLOCK_REGEX =
  /<(?:invoke|minimax:tool_call|tool_call|function_call)(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/(?:invoke|minimax:tool_call|tool_call|function_call)>/gi;

const QWEN_FUNC_REGEX =
  /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;

const QWEN_PARAM_REGEX =
  /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter|<\/(?:function|tool_call)>|$))/gi;

const PARAM_REGEX =
  /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)(?:<\/(?:parameter|arg_value|parameter_value)>|(?=<parameter|<arg_key|<\/(?:invoke|tool_call|function_call|function_calls|tool_calls|minimax:tool_call)>|$))/gi;

const ARG_KV_REGEX =
  /<(?:arg_key|argument_name|parameter_name)>([^<]+)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;

const EXCLUDED_TAG_NAMES = new Set([
  "tool_call",
  "tool_calls",
  "invoke",
  "function_call",
  "function_calls",
  "minimax:tool_call",
  "think",
  "thought",
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
  "role",
  "im_start",
  "im_end",
  "name",
  "function",
  "tool_name",
  "arguments",
  "args",
  "parameter",
  "arg_key",
  "arg_value",
  "parameter_value",
  "argument_name",
  "argument_value",
]);

function parseJsonTolerant(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    void err;
    try {
      const sanitized = raw.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
        return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
      });
      return JSON.parse(sanitized);
    } catch (innerErr: unknown) {
      void innerErr;
      return null;
    }
  }
}

function castValue(raw: string): unknown {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
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

function parseParameters(body: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // 1. Qwen Parameter Format: <parameter=path>src/index.js</parameter>
  const qwenParamRegex = new RegExp(QWEN_PARAM_REGEX.source, "gi");
  let qpMatch = qwenParamRegex.exec(body);
  while (qpMatch !== null) {
    const key = (qpMatch[1] ?? "").trim();
    const val = (qpMatch[2] ?? "").trim();
    if (key.length > 0 && !(key in params)) {
      params[key] = castValue(val);
    }
    qpMatch = qwenParamRegex.exec(body);
  }

  // 2. Key-Value pairs: <arg_key>k</arg_key><arg_value>v</arg_value>
  const kvRegex = new RegExp(ARG_KV_REGEX.source, "gi");
  let kvMatch = kvRegex.exec(body);
  while (kvMatch !== null) {
    const key = (kvMatch[1] ?? "").trim();
    const val = (kvMatch[2] ?? "").trim();
    if (key.length > 0 && !(key in params)) {
      params[key] = castValue(val);
    }
    kvMatch = kvRegex.exec(body);
  }

  // 3. Named parameter tags: <parameter name="k">v</parameter>
  const paramRegex = new RegExp(PARAM_REGEX.source, "gi");
  let pMatch = paramRegex.exec(body);
  while (pMatch !== null) {
    const key = (pMatch[1] ?? "").trim();
    let val = (pMatch[2] ?? "").trim();
    if (val.includes("<arg_key>")) {
      val = val.split("<arg_key>")[0]?.trim() ?? val;
    }
    if (key.length > 0 && !(key in params)) {
      params[key] = castValue(val);
    }
    pMatch = paramRegex.exec(body);
  }

  // 4. Claude / Cline child tags: <path>server.py</path><content>import os</content>
  if (Object.keys(params).length === 0) {
    const childTagRegex = /<([a-zA-Z0-9_\-]+)>([^<]*?)<\/\1>/g;
    let childMatch = childTagRegex.exec(body);
    while (childMatch !== null) {
      const tag = (childMatch[1] ?? "").trim();
      const val = (childMatch[2] ?? "").trim();
      if (!EXCLUDED_TAG_NAMES.has(tag.toLowerCase()) && tag.length > 0 && !(tag in params)) {
        params[tag] = castValue(val);
      }
      childMatch = childTagRegex.exec(body);
    }
  }

  // 5. Fallback: <arguments>JSON</arguments> or raw JSON in body
  if (Object.keys(params).length === 0) {
    const argsTagMatch = /<(?:arguments|args)>([\s\S]*?)<\/(?:arguments|args)>/i.exec(body);
    const rawCandidate = (argsTagMatch?.[1] ?? body).trim();
    if (rawCandidate.startsWith("{") && rawCandidate.endsWith("}")) {
      const parsed = parseJsonTolerant(rawCandidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const dict = parsed as Record<string, unknown>;
        if (dict.arguments && typeof dict.arguments === "object" && !Array.isArray(dict.arguments)) {
          Object.assign(params, dict.arguments);
        } else if (typeof dict.arguments === "string") {
          const inner = parseJsonTolerant(dict.arguments);
          if (typeof inner === "object" && inner !== null) {
            Object.assign(params, inner);
          } else {
            params.arguments = dict.arguments;
          }
        } else {
          Object.assign(params, dict);
        }
      }
    }
  }

  return params;
}

function extractFunctionName(tagFnName: string | undefined, body: string): string {
  if (tagFnName && tagFnName.trim().length > 0) {
    return tagFnName.trim();
  }
  const nameMatch = /<(?:name|function|tool_name)>([^<]+)<\/(?:name|function|tool_name)>/i.exec(body);
  if (nameMatch && (nameMatch[1] ?? "").trim().length > 0) {
    return (nameMatch[1] ?? "").trim();
  }
  return "tool";
}

export function parseDotsXml(content: string): DotsParseResult {
  const sanitized = stripLeakedTemplateTags(content);
  const lower = sanitized.toLowerCase();
  if (
    !lower.includes("<invoke") &&
    !lower.includes("<tool_call") &&
    !lower.includes("<function_call") &&
    !lower.includes("<function_calls") &&
    !lower.includes("<tool_calls") &&
    !lower.includes("<function=") &&
    !lower.includes("<minimax:tool_call") &&
    !/<[a-zA-Z0-9_\-]+>\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>/i.test(sanitized)
  ) {
    return { cleanText: sanitized, toolCalls: [] };
  }

  const toolCalls: OpenAIToolCall[] = [];
  let index = 0;

  // 1. Qwen JSON-in-XML: <tool_call>\s*({.*?})\s*</tool_call>
  const jsonXmlRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  let jMatch = jsonXmlRegex.exec(sanitized);
  while (jMatch !== null) {
    const rawJson = jMatch[1] ?? "{}";
    const parsed = parseJsonTolerant(rawJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      const name = (payload.name || payload.function || "tool") as string;
      let rawArgs: unknown = payload.arguments ?? payload.parameters ?? {};
      if (typeof rawArgs === "string") {
        const inner = parseJsonTolerant(rawArgs);
        rawArgs = inner !== null ? inner : { input: rawArgs };
      }
      toolCalls.push({
        id: `call_dots_${Date.now()}_${index}`,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(rawArgs),
        },
      });
      index += 1;
    }
    jMatch = jsonXmlRegex.exec(sanitized);
  }

  // 2. Qwen Format: <function=name>...</function>
  const qwenFuncRegex = new RegExp(QWEN_FUNC_REGEX.source, "gi");
  let qMatch = qwenFuncRegex.exec(sanitized);
  while (qMatch !== null) {
    const fnName = (qMatch[1] ?? "").trim();
    const body = qMatch[2] ?? "";
    const argsObj = parseParameters(body);
    toolCalls.push({
      id: `call_dots_${Date.now()}_${index}`,
      type: "function",
      function: {
        name: fnName,
        arguments: JSON.stringify(argsObj),
      },
    });
    index += 1;
    qMatch = qwenFuncRegex.exec(sanitized);
  }

  // 3. DeepSeek / MiniMax / Standard Invoke Format: <invoke name="name">...
  const invokeRegex = new RegExp(INVOKE_BLOCK_REGEX.source, "gi");
  let iMatch = invokeRegex.exec(sanitized);
  while (iMatch !== null) {
    const rawBody = (iMatch[2] ?? "").trim();
    if (!rawBody.startsWith("{") && !rawBody.includes("<function=")) {
      const rawFnName = iMatch[1];
      const fnName = extractFunctionName(rawFnName, rawBody);
      const argsObj = parseParameters(rawBody);
      toolCalls.push({
        id: `call_dots_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: fnName,
          arguments: JSON.stringify(argsObj),
        },
      });
      index += 1;
    }
    iMatch = invokeRegex.exec(sanitized);
  }

  // 4. Claude / Cline Format: <write><path>...</path></write> (only if no tools extracted yet)
  if (toolCalls.length === 0) {
    const customToolRegex = /<([a-zA-Z0-9_\-]+)>(\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>[\s\S]*?)<\/\1>/gi;
    let cMatch = customToolRegex.exec(sanitized);
    while (cMatch !== null) {
      const tagName = (cMatch[1] ?? "").trim();
      if (!EXCLUDED_TAG_NAMES.has(tagName.toLowerCase())) {
        const body = cMatch[2] ?? "";
        const argsObj = parseParameters(body);
        if (Object.keys(argsObj).length > 0) {
          toolCalls.push({
            id: `call_dots_${Date.now()}_${index}`,
            type: "function",
            function: {
              name: tagName,
              arguments: JSON.stringify(argsObj),
            },
          });
          index += 1;
        }
      }
      cMatch = customToolRegex.exec(sanitized);
    }
  }

  // Strip tool calling XML blocks and leftover tags from user text
  const cleanText = sanitized
    .replace(/<tool_call>\s*\{[\s\S]*?\}\s*<\/tool_call>/gi, "")
    .replace(/<function=[a-zA-Z0-9_\-]+>[\s\S]*?<\/function>/gi, "")
    .replace(new RegExp(INVOKE_BLOCK_REGEX.source, "gi"), "")
    .replace(/<([a-zA-Z0-9_\-]+)>\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>[\s\S]*?<\/\1>/gi, (match, tag) => {
      return EXCLUDED_TAG_NAMES.has(String(tag).toLowerCase()) ? match : "";
    })
    .replace(/<\/?(?:tool_calls|function_calls|invoke|tool_call|function_call|minimax:tool_call|parameter|arg_key|arg_value|parameter_value|argument_name|argument_value|role)[^>]*>/gi, "")
    .trim();

  return { cleanText, toolCalls };
}

function parseToolCallArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const parsed = parseJsonTolerant(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return { input: raw };
  }
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function serializeParamEntry([k, v]: [string, unknown]): string {
  const valStr = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  return `<parameter name="${k}">${valStr}</parameter>`;
}

function serializeSingleInvoke(tc: OpenAIToolCall): string {
  const fnName = tc.function?.name || "tool";
  const argsObj = parseToolCallArguments(tc.function?.arguments);
  const paramXml = Object.entries(argsObj).map(serializeParamEntry).join("\n");
  if (paramXml.length > 0) {
    return `<invoke name="${fnName}">\n${paramXml}\n</invoke>`;
  }
  return `<invoke name="${fnName}">\n</invoke>`;
}

export function serializeDotsToolCalls(
  toolCalls: readonly OpenAIToolCall[]
): string {
  if (!toolCalls || toolCalls.length === 0) {
    return "";
  }
  const invokes = toolCalls.map(serializeSingleInvoke).join("\n");
  return `<tool_calls>\n${invokes}\n</tool_calls>`;
}

function serializeToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content ?? "");
}

function serializeMessageForDots(msg: OpenAIMessage): OpenAIMessage {
  if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
    const xml = serializeDotsToolCalls(msg.tool_calls);
    const baseText = typeof msg.content === "string" ? msg.content : "";
    const newContent = baseText.length > 0 ? `${baseText}\n${xml}` : xml;
    return { role: "assistant", content: newContent };
  }
  if (msg.role === "tool") {
    const toolId = msg.tool_call_id || "call_unknown";
    const text = serializeToolResultContent(msg.content);
    return {
      role: "user",
      content: `<tool_result id="${toolId}">\n${text}\n</tool_result>`,
    };
  }
  return msg;
}

export function serializeDotsToolHistory(
  messages: readonly OpenAIMessage[]
): OpenAIMessage[] {
  return messages.map(serializeMessageForDots);
}

export interface DotsStreamState {
  buffer: string;
  reasoningSanitizer: TagSanitizerStreamBuffer;
  toolCallIndex: number;
  hasEmittedToolCalls: boolean;
  hasEmittedFinishReason: boolean;
  id?: string;
  model?: string;
  usage?: Record<string, unknown>;
}

export function createDotsStreamState(): DotsStreamState {
  return {
    buffer: "",
    reasoningSanitizer: new TagSanitizerStreamBuffer(),
    toolCallIndex: 0,
    hasEmittedToolCalls: false,
    hasEmittedFinishReason: false,
  };
}

function formatOpenAIToolCallDelta(
  toolCall: OpenAIToolCall,
  index: number,
  id?: string,
  model?: string
): string {
  const payload = {
    id: id || `chatcmpl_dots_${Date.now()}`,
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
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            },
          ],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatOpenAITextDelta(
  text: string,
  id?: string,
  model?: string
): string {
  const payload = {
    id: id || `chatcmpl_dots_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [
      {
        index: 0,
        delta: {
          content: text,
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function formatOpenAIFinishDelta(
  finishReason: string,
  id?: string,
  model?: string,
  usage?: Record<string, unknown>
): string {
  const payload: Record<string, unknown> = {
    id: id || `chatcmpl_dots_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "model",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
  if (usage) {
    payload.usage = usage;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function flushNonTagContent(state: DotsStreamState): string {
  const tagStart = state.buffer.search(/<(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function=|minimax:tool_call)/i);
  if (tagStart === -1) {
    const potentialTag = state.buffer.search(/<[^>]*$/);
    if (potentialTag !== -1) {
      const rawPrefix = state.buffer.slice(0, potentialTag);
      state.buffer = state.buffer.slice(potentialTag);
      const textToEmit = stripLeakedTemplateTags(rawPrefix);
      return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit, state.id, state.model) : "";
    }
    const textToEmit = stripLeakedTemplateTags(state.buffer);
    state.buffer = "";
    return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit, state.id, state.model) : "";
  }
  if (tagStart > 0) {
    const rawPrefix = state.buffer.slice(0, tagStart);
    state.buffer = state.buffer.slice(tagStart);
    const prefix = stripLeakedTemplateTags(rawPrefix);
    return prefix.length > 0 ? formatOpenAITextDelta(prefix, state.id, state.model) : "";
  }
  return "";
}

export function processDotsStreamChunk(
  chunk: string,
  state: DotsStreamState
): string {
  state.buffer += chunk;

  const hasClosingTag =
    /<\/(?:invoke|tool_call|function_call|function|tool_calls|function_calls|minimax:tool_call)>/i.test(
      state.buffer
    ) || /<\/([a-zA-Z0-9_\-]+)>\s*$/i.test(state.buffer);
  if (!hasClosingTag) {
    return flushNonTagContent(state);
  }

  const { cleanText, toolCalls } = parseDotsXml(state.buffer);
  state.buffer = "";

  let output = "";
  if (cleanText.length > 0) {
    output += formatOpenAITextDelta(cleanText, state.id, state.model);
  }
  for (const tc of toolCalls) {
    output += formatOpenAIToolCallDelta(tc, state.toolCallIndex, state.id, state.model);
    state.toolCallIndex += 1;
    state.hasEmittedToolCalls = true;
  }
  return output;
}

export function createDotsStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const state = createDotsStreamState();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";

  function flushPendingBuffer(): string {
    let out = "";
    if (state.buffer.length > 0) {
      const { cleanText, toolCalls } = parseDotsXml(state.buffer);
      state.buffer = "";
      if (cleanText.length > 0) {
        out += formatOpenAITextDelta(cleanText, state.id, state.model);
      }
      for (const tc of toolCalls) {
        out += formatOpenAIToolCallDelta(tc, state.toolCallIndex, state.id, state.model);
        state.toolCallIndex += 1;
        state.hasEmittedToolCalls = true;
      }
    }
    return out;
  }

  function ensureFinishReason(): string {
    if (!state.hasEmittedFinishReason) {
      state.hasEmittedFinishReason = true;
      const finishReason = state.hasEmittedToolCalls ? "tool_calls" : "stop";
      return formatOpenAIFinishDelta(finishReason, state.id, state.model, state.usage);
    }
    return "";
  }

  return new TransformStream<Uint8Array, Uint8Array>(({
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
          const pending = flushPendingBuffer();
          if (pending) {
            controller.enqueue(encoder.encode(pending));
          }
          const finishSse = ensureFinishReason();
          if (finishSse) {
            controller.enqueue(encoder.encode(finishSse));
          }
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.id && typeof data.id === "string") {
              state.id = data.id;
            }
            if (data.model && typeof data.model === "string") {
              state.model = data.model;
            }
            if (data.usage && typeof data.usage === "object") {
              state.usage = data.usage as Record<string, unknown>;
            }

            const choice = data.choices?.[0];
            const delta = choice?.delta;
            const content = delta?.content;
            const incomingFinishReason = choice?.finish_reason;

            // Sanitize reasoning / thought fields across token stream buffers
            let deltaModified = false;
            if (delta && typeof delta === "object") {
              if (typeof delta.reasoning_content === "string") {
                delta.reasoning_content = state.reasoningSanitizer.process(delta.reasoning_content);
                deltaModified = true;
              }
              if (typeof delta.thought === "string") {
                delta.thought = state.reasoningSanitizer.process(delta.thought);
                deltaModified = true;
              }
              if (typeof delta.reasoning === "string") {
                delta.reasoning = state.reasoningSanitizer.process(delta.reasoning);
                deltaModified = true;
              }
            }

            // FAST PASS-THROUGH: If no XML buffering is active and content has no '<', forward chunk
            if (
              state.buffer.length === 0 &&
              (typeof content !== "string" || !content.includes("<"))
            ) {
              if (incomingFinishReason) {
                if (state.hasEmittedToolCalls) {
                  choice.finish_reason = "tool_calls";
                  state.hasEmittedFinishReason = true;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } else {
                  state.hasEmittedFinishReason = true;
                  controller.enqueue(
                    encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
                  );
                }
              } else {
                controller.enqueue(
                  encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
                );
              }
              continue;
            }

            // BUFFERING MODE: XML tag in progress or newly encountered in content
            if (typeof content === "string") {
              const processedSse = processDotsStreamChunk(content, state);
              if (processedSse) {
                controller.enqueue(encoder.encode(processedSse));
              }
              if (incomingFinishReason) {
                const finishSse = ensureFinishReason();
                if (finishSse) {
                  controller.enqueue(encoder.encode(finishSse));
                }
              }
            } else if (incomingFinishReason) {
              const pending = flushPendingBuffer();
              if (pending) {
                controller.enqueue(encoder.encode(pending));
              }
              const finishSse = ensureFinishReason();
              if (finishSse) {
                controller.enqueue(encoder.encode(finishSse));
              } else {
                controller.enqueue(
                  encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
                );
              }
            } else {
              controller.enqueue(
                encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
              );
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
      const pending = flushPendingBuffer();
      if (pending) {
        controller.enqueue(encoder.encode(pending));
      }
      const finishSse = ensureFinishReason();
      if (finishSse) {
        controller.enqueue(encoder.encode(finishSse));
      }
      if (lineBuffer.length > 0) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  }));
}
