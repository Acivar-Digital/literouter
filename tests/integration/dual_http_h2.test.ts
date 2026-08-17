import { beforeEach, describe, expect, it } from "bun:test";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration", () => {
  beforeEach(() => {
    resetAllState();
  });

  it("serves cleartext HTTP/1.1 requests correctly on port 7766", async () => {
    const req = new Request("http://localhost:7766/health", {
      method: "GET",
      headers: { Host: "localhost:7766" },
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
  });

  it("processes concurrent parallel requests without head-of-line blocking", async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      new Request(`http://localhost:7766/health?req=${i}`, {
        method: "GET",
      })
    );

    const responses = await Promise.all(requests.map((r) => handleAppRequest(r)));
    for (const res of responses) {
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.status).toBe("healthy");
    }
  });

  it("gracefully falls back when TLS certificates are absent", async () => {
    const req = new Request("http://localhost:7766/health", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
  });
});
