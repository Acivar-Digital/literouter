---
name: openrouter-byok
description: Operational playbook and step-by-step protocol for AI agents and LLMs to programmatically manage, register, inspect, rotate, and troubleshoot Bring Your Own Key (BYOK) provider credentials (Google AI Studio, Vertex, Anthropic, OpenAI, Bedrock, etc.) in OpenRouter via the Management API.
---

# Skill: openrouter-byok

> **TARGET AUDIENCE**: Any AI Coding Assistant / LLM operating in this repository or workspace tasked with managing provider API keys inside OpenRouter.
>
> **PRIMARY OUTCOME**: The LLM can take an OpenRouter Management Key and add, inspect, rotate, or remove provider keys (e.g. Google AI Studio, Anthropic, OpenAI, Bedrock, Vertex) in OpenRouter with zero human web-UI intervention, ensuring automatic failover and $0 credit token usage.

---

## §0. Canonical Reference Documents

When deep technical details or exact OpenAPI schemas are needed, refer to these local reference documents:

| Reference Path | Description |
|---|---|
| [`docs/openrouter/management-key-01.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/management-key-01.md) | **Management Keys Guide**: Permissions, SDK examples, routes requiring management auth. |
| [`docs/openrouter/byok-01.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-01.md) | **Core BYOK Architecture**: Prioritization, fallbacks, 429 failover, ZDR, multi-key rotation, fees. |
| [`docs/openrouter/byok-02.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-02.md) | **OpenAPI Spec: `GET /api/v1/byok`**: List credentials, query params, schemas, provider slugs. |
| [`docs/openrouter/byok-03.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-03.md) | **OpenAPI Spec: `PATCH /api/v1/byok/{id}`**: In-place key rotation, toggles, filter updates. |
| [`docs/openrouter/byok-04.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-04.md) | **OpenAPI Spec: `GET /api/v1/byok/{id}`**: Retrieve single credential status and metadata. |
| [`docs/openrouter/byok-05.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-05.md) | **OpenAPI Spec: `POST /api/v1/byok`**: Create credentials, write-only raw key handling. |
| [`docs/openrouter/byok-06.md`](/home/yapilwsl/arthityap/literouter/docs/openrouter/byok-06.md) | **OpenAPI Spec: `DELETE /api/v1/byok/{id}`**: Soft-delete credentials and wipe secret material. |

---

## §1. Core Mental Model for LLMs

Before writing scripts or dispatching curl requests, understand these three fundamental OpenRouter architectural rules:

1. **Management Key vs Completion Key**:
   - **Management Key** (`sk-or-v1-...` created under `/settings/management-keys`): Used **exclusively** for admin routes (`/api/v1/byok`, `/api/v1/keys`, `/api/v1/credits`). It **CANNOT** run chat completions.
   - **Completion Key** (`sk-or-v1-...` created under `/settings/keys` or via `POST /api/v1/keys`): Used for `/api/v1/chat/completions`. It **CANNOT** manage BYOK credentials.
2. **Workspace-Wide Inheritance**:
   - BYOK credentials belong to the **Workspace**, NOT to individual OpenRouter completion keys.
   - You **do not** have to tag or modify client OpenRouter keys. Any completion key in the workspace automatically uses the BYOK provider keys by default.
3. **Waterfall Priority Rotation (Not Round-Robin)**:
   - When multiple keys are registered for the same provider, OpenRouter organizes them by `sort_order` (`0`, `1`, `2`...).
   - OpenRouter sends traffic to Key 0. When Key 0 hits a rate limit (`429`), quota limit, or error, OpenRouter **automatically cascades to Key 1** within ~600ms.
   - All matching keys generate pinned virtual endpoints behind the scenes.

---

## §2. Supported Provider Slugs (`provider`)

When registering a key via `POST /api/v1/byok`, `provider` must match one of the official slugs from `docs/openrouter/byok-02.md`:

| Upstream Provider | OpenRouter `provider` Slug | Expected Key Format |
|---|---|---|
| **Google AI Studio** | `google-ai-studio` | Raw Gemini API key (e.g. `AIzaSy...`) |
| **Google Cloud Vertex** | `google-vertex` | Google Cloud Service Account JSON |
| **Anthropic** | `anthropic` | Standard key (`sk-ant-...`) |
| **OpenAI** | `openai` | Standard key (`sk-proj-...` or `sk-...`) |
| **AWS Bedrock** | `amazon-bedrock` | Raw Bedrock API key or `{ accessKeyId, secretAccessKey, region }` |
| **Azure OpenAI / Foundry** | `azure` | `[{"api_key": "...", "resource_name": "...", "resource_type": "ai_foundry"}]` |
| **Groq** | `groq` | Standard key (`gsk_...`) |
| **Mistral AI** | `mistral` | Standard key |
| **DeepSeek** | `deepseek` | Standard key |
| **Together AI** | `together` | Standard key |

*(Complete list of 80+ slugs available in `docs/openrouter/byok-02.md §BYOKProviderSlug`).*

---

## §3. Step-by-Step LLM Execution Workflows

### Step 1: List Existing BYOK Keys
Always inspect current workspace credentials first to avoid creating duplicates.

```bash
curl -s -X GET "https://openrouter.ai/api/v1/byok" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY"
```

**TypeScript / Bun Recipe**:
```typescript
const res = await fetch("https://openrouter.ai/api/v1/byok", {
  headers: { "Authorization": `Bearer ${MANAGEMENT_KEY}` }
});
const { data, total_count } = await res.json();
console.log(`Current BYOK keys: ${total_count}`);
for (const key of data) {
  console.log(`- [${key.id}] ${key.provider} (${key.name}): sort_order=${key.sort_order}, disabled=${key.disabled}`);
}
```

---

### Step 2: Register a New Provider Key (e.g., Google Studio)

To add a provider key, send a `POST /api/v1/byok` request. The raw key is write-only, encrypted at rest, and never echoed back in API responses.

```bash
curl -s -X POST "https://openrouter.ai/api/v1/byok" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google-ai-studio",
    "name": "Google Studio Key 1 - Primary",
    "key": "AIzaSyYourKeyHere",
    "is_byok_only": false,
    "is_required": false
  }'
```

**Payload Knobs (`CreateBYOKKeyRequest`)**:
- `provider` (required): Upstream slug (e.g. `"google-ai-studio"`).
- `key` (required): Plaintext secret string or JSON string.
- `name` (optional): Human-readable identifier.
- `is_byok_only` (optional): If `true`, completely blocks OpenRouter shared capacity for this provider (never spends OpenRouter credits even if keys fail).
- `is_required` (optional): If `true`, never uses shared capacity for the specific models this key covers.
- `allowed_models` (optional): `string[] | null`. Restrict key to specific models (e.g. `["google/gemini-3.5-flash-lite"]`). `null` = all models on provider.
- `allowed_api_key_hashes` (optional): `string[] | null`. Restrict key to specific OpenRouter API key hashes. `null` = all keys in workspace.

---

### Step 3: Set Up Automatic Waterfall Rotation (Multi-Key)

To enable automatic failover rotation, simply add a second (or third) key for the same provider slug:

```bash
curl -s -X POST "https://openrouter.ai/api/v1/byok" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google-ai-studio",
    "name": "Google Studio Key 2 - Backup",
    "key": "AIzaSySecondKeyHere"
  }'
```

- OpenRouter automatically assigns ascending `sort_order` (`0` for first key, `1` for second key).
- Key 0 is attempted first. If Google responds with `429 (Rate Limit)` or `403`, OpenRouter automatically retries the request against Key 1 before returning any response to the downstream caller.

---

### Step 4: Rotate an Existing Key In-Place (`PATCH`)

If you want to swap the raw key without changing its ID, workspace assignments, or audit logs:

```bash
curl -s -X PATCH "https://openrouter.ai/api/v1/byok/<CREDENTIAL_UUID>" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "AIzaSyNewReplacementKey",
    "name": "Updated Studio Key Name"
  }'
```

- The previous key is immediately overwritten in OpenRouter's vault.
- The masked label (e.g. `AIz...yV8`) is regenerated automatically.

---

### Step 5: Temporarily Disable or Re-Enable a Key

You can take a key out of rotation without deleting it:

```bash
# Disable:
curl -s -X PATCH "https://openrouter.ai/api/v1/byok/<CREDENTIAL_UUID>" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "disabled": true }'

# Re-enable:
curl -s -X PATCH "https://openrouter.ai/api/v1/byok/<CREDENTIAL_UUID>" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "disabled": false }'
```

---

### Step 6: Delete a BYOK Key

When decommissioning a key:

```bash
curl -s -X DELETE "https://openrouter.ai/api/v1/byok/<CREDENTIAL_UUID>" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY"
```
Response: `{"deleted": true}`. The encrypted key material is wiped immediately.

---

## §4. Verification: How an LLM Confirms BYOK is Working

When testing that OpenRouter is actually using your BYOK key and not consuming OpenRouter credits:

1. Send a standard completion request using a completion API key:
   ```bash
   curl -s https://openrouter.ai/api/v1/chat/completions \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "google/gemini-3.5-flash-lite",
       "messages": [{"role": "user", "content": "ping"}],
       "provider": {
         "order": ["google-ai-studio"],
         "allow_fallbacks": false
       }
     }'
   ```
2. Inspect the `usage` block in the JSON response:
   - `"is_byok": true` $\rightarrow$ **CONFIRMED**. The request routed through your BYOK key.
   - `"cost": 0` $\rightarrow$ **CONFIRMED**. OpenRouter charged zero credits for model inference.
   - `"provider": "Google AI Studio"` $\rightarrow$ Matched upstream provider.

---

## §5. Reusable Standalone Automation Script

An LLM can write and run this Bun/Node script to safely synchronize environment keys to OpenRouter BYOK:

```typescript
// sync_byok.ts
import { readFileSync } from "fs";

const MANAGEMENT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY;
if (!MANAGEMENT_KEY) throw new Error("OPENROUTER_MANAGEMENT_KEY is required");

async function syncGoogleStudioKeys(keys: string[]) {
  // 1. Fetch current BYOK keys
  const listRes = await fetch("https://openrouter.ai/api/v1/byok", {
    headers: { Authorization: `Bearer ${MANAGEMENT_KEY}` }
  });
  const current = await listRes.json();
  const existingGg = (current.data || []).filter((k: any) => k.provider === "google-ai-studio");

  console.log(`Found ${existingGg.length} existing Google Studio keys in OpenRouter.`);

  // 2. Add any keys not yet registered
  for (let i = 0; i < keys.length; i++) {
    const rawKey = keys[i];
    const name = `Google Studio Key ${i + 1}`;
    
    // Check if slot exists
    if (i < existingGg.length) {
      console.log(`Slot ${i + 1} exists (${existingGg[i].id}), updating in-place...`);
      await fetch(`https://openrouter.ai/api/v1/byok/${existingGg[i].id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${MANAGEMENT_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ key: rawKey, disabled: false })
      });
    } else {
      console.log(`Registering new ${name}...`);
      await fetch("https://openrouter.ai/api/v1/byok", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MANAGEMENT_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "google-ai-studio",
          name,
          key: rawKey
        })
      });
    }
  }
  console.log("Sync complete!");
}
```

---

## §6. Troubleshooting & Common Pitfalls

| Symptom | Root Cause | Fix |
|---|---|---|
| `HTTP 401 Unauthorized` on `/api/v1/byok` | Using a regular user/completion API key instead of a Management Key. | Ensure header has `Bearer sk-or-v1-...` generated from `/settings/management-keys`. |
| `HTTP 403 Forbidden` | The management key does not have permission for the workspace. | Verify workspace ID or create the key under the appropriate organization workspace. |
| `HTTP 400 Bad Request: Invalid provider` | The `provider` slug has a typo or prefix (e.g. `google` instead of `google-ai-studio`). | Check §2 table above or `docs/openrouter/byok-02.md`. |
| Response shows `"is_byok": false` and charges credits | Request routed to a different provider offering the same model (e.g. `google-vertex` instead of `google-ai-studio`). | Pass `"provider": { "order": ["google-ai-studio"] }` in the chat completion payload, or set `"is_byok_only": true` on the BYOK key. |
| Key not failing over to backup on 429 | Backup key has `disabled: true` or is placed in the `Fallback` section with `allow_fallbacks: false`. | Keep both keys in the `Prioritized` section (`is_fallback: false`). |
