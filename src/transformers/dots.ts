import type { OpenAIMessage, OpenAIToolCall } from "./nuances";

export interface DotsParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
}

interface ParsedParameter {
  readonly name: string;
  readonly value: string;
}

const INVOKE_BLOCK_REGEX =
  /<(?:invoke|tool_call|function_call)(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/(?:invoke|tool_call|function_call)>/gi;

const PARAM_REGEX =
  /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)(?:<\/(?:parameter|arg_value|parameter_value)>|(?=<parameter|<arg_key|<\/(?:invoke|tool_call|function_call|function_calls|tool_calls)>|$))/gi;

const ARG_KV_REGEX =
  /<(?:arg_key|argument_name|parameter_name)>([^<]+)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;

function parseParamValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return raw;
    }
    return raw;
  }
}

function parseParameters(body: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // 1. Key-Value pairs: <arg_key>k</arg_key><arg_value>v</arg_value>
  const kvRegex = new RegExp(ARG_KV_REGEX.source, "gi");
  let kvMatch = kvRegex.exec(body);
  while (kvMatch !== null) {
    const key = (kvMatch[1] ?? "").trim();
    const val = (kvMatch[2] ?? "").trim();
    if (key.length > 0) {
      params[key] = parseParamValue(val);
    }
    kvMatch = kvRegex.exec(body);
  }

  // 2. Named parameter tags: <parameter name="k">v</parameter>
  const paramRegex = new RegExp(PARAM_REGEX.source, "gi");
  let pMatch = paramRegex.exec(body);
  while (pMatch !== null) {
    const key = (pMatch[1] ?? "").trim();
    let val = (pMatch[2] ?? "").trim();
    if (val.includes("<arg_key>")) {
      val = val.split("<arg_key>")[0]?.trim() ?? val;
    }
    if (key.length > 0 && !(key in params)) {
      params[key] = parseParamValue(val);
    }
    pMatch = paramRegex.exec(body);
  }

  // 3. Fallback: <arguments>JSON</arguments> or raw JSON in body
  if (Object.keys(params).length === 0) {
    const argsTagMatch = /<(?:arguments|args)>([\s\S]*?)<\/(?:arguments|args)>/i.exec(body);
    const rawCandidate = (argsTagMatch?.[1] ?? body).trim();
    if (rawCandidate.startsWith("{") && rawCandidate.endsWith("}")) {
      try {
        const parsed = JSON.parse(rawCandidate);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          Object.assign(params, parsed);
        }
      } catch (err: unknown) {
        void err;
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

function createToolCallFromInvoke(
  rawName: string | undefined,
  body: string,
  index: number
): OpenAIToolCall {
  const fnName = extractFunctionName(rawName, body);
  const argsObj = parseParameters(body);
  return {
    id: `call_dots_${Date.now()}_${index}`,
    type: "function",
    function: {
      name: fnName,
      arguments: JSON.stringify(argsObj),
    },
  };
}

export function parseDotsXml(content: string): DotsParseResult {
  const lower = content.toLowerCase();
  if (
    !lower.includes("<invoke") &&
    !lower.includes("<tool_call") &&
    !lower.includes("<function_call") &&
    !lower.includes("<function_calls") &&
    !lower.includes("<tool_calls")
  ) {
    return { cleanText: content, toolCalls: [] };
  }

  const toolCalls: OpenAIToolCall[] = [];
  const regex = new RegExp(INVOKE_BLOCK_REGEX.source, "gi");
  let match = regex.exec(content);
  let index = 0;

  while (match !== null) {
    const rawFnName = match[1];
    const body = match[2] ?? "";
    toolCalls.push(createToolCallFromInvoke(rawFnName, body, index));
    index += 1;
    match = regex.exec(content);
  }

  const cleanText = content
    .replace(new RegExp(INVOKE_BLOCK_REGEX.source, "gi"), "")
    .replace(/<\/?(?:tool_calls|function_calls|invoke|tool_call|function_call|parameter|arg_key|arg_value|parameter_value|argument_name|argument_value)[^>]*>/gi, "")
    .trim();

  return { cleanText, toolCalls };
}

function parseToolCallArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      return { input: parsed };
    } catch {
      return { input: raw };
    }
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
    return `<invoke name="${fnName}">
${paramXml}
</invoke>`;
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
  return `<tool_calls>
${invokes}
</tool_calls>`;
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
    const newContent = baseText.length > 0 ? `${baseText}
${xml}` : xml;
    return { role: "assistant", content: newContent };
  }
  if (msg.role === "tool") {
    const toolId = msg.tool_call_id || "call_unknown";
    const text = serializeToolResultContent(msg.content);
    return {
      role: "user",
      content: `<tool_result id="${toolId}">
${text}
</tool_result>`,
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
  toolCallIndex: number;
}

export function createDotsStreamState(): DotsStreamState {
  return {
    buffer: "",
    toolCallIndex: 0,
  };
}

function formatOpenAIToolCallDelta(
  toolCall: OpenAIToolCall,
  index: number
): string {
  const payload = {
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
  return `data: ${JSON.stringify(payload)}

`;
}

function formatOpenAITextDelta(text: string): string {
  const payload = {
    choices: [
      {
        index: 0,
        delta: {
          content: text,
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}

`;
}

function flushNonTagContent(state: DotsStreamState): string {
  const tagStart = state.buffer.search(/<(?:tool_calls?|function_calls?|invoke|tool_call|function_call)/i);
  if (tagStart === -1) {
    const potentialTag = state.buffer.search(/<[a-zA-Z0-9_]*$/);
    if (potentialTag !== -1) {
      const textToEmit = state.buffer.slice(0, potentialTag);
      state.buffer = state.buffer.slice(potentialTag);
      return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit) : "";
    }
    const textToEmit = state.buffer;
    state.buffer = "";
    return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit) : "";
  }
  if (tagStart > 0) {
    const prefix = state.buffer.slice(0, tagStart);
    state.buffer = state.buffer.slice(tagStart);
    return formatOpenAITextDelta(prefix);
  }
  return "";
}

export function processDotsStreamChunk(
  chunk: string,
  state: DotsStreamState
): string {
  state.buffer += chunk;

  const hasClosingTag = /<\/(?:invoke|tool_call|function_call|tool_calls|function_calls)>/i.test(state.buffer);
  if (!hasClosingTag) {
    return flushNonTagContent(state);
  }

  const { cleanText, toolCalls } = parseDotsXml(state.buffer);
  state.buffer = "";

  let output = "";
  if (cleanText.length > 0) {
    output += formatOpenAITextDelta(cleanText);
  }
  for (const tc of toolCalls) {
    output += formatOpenAIToolCallDelta(tc, state.toolCallIndex);
    state.toolCallIndex += 1;
  }
  return output;
}

export function createDotsStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const state = createDotsStreamState();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";

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
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            const content = data.choices?.[0]?.delta?.content;
            if (typeof content === "string") {
              const processedSse = processDotsStreamChunk(content, state);
              if (processedSse) {
                controller.enqueue(encoder.encode(processedSse));
              }
            } else {
              controller.enqueue(encoder.encode(line + "\n"));
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
      if (state.buffer.length > 0) {
        const { cleanText, toolCalls } = parseDotsXml(state.buffer);
        state.buffer = "";
        let output = "";
        if (cleanText.length > 0) {
          output += formatOpenAITextDelta(cleanText);
        }
        for (const tc of toolCalls) {
          output += formatOpenAIToolCallDelta(tc, state.toolCallIndex);
          state.toolCallIndex += 1;
        }
        if (output.length > 0) {
          controller.enqueue(encoder.encode(output));
        }
      }
      if (lineBuffer.length > 0) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  });
}
