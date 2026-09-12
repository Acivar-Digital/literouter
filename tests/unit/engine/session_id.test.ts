import { describe, expect, it } from "bun:test";
import {
  ensureSessionHeaders,
  extractClientSessionId,
  generateOpenCodeSessionId,
  SESSION_HEADER_KEYS,
} from "../../../src/engine/session_id";
import { mergeOutboundHeaders } from "../../../src/engine/dispatch";

describe("src/engine/session_id.ts", () => {
  describe("generateOpenCodeSessionId", () => {
    it("generates a session ID with ses_ prefix and 26 alphanumeric base62 characters", () => {
      const id = generateOpenCodeSessionId();
      expect(id).toMatch(/^ses_[0-9a-zA-Z]{26}$/);
      expect(id.length).toBe(30);
    });

    it("generates unique session IDs on repeated invocations", () => {
      const id1 = generateOpenCodeSessionId();
      const id2 = generateOpenCodeSessionId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("SESSION_HEADER_KEYS", () => {
    it("defines the expected canonical session header keys", () => {
      expect(SESSION_HEADER_KEYS).toEqual([
        "session-id",
        "x-session-id",
        "x-opencode-session",
        "x-opencode-session-id",
        "opencode-session-id",
        "opencode-session",
      ]);
    });
  });

  describe("extractClientSessionId", () => {
    it("returns undefined when headers is undefined or empty", () => {
      expect(extractClientSessionId(undefined)).toBeUndefined();
      expect(extractClientSessionId({})).toBeUndefined();
      expect(extractClientSessionId(new Headers())).toBeUndefined();
    });

    it("extracts session ID from Record<string, string> case-insensitively", () => {
      expect(
        extractClientSessionId({ "X-OpenCode-Session": "ses_custom_1" })
      ).toBe("ses_custom_1");
      expect(
        extractClientSessionId({ "SESSION-ID": "ses_custom_2" })
      ).toBe("ses_custom_2");
      expect(
        extractClientSessionId({ "x-session-id": "ses_custom_3" })
      ).toBe("ses_custom_3");
      expect(
        extractClientSessionId({ "Opencode-Session-Id": "ses_custom_4" })
      ).toBe("ses_custom_4");
    });

    it("extracts session ID from Headers object case-insensitively", () => {
      const headers = new Headers();
      headers.set("X-Session-ID", "ses_custom_headers");
      expect(extractClientSessionId(headers)).toBe("ses_custom_headers");
    });

    it("skips empty string values and finds the first non-empty match", () => {
      const headers = {
        "session-id": "",
        "x-session-id": "ses_non_empty",
      };
      expect(extractClientSessionId(headers)).toBe("ses_non_empty");
    });
  });

  describe("ensureSessionHeaders", () => {
    it("generates both session-id and x-session-id when none are provided", () => {
      const target: Record<string, string> = {
        authorization: "Bearer test",
      };

      ensureSessionHeaders(target);

      expect(target["session-id"]).toMatch(/^ses_[0-9a-zA-Z]{26}$/);
      expect(target["x-session-id"]).toBe(target["session-id"]);
      expect(target.authorization).toBe("Bearer test");
    });

    it("preserves client-provided session ID in session-id", () => {
      const target: Record<string, string> = {};
      const client = {
        "x-opencode-session": "ses_client_123",
      };

      ensureSessionHeaders(target, client);

      expect(target["session-id"]).toBe("ses_client_123");
      expect(target["x-session-id"]).toBeUndefined();
    });

    it("preserves client-provided x-session-id in both session-id and x-session-id", () => {
      const target: Record<string, string> = {};
      const client = {
        "x-session-id": "ses_client_x",
      };

      ensureSessionHeaders(target, client);

      expect(target["session-id"]).toBe("ses_client_x");
      expect(target["x-session-id"]).toBe("ses_client_x");
    });

    it("keeps existing x-session-id on targetHeaders if already set", () => {
      const target: Record<string, string> = {
        "x-session-id": "ses_target_x",
      };
      const client = {
        "session-id": "ses_client_main",
      };

      ensureSessionHeaders(target, client);

      expect(target["session-id"]).toBe("ses_client_main");
      expect(target["x-session-id"]).toBe("ses_target_x");
    });
  });

  describe("mergeOutboundHeaders integration", () => {
    it("injects generated session-id and x-session-id if client provides no session header", () => {
      const merged = mergeOutboundHeaders(
        { authorization: "Bearer key" },
        {},
        undefined,
        undefined,
        { "content-type": "application/json" }
      );

      expect(merged["session-id"]).toMatch(/^ses_[0-9a-zA-Z]{26}$/);
      expect(merged["x-session-id"]).toBe(merged["session-id"]);
    });

    it("preserves client session-id from payloadHeaders", () => {
      const merged = mergeOutboundHeaders(
        { authorization: "Bearer key" },
        {},
        undefined,
        undefined,
        { "x-opencode-session-id": "ses_from_client" }
      );

      expect(merged["session-id"]).toBe("ses_from_client");
    });
  });
});
