# Plan: LiteRouter v4.1 Security & Reliability Hardening

## Context
An external architectural audit identified critical ingress authentication exposures, outbound header leaks, unbounded request buffering, secret scrubbing gaps, and v4.1 engine migration drift in LiteRouter v4.1. This plan executes the agreed Adapt/Adopt hardening strategy across 6 distinct slices, restoring full fusion routing in v4.1, locking admin endpoints strictly behind master authentication, bounding memory and request sizes, and plugging credential/header leaks without breaking legitimate multimodal agents or developer workflows.

---

## Approach

### Batch 1: Ingress Security, Headers & Memory Bounding (Zero-Drift Invariant Protections)

#### Step 1: Admin & Trace Authentication Lockdown
- **Files**: `src/directive/validator.ts`, `src/index.ts`, `src/handlers/v4/router.ts`
- **Concrete Action**:
  - In `src/directive/validator.ts`, implement constant-time string comparison `verifyMasterSecret(candidate: string, expected: string): boolean` using `node:crypto`'s `timingSafeEqual`.
  - In `src/index.ts` (`handleHardReset` lines 81-91 and `handleAdminPoolReset` lines 131-141), delete `|| parseDirective(token) !== null`. If `authKey` is empty or unset, admin endpoints must reject with HTTP 401 (`"Admin endpoints disabled: LITEROUTER_AUTH_KEY not configured"`). When configured, verify `verifyMasterSecret(token, authKey)`.
  - In `src/handlers/v4/router.ts` (`handleTraceEndpoints` lines 144-165), remove `parseDirectiveKey(rawKey)`. Enforce that `/v1/traces` endpoints require `verifyMasterSecret(rawKey, authKey)`. If `authKey` is empty or validation fails, return HTTP 401 (`"Admin authentication required to access trace inspection endpoints"`).
  - For inference endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`): if `LITEROUTER_AUTH_KEY` is unset in environment, retain permissive directive-as-token ergonomics (`Bearer lr-...`). If `LITEROUTER_AUTH_KEY` is configured, allow either `Authorization: Bearer <authKey>` with `x-literouter-directive: lr-...`, or `Authorization: Bearer <directive>` with `x-literouter-key: <authKey>`.

#### Step 2: Outbound Client Header Allowlist
- **Files**: `src/transformers/openai_chat.ts`, `src/transformers/openai_responses.ts`, `src/engine/dispatch.ts`
- **Concrete Action**:
  - In `src/engine/dispatch.ts`, define exported constant `SAFE_CLIENT_PASS_HEADERS`:
    ```ts
    export const SAFE_CLIENT_PASS_HEADERS = new Set<string>([
      "accept",
      "anthropic-version",
      "anthropic-beta",
      "x-request-id",
      "session-id",
      "x-session-id",
      "user-agent",
      "x-title",
      "http-referer",
    ]);
    ```
  - In `src/transformers/openai_chat.ts:222-224` and `src/transformers/openai_responses.ts:165-167`, replace unconditional copying (`wireHeaders[key.toLowerCase()] = value`) with:
    ```ts
    headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (SAFE_CLIENT_PASS_HEADERS.has(lower)) {
        wireHeaders[lower] = value;
      }
    });
    ```
  - In `src/engine/dispatch.ts` `mergeHeaderSource(merged, clientHeaders ?? payloadHeaders, true)`, ensure un-allowlisted client headers (such as `cookie`, `authorization`, `x-forwarded-for`) are never forwarded to upstream providers.

#### Step 3: Inbound Request Body Size Caps (OOM DoS Prevention)
- **Files**: `src/index.ts`
- **Concrete Action**:
  - In `src/index.ts:787` (`Bun.serve`), add `maxRequestBodySize: 32 * 1024 * 1024` (32MB).
  - In `src/index.ts:714-720` (`http2.createSecureServer` request listener), track accumulated byte length across `chunks`. If accumulated bytes exceed `32 * 1024 * 1024`:
    - Immediately destroy the request stream.
    - Respond with HTTP 413 (`"Payload Too Large: request body exceeds 32MB limit"`).
    - Release all allocated buffer chunks.

---

### Batch 2: Secret Scrubbing, Error Hygiene & v4.1 Engine Migration Polish

#### Step 4: Secret Regex Expansion & Upstream Error Redaction
- **Files**: `src/telemetry/sanitize.ts`, `src/engine/dispatch.ts`
- **Concrete Action**:
  - In `src/telemetry/sanitize.ts:37-46`, expand `SECRET_PATTERNS` and `SECRET_REGEX` to cover Anthropic, OpenAI project keys, Groq, Cerebras, and URL query token params:
    ```ts
    export const SECRET_REGEX =
      /(?:Bearer\s+[a-zA-Z0-9_.\-~+/]+=*|sk-or-v1-[a-zA-Z0-9]{64}|sk-ant-[a-zA-Z0-9_-]{20,}|sk-(?:proj|svcacct|live|test)-[a-zA-Z0-9_-]{20,}|nvapi-[a-zA-Z0-9_-]{32,}|AIzaSy[a-zA-Z0-9_-]{33}|gsk_[a-zA-Z0-9]{20,}|csk-[a-zA-Z0-9_-]{20,}|sk-lr-[a-zA-Z0-9_.-]+|([?&](?:key|api_key|token)=)[^&\s"]+)/gi;
    ```
  - In `src/engine/dispatch.ts:247-260` (`createCleanErrorResponse`), sanitize `errText` through `sanitizeBody(errText)` before constructing downstream `Response`.
  - Strip sensitive upstream response headers (`set-cookie`, `server`, `cf-ray`) from the relayed error headers, retaining only `content-type`, `retry-after`, and `x-request-id`.

#### Step 5: Fix Fusion Directives in v4.1 Dispatch & Wire Graceful Shutdown
- **Files**: `src/engine/dispatch.ts`, `src/index.ts`, `src/lifecycle/shutdown.ts`
- **Concrete Action**:
  - In `src/engine/dispatch.ts:391`, fix the fusion routing bug:
    ```ts
    if (req.directive.type === "fusion") {
      const { executeFusionFlow } = require("../handlers/openai_compat");
      return executeFusionFlow(
        req.directive.preset,
        req.rawInboundBody,
        req.clientSignal,
        req.reqId
      );
    }
    ```
  - In `src/engine/dispatch.ts:683-710`, wire cautious failure reporting for status `401`, `403`, and `429` only:
    ```ts
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403 || upstreamResponse.status === 429) {
      globalKeyPool.reportFailure(providerCode, key.index, upstreamResponse.status, upstreamResponse.headers, errText);
    }
    ```
    (Explicit invariant: status 400 and transient 500 must NOT report key failure).
  - In `src/index.ts:792`, wrap `handleAppRequest(req)` with `trackInFlight(...)` from `src/lifecycle/shutdown.ts`.
  - In `src/index.ts:836-848`, replace synchronous `process.exit(0)` on `SIGINT` and `SIGTERM` with:
    ```ts
    const handleSignal = async (sig: string) => {
      console.log(`[GATEWAY] Received ${sig}, draining in-flight requests...`);
      await drainInFlight(15000);
      traceWriter.drainSync();
      process.exit(0);
    };
    process.once("SIGINT", () => void handleSignal("SIGINT"));
    process.once("SIGTERM", () => void handleSignal("SIGTERM"));
    ```

#### Step 6: URL Path Injection Prevention & Unbounded Store LRU Bounding
- **Files**: `src/config/providers.ts`, `src/engine/strategies/native_cascade.ts`, `src/transformers/thinking.ts`, `src/ui/telemetry.ts`, `src/transformers/dots.ts`, `src/transformers/ling.ts`
- **Concrete Action**:
  - In `src/config/providers.ts:136` and `src/engine/strategies/native_cascade.ts:41`:
    Sanitize model strings before path interpolation:
    ```ts
    const safeModel = encodeURIComponent(model);
    const formatted = model !== undefined ? rawPath.replace("{model}", safeModel) : rawPath;
    ```
  - In `src/transformers/thinking.ts:3-9`, enforce a maximum cap of 2,000 entries on `THOUGHT_SIGNATURE_STORE`:
    ```ts
    if (THOUGHT_SIGNATURE_STORE.size >= 2000) {
      const oldestKey = THOUGHT_SIGNATURE_STORE.keys().next().value;
      if (oldestKey) THOUGHT_SIGNATURE_STORE.delete(oldestKey);
    }
    ```
  - In `src/ui/telemetry.ts:33-37`, enforce a maximum cap of 2,000 entries on `TelemetrySink.ttftStore` using the same FIFO deletion pattern.
  - In `src/transformers/dots.ts:503` and `src/transformers/ling.ts:119`, escape closing XML tags (`</tool_result>`, `</tool_response>`, and `<tool_call>`) inside tool content strings using XML entity replacement (`&lt;/tool_result&gt;`) to eliminate prompt injection and parser hijacking.

---

### Batch 3: Knowledge Base, Persistent Memories, Changelog & Git Delivery

#### Step 7: LiteRouter Skill & Documentation Alignment
- **Files**: `.opencode/skills/literouter/SKILL.md`, `.opencode/skills/literouter/architecture.md`, `.opencode/skills/literouter/directive-grammar.md`, `.opencode/skills/literouter/config-schemas.md`
- **Concrete Action**:
  - Review and update `.opencode/skills/literouter/SKILL.md` to reflect the tightened ingress security model: document that `/reset`, `/admin/pool/reset`, and `/v1/traces` strictly require `LITEROUTER_AUTH_KEY` and reject naked directive tokens.
  - In `architecture.md`, update the telemetry and header pipeline documentation to specify the explicit `SAFE_CLIENT_PASS_HEADERS` allowlist and 32MB payload cap.
  - In `directive-grammar.md`, clarify that while routing directives (`lr-...`) specify execution semantics (provider, payload, wire, nuances), they are not authentication tokens.
  - In `config-schemas.md`, document the expanded `SECRET_REGEX` patterns and graceful shutdown behavior.

#### Step 8: BD Persistent Memories Audit & Sync
- **Files**: Beads database / persistent memory store
- **Concrete Action**:
  - Run `bd remember` to store permanent architectural decisions:
    - `decision-auth-model-v4`: `/reset` and `/v1/traces` strictly require `LITEROUTER_AUTH_KEY` via `timingSafeEqual`; directives are configuration, not secrets.
    - `decision-fusion-dispatch-fix`: `src/engine/dispatch.ts:391` routes `fusion` directives to `executeFusionFlow` instead of hardcoding `or`.
    - `decision-client-header-allowlist`: Outbound client headers restricted to `SAFE_CLIENT_PASS_HEADERS` allowlist; all others dropped before upstream relay.
  - Review existing memories via `bd memories` to identify and remove or update any stale assumptions regarding legacy engine defaults or trace authentication.

#### Step 9: Update CHANGELOG.md
- **Files**: `CHANGELOG.md`
- **Concrete Action**:
  - Add a comprehensive entry under `## [Unreleased] — 2026-10-16` detailing:
    - **Security**: Ingress authentication lockdown on `/reset`, `/admin/pool/reset`, and `/v1/traces`; constant-time secret comparison; client header allowlist preventing cookie and local token leaks; 32MB request body size cap in `Bun.serve` and HTTP/2; expanded `SECRET_REGEX` for Anthropic, OpenAI, Groq, Cerebras, and query parameters.
    - **Fixes**: Restored `fusion` directive execution in `src/engine/dispatch.ts` under v4.1; graceful in-flight request draining (`drainInFlight`) on `SIGINT`/`SIGTERM`; URL path parameter encoding for `{model}`; in-memory LRU bounding on `THOUGHT_SIGNATURE_STORE` and `TelemetrySink.ttftStore`; XML tool tag escaping in dots and ling transformers.
    - **Verification**: Zero regressions across 1,386 unit tests and static typechecking.

#### Step 10: Quality Gate Verification & Git Push
- **Files**: Entire working tree
- **Concrete Action**:
  - Run full verification suite: `bun run typecheck` (zero errors) and `bun run test` (all 7 domain suites pass).
  - Inspect `git status` and `git diff` to ensure no unexpected files or `.env*` secrets are staged.
  - Stage changes, create conventional commit: `feat(security): harden v4.1 ingress auth, header allowlist, and body limits`.
  - Execute `git push origin main` and confirm clean sync with remote repository.

---

## Critical Files & Anchors

1. `src/index.ts`: Admin reset handlers (`handleHardReset`, `handleAdminPoolReset`), body size caps in `Bun.serve` and `http2`, graceful shutdown signals.
2. `src/handlers/v4/router.ts`: Trace endpoint authentication (`handleTraceEndpoints`) and route guarding.
3. `src/engine/dispatch.ts`: Fusion directive dispatching, safe client header merging, key failure reporting (401/403/429 only), sanitized error response generation.
4. `src/telemetry/sanitize.ts`: Extended `SECRET_REGEX` pattern covering Anthropic, OpenAI project keys, Groq, and URL query params.
5. `src/transformers/openai_chat.ts` & `src/transformers/openai_responses.ts`: Client header allowlist enforcement.

---

## Verification

### Automated Gate Verification
1. **Typecheck**: `bun run typecheck` (`tsc --noEmit`) must exit with code 0.
2. **Unit Test Suite**: `bun run test` (all 7 parallel test domains) must exit with code 0.
3. **Eval Test Suite**: `bun run test eval` must exit with code 0.

### Behavior-Specific Verification Checks
1. **Admin Auth Check**:
   - Send `POST /reset` with `Authorization: Bearer lr-or-oa-ch-no`. Must return HTTP 401 Unauthorized.
   - Send `POST /reset` with `Authorization: Bearer <LITEROUTER_AUTH_KEY>`. Must return HTTP 200 OK.
2. **Trace Endpoint Auth Check**:
   - Send `GET /v1/traces` with `Authorization: Bearer lr-or-oa-ch-no`. Must return HTTP 401 Unauthorized.
3. **Header Allowlist Check**:
   - Send request to `/v1/chat/completions` with custom header `Cookie: session=secret123` and `X-Custom-Internal: forbidden`. Verify via telemetry trace that neither header appears in outbound upstream headers.
4. **Fusion Routing Check**:
   - Send request with directive `lr-fse-code-balanced`. Verify in telemetry that the request routes through `executeFusionFlow` and not hardcoded OpenRouter.
5. **Secret Redaction Check**:
   - Ingest an error response containing `sk-ant-api03-abcdef1234567890`. Verify the serialized body returned to client redacts the key.
6. **Payload Size Limit Check**:
   - Send a 33MB POST body to `/v1/chat/completions`. Must be rejected with HTTP 413 Payload Too Large.

---

## Assumptions & Contingencies
- **Assumption**: `LITEROUTER_AUTH_KEY` defaults to `""` in local development environments. When empty, inference requests remain unblocked for local developer ease, while administrative `/reset` and `/v1/traces` endpoints fail closed (401) to prevent unintended external access.
- **Contingency**: If an upstream model ID legitimately contains a slash (e.g. `meta-llama/llama-3-70b-instruct`) and `encodeURIComponent` breaks a provider's route expecting raw slashes, the encoder will preserve forward slashes (`model.split("/").map(encodeURIComponent).join("/")`) while safely escaping `?`, `#`, and path traversal sequences (`..`).
