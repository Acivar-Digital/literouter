/**
 * tests/unit/eval_graders/pydantic_grader.test.ts
 *
 * Hermetic unit tests for Pydantic AI 2.0 schema validation grader
 * exported by eval/stages/stage2_pydantic.ts and eval/stages_rs/stage2_pydantic.ts.
 */

import { describe, expect, it } from "bun:test";
import { validatePayload as validatePayloadChat } from "../../../eval/stages/stage2_pydantic";
import { validatePayload as validatePayloadRs } from "../../../eval/stages_rs/stage2_pydantic";

const implementations = [
  { name: "eval/stages/stage2_pydantic.ts (Chat)", validatePayload: validatePayloadChat },
  { name: "eval/stages_rs/stage2_pydantic.ts (Responses)", validatePayload: validatePayloadRs },
];

describe.each(implementations)("Pydantic Grader Unit Tests - $name", ({ validatePayload }) => {
  const validSample = {
    op: "fetch",
    filter: {
      key: "user_status",
      values: [10, 20, 30],
      is_active: true,
    },
    limit: 50,
  };

  describe("1. Root is not an object", () => {
    it("rejects null root", () => {
      const res = validatePayload(null);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Root is not an object");
    });

    it("rejects undefined root", () => {
      const res = validatePayload(undefined);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Root is not an object");
    });

    it("rejects string root", () => {
      const res = validatePayload("invalid payload");
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Root is not an object");
    });

    it("rejects number root", () => {
      const res = validatePayload(12345);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Root is not an object");
    });

    it("rejects boolean root", () => {
      const res = validatePayload(true);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Root is not an object");
    });
  });

  describe("2. Invalid op", () => {
    it("rejects unknown op 'delete'", () => {
      const payload = { ...validSample, op: "delete" };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid op: delete");
    });

    it("rejects unknown op 'query'", () => {
      const payload = { ...validSample, op: "query" };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid op: query");
    });

    it("rejects missing op", () => {
      const { op: _, ...payload } = validSample;
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid op: undefined");
    });

    it("accepts valid ops 'fetch' and 'mutate'", () => {
      const resFetch = validatePayload({ ...validSample, op: "fetch" });
      expect(resFetch.valid).toBe(true);

      const resMutate = validatePayload({ ...validSample, op: "mutate" });
      expect(resMutate.valid).toBe(true);
    });
  });

  describe("3. Invalid limit", () => {
    it("rejects negative limit", () => {
      const payload = { ...validSample, limit: -5 };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid limit: -5 (must be integer 1-100)");
    });

    it("rejects zero limit", () => {
      const payload = { ...validSample, limit: 0 };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid limit: 0 (must be integer 1-100)");
    });

    it("rejects limit > 100", () => {
      const payload = { ...validSample, limit: 101 };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid limit: 101 (must be integer 1-100)");
    });

    it("rejects string limit", () => {
      const payload = { ...validSample, limit: "50" as unknown as number };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid limit: 50 (must be integer 1-100)");
    });

    it("rejects missing limit", () => {
      const { limit: _, ...payload } = validSample;
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid limit: undefined (must be integer 1-100)");
    });

    it("accepts boundary limits 1 and 100", () => {
      expect(validatePayload({ ...validSample, limit: 1 }).valid).toBe(true);
      expect(validatePayload({ ...validSample, limit: 100 }).valid).toBe(true);
    });
  });

  describe("4. Missing filter object or not an object", () => {
    it("rejects missing filter", () => {
      const { filter: _, ...payload } = validSample;
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Missing filter object");
    });

    it("rejects null filter", () => {
      const payload = { ...validSample, filter: null as unknown as typeof validSample.filter };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Missing filter object");
    });

    it("rejects string filter", () => {
      const payload = { ...validSample, filter: "invalid" as unknown as typeof validSample.filter };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Missing filter object");
    });

    it("rejects number filter", () => {
      const payload = { ...validSample, filter: 42 as unknown as typeof validSample.filter };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Missing filter object");
    });
  });

  describe("5. Invalid filter.key", () => {
    it("rejects non-string filter.key (number)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, key: 123 as unknown as string },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.key must be string");
    });

    it("rejects non-string filter.key (boolean)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, key: true as unknown as string },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.key must be string");
    });

    it("rejects non-string filter.key (null/undefined)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, key: null as unknown as string },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.key must be string");
    });
  });

  describe("6. Invalid filter.is_active", () => {
    it("rejects non-boolean filter.is_active (string)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, is_active: "true" as unknown as boolean },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.is_active must be boolean");
    });

    it("rejects non-boolean filter.is_active (number)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, is_active: 1 as unknown as boolean },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.is_active must be boolean");
    });

    it("rejects non-boolean filter.is_active (null)", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, is_active: null as unknown as boolean },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.is_active must be boolean");
    });
  });

  describe("7. Invalid filter.values", () => {
    it("rejects non-array filter.values", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, values: "not-an-array" as unknown as number[] },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.values must be list of integers");
    });

    it("rejects array containing strings", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, values: [1, "two", 3] as unknown as number[] },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.values must be list of integers");
    });

    it("rejects array containing nulls", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, values: [1, null, 3] as unknown as number[] },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("filter.values must be list of integers");
    });

    it("accepts empty array of numbers", () => {
      const payload = {
        ...validSample,
        filter: { ...validSample.filter, values: [] },
      };
      const res = validatePayload(payload);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe("8. Valid payload passing with zero errors", () => {
    it("accepts canonical valid payload with op: fetch", () => {
      const res = validatePayload(validSample);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("accepts canonical valid payload with op: mutate", () => {
      const res = validatePayload({
        op: "mutate",
        filter: {
          key: "priority",
          values: [0, 1, 2],
          is_active: false,
        },
        limit: 1,
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("accumulates multiple errors on bad payloads", () => {
      const badPayload = {
        op: "delete",
        limit: -10,
        filter: {
          key: 123,
          is_active: "no",
          values: ["a", "b"],
        },
      };
      const res = validatePayload(badPayload);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBe(5);
      expect(res.errors).toContain("Invalid op: delete");
      expect(res.errors).toContain("Invalid limit: -10 (must be integer 1-100)");
      expect(res.errors).toContain("filter.key must be string");
      expect(res.errors).toContain("filter.is_active must be boolean");
      expect(res.errors).toContain("filter.values must be list of integers");
    });
  });
});
