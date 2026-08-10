# Schema Registry — Upstream Response Fields

This registry is the **single source of truth** for what fields are valid for each
upstream provider. Any field not listed here is rejected at the gateway boundary
(`extra="forbid"` on all response models).

---

## Gemini (Google Generative Language API)

Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`

### Valid Response Fields (top-level)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| candidates | array | ✅ | Contains `content`, `finishReason`, `index`, `safetyRatings` |
| usageMetadata | object | optional | `promptTokens`, `candidatesTokens`, `totalTokens` |
| modelVersion | string | optional | e.g. `"2.0.2"` |

### Candidate Object Fields
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| content | object | ✅ | `{parts: [{text}], role: "model"}` |
| finishReason | string | ✅ | `"STOP"`, `"MAX_TOKENS"`, `"SAFETY"` |
| index | integer | optional | Default 0 |
| safetyRatings | array | optional | Array of `{category, probability}` |
| citationMetadata | object | optional | Citation sources if applicable |
| tokenCount | integer | optional | Only in some streaming cases |

### Rejected Fields (Hallucination Detection)
- `thinking`, `reasoning`, `confidence`, `probabilityScore`, `rawText`, `debugInfo`,
  `internalId`, `traceId`, `cost`, `latencyMs`

Spec: https://ai.google.dev/api/generate-content

---

## NVIDIA (Nemotron)

Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`

### Valid Response Fields (top-level)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | ✅ | `"chatcmpl-..."` |
| object | string | ✅ | Must be `"chat.completion"` |
| created | integer | ✅ | Unix timestamp |
| model | string | ✅ | e.g. `"nvidia/nemotron-4-340b-reward"` |
| choices | array | ✅ | Each: `{index, message, finish_reason}` |
| usage | object | ✅ | `{prompt_tokens, completion_tokens, total_tokens}` |
| system_fingerprint | string | optional | |

### Message Object Fields
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| role | string | ✅ | `"assistant"` |
| content | string | ✅ | |
| name | string | optional | |
| tool_calls | array | optional | |

### Rejected Fields
- `thinking`, `reasoning`, `confidence`, `rawText`, `debugInfo`, `internalId`,
  `traceId`, `cost`, `latencyMs`, `tokenProbabilities`

Spec: https://integrate.api.nvidia.com/docs/api-reference

---

## OpenRouter

Endpoint: `https://openrouter.ai/api/v1/chat/completions`

### Valid Response Fields (top-level)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | ✅ | |
| object | string | ✅ | `"chat.completion"` |
| created | integer | ✅ | |
| model | string | ✅ | |
| choices | array | ✅ | |
| usage | object | ✅ | |
| system_fingerprint | string | optional | |
| provider | object | optional | `{name, url?, icon?}` |

### Choices[0] Object Fields
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| index | integer | ✅ | |
| finish_reason | string | ✅ | `"stop"`, `"length"`, `"tool_calls"` |
| message | object | ✅ | Must match ChatMessage schema |

### Rejected Fields
- `thinking`, `reasoning`, `confidence`, `rawText`, `debugInfo`, `internalId`,
  `traceId`, `cost`, `latencyMs`, `tokenProbabilities`, `cache_hit`

Spec: https://openrouter.ai/docs/api-reference

---

## Anthropic (Claude 3)

Endpoint: `https://api.anthropic.com/v1/messages`

### Valid Response Fields (top-level)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | ✅ | `"msg_..."` |
| type | string | ✅ | Must be `"message"` |
| role | string | ✅ | `"assistant"` |
| model | string | ✅ | |
| content | array | ✅ | Array of `{type, text}` |
| stop_reason | string | ✅ | `"end_turn"`, `"max_tokens"`, `"stop_sequence"` |
| stop_sequence | string | optional | Present if stop_reason is `"stop_sequence"` |
| usage | object | ✅ | `{input_tokens, output_tokens}` |

### Content[i] Object Fields
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| type | string | ✅ | `"text"` or `"tool_use"` |
| text | string | optional | When type is `"text"` |
| id | string | optional | When type is `"tool_use"` |
| name | string | optional | Tool use name |
| input | object | optional | Tool use input |

### Rejected Fields
- `thinking`, `reasoning`, `confidence`, `rawText`, `debugInfo`, `internalId`,
  `traceId`, `cost`, `latencyMs`, `tokenProbabilities`

Spec: https://docs.anthropic.com/en/reference/messages

---

## Azure OpenAI

Endpoint: `https://your-resource.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview`

### Valid Response Fields — same as OpenAI Chat Completions
| Field | Type | Required |
|-------|------|----------|
| id | string | ✅ |
| object | string | ✅ |
| created | integer | ✅ |
| model | string | ✅ |
| choices | array | ✅ |
| usage | object | ✅ |
| system_fingerprint | string | optional |

### Rejected Fields
Same as OpenAI: `thinking`, `reasoning`, `confidence`, `rawText`, `debugInfo`,
`internalId`, `traceId`, `cost`, `latencyMs`, `tokenProbabilities`

Spec: https://learn.microsoft.com/en-us/azure/ai-studio/api-reference/apis

---

## Enforcement

All response models use `extra="forbid"` — any field not in this registry causes
a `ValidationError` and the response is rejected at the gateway boundary.
