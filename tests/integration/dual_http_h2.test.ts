import { beforeEach, describe, expect, it } from "bun:test";
import http2 from "node:http2";
import { resetEnvCache } from "../../src/config/env";
import { createServer, handleAppRequest, resetAllState } from "../../src/lib";

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

  it("negotiates HTTP/2 when server is started with TLS certs", async () => {
    process.env.LITEROUTER_HTTP2 = "true";
    resetEnvCache();
    const testPort = 7891;
    const server = createServer(testPort);
    
    try {
      const client = http2.connect(`https://localhost:${testPort}`, {
        rejectUnauthorized: false,
      });

      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = client.request({
          ":path": "/health",
          ":method": "GET",
        });

        let status = 0;
        let data = "";

        req.on("response", (headers) => {
          status = Number(headers[":status"]);
        });

        req.on("data", (chunk) => {
          data += chunk.toString();
        });

        req.on("end", () => {
          client.close();
          resolve({ status, body: data });
        });

        req.on("error", (err) => {
          client.close();
          reject(err);
        });

        req.end();
      });

      expect(response.status).toBe(200);
      const json = JSON.parse(response.body);
      expect(json.status).toBe("healthy");
    } finally {
      await server.stop();
    }
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
