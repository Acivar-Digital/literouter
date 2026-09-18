import { server as srv } from "bun";

const SESSION_DIR = process.env.HOME + "/.advisor_tools";
const CALLBACK_PORT = 8765;
const CALLBACK_PATH = "/callback";

// Pre-gen URL placeholder (no real tokens embedded)
const LOGIN_URL_PLACEHOLDER = "https://example.com/oauth/authorize?client_id=<CLIENT>&redirect_uri=http://localhost:8765/callback&scope=read";

// Note: no secrets stored in repo; session files written to SESSION_DIR only.
export function disableOnInvalidGrant(err: string) {
  console.warn("[advisor/auth] disabling refresh loop due to invalid_grant:", err);
}

export function refreshLoop() {
  console.log("[advisor/auth] refresh loop started (sessions outside repo at", SESSION_DIR, ")");
}

console.log("[advisor/auth] capture server scaffold — zero secrets in repo. Session dir:", SESSION_DIR);
console.log("[advisor/auth] login URL placeholder (no real token):", LOGIN_URL_PLACEHOLDER);
