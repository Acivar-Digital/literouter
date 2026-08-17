import { describe, expect, it } from "bun:test";
import {
  createDotsStreamState,
  parseDotsXml,
  processDotsStreamChunk,
} from "../../src/transformers/dots";

describe("Dots XML Transformer — Static Parsing", () => {
  it("parses single XML function invocation into OpenAI tool_calls structure", () => {
    const input =
      'I will look up the weather for you: <invoke name="get_weather"><parameter name="location">Tokyo</parameter></invoke>';
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText.trim()).toBe("I will look up the weather for you:");
    expect(parsed.toolCalls.length).toBe(1);

    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("get_weather");

    const args = JSON.parse(call.function.arguments);
    expect(args.location).toBe("Tokyo");
  });

  it("parses XML invocation with multiple parameters", () => {
    const input =
      '<invoke name="search_database"><parameter name="query">SELECT *</parameter><parameter name="limit">10</parameter></invoke>';
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText).toBe("");
    expect(parsed.toolCalls.length).toBe(1);

    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("search_database");

    const args = JSON.parse(call.function.arguments);
    expect(args.query).toBe("SELECT *");
    expect(args.limit).toBe(10);
  });

  it("passes through text without XML invocations untouched", () => {
    const input = "This is a plain response with no tool calls.";
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText).toBe(input);
    expect(parsed.toolCalls.length).toBe(0);
  });
});

describe("Dots XML Transformer — Streaming Chunk Handling", () => {
  it("handles XML tags split across chunk boundaries", () => {
    const state = createDotsStreamState();

    const chunk1 = 'Checking forecast: <invoke name="get_';
    const chunk2 = 'weather"><parameter name="city">Berlin</parameter></invoke> Done!';

    const out1 = processDotsStreamChunk(chunk1, state);
    const out2 = processDotsStreamChunk(chunk2, state);

    expect(out1).toContain("Checking forecast: ");
    expect(out2).toContain("tool_calls");
    expect(out2).toContain("get_weather");
    expect(out2).toContain("Berlin");
    expect(out2).toContain("Done!");
  });
});
