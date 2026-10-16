import { describe, expect, it } from "bun:test";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("LaTeX and Code Preservation", () => {
  it("preserves LaTeX math commands and arrows verbatim in user messages", () => {
    const rawContent = "Calculate 3 \\times 10^8 and let A \\rightarrow B. Also a \\leq b and c \\geq d.";
    const payload: OpenAIRequestPayload = {
      model: "test-model",
      messages: [
        { role: "user", content: rawContent },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload);
    expect(transformed.messages[0]!.content).toBe(rawContent);
    expect(transformed.messages[0]!.content).not.toContain("×");
    expect(transformed.messages[0]!.content).not.toContain("→");
  });

  it("preserves regex patterns and escape sequences in programming code snippets", () => {
    const codeSnippet = "const re = /\\times|\\rightarrow|\\alpha/g; return a \\pm b;";
    const payload: OpenAIRequestPayload = {
      model: "test-model",
      messages: [
        { role: "user", content: codeSnippet },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload);
    expect(transformed.messages[0]!.content).toBe(codeSnippet);
  });
});
