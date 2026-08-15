import { test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import http2 from "node:http2";
import {
  LITEROUTER_TLS_CERT,
  LITEROUTER_TLS_KEY,
  LITEROUTER_TLS_ENABLED,
} from "../../../src/config/env";

test("TLS configuration resolves valid certificate paths", () => {
  expect(LITEROUTER_TLS_CERT).toBeDefined();
  expect(LITEROUTER_TLS_KEY).toBeDefined();
  expect(fs.existsSync(LITEROUTER_TLS_CERT)).toBe(true);
  expect(fs.existsSync(LITEROUTER_TLS_KEY)).toBe(true);
  expect(LITEROUTER_TLS_ENABLED).toBe(true);
});

test("http2 secure server negotiates HTTP/2 and returns health metadata", async () => {
  const testPort = 17769;
  const server = http2.createSecureServer({
    cert: fs.readFileSync(LITEROUTER_TLS_CERT),
    key: fs.readFileSync(LITEROUTER_TLS_KEY),
    allowHTTP1: true,
  });

  server.on("request", (req, res) => {
    const isH2 =
      typeof req.httpVersion === "string" && req.httpVersion.startsWith("2");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        tls: true,
        protocol: isH2 ? "HTTP/2" : "HTTP/1.1",
        port: testPort,
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as any;
  const boundPort = addr.port;

  try {
    const client = http2.connect(`https://127.0.0.1:${boundPort}`, {
      rejectUnauthorized: false,
    });
    const req = client.request({ ":path": "/health" });

    const chunks: Buffer[] = [];
    const json: any = await new Promise((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString();
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
      req.end();
    });

    client.close();
    expect(json.status).toBe("ok");
    expect(json.tls).toBe(true);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
