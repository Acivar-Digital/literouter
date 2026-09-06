import { describe, expect, it } from "bun:test";
import {
  type DirectDirective,
  extractDirectiveToken,
  isDirectDirective,
  parseDirective,
  validateDirective,
} from "../../src/config/directive";

describe("OpenAI Original (oo) Wire Protocol Directives", () => {
  describe("Valid oo Directives Parsing", () => {
    it("parses Zen Responses oo directive (lr-zn-oo-rs-no)", () => {
      const parsed = parseDirective("lr-zn-oo-rs-no");
      expect(parsed).not.toBeNull();
      expect(isDirectDirective(parsed!)).toBe(true);

      const direct = parsed as DirectDirective;
      expect(direct.provider).toBe("zn");
      expect(direct.payload).toBe("oo");
      expect(direct.endpoint).toBe("rs");
      expect(direct.completion).toBe("rs");
      expect(direct.wire).toBe("oo");
      expect(direct.reasoning).toBe("no");
      expect(direct.nuances).toEqual(["no"]);
      expect(direct.type).toBe("direct");
      expect(direct.raw).toBe("lr-zn-oo-rs-no");
    });

    it("parses OpenRouter Responses oo directive (lr-or-oo-rs-no)", () => {
      const parsed = parseDirective("lr-or-oo-rs-no");
      expect(parsed).not.toBeNull();
      expect(isDirectDirective(parsed!)).toBe(true);

      const direct = parsed as DirectDirective;
      expect(direct.provider).toBe("or");
      expect(direct.payload).toBe("oo");
      expect(direct.endpoint).toBe("rs");
      expect(direct.completion).toBe("rs");
      expect(direct.wire).toBe("oo");
      expect(direct.nuances).toEqual(["no"]);
      expect(direct.type).toBe("direct");
      expect(direct.raw).toBe("lr-or-oo-rs-no");
    });

    it("parses OpenAI Responses oo directive (lr-oa-oo-rs-no)", () => {
      const parsed = parseDirective("lr-oa-oo-rs-no");
      expect(parsed).not.toBeNull();
      expect(isDirectDirective(parsed!)).toBe(true);

      const direct = parsed as DirectDirective;
      expect(direct.provider).toBe("oa");
      expect(direct.payload).toBe("oo");
      expect(direct.endpoint).toBe("rs");
      expect(direct.completion).toBe("rs");
      expect(direct.wire).toBe("oo");
      expect(direct.nuances).toEqual(["no"]);
      expect(direct.type).toBe("direct");
      expect(direct.raw).toBe("lr-oa-oo-rs-no");
    });

    it("parses OpenRouter Chat Completions oo directive (lr-or-oo-ch-no)", () => {
      const parsed = parseDirective("lr-or-oo-ch-no");
      expect(parsed).not.toBeNull();
      expect(isDirectDirective(parsed!)).toBe(true);

      const direct = parsed as DirectDirective;
      expect(direct.provider).toBe("or");
      expect(direct.payload).toBe("oo");
      expect(direct.endpoint).toBe("ch");
      expect(direct.completion).toBe("ch");
      expect(direct.wire).toBe("oo");
      expect(direct.nuances).toEqual(["no"]);
      expect(direct.type).toBe("direct");
      expect(direct.raw).toBe("lr-or-oo-ch-no");
    });
  });

  describe("Validation & Normalization with validateDirective", () => {
    it("validates and normalizes uppercase oo directives", () => {
      const result = validateDirective("LR-ZN-OO-RS-NO");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.directive.raw).toBe("lr-zn-oo-rs-no");
        expect(isDirectDirective(result.directive)).toBe(true);
        const direct = result.directive as DirectDirective;
        expect(direct.provider).toBe("zn");
        expect(direct.payload).toBe("oo");
        expect(direct.wire).toBe("oo");
        expect(direct.endpoint).toBe("rs");
      }
    });

    it("validates oo directive with leading and trailing whitespace", () => {
      const result = validateDirective("   \t  lr-or-oo-rs-no  \n ");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.directive.raw).toBe("lr-or-oo-rs-no");
        const direct = result.directive as DirectDirective;
        expect(direct.provider).toBe("or");
        expect(direct.wire).toBe("oo");
      }
    });

    it("validates compound nuances with oo wire protocol", () => {
      const parsed = parseDirective("lr-zn-oo-rs-dp+ts");
      expect(parsed).not.toBeNull();
      const direct = parsed as DirectDirective;
      expect(direct.payload).toBe("oo");
      expect(direct.wire).toBe("oo");
      expect(direct.endpoint).toBe("rs");
      expect(direct.nuances).toEqual(["dp", "ts"]);
      expect(direct.reasoning).toBe("dp+ts");
    });
  });

  describe("Validation Edge Cases & Rejections", () => {
    it("rejects unknown provider with oo payload", () => {
      const result = validateDirective("lr-xx-oo-rs-no");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid API key directive");
      }
    });

    it("rejects incomplete oo directive missing nuances", () => {
      const result = validateDirective("lr-zn-oo-rs");
      expect(result.valid).toBe(false);
    });

    it("rejects oo directive with invalid completion code", () => {
      const result = validateDirective("lr-zn-oo-invalid-no");
      expect(result.valid).toBe(false);
    });

    it("rejects oo directive with invalid nuance code", () => {
      const result = validateDirective("lr-zn-oo-rs-invalid");
      expect(result.valid).toBe(false);
    });

    it("rejects empty or null key", () => {
      expect(validateDirective("").valid).toBe(false);
      expect(validateDirective(null).valid).toBe(false);
      expect(validateDirective(undefined).valid).toBe(false);
    });

    it("rejects non-lr key prefix", () => {
      const result = validateDirective("sk-zn-oo-rs-no");
      expect(result.valid).toBe(false);
    });
  });

  describe("Token Extraction with oo Directives", () => {
    it("extracts oo directive from Authorization Bearer header", () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        headers: {
          authorization: "Bearer lr-zn-oo-rs-no",
        },
      });
      const token = extractDirectiveToken(req);
      expect(token).toBe("lr-zn-oo-rs-no");
      const validation = validateDirective(token);
      expect(validation.valid).toBe(true);
    });

    it("extracts oo directive from x-api-key header", () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        headers: {
          "x-api-key": "lr-or-oo-rs-no",
        },
      });
      const token = extractDirectiveToken(req);
      expect(token).toBe("lr-or-oo-rs-no");
      const validation = validateDirective(token);
      expect(validation.valid).toBe(true);
    });

    it("extracts oo directive from URL query parameter (?key=)", () => {
      const req = new Request("http://localhost:7766/v1/responses?key=lr-oa-oo-rs-no");
      const token = extractDirectiveToken(req);
      expect(token).toBe("lr-oa-oo-rs-no");
      const validation = validateDirective(token);
      expect(validation.valid).toBe(true);
    });
  });
});
