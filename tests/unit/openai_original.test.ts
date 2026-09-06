import { describe, expect, it, spyOn } from "bun:test";
import {
  buildUpstreamHeaders,
  createNonStreamingResponse,
  createStreamingResponse,
  extractProvider,
  handleOpenAiOriginal,
  resolveApiKey,
  resolveUpstreamResponsesUrl,
  shouldStreamResponse,
} from "../../src/handlers/openai_original";
import { globalKeyPool } from "../../src/handlers/openai_compat";

async function readSseStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      result += decoder.decode(value, { stream: true });
    }
  }
  result += decoder.decode();
  return result;
}

describe("OpenAI Original Responses Handler (src/handlers/openai_original.ts)", () => {
  describe("resolveUpstreamResponsesUrl", () => {
    it("resolves Zen responses endpoint", () => {
      const url = resolveUpstreamResponsesUrl("zn");
      expect(url).toBe("https://opencode.ai/zen/v1/responses");
    });

    it("resolves OpenRouter responses endpoint", () => {
      const url = resolveUpstreamResponsesUrl("or");
      expect(url).toBe("https://openrouter.ai/api/v1/responses");
    });

    it("resolves OpenAI responses endpoint", () => {
      const url = resolveUpstreamResponsesUrl("oa");
      expect(url).toBe("https://api.openai.com/v1/responses");
    });

    it("returns null for unsupported providers", () => {
      expect(resolveUpstreamResponsesUrl("unknown")).toBeNull();
      expect(resolveUpstreamResponsesUrl("gg")).toBeNull();
    });
  });

  describe("extractProvider", () => {
    it("extracts provider from raw string code", () => {
      expect(extractProvider("zn")).toBe("zn");
      expect(extractProvider("or")).toBe("or");
      expect(extractProvider("oa")).toBe("oa");
    });

    it("extracts provider from directive string", () => {
      expect(extractProvider("lr-zn-oa-rs-no")).toBe("zn");
      expect(extractProvider("lr-or-oa-rs-no")).toBe("or");
      expect(extractProvider("lr-oa-oa-rs-no")).toBe("oa");
    });

    it("extracts provider from directive object", () => {
      expect(extractProvider({ provider: "zn" } as any)).toBe("zn");
      expect(extractProvider({ provider: "or" } as any)).toBe("or");
    });

    it("returns null for invalid inputs", () => {
      expect(extractProvider("invalid-key")).toBeNull();
      expect(extractProvider({} as any)).toBeNull();
    });
  });

  describe("buildUpstreamHeaders", () => {
    it("builds Bearer authorization and default json headers", () => {
      const headers = buildUpstreamHeaders("test-key-123", "oa");
      expect(headers["Authorization"]).toBe("Bearer test-key-123");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Accept-Encoding"]).toBe("identity");
    });

    it("forwards incoming Accept header when present", () => {
      const incoming = new Headers({ accept: "text/event-stream" });
      const headers = buildUpstreamHeaders("test-key-123", "zn", incoming);
      expect(headers["Accept"]).toBe("text/event-stream");
    });
  });

  describe("resolveApiKey", () => {
    it("uses state.keyPoolManager when provided", () => {
      const mockState = {
        keyPoolManager: {
          getKey: (prov: string) => `mock-key-${prov}`,
        },
      };
      const resolved = resolveApiKey("zn", mockState);
      expect(resolved).not.toBeNull();
      expect(resolved?.key).toBe("mock-key-zn");
    });

    it("falls back to global pool when state is empty", () => {
      const resolved = resolveApiKey("zn");
      expect(resolved).not.toBeNull();
      expect(resolved?.key).toBeDefined();
    });
  });

  describe("shouldStreamResponse", () => {
    it("returns false if response status is error >= 400", () => {
      const res = new Response("error", {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      });
      expect(shouldStreamResponse(res, true)).toBe(false);
    });

    it("returns true if content-type is text/event-stream", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
      expect(shouldStreamResponse(res, false)).toBe(true);
    });

    it("returns clientStreamRequested if content-type is not event-stream", () => {
      const res = new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      expect(shouldStreamResponse(res, true)).toBe(true);
      expect(shouldStreamResponse(res, false)).toBe(false);
    });
  });

  describe("createNonStreamingResponse & createStreamingResponse", () => {
    it("handles non-streaming response body", async () => {
      const jsonPayload = JSON.stringify({ id: "resp_123", output: "Hello" });
      const upstream = new Response(jsonPayload, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      const downstream = await createNonStreamingResponse(upstream);
      expect(downstream.status).toBe(200);
      const text = await downstream.text();
      expect(JSON.parse(text)).toEqual({ id: "resp_123", output: "Hello" });
    });

    it("handles streaming response body with clean reader pump", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode("event: response.output_text.delta\ndata: {\"delta\":\"Hello\"}\n\n"),
        encoder.encode("event: response.completed\ndata: {}\n\n"),
      ];

      const upstreamBody = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const upstream = new Response(upstreamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const downstream = createStreamingResponse(upstream);
      expect(downstream.status).toBe(200);
      expect(downstream.headers.get("Content-Type")).toBe("text/event-stream");

      const reader = downstream.body?.getReader();
      expect(reader).toBeDefined();

      let received = "";
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const item = await reader!.read();
        done = item.done;
        if (item.value) {
          received += decoder.decode(item.value);
        }
      }

      expect(received).toContain("Hello");
      expect(received).toContain("response.completed");
    });
  });

  describe("handleOpenAiOriginal", () => {
    describe("non-streaming JSON responses", () => {
      it("passes through input, model, and response payload correctly", async () => {
        let receivedBody: Record<string, unknown> = {};
        let receivedAuth = "";

        const mockServer = Bun.serve({
          port: 0,
          async fetch(req) {
            receivedAuth = req.headers.get("authorization") ?? "";
            receivedBody = (await req.json()) as Record<string, unknown>;
            return Response.json({
              id: "resp_ns_test_456",
              model: receivedBody.model,
              output: [
                {
                  type: "message",
                  content: [{ type: "text", text: "Verified non-streaming output" }],
                },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
            });
          },
        });
        process.env.MOCK_ZN_PORT = String(mockServer.port);

        try {
          const reqPayload = {
            model: "muse-spark-1.3",
            input: [{ role: "user", content: "Translate hello to German" }],
            stream: false,
          };
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqPayload),
          });
          const state = {
            keyPoolManager: {
              getKey: () => "zen-test-key-ns",
            },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("application/json");

          expect(receivedAuth).toBe("Bearer zen-test-key-ns");
          expect(receivedBody.model).toBe("muse-spark-1.3");
          expect(receivedBody.input).toEqual([{ role: "user", content: "Translate hello to German" }]);
          expect(receivedBody.stream).toBe(false);

          const data = (await res.json()) as {
            id: string;
            model: string;
            output: Array<{ content: Array<{ text: string }> }>;
            usage: { total_tokens: number };
          };
          expect(data.id).toBe("resp_ns_test_456");
          expect(data.model).toBe("muse-spark-1.3");
          expect(data.output?.[0]?.content?.[0]?.text).toBe("Verified non-streaming output");
          expect(data.usage.total_tokens).toBe(36);
        } finally {
          mockServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
        }
      });
    });

    describe("streaming SSE responses", () => {
      it("passes through SSE events without distortion", async () => {
        const sseEvents = [
          'event: response.created\ndata: {"response":{"id":"resp_sse_1","model":"muse-spark-1.3"}}\n\n',
          'event: response.text.delta\ndata: {"delta":"Streaming token chunk"}\n\n',
          'event: response.function_call_arguments.delta\ndata: {"delta":"{\\"query\\":\\"weather\\"}"}\n\n',
          'event: response.done\ndata: {"response":{"id":"resp_sse_1","status":"completed"}}\n\n',
        ];

        const mockServer = Bun.serve({
          port: 0,
          fetch() {
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder();
                for (const chunk of sseEvents) {
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            });
          },
        });
        process.env.MOCK_ZN_PORT = String(mockServer.port);

        try {
          const reqPayload = {
            model: "muse-spark-1.3",
            input: [{ role: "user", content: "Stream me events" }],
            stream: true,
          };
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqPayload),
          });
          const state = {
            keyPoolManager: {
              getKey: () => "zen-test-key-sse",
            },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toBe("text/event-stream");

          const streamText = await readSseStream(res);
          expect(streamText).toContain("event: response.created");
          expect(streamText).toContain('"model":"muse-spark-1.3"');
          expect(streamText).toContain("event: response.text.delta");
          expect(streamText).toContain("Streaming token chunk");
          expect(streamText).toContain("event: response.function_call_arguments.delta");
          expect(streamText).toContain('{\\"query\\":\\"weather\\"}');
          expect(streamText).toContain("event: response.done");
          expect(streamText).toContain('"status":"completed"');
        } finally {
          mockServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
        }
      });
    });

    describe("upstream URL resolution and key rotation", () => {
      it("routes 'zn' target to Zen upstream and 'or' target to OpenRouter upstream", async () => {
        let znReceivedPath = "";
        let znReceivedAuth = "";
        let orReceivedPath = "";
        let orReceivedAuth = "";

        const znServer = Bun.serve({
          port: 0,
          fetch(req) {
            znReceivedPath = new URL(req.url).pathname;
            znReceivedAuth = req.headers.get("authorization") ?? "";
            return Response.json({ id: "zn_resp", model: "zen-model" });
          },
        });

        const orServer = Bun.serve({
          port: 0,
          fetch(req) {
            orReceivedPath = new URL(req.url).pathname;
            orReceivedAuth = req.headers.get("authorization") ?? "";
            return Response.json({ id: "or_resp", model: "or-model" });
          },
        });

        process.env.MOCK_ZN_PORT = String(znServer.port);
        process.env.MOCK_OR_PORT = String(orServer.port);

        try {
          const state = {
            keyPoolManager: {
              getKey: (provider: string) => `key-for-${provider}`,
            },
          };

          // Test 'zn' target via code string
          const znReq = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "zen-model", input: "zen test" }),
          });
          const znRes = await handleOpenAiOriginal(znReq, "zn", state);
          expect(znRes.status).toBe(200);
          expect(znReceivedPath).toBe("/zen/v1/responses");
          expect(znReceivedAuth).toBe("Bearer key-for-zn");

          // Test 'or' target via direct directive 'lr-or-oo-rs-no'
          const orReq = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "or-model", input: "or test" }),
          });
          const orRes = await handleOpenAiOriginal(orReq, "lr-or-oo-rs-no", state);
          expect(orRes.status).toBe(200);
          expect(orReceivedPath).toBe("/api/v1/responses");
          expect(orReceivedAuth).toBe("Bearer key-for-or");
        } finally {
          znServer.stop(true);
          orServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
          delete process.env.MOCK_OR_PORT;
        }
      });

      it("rotates keys sequentially across multiple requests", async () => {
        const receivedAuthList: string[] = [];
        const mockServer = Bun.serve({
          port: 0,
          fetch(req) {
            receivedAuthList.push(req.headers.get("authorization") ?? "");
            return Response.json({ id: "rotated_resp" });
          },
        });
        process.env.MOCK_ZN_PORT = String(mockServer.port);

        try {
          const keys = ["zen-rotation-key-1", "zen-rotation-key-2", "zen-rotation-key-3"];
          let pointer = 0;
          const state = {
            keyPoolManager: {
              selectNextKey: () => {
                const idx = pointer % keys.length;
                const k = keys[idx] ?? "";
                pointer += 1;
                return { key: k, index: idx };
              },
            },
          };

          for (let i = 0; i < 3; i++) {
            const req = new Request("http://localhost:7766/v1/responses", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: "muse-spark-1.3", input: `call-${i}` }),
            });
            const res = await handleOpenAiOriginal(req, "zn", state);
            expect(res.status).toBe(200);
          }

          expect(receivedAuthList).toEqual([
            "Bearer zen-rotation-key-1",
            "Bearer zen-rotation-key-2",
            "Bearer zen-rotation-key-3",
          ]);
        } finally {
          mockServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
        }
      });
    });

    describe("error handling", () => {
      it("returns 400 for unsupported provider", async () => {
        const req = new Request("http://localhost:7766/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", input: "hi" }),
        });

        const res = await handleOpenAiOriginal(req, "unknown");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.message).toContain("Unsupported or invalid provider");
      });

      it("returns 499 when client signal is already aborted", async () => {
        const abortController = new AbortController();
        abortController.abort();

        const req = new Request("http://localhost:7766/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", input: "hi" }),
          signal: abortController.signal,
        });

        const res = await handleOpenAiOriginal(req, "zn");
        expect(res.status).toBe(499);
        const data = await res.json();
        expect(data.error.message).toContain("Request aborted by client");
      });

      it("passes through upstream 400 bad request error payload", async () => {
        const mockServer = Bun.serve({
          port: 0,
          fetch() {
            return Response.json(
              {
                error: {
                  message: "Invalid parameter: stream must be a boolean",
                  type: "invalid_request_error",
                },
              },
              { status: 400 }
            );
          },
        });
        process.env.MOCK_ZN_PORT = String(mockServer.port);

        try {
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "muse-spark-1.3", input: "bad param" }),
          });
          const state = {
            keyPoolManager: { getKey: () => "mock-key" },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(400);
          const data = (await res.json()) as { error: { message: string; type: string } };
          expect(data.error.type).toBe("invalid_request_error");
          expect(data.error.message).toBe("Invalid parameter: stream must be a boolean");
        } finally {
          mockServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
        }
      });

      it("passes through upstream 500 internal server error payload", async () => {
        const mockServer = Bun.serve({
          port: 0,
          fetch() {
            return Response.json(
              {
                error: {
                  message: "Upstream server crash",
                  type: "server_error",
                },
              },
              { status: 500 }
            );
          },
        });
        process.env.MOCK_ZN_PORT = String(mockServer.port);

        try {
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "muse-spark-1.3", input: "trigger 500" }),
          });
          const state = {
            keyPoolManager: { getKey: () => "mock-key" },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(500);
          const data = (await res.json()) as { error: { message: string; type: string } };
          expect(data.error.type).toBe("server_error");
          expect(data.error.message).toBe("Upstream server crash");
        } finally {
          mockServer.stop(true);
          delete process.env.MOCK_ZN_PORT;
        }
      });

      it("returns 502 when upstream network connection fails", async () => {
        const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
          new TypeError("Failed to fetch: Connection refused")
        );

        try {
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "muse-spark-1.3", input: "connection refused" }),
          });
          const state = {
            keyPoolManager: { getKey: () => "mock-key" },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(502);
          const data = (await res.json()) as { error: { message: string; type: string } };
          expect(data.error.type).toBe("server_error");
          expect(data.error.message).toContain("Upstream request failed");
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it("returns 429 when no active API keys are available", async () => {
        const spy = spyOn(globalKeyPool, "selectNextKey").mockReturnValue(null);
        try {
          const req = new Request("http://localhost:7766/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "muse-spark-1.3", input: "no keys" }),
          });
          const state = {
            keyPoolManager: {
              selectNextKey: () => null,
            },
          };

          const res = await handleOpenAiOriginal(req, "zn", state);
          expect(res.status).toBe(429);
          const data = (await res.json()) as { error: { message: string; type: string } };
          expect(data.error.type).toBe("insufficient_quota");
          expect(data.error.message).toContain("No active API keys available for provider 'zn'");
        } finally {
          spy.mockRestore();
        }
      });
    });
  });
});
