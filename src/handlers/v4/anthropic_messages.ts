import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
import { parseDirectiveKey } from "../../directive/parser";
import { anthropicMessagesTransformer } from "../../transformers/anthropic_messages";
import { anthropicOpenAiXWireTransformer } from "../../transformers/anthropic_openai_xwire";

export async function handleAnthropicMessages(
  req: Request,
  rawKey: string,
  reqId: string = crypto.randomUUID()
): Promise<Response> {
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

  const directive = parseDirectiveKey(rawKey);
  if (!directive) {
    return Response.json(
      { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const isAo = directive.type === "direct" && directive.wire === "ao";
  const transformer = isAo ? anthropicOpenAiXWireTransformer : anthropicMessagesTransformer;
  const outboundPayload = transformer.transformClientToWire(body, directive, req.headers);
  const dispatchReq: DispatchRequest = {
    reqId,
    method: req.method,
    path: new URL(req.url).pathname,
    directive,
    rawInboundBody: body,
    outboundPayload,
    clientSignal: req.signal,
    clientHeaders: req.headers,
    transformer,
  };

  return executeDispatchPipeline(dispatchReq);
}

export const handleV4AnthropicMessages = handleAnthropicMessages;
