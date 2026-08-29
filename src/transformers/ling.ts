import type { OpenAIMessage, OpenAIToolCall } from "./nuances";

export interface LingParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
  readonly reasoningContent?: string;
}

/**
 * Explicit 1:1 Whitelist of Known Ling/GLM Tags and Tokens.
 * Any new tag from upstream Ling can be added directly here in 1 line.
 */
export const LING_KNOWN_TAGS = [
  // Container tags
  "<tool_calls>",
  "</tool_calls>",
  "<invoke",
  "</invoke>",
  "<tool_call>",
  "</tool_call>",
  "<function_call>",
  "</function_call>",

  // Parameter & Argument Key-Value tags
  "<arg_key>",
  "</arg_key>",
  "<arg_value>",
  "</arg_value>",
  "<parameter_name>",
  "</parameter_name>",
  "<parameter_value>",
  "</parameter_value>",
  "<parameter",
  "</parameter>",

  // Thinking / Reasoning tags
  "<think>",
  "</think>",
  "<thought>",
  "</thought>",
  "<thinking>",
  "</thinking>",

  // Role & Delimiter tokens
  "<role:assistant>",
  "<role:user>",
  "<role:system>",
  "<role>",
  "</role>",
  "<tool_response>",
  "</tool_response>",
  "<tool_result>",
  "</tool_result>",
  "[gMASK]",
  "<sop>",
  "<|im_start|>",
  "<|im_end|>",
  "<|eot_id|>",
] as const;

export const LING_LEAKED_TEMPLATE_REGEX =
  /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>|<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>|<\s*\/?\s*(?:assistant|user|system|human|bot)\s*>|<\|\s*(?:im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end|system|user|assistant|observation|bot|tool_calls?|\/?tool_calls?|eot_id|start_header_id|end_header_id|end)\b[^|]*\|>(?:\s*(?:assistant|user|system|human|bot)\b)?|\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>|(?:\\b(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\\b\s*)?<\s*\/\s*(?:role|im_end|end_of_turn|role_end)\s*>|<\s*(?:role|im_start|start_of_turn|role_start)\s*>\s*(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\b|<\/?(?:im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end)(?:\s+[^>]*)?>|<\/?(?:tool_response|tool_result|tools|turn|turn_end)(?:\s+[^>]*)?>/gi;

export const LING_STREAM_PARTIAL_TAG_REGEX =
  /<$|<(?:\/|[a-zA-Z_])[a-zA-Z0-9_\-: ="]{0,50}$|<\|[^|]{0,40}$|\[(?:gMASK|\/?INST)[a-zA-Z0-9_\-/]{0,10}$|<<\/?(?:SYS)?[^>]{0,10}$/i;

export const LING_UNCLOSED_STRIP_REGEX =
  /<(?:\/|\/?(?:role|think|thought|thinking|tool_call|tool_calls|function|invoke|parameter|arg_key|arg_value|turn|assistant|user|system|bot|human|minimax|sop|im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end|observation|eot_id|start_header_id|end_header_id|tool_response|tool_result))[a-zA-Z0-9_\-: ="]{0,40}$|<\|[^|]{0,40}$|\[(?:gMASK|\/?INST)[^\]]{0,10}$|<<\/?(?:SYS)[^>]{0,10}$/i;

export function stripLingLeakedTemplateTags(text: string): string {
  return text.replace(LING_LEAKED_TEMPLATE_REGEX, "");
}

export function stripLingUnclosedTemplateTags(text: string): string {
  return text.replace(LING_UNCLOSED_STRIP_REGEX, "");
}

function parseLingArgumentsXml(xmlBody: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  const argPairRegex =
    /<(?:arg_key|argument_name|parameter_name)>([\s\S]*?)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;
  let match: RegExpExecArray | null = argPairRegex.exec(xmlBody);
  while (match !== null) {
    const key = match[1]?.trim() ?? "";
    const rawVal = match[2]?.trim() ?? "";
    if (key.length > 0) {
      args[key] = coerceLingValue(rawVal);
    }
    match = argPairRegex.exec(xmlBody);
  }

  const paramNamedRegex =
    /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
  match = paramNamedRegex.exec(xmlBody);
  while (match !== null) {
    const key = match[1]?.trim() ?? "";
    const rawVal = match[2]?.trim() ?? "";
    if (key.length > 0) {
      args[key] = coerceLingValue(rawVal);
    }
    match = paramNamedRegex.exec(xmlBody);
  }

  return args;
}

function coerceLingValue(val: string): unknown {
  if (val.startsWith("{") || val.startsWith("[")) {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  const num = Number(val);
  if (!Number.isNaN(num) && val.trim() !== "") {
    return num;
  }
  return val;
}

export function parseLingXml(raw: string): LingParseResult {
  let text = raw;
  let reasoningContent: string | undefined;

  const thinkMatch = /<(?:think|thought|thinking)>([\s\S]*?)<\/(?:think|thought|thinking)>/i.exec(text);
  if (thinkMatch) {
    const captured = thinkMatch[1]?.trim();
    if (captured && captured.length > 0) {
      reasoningContent = stripLingLeakedTemplateTags(captured);
    }
    text = text.replace(thinkMatch[0], "");
  }

  const toolCalls: OpenAIToolCall[] = [];
  let index = 0;

  const invokeBlockRegex =
    /<(?:invoke|tool_call|function_call)(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/(?:invoke|tool_call|function_call)>/gi;
  let match: RegExpExecArray | null = invokeBlockRegex.exec(text);
  while (match !== null) {
    const name = match[1]?.trim() || "unknown";
    const body = match[2] ?? "";
    const args = parseLingArgumentsXml(body);

    toolCalls.push({
      id: `call_lg_${Date.now()}_${index}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
    index += 1;
    match = invokeBlockRegex.exec(text);
  }

  if (toolCalls.length > 0) {
    text = text.replace(invokeBlockRegex, "").trim();
  }

  const unadornedGlmRegex =
    /([a-zA-Z0-9_\-]+)\s*(<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>)+/gi;
  match = unadornedGlmRegex.exec(text);
  while (match !== null) {
    const name = match[1]?.trim() ?? "unknown";
    const body = match[0].slice(name.length);
    const args = parseLingArgumentsXml(body);

    toolCalls.push({
      id: `call_lg_${Date.now()}_${index}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
    index += 1;
    match = unadornedGlmRegex.exec(text);
  }

  if (toolCalls.length > 0) {
    text = text.replace(unadornedGlmRegex, "").trim();
  }

  text = text
    .replace(/<\/?(?:tool_calls|function_calls|tools)>/gi, "")
    .trim();

  text = stripLingLeakedTemplateTags(text).trim();

  return {
    cleanText: text,
    toolCalls: Object.freeze(toolCalls),
    reasoningContent,
  };
}

export function createLingStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += textDecoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          controller.enqueue(textEncoder.encode("\n"));
          continue;
        }
        if (trimmed === "data: [DONE]") {
          controller.enqueue(textEncoder.encode("data: [DONE]\n\n"));
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          controller.enqueue(textEncoder.encode(`${trimmed}\n\n`));
          continue;
        }
        controller.enqueue(textEncoder.encode(`${line}\n`));
      }
    },
    flush(controller) {
      if (buffer.trim().length > 0) {
        controller.enqueue(textEncoder.encode(`${buffer}\n`));
      }
    },
  });
}
