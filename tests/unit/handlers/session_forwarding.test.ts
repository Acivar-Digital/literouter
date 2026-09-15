import { describe, expect, it } from "bun:test";
import { buildAuthHeaders } from "../../../src/handlers/openai_compat";
import { buildUpstreamHeaders } from "../../../src/handlers/openai_original";
import { SESSION_HEADER_KEYS } from "../../../src/engine/session_id";

describe("Session Forwarding & Header Normalization (tests/unit/handlers/session_forwarding.test.ts)", () => {
  const SESSION_ID_REGEX = /^ses_[0-9a-zA-Z]{26}$/;

  describe("All 6 Session Header Variants Normalization", () => {
    const testCases: Array<{ key: (typeof SESSION_HEADER_KEYS)[number]; value: string }> = [
      { key: "session-id", value: "sess_val_01" },
      { key: "x-session-id", value: "sess_val_02" },
      { key: "x-opencode-session", value: "sess_val_03" },
      { key: "x-opencode-session-id", value: "sess_val_04" },
      { key: "opencode-session-id", value: "sess_val_05" },
      { key: "opencode-session", value: "sess_val_06" },
    ];

    describe("buildAuthHeaders (chat completions)", () => {
      for (const { key, value } of testCases) {
        it(`normalizes "${key}" from plain Record to session-id`, () => {
          const incoming = { [key]: value };
          const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);
          expect(headers["session-id"]).toBe(value);
        });

        it(`normalizes "${key}" from Headers object to session-id`, () => {
          const incoming = new Headers();
          incoming.set(key, value);
          const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);
          expect(headers["session-id"]).toBe(value);
        });
      }

      it("preserves both session-id and x-session-id when x-session-id is provided", () => {
        const incoming = { "x-session-id": "x-session-explicit-123" };
        const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);
        expect(headers["session-id"]).toBe("x-session-explicit-123");
        expect(headers["x-session-id"]).toBe("x-session-explicit-123");
      });

      it("preserves both when both session-id and x-session-id are explicitly provided", () => {
        const incoming = {
          "session-id": "sess-main-456",
          "x-session-id": "x-sess-alt-789",
        };
        const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);
        expect(headers["session-id"]).toBe("sess-main-456");
        expect(headers["x-session-id"]).toBe("x-sess-alt-789");
      });

      it("normalizes case-insensitively across variants", () => {
        const variations = [
          { key: "X-OpenCode-Session", value: "case-sess-1" },
          { key: "SESSION-ID", value: "case-sess-2" },
          { key: "X-Session-ID", value: "case-sess-3" },
          { key: "Opencode-Session-Id", value: "case-sess-4" },
          { key: "X-Opencode-Session-Id", value: "case-sess-5" },
          { key: "OPENCODE-SESSION", value: "case-sess-6" },
        ];

        for (const { key, value } of variations) {
          const headersRecord = buildAuthHeaders("Bearer", "test-key", "oa", { [key]: value });
          expect(headersRecord["session-id"]).toBe(value);

          const headersObj = new Headers([[key, value]]);
          const headersFromObj = buildAuthHeaders("Bearer", "test-key", "oa", headersObj);
          expect(headersFromObj["session-id"]).toBe(value);
        }
      });
    });

    describe("buildUpstreamHeaders (responses API)", () => {
      for (const { key, value } of testCases) {
        it(`normalizes "${key}" from plain Record to session-id`, () => {
          const incoming = { [key]: value };
          const headers = buildUpstreamHeaders("test-key", "oa", incoming);
          expect(headers["session-id"]).toBe(value);
        });

        it(`normalizes "${key}" from Headers object to session-id`, () => {
          const incoming = new Headers();
          incoming.set(key, value);
          const headers = buildUpstreamHeaders("test-key", "oa", incoming);
          expect(headers["session-id"]).toBe(value);
        });
      }

      it("preserves both session-id and x-session-id when x-session-id is provided", () => {
        const incoming = { "x-session-id": "upstream-x-sess-123" };
        const headers = buildUpstreamHeaders("test-key", "oa", incoming);
        expect(headers["session-id"]).toBe("upstream-x-sess-123");
        expect(headers["x-session-id"]).toBe("upstream-x-sess-123");
      });

      it("preserves both when both session-id and x-session-id are explicitly provided", () => {
        const incoming = {
          "session-id": "resp-sess-111",
          "x-session-id": "resp-x-sess-222",
        };
        const headers = buildUpstreamHeaders("test-key", "oa", incoming);
        expect(headers["session-id"]).toBe("resp-sess-111");
        expect(headers["x-session-id"]).toBe("resp-x-sess-222");
      });

      it("normalizes case-insensitively across variants", () => {
        const variations = [
          { key: "X-OpenCode-Session", value: "resp-case-1" },
          { key: "SESSION-ID", value: "resp-case-2" },
          { key: "X-Session-ID", value: "resp-case-3" },
          { key: "Opencode-Session-Id", value: "resp-case-4" },
          { key: "X-Opencode-Session-Id", value: "resp-case-5" },
          { key: "OPENCODE-SESSION", value: "resp-case-6" },
        ];

        for (const { key, value } of variations) {
          const headersRecord = buildUpstreamHeaders("test-key", "oa", { [key]: value });
          expect(headersRecord["session-id"]).toBe(value);

          const headersObj = new Headers([[key, value]]);
          const headersFromObj = buildUpstreamHeaders("test-key", "oa", headersObj);
          expect(headersFromObj["session-id"]).toBe(value);
        }
      });
    });
  });

  describe("Preservation of 8-character OpenCode Session IDs for Zen (zn and zen)", () => {
    const zenProviders = ["zn", "zen"] as const;
    const openCodeSessionIds = ["B2S4Oj9m", "jX0MT5S0", "a9K1Lm3P", "zY8wX7vU"];

    for (const provider of zenProviders) {
      describe(`provider: "${provider}"`, () => {
        for (const sessionId of openCodeSessionIds) {
          it(`preserves 8-char session ID "${sessionId}" in buildAuthHeaders without overwriting with ses_...`, () => {
            const incoming = { "x-opencode-session": sessionId };
            const headers = buildAuthHeaders("Bearer", "test-key", provider, incoming);

            expect(headers["session-id"]).toBe(sessionId);
            expect(headers["session-id"]).not.toMatch(/^ses_/);
            expect(headers["session-id"]).toHaveLength(8);
          });

          it(`preserves 8-char session ID "${sessionId}" via session-id header in buildAuthHeaders`, () => {
            const incoming = { "session-id": sessionId };
            const headers = buildAuthHeaders("Bearer", "test-key", provider, incoming);

            expect(headers["session-id"]).toBe(sessionId);
            expect(headers["session-id"]).not.toMatch(/^ses_/);
            expect(headers["session-id"]).toHaveLength(8);
          });

          it(`preserves 8-char session ID "${sessionId}" in buildUpstreamHeaders without overwriting with ses_...`, () => {
            const incoming = { "x-opencode-session-id": sessionId };
            const headers = buildUpstreamHeaders("test-key", provider, incoming);

            expect(headers["session-id"]).toBe(sessionId);
            expect(headers["session-id"]).not.toMatch(/^ses_/);
            expect(headers["session-id"]).toHaveLength(8);
          });

          it(`preserves 8-char session ID "${sessionId}" via Headers object in buildUpstreamHeaders`, () => {
            const incoming = new Headers({ "x-opencode-session": sessionId });
            const headers = buildUpstreamHeaders("test-key", provider, incoming);

            expect(headers["session-id"]).toBe(sessionId);
            expect(headers["session-id"]).not.toMatch(/^ses_/);
            expect(headers["session-id"]).toHaveLength(8);
          });
        }
      });
    }

    it("also preserves 8-character session IDs for non-Zen providers", () => {
      const providers = ["oa", "or", "an", "gg"];
      for (const prov of providers) {
        const headers = buildAuthHeaders("Bearer", "key", prov, { "x-opencode-session": "B2S4Oj9m" });
        expect(headers["session-id"]).toBe("B2S4Oj9m");

        const upstream = buildUpstreamHeaders("key", prov, { "x-opencode-session": "B2S4Oj9m" });
        expect(upstream["session-id"]).toBe("B2S4Oj9m");
      }
    });
  });

  describe("Automatic Generation of ses_... when No Session Header Provided for Zen", () => {
    const zenProviders = ["zn", "zen"] as const;

    for (const provider of zenProviders) {
      describe(`provider: "${provider}"`, () => {
        it("generates ses_... session-id and x-session-id in buildAuthHeaders when headers are undefined", () => {
          const headers = buildAuthHeaders("Bearer", "test-key", provider, undefined);

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates ses_... session-id and x-session-id in buildAuthHeaders when headers are empty object", () => {
          const headers = buildAuthHeaders("Bearer", "test-key", provider, {});

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates ses_... session-id and x-session-id in buildAuthHeaders when Headers object is empty", () => {
          const headers = buildAuthHeaders("Bearer", "test-key", provider, new Headers());

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates ses_... in buildUpstreamHeaders when headers are undefined", () => {
          const headers = buildUpstreamHeaders("test-key", provider, undefined);

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates ses_... in buildUpstreamHeaders when headers are empty object", () => {
          const headers = buildUpstreamHeaders("test-key", provider, {});

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates ses_... in buildUpstreamHeaders when Headers object is empty", () => {
          const headers = buildUpstreamHeaders("test-key", provider, new Headers());

          expect(headers["session-id"]).toBeDefined();
          expect(headers["session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["x-session-id"]).toBeDefined();
          expect(headers["x-session-id"]).toMatch(SESSION_ID_REGEX);
          expect(headers["session-id"]).toBe(headers["x-session-id"]);
        });

        it("generates distinct random session IDs across sequential calls", () => {
          const first = buildAuthHeaders("Bearer", "test-key", provider, {});
          const second = buildAuthHeaders("Bearer", "test-key", provider, {});

          expect(first["session-id"]).not.toBe(second["session-id"]);
        });
      });
    }
  });

  describe("Preservation of Client Metadata Headers (x-client-version, x-client-name)", () => {
    it("preserves x-client-version and x-client-name in buildAuthHeaders from plain Record", () => {
      const incoming = {
        "x-client-version": "1.4.2",
        "x-client-name": "OpenCode-TUI",
        "x-opencode-session": "ses_meta_test_01",
      };
      const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);

      expect(headers["x-client-version"]).toBe("1.4.2");
      expect(headers["x-client-name"]).toBe("OpenCode-TUI");
      expect(headers["session-id"]).toBe("ses_meta_test_01");
    });

    it("preserves x-client-version and x-client-name in buildAuthHeaders from Headers object", () => {
      const incoming = new Headers({
        "x-client-version": "2.1.0",
        "x-client-name": "ClaudeCode",
        "x-session-id": "ses_meta_test_02",
      });
      const headers = buildAuthHeaders("Bearer", "test-key", "or", incoming);

      expect(headers["x-client-version"]).toBe("2.1.0");
      expect(headers["x-client-name"]).toBe("ClaudeCode");
      expect(headers["session-id"]).toBe("ses_meta_test_02");
    });

    it("handles case variations of client metadata headers in buildAuthHeaders", () => {
      const incoming = {
        "X-Client-Version": "3.0.0-beta",
        "X-Client-Name": "AntigravityIDE",
      };
      const headers = buildAuthHeaders("Bearer", "test-key", "zn", incoming);

      // The original key casing passed in incoming is preserved in headers
      const versionKey = Object.keys(headers).find((k) => k.toLowerCase() === "x-client-version");
      const nameKey = Object.keys(headers).find((k) => k.toLowerCase() === "x-client-name");

      expect(versionKey).toBeDefined();
      expect(nameKey).toBeDefined();
      if (versionKey) expect(headers[versionKey]).toBe("3.0.0-beta");
      if (nameKey) expect(headers[nameKey]).toBe("AntigravityIDE");
    });

    it("preserves x-client-version and x-client-name in buildUpstreamHeaders from plain Record", () => {
      const incoming = {
        "x-client-version": "0.9.11",
        "x-client-name": "OpenCode-CLI",
        "opencode-session-id": "ses_upstream_meta_01",
      };
      const headers = buildUpstreamHeaders("test-key", "zn", incoming);

      expect(headers["x-client-version"]).toBe("0.9.11");
      expect(headers["x-client-name"]).toBe("OpenCode-CLI");
      expect(headers["session-id"]).toBe("ses_upstream_meta_01");
    });

    it("preserves x-client-version and x-client-name in buildUpstreamHeaders from Headers object", () => {
      const incoming = new Headers({
        "x-client-version": "1.0.0",
        "x-client-name": "CustomAgent",
        "opencode-session": "ses_upstream_meta_02",
      });
      const headers = buildUpstreamHeaders("test-key", "zn", incoming);

      expect(headers["x-client-version"]).toBe("1.0.0");
      expect(headers["x-client-name"]).toBe("CustomAgent");
      expect(headers["session-id"]).toBe("ses_upstream_meta_02");
    });

    it("ignores arbitrary unapproved client headers while preserving metadata headers", () => {
      const incoming = {
        "x-unapproved-header": "dangerous-value",
        "x-client-version": "2.0.0",
        "x-client-name": "OpenCode",
      };
      const headers = buildAuthHeaders("Bearer", "test-key", "oa", incoming);

      expect(headers["x-unapproved-header"]).toBeUndefined();
      expect(headers["x-client-version"]).toBe("2.0.0");
      expect(headers["x-client-name"]).toBe("OpenCode");
    });
  });

  describe("Handling of Both Headers Object and Plain Record<string, string> Inputs", () => {
    it("handles Headers instance correctly with multiple mixed headers", () => {
      const incomingHeaders = new Headers();
      incomingHeaders.set("session-id", "ses_mixed_headers_obj");
      incomingHeaders.set("x-client-name", "OpenCodeTestRunner");
      incomingHeaders.set("x-client-version", "1.0.0");

      const authHeaders = buildAuthHeaders("Bearer", "key-abc", "zn", incomingHeaders);
      expect(authHeaders["session-id"]).toBe("ses_mixed_headers_obj");
      expect(authHeaders["x-client-name"]).toBe("OpenCodeTestRunner");
      expect(authHeaders["x-client-version"]).toBe("1.0.0");
      expect(authHeaders["Authorization"]).toBe("Bearer key-abc");
      expect(authHeaders["Content-Type"]).toBe("application/json");

      const upstreamHeaders = buildUpstreamHeaders("key-xyz", "zn", incomingHeaders);
      expect(upstreamHeaders["session-id"]).toBe("ses_mixed_headers_obj");
      expect(upstreamHeaders["x-client-name"]).toBe("OpenCodeTestRunner");
      expect(upstreamHeaders["x-client-version"]).toBe("1.0.0");
      expect(upstreamHeaders["Authorization"]).toBe("Bearer key-xyz");
      expect(upstreamHeaders["Content-Type"]).toBe("application/json");
    });

    it("handles plain Record<string, string> correctly with multiple mixed headers", () => {
      const incomingRecord: Record<string, string> = {
        "x-opencode-session": "ses_mixed_record_obj",
        "x-client-name": "RecordTestRunner",
        "x-client-version": "2.0.0",
      };

      const authHeaders = buildAuthHeaders("Bearer", "key-123", "zn", incomingRecord);
      expect(authHeaders["session-id"]).toBe("ses_mixed_record_obj");
      expect(authHeaders["x-client-name"]).toBe("RecordTestRunner");
      expect(authHeaders["x-client-version"]).toBe("2.0.0");

      const upstreamHeaders = buildUpstreamHeaders("key-456", "zn", incomingRecord);
      expect(upstreamHeaders["session-id"]).toBe("ses_mixed_record_obj");
      expect(upstreamHeaders["x-client-name"]).toBe("RecordTestRunner");
      expect(upstreamHeaders["x-client-version"]).toBe("2.0.0");
    });

    it("handles undefined incomingHeaders gracefully without throwing", () => {
      expect(() => buildAuthHeaders("Bearer", "key", "oa", undefined)).not.toThrow();
      expect(() => buildUpstreamHeaders("key", "oa", undefined)).not.toThrow();

      const auth = buildAuthHeaders("Bearer", "key", "oa", undefined);
      expect(auth["Authorization"]).toBe("Bearer key");
      expect(auth["session-id"]).toBeDefined();

      const upstream = buildUpstreamHeaders("key", "oa", undefined);
      expect(upstream["Authorization"]).toBe("Bearer key");
      expect(upstream["session-id"]).toBeDefined();
    });

    it("forwards accept header in buildUpstreamHeaders when provided as Record or Headers", () => {
      const recordHeaders = { accept: "text/event-stream" };
      const res1 = buildUpstreamHeaders("k", "oa", recordHeaders);
      expect(res1["Accept"]).toBe("text/event-stream");

      const objHeaders = new Headers({ accept: "application/json" });
      const res2 = buildUpstreamHeaders("k", "oa", objHeaders);
      expect(res2["Accept"]).toBe("application/json");
    });
  });
});
