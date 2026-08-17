import { describe, expect, it } from "bun:test";
import {
  type DirectDirective,
  type FusionDirective,
  isDirectDirective,
  isFusionDirective,
  parseDirective,
} from "../../src/directive/parser";
import {
  DIRECTIVE_ERROR_CODE,
  DIRECTIVE_ERROR_TYPE,
  validateDirective,
} from "../../src/directive/validator";

describe("Directive Parser — Direct Keys", () => {
  it("parses standard OpenRouter claude direct key", () => {
    const parsed = parseDirective("lr-or-cl-ms-no");
    expect(parsed).not.toBeNull();
    expect(isDirectDirective(parsed!)).toBe(true);

    const direct = parsed as DirectDirective;
    expect(direct.provider).toBe("or");
    expect(direct.payload).toBe("cl");
    expect(direct.completion).toBe("ms");
    expect(direct.nuances).toEqual(["no"]);
  });

  it("parses NVIDIA OpenAI-format chat direct key with dot-prompt", () => {
    const parsed = parseDirective("lr-nv-oa-ch-dp");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.provider).toBe("nv");
    expect(direct.payload).toBe("oa");
    expect(direct.completion).toBe("ch");
    expect(direct.nuances).toEqual(["dp"]);
  });

  it("parses Google OpenAI beta direct key", () => {
    const parsed = parseDirective("lr-gg-oa-ob-dp");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.provider).toBe("gg");
    expect(direct.payload).toBe("oa");
    expect(direct.completion).toBe("ob");
    expect(direct.nuances).toEqual(["dp"]);
  });

  it("parses Zen provider direct key", () => {
    const parsed = parseDirective("lr-zn-oa-ch-no");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.provider).toBe("zn");
    expect(direct.payload).toBe("oa");
    expect(direct.completion).toBe("ch");
    expect(direct.nuances).toEqual(["no"]);
  });

  it("parses all registered 2-letter provider codes", () => {
    const providers = ["or", "nv", "gg", "oa", "an", "gq", "cb", "ds", "ms", "tg", "zn"] as const;
    for (const p of providers) {
      const key = `lr-${p}-oa-ch-no`;
      const parsed = parseDirective(key);
      expect(parsed).not.toBeNull();
      expect((parsed as DirectDirective).provider).toBe(p);
    }
  });

  it("parses all registered 2-letter completion codes", () => {
    const completions = ["ch", "ms", "ob", "gc", "im", "em", "au", "md"] as const;
    for (const c of completions) {
      const key = `lr-or-oa-${c}-no`;
      const parsed = parseDirective(key);
      expect(parsed).not.toBeNull();
      expect((parsed as DirectDirective).completion).toBe(c);
    }
  });
});

describe("Directive Parser — Compound Nuances", () => {
  it("parses two compound nuances delimited by plus", () => {
    const parsed = parseDirective("lr-nv-oa-ch-dp+ts");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.nuances).toEqual(["dp", "ts"]);
  });

  it("parses three compound nuances", () => {
    const parsed = parseDirective("lr-gg-oa-ob-dp+ts+g3");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.nuances).toEqual(["dp", "ts", "g3"]);
  });

  it("parses compound nuances with gemma and strip-budget", () => {
    const parsed = parseDirective("lr-or-oa-ch-gm+sb+tc");
    expect(parsed).not.toBeNull();

    const direct = parsed as DirectDirective;
    expect(direct.nuances).toEqual(["gm", "sb", "tc"]);
  });
});

describe("Directive Parser — Fusion Keys", () => {
  it("parses quad fusion preset key", () => {
    const parsed = parseDirective("lr-fse-quad");
    expect(parsed).not.toBeNull();
    expect(isFusionDirective(parsed!)).toBe(true);

    const fusion = parsed as FusionDirective;
    expect(fusion.preset).toBe("quad");
    expect(fusion.type).toBe("fusion");
  });

  it("parses pydn fusion preset key", () => {
    const parsed = parseDirective("lr-fse-pydn");
    expect(parsed).not.toBeNull();

    const fusion = parsed as FusionDirective;
    expect(fusion.preset).toBe("pydn");
  });

  it("parses fast and deep presets", () => {
    const fastParsed = parseDirective("lr-fse-fast");
    const deepParsed = parseDirective("lr-fse-deep");
    expect((fastParsed as FusionDirective).preset).toBe("fast");
    expect((deepParsed as FusionDirective).preset).toBe("deep");
  });
});

describe("Directive Validator — Strict Lowercase & Sanitization", () => {
  it("normalizes uppercase direct keys to lowercase", () => {
    const result = validateDirective("LR-OR-CL-MS-NO");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.directive.raw).toBe("lr-or-cl-ms-no");
      expect((result.directive as DirectDirective).provider).toBe("or");
    }
  });

  it("trims surrounding whitespace and tabs", () => {
    const result = validateDirective("  \t lr-nv-oa-ch-dp \n ");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.directive.raw).toBe("lr-nv-oa-ch-dp");
    }
  });

  it("normalizes uppercase fusion keys", () => {
    const result = validateDirective("LR-FSE-QUAD");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect((result.directive as FusionDirective).preset).toBe("quad");
    }
  });
});

describe("Directive Validator — Zero-Fallback Strict 401 Rejections", () => {
  it("rejects empty or missing key with 401 invalid_api_key", () => {
    const result = validateDirective("");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("Missing API key directive");
    }
  });

  it("rejects standard OpenAI key format without lr prefix", () => {
    const result = validateDirective("sk-proj-1234567890abcdef");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("directive");
    }
  });

  it("rejects incomplete direct key with only 3 segments", () => {
    const result = validateDirective("lr-or-cl-ms");
    expect(result.valid).toBe(false);
  });

  it("rejects unknown provider code", () => {
    const result = validateDirective("lr-xx-oa-ch-no");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("Invalid API key directive");
    }
  });

  it("rejects unknown payload wire code", () => {
    const result = validateDirective("lr-or-zz-ch-no");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("Invalid API key directive");
    }
  });

  it("rejects unknown completion code", () => {
    const result = validateDirective("lr-or-oa-zz-no");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("Invalid API key directive");
    }
  });

  it("rejects invalid nuance modifier in compound list", () => {
    const result = validateDirective("lr-or-oa-ch-dp+invalid");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toContain("Invalid API key directive");
    }
  });
});
