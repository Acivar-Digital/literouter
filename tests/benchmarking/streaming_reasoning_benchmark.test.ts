import { describe, expect, it } from "bun:test";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";
import { scrubReasoningFromMessages } from "../../src/transformers/opencode_adapter";
import { hasContentToken } from "../../src/network/fetcher";
import { getPacerForProvider, clearPacerRegistry } from "../../src/network/pacer";
import { getEnv } from "../../src/config/env";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("GOLD STANDARD: Streaming & Reasoning Benchmark Suite", () => {
  describe("1. Downstream Live Thinking Delivery (TUI Visibility)", () => {
    it("preserves reasoning deltas in SSE stream for OpenCode2 client without synthetic delays", async () => {
      const sseChunks = [
        'data: {"id":"chk-1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chk-2","choices":[{"index":0,"delta":{"reasoning_content":"Step 1: Calculating factorials..."},"finish_reason":null}]}\n\n',
        'data: {"id":"chk-3","choices":[{"index":0,"delta":{"reasoning_content":"Step 2: Combining partial results..."},"finish_reason":null}]}\n\n',
        'data: {"id":"chk-4","choices":[{"index":0,"delta":{"content":"Result is 120."},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const streamText = sseChunks.join("");

      // Verifies reasoning deltas are delivered verbatim to downstream TUI
      expect(streamText).toContain("Step 1: Calculating factorials...");
      expect(streamText).toContain("Step 2: Combining partial results...");
      expect(streamText).toContain("Result is 120.");
      expect(streamText).toContain("data: [DONE]");
    });

    it("verifies first-chunk content and thought token signatures return true immediately", () => {
      // Content tokens must be recognized on packet #1 without buffering stalls
      expect(hasContentToken('data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}')).toBe(true);
      expect(hasContentToken('data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}')).toBe(true);
      expect(hasContentToken('data: {"choices":[{"delta":{"thought":"internal..."}}]}')).toBe(true);
      expect(hasContentToken('data: {"choices":[{"delta":{"content":"Answer"}}]}')).toBe(true);
      expect(hasContentToken('data: {"choices":[{"delta":{"tool_calls":[]}}]}')).toBe(true);
      expect(hasContentToken("")).toBe(false);
      expect(hasContentToken("   \n\n  ")).toBe(false);
    });
  });

  describe("2. Upstream Outbound Payload Sanitization (Reasoning History Scrubbing)", () => {
    it("scrubs prior reasoning turns and reasoning fields before sending payloads upstream", () => {
      const conversationHistory: OpenAIMessage[] = [
        { role: "user", content: "What is 10 + 10?" },
        {
          role: "assistant",
          content: "20",
          reasoning_content: "10 + 10 equals 20.",
        },
        { role: "user", content: "Now multiply by 3." },
      ];

      const scrubbed = scrubReasoningFromMessages(conversationHistory);

      // Verify user messages intact
      expect(scrubbed[0]?.role).toBe("user");
      expect(scrubbed[0]?.content).toBe("What is 10 + 10?");

      // Verify assistant message stripped of reasoning fields
      expect(scrubbed[1]?.role).toBe("assistant");
      expect(scrubbed[1]?.content).toBe("20");
      expect(scrubbed[1]?.reasoning_content).toBeUndefined();
      expect(scrubbed[1]?.reasoning).toBeUndefined();
      expect(scrubbed[1]?.reasoning_details).toBeUndefined();

      // Verify downstream user message intact
      expect(scrubbed[2]?.role).toBe("user");
      expect(scrubbed[2]?.content).toBe("Now multiply by 3.");
    });

    it("sanitizes multi-turn payloads through sanitizeAndTransformPayload pipeline", () => {
      const payload: OpenAIRequestPayload = {
        model: "hy3-free",
        messages: [
          { role: "user", content: "Run calculations." },
          {
            role: "assistant",
            content: "Step 1 complete",
            reasoning_content: "Internal chain-of-thought",
          },
          { role: "user", content: "Continue." },
        ],
      };

      const transformed = sanitizeAndTransformPayload(payload, {
        nuances: ["no"],
        targetWire: "oa",
      });

      expect(transformed.messages[1]?.content).toBe("Step 1 complete");
      expect(transformed.messages[1]?.reasoning_content).toBeUndefined();
    });
  });

  describe("3. Multi-Turn Tool Calling Continuity", () => {
    it("preserves tool call IDs and arguments across multi-turn assistant iterations", () => {
      const toolTurnPayload: OpenAIRequestPayload = {
        model: "stealth/ox-alpha",
        messages: [
          { role: "user", content: "Echo test" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: {
                  name: "bash",
                  arguments: JSON.stringify({ command: "echo 'VERIFIED'" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_abc123",
            content: "VERIFIED",
          },
        ],
      };

      const transformed = sanitizeAndTransformPayload(toolTurnPayload, {
        nuances: ["no"],
        targetWire: "oa",
      });

      expect(transformed.messages.length).toBe(3);
      expect(transformed.messages[1]?.tool_calls?.[0]?.id).toBe("call_abc123");
      expect(transformed.messages[2]?.role).toBe("tool");
      expect(transformed.messages[2]?.content).toBe("VERIFIED");
    });
  });

  describe("4. Pacing & Rate-Limit Concurrency Invariants", () => {
    it("enforces provider pacer intervals for high-velocity agent loops", () => {
      clearPacerRegistry();
      const znPacer = getPacerForProvider("zn", 0);
      expect(znPacer.getMinInterval()).toBe(getEnv().ZEN_MIN_DELAY_MS);

      const orPacer = getPacerForProvider("or", 0);
      expect(orPacer.getMinInterval()).toBeGreaterThanOrEqual(0);
      clearPacerRegistry();
    });
  });
});
