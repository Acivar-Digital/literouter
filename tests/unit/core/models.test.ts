import { test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

test("models.json and fusion.json exist and contain valid structures", () => {
  const modelsPath = path.resolve(import.meta.dir, "../../../models.json");
  const fusionPath = path.resolve(import.meta.dir, "../../../fusion.json");

  expect(fs.existsSync(modelsPath)).toBe(true);
  expect(fs.existsSync(fusionPath)).toBe(true);

  const models = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
  expect(Array.isArray(models)).toBe(true);
  expect(models.length).toBeGreaterThan(0);

  const firstModel = models[0];
  expect(firstModel).toHaveProperty("system_id");
  expect(firstModel).toHaveProperty("provider");
  expect(firstModel).toHaveProperty("upstream_id");

  const fusion = JSON.parse(fs.readFileSync(fusionPath, "utf-8"));
  expect(typeof fusion).toBe("object");
  expect(Object.keys(fusion).length).toBeGreaterThan(0);
});

test("models list aggregation schema adheres to OpenAI /v1/models response format", () => {
  const modelsPath = path.resolve(import.meta.dir, "../../../models.json");
  const fusionPath = path.resolve(import.meta.dir, "../../../fusion.json");

  const modelsData = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
  const fusionData = JSON.parse(fs.readFileSync(fusionPath, "utf-8"));

  const modelList: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
  const seen = new Set<string>();

  for (const m of modelsData) {
    if (m.system_id && !seen.has(m.system_id)) {
      seen.add(m.system_id);
      modelList.push({
        id: m.system_id,
        object: "model",
        created: 1700000000,
        owned_by: m.provider || "literouter",
      });
    }
  }

  for (const id of Object.keys(fusionData)) {
    if (!seen.has(id)) {
      seen.add(id);
      modelList.push({
        id,
        object: "model",
        created: 1700000000,
        owned_by: "literouter-fusion",
      });
    }
  }

  const responseObj = {
    object: "list",
    data: modelList,
  };

  expect(responseObj.object).toBe("list");
  expect(Array.isArray(responseObj.data)).toBe(true);
  expect(responseObj.data.length).toBeGreaterThan(20);
  expect(responseObj.data.some((m) => m.id === "pydantic/google")).toBe(true);
});
