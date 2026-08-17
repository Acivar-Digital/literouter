export function isDotsModel(modelName?: string): boolean {
  if (!modelName || typeof modelName !== "string") return false;
  return modelName.toLowerCase().includes("dots");
}

export interface ParsedDotsToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export function parseDotsXml(xml: string): ParsedDotsToolCall[] {
  if (!xml || typeof xml !== "string") return [];
  const results: ParsedDotsToolCall[] = [];

  const invokeRegex = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  let match: RegExpExecArray | null;

  while ((match = invokeRegex.exec(xml)) !== null) {
    const toolName = match[1].trim();
    const body = match[2];
    const args: Record<string, any> = {};

    const paramRegex =
      /<(?:parameter|param|argument|arg)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:parameter|param|argument|arg)>/gi;
    let paramMatch: RegExpExecArray | null;
    let foundParams = false;

    while ((paramMatch = paramRegex.exec(body)) !== null) {
      foundParams = true;
      const paramName = paramMatch[1].trim();
      let paramValue = paramMatch[2];

      paramValue = paramValue.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/g, "$1");

      if (paramValue.startsWith("\n")) paramValue = paramValue.substring(1);
      if (paramValue.endsWith("\n"))
        paramValue = paramValue.substring(0, paramValue.length - 1);

      try {
        args[paramName] = JSON.parse(paramValue);
      } catch {
        args[paramName] = paramValue.trim();
      }
    }

    if (!foundParams && body.trim().startsWith("{") && body.trim().endsWith("}")) {
      try {
        const parsedBody = JSON.parse(body.trim());
        if (typeof parsedBody === "object" && parsedBody !== null) {
          Object.assign(args, parsedBody);
        }
      } catch {
        // ignore
      }
    }

    const randomId = Math.random().toString(36).substring(2, 10);
    results.push({
      id: `call_dots_${randomId}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    });
  }

  return results;
}

export function cleanXmlBlocks(content: string): string {
  return content
    .replace(/<dots_function_call>[\s\S]*?<\/dots_function_call>/gi, "")
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, "")
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, "")
    .replace(/<tools>[\s\S]*?<\/tools>/gi, "")
    .replace(/<invoke\s+name=["'][^"']+["']>[\s\S]*?<\/invoke>/gi, "")
    .trim();
}

export function transformDotsNonStreaming(data: any): any {
  if (!data?.choices?.length) return data;
  const message = data.choices[0].message;
  if (!message || typeof message.content !== "string") return data;

  const content = message.content;
  const toolCalls = parseDotsXml(content);
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    const cleaned = cleanXmlBlocks(content);
    message.content = cleaned.length > 0 ? cleaned : null;
  }

  return data;
}

interface TagPair {
  start: string;
  end: string;
}

const TAG_PAIRS: TagPair[] = [
  { start: "<dots_function_call>", end: "</dots_function_call>" },
  { start: "<tool_calls>", end: "</tool_calls>" },
  { start: "<function_calls>", end: "</function_calls>" },
  { start: "<function_call>", end: "</function_call>" },
  { start: "<tools>", end: "</tools>" },
  { start: "<invoke", end: "</invoke>" },
];

export function createDotsStreamTransformer(): TransformStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let lineBuffer = "";
  let textBuffer = "";
  let insideBlock = false;
  let activeEndTag = "";
  let blockBuffer = "";
  let toolIndex = 0;
  let latestChunkJson: any = null;

  function processIncomingText(
    incoming: string,
    controller: TransformStreamDefaultController,
    baseJson: any,
  ) {
    let pending = incoming;

    while (pending.length > 0) {
      if (!insideBlock) {
        textBuffer += pending;
        pending = "";

        let earliestPos = -1;
        let matchedPair: TagPair | null = null;

        for (const pair of TAG_PAIRS) {
          const pos = textBuffer.indexOf(pair.start);
          if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
            earliestPos = pos;
            matchedPair = pair;
          }
        }

        if (earliestPos !== -1 && matchedPair) {
          const prefix = textBuffer.substring(0, earliestPos);
          insideBlock = true;
          activeEndTag = matchedPair.end;
          blockBuffer = textBuffer.substring(earliestPos);
          textBuffer = "";

          if (prefix.length > 0) {
            const textChunk = {
              ...baseJson,
              choices: [
                {
                  index: 0,
                  delta: { content: prefix },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`),
            );
          }
        } else {
          const lastLessThan = textBuffer.lastIndexOf("<");
          if (lastLessThan !== -1) {
            const potentialTagPrefix = textBuffer.substring(lastLessThan);
            const isPartialMatch = TAG_PAIRS.some((pair) =>
              pair.start.startsWith(potentialTagPrefix),
            );

            if (isPartialMatch) {
              const safeToEmit = textBuffer.substring(0, lastLessThan);
              textBuffer = potentialTagPrefix;
              if (safeToEmit.length > 0) {
                const textChunk = {
                  ...baseJson,
                  choices: [
                    {
                      index: 0,
                      delta: { content: safeToEmit },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`),
                );
              }
            } else {
              const textChunk = {
                ...baseJson,
                choices: [
                  {
                    index: 0,
                    delta: { content: textBuffer },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`),
              );
              textBuffer = "";
            }
          } else {
            const textChunk = {
              ...baseJson,
              choices: [
                {
                  index: 0,
                  delta: { content: textBuffer },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`),
            );
            textBuffer = "";
          }
        }
      } else {
        blockBuffer += pending;
        pending = "";

        const endTagPos = blockBuffer.indexOf(activeEndTag);
        if (endTagPos !== -1) {
          const fullXml = blockBuffer.substring(
            0,
            endTagPos + activeEndTag.length,
          );
          const remaining = blockBuffer.substring(
            endTagPos + activeEndTag.length,
          );

          insideBlock = false;
          activeEndTag = "";
          blockBuffer = "";

          const parsedTools = parseDotsXml(fullXml);
          for (const tc of parsedTools) {
            const toolChunk = {
              ...baseJson,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolIndex++,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`),
            );
          }

          pending = remaining;
        }
      }
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

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

        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          try {
            const json = JSON.parse(dataStr);
            latestChunkJson = json;
            const delta = json.choices?.[0]?.delta;

            if (delta && typeof delta.content === "string") {
              processIncomingText(delta.content, controller, json);
            } else {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
              );
            }
          } catch {
            controller.enqueue(encoder.encode(line + "\n"));
          }
        }
      }
    },
    flush(controller) {
      if (insideBlock && blockBuffer.length > 0) {
        const parsedTools = parseDotsXml(blockBuffer);
        if (parsedTools.length > 0) {
          for (const tc of parsedTools) {
            const toolChunk = {
              ...(latestChunkJson || {}),
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolIndex++,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`),
            );
          }
        } else {
          const fallbackChunk = {
            ...(latestChunkJson || {}),
            choices: [
              {
                index: 0,
                delta: { content: blockBuffer },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(fallbackChunk)}\n\n`),
          );
        }
      }

      if (textBuffer.length > 0) {
        const remainingChunk = {
          ...(latestChunkJson || {}),
          choices: [
            {
              index: 0,
              delta: { content: textBuffer },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(remainingChunk)}\n\n`),
        );
        textBuffer = "";
      }
    },
  });
}
