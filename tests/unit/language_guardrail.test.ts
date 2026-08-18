import { describe, expect, it } from "bun:test";

const CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/;

const BAZI_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const BAZI_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
const TEN_GODS = ["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"] as const;

interface MetaphysicsPayload {
  readonly pillar: string;
  readonly stem: string;
  readonly branch: string;
  readonly hiddenStems: readonly string[];
  readonly explanation: string;
}

function validateStandardOutput(output: string): { valid: boolean; leak: boolean } {
  const hasChinese = CHINESE_CHAR_REGEX.test(output);
  return {
    valid: !hasChinese,
    leak: hasChinese,
  };
}

function validateBaZiPayload(payload: MetaphysicsPayload): {
  validData: boolean;
  validExplanation: boolean;
} {
  const hasStem = BAZI_STEMS.includes(payload.stem as (typeof BAZI_STEMS)[number]);
  const hasBranch = BAZI_BRANCHES.includes(payload.branch as (typeof BAZI_BRANCHES)[number]);
  const hasHiddenStems = payload.hiddenStems.every((s) =>
    BAZI_STEMS.includes(s as (typeof BAZI_STEMS)[number])
  );
  const isExplanationEnglish = !CHINESE_CHAR_REGEX.test(payload.explanation);

  return {
    validData: hasStem && hasBranch && hasHiddenStems,
    validExplanation: isExplanationEnglish,
  };
}

describe("Multilingual Guardrail & Domain Metaphysics Invariants", () => {
  it("T-01: enforces zero Chinese character leakage in generic code reasoning and comments", () => {
    const genericCodeResponse = `
      // Calculate fibonacci sequence iteratively
      function fibonacci(n: number): number {
        if (n <= 1) return n;
        let a = 0, b = 1;
        for (let i = 2; i <= n; i++) {
          const temp = a + b;
          a = b;
          b = temp;
        }
        return b;
      }
    `;
    const result = validateStandardOutput(genericCodeResponse);
    expect(result.valid).toBe(true);
    expect(result.leak).toBe(false);
  });

  it("T-02: detects and flags Chinese token leakage in code outputs", () => {
    const leakedOutput = `
      // 这是计算斐波那契数列的代码
      function fibonacci(n: number): number { return n; }
    `;
    const result = validateStandardOutput(leakedOutput);
    expect(result.valid).toBe(false);
    expect(result.leak).toBe(true);
  });

  it("T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English", () => {
    const baziOutput: MetaphysicsPayload = {
      pillar: "Month",
      stem: "丙",
      branch: "寅",
      hiddenStems: ["甲", "丙", "戊"],
      explanation: "The month pillar represents the seasonal energy and dominant Qi.",
    };

    const result = validateBaZiPayload(baziOutput);
    expect(result.validData).toBe(true);
    expect(result.validExplanation).toBe(true);
  });

  it("T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist", () => {
    expect(BAZI_STEMS.length).toBe(10);
    expect(BAZI_BRANCHES.length).toBe(12);
    expect(TEN_GODS.length).toBe(10);

    for (const stem of BAZI_STEMS) {
      expect(CHINESE_CHAR_REGEX.test(stem)).toBe(true);
    }
    for (const branch of BAZI_BRANCHES) {
      expect(CHINESE_CHAR_REGEX.test(branch)).toBe(true);
    }
  });
});
