import { describe, expect, it } from "bun:test";
import { resolveUpstreamEndpoint } from "../../src/config/providers";
import { TelemetrySink } from "../../src/ui/telemetry";
import { storeThoughtSignature, getThoughtSignature, clearThoughtSignatures } from "../../src/transformers/thinking";
import { serializeDotsToolCalls } from "../../src/transformers/dots";
import { transformLingRequest } from "../../src/transformers/ling";
import type { OpenAIToolCall } from "../../src/transformers/nuances";

describe("Step 6: URL Path Injection Prevention, Store Bounding & XML Escaping", () => {
  describe("URL Path Injection Prevention", () => {
    it("encodes model parameter to prevent directory traversal and SSRF", () => {
      // Test with Google provider ("gg") which has endpoint template /v1beta/models/{model}:generateContent
      const endpoint = resolveUpstreamEndpoint("gg", "gc", "../../admin/evil");
      expect(endpoint.url).not.toContain("../../admin/evil");
      expect(endpoint.url).toContain("..%2F..%2Fadmin%2Fevil");
      expect(endpoint.rawPath).toContain("..%2F..%2Fadmin%2Fevil");
    });
  });

  describe("Store Bounding (2000 entries cap)", () => {
    it("bounds TelemetrySink ttftStore to 2000 entries", () => {
      // Insert 2005 entries
      for (let i = 0; i < 2005; i++) {
        TelemetrySink.recordTtft(`req_${i}`, i);
      }

      // Oldest entries (req_0 to req_4) should have been evicted
      expect(TelemetrySink.getTtft("req_0")).toBeUndefined();
      expect(TelemetrySink.getTtft("req_1")).toBeUndefined();
      expect(TelemetrySink.getTtft("req_4")).toBeUndefined();

      // Recent entries should remain
      expect(TelemetrySink.getTtft("req_2004")).toBe(2004);
      expect(TelemetrySink.getTtft("req_2000")).toBe(2000);
    });

    it("bounds THOUGHT_SIGNATURE_STORE to 2000 entries", () => {
      clearThoughtSignatures();
      for (let i = 0; i < 2005; i++) {
        storeThoughtSignature(`call_${i}`, `sig_${i}`);
      }

      // Oldest entries should have been evicted
      expect(getThoughtSignature("call_0")).toBeUndefined();
      expect(getThoughtSignature("call_1")).toBeUndefined();
      expect(getThoughtSignature("call_4")).toBeUndefined();

      // Recent entries should remain
      expect(getThoughtSignature("call_2004")).toBe("sig_2004");
      expect(getThoughtSignature("call_2000")).toBe("sig_2000");
      clearThoughtSignatures();
    });
  });

  describe("XML Escaping in Dots & Ling Transformers", () => {
    it("escapes quotes and XML entities in Dots tool calls attributes", () => {
      const toolCalls: OpenAIToolCall[] = [
        {
          id: "call_1",
          type: "function",
          function: {
            name: 'evil_fn" onclick="alert(1)"',
            arguments: JSON.stringify({ 'evil"param': "value" }),
          },
        },
      ];

      const xml = serializeDotsToolCalls(toolCalls);
      expect(xml).not.toContain('name="evil_fn" onclick');
      expect(xml).toContain('name="evil_fn&quot; onclick=&quot;alert(1)&quot;"');
      expect(xml).toContain('<parameter name="evil&quot;param">');
    });

    it("escapes XML characters in Ling tool_response id attribute", () => {
      const res = transformLingRequest({
        model: "ling-model",
        messages: [
          {
            role: "tool",
            tool_call_id: 'call_123" malicious="true',
            content: "output text",
          },
        ],
      });

      const userMsg = res.messages?.[0];
      expect(userMsg?.role).toBe("user");
      const content = String(userMsg?.content ?? "");
      expect(content).not.toContain('id="call_123" malicious="true"');
      expect(content).toContain('id="call_123&quot; malicious=&quot;true"');
    });
  });
});
