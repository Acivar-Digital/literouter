import { beforeEach, describe, expect, it } from "bun:test";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface ModelItem {
  id: string;
  object: string;
  owned_by: string;
}

interface GoogleModelItem {
  name: string;
  displayName: string;
}

describe("Dynamic Model Discovery Integration", () => {
  beforeEach(() => {
    resetAllState();
  });

  it("filters models dynamically for OpenRouter direct key", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer lr-or-cl-ms-no" },
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { object: string; data: ModelItem[] };
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("filters models dynamically for Google Gemini direct key", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer lr-gg-oa-ob-dp" },
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { object: string; data: ModelItem[] };
    expect(body.object).toBe("list");
    expect(body.data.some((m) => m.id.includes("gemini"))).toBe(true);
  });

  it("returns configured models for Fusion preset key", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer lr-fse-quad" },
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { object: string; data: ModelItem[] };
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("serves Google native schema for GET /v1beta/models?key=...", async () => {
    const req = new Request(
      "http://localhost:7766/v1beta/models?key=lr-gg-gg-gc-no",
      { method: "GET" }
    );

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { models: GoogleModelItem[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
  });

  it("rejects model discovery with 401 when key is missing or invalid", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
  });
});
