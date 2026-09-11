/**
 * eval/stages_rs/types.ts
 *
 * Shared data contracts and types for Responses API (POST /v1/responses) modular onboarding stages.
 */

export interface StageContext {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  runs: number;
  timeoutMs?: number;
}

export interface StageResult {
  stageName: string;
  passed: boolean;
  score: number; // 0 - 100
  details: Record<string, unknown>;
  notes: string[];
  vetoTriggered?: string;
  durationMs?: number;
  completionTokens?: number;
  tokensPerSec?: number;
}

export interface ResponsesToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface FunctionCallOutputItem {
  id?: string;
  type: "function_call";
  status?: string;
  name: string;
  call_id: string;
  arguments: string;
}

export interface MessageContentPart {
  type: "text" | "output_text";
  text: string;
}

export interface MessageOutputItem {
  id?: string;
  type: "message";
  status?: string;
  role: "assistant";
  content: MessageContentPart[];
}

export interface ReasoningOutputItem {
  id?: string;
  type: "reasoning";
  status?: string;
  encrypted_content?: string;
  summary?: unknown[];
}

export type ResponseOutputItem =
  | FunctionCallOutputItem
  | MessageOutputItem
  | ReasoningOutputItem
  | Record<string, unknown>;

export interface ResponsesApiResponse {
  id: string;
  object: "response";
  status: string;
  model: string;
  output: ResponseOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: unknown;
}

/**
 * Helper to extract all function calls from a Responses API output array.
 */
export function extractFunctionCalls(output?: ResponseOutputItem[]): FunctionCallOutputItem[] {
  if (!Array.isArray(output)) return [];
  return output.filter((item): item is FunctionCallOutputItem => item.type === "function_call");
}

/**
 * Helper to extract combined assistant text content from a Responses API output array.
 */
export function extractAssistantText(output?: ResponseOutputItem[]): string {
  if (!Array.isArray(output)) return "";
  return output
    .filter((item): item is MessageOutputItem => item.type === "message")
    .flatMap((msg) => msg.content || [])
    .filter((part) => part.type === "text" || part.type === "output_text")
    .map((part) => part.text)
    .join("");
}
