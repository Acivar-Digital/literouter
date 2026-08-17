import { describe, expect, it } from "bun:test";
import { extractDirectiveToken, validateDirective } from "../../src/directive/validator";

describe("Auth Extractor — Waterfall Extraction Channels", () => {
  it("extracts directive from standard Authorization Bearer header", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      headers: { authorization: "Bearer lr-or-cl-ms-no" },
    });
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-or-cl-ms-no");
  });

  it("extracts directive from case-insensitive bearer prefix", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      headers: { authorization: "bearer lr-nv-oa-ch-dp" },
    });
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-nv-oa-ch-dp");
  });

  it("extracts directive from x-api-key header (Anthropic format)", () => {
    const req = new Request("http://localhost:7766/v1/messages", {
      headers: { "x-api-key": "lr-an-cl-ms-no" },
    });
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-an-cl-ms-no");
  });

  it("extracts directive from URL query parameter ?key= (Google format)", () => {
    const req = new Request(
      "http://localhost:7766/v1beta/models/gemini-2.5-pro:generateContent?key=lr-gg-gg-gc-no"
    );
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-gg-gg-gc-no");
  });

  it("extracts directive from URL query parameter ?api_key=", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions?api_key=lr-cb-oa-ch-no");
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-cb-oa-ch-no");
  });

  it("extracts directive from URL query parameter ?token=", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions?token=lr-fse-quad");
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-fse-quad");
  });
});

describe("Auth Extractor — Waterfall Precedence & Edge Cases", () => {
  it("prioritizes Authorization Bearer over x-api-key header", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      headers: {
        authorization: "Bearer lr-or-cl-ms-no",
        "x-api-key": "lr-nv-oa-ch-no",
      },
    });
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-or-cl-ms-no");
  });

  it("prioritizes headers over URL query parameters", () => {
    const req = new Request("http://localhost:7766/v1/messages?key=lr-gg-oa-ob-dp", {
      headers: { "x-api-key": "lr-an-cl-ms-no" },
    });
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-an-cl-ms-no");
  });

  it("prioritizes ?key= over ?api_key= in query parameters", () => {
    const req = new Request(
      "http://localhost:7766/v1/chat/completions?key=lr-gg-oa-ob-dp&api_key=lr-or-oa-ch-no"
    );
    const token = extractDirectiveToken(req);
    expect(token).toBe("lr-gg-oa-ob-dp");
  });

  it("returns null when no authorization mechanism is present", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions");
    const token = extractDirectiveToken(req);
    expect(token).toBeNull();
  });

  it("passes extracted token cleanly to validator for schema verification", () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      headers: { authorization: "Bearer lr-gg-oa-ob-dp+ts" },
    });
    const token = extractDirectiveToken(req);
    expect(token).not.toBeNull();

    const validation = validateDirective(token);
    expect(validation.valid).toBe(true);
  });
});
