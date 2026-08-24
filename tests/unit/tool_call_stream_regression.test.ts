import { describe, expect, it } from "bun:test";
import {
  createOpenCodeReasoningFilterStreamTransformer,
  filterReasoningFromChunk,
} from "../../src/transformers/thinking";
import {
  sanitizeAndTransformPayload,
  scrubReasoningFromMessage,
} from "../../src/transformers/payload";
import {
  executeDirectRequest,
  initializeKeyPools,
} from "../../src/handlers/openai_compat";
import type { DirectDirective } from "../../src/directive/parser";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../src/transformers/nuances";

async function readStreamToSseEvents(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Record<string, unknown>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
          try {
            events.push(JSON.parse(trimmed.slice(5).trim()));
          } catch (err: unknown) {
            void err;
          }
        }
      }
    }
  }

  if (buffer.trim().startsWith("data:") && buffer.trim() !== "data: [DONE]" && buffer.trim() !== "data:[DONE]") {
    try {
      events.push(JSON.parse(buffer.trim().slice(5).trim()));
    } catch (err: unknown) {
      void err;
    }
  }

  return events;
}

describe("Tool Call Stream Regression & Normalization (literouter-28nd)", () => {
  describe("Bug 1: Array-formatted role: 'tool' content normalization", () => {
    it("flattens array content in role: 'tool' message into a valid JSON string", () => {
      const toolMessage: OpenAIMessage = {
        role: "tool",
        tool_call_id: "call_123",
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "ok" }),
          },
        ] as unknown as string,
      };

      const payload: OpenAIRequestPayload = {
        model: "stealth/ox-alpha",
        messages: [
          {
            role: "user",
            content: "Run status check",
          },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "check_status",
                  arguments: "{}",
                },
              },
            ],
          },
          toolMessage,
        ],
      };

      const transformed = sanitizeAndTransformPayload(payload);
      const transformedToolMsg = transformed.messages.find((m) => m.role === "tool");

      expect(transformedToolMsg).toBeDefined();
      expect(typeof transformedToolMsg?.content).toBe("string");
      expect(transformedToolMsg?.content).toBe(JSON.stringify({ status: "ok" }));
      expect(Array.isArray(transformedToolMsg?.content)).toBe(false);
    });

    it("flattens multi-part text arrays in role: 'tool' content with newline separation", () => {
      const toolMessage: OpenAIMessage = {
        role: "tool",
        tool_call_id: "call_456",
        content: [
          { type: "text", text: "Line 1: system ready" },
          { type: "text", text: "Line 2: all tests passing" },
        ] as unknown as string,
      };

      const scrubbed = scrubReasoningFromMessage(toolMessage);
      expect(typeof scrubbed.content).toBe("string");
      expect(scrubbed.content).toBe("Line 1: system ready\nLine 2: all tests passing");
    });

    it("strips OpenCode2 metadata fields (id, name, providerState, state, createdAt) from role: 'tool'", () => {
      const rawToolMsg: Record<string, unknown> = {
        id: "msg_opencode_12345",
        role: "tool",
        tool_call_id: "call_789",
        name: "grep",
        providerState: { cached: true },
        state: "completed",
        createdAt: 1700000000,
        content: [{ type: "text", text: "{\"found\":true}" }],
      };

      const scrubbed = scrubReasoningFromMessage(rawToolMsg as unknown as OpenAIMessage) as Record<string, unknown>;
      expect(scrubbed.role).toBe("tool");
      expect(scrubbed.tool_call_id).toBe("call_789");
      expect(scrubbed.content).toBe("{\"found\":true}");
      expect(scrubbed.id).toBeUndefined();
      expect(scrubbed.name).toBeUndefined();
      expect(scrubbed.providerState).toBeUndefined();
      expect(scrubbed.state).toBeUndefined();
      expect(scrubbed.createdAt).toBeUndefined();
    });
  });

  describe("Bug 2: Incremental tool_calls delta streaming through createOpenCodeReasoningFilterStreamTransformer", () => {
    it("filters reasoning chunks while strictly preserving all incremental tool_calls deltas and finish_reason", async () => {
      const encoder = new TextEncoder();

      // Define chunks as emitted by deep reasoning tool-calling models (e.g. ox-alpha)
      const rawChunks = [
        // Chunk 1: Pure reasoning delta -> Must be filtered out
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-001",
          object: "chat.completion.chunk",
          created: 1700000001,
          model: "stealth/ox-alpha",
          choices: [
            {
              index: 0,
              delta: { reasoning: "Calling tool now to search the codebase." },
              finish_reason: null,
            },
          ],
        })}\n\n`,

        // Chunk 2: Initial tool call with id, type, and function name -> Must be preserved
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-001",
          object: "chat.completion.chunk",
          created: 1700000002,
          model: "stealth/ox-alpha",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_abc",
                    type: "function",
                    function: {
                      name: "grep",
                      arguments: "",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,

        // Chunk 3: Incremental argument fragment 1 -> Must be preserved
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-001",
          object: "chat.completion.chunk",
          created: 1700000003,
          model: "stealth/ox-alpha",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "{\"pat",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,

        // Chunk 4: Incremental argument fragment 2 -> Must be preserved
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-001",
          object: "chat.completion.chunk",
          created: 1700000004,
          model: "stealth/ox-alpha",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "tern\":\"foo\"}",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,

        // Chunk 5: Stream completion with finish_reason: "tool_calls" -> Must be preserved
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-001",
          object: "chat.completion.chunk",
          created: 1700000005,
          model: "stealth/ox-alpha",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "tool_calls",
            },
          ],
        })}\n\n`,

        // Final [DONE] frame
        `data: [DONE]\n\n`,
      ];

      const rawStream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of rawChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const filteredStream = rawStream.pipeThrough(
        createOpenCodeReasoningFilterStreamTransformer()
      );

      const events = await readStreamToSseEvents(filteredStream);

      // Verify that reasoning chunk (Chunk 1) was suppressed
      expect(events.length).toBe(4); // Chunks 2, 3, 4, 5

      // Reconstruct tool call from stream events
      let toolCallId = "";
      let toolName = "";
      let accumulatedArgs = "";
      let finishReason: string | null = null;

      for (const event of events) {
        const choice = (event.choices as Array<{
          delta?: {
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
            reasoning?: string;
          };
          finish_reason?: string | null;
        }>)?.[0];

        // Ensure reasoning was never leaked
        expect(choice?.delta?.reasoning).toBeUndefined();

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (tc.id) toolCallId = tc.id;
            if (tc.function?.name) toolName = tc.function.name;
            if (tc.function?.arguments) accumulatedArgs += tc.function.arguments;
          }
        }

        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // Assert complete reconstructed tool call payload
      expect(toolCallId).toBe("call_abc");
      expect(toolName).toBe("grep");
      expect(accumulatedArgs).toBe("{\"pattern\":\"foo\"}");
      expect(finishReason).toBe("tool_calls");
    });

    it("strips reasoning while preserving tool_calls when emitted in the same chunk delta", () => {
      const hybridChunk = {
        id: "chatcmpl-hybrid-001",
        object: "chat.completion.chunk",
        created: 1700000000,
        model: "stealth/ox-alpha",
        choices: [
          {
            index: 0,
            delta: {
              reasoning: "I should run grep to find the file.",
              tool_calls: [
                {
                  index: 0,
                  id: "call_xyz",
                  type: "function",
                  function: {
                    name: "grep",
                    arguments: "{\"pattern\":\"test\"}",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };

      const { filteredData, shouldEmit } = filterReasoningFromChunk(hybridChunk);

      expect(shouldEmit).toBe(true);
      const choice = (filteredData.choices as Array<{
        delta?: Record<string, unknown>;
      }>)?.[0];

      expect(choice?.delta?.reasoning).toBeUndefined();
      expect(choice?.delta?.tool_calls).toBeDefined();
      expect(Array.isArray(choice?.delta?.tool_calls)).toBe(true);
      expect((choice?.delta?.tool_calls as unknown[])[0]).toEqual({
        index: 0,
        id: "call_xyz",
        type: "function",
        function: {
          name: "grep",
          arguments: "{\"pattern\":\"test\"}",
        },
      });
    });
  });

  describe("Slice C: Tool Wire Normalizer & Model Namespace Sanitizer (literouter-0i90)", () => {
    const originalFetch = globalThis.fetch;

    it("strips openrouter/ prefix from model ID when forwarding to openrouter provider", async () => {
      initializeKeyPools();
      let capturedBody: Record<string, unknown> | null = null;
      let capturedUrl = "";

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (init?.body && typeof init.body === "string") {
          capturedBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: Date.now(),
            model: "anthropic/claude-3.5-sonnet",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Model prefix stripped successfully." },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof globalThis.fetch;

      try {
        const directive: DirectDirective = {
          type: "direct",
          raw: "lr-or-oa-ch-no",
          provider: "or",
          payload: "oa",
          completion: "ch",
          nuances: ["no"],
        };

        const payload: OpenAIRequestPayload = {
          model: "openrouter/anthropic/claude-3.5-sonnet",
          messages: [{ role: "user", content: "Test model prefix stripping" }],
        };

        const res = await executeDirectRequest(directive, payload, undefined, "req-slice-c-1");
        expect(res.status).toBe(200);
        expect(capturedBody).not.toBeNull();
        expect((capturedBody as Record<string, unknown> | null)?.model).toBe("anthropic/claude-3.5-sonnet");
        expect(capturedUrl).toContain("openrouter.ai");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("leaves model ID untouched when provider is not openrouter or no prefix exists", async () => {
      initializeKeyPools();
      let capturedBody: Record<string, unknown> | null = null;

      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.body && typeof init.body === "string") {
          capturedBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: Date.now(),
            model: "deepseek-ai/deepseek-r1",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Pass through" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof globalThis.fetch;

      try {
        const directive: DirectDirective = {
          type: "direct",
          raw: "lr-nv-oa-ch-ts",
          provider: "nv",
          payload: "oa",
          completion: "ch",
          nuances: ["ts"],
        };

        const payload: OpenAIRequestPayload = {
          model: "deepseek-ai/deepseek-r1",
          messages: [{ role: "user", content: "Test untouched model" }],
        };

        const res = await executeDirectRequest(directive, payload, undefined, "req-slice-c-2");
        expect(res.status).toBe(200);
        expect(capturedBody).not.toBeNull();
        expect((capturedBody as Record<string, unknown> | null)?.model).toBe("deepseek-ai/deepseek-r1");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
