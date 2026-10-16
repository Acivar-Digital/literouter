import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
} from "../handlers/anthropic_compat";
import type {
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

/**
 * LiteRouter v4.1 Forwarder Contract:
 * Context limits and pruning are managed upstream and by client agents (Oh My Pi, OpenCode, Pydantic AI).
 * The gateway acts as a high-throughput, low-latency forwarder without mutating payloads or slicing messages.
 */
export function sanitizeAnthropicToolReferences(
  messages: readonly AnthropicMessage[]
): AnthropicMessage[] {
  return messages as AnthropicMessage[];
}

export function normalizeAnthropicAlternation(
  messages: readonly AnthropicMessage[]
): AnthropicMessage[] {
  return messages as AnthropicMessage[];
}

export function pruneAnthropicPayload(
  req: AnthropicMessagesRequest,
  _targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
): AnthropicMessagesRequest {
  return req;
}

export function sanitizeOpenAIToolReferences(
  messages: readonly OpenAIMessage[]
): OpenAIMessage[] {
  return messages as OpenAIMessage[];
}

export function pruneOpenAIPayload(
  req: OpenAIRequestPayload,
  _targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
): OpenAIRequestPayload {
  return req;
}
