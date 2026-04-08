/**
 * src/validateConfig.ts
 * 
 * Utility to validate config.json.
 * Can be executed via `bun run src/validateConfig.ts`.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Validate that a value is a non-empty string array.
 */
function isNonEmptyStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.length > 0 && val.every(item => typeof item === 'string');
}

/**
 * Validate that a value is a string (optional nullable).
 */
function isStringNullable(val: unknown): val is string | null {
  return typeof val === 'string' || val === null;
}

/**
 * Validate config.json.
 * Exits with code 0 on success, 1 on failure.
 */
function validateConfig(): void {
  const configPath = join(process.cwd(), 'config.json');

  if (!existsSync(configPath)) {
    console.error(`[Config] Error: config.json not found at ${configPath}.`);
    process.exit(1);
  }

  const raw = readFileSync(configPath, 'utf-8');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[Config] Error: Failed to parse config.json as JSON.', e);
    process.exit(1);
  }

  // Validate server object
  const server = parsed.server || {};
  if (!isStringNullable(server.host) && server.host !== undefined) {
    console.error('[Config] Error: server.host must be a string or null.');
    process.exit(1);
  }
  if (server.port !== undefined && typeof server.port !== 'number') {
    console.error('[Config] Error: server.port must be a number.');
    process.exit(1);
  }

  // Validate openrouter object
  const openrouter = parsed.openrouter || {};
  if (typeof openrouter.baseUrl !== 'string') {
    console.error('[Config] Error: openrouter.baseUrl must be a string.');
    process.exit(1);
  }
  if (!isNonEmptyStringArray(openrouter.apiKeys)) {
    console.error('[Config] Error: openrouter.apiKeys must be a non-empty array of strings.');
    process.exit(1);
  }

  // Validate models object (optional)
  const models = parsed.models || {};
  if (models && typeof models === 'object') {
    for (const key of Object.keys(models)) {
      const model = models[key];
      if (typeof model !== 'object' || model === null) {
        console.error(`[Config] Error: models.${key} must be an object.`);
        process.exit(1);
      }
      if (model.provider !== undefined && typeof model.provider !== 'string') {
        console.error(`[Config] Error: models.${key}.provider must be a string or undefined.`);
        process.exit(1);
      }
      if (typeof model.model !== 'string') {
        console.error(`[Config] Error: models.${key}.model must be a string.`);
        process.exit(1);
      }
    }
  }

  console.log('✅ Config validation passed.');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateConfig();
}