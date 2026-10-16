import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { ensureTerminalUserTurn } from "../../src/transformers/opencode_adapter";
import {
  transformMessages,
  sanitizeAndTransformPayload,
} from "../../src/transformers/payload";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../src/transformers/nuances";
import { translateAnthropicToOpenAI } from "../../src/transformers/anthropic_openai_xwire";
import { AnthropicMessagesTransformer } from "../../src/transformers/anthropic_messages";
import {
  initializeKeyPools,
  globalKeyPool,
  globalCooldownManager,
  getCachedFusionEngine,
  getFusionEngine,
  resetCachedFusionEngine,
} from "../../src/handlers/openai_compat";
import { resolveApiKey } from "../../src/handlers/openai_original";
import { sanitizeBody } from "../../src/telemetry/sanitize";
import { OpenAIChatTransformer } from "../../src/transformers/openai_chat";
import { RequestTelemetry } from "../../src/telemetry/session";
import { parseDirective } from "../../src/directive/parser";
import * as keysModule from "../../src/config/keys";

describe("Performance & Reliability Upgrades Comprehensive Suite", () => {
  // =========================================================================
  // Section 1: Trailing Assistant Auto-Healing (ensureTerminalUserTurn)
  // =========================================================================
  describe("1. Trailing Assistant Auto-Healing", () => {
    it("handles empty or undefined message lists safely", () => {
      expect(ensureTerminalUserTurn([])).toEqual([]);
      expect(ensureTerminalUserTurn(undefined)).toEqual([]);
    });

    it("leaves conversation intact when terminal turn is user", () => {
      const msgs: OpenAIMessage[] = [
        { role: "system", content: "You are a code assistant." },
        { role: "user", content: "How do I implement binary search?" },
      ];
      const result = ensureTerminalUserTurn(msgs);
      expect(result).toEqual(msgs);
      expect(result.length).toBe(2);
    });

    it("leaves multi-turn alternating conversation intact when ending on user turn", () => {
      const msgs: OpenAIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there, how can I help?" },
        { role: "user", content: "Write a quicksort in TypeScript" },
      ];
      const result = ensureTerminalUserTurn(msgs);
      expect(result.length).toBe(3);
      const lastMsg = result[result.length - 1];
      expect(lastMsg?.role).toBe("user");
      expect(lastMsg?.content).toBe("Write a quicksort in TypeScript");
    });

    it("appends { role: 'user', content: 'ok go on' } when terminal message has role: 'assistant'", () => {
      const msgs: OpenAIMessage[] = [
        { role: "user", content: "Continue writing the story" },
        { role: "assistant", content: "The spaceship touched down on the crater rim..." },
      ];
      const result = ensureTerminalUserTurn(msgs);
      expect(result.length).toBe(3);
      expect(result[0]).toEqual(msgs[0]);
      expect(result[1]).toEqual(msgs[1]);
      expect(result[2]).toEqual({ role: "user", content: "ok go on" });
    });

    it("appends { role: 'user', content: 'ok go on' } when terminal message has role: 'model'", () => {
      const msgs: OpenAIMessage[] = [
        { role: "user", content: "Solve x^2 - 4 = 0" },
        { role: "model", content: "x = 2 or x = -2" } as unknown as OpenAIMessage,
      ];
      const result = ensureTerminalUserTurn(msgs);
      expect(result.length).toBe(3);
      expect(result[2]).toEqual({ role: "user", content: "ok go on" });
    });

    it("heals single trailing assistant message", () => {
      const msgs: OpenAIMessage[] = [
        { role: "assistant", content: "Preamble note before user input" },
      ];
      const result = ensureTerminalUserTurn(msgs);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual(msgs[0]);
      expect(result[1]).toEqual({ role: "user", content: "ok go on" });
    });

    it("integrates into sanitizeAndTransformPayload for OpenAI request pipelines", () => {
      const payload: OpenAIRequestPayload = {
        model: "openai/gpt-4o",
        messages: [
          { role: "user", content: "Plan step 1" },
          { role: "assistant", content: "Step 1 initiated..." },
        ],
      };
      const transformed = sanitizeAndTransformPayload(payload);
      expect(transformed.messages.length).toBe(3);
      expect(transformed.messages[2]).toEqual({ role: "user", content: "ok go on" });
    });

    it("integrates into translateAnthropicToOpenAI cross-wire transformer", () => {
      const anthropicReq = {
        model: "claude-3-7-sonnet",
        messages: [
          { role: "user" as const, content: "What is 2+2?" },
          { role: "assistant" as const, content: "Calculating..." },
        ],
      };
      const translated = translateAnthropicToOpenAI(anthropicReq);
      expect(translated.messages.length).toBe(3);
      expect(translated.messages[2]).toEqual({ role: "user", content: "ok go on" });
    });

    it("preserves intentional prefill turns in Anthropic native transformer without synthetic injection", () => {
      const anthropicTransformer = new AnthropicMessagesTransformer();
      const directive = parseDirective("lr-or-cl-ms-no")!;
      const inboundBody = {
        model: "anthropic/claude-3-5-sonnet",
        messages: [
          { role: "user", content: "Write a JSON response" },
          { role: "assistant", content: "{\n  \"result\":" },
        ],
      };
      const outbound = anthropicTransformer.transformClientToWire(
        inboundBody,
        directive,
        new Headers()
      );
      const outboundBody = outbound.body as { messages: Array<{ role: string; content: string }> };
      // Prefill turn remains intact as assistant turn:
      expect(outboundBody.messages.length).toBe(2);
      const prefillTurn = outboundBody.messages[1];
      expect(prefillTurn?.role).toBe("assistant");
      expect(prefillTurn?.content).toBe("{\n  \"result\":");
    });
  });

  // =========================================================================
  // Section 2: LaTeX Formula Preservation (transformMessages)
  // =========================================================================
  describe("2. LaTeX Formula Preservation", () => {
    it("preserves integral mathematical equations intact through transformMessages", () => {
      const latexInput = "Calculate $\\int_0^\\infty e^{-x} dx$ and state the convergence criteria.";
      const messages: OpenAIMessage[] = [
        { role: "user", content: latexInput },
      ];
      const transformed = transformMessages(messages, []);
      const firstMsg = transformed[0];
      expect(firstMsg?.content).toBe(latexInput);
      // Ensure \infty is NOT degraded into unicode ∞
      expect(firstMsg?.content).toContain("\\infty");
      expect(firstMsg?.content).not.toContain("∞");
    });

    it("preserves Greek letters and inequality symbols unaltered in LaTeX equations", () => {
      const formula = "Verify $\\alpha + \\beta = \\gamma$ where $x \\leq y$ and $a \\geq b$.";
      const messages: OpenAIMessage[] = [
        { role: "user", content: formula },
      ];
      const transformed = transformMessages(messages, []);
      const firstMsg = transformed[0];
      expect(firstMsg?.content).toBe(formula);
      expect(firstMsg?.content).toContain("\\alpha");
      expect(firstMsg?.content).toContain("\\beta");
      expect(firstMsg?.content).toContain("\\gamma");
      expect(firstMsg?.content).toContain("\\leq");
      expect(firstMsg?.content).toContain("\\geq");
    });

    it("preserves arrow notations, limits, and multi-symbol formulas intact", () => {
      const complexLatex =
        "Show that $A \\rightarrow B$ implies $\\lim_{x \\to \\infty} f(x) \\neq 0$ with $\\Delta x \\approx \\pm \\sigma$.";
      const messages: OpenAIMessage[] = [
        { role: "user", content: complexLatex },
      ];
      const transformed = transformMessages(messages, []);
      const firstMsg = transformed[0];
      expect(firstMsg?.content).toBe(complexLatex);
      expect(firstMsg?.content).toContain("\\rightarrow");
      expect(firstMsg?.content).toContain("\\infty");
      expect(firstMsg?.content).toContain("\\neq");
      expect(firstMsg?.content).toContain("\\Delta");
      expect(firstMsg?.content).toContain("\\approx");
      expect(firstMsg?.content).toContain("\\pm");
      expect(firstMsg?.content).toContain("\\sigma");
    });

    it("preserves LaTeX in multi-part content arrays", () => {
      const latexContent = "$$\\oint_C \\mathbf{B} \\cdot d\\boldsymbol{\\ell} = \\mu_0 I_{\\text{enc}}$$";
      const messages: OpenAIMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Evaluate the line integral: " },
            { type: "text", text: latexContent },
          ],
        },
      ];
      const transformed = transformMessages(messages, []);
      const parts = transformed[0]?.content as Array<{ type: string; text?: string }> | undefined;
      expect(Array.isArray(parts)).toBe(true);
      const part = parts?.[1];
      expect(part?.text).toBe(latexContent);
      expect(part?.text).toContain("\\mu_0");
    });

    it("preserves mathematical formulas through sanitizeAndTransformPayload across nuances", () => {
      const mathPrompt = "Evaluate: $\\sum_{k=1}^\\infty \\frac{1}{k^2} = \\frac{\\pi^2}{6}$";
      const payload: OpenAIRequestPayload = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: mathPrompt }],
      };

      for (const nuances of [[], ["ts"], ["gm"], ["tc"]]) {
        const transformed = sanitizeAndTransformPayload(payload, { nuances });
        const firstMessage = transformed.messages[0];
        expect(firstMessage?.content).toBe(mathPrompt);
        expect(firstMessage?.content).toContain("\\infty");
        expect(firstMessage?.content).toContain("\\pi");
      }
    });
  });

  // =========================================================================
  // Section 3: Cold-Boot Key Pool Caching
  // =========================================================================
  describe("3. Cold-Boot Key Pool Caching", () => {
    const mockEnv = {
      OPENROUTER_API_KEYS: "sk-or-v1-key1,sk-or-v1-key2,sk-or-v1-key3",
      GOOGLE_API_KEYS: "AIzaSyKey1,AIzaSyKey2",
      ANTHROPIC_API_KEYS: "sk-ant-test-stub-1",
    };

    beforeEach(() => {
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
    });

    afterEach(() => {
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
      initializeKeyPools();
    });

    it("initializes key pools during event-driven cold-boot", () => {
      initializeKeyPools(mockEnv);
      expect(globalKeyPool.getPoolSize("or")).toBe(3);

      const orKey1 = globalKeyPool.selectNextKey("or");
      const orKey2 = globalKeyPool.selectNextKey("or");
      const orKey3 = globalKeyPool.selectNextKey("or");
      expect(orKey1?.key).toBe("sk-or-v1-key1");
      expect(orKey2?.key).toBe("sk-or-v1-key2");
      expect(orKey3?.key).toBe("sk-or-v1-key3");

      expect(globalKeyPool.getPoolSize("gg")).toBe(2);
      const ggKey1 = globalKeyPool.selectNextKey("gg");
      const ggKey2 = globalKeyPool.selectNextKey("gg");
      expect(ggKey1?.key).toBe("AIzaSyKey1");
      expect(ggKey2?.key).toBe("AIzaSyKey2");
    });

    it("does NOT invoke loadKeyPools or re-parse environment during resolveApiKey on the hot path", () => {
      initializeKeyPools(mockEnv);

      // Spy on loadKeyPools to verify it is NOT called during request dispatch
      const spyLoadKeyPools = spyOn(keysModule, "loadKeyPools");

      // Simulate 10 sequential request key resolutions on the hot path
      for (let i = 0; i < 10; i++) {
        const keyObj = resolveApiKey("or");
        expect(keyObj).not.toBeNull();
        expect(keyObj?.key.startsWith("sk-or-v1-key")).toBe(true);
      }

      // Assert loadKeyPools was NEVER called during the hot-path resolutions
      expect(spyLoadKeyPools).toHaveBeenCalledTimes(0);

      spyLoadKeyPools.mockRestore();
    });

    it("cycles keys round-robin across repeated request resolutions without pool re-initialization", () => {
      initializeKeyPools(mockEnv);

      const k1 = resolveApiKey("or");
      const k2 = resolveApiKey("or");
      const k3 = resolveApiKey("or");
      const k4 = resolveApiKey("or");

      expect(k1?.key).toBe("sk-or-v1-key1");
      expect(k2?.key).toBe("sk-or-v1-key2");
      expect(k3?.key).toBe("sk-or-v1-key3");
      expect(k4?.key).toBe("sk-or-v1-key1"); // Round robin wrap-around
    });

    it("reloads key pools when explicit event-driven reinitialization (/reset) occurs", () => {
      initializeKeyPools(mockEnv);
      expect(globalKeyPool.getPoolSize("or")).toBe(3);

      const updatedEnv = {
        OPENROUTER_API_KEYS: "sk-or-v1-new-key1,sk-or-v1-new-key2",
      };

      // Event-driven reset
      globalKeyPool.reset();
      initializeKeyPools(updatedEnv);

      expect(globalKeyPool.getPoolSize("or")).toBe(2);
      const newKey1 = globalKeyPool.selectNextKey("or");
      const newKey2 = globalKeyPool.selectNextKey("or");
      expect(newKey1?.key).toBe("sk-or-v1-new-key1");
      expect(newKey2?.key).toBe("sk-or-v1-new-key2");
    });
  });

  // =========================================================================
  // Section 4: Singleton FusionEngine & StickyPositionCache
  // =========================================================================
  describe("4. Singleton FusionEngine & StickyPositionCache", () => {
    beforeEach(() => {
      resetCachedFusionEngine();
    });

    afterEach(() => {
      resetCachedFusionEngine();
    });

    it("exports getFusionEngine and getCachedFusionEngine as identical references", () => {
      expect(getFusionEngine).toBe(getCachedFusionEngine);
    });

    it("returns the exact same FusionEngine instance across repeated calls (singleton)", () => {
      const engine1 = getFusionEngine();
      const engine2 = getFusionEngine();
      const engine3 = getCachedFusionEngine();

      expect(engine1).toBe(engine2);
      expect(engine2).toBe(engine3);
    });

    it("maintains StickyPositionCache state across multi-turn session calls", () => {
      const engine = getFusionEngine();
      const stickyCache = engine.getStickyCache();
      expect(stickyCache).toBeDefined();

      const preset = "fast";
      const model = "openai/gpt-4o-mini";
      stickyCache.setStickyTier(preset, model, {
        priority: 2,
        model,
        apikey: "sk-mock-key-1",
      });

      // Subsequent getFusionEngine() calls access the same in-memory sticky cache
      const engineSubsequent = getFusionEngine();
      const retrieved = engineSubsequent.getStickyCache().getStickyTier(preset, model);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.tierPriority).toBe(2);
      expect(retrieved?.model).toBe(model);
      expect(retrieved?.apikey).toBe("sk-mock-key-1");
    });

    it("resets cached FusionEngine and clears sticky state when resetCachedFusionEngine() is invoked", () => {
      const engineBefore = getFusionEngine();
      const preset = "deep";
      const model = "google/gemini-2.5-flash";
      engineBefore.getStickyCache().setStickyTier(preset, model, {
        priority: 1,
        model,
        apikey: "AIzaSyMockKey",
      });

      expect(engineBefore.getStickyCache().getStickyTier(preset, model)).not.toBeNull();

      // Trigger reset
      resetCachedFusionEngine();

      // Next call creates a fresh singleton
      const engineAfter = getFusionEngine();
      expect(engineAfter).not.toBe(engineBefore);

      // The new instance has a blank sticky cache
      expect(engineAfter.getStickyCache().getStickyTier(preset, model)).toBeNull();
    });
  });

  // =========================================================================
  // Section 5: Bounded Trace Payload Truncation (sanitizeBody)
  // =========================================================================
  describe("5. Bounded Trace Payload Truncation", () => {
    it("truncates multi-MB payloads before regex scanning when maxBytes is specified", () => {
      const twoMegabytes = 2 * 1024 * 1024;
      const largePayload = "X".repeat(twoMegabytes);

      const maxBytes = 65536; // MAX_LEG_BYTES (64KB)
      const sanitized = sanitizeBody(largePayload, maxBytes);

      // Output should be capped at maxBytes plus the truncation suffix
      const expectedSuffix = "... [TRUNCATED FOR TRACE]";
      expect(sanitized.endsWith(expectedSuffix)).toBe(true);
      expect(sanitized.length).toBe(maxBytes + expectedSuffix.length);
      expect(sanitized.slice(0, 100)).toBe("X".repeat(100));
    });

    it("performs secret regex scrubbing on payloads within the bounded slice", () => {
      const secret = "sk-ant-api03-abcdef123456789012345678901234567890";
      const payloadWithSecret = `{"key":"${secret}","data":"${"Y".repeat(100000)}"}`;

      const sanitized = sanitizeBody(payloadWithSecret, 65536);

      // Verify the secret was scrubbed
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_KEY]");
      // And payload was truncated
      expect(sanitized).toContain("... [TRUNCATED FOR TRACE]");
    });

    it("preserves standard error messages completely without truncation", () => {
      const errorObj = {
        error: {
          message: "Rate limit exceeded: 429 quota exhausted for current tier",
          type: "rate_limit_error",
          code: 429,
        },
      };
      const errorJson = JSON.stringify(errorObj);

      // Passing with 65536 limit (payload is ~110 bytes)
      const sanitizedWithLimit = sanitizeBody(errorJson, 65536);
      expect(sanitizedWithLimit).toBe(errorJson);
      expect(sanitizedWithLimit).not.toContain("[TRUNCATED FOR TRACE]");
      expect(sanitizedWithLimit).toContain("Rate limit exceeded: 429 quota exhausted");

      // Passing without maxBytes (client error forwarder)
      const sanitizedNoLimit = sanitizeBody(errorJson);
      expect(sanitizedNoLimit).toBe(errorJson);
      expect(sanitizedNoLimit).not.toContain("[TRUNCATED FOR TRACE]");
    });

    it("scrubs secrets in error messages while leaving error explanation intact", () => {
      const errorWithSecret =
        'Error: Upstream rejected request using key "AIzaSyB123456789012345678901234567890": invalid project status.';

      const sanitized = sanitizeBody(errorWithSecret);
      expect(sanitized).not.toContain("AIzaSyB123456789012345678901234567890");
      expect(sanitized).toContain('[REDACTED_KEY]');
      expect(sanitized).toContain("Error: Upstream rejected request using key");
      expect(sanitized).toContain("invalid project status.");
    });

    it("handles undefined, empty string, and structured object inputs gracefully", () => {
      expect(sanitizeBody(undefined)).toBe("");
      expect(sanitizeBody("")).toBe("");
      expect(sanitizeBody({ status: "ok", count: 42 })).toBe('{"status":"ok","count":42}');
    });
  });

  // =========================================================================
  // Section 6: Direct SSE Chunk Fast-Path Bypass (openai_chat.ts)
  // =========================================================================
  describe("6. Direct SSE Chunk Fast-Path Bypass", () => {
    it("bypasses JSON.parse and JSON.stringify for mid-stream content chunks in unscrubbed streaming", async () => {
      const transformer = new OpenAIChatTransformer();
      const telemetry = new RequestTelemetry({
        reqId: "req-fastpath-test",
        targetProvider: "openrouter",
        model: "gpt-4o",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "test-runner",
      });

      // Directive with 'ts' nuance: shouldScrubReasoning returns false!
      const directive = parseDirective("lr-or-oa-ch-ts")!;
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        directive,
        telemetry,
        abortController.signal
      );
      expect(streamTransformer).not.toBeNull();

      const textEncoder = new TextEncoder();
      const textDecoder = new TextDecoder();

      // Chunk 1: Initial delta chunk establishes TTFT (ttftMarked = true)
      const chunk1 = 'data: {"id":"c-1","choices":[{"index":0,"delta":{"content":"First"}}]}\n\n';
      // Mid-stream chunks 2, 3, 4: Pure content deltas without usage or finish_reason
      const chunk2 = 'data: {"id":"c-1","choices":[{"index":0,"delta":{"content":" second"}}]}\n\n';
      const chunk3 = 'data: {"id":"c-1","choices":[{"index":0,"delta":{"content":" third"}}]}\n\n';
      const chunk4 = 'data: {"id":"c-1","choices":[{"index":0,"delta":{"content":" fourth"}}]}\n\n';
      // Chunk 5: Terminal chunk with finish_reason and usage (must parse for telemetry)
      const chunk5 =
        'data: {"id":"c-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":4,"total_tokens":9}}\n\n';
      // Chunk 6: [DONE]
      const chunk6 = "data: [DONE]\n\n";

      // Spy on JSON.parse to track invocation counts
      const originalJsonParse = JSON.parse;
      let parseCount = 0;
      const parseSpy = spyOn(JSON, "parse").mockImplementation(
        (text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
          parseCount++;
          return originalJsonParse(text, reviver);
        }
      );

      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(textEncoder.encode(chunk1));
          controller.enqueue(textEncoder.encode(chunk2));
          controller.enqueue(textEncoder.encode(chunk3));
          controller.enqueue(textEncoder.encode(chunk4));
          controller.enqueue(textEncoder.encode(chunk5));
          controller.enqueue(textEncoder.encode(chunk6));
          controller.close();
        },
      });

      const outputStream = inputStream.pipeThrough(streamTransformer);
      const reader = outputStream.getReader();

      let streamOutput = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamOutput += textDecoder.decode(value, { stream: true });
      }

      parseSpy.mockRestore();

      // Assertions:
      // 1. Chunk 1 is parsed (to mark TTFT)
      // 2. Chunks 2, 3, 4 hit the fast-path bypass and are NOT parsed by JSON.parse
      // 3. Chunk 5 is parsed (contains "usage" and "finish_reason")
      // Total JSON.parse calls for the 6 chunks should be exactly 2 (Chunk 1 and Chunk 5)!
      expect(parseCount).toBe(2);

      // Verify all raw content was streamed verbatim downstream
      expect(streamOutput).toContain("First");
      expect(streamOutput).toContain(" second");
      expect(streamOutput).toContain(" third");
      expect(streamOutput).toContain(" fourth");
      expect(streamOutput).toContain("finish_reason");
      expect(streamOutput).toContain("[DONE]");

      // Telemetry verified
      const metrics = telemetry.toTraceMetrics();
      expect(metrics.ttftMs).toBeGreaterThanOrEqual(0);
      expect(metrics.promptTokens).toBe(5);
      expect(metrics.completionTokens).toBe(4);
    });

    it("passes mid-stream raw content chunks directly without JSON re-serialization", async () => {
      const transformer = new OpenAIChatTransformer();
      const telemetry = new RequestTelemetry({
        reqId: "req-fastpath-raw",
        targetProvider: "openrouter",
        model: "gpt-4o",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "test-runner",
      });

      // Directive with 'oo' wire (OpenAI direct, unscrubbed)
      const directive = parseDirective("lr-or-oo-ch-no")!;
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        directive,
        telemetry,
        abortController.signal
      );

      const textEncoder = new TextEncoder();
      const textDecoder = new TextDecoder();

      // First chunk: valid JSON to trigger TTFT
      const chunk1 = 'data: {"id":"c-2","choices":[{"index":0,"delta":{"content":"Start"}}]}\n\n';
      // Mid-stream chunk: specific unique string formatting that would change if re-serialized
      const chunk2Raw = '{"id":"c-2"  ,   "choices":[{"index":0,"delta":{"content":" RawUnformattedDelta "}}]}';
      const chunk2 = `data: ${chunk2Raw}\n\n`;
      const chunk3 = 'data: [DONE]\n\n';

      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(textEncoder.encode(chunk1));
          controller.enqueue(textEncoder.encode(chunk2));
          controller.enqueue(textEncoder.encode(chunk3));
          controller.close();
        },
      });

      const outputStream = inputStream.pipeThrough(streamTransformer);
      const reader = outputStream.getReader();

      let streamOutput = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamOutput += textDecoder.decode(value, { stream: true });
      }

      // Fast-path bypass streams dataStr verbatim: spaces and formatting are preserved intact
      expect(streamOutput).toContain(chunk2Raw);
      expect(streamOutput).toContain("data: [DONE]\n\n");
    });
  });
});
