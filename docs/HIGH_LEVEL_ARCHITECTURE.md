# LiteRouter Architecture Overview

## Purpose
LiteRouter is a minimal, high-performance API key load balancer and router built with Bun, designed for deterministic round-robin distribution of API keys with resilient error handling.

## Core Components
- **src/router.ts**: Implements the deterministic round-robin algorithm, maintains a global counter, manages key cooldowns (429) and quarantines (401/403), and provides routing status diagnostics.
- **src/server.ts**: Bun HTTP server that receives requests, applies routing decisions, and forwards them to OpenRouter endpoints.
- **src/config.ts**: Parses and validates configuration from `config.json`, including server settings, OpenRouter API keys, and model aliases.
- **src/doctor.ts** and **src/test.ts**: Diagnostic and testing utilities for validating upstream keys and server health.

## Configuration
- Defined in `config.json` and `config.example.json`.
- Includes server host, port, auth key, OpenRouter base URL, list of API keys, and model aliases mapping semantic names to provider/model combinations.
- API keys are round-robin rotated with cooldown and quarantine handling.

## Routing Policy
- Uses a global counter for sequential deterministic round-robin across available keys.
- Guarantees perfect even distribution mathematically.
- On error, adjusts key state: 429 -> 60s cooldown, 401/403 -> permanent quarantine.
- Counter persists only for the lifetime of the process; resets on restart.

## Error Handling
- 429 (Rate Limit): Key placed on cooldown for 60 seconds; skipped in subsequent rotations.
- 401/403 (Invalid Key): Key quarantined permanently; removed from rotation.
- Diagnostics available via `bun run doctor` and `bun run preflight`.

## Project Structure
- `src/` contains core TypeScript modules.
- `config.json` holds runtime configuration.
- `package.json` defines scripts (`start`, `preflight`, `doctor`, `debug`, etc.).
- `.gitignore` excludes dependencies, logs, IDE files, and sensitive config files.