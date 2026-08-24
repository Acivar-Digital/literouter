import { z } from "zod";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const StrictOpenAIDeltaSchema = z.object({
  role: z.string().optional(),
  content: z.string().optional(), // Strictly string | undefined; null will trigger ZodError!
  reasoning: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number().optional(),
        id: z.string().optional(),
        type: z.string().optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

export const StrictOpenAIChunkSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.number(),
        delta: StrictOpenAIDeltaSchema,
        finish_reason: z.string().nullable().optional(),
      })
    )
    .optional(),
  usage: z.any().optional(),
});

async function runProbe() {
  console.log("=== Running Vercel AI SDK / Zod Stream Parser Probe ===");

  // 1. Synthetic validations
  console.log("\n[1/3] Testing synthetic chunks...");
  const syntheticTestCases = [
    {
      name: "Empty delta choice",
      chunk: { choices: [{ index: 0, delta: {} }] },
    },
    {
      name: "Heartbeat chunk with null finish_reason",
      chunk: {
        id: "chatcmpl-heartbeat",
        object: "chat.completion.chunk",
        created: 1787569411,
        model: "heartbeat",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      },
    },
    {
      name: "Reasoning delta chunk",
      chunk: {
        id: "chunk-reasoning",
        object: "chat.completion.chunk",
        created: 1787569412,
        model: "stealth/ox-alpha",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", reasoning: "Thinking step..." },
            finish_reason: null,
          },
        ],
      },
    },
    {
      name: "Tool call delta chunk",
      chunk: {
        id: "chunk-tool",
        object: "chat.completion.chunk",
        created: 1787569413,
        model: "stealth/ox-alpha",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: { name: "get_weather", arguments: "{\"" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
    },
  ];

  for (const testCase of syntheticTestCases) {
    try {
      StrictOpenAIChunkSchema.parse(testCase.chunk);
      console.log(`  ✓ Passed synthetic case: ${testCase.name}`);
    } catch (err) {
      console.error(`  ✗ Failed synthetic case: ${testCase.name}`, err);
      process.exit(1);
    }
  }

  // 2. Determine Gateway Endpoint
  console.log("\n[2/3] Connecting to LiteRouter Gateway...");
  const endpoints = [
    "https://localhost:7766/v1/chat/completions",
    "http://localhost:7766/v1/chat/completions",
  ];

  let response: Response | null = null;
  let activeUrl = "";

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-or-oa-ch-no",
          "User-Agent": "@opencode-ai/cli/2.0.0-beta.1",
        },
        body: JSON.stringify({
          model: "stealth/ox-alpha",
          messages: [
            {
              role: "user",
              content: "Respond with exactly two short words for testing streaming parser.",
            },
          ],
          stream: true,
        }),
      });

      if (res.ok && res.body) {
        response = res;
        activeUrl = url;
        break;
      } else {
        console.warn(`Endpoint ${url} returned status ${res.status}`);
      }
    } catch (err: unknown) {
      console.warn(`Could not connect to ${url}: ${(err as Error).message}`);
    }
  }

  if (!response || !response.body) {
    console.error("Failed to connect to LiteRouter streaming endpoint on either https or http");
    process.exit(1);
  }

  console.log(`  ✓ Connected to ${activeUrl} (status: ${response.status})`);

  // 3. Stream & Validate Chunks
  console.log("\n[3/3] Parsing and validating live SSE stream chunks...");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let chunkCount = 0;
  let validatedChunks = 0;
  let doneReceived = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          // SSE comment or keep-alive
          continue;
        }

        if (trimmed === "data: [DONE]") {
          doneReceived = true;
          continue;
        }

        if (trimmed.startsWith("data:")) {
          const rawData = trimmed.slice(5).trim();
          if (rawData === "[DONE]") {
            doneReceived = true;
            continue;
          }

          chunkCount++;
          let json: unknown;
          try {
            json = JSON.parse(rawData);
          } catch (err) {
            console.error(`Malformed JSON in SSE line: "${trimmed}"`, err);
            throw err;
          }

          // Strict validation via Zod
          const parseResult = StrictOpenAIChunkSchema.safeParse(json);
          if (!parseResult.success) {
            console.error(`\n[ZodError] Schema violation on chunk #${chunkCount}:`);
            console.error(JSON.stringify(json, null, 2));
            console.error(parseResult.error.format());
            throw parseResult.error;
          }

          validatedChunks++;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log("\n=== Probe Summary ===");
  console.log(`- Total SSE data chunks received: ${chunkCount}`);
  console.log(`- Validated chunks against StrictOpenAIChunkSchema: ${validatedChunks}`);
  console.log(`- Received [DONE] terminator: ${doneReceived}`);
  console.log(`- Zod Schema Errors: 0`);

  if (chunkCount === 0 || validatedChunks === 0) {
    console.error("Error: Zero chunks received or validated from live stream.");
    process.exit(1);
  }

  console.log("\n✓ All Vercel AI SDK / Zod Stream Parser Probe checks passed successfully!");
}

if (import.meta.main) {
  runProbe().catch((err) => {
    console.error("Probe execution failed:", err);
    process.exit(1);
  });
}
