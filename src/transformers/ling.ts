import type {
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIRequestPayload,
  OpenAIContentPart,
} from "./nuances";

export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface LingParseResult {
  readonly cleanText: string;
  readonly toolCalls: readonly OpenAIToolCall[];
  readonly reasoningContent?: string;
}

export interface OpenAIResponseChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    reasoning_content?: string;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIResponseChoice[];
  usage?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. REGEX ENGINE
// ---------------------------------------------------------------------------

export const LING_LEAKED_TEMPLATE_REGEX =
  /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>|<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>|<\/?[｜|]?(?:DSML[｜|]?)?(?:tool_calls|tool_call|tool_response|tool_result|arg_key|arg_value|argument_name|argument_value|parameter|parameter_name|parameter_value|invoke|function|think|thought|thinking)[^>]*>|<\|(?:role_end|startoftext|endoftext|im_end|im_start|fim_start|fim_hole|fim_end|start_of_turn|end_of_turn|eot_id|start_header_id|end_header_id)\|>|<[｜|](?:System|User|Assistant|begin of sentence|end of sentence|DSML)[｜|]?>|\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>/gi;

export const LING_STREAM_PARTIAL_TAG_REGEX =
  /<$|<(?:\/|[a-zA-Z_｜|])[a-zA-Z0-9_\-: ='"/｜|]{0,80}$|<\|[^|]{0,40}$|<｜[^｜]{0,40}$|＜｜?[^｜＞]{0,40}$|\[(?:gMASK|\/?INST)[a-zA-Z0-9_\-/]{0,10}$|<<\/?(?:SYS)?[^>]{0,10}$|(?:^|[\n\r\s])(?:edit|write|read|shell|websearch|grep|glob)(?:p|pa|pat|path|c|co|com|comm|comma|comman|command|q|qu|que|quer|query|pattern)?$/i;

export function stripLingLeakedTemplateTags(raw: string): string {
  if (!raw) return "";
  return raw.replace(LING_LEAKED_TEMPLATE_REGEX, "").trim();
}

function generateCallId(): string {
  return `call_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36).substring(4, 8)}`;
}

function castValue(raw: string): unknown {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null") return null;
  if (/^-?\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (!Number.isNaN(num)) return num;
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const num = parseFloat(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err: unknown) {
    void err;
    return trimmed;
  }
}

function extractMessageContentText(content: string | null | readonly OpenAIContentPart[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// 2. REQUEST SERIALIZER (Fixes Upstream 400 Schema Collisions)
// ---------------------------------------------------------------------------

export function transformLingRequest(req: OpenAIRequestPayload): OpenAIRequestPayload {
  const transformed: Record<string, unknown> = { ...req };
  const serializedMessages: OpenAIMessage[] = [];
  const pendingToolResponses: string[] = [];

  const flushToolResponses = () => {
    if (pendingToolResponses.length > 0) {
      serializedMessages.push({
        role: "user",
        content: pendingToolResponses.join("\n\n"),
      });
      pendingToolResponses.length = 0;
    }
  };

  const messages = req.messages ?? [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const isLastTurn = i >= messages.length - 2;

    if (msg.role === "tool") {
      const toolId = msg.tool_call_id || "call_unknown";
      const text = extractMessageContentText(msg.content);
      pendingToolResponses.push(`<tool_response id="${toolId}">\n${text}\n</tool_response>`);
      continue;
    }

    flushToolResponses();

    const cleanMsg: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.name) {
      cleanMsg.name = msg.name;
    }

    // Keep reasoning only on the immediate prior turn to maintain Jinja template health
    if (isLastTurn && msg.reasoning_content) {
      cleanMsg.reasoning_content = msg.reasoning_content;
    }

    // Format assistant tool calls into Ling XML and CRITICALLY DELETE tool_calls field
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      let callXml = "";
      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = typeof tc.function.arguments === "string"
            ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
            : (tc.function.arguments as unknown as Record<string, unknown>);
        } catch (err: unknown) {
          void err;
          args = {};
        }

        callXml += `\n<tool_call>${fnName}`;
        for (const [k, v] of Object.entries(args ?? {})) {
          const valStr = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
          callXml += `<arg_key>${k}</arg_key><arg_value>${valStr}</arg_value>`;
        }
        callXml += `</tool_call>`;
      }

      const baseText = extractMessageContentText(msg.content);
      cleanMsg.content = (baseText + callXml).trim() || " ";
      // DO NOT include tool_calls field; prevents upstream 400 schema error
    }

    serializedMessages.push(cleanMsg as unknown as OpenAIMessage);
  }

  flushToolResponses();

  // Inject tools into System Prompt as Ling XML
  if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
    const toolDefs = req.tools
      .map((t: unknown) => {
        const toolObj = t as { function?: unknown; [key: string]: unknown };
        return JSON.stringify(toolObj.function ?? toolObj);
      })
      .join("\n");

    const toolSystemPrompt =
      `\n\n# Tools\nYou have access to the following tools:\n<tools>\n` +
      toolDefs +
      `\n</tools>\nTo invoke a tool, output:\n<tool_call>tool_name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>\n\n# Execution Rules\n1. When calling tools, output ONLY the <tool_call> block.\n2. When receiving <tool_response>, analyze the result and continue your task immediately with more tool calls or provide your final response to the user. Do NOT repeat 'continue' or output empty messages.`;

    const sysIdx = serializedMessages.findIndex((m) => m.role === "system");
    if (sysIdx >= 0) {
      const existing = serializedMessages[sysIdx]!;
      const existingContent = extractMessageContentText(existing.content);
      serializedMessages[sysIdx] = {
        ...existing,
        content: (existingContent + toolSystemPrompt).trim(),
      };
    } else {
      serializedMessages.unshift({ role: "system", content: toolSystemPrompt.trim() });
    }
  }

  transformed.messages = serializedMessages;

  // CRITICAL: Strip tools and tool_choice from upstream payload to prevent provider rejection
  delete transformed.tools;
  delete transformed.tool_choice;

  // Do not force <|role_end|> into stop tokens so thinking/tool output is not terminated prematurely
  if (req.stop) {
    transformed.stop = req.stop;
  }

  return transformed as unknown as OpenAIRequestPayload;
}

// ---------------------------------------------------------------------------
// 3. PARSER ENGINE (Multi-dialect XML -> OpenAIToolCall[])
// ---------------------------------------------------------------------------

export function parseLingXml(rawText: string): LingParseResult {
  const toolCalls: OpenAIToolCall[] = [];
  let remainingText = rawText;

  // 1. Ling-3.0 / GLM <arg_key> & <arg_value> Dialect
  const glmPattern =
    /(?:<tool_call>)?\s*([a-zA-Z0-9_\-]+)\s*(<arg_key>[\s\S]*?<\/arg_value>(?:\s*<arg_key>[\s\S]*?<\/arg_value>)*)\s*(?:<\/tool_call>)?/gi;

  remainingText = remainingText.replace(glmPattern, (fullMatch, fnName, argsBody) => {
    const pairRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
    const argsObj: Record<string, unknown> = {};
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pairRegex.exec(argsBody)) !== null) {
      const k = pMatch[1]!.trim();
      const v = pMatch[2]!.trim();
      argsObj[k] = castValue(v);
    }

    if (Object.keys(argsObj).length > 0) {
      toolCalls.push({
        id: generateCallId(),
        type: "function",
        function: {
          name: fnName.trim().toLowerCase(),
          arguments: JSON.stringify(argsObj),
        },
      });
      return "";
    }
    return fullMatch;
  });

  // 2. Qwen XML (<function=name><parameter=k>v</parameter></function>)
  const qwenPattern = /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;
  remainingText = remainingText.replace(qwenPattern, (_m, fnName, body) => {
    const paramRegex = /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/parameter>/gi;
    const argsObj: Record<string, unknown> = {};
    let pMatch: RegExpExecArray | null;
    while ((pMatch = paramRegex.exec(body)) !== null) {
      argsObj[pMatch[1]!.trim()] = castValue(pMatch[2]!.trim());
    }
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: fnName.trim().toLowerCase(),
        arguments: JSON.stringify(argsObj),
      },
    });
    return "";
  });

  // 3. DeepSeek / MiniMax / DSML / Standard (<invoke name="...">...<parameter name="k">v</parameter></invoke>)
  const invokePattern = /<[｜|]?(?:DSML[｜|]?)?invoke\s+name=["']?([a-zA-Z0-9_\-]+)["']?[^>]*>([\s\S]*?)<\/[｜|]?(?:DSML[｜|]?)?invoke>/gi;
  remainingText = remainingText.replace(invokePattern, (_m, fnName, body) => {
    const paramRegex = /<[｜|]?(?:DSML[｜|]?)?parameter\s+name=["']?([a-zA-Z0-9_\-]+)["']?[^>]*>([\s\S]*?)(?:<\/[｜|]?(?:DSML[｜|]?)?parameter>|(?=<[｜|]?(?:DSML[｜|]?)?parameter)|$)/gi;
    const argsObj: Record<string, unknown> = {};
    let pMatch: RegExpExecArray | null;
    while ((pMatch = paramRegex.exec(body)) !== null) {
      const k = pMatch[1]!.trim();
      let v = pMatch[2]!.trim();
      if (k === "oldString" && v.includes("newString")) {
        const idx = v.indexOf("newString");
        argsObj["oldString"] = v.slice(0, idx).trim();
        argsObj["newString"] = v.slice(idx + "newString".length).trim();
      } else {
        argsObj[k] = castValue(v);
      }
    }
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: fnName.trim().toLowerCase(),
        arguments: JSON.stringify(argsObj),
      },
    });
    return "";
  });

  // 4. JSON tool call (<tool_call>{...}</tool_call>)
  const jsonToolPattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  remainingText = remainingText.replace(jsonToolPattern, (_m, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const name = parsed.name || (parsed.function as Record<string, unknown> | undefined)?.name || "tool";
        const args = parsed.arguments || (parsed.function as Record<string, unknown> | undefined)?.arguments || parsed.parameters || {};
        toolCalls.push({
          id: generateCallId(),
          type: "function",
          function: {
            name: String(name).toLowerCase(),
            arguments: typeof args === "string" ? args : JSON.stringify(args),
          },
        });
        return "";
      }
    } catch (err: unknown) {
      void err;
    }
    return "";
  });

  // 5. Degraded / Tagless Concat Dialects (e.g. websearchquery..., shellcommand..., editpath...)
  const editConcatPattern = /(?:^|[\n\r\s])editpath\s*([^\s\n\r]+?)\s*oldString\s*([\s\S]+?)\s*newString\s*([\s\S]+?)(?:\s*replaceAll\s*(true|false))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(editConcatPattern, (_m, path, oldStr, newStr, replaceAllVal) => {
    const editArgs: Record<string, unknown> = {
      path: path.trim(),
      oldString: oldStr.trim(),
      newString: newStr.trim(),
    };
    if (replaceAllVal) {
      editArgs.replaceAll = replaceAllVal.toLowerCase() === "true";
    }
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: "edit",
        arguments: JSON.stringify(editArgs),
      },
    });
    return "";
  });

  const writeConcatPattern = /(?:^|[\n\r\s])writepath\s*([^\s\n\r]+?)\s*content\s*([\s\S]+?)(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(writeConcatPattern, (_m, path, content) => {
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: "write",
        arguments: JSON.stringify({
          path: path.trim(),
          content: content.trim(),
        }),
      },
    });
    return "";
  });

  const websearchConcatPattern = /(?:^|[\n\r\s])websearchquery\s*([^\n\r]+)/gi;
  remainingText = remainingText.replace(websearchConcatPattern, (_m, query) => {
    const q = query.trim();
    if (q.length > 0) {
      toolCalls.push({
        id: generateCallId(),
        type: "function",
        function: {
          name: "websearch",
          arguments: JSON.stringify({ query: q }),
        },
      });
      return "";
    }
    return _m;
  });

  const shellConcatPattern = /(?:^|[\n\r\s])shellcommand\s*([\s\S]+?)(?:\s*timeout\s*(\d+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(shellConcatPattern, (_m, cmd, timeout) => {
    const c = cmd.trim();
    if (c.length > 0) {
      const shellArgs: Record<string, unknown> = { command: c };
      if (timeout) shellArgs.timeout = parseInt(timeout, 10);
      toolCalls.push({
        id: generateCallId(),
        type: "function",
        function: {
          name: "shell",
          arguments: JSON.stringify(shellArgs),
        },
      });
      return "";
    }
    return _m;
  });

  const readConcatPattern = /(?:^|[\n\r\s])readpath\s*([^\n\r\s]+)(?:\s*offset\s*(\d+))?(?:\s*limit\s*(\d+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(readConcatPattern, (_m, path, offset, limit) => {
    const args: Record<string, unknown> = { path: path.trim() };
    if (offset) args.offset = parseInt(offset, 10);
    if (limit) args.limit = parseInt(limit, 10);
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: "read",
        arguments: JSON.stringify(args),
      },
    });
    return "";
  });

  const grepConcatPattern = /(?:^|[\n\r\s])greppattern\s*([^\n\r]+?)(?:\s*path\s*([^\n\r\s]+))?(?:\s*include\s*([^\n\r\s]+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(grepConcatPattern, (_m, pat, path, include) => {
    const args: Record<string, unknown> = { pattern: pat.trim() };
    if (path) args.path = path.trim();
    if (include) args.include = include.trim();
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: "grep",
        arguments: JSON.stringify(args),
      },
    });
    return "";
  });

  const globConcatPattern = /(?:^|[\n\r\s])globpattern\s*([^\n\r]+?)(?:\s*path\s*([^\n\r\s]+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
  remainingText = remainingText.replace(globConcatPattern, (_m, pat, path) => {
    const args: Record<string, unknown> = { pattern: pat.trim() };
    if (path) args.path = path.trim();
    toolCalls.push({
      id: generateCallId(),
      type: "function",
      function: {
        name: "glob",
        arguments: JSON.stringify(args),
      },
    });
    return "";
  });

  // 6. Extract Thinking (<think>...</think>)
  let reasoningContent: string | undefined = undefined;
  const thinkMatch = /<(?:think|thought|thinking)>([\s\S]*?)(?:<\/(?:think|thought|thinking)>|(?=<(?:tool_calls?|invoke|function=|tool_call))|$)/i.exec(
    remainingText
  );
  if (thinkMatch) {
    const rawThink = (thinkMatch[1] ?? "").trim();
    if (rawThink.length > 0) {
      reasoningContent = rawThink.replace(LING_LEAKED_TEMPLATE_REGEX, "");
    }
    remainingText = remainingText.replace(thinkMatch[0], "");
  }

  // 6. Scrub remaining leaked control tokens
  const cleanText = remainingText.replace(LING_LEAKED_TEMPLATE_REGEX, "").trim();

  return { cleanText, toolCalls, reasoningContent };
}

// ---------------------------------------------------------------------------
// 4. OPENCODE2 SSE STREAM TRANSFORMER (Strict OpenAI Spec)
// ---------------------------------------------------------------------------

export function createLingStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";
  let textBuffer = "";
  let isInThinkTag = false;
  let hasEmittedRole = false;
  let hasEmittedToolCalls = false;
  let hasEmittedFinish = false;
  let toolCallIndex = 0;
  let streamId = `chatcmpl_${Date.now()}`;
  let streamModel = "ling-3.0-flash";
  let streamUsage: Record<string, unknown> | undefined;

  function sse(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function emitRoleHeader(): string {
    if (!hasEmittedRole) {
      hasEmittedRole = true;
      return sse({
        id: streamId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: streamModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
    }
    return "";
  }

  function emitReasoning(reasoning: string): string {
    return sse({
      id: streamId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: streamModel,
      choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
    });
  }

  function emitContent(content: string): string {
    return sse({
      id: streamId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: streamModel,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    });
  }

  /** Emits OpenCode2 compliant tool call chunks (Declaration -> Arguments) */
  function emitToolCallChunks(tc: OpenAIToolCall, index: number): string {
    let out = "";
    // Chunk 1: Tool Call Header
    out += sse({
      id: streamId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: streamModel,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: tc.id,
                type: "function",
                function: { name: tc.function.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    // Chunk 2: Tool Call Arguments Payload
    out += sse({
      id: streamId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: streamModel,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                function: { arguments: tc.function.arguments },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });

    return out;
  }

  function emitFinish(reason: string): string {
    if (!hasEmittedFinish) {
      hasEmittedFinish = true;
      const payload: Record<string, unknown> = {
        id: streamId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: streamModel,
        choices: [{ index: 0, delta: {}, finish_reason: reason }],
      };
      if (streamUsage) payload.usage = streamUsage;
      return sse(payload);
    }
    return "";
  }

  function processChunk(chunkText: string): string {
    textBuffer += chunkText;
    let out = emitRoleHeader();

    // 1. Manage Thinking & Breakout
    if (isInThinkTag) {
      const thinkEndMatch = /<\/(?:think|thought|thinking)>/i.exec(textBuffer);
      const toolBreakoutMatch = /<(?:tool_calls?|tool_call|invoke|function=|\/role>)/i.exec(textBuffer);
      const glmBreakoutMatch = /[a-zA-Z0-9_\-]+\s*<arg_key>/i.exec(textBuffer);

      let breakoutIdx = -1;
      if (toolBreakoutMatch) breakoutIdx = toolBreakoutMatch.index;
      if (glmBreakoutMatch && (breakoutIdx === -1 || glmBreakoutMatch.index < breakoutIdx)) {
        breakoutIdx = glmBreakoutMatch.index;
      }

      if (thinkEndMatch) {
        const thought = textBuffer.slice(0, thinkEndMatch.index);
        textBuffer = textBuffer.slice(thinkEndMatch.index + thinkEndMatch[0].length);
        isInThinkTag = false;
        const clean = thought.replace(LING_LEAKED_TEMPLATE_REGEX, "");
        if (clean) out += emitReasoning(clean);
      } else if (breakoutIdx !== -1) {
        const thought = textBuffer.slice(0, breakoutIdx);
        textBuffer = textBuffer.slice(breakoutIdx);
        isInThinkTag = false;
        const clean = thought.replace(LING_LEAKED_TEMPLATE_REGEX, "");
        if (clean) out += emitReasoning(clean);
      } else {
        const hold = LING_STREAM_PARTIAL_TAG_REGEX.exec(textBuffer);
        if (hold) {
          const emit = textBuffer.slice(0, hold.index);
          textBuffer = textBuffer.slice(hold.index);
          const clean = emit.replace(LING_LEAKED_TEMPLATE_REGEX, "");
          if (clean) out += emitReasoning(clean);
        } else {
          const clean = textBuffer.replace(LING_LEAKED_TEMPLATE_REGEX, "");
          textBuffer = "";
          if (clean) out += emitReasoning(clean);
        }
        return out;
      }
    }

    if (!isInThinkTag) {
      const thinkStart = /<(?:think|thought|thinking)>/i.exec(textBuffer);
      if (thinkStart) {
        const before = textBuffer.slice(0, thinkStart.index);
        textBuffer = textBuffer.slice(thinkStart.index + thinkStart[0].length);
        isInThinkTag = true;
        const clean = before.replace(LING_LEAKED_TEMPLATE_REGEX, "");
        if (clean) out += emitContent(clean);
        return out + processChunk("");
      }
    }

    // 2. Check for Tool Tag Detection and Completion
    const CONCAT_TOOL_START_REGEX = /(?:^|[\n\r\s])(?:editpath|writepath|readpath|shellcommand|websearchquery|greppattern|globpattern)/i;

    const hasToolTagStart =
      /<[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function=|tool_call)/i.test(textBuffer) ||
      /[a-zA-Z0-9_\-]+\s*<arg_key>/i.test(textBuffer) ||
      CONCAT_TOOL_START_REGEX.test(textBuffer);

    const hasToolClosure =
      /<\/[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function|tool_call)>/i.test(textBuffer) ||
      (textBuffer.includes("</arg_value>") && !textBuffer.includes("<arg_key>") && /<\/(?:arg_value)>/i.test(textBuffer));

    if (hasToolTagStart) {
      if (hasToolClosure) {
        const { cleanText, toolCalls, reasoningContent } = parseLingXml(textBuffer);
        textBuffer = "";

        if (reasoningContent) out += emitReasoning(reasoningContent);
        if (cleanText) out += emitContent(cleanText);

        for (const tc of toolCalls) {
          out += emitToolCallChunks(tc, toolCallIndex);
          toolCallIndex += 1;
          hasEmittedToolCalls = true;
        }
        return out;
      }

      // If tool tag has started but not closed, emit any leading non-tool text and hold the rest
      const tagMatch = /<[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function=|tool_call)/i.exec(textBuffer);
      const glmMatch = /[a-zA-Z0-9_\-]+\s*<arg_key>/i.exec(textBuffer);
      const concatMatch = CONCAT_TOOL_START_REGEX.exec(textBuffer);
      let earliest = -1;
      if (tagMatch) earliest = tagMatch.index;
      if (glmMatch && (earliest === -1 || glmMatch.index < earliest)) earliest = glmMatch.index;
      if (concatMatch && (earliest === -1 || concatMatch.index < earliest)) earliest = concatMatch.index;

      if (earliest > 0) {
        const lead = textBuffer.slice(0, earliest);
        textBuffer = textBuffer.slice(earliest);
        const clean = lead.replace(LING_LEAKED_TEMPLATE_REGEX, "");
        if (clean) out += emitContent(clean);
      }
      // Hold remainder in textBuffer until closure or flushPending
      return out;
    }

    // 3. Safe Text Streaming (Buffers ONLY actual partial tag suffixes)
    const partialMatch = LING_STREAM_PARTIAL_TAG_REGEX.exec(textBuffer);
    if (partialMatch) {
      const emit = textBuffer.slice(0, partialMatch.index);
      textBuffer = textBuffer.slice(partialMatch.index);
      const clean = emit.replace(LING_LEAKED_TEMPLATE_REGEX, "");
      if (clean) out += emitContent(clean);
    } else {
      const clean = textBuffer.replace(LING_LEAKED_TEMPLATE_REGEX, "");
      textBuffer = "";
      if (clean) out += emitContent(clean);
    }

    return out;
  }

  function flushPending(): string {
    let out = "";
    if (textBuffer.length > 0) {
      const { cleanText, toolCalls, reasoningContent } = parseLingXml(textBuffer);
      textBuffer = "";
      if (reasoningContent) out += emitReasoning(reasoningContent);
      if (cleanText) out += emitContent(cleanText);
      for (const tc of toolCalls) {
        out += emitToolCallChunks(tc, toolCallIndex);
        toolCallIndex += 1;
        hasEmittedToolCalls = true;
      }
    }
    return out;
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (trimmed === "data: [DONE]") {
          const pending = flushPending();
          if (pending) controller.enqueue(encoder.encode(pending));
          const finishReason = hasEmittedToolCalls ? "tool_calls" : "stop";
          const finishSse = emitFinish(finishReason);
          if (finishSse) controller.enqueue(encoder.encode(finishSse));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.id) streamId = data.id;
            if (data.model) streamModel = data.model;
            if (data.usage) streamUsage = data.usage;

            const choice = data.choices?.[0];
            const content = choice?.delta?.content;
            const reasoning = choice?.delta?.reasoning_content;
            const toolCalls = choice?.delta?.tool_calls;
            const incomingFinishReason = choice?.finish_reason;

            if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
              hasEmittedToolCalls = true;
              controller.enqueue(encoder.encode(line + "\n\n"));
              continue;
            }

            if (typeof reasoning === "string" && reasoning.length > 0) {
              controller.enqueue(encoder.encode(emitReasoning(reasoning)));
            }

            if (typeof content === "string" && content.length > 0) {
              const processed = processChunk(content);
              if (processed) controller.enqueue(encoder.encode(processed));
            }

            if (incomingFinishReason) {
              const pending = flushPending();
              if (pending) controller.enqueue(encoder.encode(pending));
              const finishReason = hasEmittedToolCalls || incomingFinishReason === "tool_calls" ? "tool_calls" : incomingFinishReason;
              const finishSse = emitFinish(finishReason);
              if (finishSse) controller.enqueue(encoder.encode(finishSse));
            }
          } catch (err: unknown) {
            void err;
            // Keep raw non-JSON SSE lines
            controller.enqueue(encoder.encode(line + "\n"));
          }
        }
      }
    },
    flush(controller) {
      const pending = flushPending();
      if (pending) controller.enqueue(encoder.encode(pending));
      const finishReason = hasEmittedToolCalls ? "tool_calls" : "stop";
      const finishSse = emitFinish(finishReason);
      if (finishSse) controller.enqueue(encoder.encode(finishSse));
      if (lineBuffer.length > 0) controller.enqueue(encoder.encode(lineBuffer));
    },
  });
}

// ---------------------------------------------------------------------------
// 5. NON-STREAMING RESPONSE HANDLER
// ---------------------------------------------------------------------------

export function transformLingResponse(rawResponse: OpenAIResponse | Record<string, unknown>): OpenAIResponse {
  const resp = rawResponse as OpenAIResponse;
  const choice = resp.choices?.[0];
  if (!choice) return resp;

  const rawText = choice.message.content || "";
  const { cleanText, toolCalls, reasoningContent } = parseLingXml(rawText);

  const modifiedChoice: OpenAIResponseChoice = {
    ...choice,
    message: {
      ...choice.message,
      content: cleanText.length > 0 ? cleanText : null,
      reasoning_content: reasoningContent,
      tool_calls: toolCalls.length > 0 ? (toolCalls as OpenAIToolCall[]) : undefined,
    },
    finish_reason: toolCalls.length > 0 ? "tool_calls" : choice.finish_reason || "stop",
  };

  return {
    ...resp,
    choices: [modifiedChoice],
  };
}
