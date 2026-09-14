import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const LocationConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls_enabled: z.boolean(),
  parent_dir: z.string().min(1).optional(),
  working_folder: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});

export type LocationConfig = z.infer<typeof LocationConfigSchema>;

export function loadLocationConfig(filePath?: string): LocationConfig {
  const projectRoot = resolve(import.meta.dir, "../..");
  const targetPath = resolve(projectRoot, filePath ?? "config/location.json");

  if (!existsSync(targetPath)) {
    throw new Error(
      "[FATAL] Missing or invalid config/location.json. Required fields: host (string), port (int), tls_enabled (boolean)."
    );
  }

  try {
    const raw = readFileSync(targetPath, "utf-8");
    const json = JSON.parse(raw);
    return LocationConfigSchema.parse(json);
  } catch (err) {
    throw new Error(
      "[FATAL] Missing or invalid config/location.json. Required fields: host (string), port (int), tls_enabled (boolean).",
      { cause: err }
    );
  }
}
