/**
 * eval/anthropic_bridge.ts
 *
 * Client-side protocol bridge for the eval harness: converts OpenAI Chat
 * Completions payloads/responses to/from Anthropic Messages so the existing
 * stage graders (which parse `choices[0].message`) can run unmodified against
 * a gateway Anthropic wire (`/v1/messages`, directive lr-zn-cl-ms-no).
 *
 * Contract (verified against LiteRouter live gateway 2026-09-17):
 * - Requests:  toAnthropicRequest() maps system, messages (incl. tool
 *              results), tools, tool_choice, images, temperature, max_tokens.
 * - Responses: fromAnthropicResponse() maps content blocks (text + tool_use),
 *              stop_reason and usage back into OpenAI shapes.
 * - Streaming: anthropicDeltaToOpenAiChunk() is a STATEFUL per-block converter
 *              (call with the evolving mapper state); it emits OpenAI-style
 *              delta chunks WITHOUT buffering the stream. Callers keep their
 *              real-TTFT SSE loops; only the per-event translation differs.
 */

export interface AnthropicBridgeOptions {
  /** Fallback max_tokens when the OpenAI body omits it (Anthropic requires it). */
  defaultMaxTokens?: number;
}

interface OpenAiContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

function systemTextFromOpenAi(body: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const top = body.system;
  if (typeof top === "string" && top.trim()) {
    parts.push(top);
  } else if (Array.isArray(top)) {
    for (const p of top as OpenAiContentPart[]) {
      if (typeof p?.text === "string") parts.push(p.text);
    }
  }
  const messages = Array.isArray(body.messages) ? (body.messages as OpenAiMessage[]) : [];
  for (const m of messages) {
    if (m?.role === "system") {
      if (typeof m.content === "string") parts.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const p of m.content as OpenAiContentPart[]) {
          if (typeof p?.text === "string") parts.push(p.text);
        }
      }
    }
  }
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : undefined;
}

function mapContentParts(
  content: unknown
): Array<Record<string, unknown>> | string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content as OpenAiContentPart[]) {
    if (part?.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part?.type === "image_url") {
      const url = part.image_url?.url ?? "";
      const dataUri = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(url);
      if (dataUri) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: dataUri[1], data: url.slice(dataUri[0].length) },
        });
      } else if (url.startsWith("http")) {
        blocks.push({ type: "image", source: { type: "url", url } });
      }
    }
  }
  return blocks;
}

function mapTools(body: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const mapped: Array<Record<string, unknown>> = [];
  for (const t of tools as Array<Record<string, any>>) {
    const fn = t?.function ?? t;
    if (!fn?.name) continue;
    mapped.push({
      name: String(fn.name),
      description: typeof fn.description === "string" ? fn.description : "",
      input_schema: fn.parameters ?? fn.input_schema ?? { type: "object", properties: {} },
    });
  }
  return mapped.length > 0 ? mapped : undefined;
}

function mapToolChoice(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const tc = body.tool_choice;
  if (tc == null) return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (tc === "none") return undefined;
  if (typeof tc === "object" && tc !== null) {
    const fn = (tc as Record<string, any>).function;
    if (fn?.name) return { type: "tool", name: String(fn.name) };
  }
  return undefined;
}

function mapNonSystemMessages(
  body: Record<string, unknown>
): Array<Record<string, unknown>> {
  const messages = Array.isArray(body.messages) ? (body.messages as OpenAiMessage[]) : [];
  const mapped: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const role = m?.role;
    if (!role || role === "system") continue;

    if (role === "tool") {
      // OpenAI tool result → user turn with tool_result block
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as OpenAiContentPart[])
                .filter((p) => typeof p?.text === "string")
                .map((p) => p.text as string)
                .join("\n")
            : "";
      const last = messages.at(-1) === m;
      void last;
      const block: Record<string, unknown> = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "unknown",
        content: text,
      };
      const prev = messages[messages.indexOf(m) - 1];
      const prevRole = prev?.role;
      // Consecutive tool messages merge into one user turn when possible.
      const prior = mapped.at(-1) as { role?: string; content?: unknown } | undefined;
      if (
        prevRole === "tool" &&
        prior &&
        prior.role === "user" &&
        Array.isArray(prior.content)
      ) {
        (prior.content as Array<Record<string, unknown>>).push(block);
      } else {
        mapped.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (typeof m.content === "string" && m.content.length > 0) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const call of m.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.function?.arguments ?? "{}") as unknown;
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: call.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: call.function?.name ?? "",
          input,
        });
      }
      mapped.push({ role: "assistant", content: blocks });
      continue;
    }

    mapped.push({ role: role === "assistant" ? "assistant" : "user", content: mapContentParts(m.content) });
  }
  return mapped;
}

export function toAnthropicRequest(
  openAiBody: Record<string, unknown>,
  options: AnthropicBridgeOptions = {}
): Record<string, unknown> {
  const system = systemTextFromOpenAi(openAiBody);
  const out: Record<string, unknown> = {
    model: openAiBody.model,
    max_tokens:
      (openAiBody.max_tokens as number | undefined) ??
      (openAiBody.max_completion_tokens as number | undefined) ??
      options.defaultMaxTokens ??
      4096,
    messages: mapNonSystemMessages(openAiBody),
  };
  if (system) out.system = system;
  const tools = mapTools(openAiBody);
  if (tools) out.tools = tools;
  const toolChoice = mapToolChoice(openAiBody);
  if (toolChoice) out.tool_choice = toolChoice;
  if (typeof openAiBody.temperature === "number") out.temperature = openAiBody.temperature;
  if (openAiBody.stream === true) out.stream = true;
  if (Array.isArray(openAiBody.stop)) out.stop_sequences = openAiBody.stop;
  else if (typeof openAiBody.stop === "string") out.stop_sequences = [openAiBody.stop];
  return out;
}

const STOP_REASON_MAP: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

export function fromAnthropicResponse(
  anthropicJson: unknown,
  fallbackModel: string
): Record<string, unknown> {
  const body = (anthropicJson ?? {}) as Record<string, any>;
  const blocks: Array<Record<string, any>> = Array.isArray(body.content) ? body.content : [];
  let text = "";
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const b of blocks) {
    if (b?.type === "text" && typeof b.text === "string") text += b.text;
    else if (b?.type === "tool_use") {
      toolCalls.push({
        id: b.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  const message: Record<string, unknown> = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  const thinking = blocks
    .filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking as string)
    .join("");
  if (thinking) message.reasoning_content = thinking;
  const usageIn = (body.usage ?? {}) as Record<string, number>;
  const usage = {
    prompt_tokens: usageIn.input_tokens ?? 0,
    completion_tokens: usageIn.output_tokens ?? 0,
    total_tokens: (usageIn.input_tokens ?? 0) + (usageIn.output_tokens ?? 0),
  };
  return {
    id: typeof body.id === "string" ? body.id : "msg_bridge",
    object: "chat.completion",
    model: typeof body.model === "string" ? body.model : fallbackModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: STOP_REASON_MAP[body.stop_reason ?? "end_turn"] ?? "stop",
      },
    ],
    usage,
  };
}

export interface AnthropicSseState {
  /** Anthropic block index → OpenAI tool_call index (tool blocks only). */
  readonly toolIndexByBlock: Map<number, number>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  blockTypes: Map<number, string>;
}

export function createAnthropicSseState(): AnthropicSseState {
  return {
    toolIndexByBlock: new Map(),
    blockTypes: new Map(),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Translates one Anthropic SSE event object into 0..n OpenAI chat chunk(s).
 * Stateless callers must create state via createAnthropicSseState() and reuse
 * it for the lifetime of the stream.
 */
export function anthropicDeltaToOpenAiChunks(
  event: Record<string, any>,
  state: AnthropicSseState
): Array<Record<string, any>> {
  const type = event?.type as string | undefined;
  const chunks: Array<Record<string, any>> = [];

  if (type === "message_start") {
    const u = event.message?.usage ?? {};
    state.usage.prompt_tokens = u.input_tokens ?? 0;
  } else if (type === "content_block_start") {
    const index = Number(event.index ?? 0);
    const block = event.content_block ?? {};
    state.blockTypes.set(index, block.type);
    if (block.type === "tool_use") {
      const toolIndex = state.toolIndexByBlock.size;
      state.toolIndexByBlock.set(index, toolIndex);
      chunks.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: toolIndex,
                  id: block.id,
                  type: "function",
                  function: { name: block.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
  } else if (type === "content_block_delta") {
    const index = Number(event.index ?? 0);
    const delta = event.delta ?? {};
    const blockType = state.blockTypes.get(index);
    if (delta.text) {
      chunks.push({
        choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
      });
    } else if (delta.thinking) {
      chunks.push({
        choices: [{ index: 0, delta: { reasoning_content: delta.thinking }, finish_reason: null }],
      });
    } else if (delta.partial_json && blockType === "tool_use") {
      const toolIndex = state.toolIndexByBlock.get(index) ?? 0;
      chunks.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: toolIndex, function: { arguments: delta.partial_json } }],
            },
            finish_reason: null,
          },
        ],
      });
    }
  } else if (type === "message_delta") {
    if (event.usage?.output_tokens != null) {
      state.usage.completion_tokens = event.usage.output_tokens;
      state.usage.total_tokens = state.usage.prompt_tokens + state.usage.completion_tokens;
    }
    const reason = STOP_REASON_MAP[event.delta?.stop_reason ?? "end_turn"] ?? "stop";
    chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: reason }], usage: { ...state.usage } });
  }

  return chunks;
}

/**
 * Installs a global fetch hook that transparently bridges OpenAI-shaped eval
 * requests to the Anthropic Messages wire. Active only while
 * ANTHROPIC_EVAL_MODE=1 is set. Native Anthropic requests are detected by the
 * `x-api-key` header and pass through untranslated (stage 1 native subtest).
 * Streaming responses are translated event-by-event with real line framing —
 * no buffering.
 */
export function installAnthropicBridge(defaultMaxTokens = 4096): void {
  const g = globalThis as unknown as {
    __anthropicBridgeInstalled?: boolean;
    __nativeFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
  if (g.__anthropicBridgeInstalled) return;
  g.__anthropicBridgeInstalled = true;
  const nativeFetch = g.fetch;
  g.__nativeFetch = nativeFetch;

  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : "";

    if (headers.has("x-api-key") || !rawUrl.includes("messages")) {
      return nativeFetch(input, init); // native Anthropic caller or non-messages wire — leave as-is
    }
    const rawBody = typeof init?.body === "string" ? init.body : "";
    let openAiBody: Record<string, unknown> = {};
    try {
      openAiBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return nativeFetch(input, init);
    }
    const isStream = openAiBody.stream === true;
    const anthropicBody = toAnthropicRequest(openAiBody, { defaultMaxTokens });

    const response = await nativeFetch(input, { ...init, body: JSON.stringify(anthropicBody) });

    if (!isStream) {
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(fromAnthropicResponse(json, String(openAiBody.model ?? ""))), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!response.ok || !response.body) {
      const text = await response.text();
      return new Response(text, { status: response.status, headers: { "Content-Type": "application/json" } });
    }
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const sseState = createAnthropicSseState();
    let carry = "";
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          carry += decoder.decode(chunk, { stream: true });
          const lines = carry.split("\n");
          carry = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const event = JSON.parse(data) as Record<string, any>;
              for (const oaChunk of anthropicDeltaToOpenAiChunks(event, sseState)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(oaChunk)}\n\n`));
              }
            } catch (_err) {
              void _err;
            }
          }
        },
        flush(controller) {
          if (carry.trim().startsWith("data: ")) {
            const data = carry.trim().slice(6).trim();
            if (data && data !== "[DONE]") {
              try {
                const event = JSON.parse(data) as Record<string, any>;
                for (const oaChunk of anthropicDeltaToOpenAiChunks(event, sseState)) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(oaChunk)}\n\n`));
                }
              } catch (_err) {
                void _err;
              }
            }
          }
        },
      })
    );
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

/**
 * Restores the global fetch function if the Anthropic bridge was installed.
 */
export function uninstallAnthropicBridge(): void {
  const g = globalThis as unknown as {
    __anthropicBridgeInstalled?: boolean;
    __nativeFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
  if (!g.__anthropicBridgeInstalled) return;
  if (g.__nativeFetch) {
    g.fetch = g.__nativeFetch;
    delete g.__nativeFetch;
  }
  g.__anthropicBridgeInstalled = false;
}
