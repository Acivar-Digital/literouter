# 04 Auth capture

Documentation for the Advisor authentication capture scaffold and session lifecycle management based on `advisor/auth/capture.ts`.

## a. Inputs & Dependencies

- **Runtime & Modules**:
  - Bun runtime server import (`advisor/auth/capture.ts:1`): `import { server as srv } from "bun"`.
- **Environment Variables**:
  - `process.env.HOME` (`advisor/auth/capture.ts:3`): Used to determine user home directory for external session storage.
- **Configuration & Parameters**:
  - Callback port (`advisor/auth/capture.ts:4`): `CALLBACK_PORT = 8765`.
  - Callback path (`advisor/auth/capture.ts:5`): `CALLBACK_PATH = "/callback"`.
  - Placeholder URL (`advisor/auth/capture.ts:8`): `LOGIN_URL_PLACEHOLDER = "https://example.com/oauth/authorize?client_id=<CLIENT>&redirect_uri=http://localhost:8765/callback&scope=read"`.

## b. Transformation

- **OAuth Callback Scaffold Setup**:
  - Defines listener configuration for OAuth redirection targets on port 8765 (`advisor/auth/capture.ts:4-5`).
  - Uses a pre-generated placeholder URL with zero real credentials or secrets embedded (`advisor/auth/capture.ts:7-8`).
- **Error Handling (`disableOnInvalidGrant`)**:
  - Function `disableOnInvalidGrant(err: string)` (`advisor/auth/capture.ts:11-13`):
    - Accepts error string and logs a warning to disable the refresh loop when encountering `invalid_grant`.
- **Refresh Lifecycle (`refreshLoop`)**:
  - Function `refreshLoop()` (`advisor/auth/capture.ts:15-17`):
    - Initializes the token refresh loop, outputting log verification pointing to the external session directory.
- **Module Execution / Bootstrap Logs**:
  - Prints verification notices confirming zero secrets in repo, the external session directory, and the placeholder URL (`advisor/auth/capture.ts:19-20`).

## c. Outputs & Dependencies

- **External Session Persistence**:
  - Session directory location (`advisor/auth/capture.ts:3`, `10`): `SESSION_DIR = process.env.HOME + "/.advisor_tools"`.
  - Session files are strictly written outside the repository root; zero secrets are committed or stored in repo.
- **Exported Functions**:
  - `disableOnInvalidGrant(err: string)` (`advisor/auth/capture.ts:11`): Error handler for authentication failures.
  - `refreshLoop()` (`advisor/auth/capture.ts:15`): Function driving credential refresh cycles.
- **Downstream Consumers**:
  - Upstream/downstream auth tools and daemons listening on local port `8765` for OAuth authorization redirects.
