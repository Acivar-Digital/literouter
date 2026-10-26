import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
import { parseDirectiveKey } from "../../directive/parser";
import {
  openAiEmbeddingsTransformer,
  sliceEmbeddingInput,
  mergeEmbeddingResponses,
  isMultiInputBatch,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  type OpenAIEmbeddingResponse,
} from "../../transformers/openai_embeddings";

export const DEFAULT_EMBEDDING_DIRECTIVE = "lr-tei-oa-em-no";

export async function handleOpenAiEmbeddings(
  req: Request,
  rawKey: string,
  reqId: string = crypto.randomUUID()
): Promise<Response> {
  const effectiveRawKey = !rawKey || !rawKey.trim() ? DEFAULT_EMBEDDING_DIRECTIVE : rawKey.trim();

  let body: Record<string, unknown> = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
        { status: 400 }
      );
    }
  }

  const directive = parseDirectiveKey(effectiveRawKey);
  if (!directive) {
    return Response.json(
      { error: { message: `Invalid directive: ${effectiveRawKey}`, type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  if (directive.type === "direct" && directive.endpoint && directive.endpoint !== "em") {
    return Response.json(
      {
        error: {
          message: `Endpoint mismatch: Directive specifies non-embeddings API (-${directive.endpoint}-). Use /v1/embeddings with -em-.`,
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }

  let pathname = "/v1/embeddings";
  const parsedUrl = new URL(req.url, "http://localhost");
  pathname = parsedUrl.pathname;

  // Handle batch slicing for arrays with > 8 inputs
  if (isMultiInputBatch(body.input) && body.input.length > DEFAULT_EMBEDDING_BATCH_SIZE) {
    const chunks = sliceEmbeddingInput(body.input, DEFAULT_EMBEDDING_BATCH_SIZE);
    const chunkResponses: OpenAIEmbeddingResponse[] = [];

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const chunkBody: Record<string, unknown> = {
        ...body,
        input: chunk,
      };

      const outboundPayload = openAiEmbeddingsTransformer.transformClientToWire(
        chunkBody,
        directive,
        req.headers
      );

      const chunkReqId = `${reqId}_chunk${chunkIdx}`;
      const dispatchReq: DispatchRequest = {
        reqId: chunkReqId,
        method: req.method,
        path: pathname,
        directive,
        rawInboundBody: chunkBody,
        outboundPayload,
        clientSignal: req.signal,
        clientHeaders: req.headers,
        transformer: openAiEmbeddingsTransformer,
      };

      const chunkRes = await executeDispatchPipeline(dispatchReq);
      if (chunkRes.status >= 400) {
        return chunkRes;
      }

      const chunkJson = (await chunkRes.json()) as OpenAIEmbeddingResponse;
      chunkResponses.push(chunkJson);
    }

    const merged = mergeEmbeddingResponses(chunkResponses);
    return Response.json(merged, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": reqId,
      },
    });
  }

  const outboundPayload = openAiEmbeddingsTransformer.transformClientToWire(
    body,
    directive,
    req.headers
  );

  const dispatchReq: DispatchRequest = {
    reqId,
    method: req.method,
    path: pathname,
    directive,
    rawInboundBody: body,
    outboundPayload,
    clientSignal: req.signal,
    clientHeaders: req.headers,
    transformer: openAiEmbeddingsTransformer,
  };

  return executeDispatchPipeline(dispatchReq);
}

export const handleV4OpenAIEmbeddings = handleOpenAiEmbeddings;
