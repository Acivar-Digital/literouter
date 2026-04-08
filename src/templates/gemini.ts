/**
 * src/templates/gemini.ts
 *
 * Google Gemini Native REST API template.
 * Translates OpenAI-compatible requests to Gemini Native (generateContent)
 * and translates Gemini chunks back to OpenAI format.
 *
 * This "solve all the problem" version uses Google's native schema,
 * which is much more robust for thinking/reasoning features.
 */

import type { ProviderTemplate, ThinkingMode } from "./types.js";

const THINKING_LEVEL_MAP: Record<ThinkingMode, string> = {
  high: "high",
  medium: "medium",
  low: "low",
};

/**
 * Extract plain text from OpenAI message content.
 * Content can be a string OR an array of parts like [{ type: "text", text: "..." }].
 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join("\n");
  }
  return "";
}

export const geminiTemplate: ProviderTemplate = {
  name: "gemini",

  /** Redirects to the native Gemini REST endpoint and appends the API key as a query param. */
  targetUrlCallback(baseUrl: string, body: any, apiKey: string): string {
    const model = body.model || "gemini-2.5-flash";
    const action = body.stream ? "streamGenerateContent" : "generateContent";
    // Ensure we don't have double slashes and no /openai suffix
    const base = baseUrl.replace(/\/openai\/?$/, "").replace(/\/$/, "");
    const sse = body.stream ? "&alt=sse" : "";
    return `${base}/models/${model}:${action}?key=${apiKey}${sse}`;
  },

  /** Removes the Bearer token as Gemini native uses the 'key' query parameter. */
  applyHeaders(headers: Record<string, string>): void {
    delete headers["Authorization"];
  },

  /** Translates OpenAI Request -> Gemini Native Request. */
  transformRequest(body: any, options: { mode: ThinkingMode | null; provider?: string | null }): any {
    const messages = body.messages || [];
    
    // 1. Map messages to Gemini 'contents' and 'systemInstruction'
    const contents: any[] = [];
    const sysParts: any[] = [];
    let lastRole = "";

    for (const m of messages) {
      const text = extractText(m.content);

      if (m.role === "system") {
        sysParts.push({ text });
        continue;
      }
      
      const role = m.role === "assistant" ? "model" : "user";

      if (role === lastRole && contents.length > 0) {
        // Merge with last message
        contents[contents.length - 1].parts[0].text += `\n\n${text}`;
      } else {
        contents.push({
          role,
          parts: [{ text }]
        });
        lastRole = role;
      }
    }

    const systemInstruction = sysParts.length > 0 ? { parts: sysParts } : undefined;

    // 2. Build Gemini config
    const generationConfig: Record<string, any> = {
      temperature: body.temperature ?? 0.7,
      maxOutputTokens: body.max_tokens,
      stopSequences: body.stop,
      topP: body.top_p,
    };

    // 3. Handle Thinking
    if (options.mode) {
      const isGemini25 = (body.model || "").includes("2.5");
      
      if (isGemini25) {
        // Gemini 2.5 uses a numeric thinking_budget (tokens)
        const budgets: Record<ThinkingMode, number> = {
          high: 24576,
          medium: 8192,
          low: 1024,
        };
        generationConfig.thinking_config = {
          thinking_budget: budgets[options.mode],
          include_thoughts: true,
        };
      } else {
        // Gemini 3.0+ uses thinking_level strings
        generationConfig.thinking_config = {
          thinking_level: THINKING_LEVEL_MAP[options.mode],
          include_thoughts: true,
        };
      }
    }

    return {
      contents,
      systemInstruction,
      generationConfig,
    };
  },

  /** Translates Gemini Native Chunk -> OpenAI Delta Chunk. */
  transformChunk(chunk: any, metadata: { model?: string; id?: string }): any {
    const candidate = chunk.candidates?.[0];
    if (!candidate) return null;

    const parts = candidate.content?.parts || [];
    let text = "";
    for (const p of parts) {
      if (p.text) text += p.text;
      // Suppress raw "thought" booleans that leak through in some models
      // if (p.thought) text += `\n<thought>\n${p.thought}\n</thought>\n`;
    }

    const isFinished = candidate.finishReason === "STOP" || candidate.finishReason === "MAX_TOKENS";

    // Always emit a chunk if there's text OR if this is the terminal chunk with finish_reason
    if (!text && !isFinished) return null;

    return {
      id: metadata.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: metadata.model,
      choices: [
        {
          index: 0,
          delta: text ? { content: text } : {},
          finish_reason: isFinished ? "stop" : null,
        }
      ]
    };
  },

  /** Translates full Gemini Native Response -> OpenAI Chat Completion (non-streaming). */
  transformResponse(response: any, metadata: { model?: string; id?: string }): any {
    const candidate = response.candidates?.[0];
    if (!candidate) return null;

    const content = candidate.content?.parts?.[0]?.text || "";

    return {
      id: metadata.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: metadata.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: candidate.finishReason === "STOP" ? "stop" : null,
        }
      ],
      usage: response.usageMetadata ? {
        prompt_tokens: response.usageMetadata.promptTokenCount,
        completion_tokens: response.usageMetadata.candidatesTokenCount,
        total_tokens: response.usageMetadata.totalTokenCount,
      } : undefined,
    };
  },

  /** Not used when transformRequest is present. */
  applyTemplateConfig() {}
};
