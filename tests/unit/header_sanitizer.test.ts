import { describe, expect, it } from "bun:test";
import {
  HOP_BY_HOP_AND_ENCODING_HEADERS,
  sanitizeDownstreamHeaders,
} from "../../src/network/fetcher";

describe("Header Sanitizer — Compression and Hop-by-Hop Stripping", () => {
  it("strips content-encoding and compression headers from downstream responses", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      "content-encoding": "gzip",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "x-request-id": "req-12345",
      "retry-after": "60",
    });

    const sanitized = sanitizeDownstreamHeaders(upstream);

    expect(sanitized.has("content-encoding")).toBe(false);
    expect(sanitized.has("transfer-encoding")).toBe(false);
    expect(sanitized.has("connection")).toBe(false);
    expect(sanitized.has("keep-alive")).toBe(false);
    expect(sanitized.get("content-type")).toBe("application/json");
    expect(sanitized.get("x-request-id")).toBe("req-12345");
    expect(sanitized.get("retry-after")).toBe("60");
  });

  it("strips all RFC hop-by-hop headers", () => {
    const upstream = new Headers();
    for (const h of HOP_BY_HOP_AND_ENCODING_HEADERS) {
      upstream.set(h, "test-value");
    }
    upstream.set("x-custom-preserved", "preserved-val");

    const sanitized = sanitizeDownstreamHeaders(upstream);

    for (const h of HOP_BY_HOP_AND_ENCODING_HEADERS) {
      expect(sanitized.has(h)).toBe(false);
    }
    expect(sanitized.get("x-custom-preserved")).toBe("preserved-val");
  });

  it("updates content-length when bodyLength is supplied", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      "content-length": "42", // old compressed length
      "content-encoding": "br",
    });

    const sanitized = sanitizeDownstreamHeaders(upstream, 1024);

    expect(sanitized.has("content-encoding")).toBe(false);
    expect(sanitized.get("content-length")).toBe("1024");
    expect(sanitized.get("content-type")).toBe("application/json");
  });

  it("omits content-length if bodyLength is undefined", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      "content-length": "42",
    });

    const sanitized = sanitizeDownstreamHeaders(upstream);

    expect(sanitized.has("content-length")).toBe(false);
  });
});
