import type { OpenAIToolCall } from "./nuances";

export interface DotsParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
}

interface ParsedParameter {
  readonly name: string;
  readonly value: string;
}

const INVOKE_BLOCK_REGEX = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
const PARAM_REGEX = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;

function parseSingleParam(match: RegExpExecArray): ParsedParameter {
  const name = match[1] ?? "";
  const value = (match[2] ?? "").trim();
  return { name, value };
}

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
  const regex = new RegExp(PARAM_REGEX.source, "g");
  let match = regex.exec(body);
  while (match !== null) {
    const { name, value } = parseSingleParam(match);
    if (name.length > 0) {
      params[name] = parseParamValue(value);
    }
    match = regex.exec(body);
  }
  return params;
}

function createToolCallFromInvoke(
  name: string,
  body: string,
  index: number
): OpenAIToolCall {
  const argsObj = parseParameters(body);
  return {
    id: `call_dots_${Date.now()}_${index}`,
    type: "function",
    function: {
      name: name.trim(),
      arguments: JSON.stringify(argsObj),
    },
  };
}

export function parseDotsXml(content: string): DotsParseResult {
  if (!content.includes("<invoke")) {
    return { cleanText: content, toolCalls: [] };
  }

  const toolCalls: OpenAIToolCall[] = [];
  const regex = new RegExp(INVOKE_BLOCK_REGEX.source, "g");
  let match = regex.exec(content);
  let index = 0;

  while (match !== null) {
    const fnName = match[1] ?? "";
    const body = match[2] ?? "";
    toolCalls.push(createToolCallFromInvoke(fnName, body, index));
    index += 1;
    match = regex.exec(content);
  }

  const cleanText = content
    .replace(INVOKE_BLOCK_REGEX, "")
    .replace(/<\/?(?:tool_calls|function_calls)>/g, "")
    .trim();
  return { cleanText, toolCalls };
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
  return `data: ${JSON.stringify(payload)}\n\n`;
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
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function flushNonTagContent(state: DotsStreamState): string {
  const tagStart = state.buffer.search(/<(?:tool_calls|function_calls|invoke)/i);
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

  if (!state.buffer.includes("</invoke>") && !state.buffer.includes("</tool_calls>")) {
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
      if (lineBuffer.length > 0) {
        controller.enqueue(encoder.encode(lineBuffer));
      }
    },
  });
}
