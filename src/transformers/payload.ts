import {
  EMOJI,
  logWarn,
  parseUsageFromJson,
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS,
} from "../config/env";
import { router } from "../index";

const thoughtSignatureStore = new Map<string, string>();

export function injectThoughtSignature(body: any): void {
  if (!body || !body.messages) return;
  for (const msg of body.messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (
          !tc.extra_content?.google?.thought_signature &&
          tc.id &&
          thoughtSignatureStore.has(tc.id)
        ) {
          tc.extra_content = tc.extra_content || {};
          tc.extra_content.google = tc.extra_content.google || {};
          tc.extra_content.google.thought_signature =
            thoughtSignatureStore.get(tc.id)!;
        }
      }
    }
  }
}

export function extractThoughtSignature(data: any): void {
  if (!data) return;
  const toolCalls =
    data.choices?.[0]?.message?.tool_calls || data.choices?.[0]?.delta?.tool_calls;
  if (!toolCalls) return;
  for (const tc of toolCalls) {
    if (tc.id && tc.extra_content?.google?.thought_signature) {
      thoughtSignatureStore.set(
        tc.id,
        tc.extra_content.google.thought_signature,
      );
    }
  }
}

export function estimateTokens(
  promptText: string,
  maxTokens: number = 2048,
): number {
  return Math.floor(promptText.length / 4) + maxTokens;
}

const GEMMA_UNSUPPORTED = new Set([
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "user",
  "seed",
  "logprobs",
  "top_logprobs",
  "thinkingConfig",
  "thinking",
  "thinkingBudget",
]);

export function cleanGemmaPayload(data: any): any {
  if (Array.isArray(data)) return data.map(cleanGemmaPayload);
  if (data !== null && typeof data === "object") {
    const cleaned: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (!GEMMA_UNSUPPORTED.has(k)) {
        cleaned[k] = cleanGemmaPayload(v);
      }
    }
    return cleaned;
  }
  return data;
}

export function cleanLatexSymbols(text: string): string {
  let res = text.replace(/\\{1,2}times\s*(\d+(?:\.\d+)?)/g, "× $1");
  const replacements: [RegExp, string][] = [
    [
      /(\$\\\\rightarrow\$|\\\\rightarrow|\$\\\\to\$|\\\\to|\$\\rightarrow\$|\\rightarrow|\$\\to\$|\\to)/g,
      "→",
    ],
    [/(\$\\\\times\$|\\\\times|\$\\times\$|\\times)/g, "×"],
  ];
  for (const [reg, rep] of replacements) {
    res = res.replace(reg, rep);
  }
  return res;
}

function combineContent(pContent: any, cContent: any): any {
  if (typeof pContent === "string" && typeof cContent === "string") {
    return pContent + "\n\n" + cContent;
  }
  if (Array.isArray(pContent) && Array.isArray(cContent)) {
    return pContent.concat(cContent);
  }
  if (Array.isArray(pContent) && typeof cContent === "string") {
    return pContent.concat([{ type: "text", text: cContent }]);
  }
  if (typeof pContent === "string" && Array.isArray(cContent)) {
    return [{ type: "text", text: pContent }].concat(cContent);
  }
  return String(pContent) + "\n\n" + String(cContent);
}

export function mergeConsecutiveMessages(messages: any[]): any[] {
  if (!messages || !Array.isArray(messages)) return [];
  const merged: any[] = [];
  for (const msg of messages) {
    if (merged.length === 0) {
      merged.push({ ...msg });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev.role === msg.role) {
      prev.content = combineContent(prev.content || "", msg.content || "");
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

export function transformNonStreaming(
  data: any,
  collapseReasoning: boolean,
): any {
  const choices = data.choices || [];
  if (!choices.length) return data;

  const message = choices[0].message || {};
  const rawReasoning =
    message.reasoning_content ||
    message.reasoningContent ||
    message.thought ||
    message.thought_summary;

  let reasoning = "";
  if (typeof rawReasoning === "object" && rawReasoning !== null) {
    reasoning = rawReasoning.reasoningContent || rawReasoning.text || "";
  } else if (typeof rawReasoning === "string") {
    reasoning = rawReasoning;
  }

  delete message.reasoningContent;
  delete message.thought;
  delete message.thought_summary;

  if (reasoning) {
    if (collapseReasoning) {
      const orig = message.content || "";
      message.content = `<thought>\n${reasoning}\n</thought>\n${orig}`;
      message.reasoning_content = null;
    } else {
      message.reasoning_content = reasoning;
    }
  }
  return data;
}

export interface StreamMeta {
  reqId?: string;
  provider: string;
  modelName: string;
  upstream_model: string;
  activeKey: string;
  servedModelId?: string;
  requestStart: number;
}

export function createStreamTransformer(
  collapseReasoning: boolean,
  meta?: StreamMeta,
  sinkUsageFn?: (meta: StreamMeta, usage: any, ttftMs?: number) => void,
  idleTimeoutMs: number = LITEROUTER_STREAM_IDLE_TIMEOUT_MS,
) {
  let buffer = "";
  let hasStartedThought = false;
  let hasEndedThought = false;
  let firstChunk = true;
  let capturedUsage: any = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let idleTimer: any = null;
  let keepAliveTimer: any = null;

  const resetIdleTimer = (controller: TransformStreamDefaultController) => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleTimeoutMs > 0) {
       idleTimer = setTimeout(() => {
         logWarn(
           EMOJI.amber,
           `[STREAM_IDLE_TIMEOUT ${meta?.reqId || ""}] provider=${meta?.provider || ""} model=${meta?.upstream_model || ""} no chunk received for ${idleTimeoutMs}ms, closing stream`,
         );
         if (meta?.provider && meta?.activeKey) {
           router.reportError(
             meta.provider,
             meta.activeKey,
             "timeout",
             meta.upstream_model,
           ).catch(() => {});
         }
         try {
           controller.enqueue(encoder.encode("data: [DONE]\n\n"));
           controller.terminate();
         } catch {}
       }, idleTimeoutMs);
    }
  };

  const startKeepAlive = (controller: TransformStreamDefaultController) => {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      try {
        controller.enqueue(encoder.encode(":\n\n"));
      } catch {}
    }, 15000);
  };

  const stopKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  return new TransformStream({
    start(controller) {
      resetIdleTimer(controller);
      startKeepAlive(controller);
    },
    transform(chunk, controller) {
      resetIdleTimer(controller);
      buffer += cleanLatexSymbols(decoder.decode(chunk, { stream: true }));
      let lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);

            if (firstChunk) {
              firstChunk = false;
              if (meta && sinkUsageFn) {
                sinkUsageFn(meta, null, Date.now() - meta.requestStart);
              }
            }
            const u = parseUsageFromJson(json);
            if (u) capturedUsage = u;

            const choices = json.choices || [];
            if (choices.length > 0) {
              const delta = choices[0].delta || {};
              const rawReasoning =
                delta.reasoning_content ||
                delta.reasoningContent ||
                delta.thought ||
                delta.thought_summary;
              let reasoning = "";
              if (
                typeof rawReasoning === "object" &&
                rawReasoning !== null
              ) {
                reasoning =
                  rawReasoning.reasoningContent || rawReasoning.text || "";
              } else if (typeof rawReasoning === "string") {
                reasoning = rawReasoning;
              }

              delete delta.reasoningContent;
              delete delta.thought;
              delete delta.thought_summary;

              if (reasoning) {
                if (collapseReasoning) {
                  let contentDelta = "";
                  if (!hasStartedThought) {
                    contentDelta += "<thought>\n";
                    hasStartedThought = true;
                  }
                  contentDelta += reasoning;
                  delta.content = contentDelta;
                  delta.reasoning_content = null;
                } else {
                  delta.reasoning_content = reasoning;
                }
              } else if (
                collapseReasoning &&
                hasStartedThought &&
                !hasEndedThought
              ) {
                const standardContent = delta.content;
                if (
                  standardContent ||
                  delta.tool_calls ||
                  delta.function_call
                ) {
                  delta.content = "\n</thought>\n" + (standardContent || "");
                  hasEndedThought = true;
                }
              }
              extractThoughtSignature(json);
              json.choices = choices;
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
            );
          } catch (e) {
            controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
          }
        }
      }
    },
    flush(controller) {
      if (idleTimer) clearTimeout(idleTimer);
      stopKeepAlive();
      if (collapseReasoning && hasStartedThought && !hasEndedThought) {
        const closing = {
          choices: [{ index: 0, delta: { content: "\n</thought>\n" } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(closing)}\n\n`),
        );
      }
      if (meta && sinkUsageFn) sinkUsageFn(meta, capturedUsage);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}
