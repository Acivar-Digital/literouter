import type { ParsedDirective } from "../directive/types";
import type {
  OutboundWirePayload,
  PayloadTransformerContract,
} from "../engine/transformer";
import type { RequestTelemetry } from "../telemetry/session";
import { SAFE_CLIENT_PASS_HEADERS } from "../engine/dispatch";

export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
export const DEFAULT_EMBEDDING_BATCH_SIZE = 8;

export interface OpenAIEmbeddingItem {
  object: "embedding";
  embedding: number[];
  index: number;
}

export interface OpenAIEmbeddingResponse {
  object?: string;
  data?: OpenAIEmbeddingItem[];
  model?: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Checks if input is an array of multiple documents (strings or token arrays),
 * rather than a single document represented as an array of token IDs (number[]).
 */
export function isMultiInputBatch(input: unknown): input is unknown[] {
  if (!Array.isArray(input)) {
    return false;
  }
  if (input.length === 0) {
    return false;
  }
  // An array of numbers is treated as token IDs for a single document
  if (typeof input[0] === "number") {
    return false;
  }
  return true;
}

/**
 * Slices an array of inputs into chunks of at most maxBatchSize items.
 */
export function sliceEmbeddingInput<T = unknown>(
  input: T[],
  maxBatchSize: number = DEFAULT_EMBEDDING_BATCH_SIZE
): T[][] {
  if (!Array.isArray(input) || input.length <= maxBatchSize) {
    return [input];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < input.length; i += maxBatchSize) {
    chunks.push(input.slice(i, i + maxBatchSize));
  }
  return chunks;
}

/**
 * Merges multiple OpenAI-compatible embedding responses into a single response,
 * re-indexing data items sequentially and summing token usage.
 */
export function mergeEmbeddingResponses(
  responses: OpenAIEmbeddingResponse[]
): OpenAIEmbeddingResponse {
  if (responses.length === 0) {
    return {
      object: "list",
      data: [],
      model: DEFAULT_EMBEDDING_MODEL,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  }

  const mergedData: OpenAIEmbeddingItem[] = [];
  let totalPromptTokens = 0;
  let totalTokens = 0;
  let currentIndex = 0;

  for (const res of responses) {
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        mergedData.push({
          ...item,
          object: "embedding",
          index: currentIndex++,
        });
      }
    }
    if (res.usage) {
      totalPromptTokens += res.usage.prompt_tokens ?? 0;
      totalTokens += res.usage.total_tokens ?? 0;
    }
  }

  const first = responses[0];
  return {
    object: first?.object ?? "list",
    data: mergedData,
    model: first?.model ?? DEFAULT_EMBEDDING_MODEL,
    usage: {
      prompt_tokens: totalPromptTokens,
      total_tokens: totalTokens,
    },
  };
}

interface UpstreamEmbeddingItem {
  readonly embedding: number[];
  readonly index?: number;
}

function isUpstreamEmbeddingItem(item: unknown): item is UpstreamEmbeddingItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return "embedding" in candidate && Array.isArray(candidate["embedding"]);
}

export class OpenAIEmbeddingsTransformer implements PayloadTransformerContract {
  /**
   * Pure: converts client request body to upstream wire format.
   * Endpoint key: "em", method: "POST", isStreaming: false.
   */
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    _directive: ParsedDirective,
    headers: Headers
  ): OutboundWirePayload {
    const wireHeaders: Record<string, string> = {
      "content-type": "application/json",
    };

    if (headers && typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (SAFE_CLIENT_PASS_HEADERS.has(lower)) {
          wireHeaders[lower] = value;
        }
      });
    }

    let normalizedInput = inboundBody.input;
    if (typeof normalizedInput === "string") {
      // standard single string
    } else if (Array.isArray(normalizedInput)) {
      // array of strings or token IDs
    } else if (normalizedInput === undefined || normalizedInput === null) {
      normalizedInput = "";
    }

    const model =
      typeof inboundBody.model === "string" && inboundBody.model.trim()
        ? inboundBody.model.trim()
        : DEFAULT_EMBEDDING_MODEL;

    const outgoingBody: Record<string, unknown> = {
      ...inboundBody,
      input: normalizedInput,
      model,
    };

    return {
      endpointKey: "em",
      method: "POST",
      headers: wireHeaders,
      body: outgoingBody,
      isStreaming: false,
    };
  }

  /**
   * Pure: converts upstream response to standard OpenAI embedding list format.
   * Handles OpenAI { object: "list", data: [...], model, usage },
   * 2D vector arrays [[...], [...]], or 1D vector arrays [...].
   */
  transformWireToClient(
    upstreamJson: unknown,
    _directive: ParsedDirective
  ): unknown {
    if (!upstreamJson) {
      return {
        object: "list",
        data: [],
        model: DEFAULT_EMBEDDING_MODEL,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      };
    }

    // Upstream returned raw array: [[0.1, ...], ...] or [0.1, 0.2, ...]
    if (Array.isArray(upstreamJson)) {
      if (upstreamJson.length === 0) {
        return {
          object: "list",
          data: [],
          model: DEFAULT_EMBEDDING_MODEL,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        };
      }

      // Check if it's a 1D vector (array of numbers)
      if (typeof upstreamJson[0] === "number") {
        return {
          object: "list",
          data: [
            {
              object: "embedding",
              embedding: upstreamJson,
              index: 0,
            },
          ],
          model: DEFAULT_EMBEDDING_MODEL,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        };
      }

      // 2D vector array (array of number arrays)
      if (Array.isArray(upstreamJson[0])) {
        return {
          object: "list",
          data: upstreamJson.map((vec, idx) => ({
            object: "embedding",
            embedding: vec,
            index: idx,
          })),
          model: DEFAULT_EMBEDDING_MODEL,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        };
      }

      // Array of objects with embedding property
      return {
        object: "list",
        data: upstreamJson.map((item, idx) => {
          if (isUpstreamEmbeddingItem(item)) {
            return {
              object: "embedding",
              embedding: item.embedding,
              index: item.index ?? idx,
            };
          }
          return {
            object: "embedding",
            embedding: item,
            index: idx,
          };
        }),
        model: DEFAULT_EMBEDDING_MODEL,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      };
    }

    if (typeof upstreamJson === "object") {
      const obj = upstreamJson as Record<string, unknown>;

      // If upstream error payload, preserve as-is
      if ("error" in obj) {
        return upstreamJson;
      }

      // Standard OpenAI structure
      if (Array.isArray(obj.data)) {
        return {
          object: obj.object ?? "list",
          data: obj.data,
          model: obj.model ?? DEFAULT_EMBEDDING_MODEL,
          usage: obj.usage ?? { prompt_tokens: 0, total_tokens: 0 },
        };
      }

      // Single embedding object: { embedding: [...] }
      if (isUpstreamEmbeddingItem(obj)) {
        return {
          object: "list",
          data: [
            {
              object: "embedding",
              embedding: obj.embedding,
              index: 0,
            },
          ],
          model: obj.model ?? DEFAULT_EMBEDDING_MODEL,
          usage: obj.usage ?? { prompt_tokens: 0, total_tokens: 0 },
        };
      }

      return {
        object: obj.object ?? "list",
        data: [],
        model: obj.model ?? DEFAULT_EMBEDDING_MODEL,
        usage: obj.usage ?? { prompt_tokens: 0, total_tokens: 0 },
      };
    }

    return upstreamJson;
  }

  /**
   * Passthrough TransformStream for streaming response translation.
   * Embeddings do not stream, but fulfills PayloadTransformerContract.
   */
  createWireToClientStream(
    _directive: ParsedDirective,
    _telemetry: RequestTelemetry,
    _clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream<Uint8Array, Uint8Array>();
  }
}

export const openAiEmbeddingsTransformer = new OpenAIEmbeddingsTransformer();
