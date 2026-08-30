import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessagesRequest,
} from "../handlers/anthropic_compat";
import type {
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIRequestPayload,
} from "./nuances";

export const DEFAULT_SAFE_CONTEXT_TOKENS = 180000;
export const DEFAULT_MAX_CONTEXT_TOKENS = 240000;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function estimateAnthropicTokens(req: AnthropicMessagesRequest): number {
  let total = 3;

  if (req.system) {
    total += 4;
    if (typeof req.system === "string") {
      total += estimateTextTokens(req.system);
    } else if (Array.isArray(req.system)) {
      for (const block of req.system) {
        if (typeof block === "string") {
          total += estimateTextTokens(block);
        } else if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          total += estimateTextTokens(block.text);
        }
      }
    }
  }

  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      total += 4;
      if (typeof msg.content === "string") {
        total += estimateTextTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            total += estimateTextTokens(block.text);
          } else if (block.type === "thinking" && block.thinking) {
            total += estimateTextTokens(block.thinking);
          } else if (block.type === "image") {
            total += 1600;
          } else if (block.type === "tool_use") {
            total += 8;
            if (block.name) total += estimateTextTokens(block.name);
            if (block.input) {
              const inputStr = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
              total += estimateTextTokens(inputStr);
            }
          } else if (block.type === "tool_result") {
            total += 8;
            if (typeof block.content === "string") {
              total += estimateTextTokens(block.content);
            } else if (Array.isArray(block.content)) {
              total += estimateTextTokens(JSON.stringify(block.content));
            }
          }
        }
      }
    }
  }

  if (Array.isArray(req.tools)) {
    for (const tool of req.tools) {
      total += 10;
      total += estimateTextTokens(JSON.stringify(tool));
    }
  }

  return total;
}

export function estimateOpenAITokens(req: OpenAIRequestPayload): number {
  let total = 3;

  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      total += 4;
      if (typeof msg.content === "string") {
        total += estimateTextTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            total += estimateTextTokens(part.text);
          } else if (part.type === "image_url") {
            total += 1600;
          }
        }
      }
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        total += 8;
        for (const tc of msg.tool_calls) {
          if (tc.function?.name) total += estimateTextTokens(tc.function.name);
          if (tc.function?.arguments) total += estimateTextTokens(tc.function.arguments);
        }
      }
    }
  }

  if (Array.isArray(req.tools)) {
    for (const tool of req.tools) {
      total += 10;
      total += estimateTextTokens(JSON.stringify(tool));
    }
  }

  return total;
}

export function isContextLengthError(status: number, bodyText: string): boolean {
  if (status !== 400 && status !== 413 && status !== 422) {
    return false;
  }
  const lower = bodyText.toLowerCase();
  return (
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("context_length_exceeded") ||
    lower.includes("maximum context") ||
    lower.includes("prompt is too long") ||
    lower.includes("token count exceeds") ||
    lower.includes("input tokens exceed") ||
    lower.includes("reduce the length of the messages") ||
    lower.includes("too many tokens") ||
    (lower.includes("max_tokens") && lower.includes("exceed"))
  );
}

export function extractContextLimit(text: string): number | null {
  const m1 = text.match(/context length\s*(?:\(|is|\:)?\s*(\d{4,8})\s*tokens?/i);
  if (m1 && m1[1]) return parseInt(m1[1], 10);

  const m2 = text.match(/(?:maximum context length|max context length|limit of|context window\s*\(?)\s*(?:is|\:)?\s*(\d{4,8})/i);
  if (m2 && m2[1]) return parseInt(m2[1], 10);

  const m3 = text.match(/than.*?(\d{4,8})\s*tokens/i);
  if (m3 && m3[1]) return parseInt(m3[1], 10);

  const m4 = text.match(/context window\s*\((\d{4,8})\)/i);
  if (m4 && m4[1]) return parseInt(m4[1], 10);

  return null;
}

export function sanitizeAnthropicToolReferences(
  messages: readonly AnthropicMessage[]
): AnthropicMessage[] {
  const validToolUseIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          validToolUseIds.add(block.id);
        }
      }
    }
  }

  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) {
      return msg;
    }

    let modified = false;
    const sanitizedBlocks: AnthropicContentBlock[] = msg.content.map((block) => {
      if (block.type === "tool_result" && block.tool_use_id && !validToolUseIds.has(block.tool_use_id)) {
        modified = true;
        const rawContent = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
        return {
          type: "text",
          text: `[Pruned tool result (${block.tool_use_id})]:\n${rawContent}`,
        };
      }
      return block;
    });

    return modified ? { ...msg, content: sanitizedBlocks } : msg;
  });
}

export function normalizeAnthropicAlternation(
  messages: readonly AnthropicMessage[]
): AnthropicMessage[] {
  if (messages.length === 0) return [];

  const result: AnthropicMessage[] = [];
  let current: AnthropicMessage = messages[0]!;

  for (let i = 1; i < messages.length; i++) {
    const next = messages[i]!;
    if (next.role === current.role) {
      const currentBlocks = typeof current.content === "string"
        ? [{ type: "text" as const, text: current.content }]
        : [...current.content];
      const nextBlocks = typeof next.content === "string"
        ? [{ type: "text" as const, text: next.content }]
        : [...next.content];
      current = {
        role: current.role,
        content: [...currentBlocks, ...nextBlocks],
      };
    } else {
      result.push(current);
      current = next;
    }
  }
  result.push(current);

  if (result.length > 0 && result[0]!.role !== "user") {
    result.unshift({
      role: "user",
      content: "[Context resumed after truncation]",
    });
  }

  return result;
}

export function pruneAnthropicPayload(
  req: AnthropicMessagesRequest,
  targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
): AnthropicMessagesRequest {
  const currentTokens = estimateAnthropicTokens(req);
  if (currentTokens <= targetLimitTokens || !Array.isArray(req.messages) || req.messages.length <= 2) {
    return req;
  }

  const messages = req.messages;
  let cutoff = 0;

  for (let i = 1; i < messages.length - 1; i++) {
    const candidateSlice = messages.slice(i);
    const candidateReq: AnthropicMessagesRequest = { ...req, messages: candidateSlice };
    const tokens = estimateAnthropicTokens(candidateReq);
    if (tokens <= targetLimitTokens) {
      cutoff = i;
      break;
    }
  }

  if (cutoff === 0 && messages.length > 2) {
    cutoff = Math.max(1, messages.length - 2);
  }

  let prunedMessages: AnthropicMessage[];
  if (cutoff > 1 && messages[0]!.role === "user") {
    const rootUserMsg = messages[0]!;
    const noticeBlock: AnthropicContentBlock = {
      type: "text",
      text: "\n\n[Note: Intermediate conversation history was pruned by LiteRouter to fit within model context limits.]\n\n",
    };

    const augmentedRoot: AnthropicMessage = {
      role: "user",
      content: typeof rootUserMsg.content === "string"
        ? `${rootUserMsg.content}\n\n[Note: Intermediate conversation history was pruned by LiteRouter to fit within model context limits.]`
        : [...rootUserMsg.content, noticeBlock],
    };

    prunedMessages = [augmentedRoot, ...messages.slice(cutoff)];
  } else {
    prunedMessages = [...messages.slice(cutoff)];
  }

  const sanitized = sanitizeAnthropicToolReferences(prunedMessages);
  const normalized = normalizeAnthropicAlternation(sanitized);

  return {
    ...req,
    messages: normalized,
  };
}

export function sanitizeOpenAIToolReferences(
  messages: readonly OpenAIMessage[]
): OpenAIMessage[] {
  const validToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.id) validToolCallIds.add(tc.id);
      }
    }
  }

  return messages.map((msg) => {
    if (msg.role === "tool" && msg.tool_call_id && !validToolCallIds.has(msg.tool_call_id)) {
      return {
        role: "user",
        content: `[Pruned tool result (${msg.tool_call_id})]:\n${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")}`,
      };
    }
    return msg;
  });
}

export function pruneOpenAIPayload(
  req: OpenAIRequestPayload,
  targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
): OpenAIRequestPayload {
  const currentTokens = estimateOpenAITokens(req);
  if (currentTokens <= targetLimitTokens || !Array.isArray(req.messages) || req.messages.length <= 2) {
    return req;
  }

  const messages = req.messages;
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  if (nonSystemMessages.length <= 2) {
    return req;
  }

  let cutoff = 0;
  for (let i = 1; i < nonSystemMessages.length - 1; i++) {
    const candidateSlice = nonSystemMessages.slice(i);
    const candidateReq: OpenAIRequestPayload = {
      ...req,
      messages: [...systemMessages, ...candidateSlice],
    };
    const tokens = estimateOpenAITokens(candidateReq);
    if (tokens <= targetLimitTokens) {
      cutoff = i;
      break;
    }
  }

  if (cutoff === 0 && nonSystemMessages.length > 2) {
    cutoff = Math.max(1, nonSystemMessages.length - 2);
  }

  const retainedNonSystem = nonSystemMessages.slice(cutoff);
  const combined = [...systemMessages, ...retainedNonSystem];
  const sanitized = sanitizeOpenAIToolReferences(combined);

  return {
    ...req,
    messages: sanitized,
  };
}
