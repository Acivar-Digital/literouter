import { readFileSync } from "fs";
import { resolve } from "path";

// Load GROQ_API_KEYS from .env.local without touching or mutating the file
function getGroqKey(): string {
  const envPath = resolve(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/GROQ_API_KEYS=([^\r\n]+)/);
  if (!match || !match[1]) {
    throw new Error("GROQ_API_KEYS not found in .env.local");
  }
  const keys = match[1].split(",").map((k) => k.trim()).filter(Boolean);
  const firstKey = keys[0];
  if (!firstKey) {
    throw new Error("No valid Groq keys found in GROQ_API_KEYS");
  }
  return firstKey;
}

interface TestResult {
  model: string;
  hasReasoningField: boolean;
  reasoningFieldLength: number;
  reasoningSnippet: string;
  contentLength: number;
  contentSnippet: string;
  hasThinkTagsInContent: boolean;
  reasoningTokens: number;
  totalTokens: number;
  isReasoningOffByDefault: boolean;
  status: string;
}

const MODELS = [
  "openai/gpt-oss-safeguard-20b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
];

async function testGroqModel(model: string, apiKey: string): Promise<TestResult> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: "Solve step by step: How many times does the letter 'r' appear in the word 'strawberry'?",
      },
    ],
    max_tokens: 300,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    return {
      model,
      hasReasoningField: false,
      reasoningFieldLength: 0,
      reasoningSnippet: "",
      contentLength: 0,
      contentSnippet: "",
      hasThinkTagsInContent: false,
      reasoningTokens: 0,
      totalTokens: 0,
      isReasoningOffByDefault: false,
      status: `HTTP ${res.status}: ${errorText.slice(0, 100)}`,
    };
  }

  const data = (await res.json()) as any;
  const choice = data.choices?.[0];
  const message = choice?.message ?? {};
  const reasoning = message.reasoning ?? message.reasoning_content ?? "";
  const content = message.content ?? "";
  const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? 0;

  const hasReasoningField = typeof reasoning === "string" && reasoning.length > 0;
  const hasThinkTagsInContent = content.includes("<think>");
  const hasReasoningTokens = reasoningTokens > 0;

  const isReasoningOffByDefault = !hasReasoningField && !hasThinkTagsInContent && !hasReasoningTokens;

  return {
    model,
    hasReasoningField,
    reasoningFieldLength: reasoning.length,
    reasoningSnippet: reasoning.slice(0, 80).replace(/\n/g, " "),
    contentLength: content.length,
    contentSnippet: content.slice(0, 80).replace(/\n/g, " "),
    hasThinkTagsInContent,
    reasoningTokens,
    totalTokens,
    isReasoningOffByDefault,
    status: "200 OK",
  };
}

async function main() {
  console.log("================================================================================");
  console.log(" GROQ DEFAULT REASONING BEHAVIOR TEST SUITE");
  console.log(" Direct upstream probe against api.groq.com (no reasoning parameters sent)");
  console.log("================================================================================\n");

  const apiKey = getGroqKey();
  const results: TestResult[] = [];

  for (const model of MODELS) {
    process.stdout.write(`Testing ${model} ... `);
    try {
      const result = await testGroqModel(model, apiKey);
      results.push(result);
      console.log(`[${result.status}]`);
    } catch (err: any) {
      console.log(`[FAILED: ${err.message}]`);
    }
    // Small delay to respect rate limits
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" EMPIRICAL RESULTS SUMMARY");
  console.log("--------------------------------------------------------------------------------");

  for (const r of results) {
    console.log(`\nModel: ${r.model}`);
    console.log(`  - Status: ${r.status}`);
    console.log(`  - Has message.reasoning field: ${r.hasReasoningField} (len: ${r.reasoningFieldLength})`);
    if (r.hasReasoningField) {
      console.log(`    Snippet: "${r.reasoningSnippet}..."`);
    }
    console.log(`  - Has <think> in content: ${r.hasThinkTagsInContent}`);
    console.log(`  - Reasoning tokens billed: ${r.reasoningTokens}`);
    console.log(`  - Total tokens: ${r.totalTokens}`);
    console.log(`  - Content length: ${r.contentLength}`);
    console.log(`  - Content snippet: "${r.contentSnippet}..."`);
    console.log(`  => REASONING OFF BY DEFAULT? ${r.isReasoningOffByDefault ? "YES (OFF)" : "NO (ON)"}`);
  }

  console.log("\n================================================================================");
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
