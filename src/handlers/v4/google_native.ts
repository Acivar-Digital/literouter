import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
import { parseDirectiveKey } from "../../directive/parser";
import { googleNativeTransformer } from "../../transformers/google_native";

export async function handleGoogleNative(
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

  const outboundPayload = googleNativeTransformer.transformClientToWire(body, directive, req.headers);
  const dispatchReq: DispatchRequest = {
    reqId,
    method: req.method,
    path: new URL(req.url).pathname,
    directive,
    rawInboundBody: body,
    outboundPayload,
    clientSignal: req.signal,
    clientHeaders: req.headers,
    transformer: googleNativeTransformer,
  };

  return executeDispatchPipeline(dispatchReq);
}

export const handleV4GoogleNative = handleGoogleNative;
