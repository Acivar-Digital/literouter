import type { OpenAIRequestPayload } from "./nuances";

export interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface ResponsesOutputItem {
  id?: string;
  type: string;
  status?: string;
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    annotations?: unknown[];
    logprobs?: unknown[];
  }>;
  encrypted_content?: string;
  summary?: unknown[];
}

export interface ResponsesResponsePayload {
  id: string;
  object?: string;
  created_at?: number;
  completed_at?: number;
  status?: string;
  model?: string;
  output?: ResponsesOutputItem[];
  output_text?: string;
  usage?: ResponsesUsage;
  cost?: string;
  error?: unknown;
}

export interface OpenAIChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    reasoning_content?: string;
  };
  finish_reason: string;
}

export interface OpenAIChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

/**
 * Transforms an OpenAI chat completions payload into a Responses API payload.
 */
export function transformOpenAiToResponses(
  payload: OpenAIRequestPayload | Record<string, unknown>
): Record<string, unknown> {
  const model = typeof payload.model === "string" ? payload.model : "";
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  const input = messages.map((m) => {
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content
        .map((part: unknown) => {
          if (typeof part === "object" && part !== null && "text" in part) {
            return String((part as { text?: unknown }).text ?? "");
          }
          return "";
        })
        .join("");
    }
    return {
      role: m.role || "user",
      content,
    };
  });

  const responsesPayload: Record<string, unknown> = {
    model,
    input,
  };

  if (typeof payload.stream === "boolean") {
    responsesPayload.stream = payload.stream;
  }
  if (typeof payload.temperature === "number") {
    responsesPayload.temperature = payload.temperature;
  }
  if (typeof payload.top_p === "number") {
    responsesPayload.top_p = payload.top_p;
  }
  if (typeof payload.max_tokens === "number") {
    responsesPayload.max_output_tokens = payload.max_tokens;
  }
  if (typeof payload.reasoning_effort === "string") {
    responsesPayload.reasoning = { effort: payload.reasoning_effort };
  }

  return responsesPayload;
}

/**
 * Transforms a Responses API non-streaming JSON response into standard OpenAI chat.completion format.
 */
export function transformResponsesToOpenAi(
  responsesObj: Record<string, unknown>,
  requestedModel?: string
): OpenAIChatCompletion {
  const id = typeof responsesObj.id === "string" ? responsesObj.id : `resp_${Date.now()}`;
  const created = typeof responsesObj.created_at === "number"
    ? responsesObj.created_at
    : Math.floor(Date.now() / 1000);
  const model = (typeof responsesObj.model === "string" && responsesObj.model)
    ? responsesObj.model
    : (requestedModel || "unknown");

  let contentText = "";
  if (typeof responsesObj.output_text === "string") {
    contentText = responsesObj.output_text;
  } else if (Array.isArray(responsesObj.output)) {
    for (const item of responsesObj.output as ResponsesOutputItem[]) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && typeof part.text === "string") {
            contentText += part.text;
          } else if (typeof part.text === "string") {
            contentText += part.text;
          }
        }
      }
    }
  }

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let reasoningTokens: number | undefined;

  if (responsesObj.usage && typeof responsesObj.usage === "object") {
    const u = responsesObj.usage as ResponsesUsage;
    promptTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
    completionTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
    totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;

    if (u.output_tokens_details && typeof u.output_tokens_details.reasoning_tokens === "number") {
      reasoningTokens = u.output_tokens_details.reasoning_tokens;
    }
  }

  const result: OpenAIChatCompletion = {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: contentText,
        },
        finish_reason: "stop",
      },
    ],
  };

  if (responsesObj.usage) {
    result.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
    };
  }

  return result;
}

/**
 * Creates a TransformStream that converts an incoming SSE stream from Responses API
 * to standard OpenAI chat.completion.chunk SSE stream.
 */
export function createResponsesStreamTransformer(
  requestedModel?: string
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let lineBuffer = "";
  let currentEvent = "";
  let streamId = `chatcmpl_${Date.now()}`;
  let streamModel = requestedModel || "unknown";
  let streamCreated = Math.floor(Date.now() / 1000);
  let hasEmittedRole = false;
  let hasEmittedFinish = false;

  function sse(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function emitRoleHeader(): string {
    if (!hasEmittedRole) {
      hasEmittedRole = true;
      return sse({
        id: streamId,
        object: "chat.completion.chunk",
        created: streamCreated,
        model: streamModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
    }
    return "";
  }

  function emitContentDelta(text: string): string {
    let out = emitRoleHeader();
    out += sse({
      id: streamId,
      object: "chat.completion.chunk",
      created: streamCreated,
      model: streamModel,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    });
    return out;
  }

  function emitFinish(usage?: ResponsesUsage): string {
    if (hasEmittedFinish) return "";
    hasEmittedFinish = true;
    let out = emitRoleHeader();

    const chunk: Record<string, unknown> = {
      id: streamId,
      object: "chat.completion.chunk",
      created: streamCreated,
      model: streamModel,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };

    if (usage && typeof usage === "object") {
      const promptTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
      const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;

      chunk.usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
      };
    }

    out += sse(chunk);
    out += "data: [DONE]\n\n";
    return out;
  }

  function handleSseMessage(event: string, dataStr: string): string {
    if (!dataStr || dataStr.trim() === "[DONE]") {
      return emitFinish();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return "";
    }

    const eventType = event || (typeof parsed.type === "string" ? parsed.type : "");

    if (eventType === "response.created" || eventType === "response.in_progress") {
      const resp = parsed.response as Record<string, unknown> | undefined;
      if (resp) {
        if (typeof resp.id === "string") streamId = resp.id;
        if (typeof resp.model === "string") streamModel = resp.model;
        if (typeof resp.created_at === "number") streamCreated = resp.created_at;
      }
      return "";
    }

    if (eventType === "response.output_text.delta") {
      const delta = typeof parsed.delta === "string" ? parsed.delta : "";
      if (delta) {
        return emitContentDelta(delta);
      }
      return "";
    }

    if (eventType === "response.completed") {
      const resp = parsed.response as Record<string, unknown> | undefined;
      if (resp) {
        if (typeof resp.id === "string") streamId = resp.id;
        if (typeof resp.model === "string") streamModel = resp.model;
        if (typeof resp.created_at === "number") streamCreated = resp.created_at;
        return emitFinish(resp.usage as ResponsesUsage | undefined);
      }
      return emitFinish();
    }

    return "";
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith("event:")) {
          currentEvent = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          const dataStr = line.slice("data:".length).trim();
          const out = handleSseMessage(currentEvent, dataStr);
          if (out) {
            controller.enqueue(encoder.encode(out));
          }
          currentEvent = "";
        } else if (line === "") {
          currentEvent = "";
        }
      }
    },
    flush(controller) {
      if (lineBuffer.trim().length > 0) {
        const line = lineBuffer.trim();
        if (line.startsWith("data:")) {
          const dataStr = line.slice("data:".length).trim();
          const out = handleSseMessage(currentEvent, dataStr);
          if (out) controller.enqueue(encoder.encode(out));
        }
      }
      if (!hasEmittedFinish) {
        const out = emitFinish();
        if (out) controller.enqueue(encoder.encode(out));
      }
    },
  });
}
