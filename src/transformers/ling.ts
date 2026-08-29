import type { OpenAIMessage, OpenAIToolCall } from "./nuances";

export interface LingParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
  readonly reasoningContent?: string;
}

export const LING_KNOWN_TAGS = [
  "<tool_calls>",
  "</tool_calls>",
  "<invoke",
  "</invoke>",
  "<tool_call>",
  "</tool_call>",
  "<function_call>",
  "</function_call>",
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
  "<think>",
  "</think>",
  "<thought>",
  "</thought>",
  "<thinking>",
  "</thinking>",
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

/**
 * Coerce string value into typed boolean, number, or JSON object/array
 */
export function coerceLingValue(val: string): unknown {
  const trimmed = val.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") {
    return num;
  }
  return trimmed;
}

/**
 * 1-to-1 Parameter XML Parser:
 * Parses:
 * 1. <parameter name="key">value</parameter>
 * 2. <parameter=key>value</parameter>
 * 3. <arg_key>key</arg_key><arg_value>value</arg_value>
 * 4. <parameter_name>key</parameter_name><parameter_value>value</parameter_value>
 */
export function parseXmlParameters(xmlBody: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  // 1. <arg_key>k</arg_key><arg_value>v</arg_value> or <parameter_name>k</parameter_name><parameter_value>v</parameter_value>
  const keyValRegex =
    /<(?:arg_key|argument_name|parameter_name)>([\s\S]*?)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;
  let match: RegExpExecArray | null = keyValRegex.exec(xmlBody);
  while (match !== null) {
    const k = match[1]?.trim() ?? "";
    const v = match[2]?.trim() ?? "";
    if (k.length > 0) {
      args[k] = coerceLingValue(v);
    }
    match = keyValRegex.exec(xmlBody);
  }

  // 2. <parameter name="k">v</parameter>
  const paramNamedRegex =
    /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
  match = paramNamedRegex.exec(xmlBody);
  while (match !== null) {
    const k = match[1]?.trim() ?? "";
    const v = match[2]?.trim() ?? "";
    if (k.length > 0) {
      args[k] = coerceLingValue(v);
    }
    match = paramNamedRegex.exec(xmlBody);
  }

  // 3. Qwen <parameter=k>v</parameter>
  const paramQwenRegex =
    /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/parameter>/gi;
  match = paramQwenRegex.exec(xmlBody);
  while (match !== null) {
    const k = match[1]?.trim() ?? "";
    const v = match[2]?.trim() ?? "";
    if (k.length > 0) {
      args[k] = coerceLingValue(v);
    }
    match = paramQwenRegex.exec(xmlBody);
  }

  return args;
}

export function stripLingLeakedTemplateTags(text: string): string {
  return text
    .replace(/<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>/gi, "")
    .replace(/<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>/gi, "")
    .replace(/<\|\s*(?:im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end|system|user|assistant|observation|bot|tool_calls?|\/?tool_calls?|eot_id|start_header_id|end_header_id|end)\b[^|]*\|>/gi, "")
    .replace(/\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>/gi, "")
    .replace(/<\/?(?:tool_calls|tool_call|function_calls|function_call|tools|invoke|function)[^>]*>/gi, "")
    .trim();
}

export function stripLingUnclosedTemplateTags(text: string): string {
  return text;
}

/**
 * 1-to-1 Ling & Multi-Dialect XML Parser
 */
export function parseLingXml(raw: string): LingParseResult {
  let text = raw;
  let reasoningContent: string | undefined;

  // 1. Thinking extraction & breakout
  // Handles <think>reasoning</think> OR unclosed <think>reasoning<tool_call>...
  const thinkClosedMatch = /<(?:think|thought|thinking)>([\s\S]*?)<\/(?:think|thought|thinking)>/i.exec(text);
  if (thinkClosedMatch) {
    reasoningContent = stripLingLeakedTemplateTags(thinkClosedMatch[1]?.trim() ?? "");
    text = text.replace(thinkClosedMatch[0], "");
  } else {
    const thinkOpenMatch = /<(?:think|thought|thinking)>([\s\S]*?)(?=<tool_call>|<tool_calls>|<invoke|<function=|[a-zA-Z0-9_\-]+<arg_key>)/i.exec(text);
    if (thinkOpenMatch) {
      reasoningContent = stripLingLeakedTemplateTags(thinkOpenMatch[1]?.trim() ?? "");
      text = text.replace(thinkOpenMatch[0], "");
    }
  }

  const toolCalls: OpenAIToolCall[] = [];
  let index = 0;
  let match: RegExpExecArray | null = null;

  // 2. Qwen <function=name>...</function>
  const qwenBlockRegex = /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;
  match = qwenBlockRegex.exec(text);
  while (match !== null) {
    const name = match[1]?.trim() ?? "unknown";
    const body = match[2] ?? "";
    const args = parseXmlParameters(body);

    toolCalls.push({
      id: `call_lg_${Date.now()}_${index}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
    index += 1;
    match = qwenBlockRegex.exec(text);
  }

  if (toolCalls.length > 0) {
    text = text.replace(qwenBlockRegex, "").trim();
  }

  // 3. <invoke name="...">...</invoke> or <tool_call name="...">...</tool_call> or <function name="...">...</function>
  const invokeBlockRegex =
    /<(?:invoke|tool_call|function_call|function)(?:\s+name=[\"']([^\"']+)[\"'])?>([\s\S]*?)<\/(?:invoke|tool_call|function_call|function)>/gi;
  match = invokeBlockRegex.exec(text);
  while (match !== null) {
    const rawName = match[1]?.trim() || "";
    const body = match[2] ?? "";
    
    // Check if name is embedded at start of body (e.g. <tool_call>bash\n<arg_key>...)
    let name = rawName;
    let paramBody = body;
    if (!name) {
      const nameMatch = /^([a-zA-Z0-9_\-]+)\s*/.exec(body.trim());
      if (nameMatch && nameMatch[1]) {
        name = nameMatch[1];
        paramBody = body.trim().slice(name.length);
      } else {
        name = "unknown";
      }
    }

    const args = parseXmlParameters(paramBody);
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

  // 4. Unadorned GLM tool calls: name<arg_key>k</arg_key><arg_value>v</arg_value>
  const unadornedGlmRegex =
    /([a-zA-Z0-9_\-]+)\s*(<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>)+/gi;
  match = unadornedGlmRegex.exec(text);
  while (match !== null) {
    const name = match[1]?.trim() ?? "unknown";
    const body = match[0].slice(name.length);
    const args = parseXmlParameters(body);

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

  text = stripLingLeakedTemplateTags(text);

  return {
    cleanText: text,
    toolCalls: Object.freeze(toolCalls),
    reasoningContent,
  };
}

/**
 * Dedicated 1-to-1 Ling SSE Streaming Transformer
 * Buffers tool call XML until closing tag and maps 1:1 into OpenAI tool_calls delta.
 * Passes regular text through untouched byte-for-byte.
 */
export function createLingStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  let buffer = "";
  let insideToolCall = false;
  const toolCallId = `call_lg_${Date.now()}`;

  return new TransformStream({
    transform(chunk, controller) {
      const text = textDecoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "data: [DONE]") {
          if (insideToolCall && buffer.length > 0) {
            const { toolCalls } = parseLingXml(buffer);
            const tc = toolCalls[0];
            if (tc) {
              const delta = {
                id: toolCallId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "ling",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: tc.id,
                          type: "function",
                          function: tc.function,
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
            }
            buffer = "";
            insideToolCall = false;
          }
          controller.enqueue(textEncoder.encode("data: [DONE]\n\n"));
          continue;
        }

        if (!trimmed.startsWith("data: ")) {
          controller.enqueue(textEncoder.encode(`${line}\n`));
          continue;
        }

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            id?: string;
            model?: string;
            choices?: Array<{
              delta?: { content?: string | null; reasoning_content?: string | null };
              finish_reason?: string | null;
            }>;
          };

          const choice = json.choices?.[0];
          const content = choice?.delta?.content;

          if (typeof content === "string") {
            // Check if tool call starts
            if (
              !insideToolCall &&
              (/<tool_calls>|<tool_call>|<invoke|<function=/i.test(content) ||
                /<(?:arg_key|parameter)/i.test(content))
            ) {
              insideToolCall = true;
              buffer += content;
            } else if (insideToolCall) {
              buffer += content;
              // Check if tool call block ends
              if (
                /<\/(?:tool_calls|tool_call|invoke|function)>\s*$/i.test(buffer) ||
                /<\/tool_calls>/i.test(buffer)
              ) {
                const { toolCalls, reasoningContent } = parseLingXml(buffer);
                const tc = toolCalls[0];
                if (tc) {
                  const delta = {
                    id: json.id || toolCallId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: json.model || "ling",
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: tc.id,
                              type: "function",
                              function: tc.function,
                            },
                          ],
                          reasoning_content: reasoningContent,
                        },
                        finish_reason: "tool_calls",
                      },
                    ],
                  };
                  controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                }
                buffer = "";
                insideToolCall = false;
              }
            } else {
              // Regular text delta - 100% untouched passthrough
              controller.enqueue(textEncoder.encode(`${trimmed}\n\n`));
            }
          } else {
            // Non-content deltas (e.g. reasoning_content, finish_reason) pass straight through
            controller.enqueue(textEncoder.encode(`${trimmed}\n\n`));
          }
        } catch {
          controller.enqueue(textEncoder.encode(`${trimmed}\n\n`));
        }
      }
    },
    flush(controller) {
      if (insideToolCall && buffer.length > 0) {
        const { toolCalls } = parseLingXml(buffer);
        const tc = toolCalls[0];
        if (tc) {
          const delta = {
            id: toolCallId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "ling",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: tc.id,
                      type: "function",
                      function: tc.function,
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          };
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
        }
      }
    },
  });
}
