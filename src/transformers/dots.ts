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
      /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(body)) !== null) {
      const paramName = paramMatch[1].trim();
      let paramValue = paramMatch[2];

      if (paramValue.startsWith("\n")) paramValue = paramValue.substring(1);
      if (paramValue.endsWith("\n"))
        paramValue = paramValue.substring(0, paramValue.length - 1);

      try {
        args[paramName] = JSON.parse(paramValue);
      } catch {
        args[paramName] = paramValue;
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

export function transformDotsNonStreaming(data: any): any {
  if (!data?.choices?.length) return data;
  const message = data.choices[0].message;
  if (!message || typeof message.content !== "string") return data;

  const content = message.content;
  if (!content.includes("<dots_function_call>")) return data;

  const toolCalls = parseDotsXml(content);
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    const cleanedContent = content
      .replace(/<dots_function_call>[\s\S]*?<\/dots_function_call>/gi, "")
      .trim();
    message.content = cleanedContent.length > 0 ? cleanedContent : null;
  }

  return data;
}

export function createDotsStreamTransformer(): TransformStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let lineBuffer = "";
  let textBuffer = "";
  let insideDotsBlock = false;
  let dotsBlockBuffer = "";
  let toolIndex = 0;

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
            const delta = json.choices?.[0]?.delta;

            if (delta && typeof delta.content === "string") {
              const incoming = delta.content;

              if (!insideDotsBlock) {
                textBuffer += incoming;
                const tagIndex = textBuffer.indexOf("<dots_function_call>");

                if (tagIndex !== -1) {
                  const prefix = textBuffer.substring(0, tagIndex);
                  insideDotsBlock = true;
                  dotsBlockBuffer = textBuffer.substring(tagIndex);
                  textBuffer = "";

                  if (prefix.length > 0) {
                    delta.content = prefix;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
                    );
                  }
                } else {
                  const potentialStart = textBuffer.lastIndexOf("<");
                  if (
                    potentialStart !== -1 &&
                    "<dots_function_call>".startsWith(
                      textBuffer.substring(potentialStart),
                    )
                  ) {
                    const safeToEmit = textBuffer.substring(0, potentialStart);
                    textBuffer = textBuffer.substring(potentialStart);
                    if (safeToEmit.length > 0) {
                      delta.content = safeToEmit;
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
                      );
                    }
                  } else {
                    delta.content = textBuffer;
                    textBuffer = "";
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
                    );
                  }
                }
              } else {
                dotsBlockBuffer += incoming;
                const endTagIndex = dotsBlockBuffer.indexOf(
                  "</dots_function_call>",
                );

                if (endTagIndex !== -1) {
                  const xml = dotsBlockBuffer.substring(
                    0,
                    endTagIndex + "</dots_function_call>".length,
                  );
                  const suffix = dotsBlockBuffer.substring(
                    endTagIndex + "</dots_function_call>".length,
                  );
                  insideDotsBlock = false;
                  dotsBlockBuffer = "";

                  const parsedTools = parseDotsXml(xml);
                  for (const tc of parsedTools) {
                    const toolChunk = {
                      ...json,
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
                        },
                      ],
                    };
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`),
                    );
                  }

                  if (suffix.length > 0) {
                    const suffixChunk = {
                      ...json,
                      choices: [
                        {
                          index: 0,
                          delta: { content: suffix },
                        },
                      ],
                    };
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify(suffixChunk)}\n\n`,
                      ),
                    );
                  }
                }
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
      if (textBuffer.length > 0) {
        const remaining = {
          choices: [{ index: 0, delta: { content: textBuffer } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(remaining)}\n\n`),
        );
        textBuffer = "";
      }

      if (insideDotsBlock && dotsBlockBuffer.length > 0) {
        const parsed = parseDotsXml(dotsBlockBuffer);
        if (parsed.length > 0) {
          for (const tc of parsed) {
            const toolChunk = {
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
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`),
            );
          }
        } else {
          const fallbackChunk = {
            choices: [{ index: 0, delta: { content: dotsBlockBuffer } }],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(fallbackChunk)}\n\n`),
          );
        }
        dotsBlockBuffer = "";
        insideDotsBlock = false;
      }
    },
  });
}
