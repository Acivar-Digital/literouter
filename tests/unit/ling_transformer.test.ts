import { describe, expect, it } from "bun:test";
import {
  LING_KNOWN_TAGS,
  parseLingXml,
  stripLingLeakedTemplateTags,
  stripLingUnclosedTemplateTags,
} from "../../src/transformers/ling";
import { parseDirective } from "../../src/directive/parser";

describe("Ling 1:1 Explicit Mapping Transformer", () => {
  it("recognizes 'lg' nuance directive correctly", () => {
    const direct = parseDirective("lr-or-oa-ch-lg");
    expect(direct).not.toBeNull();
    if (direct && direct.type === "direct") {
      expect(direct.nuances).toContain("lg");
    }

    const multi = parseDirective("lr-or-oa-ch-ts+lg");
    expect(multi).not.toBeNull();
    if (multi && multi.type === "direct") {
      expect(multi.nuances).toContain("ts");
      expect(multi.nuances).toContain("lg");
    }
  });

  it("contains all expected standard Ling/GLM tags in LING_KNOWN_TAGS whitelist", () => {
    expect(LING_KNOWN_TAGS).toContain("<tool_calls>");
    expect(LING_KNOWN_TAGS).toContain("</tool_calls>");
    expect(LING_KNOWN_TAGS).toContain("<arg_key>");
    expect(LING_KNOWN_TAGS).toContain("</arg_key>");
    expect(LING_KNOWN_TAGS).toContain("<arg_value>");
    expect(LING_KNOWN_TAGS).toContain("</arg_value>");
    expect(LING_KNOWN_TAGS).toContain("<think>");
    expect(LING_KNOWN_TAGS).toContain("</think>");
    expect(LING_KNOWN_TAGS).toContain("</role>");
  });

  it("parses unadorned Ling tool calls with exact 1:1 <arg_key>/<arg_value> mapping", () => {
    const raw = `bash<arg_key>command</arg_key><arg_value>git status</arg_value>`;
    const parsed = parseLingXml(raw);

    expect(parsed.cleanText).toBe("");
    expect(parsed.toolCalls.length).toBe(1);
    expect(parsed.toolCalls[0]?.function.name).toBe("bash");
    expect(JSON.parse(parsed.toolCalls[0]?.function.arguments ?? "{}")).toEqual({
      command: "git status",
    });
  });

  it("parses invoke-wrapped Ling tool calls and extracts reasoning content cleanly", () => {
    const raw = `<think>Need to inspect files</think><tool_calls><invoke name="read_file"><parameter_name>path</parameter_name><parameter_value>src/index.ts</parameter_value></invoke></tool_calls>`;
    const parsed = parseLingXml(raw);

    expect(parsed.reasoningContent).toBe("Need to inspect files");
    expect(parsed.toolCalls.length).toBe(1);
    expect(parsed.toolCalls[0]?.function.name).toBe("read_file");
    expect(JSON.parse(parsed.toolCalls[0]?.function.arguments ?? "{}")).toEqual({
      path: "src/index.ts",
    });
  });

  it("preserves math expressions and code comparisons without stripping", () => {
    const code = "for (let i = 0; i < len; i++) { if (x < 5) return true; }";
    const cleaned = stripLingUnclosedTemplateTags(code);
    expect(cleaned).toBe(code);
  });

  it("strips leaked template tags cleanly", () => {
    const leaked = "<role:assistant>Here is your result</role>";
    const cleaned = stripLingLeakedTemplateTags(leaked);
    expect(cleaned).toBe("Here is your result");
  });
});
