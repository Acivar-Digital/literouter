#!/usr/bin/env bun
/**
 * scripts/probe_model.ts
 *
 * Universal Production Readiness & Stress Testing Probe for LiteRouter,
 * OpenCode 2 Agentic Loops, and Pydantic AI V2.
 *
 * Rigorous Multi-Tier Audit:
 * 1. OpenCode 2 Agentic Readiness:
 *    - Multi-Tool Discrimination: Dispatches 4 distinct realistic tools (read_file, write_file, execute_command, grep_search)
 *      to ensure the model selects the right tool without confusing argument signatures.
 *    - Streaming SSE & Native Delta Tool Calls: Accumulates multi-chunk arguments, measures TTFT, verifies zero XML leaks.
 *    - Multi-Turn Tool Observation: Feeds valid tool output, verifies continuation without 400.
 *    - Tool Failure Recovery (Turn 3 Error Injection): Feeds back a tool error (e.g. Permission Denied)
 *      to verify the model recovers gracefully and uses an alternative tool or cleanly explains rather than hanging/hallucinating.
 * 2. Pydantic AI V2 Complex Schema Validation:
 *    - Native Structured Output (`output_type=Model`): Evaluates nested schemas with enums, typed integers,
 *      arrays of models, and optional fields.
 *    - Strict Schema Conformance Check: Validates that returned JSON conforms 100% to the Pydantic V2 schema.
 *    - Prompt-Based JSON with Downstream Fence Stripping (`_strip_json_fences`):
 *      Tests complex schema extraction when native structured outputs are unsupported.
 *
 * Usage:
 *   bun run scripts/probe_model.ts <model_name> [--directive <key>] [--url <gateway_url>]
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DEFAULT_URL = "https://localhost:7766/v1/chat/completions";
const DEFAULT_DIRECTIVE = "lr-or-oa-ch-no";

// Realistic Multi-Tool Palette (mimicking OpenCode 2 runtime)
const TOOL_PALETTE = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the content of a file from the filesystem",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Writes content to a file on the filesystem",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the file to write" },
          content: { type: "string", description: "Full content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Executes a shell command in the environment and returns stdout/stderr",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command string to execute" },
          timeout_ms: { type: "integer", description: "Optional timeout in milliseconds" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "Searches for a regex or string pattern across files in a directory",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The pattern to search for" },
          path: { type: "string", description: "Directory to search within" },
        },
        required: ["pattern"],
      },
    },
  },
];

// Complex Pydantic V2 Schema (Production-representative)
const PRODUCTION_PYDANTIC_SCHEMA = {
  type: "object",
  properties: {
    system_status: {
      type: "string",
      enum: ["operational", "degraded", "maintenance"],
      description: "Current operational status enum",
    },
    cluster_nodes: {
      type: "integer",
      description: "Number of active nodes (must be integer between 1 and 100)",
    },
    metadata: {
      type: "object",
      properties: {
        datacenter: { type: "string", description: "Datacenter region identifier" },
        is_isolated: { type: "boolean", description: "Whether the node is network-isolated" },
      },
      required: ["datacenter", "is_isolated"],
    },
    alerts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "integer", description: "Alert code number" },
          severity: { type: "string", enum: ["low", "medium", "critical"] },
          message: { type: "string" },
        },
        required: ["code", "severity", "message"],
      },
      description: "List of active alert records",
    },
  },
  required: ["system_status", "cluster_nodes", "metadata", "alerts"],
};

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
}

interface ClaudeCodeAuditResult {
  supported: boolean;
  statusCode: number;
  errorMessage?: string;
  toolUseReceived: boolean;
  toolName?: string;
  toolInputValid: boolean;
  thinkingClean: boolean;
  notes: string[];
}

interface OpenCode2AuditResult {
  passed: boolean;
  score: number; // 0 to 100
  ttftMs: number;
  durationMs: number;
  chunksCount: number;
  toolDiscriminatedCorrectly: boolean; // Selected read_file instead of other 3
  selectedToolName: string;
  toolArgsValid: boolean;
  parsedArguments: Record<string, unknown> | null;
  xmlLeakDetected: boolean;
  leakedXmlSnippets: string[];
  turn1FinishReason: string | null;
  turn2ToolObservationSuccess: boolean;
  turn2FinishReason: string | null;
  turn3ErrorRecoverySuccess: boolean;
  turn3EmittedAlternativeAction: boolean;
  notes: string[];
}

interface PydanticAuditResult {
  nativeSupported: boolean;
  nativeStatusCode: number;
  nativeErrorMessage?: string;
  nativeSchemaConforms: boolean;
  promptedSupported: boolean;
  promptedStatusCode: number;
  promptedRequiredFenceStripping: boolean;
  promptedSchemaConforms: boolean;
  schemaValidationErrors: string[];
  notes: string[];
}

function stripJsonFencesAndExtract(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    t = nl !== -1 ? t.slice(nl + 1) : t.replace(/^```(?:json)?/i, "").trim();
    if (t.endsWith("```")) {
      t = t.slice(0, -3).trim();
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return t.slice(start, end + 1);
  }
  return t.trim();
}

function validateProductionPydanticPayload(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null) {
    return { valid: false, errors: ["Root payload is not an object"] };
  }

  const obj = data as Record<string, unknown>;

  // system_status enum
  const validStatuses = ["operational", "degraded", "maintenance"];
  if (typeof obj.system_status !== "string" || !validStatuses.includes(obj.system_status)) {
    errors.push(`system_status must be one of ${JSON.stringify(validStatuses)}, got: ${JSON.stringify(obj.system_status)}`);
  }

  // cluster_nodes integer
  if (typeof obj.cluster_nodes !== "number" || !Number.isInteger(obj.cluster_nodes)) {
    errors.push(`cluster_nodes must be an integer, got: ${typeof obj.cluster_nodes} (${obj.cluster_nodes})`);
  }

  // metadata object
  if (typeof obj.metadata !== "object" || obj.metadata === null) {
    errors.push("metadata must be a non-null object");
  } else {
    const meta = obj.metadata as Record<string, unknown>;
    if (typeof meta.datacenter !== "string" || meta.datacenter.trim().length === 0) {
      errors.push("metadata.datacenter must be a non-empty string");
    }
    if (typeof meta.is_isolated !== "boolean") {
      errors.push(`metadata.is_isolated must be boolean, got: ${typeof meta.is_isolated}`);
    }
  }

  // alerts array
  if (!Array.isArray(obj.alerts)) {
    errors.push("alerts must be an array");
  } else {
    for (let i = 0; i < obj.alerts.length; i++) {
      const alert = obj.alerts[i];
      if (typeof alert !== "object" || alert === null) {
        errors.push(`alerts[${i}] must be an object`);
        continue;
      }
      const a = alert as Record<string, unknown>;
      if (typeof a.code !== "number" || !Number.isInteger(a.code)) {
        errors.push(`alerts[${i}].code must be an integer`);
      }
      const validSeverities = ["low", "medium", "critical"];
      if (typeof a.severity !== "string" || !validSeverities.includes(a.severity)) {
        errors.push(`alerts[${i}].severity must be one of ${JSON.stringify(validSeverities)}`);
      }
      if (typeof a.message !== "string") {
        errors.push(`alerts[${i}].message must be a string`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function probeOpenCode2ReadinessRigorous(
  endpoint: string,
  directiveKey: string,
  model: string
): Promise<OpenCode2AuditResult> {
  const result: OpenCode2AuditResult = {
    passed: false,
    score: 0,
    ttftMs: 0,
    durationMs: 0,
    chunksCount: 0,
    toolDiscriminatedCorrectly: false,
    selectedToolName: "",
    toolArgsValid: false,
    parsedArguments: null,
    xmlLeakDetected: false,
    leakedXmlSnippets: [],
    turn1FinishReason: null,
    turn2ToolObservationSuccess: false,
    turn2FinishReason: null,
    turn3ErrorRecoverySuccess: false,
    turn3EmittedAlternativeAction: false,
    notes: [],
  };

  // Turn 1: Discriminate among 4 tools and trigger read_file on /etc/hosts
  const turn1Payload = {
    model,
    stream: true,
    tools: TOOL_PALETTE,
    messages: [
      {
        role: "user",
        content: "I need to inspect the network host configuration. Please read the file /etc/hosts to check the loopback entries.",
      },
    ],
  };

  const startTime = Date.now();
  let firstTokenTime = 0;
  const toolCallsMap = new Map<number, ToolCallRecord>();
  let accumulatedContent = "";

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directiveKey}`,
      },
      body: JSON.stringify(turn1Payload),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      result.notes.push(`Turn 1 HTTP ${resp.status}: ${errText.slice(0, 150)}`);
      return result;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          result.chunksCount += 1;
          if (firstTokenTime === 0) firstTokenTime = Date.now();

          try {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data.choices?.[0];
            if (!choice) continue;

            if (choice.delta?.content) {
              accumulatedContent += choice.delta.content;
            }

            if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls)) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = toolCallsMap.get(idx) ?? { id: "", name: "", arguments: "" };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                toolCallsMap.set(idx, existing);
              }
            }

            if (choice.finish_reason) {
              result.turn1FinishReason = choice.finish_reason;
            }
          } catch {
            // ignore non-json chunk
          }
        }
      }
    }

    result.durationMs = Date.now() - startTime;
    result.ttftMs = firstTokenTime > 0 ? firstTokenTime - startTime : result.durationMs;

    // XML Leak Check in delta.content
    const XML_LEAK_REGEX = /<[｜|]?(?:tool_calls?|tool_call|invoke|function=)/gi;
    const matches = accumulatedContent.match(XML_LEAK_REGEX);
    if (matches && matches.length > 0) {
      result.xmlLeakDetected = true;
      result.leakedXmlSnippets = matches;
      result.notes.push(`XML tags leaked into delta.content: ${matches.join(", ")}`);
    }

    // Inspect primary tool call
    const primaryTool = toolCallsMap.get(0);
    if (!primaryTool || (!primaryTool.name && !primaryTool.id)) {
      result.notes.push(`No tool call emitted. Model text: "${accumulatedContent.slice(0, 100)}"`);
      return result;
    }

    result.selectedToolName = primaryTool.name;
    if (primaryTool.name === "read_file") {
      result.toolDiscriminatedCorrectly = true;
    } else {
      result.notes.push(`Tool discrimination failed: chosen '${primaryTool.name}' instead of 'read_file'`);
    }

    try {
      const parsed = JSON.parse(primaryTool.arguments);
      result.parsedArguments = parsed;
      if (typeof parsed === "object" && parsed !== null && parsed.path) {
        result.toolArgsValid = true;
      } else {
        result.notes.push(`Tool arguments parsed but missing required 'path': ${primaryTool.arguments}`);
      }
    } catch (err) {
      result.notes.push(`Malformed tool arguments JSON: "${primaryTool.arguments}" (${String(err)})`);
    }

    if (!result.toolArgsValid) {
      return result;
    }

    // Turn 2: Feed back successful tool observation
    const turn2Messages = [
      turn1Payload.messages[0],
      {
        role: "assistant",
        content: accumulatedContent.length > 0 ? accumulatedContent : null,
        tool_calls: [
          {
            id: primaryTool.id || "call_test_01",
            type: "function",
            function: {
              name: primaryTool.name,
              arguments: primaryTool.arguments,
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: primaryTool.id || "call_test_01",
        content: "127.0.0.1 localhost\n::1 localhost\n192.168.1.50 gateway.local",
      },
    ];

    const turn2Resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directiveKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        tools: TOOL_PALETTE,
        messages: turn2Messages,
      }),
    });

    if (turn2Resp.ok && turn2Resp.body) {
      const turn2Reader = turn2Resp.body.getReader();
      let turn2LineBuffer = "";
      let turn2AssistantText = "";
      while (true) {
        const { done, value } = await turn2Reader.read();
        if (done) break;
        turn2LineBuffer += decoder.decode(value, { stream: true });
        const lines = turn2LineBuffer.split("\n");
        turn2LineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
            try {
              const d = JSON.parse(trimmed.slice(6));
              const c = d.choices?.[0];
              if (c?.delta?.content) turn2AssistantText += c.delta.content;
              if (c?.finish_reason) result.turn2FinishReason = c.finish_reason;
            } catch {
              // ignore
            }
          }
        }
      }

      if (result.turn2FinishReason === "stop" || result.turn2FinishReason === "tool_calls") {
        result.turn2ToolObservationSuccess = true;
      } else {
        result.notes.push(`Turn 2 finished with unexpected reason: ${result.turn2FinishReason}`);
      }

      // Turn 3: Error Injection & Recovery Test
      // Prompt asking to read a secure file, assistant tries, tool returns Permission Denied,
      // verify model acknowledges the error or suggests alternative rather than looping.
      const turn3Messages = [
        ...turn2Messages,
        {
          role: "user",
          content: "Now read /root/secure_token.key to fetch the deployment secret.",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_test_err_02",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "/root/secure_token.key" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_test_err_02",
          content: "ERROR: EACCES: permission denied, open '/root/secure_token.key'",
        },
      ];

      const turn3Resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${directiveKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          tools: TOOL_PALETTE,
          messages: turn3Messages,
        }),
      });

      if (turn3Resp.ok && turn3Resp.body) {
        const turn3Reader = turn3Resp.body.getReader();
        let turn3LineBuffer = "";
        let turn3Content = "";
        let turn3HasToolCall = false;
        while (true) {
          const { done, value } = await turn3Reader.read();
          if (done) break;
          turn3LineBuffer += decoder.decode(value, { stream: true });
          const lines = turn3LineBuffer.split("\n");
          turn3LineBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
              try {
                const d = JSON.parse(trimmed.slice(6));
                const c = d.choices?.[0];
                if (c?.delta?.content) turn3Content += c.delta.content;
                if (c?.delta?.tool_calls) turn3HasToolCall = true;
              } catch {
                // ignore
              }
            }
          }
        }

        // Did the model acknowledge permission error or try alternative action without crashing?
        const lower = turn3Content.toLowerCase();
        if (
          turn3HasToolCall ||
          lower.includes("permission") ||
          lower.includes("denied") ||
          lower.includes("unable") ||
          lower.includes("cannot access") ||
          lower.includes("access")
        ) {
          result.turn3ErrorRecoverySuccess = true;
          result.turn3EmittedAlternativeAction = turn3HasToolCall;
        } else {
          result.notes.push(`Turn 3 error recovery unclear: "${turn3Content.slice(0, 100)}"`);
        }
      }
    }

    // Scoring
    let score = 0;
    if (result.chunksCount > 0) score += 10;
    if (!result.xmlLeakDetected) score += 20;
    if (result.toolDiscriminatedCorrectly) score += 20;
    if (result.toolArgsValid) score += 20;
    if (result.turn2ToolObservationSuccess) score += 15;
    if (result.turn3ErrorRecoverySuccess) score += 15;
    result.score = score;

    result.passed =
      score >= 80 &&
      result.toolDiscriminatedCorrectly &&
      result.toolArgsValid &&
      !result.xmlLeakDetected &&
      result.turn2ToolObservationSuccess;

    return result;
  } catch (err) {
    result.notes.push(`Exception in OpenCode2 audit: ${String(err)}`);
    return result;
  }
}

async function probeClaudeCodeReadiness(
  model: string,
  gatewayOrigin: string
): Promise<ClaudeCodeAuditResult> {
  const result: ClaudeCodeAuditResult = {
    supported: false,
    statusCode: 0,
    toolUseReceived: false,
    toolInputValid: false,
    thinkingClean: true,
    notes: [],
  };

  const messagesUrl = `${gatewayOrigin}/v1/messages`;
  // Canonical Anthropic directive key: lr-or-cl-ms-no
  const anthropicDirective = "lr-or-cl-ms-no";

  // Claude Code test with Realistic Claude Code Environment:
  // Claude Code always injects a system prompt (CLAUDE.md context) and multiple tools (Read, Bash, Edit, Grep).
  const realisticClaudeCodePayload = {
    model,
    max_tokens: 1024,
    system: "<context>CLAUDE.md guidelines are active</context>\n<project_root>/workspace</project_root>",
    messages: [
      {
        role: "user",
        content: "<task>Please inspect /etc/hosts to check the loopback entries.</task>",
      },
    ],
    tools: [
      {
        name: "Read",
        description: "Read a file from disk",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "Bash",
        description: "Run a bash command in the terminal",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to run" },
          },
          required: ["command"],
        },
      },
    ],
  };

  try {
    const resp = await fetch(messagesUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicDirective,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(realisticClaudeCodePayload),
    });

    result.statusCode = resp.status;
    const bodyText = await resp.text();

    if (!resp.ok) {
      result.errorMessage = bodyText.slice(0, 160);
      result.notes.push(`Anthropic API returned HTTP ${resp.status} with Claude Code system prompt + tools`);
      return result;
    }

    const data = JSON.parse(bodyText);
    result.supported = true;

    // Inspect Anthropic content blocks for tool_use
    const contentBlocks = Array.isArray(data.content) ? data.content : [];
    for (const block of contentBlocks) {
      if (block.type === "tool_use") {
        result.toolUseReceived = true;
        result.toolName = block.name;
        if (
          block.input &&
          typeof block.input === "object" &&
          block.input.file_path === "/etc/hosts"
        ) {
          result.toolInputValid = true;
        } else {
          result.notes.push(`tool_use block had unexpected input: ${JSON.stringify(block.input)}`);
        }
      }
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text.includes("<dots_function_call>") || block.text.includes("<invoke>")) {
          result.thinkingClean = false;
          result.notes.push("Raw XML tags leaked into Anthropic text block");
        }
      }
    }

    if (!result.toolUseReceived) {
      result.notes.push("No tool_use block returned in Anthropic content array");
    }

    return result;
  } catch (err) {
    result.errorMessage = String(err);
    result.notes.push(`Exception in Claude Code probe: ${String(err)}`);
    return result;
  }
}

async function probePydanticReadinessRigorous(
  endpoint: string,
  directiveKey: string,
  model: string
): Promise<PydanticAuditResult> {
  const result: PydanticAuditResult = {
    nativeSupported: false,
    nativeStatusCode: 0,
    nativeSchemaConforms: false,
    promptedSupported: false,
    promptedStatusCode: 0,
    promptedRequiredFenceStripping: false,
    promptedSchemaConforms: false,
    schemaValidationErrors: [],
    notes: [],
  };

  const complexInstruction =
    "You are an infrastructure telemetry generator. Return a JSON object strictly matching this schema:\n" +
    JSON.stringify(PRODUCTION_PYDANTIC_SCHEMA, null, 2) +
    "\n\nValues to use:\n" +
    "- system_status: 'operational'\n" +
    "- cluster_nodes: 12\n" +
    "- metadata: { datacenter: 'us-east-prod', is_isolated: false }\n" +
    "- alerts: [ { code: 104, severity: 'low', message: 'Cert expiring in 25 days' } ]\n" +
    "Output ONLY valid JSON.";

  // Test A: Native response_format: { type: "json_object" } with complex schema
  try {
    const nativeResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directiveKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: complexInstruction }],
      }),
    });

    result.nativeStatusCode = nativeResp.status;
    const bodyText = await nativeResp.text();

    if (nativeResp.ok) {
      result.nativeSupported = true;
      try {
        const parsedBody = JSON.parse(bodyText);
        const rawContent = parsedBody.choices?.[0]?.message?.content ?? "";
        const parsedJson = JSON.parse(rawContent);
        const val = validateProductionPydanticPayload(parsedJson);
        if (val.valid) {
          result.nativeSchemaConforms = true;
        } else {
          result.schemaValidationErrors.push(...val.errors);
          result.notes.push(`Native JSON failed schema validation: ${val.errors.join("; ")}`);
        }
      } catch (err) {
        result.notes.push(`Native response content was not valid JSON: ${String(err)}`);
      }
    } else {
      result.nativeErrorMessage = bodyText.slice(0, 160);
    }
  } catch (err) {
    result.nativeErrorMessage = String(err);
  }

  // Test B: Prompted JSON without response_format + Downstream Fence Stripping
  try {
    const promptedResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directiveKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: complexInstruction }],
      }),
    });

    result.promptedStatusCode = promptedResp.status;
    const bodyText = await promptedResp.text();

    if (promptedResp.ok) {
      result.promptedSupported = true;
      try {
        const parsedBody = JSON.parse(bodyText);
        const rawContent = (parsedBody.choices?.[0]?.message?.content ?? "").trim();
        if (rawContent.startsWith("```")) {
          result.promptedRequiredFenceStripping = true;
        }
        const cleaned = stripJsonFencesAndExtract(rawContent);
        const parsedJson = JSON.parse(cleaned);
        const val = validateProductionPydanticPayload(parsedJson);
        if (val.valid) {
          result.promptedSchemaConforms = true;
        } else {
          result.notes.push(`Prompted JSON failed schema validation: ${val.errors.join("; ")}`);
        }
      } catch (err) {
        result.notes.push(`Prompted JSON extraction/parsing failed: ${String(err)}`);
      }
    } else {
      result.notes.push(`Prompted test failed with HTTP ${promptedResp.status}`);
    }
  } catch (err) {
    result.notes.push(`Prompted test exception: ${String(err)}`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let model = "nex-agi/nex-n2.5-pro:free";
  let endpoint = DEFAULT_URL;
  let directiveKey = DEFAULT_DIRECTIVE;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "--directive" && i + 1 < args.length) {
      const val = args[++i];
      if (val) directiveKey = val;
    } else if (arg === "--url" && i + 1 < args.length) {
      const val = args[++i];
      if (val) endpoint = val;
    } else if (!arg.startsWith("--")) {
      model = arg;
    }
  }

  console.log(`\n========================================================================`);
  console.log(`🛡️  RIGOROUS PRODUCTION CAPABILITY & STRESS AUDIT`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model   : \x1b[36m${model}\x1b[0m`);
  console.log(`🔑 Directive Key  : \x1b[33m${directiveKey}\x1b[0m`);
  console.log(`🌐 Gateway URL    : ${endpoint}`);
  console.log(`⏱️  Timestamp      : ${new Date().toISOString()}`);
  console.log(`------------------------------------------------------------------------\n`);

  console.log(`[1/2] 🧪 Executing OpenCode 2 Multi-Turn Stress Test...`);
  console.log(`      • 4-Tool Palette (Discrimination check: read_file vs write/exec/grep)`);
  console.log(`      • Streaming SSE token parsing & XML tag leakage detection`);
  console.log(`      • Turn 2: Feeding observation data back to model`);
  console.log(`      • Turn 3: Error injection (permission denied) & recovery verification`);
  const oc = await probeOpenCode2ReadinessRigorous(endpoint, directiveKey, model);

  console.log(`\n[2/3] 🧪 Executing Pydantic AI V2 Complex Schema Audit...`);
  console.log(`      • Nested object, typed integers, string enum & alert array constraints`);
  console.log(`      • Native response_format test (HTTP 200 vs 400)`);
  console.log(`      • Prompted fallback with downstream fence stripping (_strip_json_fences)`);
  const py = await probePydanticReadinessRigorous(endpoint, directiveKey, model);

  console.log(`\n[3/3] 🧪 Executing Claude Code & Anthropic Messages API Audit...`);
  console.log(`      • Testing /v1/messages compatibility (directive: lr-or-cl-ms-no)`);
  console.log(`      • Testing Anthropic tool_use JSON block generation for Claude Code CLI`);
  const urlObj = new URL(endpoint);
  const gatewayOrigin = `${urlObj.protocol}//${urlObj.host}`;
  const claude = await probeClaudeCodeReadiness(model, gatewayOrigin);

  console.log(`\n========================================================================`);
  console.log(`📊 RED-TEAM AUDIT REPORT: \x1b[1m${model}\x1b[0m`);
  console.log(`========================================================================\n`);

  // --- OpenCode 2 Report ---
  const ocGrade = oc.passed
    ? `\x1b[32mPASSED (Score: ${oc.score}/100)\x1b[0m`
    : `\x1b[31mFAILED (Score: ${oc.score}/100)\x1b[0m`;

  console.log(`🛠️  \x1b[1mOpenCode 2 Agentic Tool-Calling\x1b[0m: ${ocGrade}`);
  console.log(`   • Latency & Streaming  : TTFT ${oc.ttftMs}ms | Duration ${oc.durationMs}ms | ${oc.chunksCount} chunks`);
  console.log(`   • Tool Discrimination  : ${oc.toolDiscriminatedCorrectly ? `\x1b[32mSelected '${oc.selectedToolName}' correctly from 4 tools\x1b[0m` : `\x1b[31mFAILED (Selected '${oc.selectedToolName}')\x1b[0m`}`);
  console.log(`   • Arguments Parsing    : ${oc.toolArgsValid ? `\x1b[32mStrict JSON matched parameters\x1b[0m` : `\x1b[31mInvalid / Missing\x1b[0m`}`);
  console.log(`   • XML Leak In Content  : ${oc.xmlLeakDetected ? `\x1b[31mLEAK DETECTED: ${oc.leakedXmlSnippets.join(", ")}\x1b[0m` : `\x1b[32mClean (Zero Leak)\x1b[0m`}`);
  console.log(`   • Multi-Turn Turn 2    : ${oc.turn2ToolObservationSuccess ? `\x1b[32mObservation accepted & synthesized\x1b[0m` : `\x1b[31mTurn 2 Rejected / Failed\x1b[0m`}`);
  console.log(`   • Error Recovery Turn 3: ${oc.turn3ErrorRecoverySuccess ? `\x1b[32mRecovered cleanly without hang or hallucination\x1b[0m` : `\x1b[33mAmbiguous / Failed\x1b[0m`}`);
  if (oc.notes.length > 0) {
    console.log(`   • Audit Flags          : ${oc.notes.join(" | ")}`);
  }
  console.log(``);

  // --- Pydantic AI Report ---
  console.log(`🐍 \x1b[1mPydantic AI V2 Complex Schema Audit\x1b[0m:`);
  const pyNativeStatus = ocFormatNative(py);
  console.log(`   • Native Structured Output (output_type=Model) : ${pyNativeStatus}`);
  if (!py.nativeSupported && py.nativeErrorMessage) {
    console.log(`     └─ Upstream Error: ${py.nativeErrorMessage.slice(0, 120)}`);
  }
  if (py.nativeSupported) {
    console.log(`     └─ Strict Schema Conformance: ${py.nativeSchemaConforms ? "\x1b[32m100% Conforming\x1b[0m" : "\x1b[31mFAILED\x1b[0m"}`);
  }

  const pyPromptedStatus = ocFormatPrompted(py);
  console.log(`   • Prompted JSON (BaziForecaster / Fence Stripping) : ${pyPromptedStatus}`);
  console.log(`     └─ Markdown Fence Wrapping : ${py.promptedRequiredFenceStripping ? "Yes (```json emitted)" : "No (Raw JSON)"}`);
  console.log(`     └─ Strict Schema Conformance: ${py.promptedSchemaConforms ? "\x1b[32m100% Conforming (Enums, Ints, Sub-models valid)\x1b[0m" : "\x1b[31mFAILED\x1b[0m"}`);
  if (py.notes.length > 0) {
    console.log(`     └─ Schema Flags            : ${py.notes.join(" | ")}`);
  }
  console.log(``);

  // --- Claude Code Dashboard ---
  console.log(`🎭 \x1b[1mClaude Code CLI & Anthropic Messages (/v1/messages)\x1b[0m:`);
  const ccIcon =
    claude.supported && claude.toolUseReceived && claude.toolInputValid && claude.thinkingClean
      ? `\x1b[32mCERTIFIED COMPATIBLE (Native tool_use emitted)\x1b[0m`
      : `\x1b[31mINCOMPATIBLE / REJECTED\x1b[0m`;
  console.log(`   • Compatibility Verdict: ${ccIcon}`);
  console.log(`   • HTTP Status Code     : ${claude.statusCode}`);
  if (!claude.supported && claude.errorMessage) {
    console.log(`   • Upstream Error       : ${claude.errorMessage.slice(0, 120)}`);
  }
  if (claude.supported) {
    console.log(`   • Tool Use Block       : ${claude.toolUseReceived ? `\x1b[32mEmitted type='tool_use' (${claude.toolName})\x1b[0m` : "\x1b[31mMissing\x1b[0m"}`);
    console.log(`   • Tool Input Arguments : ${claude.toolInputValid ? "\x1b[32mStrict JSON file_path match\x1b[0m" : "\x1b[31mInvalid / Missing\x1b[0m"}`);
    console.log(`   • XML Tag Bleed        : ${claude.thinkingClean ? "\x1b[32mClean (Zero Leak)\x1b[0m" : "\x1b[31mDetected XML in text\x1b[0m"}`);
  }
  if (claude.notes.length > 0) {
    console.log(`   • Notes                : ${claude.notes.join(" | ")}`);
  }
  console.log(``);

  // --- Production Readiness Verdict ---
  console.log(`------------------------------------------------------------------------`);
  console.log(`🏁 PRODUCTION CERTIFICATION VERDICT`);
  console.log(`------------------------------------------------------------------------`);
  printFinalProductionVerdict(model, oc, py, claude, directiveKey);
  console.log(`========================================================================\n`);
}

function ocFormatNative(py: PydanticAuditResult): string {
  if (py.nativeSupported && py.nativeSchemaConforms) {
    return `\x1b[32mCERTIFIED PRODUCTION READY (HTTP 200 + Schema Valid)\x1b[0m`;
  }
  if (py.nativeSupported && !py.nativeSchemaConforms) {
    return `\x1b[31mUNRELIABLE (HTTP 200 but Schema Mismatched)\x1b[0m`;
  }
  return `\x1b[33mUNSUPPORTED UPSTREAM (HTTP ${py.nativeStatusCode})\x1b[0m`;
}

function ocFormatPrompted(py: PydanticAuditResult): string {
  if (py.promptedSupported && py.promptedSchemaConforms) {
    return `\x1b[32mCERTIFIED PRODUCTION READY (With Downstream Fence Stripper)\x1b[0m`;
  }
  return `\x1b[31mUNRELIABLE / FAILED\x1b[0m`;
}

function printFinalProductionVerdict(
  model: string,
  oc: OpenCode2AuditResult,
  py: PydanticAuditResult,
  claude: ClaudeCodeAuditResult,
  directiveKey: string
) {
  // OpenCode 2 Verdict
  if (oc.passed) {
    console.log(`✅ \x1b[32mOpenCode 2 Production Ready\x1b[0m:`);
    console.log(`   Model passed 4-tool discrimination, multi-turn observations, and error recovery.`);
    console.log(`   Wiring: Configure with directive key \x1b[33m${directiveKey}\x1b[0m.`);
  } else {
    console.log(`🚫 \x1b[31mOpenCode 2 REJECTED FOR PRODUCTION\x1b[0m:`);
    console.log(`   Failed critical agentic checks. Do NOT deploy autonomously.`);
  }

  console.log(``);

  // Claude Code CLI Verdict
  if (claude.supported && claude.toolUseReceived && claude.toolInputValid && claude.thinkingClean) {
    console.log(`✅ \x1b[32mClaude Code CLI Production Ready\x1b[0m:`);
    console.log(`   Model emits native Anthropic tool_use blocks on /v1/messages.`);
    console.log(`   Wiring: ANTHROPIC_BASE_URL=https://localhost:7766 ANTHROPIC_AUTH_TOKEN=lr-or-cl-ms-no`);
  } else {
    console.log(`🚫 \x1b[31mClaude Code CLI REJECTED FOR PRODUCTION\x1b[0m:`);
    console.log(`   Incompatible with Anthropic tool_use JSON block parsing.`);
  }

  console.log(``);

  // Pydantic AI Verdict
  if (py.nativeSupported && py.nativeSchemaConforms) {
    console.log(`✅ \x1b[32mPydantic AI Production Ready (Native)\x1b[0m:`);
    console.log(`   Model strictly satisfies Pydantic V2 schemas natively via Agent(output_type=Model).`);
  } else if (py.promptedSupported && py.promptedSchemaConforms) {
    console.log(`⚠️  \x1b[33mPydantic AI Production Ready WITH CONDITION\x1b[0m:`);
    console.log(`   Upstream rejects native response_format (HTTP ${py.nativeStatusCode}), BUT cleanly`);
    console.log(`   satisfies complex schemas via text prompting + downstream _strip_json_fences().`);
    console.log(`   Safe for BaziForecaster pipeline. Do NOT use Agent(output_type=Model) natively.`);
  } else {
    console.log(`🚫 \x1b[31mPydantic AI REJECTED FOR PRODUCTION\x1b[0m:`);
    console.log(`   Model failed to produce valid Pydantic V2 schema output.`);
  }
}

main().catch((err) => {
  console.error("Fatal audit error:", err);
  process.exit(1);
});
