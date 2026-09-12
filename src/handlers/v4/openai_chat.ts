import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
import { parseDirectiveKey } from "../../directive/parser";
import { openAiChatTransformer } from "../../transformers/openai_chat";

export async function handleOpenAiChat(
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

  const outboundPayload = openAiChatTransformer.transformClientToWire(body, directive, req.headers);
  const dispatchReq: DispatchRequest = {
    reqId,
    method: req.method,
    path: new URL(req.url).pathname,
    directive,
    rawInboundBody: body,
    outboundPayload,
    clientSignal: req.signal,
    clientHeaders: req.headers,
    transformer: openAiChatTransformer,
  };

  return executeDispatchPipeline(dispatchReq);
}

export const handleV4OpenAIChat = handleOpenAiChat;
