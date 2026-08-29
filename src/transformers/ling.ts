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
  "<|startoftext|>",
  "<|role_end|>",
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
 * 1-to-1 Parameter XML Parser
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
 * Accurately extracts reasoning (<think>) to reasoning_content,
 * buffers tool calls to delta.tool_calls,
 * and passes text untouched to delta.content without leaking tags.
 */
export function createLingStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  let buffer = "";
  let inThink = false;
  let inToolCall = false;
  const toolCallId = `call_lg_${Date.now()}`;

  function cleanControlTokens(s: string): string {
    return s
      .replace(/\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>/gi, "")
      .replace(/<\|\s*(?:startoftext|endoftext|role_start|role_end|im_start|im_end|start_of_turn|end_of_turn)\s*\|>/gi, "")
      .replace(/<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>/gi, "")
      .replace(/<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>/gi, "");
  }

  return new TransformStream({
    transform(chunk, controller) {
      const text = textDecoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "data: [DONE]") {
          if (inToolCall && buffer.length > 0) {
            const { toolCalls, reasoningContent } = parseLingXml(buffer);
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
                      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
            }
            buffer = "";
            inToolCall = false;
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
          const rawContent = choice?.delta?.content;

          if (typeof rawContent === "string") {
            const content = cleanControlTokens(rawContent);
            buffer += content;

            // Process buffer line by line or token by token
            while (buffer.length > 0) {
              if (!inThink && !inToolCall) {
                // Check if thinking starts
                const thinkOpenIdx = buffer.search(/<(?:think|thought|thinking)>/i);
                const toolOpenIdx = buffer.search(/<(?:tool_calls?|invoke|function=)/i);
                const glmToolOpenIdx = buffer.search(/[a-zA-Z0-9_\-]+\s*<(?:arg_key|parameter)/i);

                let nextTagIdx = -1;
                let isThink = false;
                let isTool = false;

                if (thinkOpenIdx !== -1) {
                  nextTagIdx = thinkOpenIdx;
                  isThink = true;
                }
                if (toolOpenIdx !== -1 && (nextTagIdx === -1 || toolOpenIdx < nextTagIdx)) {
                  nextTagIdx = toolOpenIdx;
                  isThink = false;
                  isTool = true;
                }
                if (glmToolOpenIdx !== -1 && (nextTagIdx === -1 || glmToolOpenIdx < nextTagIdx)) {
                  nextTagIdx = glmToolOpenIdx;
                  isThink = false;
                  isTool = true;
                }

                if (nextTagIdx === -1) {
                  // No tags, pure text!
                  // Check if buffer ends with partial '<' to avoid splitting a tag
                  const partialMatch = /<[a-zA-Z0-9_\-/]*$/.exec(buffer);
                  if (partialMatch) {
                    const emit = buffer.slice(0, partialMatch.index);
                    buffer = buffer.slice(partialMatch.index);
                    if (emit.length > 0) {
                      const delta = {
                        id: json.id || toolCallId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: json.model || "ling",
                        choices: [{ index: 0, delta: { content: emit }, finish_reason: null }],
                      };
                      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                    }
                    break;
                  }
                  // Emit all buffer as text
                  const emit = buffer;
                  buffer = "";
                  if (emit.length > 0) {
                    const delta = {
                      id: json.id || toolCallId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: json.model || "ling",
                      choices: [{ index: 0, delta: { content: emit }, finish_reason: null }],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                } else {
                  // Emit text before the tag
                  if (nextTagIdx > 0) {
                    const emit = buffer.slice(0, nextTagIdx);
                    buffer = buffer.slice(nextTagIdx);
                    const delta = {
                      id: json.id || toolCallId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: json.model || "ling",
                      choices: [{ index: 0, delta: { content: emit }, finish_reason: null }],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                  if (isThink) {
                    const tagMatch = /<(?:think|thought|thinking)>/i.exec(buffer);
                    if (tagMatch) {
                      buffer = buffer.slice(tagMatch[0].length);
                      inThink = true;
                    }
                  } else if (isTool) {
                    inToolCall = true;
                    break; // Stay in inToolCall and accumulate
                  }
                }
              } else if (inThink) {
                // Look for </think> or tool call breakout
                const thinkCloseIdx = buffer.search(/<\/(?:think|thought|thinking)>/i);
                const toolBreakoutIdx = buffer.search(/<(?:tool_calls?|invoke|function=)|[a-zA-Z0-9_\-]+\s*<(?:arg_key|parameter)/i);

                if (thinkCloseIdx !== -1) {
                  const reasoning = buffer.slice(0, thinkCloseIdx);
                  const closeMatch = /<\/(?:think|thought|thinking)>/i.exec(buffer.slice(thinkCloseIdx));
                  buffer = buffer.slice(thinkCloseIdx + (closeMatch ? closeMatch[0].length : 0));
                  inThink = false;

                  if (reasoning.length > 0) {
                    const delta = {
                      id: json.id || toolCallId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: json.model || "ling",
                      choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                } else if (toolBreakoutIdx !== -1) {
                  // Tool call broke out without closing </think>
                  const reasoning = buffer.slice(0, toolBreakoutIdx);
                  buffer = buffer.slice(toolBreakoutIdx);
                  inThink = false;
                  inToolCall = true;

                  if (reasoning.length > 0) {
                    const delta = {
                      id: json.id || toolCallId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: json.model || "ling",
                      choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                  break;
                } else {
                  // Emit reasoning incrementally
                  const partialMatch = /<[a-zA-Z0-9_\-/]*$/.exec(buffer);
                  if (partialMatch) {
                    const emit = buffer.slice(0, partialMatch.index);
                    buffer = buffer.slice(partialMatch.index);
                    if (emit.length > 0) {
                      const delta = {
                        id: json.id || toolCallId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: json.model || "ling",
                        choices: [{ index: 0, delta: { reasoning_content: emit }, finish_reason: null }],
                      };
                      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                    }
                    break;
                  }
                  const emit = buffer;
                  buffer = "";
                  if (emit.length > 0) {
                    const delta = {
                      id: json.id || toolCallId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: json.model || "ling",
                      choices: [{ index: 0, delta: { reasoning_content: emit }, finish_reason: null }],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                }
              } else if (inToolCall) {
                // Buffer until tool call block is closed
                if (
                  /<\/(?:tool_calls|tool_call|invoke|function)>\s*$/i.test(buffer) ||
                  /<\/tool_calls>/i.test(buffer) ||
                  /<\/arg_value>\s*<\/tool_call>/i.test(buffer)
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
                            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                          },
                          finish_reason: "tool_calls",
                        },
                      ],
                    };
                    controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                  }
                  buffer = "";
                  inToolCall = false;
                }
                break;
              }
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
      if (inToolCall && buffer.length > 0) {
        const { toolCalls, reasoningContent } = parseLingXml(buffer);
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
                  ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                },
                finish_reason: "tool_calls",
              },
            ],
          };
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
        }
      } else if (buffer.length > 0) {
        const clean = cleanControlTokens(buffer);
        if (clean.length > 0) {
          const delta = {
            id: toolCallId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "ling",
            choices: [
              {
                index: 0,
                delta: inThink ? { reasoning_content: clean } : { content: clean },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
        }
      }
    },
  });
}
