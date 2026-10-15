This file is a merged representation of a subset of the codebase, containing specifically included files and files not matching ignore patterns, combined into a single document by Repomix.
The content has been processed where line numbers have been added, content has been formatted for parsing in markdown style.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: package.json, tsconfig.json, bunfig.toml, src/**/*.ts, config/providers.json, config/fusion.json, config/models.json, config/location.json.example
- Files matching these patterns are excluded: .env*, **/*.env*, *.key, *.pem, tests/**, eval/**, admin/**, scripts/**, docs/**, scratch/**, tools/**, oldgen/**, vps/**, *.db*, *.sqlite*, *.log*, repomix.md, repomix-output.*
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Line numbers have been added to the beginning of each line
- Content has been formatted for parsing in markdown style
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
config/
  fusion.json
  location.json.example
  models.json
  providers.json
src/
  config/
    directive.ts
    env.ts
    keys.ts
    location.ts
    providers.ts
    schema.ts
  directive/
    parser.ts
    types.ts
    validator.ts
  engine/
    strategies/
      anthropic_direct.ts
      gcp_guarded.ts
      native_cascade.ts
      standard.ts
      zen.ts
    circuit_breaker.ts
    cooldown.ts
    dispatch.ts
    pacer_adapter.ts
    retry.ts
    session_id.ts
    status_classify.ts
    strategy_registry.ts
    strategy.ts
    transformer.ts
    zen.ts
  fusion/
    engine.ts
    sticky.ts
  handlers/
    v4/
      anthropic_messages.ts
      gcp_compat.ts
      google_native.ts
      openai_chat.ts
      openai_responses.ts
      router.ts
    anthropic_compat.ts
    discovery.ts
    gcp_compat.ts
    google_native.ts
    openai_compat.ts
    openai_original.ts
  lifecycle/
    shutdown.ts
  network/
    circuit_breaker.ts
    classifier.ts
    cooldown.ts
    fetcher.ts
    h2_pool.ts
    pacer.ts
    pool.ts
  telemetry/
    hooks.ts
    ring_buffer.ts
    sanitize.ts
    session.ts
    trace_writer.ts
  transformers/
    anthropic_messages.ts
    anthropic_openai_xwire.ts
    context_pruner.ts
    dots.ts
    google_native.ts
    ling.ts
    nuances.ts
    openai_chat.ts
    openai_responses.ts
    opencode_adapter.ts
    payload.ts
    responses.ts
    thinking.ts
  ui/
    banner.ts
    logger.ts
    telemetry.ts
  index.ts
  lib.ts
bunfig.toml
package.json
tsconfig.json
```

# Files

## File: config/fusion.json
```json
  1: {
  2:   "$schema": "./fusion.schema.json",
  3:   "version": "3.1",
  4:   "presets": {
  5:     "quad": {
  6:       "strategy": "sticky_fallback",
  7:       "timeout_ms": 30000,
  8:       "models": {
  9:         "anthropic/claude-3.7-sonnet": {
 10:           "tiers": [
 11:             {
 12:               "priority": 1,
 13:               "apikey": "lr-or-cl-ms-no",
 14:               "model": "anthropic/claude-3.7-sonnet"
 15:             },
 16:             {
 17:               "priority": 2,
 18:               "apikey": "lr-an-cl-ms-no",
 19:               "model": "claude-3-7-sonnet-20250219"
 20:             }
 21:           ]
 22:         },
 23:         "deepseek/deepseek-r1": {
 24:           "tiers": [
 25:             {
 26:               "priority": 1,
 27:               "apikey": "lr-nv-oa-ch-ts",
 28:               "model": "deepseek-ai/deepseek-r1"
 29:             },
 30:             {
 31:               "priority": 2,
 32:               "apikey": "lr-or-oa-ch-ts",
 33:               "model": "deepseek/deepseek-r1"
 34:             }
 35:           ]
 36:         },
 37:         "gemini-2.5-pro": {
 38:           "tiers": [
 39:             {
 40:               "priority": 1,
 41:               "apikey": "lr-gg-oa-ob-dp",
 42:               "model": "gemini-2.5-pro"
 43:             },
 44:             {
 45:               "priority": 2,
 46:               "apikey": "lr-or-oa-ch-no",
 47:               "model": "google/gemini-2.5-pro"
 48:             }
 49:           ]
 50:         }
 51:       }
 52:     },
 53:     "pydn": {
 54:       "strategy": "sticky_fallback",
 55:       "timeout_ms": 25000,
 56:       "models": {
 57:         "deepseek-reasoner": {
 58:           "tiers": [
 59:             {
 60:               "priority": 1,
 61:               "apikey": "lr-ds-oa-ch-ts",
 62:               "model": "deepseek-reasoner"
 63:             },
 64:             {
 65:               "priority": 2,
 66:               "apikey": "lr-nv-oa-ch-ts",
 67:               "model": "deepseek-ai/deepseek-r1"
 68:             }
 69:           ]
 70:         },
 71:         "claude-3-7-sonnet": {
 72:           "tiers": [
 73:             {
 74:               "priority": 1,
 75:               "apikey": "lr-an-cl-ms-no",
 76:               "model": "claude-3-7-sonnet-20250219"
 77:             },
 78:             {
 79:               "priority": 2,
 80:               "apikey": "lr-or-cl-ms-no",
 81:               "model": "anthropic/claude-3.7-sonnet"
 82:             }
 83:           ]
 84:         }
 85:       }
 86:     },
 87:     "fast": {
 88:       "strategy": "sticky_fallback",
 89:       "timeout_ms": 15000,
 90:       "models": {
 91:         "gemini-3.1-flash-lite": {
 92:           "tiers": [
 93:             {
 94:               "priority": 1,
 95:               "apikey": "lr-gg-oa-ob-dp",
 96:               "model": "gemini-3.1-flash-lite"
 97:             },
 98:             {
 99:               "priority": 2,
100:               "apikey": "lr-or-oa-ch-no",
101:               "model": "google/gemini-3.1-flash-lite"
102:             }
103:           ]
104:         },
105:         "llama-3.3-70b": {
106:           "tiers": [
107:             {
108:               "priority": 1,
109:               "apikey": "lr-gq-oa-ch-no",
110:               "model": "llama-3.3-70b-versatile"
111:             },
112:             {
113:               "priority": 2,
114:               "apikey": "lr-cb-oa-ch-no",
115:               "model": "llama-3.3-70b"
116:             }
117:           ]
118:         }
119:       }
120:     },
121:     "deep": {
122:       "strategy": "sticky_fallback",
123:       "timeout_ms": 45000,
124:       "models": {
125:         "deepseek-r1": {
126:           "tiers": [
127:             {
128:               "priority": 1,
129:               "apikey": "lr-nv-oa-ch-ts",
130:               "model": "deepseek-ai/deepseek-r1"
131:             },
132:             {
133:               "priority": 2,
134:               "apikey": "lr-ds-oa-ch-ts",
135:               "model": "deepseek-reasoner"
136:             },
137:             {
138:               "priority": 3,
139:               "apikey": "lr-or-oa-ch-ts",
140:               "model": "deepseek/deepseek-r1"
141:             }
142:           ]
143:         }
144:       }
145:     }
146:   },
147:   "native_chains": {
148:     "gemini-flash": [
149:       "gemini-3.8-flash",
150:       "gemini-3.7-flash",
151:       "gemini-3.6-flash",
152:       "gemini-3.5-flash"
153:     ],
154:     "gemini-flash-lite": [
155:       "gemini-3.5-flash-lite",
156:       "gemini-3.1-flash-lite"
157:     ]
158:   }
159: }
```

## File: config/models.json
```json
  1: {
  2:   "models": [
  3:     {
  4:       "id": "anthropic/claude-3.7-sonnet",
  5:       "provider": "openrouter",
  6:       "category": "reasoning",
  7:       "supports_thinking": true,
  8:       "supports_tools": true,
  9:       "context_window": 200000
 10:     },
 11:     {
 12:       "id": "dots-studio/dots-3-note-preview:free",
 13:       "provider": "openrouter",
 14:       "category": "reasoning",
 15:       "supports_thinking": true,
 16:       "supports_tools": true,
 17:       "context_window": 512000
 18:     },
 19:     {
 20:       "id": "deepseek/deepseek-r1",
 21:       "provider": "openrouter",
 22:       "category": "reasoning",
 23:       "supports_thinking": true,
 24:       "supports_tools": true,
 25:       "context_window": 164000
 26:     },
 27:     {
 28:       "id": "claude-3-7-sonnet-20250219",
 29:       "provider": "anthropic",
 30:       "category": "reasoning",
 31:       "supports_thinking": true,
 32:       "supports_tools": true,
 33:       "context_window": 200000
 34:     },
 35:     {
 36:       "id": "deepseek-ai/deepseek-r1",
 37:       "provider": "nvidia",
 38:       "category": "reasoning",
 39:       "supports_thinking": true,
 40:       "supports_tools": true,
 41:       "context_window": 164000
 42:     },
 43:     {
 44:       "id": "gemini-3.1-flash-lite",
 45:       "provider": "google",
 46:       "category": "text-out",
 47:       "supports_thinking": false,
 48:       "supports_tools": true,
 49:       "context_window": 1048576,
 50:       "quota": {
 51:         "rpm": 15,
 52:         "rpd": 500,
 53:         "tpm": 250000
 54:       }
 55:     },
 56:     {
 57:       "id": "gemini-3.5-flash-lite",
 58:       "provider": "google",
 59:       "category": "text-out",
 60:       "supports_thinking": false,
 61:       "supports_tools": true,
 62:       "context_window": 1048576,
 63:       "quota": {
 64:         "rpm": 15,
 65:         "rpd": 500,
 66:         "tpm": 250000
 67:       }
 68:     },
 69:     {
 70:       "id": "antigravity",
 71:       "provider": "google",
 72:       "category": "agents",
 73:       "supports_thinking": false,
 74:       "supports_tools": true,
 75:       "context_window": 128000,
 76:       "quota": {
 77:         "rpm": 60,
 78:         "rpd": 100,
 79:         "tpm": 100000
 80:       }
 81:     },
 82:     {
 83:       "id": "gemini-2.5-flash",
 84:       "provider": "google",
 85:       "category": "text-out",
 86:       "supports_thinking": false,
 87:       "supports_tools": true,
 88:       "context_window": 1048576,
 89:       "quota": {
 90:         "rpm": 5,
 91:         "rpd": 20,
 92:         "tpm": 250000
 93:       }
 94:     },
 95:     {
 96:       "id": "gemini-2.5-flash-lite",
 97:       "provider": "google",
 98:       "category": "text-out",
 99:       "supports_thinking": false,
100:       "supports_tools": true,
101:       "context_window": 1048576,
102:       "quota": {
103:         "rpm": 10,
104:         "rpd": 20,
105:         "tpm": 250000
106:       }
107:     },
108:     {
109:       "id": "gemini-3-flash",
110:       "provider": "google",
111:       "category": "text-out",
112:       "supports_thinking": true,
113:       "supports_tools": true,
114:       "context_window": 1048576,
115:       "quota": {
116:         "rpm": 5,
117:         "rpd": 20,
118:         "tpm": 250000
119:       }
120:     },
121:     {
122:       "id": "gemini-3.5-flash",
123:       "provider": "google",
124:       "category": "text-out",
125:       "supports_thinking": true,
126:       "supports_tools": true,
127:       "context_window": 1048576,
128:       "quota": {
129:         "rpm": 5,
130:         "rpd": 20,
131:         "tpm": 250000
132:       }
133:     },
134:     {
135:       "id": "gemini-3.6-flash",
136:       "provider": "google",
137:       "category": "text-out",
138:       "supports_thinking": true,
139:       "supports_tools": true,
140:       "context_window": 1048576,
141:       "quota": {
142:         "rpm": 5,
143:         "rpd": 20,
144:         "tpm": 250000
145:       }
146:     },
147:     {
148:       "id": "gemini-3.7-flash",
149:       "provider": "google",
150:       "category": "text-out",
151:       "supports_thinking": true,
152:       "supports_tools": true,
153:       "context_window": 1048576,
154:       "quota": {
155:         "rpm": 5,
156:         "rpd": 20,
157:         "tpm": 250000
158:       }
159:     },
160:     {
161:       "id": "gemma-4-26b",
162:       "provider": "google",
163:       "category": "open-weights",
164:       "supports_thinking": false,
165:       "supports_tools": false,
166:       "context_window": 8192,
167:       "quota": {
168:         "rpm": 30,
169:         "rpd": 14400,
170:         "tpm": 16000
171:       }
172:     },
173:     {
174:       "id": "gemma-4-31b",
175:       "provider": "google",
176:       "category": "open-weights",
177:       "supports_thinking": false,
178:       "supports_tools": false,
179:       "context_window": 8192,
180:       "quota": {
181:         "rpm": 30,
182:         "rpd": 14400,
183:         "tpm": 16000
184:       }
185:     },
186:     {
187:       "id": "text-embedding-004",
188:       "provider": "google",
189:       "category": "embeddings",
190:       "supports_thinking": false,
191:       "supports_tools": false,
192:       "context_window": 2048,
193:       "quota": {
194:         "rpm": 100,
195:         "rpd": 1000,
196:         "tpm": 30000
197:       }
198:     },
199:     {
200:       "id": "gemini-embedding-2",
201:       "provider": "google",
202:       "category": "embeddings",
203:       "supports_thinking": false,
204:       "supports_tools": false,
205:       "context_window": 8192,
206:       "quota": {
207:         "rpm": 100,
208:         "rpd": 1000,
209:         "tpm": 30000
210:       }
211:     },
212:     {
213:       "id": "gemini-2.5-flash-tts",
214:       "provider": "google",
215:       "category": "audio-tts",
216:       "supports_thinking": false,
217:       "supports_tools": false,
218:       "context_window": 4096,
219:       "quota": {
220:         "rpm": 3,
221:         "rpd": 10,
222:         "tpm": 10000
223:       }
224:     },
225:     {
226:       "id": "gemini-3.1-flash-tts",
227:       "provider": "google",
228:       "category": "audio-tts",
229:       "supports_thinking": false,
230:       "supports_tools": false,
231:       "context_window": 4096,
232:       "quota": {
233:         "rpm": 3,
234:         "rpd": 10,
235:         "tpm": 10000
236:       }
237:     },
238:     {
239:       "id": "gemini-robotics-er-1.5",
240:       "provider": "google",
241:       "category": "robotics",
242:       "supports_thinking": false,
243:       "supports_tools": true,
244:       "context_window": 32768,
245:       "quota": {
246:         "rpm": 10,
247:         "rpd": 20,
248:         "tpm": 250000
249:       }
250:     },
251:     {
252:       "id": "gemini-robotics-er-1.6",
253:       "provider": "google",
254:       "category": "robotics",
255:       "supports_thinking": false,
256:       "supports_tools": true,
257:       "context_window": 32768,
258:       "quota": {
259:         "rpm": 5,
260:         "rpd": 20,
261:         "tpm": 250000
262:       }
263:     },
264:     {
265:       "id": "gemini-robotics-er-2",
266:       "provider": "google",
267:       "category": "robotics",
268:       "supports_thinking": false,
269:       "supports_tools": true,
270:       "context_window": 32768,
271:       "quota": {
272:         "rpm": 5,
273:         "rpd": 20,
274:         "tpm": 250000
275:       }
276:     },
277:     {
278:       "id": "gemma-2-2b-it",
279:       "provider": "gcp",
280:       "category": "open-weights",
281:       "supports_thinking": false,
282:       "supports_tools": false,
283:       "context_window": 16384
284:     },
285:     {
286:       "id": "gemma-2-9b-it",
287:       "provider": "gcp",
288:       "category": "open-weights",
289:       "supports_thinking": false,
290:       "supports_tools": false,
291:       "context_window": 16384
292:     },
293:     {
294:       "id": "gemma-2-27b-it",
295:       "provider": "gcp",
296:       "category": "open-weights",
297:       "supports_thinking": false,
298:       "supports_tools": false,
299:       "context_window": 16384
300:     },
301:     {
302:       "id": "gemma-3-1b-it",
303:       "provider": "gcp",
304:       "category": "open-weights",
305:       "supports_thinking": false,
306:       "supports_tools": false,
307:       "context_window": 16384
308:     },
309:     {
310:       "id": "gemma-3-4b-it",
311:       "provider": "gcp",
312:       "category": "open-weights",
313:       "supports_thinking": false,
314:       "supports_tools": false,
315:       "context_window": 16384
316:     },
317:     {
318:       "id": "gemma-3-12b-it",
319:       "provider": "gcp",
320:       "category": "open-weights",
321:       "supports_thinking": false,
322:       "supports_tools": false,
323:       "context_window": 16384
324:     },
325:     {
326:       "id": "gemma-3-27b-it",
327:       "provider": "gcp",
328:       "category": "open-weights",
329:       "supports_thinking": false,
330:       "supports_tools": false,
331:       "context_window": 16384
332:     },
333:     {
334:       "id": "gemma-4-26b-a4b-it",
335:       "provider": "gcp",
336:       "category": "open-weights",
337:       "supports_thinking": false,
338:       "supports_tools": false,
339:       "context_window": 16384,
340:       "quota": {
341:         "rpm": 30,
342:         "rpd": 14400,
343:         "tpm": 16000
344:       }
345:     },
346:     {
347:       "id": "gemma-4-31b-it",
348:       "provider": "gcp",
349:       "category": "open-weights",
350:       "supports_thinking": false,
351:       "supports_tools": false,
352:       "context_window": 16384,
353:       "quota": {
354:         "rpm": 30,
355:         "rpd": 14400,
356:         "tpm": 16000
357:       }
358:     }
359:   ]
360: }
```

## File: src/config/directive.ts
```typescript
 1: import type {
 2:   CompletionCode,
 3:   DirectDirective,
 4:   FusionDirective,
 5:   NuanceCode,
 6:   ParsedDirective,
 7:   PayloadCode,
 8:   ProviderCode,
 9:   WireProtocol,
10: } from "../directive/parser";
11: import {
12:   isDirectDirective,
13:   isFusionDirective,
14:   parseDirective,
15:   parseNuanceTokens,
16: } from "../directive/parser";
17: import type {
18:   StandardErrorPayload,
19:   ValidationFailure,
20:   ValidationResult,
21:   ValidationSuccess,
22: } from "../directive/validator";
23: import {
24:   DIRECTIVE_ERROR_CODE,
25:   DIRECTIVE_ERROR_TYPE,
26:   createUnauthorizedResponse,
27:   extractDirectiveToken,
28:   normalizeKey,
29:   validateDirective,
30: } from "../directive/validator";
31: 
32: export type {
33:   CompletionCode,
34:   DirectDirective,
35:   FusionDirective,
36:   NuanceCode,
37:   ParsedDirective,
38:   PayloadCode,
39:   ProviderCode,
40:   StandardErrorPayload,
41:   ValidationFailure,
42:   ValidationResult,
43:   ValidationSuccess,
44:   WireProtocol,
45: };
46: 
47: export {
48:   DIRECTIVE_ERROR_CODE,
49:   DIRECTIVE_ERROR_TYPE,
50:   createUnauthorizedResponse,
51:   extractDirectiveToken,
52:   isDirectDirective,
53:   isFusionDirective,
54:   normalizeKey,
55:   parseDirective,
56:   parseNuanceTokens,
57:   validateDirective,
58: };
```

## File: src/directive/parser.ts
```typescript
  1: export type ProviderCode =
  2:   | "or"
  3:   | "nv"
  4:   | "gg"
  5:   | "oa"
  6:   | "an"
  7:   | "gq"
  8:   | "cb"
  9:   | "ds"
 10:   | "ms"
 11:   | "tg"
 12:   | "zn"
 13:   | "tp"
 14:   | "gc";
 15: 
 16: export type WireProtocol = "oa" | "oo" | "cl" | "gg" | "rs" | "ao";
 17: 
 18: export type PayloadCode = WireProtocol;
 19: 
 20: export type CompletionCode =
 21:   | "ch"
 22:   | "ms"
 23:   | "ob"
 24:   | "gc"
 25:   | "g1"
 26:   | "im"
 27:   | "em"
 28:   | "au"
 29:   | "md"
 30:   | "rs";
 31: 
 32: export type NuanceCode = "no" | "dp" | "ts" | "gm" | "g3" | "sb" | "tc" | "lg";
 33: 
 34: export interface DirectDirective {
 35:   readonly type: "direct";
 36:   readonly raw: string;
 37:   readonly provider: ProviderCode;
 38:   readonly payload: PayloadCode;
 39:   readonly wire?: WireProtocol;
 40:   readonly completion: CompletionCode;
 41:   readonly endpoint?: CompletionCode;
 42:   readonly nuances: readonly NuanceCode[];
 43:   readonly reasoning?: string;
 44: }
 45: 
 46: export interface FusionDirective {
 47:   readonly type: "fusion";
 48:   readonly raw: string;
 49:   readonly preset: string;
 50: }
 51: 
 52: export type ParsedDirective = DirectDirective | FusionDirective;
 53: 
 54: const VALID_PROVIDERS: ReadonlySet<string> = new Set([
 55:   "or",
 56:   "nv",
 57:   "gg",
 58:   "oa",
 59:   "an",
 60:   "gq",
 61:   "cb",
 62:   "ds",
 63:   "ms",
 64:   "tg",
 65:   "zn",
 66:   "tp",
 67:   "gc",
 68: ]);
 69: 
 70: const VALID_PAYLOADS: ReadonlySet<string> = new Set(["oa", "oo", "cl", "gg", "rs", "ao"]);
 71: 
 72: const VALID_COMPLETIONS: ReadonlySet<string> = new Set([
 73:   "ch",
 74:   "ms",
 75:   "ob",
 76:   "gc",
 77:   "g1",
 78:   "im",
 79:   "em",
 80:   "au",
 81:   "md",
 82:   "rs",
 83: ]);
 84: 
 85: const VALID_NUANCES: ReadonlySet<string> = new Set([
 86:   "no",
 87:   "dp",
 88:   "ts",
 89:   "gm",
 90:   "g3",
 91:   "sb",
 92:   "tc",
 93:   "lg",
 94: ]);
 95: 
 96: export function parseNuanceTokens(token: string): readonly NuanceCode[] | null {
 97:   if (token.length === 0) {
 98:     return null;
 99:   }
100:   const parts = token.split("+");
101:   const parsed: NuanceCode[] = [];
102:   for (const part of parts) {
103:     if (!VALID_NUANCES.has(part)) {
104:       return null;
105:     }
106:     parsed.push(part as NuanceCode);
107:   }
108:   return Object.freeze(parsed);
109: }
110: 
111: function isValidCode(code: string | undefined, validSet: ReadonlySet<string>): boolean {
112:   if (!code) {
113:     return false;
114:   }
115:   return validSet.has(code);
116: }
117: 
118: function areDirectCodesValid(p: string | undefined, pl: string | undefined, c: string | undefined): boolean {
119:   const pOk = isValidCode(p, VALID_PROVIDERS);
120:   const plOk = isValidCode(pl, VALID_PAYLOADS);
121:   const cOk = isValidCode(c, VALID_COMPLETIONS);
122:   return pOk && plOk && cOk;
123: }
124: 
125: function createDirectDirective(
126:   parts: readonly string[],
127:   raw: string,
128:   nuances: readonly NuanceCode[]
129: ): DirectDirective {
130:   const payload = parts[2] as PayloadCode;
131:   const completion = parts[3] as CompletionCode;
132:   return {
133:     type: "direct",
134:     raw,
135:     provider: parts[1] as ProviderCode,
136:     payload,
137:     wire: payload,
138:     completion,
139:     endpoint: completion,
140:     nuances,
141:     reasoning: parts[4],
142:   };
143: }
144: 
145: function parseDirectKey(
146:   parts: readonly string[],
147:   raw: string
148: ): DirectDirective | null {
149:   if (parts.length !== 5) {
150:     return null;
151:   }
152:   if (!areDirectCodesValid(parts[1], parts[2], parts[3])) {
153:     return null;
154:   }
155:   const nuancePart = parts[4] as string;
156:   const nuances = parseNuanceTokens(nuancePart);
157:   if (nuances === null) {
158:     return null;
159:   }
160:   return createDirectDirective(parts, raw, nuances);
161: }
162: 
163: function parseFusionKey(
164:   parts: readonly string[],
165:   raw: string
166: ): FusionDirective | null {
167:   if (parts.length !== 3) {
168:     return null;
169:   }
170:   if (parts[1] !== "fse") {
171:     return null;
172:   }
173:   const preset = parts[2];
174:   if (!preset) {
175:     return null;
176:   }
177:   return {
178:     type: "fusion",
179:     raw,
180:     preset,
181:   };
182: }
183: 
184: export function isDirectDirective(d: ParsedDirective): d is DirectDirective {
185:   return d.type === "direct";
186: }
187: 
188: export function isFusionDirective(d: ParsedDirective): d is FusionDirective {
189:   return d.type === "fusion";
190: }
191: 
192: export function parseDirective(rawKey: string): ParsedDirective | null {
193:   const normalized = rawKey.trim().toLowerCase();
194:   if (!normalized.startsWith("lr-")) {
195:     return null;
196:   }
197:   const parts = normalized.split("-");
198:   if (parts[1] === "fse") {
199:     return parseFusionKey(parts, normalized);
200:   }
201:   if (parts.length === 5) {
202:     return parseDirectKey(parts, normalized);
203:   }
204:   return null;
205: }
206: 
207: export const parseDirectiveKey = parseDirective;
```

## File: src/directive/types.ts
```typescript
1: export type { ParsedDirective, DirectDirective, FusionDirective } from "./parser";
```

## File: src/engine/strategies/anthropic_direct.ts
```typescript
 1: import type { ProviderExecutionStrategy } from "../strategy";
 2: 
 3: export class AnthropicDirectStrategy implements ProviderExecutionStrategy {
 4:   buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
 5:     return {
 6:       "x-api-key": key,
 7:       "anthropic-version": "2023-06-01",
 8:       "Content-Type": "application/json",
 9:     };
10:   }
11: }
```

## File: src/engine/strategies/gcp_guarded.ts
```typescript
 1: import type { DispatchContext, ProviderExecutionStrategy } from "../strategy";
 2: 
 3: function extractDirectiveModel(directive: unknown): string {
 4:   if (directive && typeof directive === "object" && "model" in directive) {
 5:     const val = (directive as { model?: unknown }).model;
 6:     return typeof val === "string" ? val : "";
 7:   }
 8:   return "";
 9: }
10: 
11: export class GcpGuardedStrategy implements ProviderExecutionStrategy {
12:   preDispatch(ctx: DispatchContext, body: Record<string, unknown>): Response | null {
13:     const fallbackModel = extractDirectiveModel(ctx.directive);
14:     const rawModel =
15:       typeof body.model === "string" && body.model.length > 0
16:         ? body.model
17:         : fallbackModel;
18:     const normalized = rawModel.replace(/^(?:gcp|google)\//i, "");
19: 
20:     if (!normalized.toLowerCase().includes("gemma")) {
21:       return Response.json(
22:         {
23:           error: {
24:             code: "billing_guardrail_violation",
25:             message: `Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models to prevent GCP billing overruns. Model requested: ${rawModel}`,
26:             type: "forbidden",
27:           },
28:         },
29:         { status: 403 }
30:       );
31:     }
32: 
33:     body.model = normalized;
34:     return null;
35:   }
36: 
37:   buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
38:     return {
39:       Authorization: `Bearer ${key}`,
40:       "x-goog-api-key": key,
41:       "Content-Type": "application/json",
42:     };
43:   }
44: }
```

## File: src/engine/strategies/standard.ts
```typescript
 1: import type { ProviderExecutionStrategy } from "../strategy";
 2: 
 3: export class StandardStrategy implements ProviderExecutionStrategy {
 4:   buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
 5:     return {
 6:       Authorization: `Bearer ${key}`,
 7:       "Content-Type": "application/json",
 8:     };
 9:   }
10: }
```

## File: src/engine/cooldown.ts
```typescript
 1: import type { KeyCooldownConfig } from "../config/schema";
 2: 
 3: /**
 4:  * Calculates cooldown duration with exponential backoff, jitter, and Retry-After support.
 5:  */
 6: export function calculateCooldownMs(
 7:   config: KeyCooldownConfig,
 8:   consecutiveFailures: number,
 9:   retryAfterMs?: number
10: ): number {
11:   if (retryAfterMs !== undefined && config.respect_retry_after) {
12:     return Math.round(Math.max(0, retryAfterMs));
13:   }
14: 
15:   // Exponential backoff: initial * factor^failures
16:   const raw = config.initial_cooldown_ms * Math.pow(config.backoff_factor, consecutiveFailures);
17:   const capped = Math.min(raw, config.max_cooldown_ms);
18: 
19:   // Apply jitter: ± jitter_percent
20:   const jitterRange = capped * (config.jitter_percent / 100);
21:   const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitterRange to +jitterRange
22: 
23:   return Math.round(Math.max(0, capped + jitter));
24: }
```

## File: src/engine/retry.ts
```typescript
 1: /**
 2:  * Uniform random bounded retry delay calculation.
 3:  */
 4: 
 5: export interface RetryDelayConfig {
 6:   min_ms: number;
 7:   max_ms: number;
 8: }
 9: 
10: export function calculateRetryDelay(
11:   config: RetryDelayConfig,
12:   attempt: number
13: ): number {
14:   void attempt; // reserved for potential future attempt-aware backoff strategies
15: 
16:   const min = Math.min(config.min_ms, config.max_ms);
17:   const max = Math.max(config.min_ms, config.max_ms);
18: 
19:   if (min === max) {
20:     return Math.round(min);
21:   }
22: 
23:   const range = max - min;
24:   const jitter = Math.random() * range;
25:   return Math.round(min + jitter);
26: }
```

## File: src/engine/transformer.ts
```typescript
 1: import type { ParsedDirective } from "../directive/types";
 2: import type { RequestTelemetry } from "../telemetry/session";
 3: 
 4: export interface OutboundWirePayload {
 5:   readonly endpointKey: string; // "ch", "ms", "rs", "gc", "ob"
 6:   readonly method: "POST" | "GET";
 7:   readonly headers: Record<string, string>;
 8:   readonly body: Record<string, unknown>;
 9:   readonly isStreaming: boolean;
10: }
11: 
12: export interface PayloadTransformerContract {
13:   /** Pure: converts client request body to upstream wire format */
14:   transformClientToWire(
15:     inboundBody: Record<string, unknown>,
16:     directive: ParsedDirective,
17:     headers: Headers
18:   ): OutboundWirePayload;
19: 
20:   /** Pure: converts upstream non-streaming response to client format */
21:   transformWireToClient(
22:     upstreamJson: unknown,
23:     directive: ParsedDirective
24:   ): unknown;
25: 
26:   /**
27:    * Returns a TransformStream for streaming response translation.
28:    */
29:   createWireToClientStream(
30:     directive: ParsedDirective,
31:     telemetry: RequestTelemetry,
32:     clientSignal: AbortSignal
33:   ): TransformStream<Uint8Array, Uint8Array>;
34: }
```

## File: src/fusion/engine.ts
```typescript
 1: import type { FusionConfig, FusionPreset, FusionTier } from "../config/schema";
 2: import { StickyPositionCache } from "./sticky";
 3: 
 4: export interface FusionExecutionPlan {
 5:   readonly preset: string;
 6:   readonly model: string;
 7:   readonly orderedTiers: readonly FusionTier[];
 8:   readonly isStickyActive: boolean;
 9: }
10: 
11: export class FusionEngine {
12:   private readonly config: FusionConfig;
13:   private readonly stickyCache: StickyPositionCache;
14: 
15:   public constructor(config: FusionConfig, stickyCache?: StickyPositionCache) {
16:     this.config = config;
17:     this.stickyCache = stickyCache ?? new StickyPositionCache();
18:   }
19: 
20:   public getStickyCache(): StickyPositionCache {
21:     return this.stickyCache;
22:   }
23: 
24:   public resolvePreset(presetName: string): FusionPreset | null {
25:     const preset = this.config.presets[presetName];
26:     return preset ?? null;
27:   }
28: 
29:   public resolveModelTiers(
30:     presetName: string,
31:     requestedModel: string
32:   ): readonly FusionTier[] | null {
33:     const preset = this.resolvePreset(presetName);
34:     if (!preset) {
35:       return null;
36:     }
37:     const modelConfig = preset.models[requestedModel];
38:     if (!modelConfig || modelConfig.tiers.length === 0) {
39:       return null;
40:     }
41:     return Object.freeze([...modelConfig.tiers].sort((a, b) => a.priority - b.priority));
42:   }
43: 
44:   private sortTiersWithSticky(
45:     tiers: readonly FusionTier[],
46:     stickyPriority: number
47:   ): readonly FusionTier[] {
48:     const stickyTier = tiers.find((t) => t.priority === stickyPriority);
49:     if (!stickyTier) {
50:       return tiers;
51:     }
52:     const otherTiers = tiers.filter((t) => t.priority !== stickyPriority);
53:     return Object.freeze([stickyTier, ...otherTiers]);
54:   }
55: 
56:   public createExecutionPlan(
57:     presetName: string,
58:     modelName: string,
59:     now: number = Date.now()
60:   ): FusionExecutionPlan | null {
61:     const allTiers = this.resolveModelTiers(presetName, modelName);
62:     if (!allTiers || allTiers.length === 0) {
63:       return null;
64:     }
65:     const sticky = this.stickyCache.getStickyTier(presetName, modelName, now);
66:     if (sticky) {
67:       const ordered = this.sortTiersWithSticky(allTiers, sticky.tierPriority);
68:       return { preset: presetName, model: modelName, orderedTiers: ordered, isStickyActive: true };
69:     }
70:     return { preset: presetName, model: modelName, orderedTiers: allTiers, isStickyActive: false };
71:   }
72: 
73:   public handleTierSuccess(
74:     presetName: string,
75:     modelName: string,
76:     successfulTier: FusionTier
77:   ): void {
78:     if (successfulTier.priority === 1) {
79:       this.stickyCache.clearStickyTier(presetName, modelName);
80:     } else {
81:       this.stickyCache.setStickyTier(presetName, modelName, successfulTier);
82:     }
83:   }
84: 
85:   public handleTierFailure(
86:     presetName: string,
87:     modelName: string,
88:     failedTier: FusionTier
89:   ): void {
90:     const currentSticky = this.stickyCache.getStickyTier(presetName, modelName);
91:     if (currentSticky && currentSticky.tierPriority === failedTier.priority) {
92:       this.stickyCache.clearStickyTier(presetName, modelName);
93:     }
94:   }
95: }
```

## File: src/fusion/sticky.ts
```typescript
 1: import type { FusionTier } from "../config/schema";
 2: 
 3: export interface StickyPosition {
 4:   readonly tierPriority: number;
 5:   readonly apikey: string;
 6:   readonly model: string;
 7:   readonly expiresAt: number;
 8: }
 9: 
10: export const FUSION_STICKY_TTL_MS = 300000; // 5 minutes
11: 
12: function makeCacheKey(preset: string, model: string): string {
13:   return `${preset}:${model}`;
14: }
15: 
16: export class StickyPositionCache {
17:   private readonly positions = new Map<string, StickyPosition>();
18:   private readonly defaultTtlMs: number;
19: 
20:   public constructor(ttlMs: number = FUSION_STICKY_TTL_MS) {
21:     this.defaultTtlMs = ttlMs;
22:   }
23: 
24:   public getStickyTier(
25:     preset: string,
26:     model: string,
27:     now: number = Date.now()
28:   ): StickyPosition | null {
29:     const key = makeCacheKey(preset, model);
30:     const entry = this.positions.get(key);
31:     if (!entry) {
32:       return null;
33:     }
34:     if (now >= entry.expiresAt) {
35:       this.positions.delete(key);
36:       return null;
37:     }
38:     return entry;
39:   }
40: 
41:   public setStickyTier(
42:     preset: string,
43:     model: string,
44:     tier: FusionTier,
45:     customTtlMs?: number,
46:     now: number = Date.now()
47:   ): void {
48:     const key = makeCacheKey(preset, model);
49:     const ttl = customTtlMs ?? this.defaultTtlMs;
50:     const entry: StickyPosition = {
51:       tierPriority: tier.priority,
52:       apikey: tier.apikey,
53:       model: tier.model,
54:       expiresAt: now + ttl,
55:     };
56:     this.positions.set(key, entry);
57:   }
58: 
59:   public clearStickyTier(preset: string, model: string): void {
60:     const key = makeCacheKey(preset, model);
61:     this.positions.delete(key);
62:   }
63: 
64:   public clearAll(): void {
65:     this.positions.clear();
66:   }
67: }
```

## File: src/handlers/v4/anthropic_messages.ts
```typescript
 1: import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
 2: import { parseDirectiveKey } from "../../directive/parser";
 3: import { anthropicMessagesTransformer } from "../../transformers/anthropic_messages";
 4: import { anthropicOpenAiXWireTransformer } from "../../transformers/anthropic_openai_xwire";
 5: 
 6: export async function handleAnthropicMessages(
 7:   req: Request,
 8:   rawKey: string,
 9:   reqId: string = crypto.randomUUID()
10: ): Promise<Response> {
11:   let body: Record<string, unknown> = {};
12:   const text = await req.text();
13:   if (text.trim()) {
14:     try {
15:       body = JSON.parse(text) as Record<string, unknown>;
16:     } catch {
17:       return Response.json(
18:         { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
19:         { status: 400 }
20:       );
21:     }
22:   }
23: 
24:   const directive = parseDirectiveKey(rawKey);
25:   if (!directive) {
26:     return Response.json(
27:       { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
28:       { status: 400 }
29:     );
30:   }
31: 
32:   const isAo = directive.type === "direct" && directive.wire === "ao";
33:   const transformer = isAo ? anthropicOpenAiXWireTransformer : anthropicMessagesTransformer;
34:   const outboundPayload = transformer.transformClientToWire(body, directive, req.headers);
35:   const dispatchReq: DispatchRequest = {
36:     reqId,
37:     method: req.method,
38:     path: new URL(req.url).pathname,
39:     directive,
40:     rawInboundBody: body,
41:     outboundPayload,
42:     clientSignal: req.signal,
43:     clientHeaders: req.headers,
44:     transformer,
45:   };
46: 
47:   return executeDispatchPipeline(dispatchReq);
48: }
49: 
50: export const handleV4AnthropicMessages = handleAnthropicMessages;
```

## File: src/handlers/v4/gcp_compat.ts
```typescript
 1: import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
 2: import { parseDirectiveKey } from "../../directive/parser";
 3: import { openAiChatTransformer } from "../../transformers/openai_chat";
 4: import { googleNativeTransformer } from "../../transformers/google_native";
 5: 
 6: export async function handleGcpCompat(
 7:   req: Request,
 8:   rawKey: string,
 9:   reqId: string = crypto.randomUUID()
10: ): Promise<Response> {
11:   let body: Record<string, unknown> = {};
12:   const text = await req.text();
13:   if (text.trim()) {
14:     try {
15:       body = JSON.parse(text) as Record<string, unknown>;
16:     } catch {
17:       return Response.json(
18:         { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
19:         { status: 400 }
20:       );
21:     }
22:   }
23: 
24:   const directive = parseDirectiveKey(rawKey);
25:   if (!directive) {
26:     return Response.json(
27:       { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
28:       { status: 400 }
29:     );
30:   }
31: 
32:   const isGoogleWire = directive.type === "direct" && directive.wire === "gg";
33:   const transformer = isGoogleWire ? googleNativeTransformer : openAiChatTransformer;
34:   const outboundPayload = transformer.transformClientToWire(body, directive, req.headers);
35:   const dispatchReq: DispatchRequest = {
36:     reqId,
37:     method: req.method,
38:     path: new URL(req.url).pathname,
39:     directive,
40:     rawInboundBody: body,
41:     outboundPayload,
42:     clientSignal: req.signal,
43:     clientHeaders: req.headers,
44:     transformer,
45:   };
46: 
47:   return executeDispatchPipeline(dispatchReq);
48: }
49: 
50: export const handleV4GcpCompat = handleGcpCompat;
```

## File: src/handlers/v4/openai_chat.ts
```typescript
 1: import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
 2: import { parseDirectiveKey } from "../../directive/parser";
 3: import { openAiChatTransformer } from "../../transformers/openai_chat";
 4: 
 5: export async function handleOpenAiChat(
 6:   req: Request,
 7:   rawKey: string,
 8:   reqId: string = crypto.randomUUID()
 9: ): Promise<Response> {
10:   let body: Record<string, unknown> = {};
11:   const text = await req.text();
12:   if (text.trim()) {
13:     try {
14:       body = JSON.parse(text) as Record<string, unknown>;
15:     } catch {
16:       return Response.json(
17:         { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
18:         { status: 400 }
19:       );
20:     }
21:   }
22: 
23:   const directive = parseDirectiveKey(rawKey);
24:   if (!directive) {
25:     return Response.json(
26:       { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
27:       { status: 400 }
28:     );
29:   }
30: 
31:   const outboundPayload = openAiChatTransformer.transformClientToWire(body, directive, req.headers);
32:   const dispatchReq: DispatchRequest = {
33:     reqId,
34:     method: req.method,
35:     path: new URL(req.url).pathname,
36:     directive,
37:     rawInboundBody: body,
38:     outboundPayload,
39:     clientSignal: req.signal,
40:     clientHeaders: req.headers,
41:     transformer: openAiChatTransformer,
42:   };
43: 
44:   return executeDispatchPipeline(dispatchReq);
45: }
46: 
47: export const handleV4OpenAIChat = handleOpenAiChat;
```

## File: src/handlers/v4/openai_responses.ts
```typescript
 1: import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
 2: import { parseDirectiveKey } from "../../directive/parser";
 3: import { openAiResponsesTransformer } from "../../transformers/openai_responses";
 4: 
 5: export async function handleOpenAiResponses(
 6:   req: Request,
 7:   rawKey: string,
 8:   reqId: string = crypto.randomUUID()
 9: ): Promise<Response> {
10:   let body: Record<string, unknown> = {};
11:   const text = await req.text();
12:   if (text.trim()) {
13:     try {
14:       body = JSON.parse(text) as Record<string, unknown>;
15:     } catch {
16:       return Response.json(
17:         { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
18:         { status: 400 }
19:       );
20:     }
21:   }
22: 
23:   const directive = parseDirectiveKey(rawKey);
24:   if (!directive) {
25:     return Response.json(
26:       { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
27:       { status: 400 }
28:     );
29:   }
30: 
31:   const outboundPayload = openAiResponsesTransformer.transformClientToWire(body, directive, req.headers);
32:   const dispatchReq: DispatchRequest = {
33:     reqId,
34:     method: req.method,
35:     path: new URL(req.url).pathname,
36:     directive,
37:     rawInboundBody: body,
38:     outboundPayload,
39:     clientSignal: req.signal,
40:     clientHeaders: req.headers,
41:     transformer: openAiResponsesTransformer,
42:   };
43: 
44:   return executeDispatchPipeline(dispatchReq);
45: }
46: 
47: export const handleV4OpenAIResponses = handleOpenAiResponses;
```

## File: src/handlers/discovery.ts
```typescript
  1: import { existsSync, readFileSync } from "node:fs";
  2: import { resolve } from "node:path";
  3: import type { ParsedDirective } from "../directive/parser";
  4: 
  5: export interface ModelItem {
  6:   readonly id: string;
  7:   readonly object: "model";
  8:   readonly created: number;
  9:   readonly owned_by: string;
 10:   readonly permission: readonly unknown[];
 11: }
 12: 
 13: export interface OpenAIModelsResponse {
 14:   readonly object: "list";
 15:   readonly data: readonly ModelItem[];
 16: }
 17: 
 18: export interface GoogleModelItem {
 19:   readonly name: string;
 20:   readonly displayName: string;
 21:   readonly description?: string;
 22:   readonly inputTokenLimit?: number;
 23:   readonly outputTokenLimit?: number;
 24: }
 25: 
 26: export interface GoogleModelsResponse {
 27:   readonly models: readonly GoogleModelItem[];
 28: }
 29: 
 30: interface RawFusionConfig {
 31:   readonly presets?: Record<string, { readonly models?: Record<string, unknown> }>;
 32: }
 33: 
 34: interface RawCatalogConfig {
 35:   readonly models?: ReadonlyArray<{ readonly id: string; readonly provider?: string }>;
 36: }
 37: 
 38: function loadCatalogModels(): Array<{ id: string; owned_by: string }> {
 39:   const p = resolve(process.cwd(), "config", "models.json");
 40:   if (!existsSync(p)) {
 41:     return [
 42:       { id: "anthropic/claude-3.7-sonnet", owned_by: "openrouter" },
 43:       { id: "deepseek/deepseek-r1", owned_by: "nvidia" },
 44:       { id: "gemini-2.5-pro", owned_by: "google" },
 45:     ];
 46:   }
 47:   try {
 48:     const raw = JSON.parse(readFileSync(p, "utf-8")) as RawCatalogConfig;
 49:     const entries = raw.models ?? [];
 50:     return entries.map((meta) => ({
 51:       id: meta.id,
 52:       owned_by: meta.provider ?? "literouter",
 53:     }));
 54:   } catch {
 55:     return [{ id: "gemini-2.5-pro", owned_by: "google" }];
 56:   }
 57: }
 58: 
 59: function loadFusionPresetModels(preset: string): Array<{ id: string; owned_by: string }> {
 60:   const p = resolve(process.cwd(), "config", "fusion.json");
 61:   if (!existsSync(p)) {
 62:     return [];
 63:   }
 64:   try {
 65:     const raw = JSON.parse(readFileSync(p, "utf-8")) as RawFusionConfig;
 66:     const targetPreset = raw.presets?.[preset];
 67:     if (!targetPreset?.models) {
 68:       return [];
 69:     }
 70:     return Object.keys(targetPreset.models).map((id) => ({
 71:       id,
 72:       owned_by: `fusion:${preset}`,
 73:     }));
 74:   } catch {
 75:     return [];
 76:   }
 77: }
 78: 
 79: function toOpenAIList(models: Array<{ id: string; owned_by: string }>): OpenAIModelsResponse {
 80:   const now = Math.floor(Date.now() / 1000);
 81:   const data: ModelItem[] = models.map((m) => ({
 82:     id: m.id,
 83:     object: "model",
 84:     created: now,
 85:     owned_by: m.owned_by,
 86:     permission: [],
 87:   }));
 88:   return { object: "list", data };
 89: }
 90: 
 91: function toGoogleList(models: Array<{ id: string; owned_by: string }>): GoogleModelsResponse {
 92:   const formatted: GoogleModelItem[] = models.map((m) => ({
 93:     name: m.id.startsWith("models/") ? m.id : `models/${m.id}`,
 94:     displayName: m.id,
 95:     description: `LiteRouter dynamically routed model (${m.owned_by})`,
 96:   }));
 97:   return { models: formatted };
 98: }
 99: 
100: function filterByDirective(directive: ParsedDirective | null): Array<{ id: string; owned_by: string }> {
101:   if (!directive) {
102:     return loadCatalogModels();
103:   }
104:   if (directive.type === "fusion") {
105:     const fusionModels = loadFusionPresetModels(directive.preset);
106:     return fusionModels.length > 0 ? fusionModels : loadCatalogModels();
107:   }
108:   const all = loadCatalogModels();
109:   const matched = all.filter((m) => m.owned_by.toLowerCase().includes(directive.provider.toLowerCase()));
110:   return matched.length > 0 ? matched : all;
111: }
112: 
113: export async function handleModelsDiscovery(
114:   req: Request,
115:   directive: ParsedDirective | null
116: ): Promise<Response> {
117:   const url = new URL(req.url);
118:   const isGoogle = url.pathname.includes("/v1beta/");
119:   const filtered = filterByDirective(directive);
120: 
121:   if (isGoogle) {
122:     return Response.json(toGoogleList(filtered), { status: 200 });
123:   }
124: 
125:   return Response.json(toOpenAIList(filtered), { status: 200 });
126: }
```

## File: src/lifecycle/shutdown.ts
```typescript
  1: import { getEnv } from "../config/env";
  2: 
  3: let isDraining = false;
  4: const inFlightRequests = new Set<Promise<unknown>>();
  5: const listeners = new Set<() => void>();
  6: 
  7: function notifyIfDrained(): void {
  8:   if (inFlightRequests.size === 0) {
  9:     for (const listener of listeners) {
 10:       listener();
 11:     }
 12:   }
 13: }
 14: 
 15: /**
 16:  * Tracks an in-flight promise. Removes it upon settlement and notifies drain listeners.
 17:  */
 18: export function trackInFlight<T>(promise: Promise<T>): Promise<T> {
 19:   const untyped = promise as Promise<unknown>;
 20:   inFlightRequests.add(untyped);
 21: 
 22:   const cleanup = (): void => {
 23:     inFlightRequests.delete(untyped);
 24:     if (isDraining) {
 25:       notifyIfDrained();
 26:     }
 27:   };
 28: 
 29:   promise.then(cleanup, cleanup);
 30:   return promise;
 31: }
 32: 
 33: /**
 34:  * Returns current count of in-flight requests.
 35:  */
 36: export function getInFlightCount(): number {
 37:   return inFlightRequests.size;
 38: }
 39: 
 40: /**
 41:  * Initiates draining of all tracked in-flight requests.
 42:  * Resolves when all requests complete or timeout is reached.
 43:  */
 44: export async function drainInFlight(timeoutMs?: number): Promise<void> {
 45:   isDraining = true;
 46:   if (inFlightRequests.size === 0) {
 47:     return;
 48:   }
 49: 
 50:   const defaultTimeout = (getEnv().LITEROUTER_IDLE_TIMEOUT_SEC ?? 60) * 1000;
 51:   const effectiveTimeout = timeoutMs ?? defaultTimeout;
 52: 
 53:   await new Promise<void>((resolve) => {
 54:     let timer: ReturnType<typeof setTimeout> | null = null;
 55: 
 56:     const onDone = (): void => {
 57:       if (timer !== null) {
 58:         clearTimeout(timer);
 59:         timer = null;
 60:       }
 61:       listeners.delete(onDone);
 62:       resolve();
 63:     };
 64: 
 65:     listeners.add(onDone);
 66: 
 67:     timer = setTimeout(() => {
 68:       listeners.delete(onDone);
 69:       resolve();
 70:     }, effectiveTimeout);
 71:   });
 72: }
 73: 
 74: /**
 75:  * Resets drain state (primarily for unit tests).
 76:  */
 77: export function resetDrainState(): void {
 78:   isDraining = false;
 79:   inFlightRequests.clear();
 80:   listeners.clear();
 81: }
 82: 
 83: /**
 84:  * Registers process-level signal handlers for graceful shutdown.
 85:  */
 86: export function registerShutdownHandlers(
 87:   onDrainComplete?: () => void | Promise<void>
 88: ): void {
 89:   const handleSignal = async (signal: string): Promise<void> => {
 90:     console.log(`[SHUTDOWN] Received ${signal}. Draining ${getInFlightCount()} in-flight requests...`);
 91:     await drainInFlight();
 92:     if (onDrainComplete) {
 93:       await onDrainComplete();
 94:     }
 95:   };
 96: 
 97:   process.on("SIGINT", () => {
 98:     void handleSignal("SIGINT");
 99:   });
100: 
101:   process.on("SIGTERM", () => {
102:     void handleSignal("SIGTERM");
103:   });
104: }
```

## File: src/network/h2_pool.ts
```typescript
  1: import http2, {
  2:   type ClientHttp2Session,
  3:   type ClientHttp2Stream,
  4:   constants as h2Constants,
  5: } from "node:http2";
  6: 
  7: export interface PooledSession {
  8:   session: ClientHttp2Session;
  9:   activeStreams: number;
 10:   origin: string;
 11:   isDraining: boolean;
 12:   createdAt?: number;
 13:   ageTimer?: ReturnType<typeof setTimeout>;
 14:   drainTimer?: ReturnType<typeof setTimeout>;
 15: }
 16: 
 17: export interface Http2PoolConfig {
 18:   readonly maxStreamsPerSession?: number;
 19:   readonly sessionsPerOrigin?: number;
 20:   readonly maxSessionAgeMs?: number;
 21:   readonly drainTimeoutMs?: number;
 22:   readonly connectTimeoutMs?: number;
 23: }
 24: 
 25: export class Http2SessionPool {
 26:   private readonly sessions = new Map<string, PooledSession[]>();
 27:   private readonly connectionLocks = new Map<string, Promise<ClientHttp2Session>>();
 28:   private readonly maxStreamsPerSession: number;
 29:   private readonly sessionsPerOrigin: number;
 30:   private readonly maxSessionAgeMs: number;
 31:   private readonly drainTimeoutMs: number;
 32:   private readonly connectTimeoutMs: number;
 33: 
 34:   constructor(config?: Http2PoolConfig) {
 35:     this.maxStreamsPerSession = config?.maxStreamsPerSession ?? 80;
 36:     this.sessionsPerOrigin = config?.sessionsPerOrigin ?? 1;
 37:     this.maxSessionAgeMs = config?.maxSessionAgeMs ?? 180000;
 38:     this.drainTimeoutMs = config?.drainTimeoutMs ?? 30000;
 39:     this.connectTimeoutMs = config?.connectTimeoutMs ?? 10000;
 40:   }
 41: 
 42:   public isSessionHealthy(session: ClientHttp2Session): boolean {
 43:     if (session.closed || session.destroyed || session.connecting) {
 44:       return false;
 45:     }
 46:     const socket = (session as unknown as { socket?: { destroyed?: boolean } }).socket;
 47:     if (socket && socket.destroyed) {
 48:       return false;
 49:     }
 50:     return true;
 51:   }
 52: 
 53:   public purgeSession(poolKey: string, session: ClientHttp2Session): void {
 54:     const pool = this.sessions.get(poolKey);
 55:     if (!pool) return;
 56:     const item = pool.find((p) => p.session === session);
 57:     if (item) {
 58:       this.destroySession(poolKey, item);
 59:     }
 60:   }
 61: 
 62:   public async acquireSession(poolKey: string, explicitOrigin?: string): Promise<ClientHttp2Session> {
 63:     const connectOrigin = explicitOrigin ?? poolKey.split("#")[0] ?? poolKey;
 64:     const pool = this.sessions.get(poolKey) ?? [];
 65: 
 66:     // 1. Clean up dead/unhealthy sessions and find existing active, non-draining session
 67:     const validPool: PooledSession[] = [];
 68:     for (const item of pool) {
 69:       if (!this.isSessionHealthy(item.session)) {
 70:         this.destroySession(poolKey, item);
 71:         continue;
 72:       }
 73:       validPool.push(item);
 74:       if (!item.isDraining && item.activeStreams < this.maxStreamsPerSession) {
 75:         item.activeStreams++;
 76:         return item.session;
 77:       }
 78:     }
 79: 
 80:     // 2. Check if a connection is already in-flight (Single-Flight Mutex with try/catch)
 81:     const inFlightConnection = this.connectionLocks.get(poolKey);
 82:     if (inFlightConnection) {
 83:       try {
 84:         const session = await inFlightConnection;
 85:         const item = (this.sessions.get(poolKey) ?? []).find((p) => p.session === session);
 86:         if (item && !item.isDraining && this.isSessionHealthy(item.session) && item.activeStreams < this.maxStreamsPerSession) {
 87:           item.activeStreams++;
 88:           return item.session;
 89:         }
 90:       } catch (err) {
 91:         // Shared flight failed; log and fall through safely to direct creation or fallback
 92:         console.warn(`[H2 Pool] In-flight connection attempt failed for ${poolKey}, bypassing lock:`, err);
 93:       }
 94:     }
 95: 
 96:     // 3. Spawn new session with Single-Flight Mutex lock if under sessionsPerOrigin
 97:     const activeNonDraining = validPool.filter((p) => !p.isDraining && this.isSessionHealthy(p.session));
 98:     if (activeNonDraining.length < this.sessionsPerOrigin) {
 99:       const connectPromise = this.createSession(poolKey, connectOrigin);
100:       this.connectionLocks.set(poolKey, connectPromise);
101: 
102:       try {
103:         const session = await connectPromise;
104:         const item = (this.sessions.get(poolKey) ?? []).find((p) => p.session === session);
105:         if (item) item.activeStreams++;
106:         return session;
107:       } finally {
108:         this.connectionLocks.delete(poolKey);
109:       }
110:     }
111: 
112:     // 4. Fallback: all sessions are maxed out, but we still need to route traffic.
113:     // We create an emergency session. [SRE FIX: Must increment activeStreams!]
114:     const emergencySession = await this.createSession(poolKey, connectOrigin);
115:     const item = (this.sessions.get(poolKey) ?? []).find((p) => p.session === emergencySession);
116:     if (item) {
117:       item.activeStreams++;
118:     }
119:     return emergencySession;
120:   }
121: 
122:   /**
123:    * Attaches an atomic lifecycle guard to the HTTP/2 stream ensuring releaseStream is guaranteed.
124:    */
125:   public attachStreamGuard(poolKey: string, session: ClientHttp2Session, stream: ClientHttp2Stream): void {
126:     let released = false;
127:     const releaseOnce = () => {
128:       if (released) return;
129:       released = true;
130:       this.releaseStream(poolKey, session);
131:     };
132: 
133:     stream.once("close", releaseOnce);
134:     stream.once("error", releaseOnce);
135:     stream.once("frameError", releaseOnce);
136:     stream.once("finish", releaseOnce);
137:     // Release on abort only where the stream object supports the signal.
138:     if ("aborted" in stream) {
139:       stream.once("aborted", releaseOnce);
140:     }
141:   }
142: 
143:   public releaseStream(poolKey: string, session: ClientHttp2Session): void {
144:     const pool = this.sessions.get(poolKey);
145:     if (!pool) return;
146:     const item = pool.find((p) => p.session === session);
147:     if (item && item.activeStreams > 0) {
148:       item.activeStreams--;
149:       // If session is draining and all active streams finished, clean up immediately
150:       if (item.isDraining && item.activeStreams === 0) {
151:         this.destroySession(poolKey, item);
152:       }
153:     }
154:   }
155: 
156:   public getSessionStats(poolKey?: string) {
157:     if (poolKey) {
158:       let sessionCount = 0;
159:       let activeSessions = 0;
160:       let totalActiveStreams = 0;
161: 
162:       for (const [key, pool] of this.sessions.entries()) {
163:         if (key === poolKey || key.startsWith(`${poolKey}#`)) {
164:           sessionCount += pool.length;
165:           activeSessions += pool.filter((p) => !p.isDraining && !p.session.closed).length;
166:           totalActiveStreams += pool.reduce((acc, p) => acc + p.activeStreams, 0);
167:         }
168:       }
169: 
170:       return {
171:         origin: poolKey,
172:         sessionCount,
173:         activeSessions,
174:         totalActiveStreams,
175:       };
176:     }
177:     const allStats: Record<string, { sessionCount: number; activeSessions: number; totalActiveStreams: number }> = {};
178:     for (const [key, pool] of this.sessions.entries()) {
179:       allStats[key] = {
180:         sessionCount: pool.length,
181:         activeSessions: pool.filter((p) => !p.isDraining && !p.session.closed).length,
182:         totalActiveStreams: pool.reduce((acc, p) => acc + p.activeStreams, 0),
183:       };
184:     }
185:     return allStats;
186:   }
187: 
188:   public closeAll(): void {
189:     for (const [poolKey, pool] of this.sessions.entries()) {
190:       for (const item of pool) {
191:         if (item.ageTimer) clearTimeout(item.ageTimer);
192:         if (item.drainTimer) clearTimeout(item.drainTimer);
193:         try {
194:           if (!item.session.closed && !item.session.destroyed) {
195:             item.session.destroy();
196:           }
197:         } catch (err: unknown) {
198:           console.debug(`[H2 Pool] Ignored destroy error on closeAll for ${poolKey}:`, err);
199:         }
200:       }
201:     }
202:     this.sessions.clear();
203:     this.connectionLocks.clear();
204:   }
205: 
206:   private startDraining(poolKey: string, item: PooledSession): void {
207:     if (item.isDraining) return;
208:     item.isDraining = true;
209:     if (item.ageTimer) {
210:       clearTimeout(item.ageTimer);
211:       item.ageTimer = undefined;
212:     }
213:     if (item.activeStreams === 0) {
214:       this.destroySession(poolKey, item);
215:       return;
216:     }
217:     item.drainTimer = setTimeout(() => {
218:       if (item.activeStreams > 0) {
219:         item.drainTimer = undefined;
220:         item.isDraining = false;
221:         this.startDraining(poolKey, item);
222:       } else {
223:         this.destroySession(poolKey, item);
224:       }
225:     }, this.drainTimeoutMs);
226:   }
227: 
228:   private async createSession(poolKey: string, connectOrigin: string): Promise<ClientHttp2Session> {
229:     return new Promise<ClientHttp2Session>((resolve, reject) => {
230:       let connectTimer: ReturnType<typeof setTimeout> | null = null;
231:       let session: ClientHttp2Session;
232: 
233:       try {
234:         session = http2.connect(connectOrigin, {
235:           // ALPN negotiation happens over TLS
236:           timeout: this.connectTimeoutMs,
237:         });
238:       } catch (err) {
239:         return reject(err);
240:       }
241: 
242:       const pooled: PooledSession = {
243:         session,
244:         activeStreams: 0,
245:         origin: connectOrigin,
246:         isDraining: false,
247:         createdAt: Date.now(),
248:       };
249: 
250:       const cleanupListeners = () => {
251:         if (connectTimer) clearTimeout(connectTimer);
252:         session.removeListener("connect", onConnect);
253:         session.removeListener("error", onError);
254:       };
255: 
256:       const onConnect = () => {
257:         cleanupListeners();
258:         const pool = this.sessions.get(poolKey) ?? [];
259:         pool.push(pooled);
260:         this.sessions.set(poolKey, pool);
261: 
262:         // Schedule proactive rotation timer with jitter to prevent simultaneous pool drains
263:         if (this.maxSessionAgeMs > 0) {
264:           const jitter = (Math.random() - 0.5) * 30000;
265:           const ttl = Math.max(10000, this.maxSessionAgeMs + jitter);
266:           pooled.ageTimer = setTimeout(() => {
267:             this.startDraining(poolKey, pooled);
268:           }, ttl);
269:         }
270: 
271:         // Attach permanent runtime error and lifecycle listeners to purge zombie sessions
272:         session.on("error", (err: Error) => {
273:           console.debug(`[H2 Pool] Runtime socket error for ${poolKey}, purging session:`, err?.message || err);
274:           this.destroySession(poolKey, pooled);
275:         });
276: 
277:         session.on("frameError", (type: number, code: number, id: number) => {
278:           console.debug(`[H2 Pool] Frame error (type=${type}, code=${code}, id=${id}) for ${poolKey}, purging session`);
279:           this.destroySession(poolKey, pooled);
280:         });
281: 
282:         resolve(session);
283:       };
284: 
285:       const onError = (err: Error) => {
286:         cleanupListeners();
287:         this.destroySession(poolKey, pooled);
288:         reject(err);
289:       };
290: 
291:       connectTimer = setTimeout(() => {
292:         cleanupListeners();
293:         this.destroySession(poolKey, pooled);
294:         reject(new Error(`HTTP/2 connection timeout to origin ${connectOrigin}`));
295:       }, this.connectTimeoutMs);
296: 
297:       session.once("connect", onConnect);
298:       session.once("error", onError);
299: 
300:       session.on("close", () => this.destroySession(poolKey, pooled));
301: 
302:       // Upstream GOAWAY Handler: Keep session in pool for active stream releases, but mark isDraining
303:       session.on("goaway", () => {
304:         this.startDraining(poolKey, pooled);
305:       });
306:     });
307:   }
308: 
309:   private destroySession(poolKey: string, item: PooledSession): void {
310:     if (item.ageTimer) {
311:       clearTimeout(item.ageTimer);
312:       item.ageTimer = undefined;
313:     }
314:     if (item.drainTimer) {
315:       clearTimeout(item.drainTimer);
316:       item.drainTimer = undefined;
317:     }
318:     if (!item.session.destroyed && !item.session.closed) {
319:       try {
320:         if (item.isDraining && item.activeStreams > 0) {
321:           if (typeof item.session.close === "function") {
322:             item.session.close();
323:           }
324:         } else if (typeof item.session.destroy === "function") {
325:           item.session.destroy();
326:         } else if (typeof item.session.close === "function") {
327:           item.session.close();
328:         }
329:       } catch (err: unknown) {
330:         console.debug(`[H2 Pool] Ignored destroy error during destroySession for ${poolKey}:`, err);
331:       }
332:     }
333:     this.removeSession(poolKey, item.session);
334:   }
335: 
336:   private removeSession(poolKey: string, session: ClientHttp2Session): void {
337:     const pool = this.sessions.get(poolKey);
338:     if (!pool) return;
339:     const filtered = pool.filter((p) => p.session !== session);
340:     if (filtered.length === 0) {
341:       this.sessions.delete(poolKey);
342:     } else {
343:       this.sessions.set(poolKey, filtered);
344:     }
345:   }
346: }
347: 
348: // Global HTTP/2 Session Pool singleton
349: let globalHttp2Pool: Http2SessionPool | null = null;
350: 
351: export function getHttp2Pool(): Http2SessionPool {
352:   if (!globalHttp2Pool) {
353:     globalHttp2Pool = new Http2SessionPool();
354:   }
355:   return globalHttp2Pool;
356: }
357: 
358: export function resetHttp2Pool(): void {
359:   if (globalHttp2Pool) {
360:     globalHttp2Pool.closeAll();
361:     globalHttp2Pool = null;
362:   }
363: }
```

## File: src/telemetry/hooks.ts
```typescript
 1: export interface MetricsHook {
 2:   onRequestStart(reqId: string, provider: string, model: string): void;
 3:   onRequestEnd(reqId: string, status: number, durationMs: number, ttftMs?: number): void;
 4:   onKeyRotation(reqId: string, provider: string, fromKey: number, toKey: number): void;
 5:   onCircuitBreakerStateChange(provider: string, oldState: string, newState: string): void;
 6: }
 7: 
 8: export const noopMetrics: MetricsHook = Object.freeze({
 9:   onRequestStart() {},
10:   onRequestEnd() {},
11:   onKeyRotation() {},
12:   onCircuitBreakerStateChange() {},
13: });
```

## File: src/telemetry/ring_buffer.ts
```typescript
  1: export interface SanitizedTrace {
  2:   reqId: string;
  3:   createdAt: number;
  4:   provider: string;
  5:   model: string;
  6:   status: number;
  7:   durationMs: number;
  8:   ttftMs?: number;
  9:   tokensPrompt?: number;
 10:   tokensCompletion?: number;
 11:   legs: {
 12:     clientInbound: string;    // Sanitized JSON, max 64KB
 13:     upstreamOutbound: string;
 14:     upstreamInbound: string;
 15:     clientOutbound: string;
 16:   };
 17: }
 18: 
 19: export const MAX_TRACES = 100;
 20: export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;  // 32MB
 21: export const MAX_LEG_BYTES = 64 * 1024;            // 64KB per leg
 22: 
 23: const LEG_KEYS = [
 24:   "clientInbound",
 25:   "upstreamOutbound",
 26:   "upstreamInbound",
 27:   "clientOutbound",
 28: ] as const;
 29: 
 30: export interface TraceRingBufferOptions {
 31:   maxTraces?: number;
 32:   maxTotalBytes?: number;
 33:   maxLegBytes?: number;
 34: }
 35: 
 36: export function estimateTraceSize(trace: SanitizedTrace): number {
 37:   const cIn = trace.legs?.clientInbound?.length ?? 0;
 38:   const uOut = trace.legs?.upstreamOutbound?.length ?? 0;
 39:   const uIn = trace.legs?.upstreamInbound?.length ?? 0;
 40:   const cOut = trace.legs?.clientOutbound?.length ?? 0;
 41:   return cIn + uOut + uIn + cOut + 512; // metadata overhead
 42: }
 43: 
 44: export class TraceRingBuffer {
 45:   private readonly buffer = new Map<string, SanitizedTrace>();
 46:   private readonly order: string[] = [];
 47:   private totalBytes = 0;
 48: 
 49:   public readonly maxTraces: number;
 50:   public readonly maxTotalBytes: number;
 51:   public readonly maxLegBytes: number;
 52: 
 53:   constructor(options: TraceRingBufferOptions = {}) {
 54:     this.maxTraces = options.maxTraces ?? MAX_TRACES;
 55:     this.maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
 56:     this.maxLegBytes = options.maxLegBytes ?? MAX_LEG_BYTES;
 57:   }
 58: 
 59:   push(trace: SanitizedTrace): void {
 60:     if (this.buffer.has(trace.reqId)) {
 61:       const existing = this.buffer.get(trace.reqId);
 62:       if (existing) {
 63:         this.totalBytes = Math.max(0, this.totalBytes - this.estimateSize(existing));
 64:       }
 65:       const existingIdx = this.order.indexOf(trace.reqId);
 66:       if (existingIdx !== -1) {
 67:         this.order.splice(existingIdx, 1);
 68:       }
 69:       this.buffer.delete(trace.reqId);
 70:     }
 71: 
 72:     // Truncate oversized legs
 73:     for (const legKey of LEG_KEYS) {
 74:       const leg = trace.legs[legKey];
 75:       if (leg && leg.length > this.maxLegBytes) {
 76:         const originalSize = leg.length;
 77:         trace.legs[legKey] =
 78:           leg.slice(0, this.maxLegBytes) +
 79:           `\n... [TRUNCATED: original ${originalSize} bytes]`;
 80:       }
 81:     }
 82: 
 83:     const traceSize = this.estimateSize(trace);
 84: 
 85:     // Evict oldest until within bounds
 86:     while (
 87:       (this.buffer.size >= this.maxTraces ||
 88:         this.totalBytes + traceSize > this.maxTotalBytes) &&
 89:       this.order.length > 0
 90:     ) {
 91:       this.evictOldest();
 92:     }
 93: 
 94:     this.buffer.set(trace.reqId, trace);
 95:     this.order.push(trace.reqId);
 96:     this.totalBytes += traceSize;
 97:   }
 98: 
 99:   get(reqId: string): SanitizedTrace | undefined {
100:     return this.buffer.get(reqId);
101:   }
102: 
103:   getRecent(n: number): SanitizedTrace[] {
104:     if (n <= 0) {
105:       return [];
106:     }
107:     return this.order
108:       .slice(-n)
109:       .reverse()
110:       .map((id) => this.buffer.get(id)!)
111:       .filter(Boolean);
112:   }
113: 
114:   getErrors(n: number): SanitizedTrace[] {
115:     if (n <= 0) {
116:       return [];
117:     }
118:     return this.getRecent(this.order.length)
119:       .filter((t) => t.status >= 400)
120:       .slice(0, n);
121:   }
122: 
123:   clear(): void {
124:     this.buffer.clear();
125:     this.order.length = 0;
126:     this.totalBytes = 0;
127:   }
128: 
129:   size(): number {
130:     return this.buffer.size;
131:   }
132: 
133:   byteSize(): number {
134:     return this.totalBytes;
135:   }
136: 
137:   estimateSize(trace: SanitizedTrace): number {
138:     return estimateTraceSize(trace);
139:   }
140: 
141:   private evictOldest(): void {
142:     const id = this.order.shift();
143:     if (id) {
144:       const trace = this.buffer.get(id);
145:       if (trace) {
146:         this.totalBytes = Math.max(0, this.totalBytes - this.estimateSize(trace));
147:         this.buffer.delete(id);
148:       }
149:     }
150:   }
151: }
152: 
153: export const traceBuffer = new TraceRingBuffer();
```

## File: src/telemetry/sanitize.ts
```typescript
  1: /**
  2:  * Telemetry Secret Redaction & Header Allowlisting Pipeline
  3:  *
  4:  * Implements the security architecture defined in docs/redesign02.md §10.2:
  5:  * - Structural guarantee: Allowlist-only header retention; novel/unknown headers dropped.
  6:  * - Sensitive headers redacted to "[REDACTED]".
  7:  * - Defense-in-depth secondary pass: regex scrubbing of known API keys in payload bodies.
  8:  */
  9: 
 10: export const ALLOWED_HEADERS: ReadonlySet<string> = new Set<string>([
 11:   "content-type",
 12:   "accept",
 13:   "user-agent",
 14:   "x-title",
 15:   "http-referer",
 16:   "referer",
 17:   "x-request-id",
 18:   "x-literouter-model",
 19:   "x-literouter-tier",
 20:   "x-literouter-chain",
 21:   "x-session-id",
 22:   "anthropic-version",
 23:   "retry-after",
 24:   "x-ratelimit-limit-requests",
 25:   "x-ratelimit-remaining-requests",
 26: ]);
 27: 
 28: export const REDACTED_HEADERS: ReadonlySet<string> = new Set<string>([
 29:   "authorization",
 30:   "x-api-key",
 31:   "api-key",
 32:   "x-goog-api-key",
 33:   "cookie",
 34:   "set-cookie",
 35: ]);
 36: 
 37: export const SECRET_PATTERNS: readonly RegExp[] = [
 38:   /Bearer\s+[a-zA-Z0-9_.-]+/g,
 39:   /sk-or-v1-[a-zA-Z0-9]{64}/g,
 40:   /nvapi-[a-zA-Z0-9_-]{64}/g,
 41:   /AIzaSy[a-zA-Z0-9_-]{33}/g,
 42:   /sk-lr-[a-zA-Z0-9_-]+/g,
 43: ] as const;
 44: 
 45: export const SECRET_REGEX =
 46:   /(?:Bearer\s+[a-zA-Z0-9_.-]+|sk-or-v1-[a-zA-Z0-9]{64}|nvapi-[a-zA-Z0-9_-]{64}|AIzaSy[a-zA-Z0-9_-]{33}|sk-lr-[a-zA-Z0-9_-]+)/g;
 47: 
 48: /**
 49:  * Sanitize headers using allowlist guarantee.
 50:  * - Headers in REDACTED_HEADERS -> "[REDACTED]"
 51:  * - Headers in ALLOWED_HEADERS -> value preserved
 52:  * - All other headers -> silently dropped from traces
 53:  */
 54: export function sanitizeHeaders(
 55:   headers: Headers | Record<string, string>
 56: ): Record<string, string> {
 57:   const result: Record<string, string> = {};
 58:   if (!headers) {
 59:     return result;
 60:   }
 61: 
 62:   const entries =
 63:     headers instanceof Headers ? headers.entries() : Object.entries(headers);
 64: 
 65:   for (const [key, value] of entries) {
 66:     if (typeof value !== "string") {
 67:       continue;
 68:     }
 69:     const lower = key.toLowerCase();
 70:     if (REDACTED_HEADERS.has(lower)) {
 71:       result[lower] = "[REDACTED]";
 72:     } else if (ALLOWED_HEADERS.has(lower)) {
 73:       result[lower] = value;
 74:     }
 75:   }
 76: 
 77:   return result;
 78: }
 79: 
 80: /**
 81:  * Sanitize body content using defense-in-depth regex scrubbing.
 82:  * Converts input to string (JSON if object) and scrubs known secret patterns.
 83:  */
 84: export function sanitizeBody(body: unknown): string {
 85:   if (body === undefined) {
 86:     return "";
 87:   }
 88: 
 89:   let text: string;
 90:   if (typeof body === "string") {
 91:     text = body;
 92:   } else {
 93:     try {
 94:       text = JSON.stringify(body) ?? "";
 95:     } catch {
 96:       text = String(body);
 97:     }
 98:   }
 99: 
100:   return text.replace(SECRET_REGEX, "[REDACTED_KEY]");
101: }
```

## File: src/transformers/anthropic_messages.ts
```typescript
  1: import type { ParsedDirective } from "../directive/types";
  2: import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
  3: import type { RequestTelemetry, UsageRecord } from "../telemetry/session";
  4: 
  5: interface SseParsedMessage {
  6:   readonly eventType: string;
  7:   readonly data: Record<string, unknown> | null;
  8: }
  9: 
 10: interface ExtractBlockResult {
 11:   readonly eventBlock: string | null;
 12:   readonly remaining: string;
 13: }
 14: 
 15: interface UsageState {
 16:   promptTokens: number;
 17:   completionTokens: number;
 18:   reasoningTokens?: number;
 19:   finishReason: string | null;
 20:   hasRecordedUsage: boolean;
 21: }
 22: 
 23: function safeJsonParse(text: string): Record<string, unknown> | null {
 24:   try {
 25:     const val = JSON.parse(text);
 26:     if (val && typeof val === "object" && !Array.isArray(val)) {
 27:       return val as Record<string, unknown>;
 28:     }
 29:     return null;
 30:   } catch (_err) {
 31:     return null;
 32:   }
 33: }
 34: 
 35: function parseSseBlock(block: string): SseParsedMessage {
 36:   let eventType = "";
 37:   const dataLines: string[] = [];
 38:   const lines = block.split("\n");
 39: 
 40:   for (const rawLine of lines) {
 41:     const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
 42:     if (line.startsWith("event:")) {
 43:       eventType = line.slice(6).trim();
 44:     } else if (line.startsWith("data:")) {
 45:       dataLines.push(line.slice(5).trim());
 46:     }
 47:   }
 48: 
 49:   if (dataLines.length === 0) {
 50:     return { eventType, data: null };
 51:   }
 52: 
 53:   const jsonStr = dataLines.join("\n");
 54:   const data = safeJsonParse(jsonStr);
 55:   const effectiveType = eventType || (typeof data?.type === "string" ? data.type : "");
 56: 
 57:   return { eventType: effectiveType, data };
 58: }
 59: 
 60: function extractNextEventBlock(currentBuffer: string): ExtractBlockResult {
 61:   const lfIndex = currentBuffer.indexOf("\n\n");
 62:   const crlfIndex = currentBuffer.indexOf("\r\n\r\n");
 63:   if (lfIndex === -1 && crlfIndex === -1) {
 64:     return { eventBlock: null, remaining: currentBuffer };
 65:   }
 66: 
 67:   if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
 68:     return {
 69:       eventBlock: currentBuffer.slice(0, crlfIndex),
 70:       remaining: currentBuffer.slice(crlfIndex + 4),
 71:     };
 72:   }
 73: 
 74:   return {
 75:     eventBlock: currentBuffer.slice(0, lfIndex),
 76:     remaining: currentBuffer.slice(lfIndex + 2),
 77:   };
 78: }
 79: 
 80: function drainEventBlocks(
 81:   initialBuffer: string,
 82:   onBlock: (block: string) => void
 83: ): string {
 84:   let cur = initialBuffer;
 85:   while (true) {
 86:     const result = extractNextEventBlock(cur);
 87:     if (result.eventBlock === null) {
 88:       break;
 89:     }
 90:     cur = result.remaining;
 91:     onBlock(result.eventBlock);
 92:   }
 93:   return cur;
 94: }
 95: 
 96: function extractStartUsage(data: Record<string, unknown>, state: UsageState): void {
 97:   const msg = data.message;
 98:   if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
 99:     return;
100:   }
101:   const u = (msg as Record<string, unknown>).usage;
102:   if (!u || typeof u !== "object" || Array.isArray(u)) {
103:     return;
104:   }
105:   const usageObj = u as Record<string, unknown>;
106:   if (typeof usageObj.input_tokens === "number") {
107:     state.promptTokens = usageObj.input_tokens;
108:   }
109:   if (typeof usageObj.output_tokens === "number") {
110:     state.completionTokens = usageObj.output_tokens;
111:   }
112: }
113: 
114: function extractReasoningTokens(usageObj: Record<string, unknown>, state: UsageState): void {
115:   const details = usageObj.output_tokens_details;
116:   if (details && typeof details === "object" && !Array.isArray(details)) {
117:     const detailsObj = details as Record<string, unknown>;
118:     if (typeof detailsObj.thinking_tokens === "number") {
119:       state.reasoningTokens = detailsObj.thinking_tokens;
120:       return;
121:     }
122:   }
123:   if (typeof usageObj.thinking_tokens === "number") {
124:     state.reasoningTokens = usageObj.thinking_tokens;
125:   }
126: }
127: 
128: function extractDeltaUsage(data: Record<string, unknown>, state: UsageState): void {
129:   const u = data.usage;
130:   if (u && typeof u === "object" && !Array.isArray(u)) {
131:     const usageObj = u as Record<string, unknown>;
132:     if (typeof usageObj.output_tokens === "number") {
133:       state.completionTokens = usageObj.output_tokens;
134:     }
135:     if (typeof usageObj.input_tokens === "number") {
136:       state.promptTokens = usageObj.input_tokens;
137:     }
138:     extractReasoningTokens(usageObj, state);
139:   }
140: 
141:   const delta = data.delta;
142:   if (delta && typeof delta === "object" && !Array.isArray(delta)) {
143:     const deltaObj = delta as Record<string, unknown>;
144:     if (typeof deltaObj.stop_reason === "string") {
145:       state.finishReason = deltaObj.stop_reason;
146:     }
147:   }
148: }
149: 
150: function emitUsage(telemetry: RequestTelemetry, state: UsageState): void {
151:   state.hasRecordedUsage = true;
152:   const record: UsageRecord = {
153:     promptTokens: state.promptTokens,
154:     completionTokens: state.completionTokens,
155:     reasoningTokens: state.reasoningTokens,
156:     totalTokens: state.promptTokens + state.completionTokens,
157:     finishReason: state.finishReason,
158:   };
159:   telemetry.recordUsage(record);
160: }
161: 
162: function handleContentDelta(
163:   eventType: string,
164:   telemetry: RequestTelemetry,
165:   ttftState: { marked: boolean }
166: ): void {
167:   if (eventType === "content_block_delta" && !ttftState.marked) {
168:     ttftState.marked = true;
169:     telemetry.markTtft("anthropic", "First content block delta received");
170:   }
171: }
172: 
173: function handleUsageEvents(
174:   msg: SseParsedMessage,
175:   telemetry: RequestTelemetry,
176:   usageState: UsageState
177: ): void {
178:   if (msg.eventType === "message_start" && msg.data) {
179:     extractStartUsage(msg.data, usageState);
180:   } else if (msg.eventType === "message_delta" && msg.data) {
181:     extractDeltaUsage(msg.data, usageState);
182:     emitUsage(telemetry, usageState);
183:   } else if (msg.eventType === "message_stop" && !usageState.hasRecordedUsage) {
184:     if (usageState.promptTokens > 0 || usageState.completionTokens > 0) {
185:       emitUsage(telemetry, usageState);
186:     }
187:   }
188: }
189: 
190: function handleSseMessage(
191:   msg: SseParsedMessage,
192:   telemetry: RequestTelemetry,
193:   usageState: UsageState,
194:   ttftState: { marked: boolean }
195: ): void {
196:   handleContentDelta(msg.eventType, telemetry, ttftState);
197:   handleUsageEvents(msg, telemetry, usageState);
198: }
199: 
200: export class AnthropicMessagesTransformer implements PayloadTransformerContract {
201:   transformClientToWire(
202:     inboundBody: Record<string, unknown>,
203:     _directive: ParsedDirective,
204:     headers?: Headers
205:   ): OutboundWirePayload {
206:     const outboundHeaders: Record<string, string> = {
207:       "Content-Type": "application/json",
208:     };
209: 
210:     if (headers && typeof headers.get === "function") {
211:       const anthropicVersion = headers.get("anthropic-version");
212:       if (anthropicVersion) {
213:         outboundHeaders["anthropic-version"] = anthropicVersion;
214:       }
215:       const anthropicBeta = headers.get("anthropic-beta");
216:       if (anthropicBeta) {
217:         outboundHeaders["anthropic-beta"] = anthropicBeta;
218:       }
219:     }
220: 
221:     return {
222:       endpointKey: "ms",
223:       method: "POST",
224:       headers: outboundHeaders,
225:       body: inboundBody,
226:       isStreaming: Boolean(inboundBody.stream),
227:     };
228:   }
229: 
230:   transformWireToClient(
231:     upstreamJson: unknown,
232:     _directive: ParsedDirective
233:   ): unknown {
234:     return upstreamJson;
235:   }
236: 
237:   createWireToClientStream(
238:     _directive: ParsedDirective,
239:     telemetry: RequestTelemetry,
240:     clientSignal: AbortSignal
241:   ): TransformStream<Uint8Array, Uint8Array> {
242:     const decoder = new TextDecoder();
243:     let buffer = "";
244:     const ttftState = { marked: false };
245:     const usageState: UsageState = {
246:       promptTokens: 0,
247:       completionTokens: 0,
248:       finishReason: null,
249:       hasRecordedUsage: false,
250:     };
251: 
252:     return new TransformStream<Uint8Array, Uint8Array>({
253:       transform(chunk, controller) {
254:         if (clientSignal.aborted) {
255:           return;
256:         }
257:         controller.enqueue(chunk);
258:         buffer += decoder.decode(chunk, { stream: true });
259:         buffer = drainEventBlocks(buffer, (block) => {
260:           const parsedMsg = parseSseBlock(block);
261:           handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
262:         });
263:       },
264: 
265:       flush() {
266:         if (clientSignal.aborted) {
267:           return;
268:         }
269:         buffer += decoder.decode();
270:         buffer = drainEventBlocks(buffer, (block) => {
271:           const parsedMsg = parseSseBlock(block);
272:           handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
273:         });
274: 
275:         if (buffer.trim().length > 0) {
276:           const parsedMsg = parseSseBlock(buffer);
277:           handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
278:           buffer = "";
279:         }
280: 
281:         if (!usageState.hasRecordedUsage && (usageState.promptTokens > 0 || usageState.completionTokens > 0)) {
282:           emitUsage(telemetry, usageState);
283:         }
284:       },
285:     });
286:   }
287: }
288: 
289: export const anthropicMessagesTransformer = new AnthropicMessagesTransformer();
```

## File: src/transformers/context_pruner.ts
```typescript
  1: import type {
  2:   AnthropicContentBlock,
  3:   AnthropicMessage,
  4:   AnthropicMessagesRequest,
  5: } from "../handlers/anthropic_compat";
  6: import type {
  7:   OpenAIContentPart,
  8:   OpenAIMessage,
  9:   OpenAIRequestPayload,
 10: } from "./nuances";
 11: 
 12: export const DEFAULT_SAFE_CONTEXT_TOKENS = 180000;
 13: export const DEFAULT_MAX_CONTEXT_TOKENS = 240000;
 14: 
 15: export function estimateTextTokens(text: string): number {
 16:   if (!text) return 0;
 17:   return Math.ceil(text.length / 3.5);
 18: }
 19: 
 20: export function estimateAnthropicTokens(req: AnthropicMessagesRequest): number {
 21:   let total = 3;
 22: 
 23:   if (req.system) {
 24:     total += 4;
 25:     if (typeof req.system === "string") {
 26:       total += estimateTextTokens(req.system);
 27:     } else if (Array.isArray(req.system)) {
 28:       for (const block of req.system) {
 29:         if (typeof block === "string") {
 30:           total += estimateTextTokens(block);
 31:         } else if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
 32:           total += estimateTextTokens(block.text);
 33:         }
 34:       }
 35:     }
 36:   }
 37: 
 38:   if (Array.isArray(req.messages)) {
 39:     for (const msg of req.messages) {
 40:       total += 4;
 41:       if (typeof msg.content === "string") {
 42:         total += estimateTextTokens(msg.content);
 43:       } else if (Array.isArray(msg.content)) {
 44:         for (const block of msg.content) {
 45:           if (block.type === "text" && block.text) {
 46:             total += estimateTextTokens(block.text);
 47:           } else if (block.type === "thinking" && block.thinking) {
 48:             total += estimateTextTokens(block.thinking);
 49:           } else if (block.type === "image") {
 50:             total += 1600;
 51:           } else if (block.type === "tool_use") {
 52:             total += 8;
 53:             if (block.name) total += estimateTextTokens(block.name);
 54:             if (block.input) {
 55:               const inputStr = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
 56:               total += estimateTextTokens(inputStr);
 57:             }
 58:           } else if (block.type === "tool_result") {
 59:             total += 8;
 60:             if (typeof block.content === "string") {
 61:               total += estimateTextTokens(block.content);
 62:             } else if (Array.isArray(block.content)) {
 63:               total += estimateTextTokens(JSON.stringify(block.content));
 64:             }
 65:           }
 66:         }
 67:       }
 68:     }
 69:   }
 70: 
 71:   if (Array.isArray(req.tools)) {
 72:     for (const tool of req.tools) {
 73:       total += 10;
 74:       total += estimateTextTokens(JSON.stringify(tool));
 75:     }
 76:   }
 77: 
 78:   return total;
 79: }
 80: 
 81: export function estimateOpenAITokens(req: OpenAIRequestPayload): number {
 82:   let total = 3;
 83: 
 84:   if (Array.isArray(req.messages)) {
 85:     for (const msg of req.messages) {
 86:       total += 4;
 87:       if (typeof msg.content === "string") {
 88:         total += estimateTextTokens(msg.content);
 89:       } else if (Array.isArray(msg.content)) {
 90:         for (const part of msg.content) {
 91:           if (part.type === "text" && part.text) {
 92:             total += estimateTextTokens(part.text);
 93:           } else if (part.type === "image_url") {
 94:             total += 1600;
 95:           }
 96:         }
 97:       }
 98:       if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
 99:         total += 8;
100:         for (const tc of msg.tool_calls) {
101:           if (tc.function?.name) total += estimateTextTokens(tc.function.name);
102:           if (tc.function?.arguments) total += estimateTextTokens(tc.function.arguments);
103:         }
104:       }
105:     }
106:   }
107: 
108:   if (Array.isArray(req.tools)) {
109:     for (const tool of req.tools) {
110:       total += 10;
111:       total += estimateTextTokens(JSON.stringify(tool));
112:     }
113:   }
114: 
115:   return total;
116: }
117: 
118: export function isContextLengthError(status: number, bodyText: string): boolean {
119:   if (status !== 400 && status !== 413 && status !== 422) {
120:     return false;
121:   }
122:   const lower = bodyText.toLowerCase();
123:   return (
124:     lower.includes("context length") ||
125:     lower.includes("context window") ||
126:     lower.includes("context_length_exceeded") ||
127:     lower.includes("maximum context") ||
128:     lower.includes("prompt is too long") ||
129:     lower.includes("token count exceeds") ||
130:     lower.includes("input tokens exceed") ||
131:     lower.includes("reduce the length of the messages") ||
132:     lower.includes("too many tokens") ||
133:     (lower.includes("max_tokens") && lower.includes("exceed"))
134:   );
135: }
136: 
137: export function extractContextLimit(text: string): number | null {
138:   const m1 = text.match(/context length\s*(?:\(|is|\:)?\s*(\d{4,8})\s*tokens?/i);
139:   if (m1 && m1[1]) return parseInt(m1[1], 10);
140: 
141:   const m2 = text.match(/(?:maximum context length|max context length|limit of|context window\s*\(?)\s*(?:is|\:)?\s*(\d{4,8})/i);
142:   if (m2 && m2[1]) return parseInt(m2[1], 10);
143: 
144:   const m3 = text.match(/than.*?(\d{4,8})\s*tokens/i);
145:   if (m3 && m3[1]) return parseInt(m3[1], 10);
146: 
147:   const m4 = text.match(/context window\s*\((\d{4,8})\)/i);
148:   if (m4 && m4[1]) return parseInt(m4[1], 10);
149: 
150:   return null;
151: }
152: 
153: export function sanitizeAnthropicToolReferences(
154:   messages: readonly AnthropicMessage[]
155: ): AnthropicMessage[] {
156:   const validToolUseIds = new Set<string>();
157:   for (const msg of messages) {
158:     if (msg.role === "assistant" && Array.isArray(msg.content)) {
159:       for (const block of msg.content) {
160:         if (block.type === "tool_use" && typeof block.id === "string") {
161:           validToolUseIds.add(block.id);
162:         }
163:       }
164:     }
165:   }
166: 
167:   return messages.map((msg) => {
168:     if (msg.role !== "user" || !Array.isArray(msg.content)) {
169:       return msg;
170:     }
171: 
172:     let modified = false;
173:     const sanitizedBlocks: AnthropicContentBlock[] = msg.content.map((block) => {
174:       if (block.type === "tool_result" && block.tool_use_id && !validToolUseIds.has(block.tool_use_id)) {
175:         modified = true;
176:         const rawContent = typeof block.content === "string"
177:           ? block.content
178:           : JSON.stringify(block.content ?? "");
179:         return {
180:           type: "text",
181:           text: `[Pruned tool result (${block.tool_use_id})]:\n${rawContent}`,
182:         };
183:       }
184:       return block;
185:     });
186: 
187:     return modified ? { ...msg, content: sanitizedBlocks } : msg;
188:   });
189: }
190: 
191: export function normalizeAnthropicAlternation(
192:   messages: readonly AnthropicMessage[]
193: ): AnthropicMessage[] {
194:   if (messages.length === 0) return [];
195: 
196:   const result: AnthropicMessage[] = [];
197:   let current: AnthropicMessage = messages[0]!;
198: 
199:   for (let i = 1; i < messages.length; i++) {
200:     const next = messages[i]!;
201:     if (next.role === current.role) {
202:       const currentBlocks = typeof current.content === "string"
203:         ? [{ type: "text" as const, text: current.content }]
204:         : [...current.content];
205:       const nextBlocks = typeof next.content === "string"
206:         ? [{ type: "text" as const, text: next.content }]
207:         : [...next.content];
208:       current = {
209:         role: current.role,
210:         content: [...currentBlocks, ...nextBlocks],
211:       };
212:     } else {
213:       result.push(current);
214:       current = next;
215:     }
216:   }
217:   result.push(current);
218: 
219:   if (result.length > 0 && result[0]!.role !== "user") {
220:     result.unshift({
221:       role: "user",
222:       content: "[Context resumed after truncation]",
223:     });
224:   }
225: 
226:   return result;
227: }
228: 
229: export function pruneAnthropicPayload(
230:   req: AnthropicMessagesRequest,
231:   targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
232: ): AnthropicMessagesRequest {
233:   const currentTokens = estimateAnthropicTokens(req);
234:   if (currentTokens <= targetLimitTokens || !Array.isArray(req.messages) || req.messages.length <= 2) {
235:     return req;
236:   }
237: 
238:   const messages = req.messages;
239:   let cutoff = 0;
240: 
241:   for (let i = 1; i < messages.length - 1; i++) {
242:     const candidateSlice = messages.slice(i);
243:     const candidateReq: AnthropicMessagesRequest = { ...req, messages: candidateSlice };
244:     const tokens = estimateAnthropicTokens(candidateReq);
245:     if (tokens <= targetLimitTokens) {
246:       cutoff = i;
247:       break;
248:     }
249:   }
250: 
251:   if (cutoff === 0 && messages.length > 2) {
252:     cutoff = Math.max(1, messages.length - 2);
253:   }
254: 
255:   let prunedMessages: AnthropicMessage[];
256:   if (cutoff > 1 && messages[0]!.role === "user") {
257:     const rootUserMsg = messages[0]!;
258:     const noticeBlock: AnthropicContentBlock = {
259:       type: "text",
260:       text: "\n\n[Note: Intermediate conversation history was pruned by LiteRouter to fit within model context limits.]\n\n",
261:     };
262: 
263:     const augmentedRoot: AnthropicMessage = {
264:       role: "user",
265:       content: typeof rootUserMsg.content === "string"
266:         ? `${rootUserMsg.content}\n\n[Note: Intermediate conversation history was pruned by LiteRouter to fit within model context limits.]`
267:         : [...rootUserMsg.content, noticeBlock],
268:     };
269: 
270:     prunedMessages = [augmentedRoot, ...messages.slice(cutoff)];
271:   } else {
272:     prunedMessages = [...messages.slice(cutoff)];
273:   }
274: 
275:   const sanitized = sanitizeAnthropicToolReferences(prunedMessages);
276:   const normalized = normalizeAnthropicAlternation(sanitized);
277: 
278:   return {
279:     ...req,
280:     messages: normalized,
281:   };
282: }
283: 
284: export function sanitizeOpenAIToolReferences(
285:   messages: readonly OpenAIMessage[]
286: ): OpenAIMessage[] {
287:   const validToolCallIds = new Set<string>();
288:   for (const msg of messages) {
289:     if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
290:       for (const tc of msg.tool_calls) {
291:         if (tc.id) validToolCallIds.add(tc.id);
292:       }
293:     }
294:   }
295: 
296:   return messages.map((msg) => {
297:     if (msg.role === "tool" && msg.tool_call_id && !validToolCallIds.has(msg.tool_call_id)) {
298:       return {
299:         role: "user",
300:         content: `[Pruned tool result (${msg.tool_call_id})]:\n${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")}`,
301:       };
302:     }
303:     return msg;
304:   });
305: }
306: 
307: export function pruneOpenAIPayload(
308:   req: OpenAIRequestPayload,
309:   targetLimitTokens = DEFAULT_SAFE_CONTEXT_TOKENS
310: ): OpenAIRequestPayload {
311:   const currentTokens = estimateOpenAITokens(req);
312:   if (currentTokens <= targetLimitTokens || !Array.isArray(req.messages) || req.messages.length <= 2) {
313:     return req;
314:   }
315: 
316:   const messages = req.messages;
317:   const systemMessages = messages.filter((m) => m.role === "system");
318:   const nonSystemMessages = messages.filter((m) => m.role !== "system");
319: 
320:   if (nonSystemMessages.length <= 2) {
321:     return req;
322:   }
323: 
324:   let cutoff = 0;
325:   for (let i = 1; i < nonSystemMessages.length - 1; i++) {
326:     const candidateSlice = nonSystemMessages.slice(i);
327:     const candidateReq: OpenAIRequestPayload = {
328:       ...req,
329:       messages: [...systemMessages, ...candidateSlice],
330:     };
331:     const tokens = estimateOpenAITokens(candidateReq);
332:     if (tokens <= targetLimitTokens) {
333:       cutoff = i;
334:       break;
335:     }
336:   }
337: 
338:   if (cutoff === 0 && nonSystemMessages.length > 2) {
339:     cutoff = Math.max(1, nonSystemMessages.length - 2);
340:   }
341: 
342:   const retainedNonSystem = nonSystemMessages.slice(cutoff);
343:   const combined = [...systemMessages, ...retainedNonSystem];
344:   const sanitized = sanitizeOpenAIToolReferences(combined);
345: 
346:   return {
347:     ...req,
348:     messages: sanitized,
349:   };
350: }
```

## File: src/transformers/dots.ts
```typescript
   1: import type { OpenAIMessage, OpenAIToolCall } from "./nuances";
   2: 
   3: export interface DotsParseResult {
   4:   readonly cleanText: string;
   5:   readonly toolCalls: readonly OpenAIToolCall[];
   6:   readonly reasoningContent?: string;
   7: }
   8: 
   9: export const LEAKED_TEMPLATE_REGEX =
  10:   /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>|<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>|<\s*\/?\s*(?:assistant|user|system|human|bot)\s*>|<\|\s*(?:im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end|system|user|assistant|observation|bot|tool_calls?|\/?tool_calls?|eot_id|start_header_id|end_header_id|end)\b[^|]*\|>(?:\s*(?:assistant|user|system|human|bot)\b)?|<｜\s*(?:System|User|Assistant|begin of sentence|end of sentence|tool calls?|tool results?|tool outputs?)\b[^｜]*｜>|＜｜\s*(?:System|User|Assistant|begin of sentence|end of sentence|tool calls?|tool results?|tool outputs?)\b[^｜]*｜＞|\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>|(?:\b(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\b\s*)?<\s*\/\s*(?:role|im_end|end_of_turn|role_end)\s*>|<\s*(?:role|im_start|start_of_turn|role_start)\s*>\s*(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER)\b|<\/?(?:im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end)(?:\s+[^>]*)?>|<\/?(?:tool_response|tool_result|tools|turn|turn_end)(?:\s+[^>]*)?>/gi;
  11: 
  12: export const STREAM_PARTIAL_TAG_REGEX =
  13:   /<$|<(?:\/|[a-zA-Z_])[a-zA-Z0-9_\-: ='"/]{0,80}$|<\|[^|]{0,40}$|<｜[^｜]{0,40}$|＜｜?[^｜＞]{0,40}$|\[(?:gMASK|\/?INST)[a-zA-Z0-9_\-/]{0,10}$|<<\/?(?:SYS)?[^>]{0,10}$/i;
  14: 
  15: export const UNCLOSED_TEMPLATE_TAG_REGEX =
  16:   /<(?:\/|\/?(?:role|think|thought|thinking|tool_call|tool_calls|function|invoke|parameter|parameter_name|parameter_value|arg_key|arg_value|argument_name|argument_value|turn|assistant|user|system|bot|human|minimax|sop|im_start|im_end|endoftext|startoftext|start_of_turn|end_of_turn|role_start|role_end|observation|eot_id|start_header_id|end_header_id|tool_response|tool_result))[^>]*$|<\|[^|]{0,40}$|<｜[^｜]{0,40}$|＜｜?[^｜＞]{0,40}$|\[(?:gMASK|\/?INST)[^\]]{0,10}$|<<\/?(?:SYS)[^>]{0,10}$/i;
  17: 
  18: export function stripLeakedTemplateTags(text: string): string {
  19:   return text.replace(LEAKED_TEMPLATE_REGEX, "");
  20: }
  21: 
  22: export function stripUnclosedTemplateTags(text: string): string {
  23:   return text.replace(UNCLOSED_TEMPLATE_TAG_REGEX, "");
  24: }
  25: 
  26: export class TagSanitizerStreamBuffer {
  27:   private buffer = "";
  28: 
  29:   public process(incoming: string): string {
  30:     this.buffer += incoming;
  31: 
  32:     const openRoleMatch = /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?(?:(?!<\/role>)[\s\S]){0,20}$/i.exec(this.buffer);
  33:     if (openRoleMatch && !this.buffer.slice(openRoleMatch.index).toLowerCase().includes("</role>")) {
  34:       const safePrefix = this.buffer.slice(0, openRoleMatch.index);
  35:       this.buffer = this.buffer.slice(openRoleMatch.index);
  36:       return stripLeakedTemplateTags(safePrefix);
  37:     }
  38: 
  39:     const cleaned = stripLeakedTemplateTags(this.buffer);
  40:     const partialTagMatch = STREAM_PARTIAL_TAG_REGEX.exec(cleaned);
  41:     if (partialTagMatch && partialTagMatch.index !== undefined) {
  42:       const emitText = cleaned.slice(0, partialTagMatch.index);
  43:       this.buffer = cleaned.slice(partialTagMatch.index);
  44:       return emitText;
  45:     }
  46: 
  47:     this.buffer = "";
  48:     return cleaned;
  49:   }
  50: 
  51:   public flush(): string {
  52:     const finalCleaned = stripLeakedTemplateTags(this.buffer);
  53:     this.buffer = "";
  54:     return finalCleaned;
  55:   }
  56: }
  57: 
  58: const INVOKE_BLOCK_REGEX =
  59:   /<(?:invoke|minimax:tool_call|tool_call|function_call)\b(?:\s+(?:name|function)=["']?([^"'\s>]+)["']?)?[^>]*>([\s\S]*?)<\/(?:invoke|minimax:tool_call|tool_call|function_call)>/gi;
  60: 
  61: const QWEN_FUNC_REGEX =
  62:   /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;
  63: 
  64: const QWEN_PARAM_REGEX =
  65:   /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter|<\/(?:function|tool_call)>|$))/gi;
  66: 
  67: const PARAM_REGEX =
  68:   /<parameter\s+name=["']?([^"'\s>]+)["']?>([\s\S]*?)(?:<\/(?:parameter|arg_value|parameter_value)>|(?=<parameter|<arg_key|<\/(?:invoke|tool_call|function_call|function_calls|tool_calls|minimax:tool_call)>|$))/gi;
  69: 
  70: const ARG_KV_REGEX =
  71:   /<(?:arg_key|argument_name|parameter_name)>([^<]+)<\/(?:arg_key|argument_name|parameter_name)>\s*<(?:arg_value|argument_value|parameter_value)>([\s\S]*?)<\/(?:arg_value|argument_value|parameter_value)>/gi;
  72: 
  73: const EXCLUDED_TAG_NAMES = new Set([
  74:   "tool_call",
  75:   "tool_calls",
  76:   "invoke",
  77:   "function_call",
  78:   "function_calls",
  79:   "minimax:tool_call",
  80:   "think",
  81:   "thought",
  82:   "thinking",
  83:   "p",
  84:   "div",
  85:   "span",
  86:   "pre",
  87:   "code",
  88:   "b",
  89:   "i",
  90:   "strong",
  91:   "em",
  92:   "table",
  93:   "tr",
  94:   "td",
  95:   "th",
  96:   "ul",
  97:   "ol",
  98:   "li",
  99:   "a",
 100:   "h1",
 101:   "h2",
 102:   "h3",
 103:   "h4",
 104:   "h5",
 105:   "h6",
 106:   "role",
 107:   "im_start",
 108:   "im_end",
 109:   "name",
 110:   "function",
 111:   "tool_name",
 112:   "arguments",
 113:   "args",
 114:   "parameter",
 115:   "arg_key",
 116:   "arg_value",
 117:   "parameter_value",
 118:   "argument_name",
 119:   "argument_value",
 120: ]);
 121: 
 122: function parseJsonTolerant(raw: string): unknown {
 123:   try {
 124:     return JSON.parse(raw);
 125:   } catch (err: unknown) {
 126:     void err;
 127:     try {
 128:       const sanitized = raw.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
 129:         return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
 130:       });
 131:       return JSON.parse(sanitized);
 132:     } catch (innerErr: unknown) {
 133:       void innerErr;
 134:       return null;
 135:     }
 136:   }
 137: }
 138: 
 139: function castValue(raw: string): unknown {
 140:   const trimmed = raw.trim();
 141:   const lower = trimmed.toLowerCase();
 142:   if (lower === "true") return true;
 143:   if (lower === "false") return false;
 144:   if (/^-?\d+$/.test(trimmed)) {
 145:     const parsed = parseInt(trimmed, 10);
 146:     if (!Number.isNaN(parsed)) return parsed;
 147:   }
 148:   if (/^-?\d+\.\d+$/.test(trimmed)) {
 149:     const parsed = parseFloat(trimmed);
 150:     if (!Number.isNaN(parsed)) return parsed;
 151:   }
 152:   if (
 153:     (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
 154:     (trimmed.startsWith("[") && trimmed.endsWith("]"))
 155:   ) {
 156:     const parsed = parseJsonTolerant(trimmed);
 157:     if (parsed !== null) return parsed;
 158:   }
 159:   return trimmed;
 160: }
 161: 
 162: function parseParameters(body: string): Record<string, unknown> {
 163:   const params: Record<string, unknown> = {};
 164: 
 165:   // 1. Qwen Parameter Format: <parameter=path>src/index.js</parameter>
 166:   const qwenParamRegex = new RegExp(QWEN_PARAM_REGEX.source, "gi");
 167:   let qpMatch = qwenParamRegex.exec(body);
 168:   while (qpMatch !== null) {
 169:     const key = (qpMatch[1] ?? "").trim();
 170:     const val = (qpMatch[2] ?? "").trim();
 171:     if (key.length > 0 && !(key in params)) {
 172:       params[key] = castValue(val);
 173:     }
 174:     qpMatch = qwenParamRegex.exec(body);
 175:   }
 176: 
 177:   // 2. Key-Value pairs: <arg_key>k</arg_key><arg_value>v</arg_value>
 178:   const kvRegex = new RegExp(ARG_KV_REGEX.source, "gi");
 179:   let kvMatch = kvRegex.exec(body);
 180:   while (kvMatch !== null) {
 181:     const key = (kvMatch[1] ?? "").trim();
 182:     const val = (kvMatch[2] ?? "").trim();
 183:     if (key.length > 0 && !(key in params)) {
 184:       params[key] = castValue(val);
 185:     }
 186:     kvMatch = kvRegex.exec(body);
 187:   }
 188: 
 189:   // 3. Named parameter tags: <parameter name="k">v</parameter>
 190:   const paramRegex = new RegExp(PARAM_REGEX.source, "gi");
 191:   let pMatch = paramRegex.exec(body);
 192:   while (pMatch !== null) {
 193:     const key = (pMatch[1] ?? "").trim();
 194:     let val = (pMatch[2] ?? "").trim();
 195:     if (val.includes("<arg_key>")) {
 196:       val = val.split("<arg_key>")[0]?.trim() ?? val;
 197:     }
 198:     if (key.length > 0 && !(key in params)) {
 199:       params[key] = castValue(val);
 200:     }
 201:     pMatch = paramRegex.exec(body);
 202:   }
 203: 
 204:   // 4. Claude / Cline child tags: <path>server.py</path><content>import os</content>
 205:   if (Object.keys(params).length === 0) {
 206:     const childTagRegex = /<([a-zA-Z0-9_\-]+)>([^<]*?)<\/\1>/g;
 207:     let childMatch = childTagRegex.exec(body);
 208:     while (childMatch !== null) {
 209:       const tag = (childMatch[1] ?? "").trim();
 210:       const val = (childMatch[2] ?? "").trim();
 211:       if (!EXCLUDED_TAG_NAMES.has(tag.toLowerCase()) && tag.length > 0 && !(tag in params)) {
 212:         params[tag] = castValue(val);
 213:       }
 214:       childMatch = childTagRegex.exec(body);
 215:     }
 216:   }
 217: 
 218:   // 5. Fallback: <arguments>JSON</arguments> or raw JSON in body
 219:   if (Object.keys(params).length === 0) {
 220:     const argsTagMatch = /<(?:arguments|args)>([\s\S]*?)<\/(?:arguments|args)>/i.exec(body);
 221:     const rawCandidate = (argsTagMatch?.[1] ?? body).trim();
 222:     if (rawCandidate.startsWith("{") && rawCandidate.endsWith("}")) {
 223:       const parsed = parseJsonTolerant(rawCandidate);
 224:       if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
 225:         const dict = parsed as Record<string, unknown>;
 226:         if (dict.arguments && typeof dict.arguments === "object" && !Array.isArray(dict.arguments)) {
 227:           Object.assign(params, dict.arguments);
 228:         } else if (typeof dict.arguments === "string") {
 229:           const inner = parseJsonTolerant(dict.arguments);
 230:           if (typeof inner === "object" && inner !== null) {
 231:             Object.assign(params, inner);
 232:           } else {
 233:             params.arguments = dict.arguments;
 234:           }
 235:         } else {
 236:           Object.assign(params, dict);
 237:         }
 238:       }
 239:     }
 240:   }
 241: 
 242:   return params;
 243: }
 244: 
 245: function extractFunctionName(tagFnName: string | undefined, body: string): string {
 246:   if (tagFnName && tagFnName.trim().length > 0) {
 247:     return tagFnName.trim();
 248:   }
 249:   const nameMatch = /<(?:name|function|tool_name)>([^<]+)<\/(?:name|function|tool_name)>/i.exec(body);
 250:   if (nameMatch && (nameMatch[1] ?? "").trim().length > 0) {
 251:     return (nameMatch[1] ?? "").trim();
 252:   }
 253:   const prefixMatch = /^\s*([a-zA-Z0-9_\-]+)\s*<(?:arg_key|argument_name|parameter|parameter_name)/i.exec(body);
 254:   if (prefixMatch && (prefixMatch[1] ?? "").trim().length > 0) {
 255:     return (prefixMatch[1] ?? "").trim();
 256:   }
 257:   return "tool";
 258: }
 259: 
 260: export function parseDotsXml(content: string): DotsParseResult {
 261:   const sanitized = stripLeakedTemplateTags(content);
 262: 
 263:   const lower = sanitized.toLowerCase();
 264:   const hasPotentialTools =
 265:     lower.includes("<invoke") ||
 266:     lower.includes("<tool_call") ||
 267:     lower.includes("<function_call") ||
 268:     lower.includes("<function_calls") ||
 269:     lower.includes("<tool_calls") ||
 270:     lower.includes("<function=") ||
 271:     lower.includes("<minimax:tool_call") ||
 272:     lower.includes("<arg_key") ||
 273:     lower.includes("<arg_value") ||
 274:     lower.includes("<parameter") ||
 275:     /<[a-zA-Z0-9_\-]+>\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>/i.test(sanitized);
 276: 
 277:   const toolCalls: OpenAIToolCall[] = [];
 278:   let index = 0;
 279:   let remainingText = sanitized;
 280: 
 281:   // STEP 1: Extract tool calls FIRST (even if inside <think> tags)
 282:   if (hasPotentialTools) {
 283:     // 1. Qwen JSON-in-XML: <tool_call>\s*({.*?})\s*</tool_call>
 284:     const jsonXmlRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
 285:     let jMatch = jsonXmlRegex.exec(sanitized);
 286:     while (jMatch !== null) {
 287:       const rawJson = jMatch[1] ?? "{}";
 288:       const parsed = parseJsonTolerant(rawJson);
 289:       if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
 290:         const payload = parsed as Record<string, unknown>;
 291:         const name = (payload.name || payload.function || "tool") as string;
 292:         let rawArgs: unknown = payload.arguments ?? payload.parameters ?? {};
 293:         if (typeof rawArgs === "string") {
 294:           const inner = parseJsonTolerant(rawArgs);
 295:           rawArgs = inner !== null ? inner : { input: rawArgs };
 296:         }
 297:         toolCalls.push({
 298:           id: `call_dots_${Date.now()}_${index}`,
 299:           type: "function",
 300:           function: {
 301:             name,
 302:             arguments: JSON.stringify(rawArgs),
 303:           },
 304:         });
 305:         index += 1;
 306:         remainingText = remainingText.replace(jMatch[0], "");
 307:       }
 308:       jMatch = jsonXmlRegex.exec(sanitized);
 309:     }
 310: 
 311:     // 2. Qwen Format: <function=name>...</function>
 312:     const qwenFuncRegex = new RegExp(QWEN_FUNC_REGEX.source, "gi");
 313:     let qMatch = qwenFuncRegex.exec(sanitized);
 314:     while (qMatch !== null) {
 315:       const fnName = (qMatch[1] ?? "").trim();
 316:       const body = qMatch[2] ?? "";
 317:       const argsObj = parseParameters(body);
 318:       toolCalls.push({
 319:         id: `call_dots_${Date.now()}_${index}`,
 320:         type: "function",
 321:         function: {
 322:           name: fnName,
 323:           arguments: JSON.stringify(argsObj),
 324:         },
 325:       });
 326:       index += 1;
 327:       remainingText = remainingText.replace(qMatch[0], "");
 328:       qMatch = qwenFuncRegex.exec(sanitized);
 329:     }
 330: 
 331:     // 3. DeepSeek / MiniMax / Standard Invoke Format: <invoke name="name">...
 332:     const invokeRegex = new RegExp(INVOKE_BLOCK_REGEX.source, "gi");
 333:     let iMatch = invokeRegex.exec(sanitized);
 334:     while (iMatch !== null) {
 335:       const rawBody = (iMatch[2] ?? "").trim();
 336:       if (!rawBody.startsWith("{") && !rawBody.includes("<function=")) {
 337:         const rawFnName = iMatch[1];
 338:         const fnName = extractFunctionName(rawFnName, rawBody);
 339:         const argsObj = parseParameters(rawBody);
 340:         toolCalls.push({
 341:           id: `call_dots_${Date.now()}_${index}`,
 342:           type: "function",
 343:           function: {
 344:             name: fnName,
 345:             arguments: JSON.stringify(argsObj),
 346:           },
 347:         });
 348:         index += 1;
 349:         remainingText = remainingText.replace(iMatch[0], "");
 350:       }
 351:       iMatch = invokeRegex.exec(sanitized);
 352:     }
 353: 
 354:     // 4. GLM / Zhipu / Qwen3 unwrapped <arg_key> & <arg_value> format: bash<arg_key>... or <tool_call>bash\n<arg_key>...
 355:     if (toolCalls.length === 0) {
 356:       const glmUnwrappedRegex =
 357:         /(?:<tool_call>)?\s*([a-zA-Z0-9_\-]+)\s*(<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>)\s*(?:<\/tool_call>)?/gi;
 358:       let gMatch = glmUnwrappedRegex.exec(sanitized);
 359:       while (gMatch !== null) {
 360:         const fnName = (gMatch[1] ?? "").trim();
 361:         const body = gMatch[2] ?? "";
 362:         const argsObj = parseParameters(body);
 363:         if (Object.keys(argsObj).length > 0) {
 364:           toolCalls.push({
 365:             id: `call_dots_${Date.now()}_${index}`,
 366:             type: "function",
 367:             function: {
 368:               name: fnName,
 369:               arguments: JSON.stringify(argsObj),
 370:             },
 371:           });
 372:           index += 1;
 373:           remainingText = remainingText.replace(gMatch[0], "");
 374:         }
 375:         gMatch = glmUnwrappedRegex.exec(sanitized);
 376:       }
 377:     }
 378: 
 379:     // 5. Claude / Cline Format: <write><path>...</path></write> (only if no tools extracted yet)
 380:     if (toolCalls.length === 0) {
 381:       const customToolRegex = /<([a-zA-Z0-9_\-]+)>(\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>[\s\S]*?)<\/\1>/gi;
 382:       let cMatch = customToolRegex.exec(sanitized);
 383:       while (cMatch !== null) {
 384:         const tagName = (cMatch[1] ?? "").trim();
 385:         if (!EXCLUDED_TAG_NAMES.has(tagName.toLowerCase())) {
 386:           const body = cMatch[2] ?? "";
 387:           const argsObj = parseParameters(body);
 388:           if (Object.keys(argsObj).length > 0) {
 389:             toolCalls.push({
 390:               id: `call_dots_${Date.now()}_${index}`,
 391:               type: "function",
 392:               function: {
 393:                 name: tagName,
 394:                 arguments: JSON.stringify(argsObj),
 395:               },
 396:             });
 397:             index += 1;
 398:             remainingText = remainingText.replace(cMatch[0], "");
 399:           }
 400:         }
 401:         cMatch = customToolRegex.exec(sanitized);
 402:       }
 403:     }
 404:   }
 405: 
 406:   // STEP 2: Extract Thinking / Reasoning tokens from remaining text
 407:   let reasoningContent: string | undefined = undefined;
 408:   const thinkMatch = /<(?:think|thought|thinking)>([\s\S]*?)(?:<\/(?:think|thought|thinking|role|tool_response|tool_result)>|<\|\s*(?:role_end|im_end|end_of_turn|end)\s*\|>|(?=<(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function=|tool_response|tool_result|arg_key))|(?=[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name))|$)/i.exec(remainingText);
 409:   if (thinkMatch) {
 410:     const rawThink = (thinkMatch[1] ?? "").trim();
 411:     if (rawThink.length > 0) {
 412:       reasoningContent = stripLeakedTemplateTags(rawThink);
 413:     }
 414:   }
 415: 
 416:   // STEP 3: Remove <think> blocks and strip residual markup
 417:   const contentWithoutThink = remainingText.replace(/<(?:think|thought|thinking)>[\s\S]*?(?:<\/(?:think|thought|thinking|role|tool_response|tool_result)>|<\|\s*(?:role_end|im_end|end_of_turn|end)\s*\|>|(?=<(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function=|tool_response|tool_result|arg_key))|(?=[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name))|$)/gi, "");
 418:   const cleanText = stripResidualTags(contentWithoutThink);
 419: 
 420:   return { cleanText, toolCalls, reasoningContent };
 421: }
 422: 
 423: function stripResidualTags(text: string): string {
 424:   return text
 425:     .replace(/<tool_call>\s*\{[\s\S]*?\}\s*<\/tool_call>/gi, "")
 426:     .replace(/<function=[a-zA-Z0-9_\-]+>[\s\S]*?<\/function>/gi, "")
 427:     .replace(new RegExp(INVOKE_BLOCK_REGEX.source, "gi"), "")
 428:     .replace(/(?:<tool_call>)?\s*[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>\s*(?:<\/tool_call>)?/gi, "")
 429:     .replace(/<([a-zA-Z0-9_\-]+)>\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>[\s\S]*?<\/\1>/gi, (match, tag) => {
 430:       return EXCLUDED_TAG_NAMES.has(String(tag).toLowerCase()) ? match : "";
 431:     })
 432:     .replace(/<\/?(?:tool_calls|function_calls|invoke|tool_call|function_call|minimax:tool_call|parameter|arg_key|arg_value|parameter_value|argument_name|argument_value|parameter_name|role|think|thought|thinking|tool_response|tool_result)[^>]*>/gi, "")
 433:     .trim();
 434: }
 435: 
 436: function parseToolCallArguments(raw: unknown): Record<string, unknown> {
 437:   if (typeof raw === "string") {
 438:     const parsed = parseJsonTolerant(raw);
 439:     if (typeof parsed === "object" && parsed !== null) {
 440:       return parsed as Record<string, unknown>;
 441:     }
 442:     return { input: raw };
 443:   }
 444:   if (typeof raw === "object" && raw !== null) {
 445:     return raw as Record<string, unknown>;
 446:   }
 447:   return {};
 448: }
 449: 
 450: function serializeParamEntry([k, v]: [string, unknown]): string {
 451:   const valStr = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
 452:   return `<parameter name="${k}">${valStr}</parameter>`;
 453: }
 454: 
 455: function serializeSingleInvoke(tc: OpenAIToolCall): string {
 456:   const fnName = tc.function?.name || "tool";
 457:   const argsObj = parseToolCallArguments(tc.function?.arguments);
 458:   const paramXml = Object.entries(argsObj).map(serializeParamEntry).join("\n");
 459:   if (paramXml.length > 0) {
 460:     return `<invoke name="${fnName}">\n${paramXml}\n</invoke>`;
 461:   }
 462:   return `<invoke name="${fnName}">\n</invoke>`;
 463: }
 464: 
 465: export function serializeDotsToolCalls(
 466:   toolCalls: readonly OpenAIToolCall[]
 467: ): string {
 468:   if (!toolCalls || toolCalls.length === 0) {
 469:     return "";
 470:   }
 471:   const invokes = toolCalls.map(serializeSingleInvoke).join("\n");
 472:   return `<tool_calls>\n${invokes}\n</tool_calls>`;
 473: }
 474: 
 475: function serializeToolResultContent(content: unknown): string {
 476:   if (typeof content === "string") {
 477:     return content;
 478:   }
 479:   return JSON.stringify(content ?? "");
 480: }
 481: 
 482: export function serializeDotsToolHistory(
 483:   messages: readonly OpenAIMessage[]
 484: ): OpenAIMessage[] {
 485:   const result: OpenAIMessage[] = [];
 486:   const pendingToolResults: string[] = [];
 487: 
 488:   const flushToolResults = () => {
 489:     if (pendingToolResults.length > 0) {
 490:       result.push({
 491:         role: "user",
 492:         content: pendingToolResults.join("\n\n"),
 493:       });
 494:       pendingToolResults.length = 0;
 495:     }
 496:   };
 497: 
 498:   for (const msg of messages) {
 499:     if (msg.role === "tool") {
 500:       const toolId = msg.tool_call_id || "call_unknown";
 501:       const toolNameAttr = msg.name ? ` name="${msg.name}"` : "";
 502:       const text = serializeToolResultContent(msg.content);
 503:       pendingToolResults.push(
 504:         `<tool_result id="${toolId}"${toolNameAttr}>\n${text}\n</tool_result>`
 505:       );
 506:       continue;
 507:     }
 508: 
 509:     flushToolResults();
 510: 
 511:     if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
 512:       const xml = serializeDotsToolCalls(msg.tool_calls);
 513:       const baseText = typeof msg.content === "string" ? msg.content : "";
 514:       const newContent = baseText.length > 0 ? `${baseText}\n${xml}` : xml;
 515:       result.push({ role: "assistant", content: newContent || " " });
 516:     } else {
 517:       result.push(msg);
 518:     }
 519:   }
 520: 
 521:   flushToolResults();
 522:   return result;
 523: }
 524: 
 525: export function injectToolsSchemaSystemPrompt(
 526:   messages: readonly OpenAIMessage[],
 527:   tools?: readonly unknown[]
 528: ): readonly OpenAIMessage[] {
 529:   if (!tools || !Array.isArray(tools) || tools.length === 0) {
 530:     return messages;
 531:   }
 532: 
 533:   const toolSchemas = tools
 534:     .map((t: unknown) => {
 535:       if (typeof t === "object" && t !== null) {
 536:         const item = t as Record<string, unknown>;
 537:         if (item.type === "function" && item.function) {
 538:           return JSON.stringify(item.function);
 539:         }
 540:         return JSON.stringify(item);
 541:       }
 542:       return "";
 543:     })
 544:     .filter((s) => s.length > 0);
 545: 
 546:   if (toolSchemas.length === 0) {
 547:     return messages;
 548:   }
 549: 
 550:   const toolSystemPrompt =
 551:     `\n\n# Tools\nYou have access to the following tools:\n<tools>\n` +
 552:     toolSchemas.join("\n") +
 553:     `\n</tools>\nWhen calling tools, output:\n<tool_call>\n<function=tool_name>\n<parameter=key>value</parameter>\n</function>\n</tool_call>`;
 554: 
 555:   const result = [...messages];
 556:   const sysIndex = result.findIndex((m) => m.role === "system");
 557:   if (sysIndex >= 0) {
 558:     const existing = result[sysIndex]!;
 559:     const existingText = typeof existing.content === "string" ? existing.content : "";
 560:     if (!existingText.includes("<tools>")) {
 561:       result[sysIndex] = {
 562:         ...existing,
 563:         content: existingText + toolSystemPrompt,
 564:       };
 565:     }
 566:   } else {
 567:     result.unshift({
 568:       role: "system",
 569:       content: toolSystemPrompt.trim(),
 570:     });
 571:   }
 572:   return result;
 573: }
 574: 
 575: export interface DotsStreamState {
 576:   buffer: string;
 577:   reasoningSanitizer: TagSanitizerStreamBuffer;
 578:   toolCallIndex: number;
 579:   hasEmittedToolCalls: boolean;
 580:   hasEmittedFinishReason: boolean;
 581:   isInThinkTag: boolean;
 582:   id?: string;
 583:   model?: string;
 584:   usage?: Record<string, unknown>;
 585: }
 586: 
 587: export function createDotsStreamState(): DotsStreamState {
 588:   return {
 589:     buffer: "",
 590:     reasoningSanitizer: new TagSanitizerStreamBuffer(),
 591:     toolCallIndex: 0,
 592:     hasEmittedToolCalls: false,
 593:     hasEmittedFinishReason: false,
 594:     isInThinkTag: false,
 595:   };
 596: }
 597: 
 598: export function formatOpenAIToolCallDelta(
 599:   toolCall: OpenAIToolCall,
 600:   index: number,
 601:   id?: string,
 602:   model?: string
 603: ): string {
 604:   const payload = {
 605:     id: id || `chatcmpl_dots_${Date.now()}`,
 606:     object: "chat.completion.chunk",
 607:     created: Math.floor(Date.now() / 1000),
 608:     model: model || "model",
 609:     choices: [
 610:       {
 611:         index: 0,
 612:         delta: {
 613:           tool_calls: [
 614:             {
 615:               index,
 616:               id: toolCall.id,
 617:               type: "function",
 618:               function: {
 619:                 name: toolCall.function.name,
 620:                 arguments: toolCall.function.arguments,
 621:               },
 622:             },
 623:           ],
 624:         },
 625:       },
 626:     ],
 627:   };
 628:   return `data: ${JSON.stringify(payload)}\n\n`;
 629: }
 630: 
 631: export function formatOpenAIReasoningDelta(
 632:   reasoning: string,
 633:   id?: string,
 634:   model?: string
 635: ): string {
 636:   const payload = {
 637:     id: id || `chatcmpl_dots_${Date.now()}`,
 638:     object: "chat.completion.chunk",
 639:     created: Math.floor(Date.now() / 1000),
 640:     model: model || "model",
 641:     choices: [
 642:       {
 643:         index: 0,
 644:         delta: {
 645:           reasoning_content: reasoning,
 646:         },
 647:       },
 648:     ],
 649:   };
 650:   return `data: ${JSON.stringify(payload)}\n\n`;
 651: }
 652: 
 653: export function formatOpenAITextDelta(
 654:   text: string,
 655:   id?: string,
 656:   model?: string
 657: ): string {
 658:   const payload = {
 659:     id: id || `chatcmpl_dots_${Date.now()}`,
 660:     object: "chat.completion.chunk",
 661:     created: Math.floor(Date.now() / 1000),
 662:     model: model || "model",
 663:     choices: [
 664:       {
 665:         index: 0,
 666:         delta: {
 667:           content: text,
 668:         },
 669:       },
 670:     ],
 671:   };
 672:   return `data: ${JSON.stringify(payload)}\n\n`;
 673: }
 674: 
 675: export function formatOpenAIFinishDelta(
 676:   finishReason: string,
 677:   id?: string,
 678:   model?: string,
 679:   usage?: Record<string, unknown>
 680: ): string {
 681:   const payload: Record<string, unknown> = {
 682:     id: id || `chatcmpl_dots_${Date.now()}`,
 683:     object: "chat.completion.chunk",
 684:     created: Math.floor(Date.now() / 1000),
 685:     model: model || "model",
 686:     choices: [
 687:       {
 688:         index: 0,
 689:         delta: {},
 690:         finish_reason: finishReason,
 691:       },
 692:     ],
 693:   };
 694:   if (usage) {
 695:     payload.usage = usage;
 696:   }
 697:   return `data: ${JSON.stringify(payload)}\n\n`;
 698: }
 699: 
 700: function flushInsideThinkContent(state: DotsStreamState): string {
 701:   const endMatch = /<\/(?:think|thought|thinking|role|tool_response|tool_result)>|<\|\s*(?:role_end|im_end|end_of_turn|end)\s*\|>|(?=<(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function=|tool_response|tool_result|arg_key))|(?=[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name))/i.exec(state.buffer);
 702:   if (endMatch) {
 703:     const rawReasoning = state.buffer.slice(0, endMatch.index);
 704:     state.buffer = state.buffer.slice(endMatch.index + endMatch[0].length);
 705:     state.isInThinkTag = false;
 706:     const reasoningText = stripLeakedTemplateTags(rawReasoning);
 707:     const reasoningDelta = reasoningText.length > 0
 708:       ? formatOpenAIReasoningDelta(reasoningText, state.id, state.model)
 709:       : "";
 710:     return reasoningDelta + processDotsStreamChunk("", state);
 711:   }
 712: 
 713:   const potentialTag = state.buffer.search(STREAM_PARTIAL_TAG_REGEX);
 714:   if (potentialTag !== -1) {
 715:     const safeReasoning = state.buffer.slice(0, potentialTag);
 716:     state.buffer = state.buffer.slice(potentialTag);
 717:     const reasoningText = stripLeakedTemplateTags(safeReasoning);
 718:     return reasoningText.length > 0
 719:       ? formatOpenAIReasoningDelta(reasoningText, state.id, state.model)
 720:       : "";
 721:   }
 722: 
 723:   const safeReasoning = state.buffer;
 724:   state.buffer = "";
 725:   const reasoningText = stripLeakedTemplateTags(safeReasoning);
 726:   return reasoningText.length > 0
 727:     ? formatOpenAIReasoningDelta(reasoningText, state.id, state.model)
 728:     : "";
 729: }
 730: 
 731: function flushNonTagContent(state: DotsStreamState): string {
 732:   const thinkOpenMatch = /<(?:think|thought|thinking)>/i.exec(state.buffer);
 733:   if (thinkOpenMatch) {
 734:     const before = state.buffer.slice(0, thinkOpenMatch.index);
 735:     state.buffer = state.buffer.slice(thinkOpenMatch.index + thinkOpenMatch[0].length);
 736:     state.isInThinkTag = true;
 737:     const prefixText = stripLeakedTemplateTags(before);
 738:     const textDelta = prefixText.length > 0
 739:       ? formatOpenAITextDelta(prefixText, state.id, state.model)
 740:       : "";
 741:     return textDelta + flushInsideThinkContent(state);
 742:   }
 743: 
 744:   const glmPrefixMatch = state.buffer.search(/[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name)/i);
 745:   const tagStart = state.buffer.search(
 746:     /<(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function=|minimax:tool_call|arg_key|arg_value|argument_name|argument_value|parameter|parameter_name|parameter_value)/i
 747:   );
 748: 
 749:   let earliestTag = -1;
 750:   if (glmPrefixMatch !== -1 && tagStart !== -1) {
 751:     earliestTag = Math.min(glmPrefixMatch, tagStart);
 752:   } else if (glmPrefixMatch !== -1) {
 753:     earliestTag = glmPrefixMatch;
 754:   } else {
 755:     earliestTag = tagStart;
 756:   }
 757: 
 758:   if (earliestTag === -1) {
 759:     const potentialTag = state.buffer.search(STREAM_PARTIAL_TAG_REGEX);
 760:     if (potentialTag !== -1) {
 761:       const rawPrefix = state.buffer.slice(0, potentialTag);
 762:       state.buffer = state.buffer.slice(potentialTag);
 763:       const textToEmit = stripLeakedTemplateTags(rawPrefix);
 764:       return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit, state.id, state.model) : "";
 765:     }
 766:     const textToEmit = stripLeakedTemplateTags(state.buffer);
 767:     state.buffer = "";
 768:     return textToEmit.length > 0 ? formatOpenAITextDelta(textToEmit, state.id, state.model) : "";
 769:   }
 770:   if (earliestTag > 0) {
 771:     const rawPrefix = state.buffer.slice(0, earliestTag);
 772:     state.buffer = state.buffer.slice(earliestTag);
 773:     const prefix = stripLeakedTemplateTags(rawPrefix);
 774:     return prefix.length > 0 ? formatOpenAITextDelta(prefix, state.id, state.model) : "";
 775:   }
 776:   return "";
 777: }
 778: 
 779: function hasUnclosedToolContainers(buffer: string): boolean {
 780:   const openInvoke = (buffer.match(/<invoke\b[^>]*>/gi) || []).length;
 781:   const closeInvoke = (buffer.match(/<\/invoke>/gi) || []).length;
 782:   if (openInvoke > closeInvoke) return true;
 783: 
 784:   const openToolCall = (buffer.match(/<tool_call\b[^>]*>/gi) || []).length;
 785:   const closeToolCall = (buffer.match(/<\/tool_call>/gi) || []).length;
 786:   if (openToolCall > closeToolCall) return true;
 787: 
 788:   const openFunctionCall = (buffer.match(/<function_call\b[^>]*>/gi) || []).length;
 789:   const closeFunctionCall = (buffer.match(/<\/function_call>/gi) || []).length;
 790:   if (openFunctionCall > closeFunctionCall) return true;
 791: 
 792:   const openMinimax = (buffer.match(/<minimax:tool_call\b[^>]*>/gi) || []).length;
 793:   const closeMinimax = (buffer.match(/<\/minimax:tool_call>/gi) || []).length;
 794:   if (openMinimax > closeMinimax) return true;
 795: 
 796:   const openQwenFunc = (buffer.match(/<function=[a-zA-Z0-9_\-]+>/gi) || []).length;
 797:   const closeQwenFunc = (buffer.match(/<\/function>/gi) || []).length;
 798:   if (openQwenFunc > closeQwenFunc) return true;
 799: 
 800:   return false;
 801: }
 802: 
 803: function hasOpenGroupContainers(buffer: string): boolean {
 804:   const openToolCalls = (buffer.match(/<tool_calls\b[^>]*>/gi) || []).length;
 805:   const closeToolCalls = (buffer.match(/<\/tool_calls>/gi) || []).length;
 806:   if (openToolCalls > closeToolCalls) return true;
 807: 
 808:   const openFunctionCalls = (buffer.match(/<function_calls\b[^>]*>/gi) || []).length;
 809:   const closeFunctionCalls = (buffer.match(/<\/function_calls>/gi) || []).length;
 810:   if (openFunctionCalls > closeFunctionCalls) return true;
 811: 
 812:   return false;
 813: }
 814: 
 815: function isIntermediateTagState(buffer: string): boolean {
 816:   return (
 817:     /<\/(?:parameter|parameter_name|parameter_value|arg_key|arg_value|argument_name|argument_value|name|tool_name|arguments|args)>\s*$/i.test(
 818:       buffer
 819:     ) ||
 820:     /<(?:parameter|parameter_name|parameter_value|arg_key|arg_value|argument_name|argument_value|name|tool_name|arguments|args)\b[^>]*$/i.test(
 821:       buffer
 822:     ) ||
 823:     /<(?:parameter|parameter_name|parameter_value|arg_key|arg_value|argument_name|argument_value|name|tool_name|arguments|args)\b[^>]*>[^<]*$/i.test(
 824:       buffer
 825:     )
 826:   );
 827: }
 828: 
 829: function checkToolClosingTag(
 830:   buffer: string,
 831:   unclosedTool: boolean,
 832:   openGroup: boolean
 833: ): boolean {
 834:   if (unclosedTool || openGroup) {
 835:     return false;
 836:   }
 837: 
 838:   if (
 839:     /<\/(?:invoke|tool_call|function_call|function|tool_calls|function_calls|minimax:tool_call|tool_response|tool_result)>/i.test(
 840:       buffer
 841:     )
 842:   ) {
 843:     return true;
 844:   }
 845: 
 846:   if (/[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name)/i.test(buffer)) {
 847:     if (/<\/(?:arg_value|argument_value|parameter_value)>\s*$/i.test(buffer)) {
 848:       return true;
 849:     }
 850:   }
 851: 
 852:   return false;
 853: }
 854: 
 855: function checkGenericClosingTag(
 856:   buffer: string,
 857:   unclosedTool: boolean,
 858:   openGroup: boolean,
 859:   intermediate: boolean
 860: ): boolean {
 861:   if (unclosedTool || openGroup || intermediate) {
 862:     return false;
 863:   }
 864:   const customTagMatch =
 865:     /<([a-zA-Z0-9_\-]+)>\s*<[a-zA-Z0-9_\-]+>[^<]*<\/[a-zA-Z0-9_\-]+>[\s\S]*?<\/\1>\s*$/i.exec(buffer);
 866:   if (customTagMatch && customTagMatch[1] && !EXCLUDED_TAG_NAMES.has(customTagMatch[1].toLowerCase())) {
 867:     return true;
 868:   }
 869:   return false;
 870: }
 871: 
 872: export function processDotsStreamChunk(
 873:   chunk: string,
 874:   state: DotsStreamState
 875: ): string {
 876:   state.buffer += chunk;
 877: 
 878:   if (state.isInThinkTag) {
 879:     return flushInsideThinkContent(state);
 880:   }
 881: 
 882:   const unclosedTool = hasUnclosedToolContainers(state.buffer);
 883:   const openGroup = hasOpenGroupContainers(state.buffer);
 884:   const intermediate = isIntermediateTagState(state.buffer);
 885: 
 886:   const hasToolClosing = checkToolClosingTag(state.buffer, unclosedTool, openGroup);
 887:   const hasGenericClosing = checkGenericClosingTag(state.buffer, unclosedTool, openGroup, intermediate);
 888: 
 889:   const hasClosingTag = hasToolClosing || hasGenericClosing;
 890:   if (!hasClosingTag) {
 891:     return flushNonTagContent(state);
 892:   }
 893: 
 894:   const { cleanText, toolCalls, reasoningContent } = parseDotsXml(state.buffer);
 895:   state.buffer = "";
 896: 
 897:   let output = "";
 898:   if (reasoningContent && reasoningContent.length > 0) {
 899:     output += formatOpenAIReasoningDelta(reasoningContent, state.id, state.model);
 900:   }
 901:   if (cleanText.length > 0) {
 902:     output += formatOpenAITextDelta(cleanText, state.id, state.model);
 903:   }
 904:   for (const tc of toolCalls) {
 905:     output += formatOpenAIToolCallDelta(tc, state.toolCallIndex, state.id, state.model);
 906:     state.toolCallIndex += 1;
 907:     state.hasEmittedToolCalls = true;
 908:   }
 909:   return output;
 910: }
 911: 
 912: export function createDotsStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
 913:   const state = createDotsStreamState();
 914:   const decoder = new TextDecoder();
 915:   const encoder = new TextEncoder();
 916:   let lineBuffer = "";
 917: 
 918:   function flushPendingBuffer(): string {
 919:     let out = "";
 920:     if (state.buffer.length > 0) {
 921:       if (state.isInThinkTag) {
 922:         state.isInThinkTag = false;
 923:         const sanitized = stripUnclosedTemplateTags(state.buffer);
 924:         const reasoningText = stripLeakedTemplateTags(sanitized);
 925:         state.buffer = "";
 926:         if (reasoningText.length > 0) {
 927:           out += formatOpenAIReasoningDelta(reasoningText, state.id, state.model);
 928:         }
 929:       } else {
 930:         const sanitized = stripUnclosedTemplateTags(state.buffer);
 931:         const { cleanText, toolCalls, reasoningContent } = parseDotsXml(sanitized);
 932:         state.buffer = "";
 933:         if (reasoningContent && reasoningContent.length > 0) {
 934:           out += formatOpenAIReasoningDelta(reasoningContent, state.id, state.model);
 935:         }
 936:         if (cleanText.length > 0) {
 937:           out += formatOpenAITextDelta(cleanText, state.id, state.model);
 938:         }
 939:         for (const tc of toolCalls) {
 940:           out += formatOpenAIToolCallDelta(tc, state.toolCallIndex, state.id, state.model);
 941:           state.toolCallIndex += 1;
 942:           state.hasEmittedToolCalls = true;
 943:         }
 944:       }
 945:     }
 946:     const trailingReasoning = state.reasoningSanitizer.flush();
 947:     if (trailingReasoning.length > 0) {
 948:       out += formatOpenAIReasoningDelta(trailingReasoning, state.id, state.model);
 949:     }
 950:     return out;
 951:   }
 952: 
 953:   function ensureFinishReason(): string {
 954:     if (!state.hasEmittedFinishReason) {
 955:       state.hasEmittedFinishReason = true;
 956:       const finishReason = state.hasEmittedToolCalls ? "tool_calls" : "stop";
 957:       return formatOpenAIFinishDelta(finishReason, state.id, state.model, state.usage);
 958:     }
 959:     return "";
 960:   }
 961: 
 962:   return new TransformStream<Uint8Array, Uint8Array>(({
 963:     transform(chunk, controller) {
 964:       lineBuffer += decoder.decode(chunk, { stream: true });
 965:       const lines = lineBuffer.split("\n");
 966:       lineBuffer = lines.pop() ?? "";
 967: 
 968:       for (const line of lines) {
 969:         const trimmed = line.trim();
 970:         if (!trimmed || trimmed.startsWith(":")) {
 971:           controller.enqueue(encoder.encode(line + "\n"));
 972:           continue;
 973:         }
 974:         if (trimmed === "data: [DONE]") {
 975:           const pending = flushPendingBuffer();
 976:           if (pending) {
 977:             controller.enqueue(encoder.encode(pending));
 978:           }
 979:           const finishSse = ensureFinishReason();
 980:           if (finishSse) {
 981:             controller.enqueue(encoder.encode(finishSse));
 982:           }
 983:           controller.enqueue(encoder.encode(line + "\n"));
 984:           continue;
 985:         }
 986:         if (trimmed.startsWith("data: ")) {
 987:           const jsonStr = trimmed.slice(6);
 988:           try {
 989:             const data = JSON.parse(jsonStr);
 990:             if (data.id && typeof data.id === "string") {
 991:               state.id = data.id;
 992:             }
 993:             if (data.model && typeof data.model === "string") {
 994:               state.model = data.model;
 995:             }
 996:             if (data.usage && typeof data.usage === "object") {
 997:               state.usage = data.usage as Record<string, unknown>;
 998:             }
 999: 
1000:             const choice = data.choices?.[0];
1001:             const delta = choice?.delta;
1002:             const content = delta?.content;
1003:             const incomingFinishReason = choice?.finish_reason;
1004: 
1005:             // Sanitize reasoning / thought fields across token stream buffers
1006:             let deltaModified = false;
1007:             if (delta && typeof delta === "object") {
1008:               if (typeof delta.reasoning_content === "string") {
1009:                 delta.reasoning_content = state.reasoningSanitizer.process(delta.reasoning_content);
1010:                 deltaModified = true;
1011:               }
1012:               if (typeof delta.thought === "string") {
1013:                 delta.thought = state.reasoningSanitizer.process(delta.thought);
1014:                 deltaModified = true;
1015:               }
1016:               if (typeof delta.reasoning === "string") {
1017:                 delta.reasoning = state.reasoningSanitizer.process(delta.reasoning);
1018:                 deltaModified = true;
1019:               }
1020:             }
1021: 
1022:             const hasPotentialTag =
1023:               typeof content === "string" &&
1024:               (content.includes("<") ||
1025:                 content.includes("＜") ||
1026:                 content.includes("[") ||
1027:                 content.includes("<<"));
1028: 
1029:             // FAST PASS-THROUGH: If no XML buffering or think block is active and content has no tag chars, forward chunk
1030:             if (state.buffer.length === 0 && !state.isInThinkTag && !hasPotentialTag) {
1031:               if (incomingFinishReason) {
1032:                 if (state.hasEmittedToolCalls) {
1033:                   choice.finish_reason = "tool_calls";
1034:                   state.hasEmittedFinishReason = true;
1035:                   controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
1036:                 } else {
1037:                   state.hasEmittedFinishReason = true;
1038:                   controller.enqueue(
1039:                     encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
1040:                   );
1041:                 }
1042:               } else {
1043:                 controller.enqueue(
1044:                   encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
1045:                 );
1046:               }
1047:               continue;
1048:             }
1049: 
1050:             // BUFFERING MODE: XML tag in progress or newly encountered in content
1051:             if (typeof content === "string") {
1052:               const processedSse = processDotsStreamChunk(content, state);
1053:               if (processedSse) {
1054:                 controller.enqueue(encoder.encode(processedSse));
1055:               }
1056:               if (incomingFinishReason) {
1057:                 const finishSse = ensureFinishReason();
1058:                 if (finishSse) {
1059:                   controller.enqueue(encoder.encode(finishSse));
1060:                 }
1061:               }
1062:             } else if (incomingFinishReason) {
1063:               const pending = flushPendingBuffer();
1064:               if (pending) {
1065:                 controller.enqueue(encoder.encode(pending));
1066:               }
1067:               const finishSse = ensureFinishReason();
1068:               if (finishSse) {
1069:                 controller.enqueue(encoder.encode(finishSse));
1070:               } else {
1071:                 controller.enqueue(
1072:                   encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
1073:                 );
1074:               }
1075:             } else {
1076:               controller.enqueue(
1077:                 encoder.encode(deltaModified ? `data: ${JSON.stringify(data)}\n\n` : line + "\n")
1078:               );
1079:             }
1080:           } catch (jsonErr: unknown) {
1081:             void jsonErr;
1082:             controller.enqueue(encoder.encode(line + "\n"));
1083:           }
1084:         } else {
1085:           controller.enqueue(encoder.encode(line + "\n"));
1086:         }
1087:       }
1088:     },
1089:     flush(controller) {
1090:       const pending = flushPendingBuffer();
1091:       if (pending) {
1092:         controller.enqueue(encoder.encode(pending));
1093:       }
1094:       const finishSse = ensureFinishReason();
1095:       if (finishSse) {
1096:         controller.enqueue(encoder.encode(finishSse));
1097:       }
1098:       if (lineBuffer.length > 0) {
1099:         controller.enqueue(encoder.encode(lineBuffer));
1100:       }
1101:     },
1102:   }));
1103: }
```

## File: src/transformers/ling.ts
```typescript
  1: import type {
  2:   OpenAIMessage,
  3:   OpenAIToolCall,
  4:   OpenAIRequestPayload,
  5:   OpenAIContentPart,
  6: } from "./nuances";
  7: 
  8: export interface OpenAIFunctionCall {
  9:   name: string;
 10:   arguments: string;
 11: }
 12: 
 13: export interface LingParseResult {
 14:   readonly cleanText: string;
 15:   readonly toolCalls: readonly OpenAIToolCall[];
 16:   readonly reasoningContent?: string;
 17: }
 18: 
 19: export interface OpenAIResponseChoice {
 20:   index: number;
 21:   message: {
 22:     role: "assistant";
 23:     content: string | null;
 24:     reasoning_content?: string;
 25:     tool_calls?: OpenAIToolCall[];
 26:   };
 27:   finish_reason: string;
 28: }
 29: 
 30: export interface OpenAIResponse {
 31:   id: string;
 32:   object: string;
 33:   created: number;
 34:   model: string;
 35:   choices: OpenAIResponseChoice[];
 36:   usage?: Record<string, unknown>;
 37: }
 38: 
 39: // ---------------------------------------------------------------------------
 40: // 1. REGEX ENGINE
 41: // ---------------------------------------------------------------------------
 42: 
 43: export const LING_LEAKED_TEMPLATE_REGEX =
 44:   /<role>(?:HUMAN|ASSISTANT|SYSTEM|BOT|USER|human|assistant|user|system|bot)?<\/role>|<\s*\/?\s*role(?::[a-zA-Z0-9_\-]+|\s*=\s*[a-zA-Z0-9_\-]+|\s+[a-zA-Z0-9_\-]+)?\s*>|<\/?[｜|]?(?:DSML[｜|]?)?(?:tool_calls|tool_call|tool_response|tool_result|arg_key|arg_value|argument_name|argument_value|parameter|parameter_name|parameter_value|invoke|function|think|thought|thinking)[^>]*>|<\|(?:role_end|startoftext|endoftext|im_end|im_start|fim_start|fim_hole|fim_end|start_of_turn|end_of_turn|eot_id|start_header_id|end_header_id)\|>|<[｜|](?:System|User|Assistant|begin of sentence|end of sentence|DSML)[｜|]?>|\[gMASK\](?:<sop>)?|<sop>|\[\/?INST\]|<<\/?SYS>>/gi;
 45: 
 46: export const LING_STREAM_PARTIAL_TAG_REGEX =
 47:   /<$|<(?:\/|[a-zA-Z_｜|])[a-zA-Z0-9_\-: ='"/｜|]{0,80}$|<\|[^|]{0,40}$|<｜[^｜]{0,40}$|＜｜?[^｜＞]{0,40}$|\[(?:gMASK|\/?INST)[a-zA-Z0-9_\-/]{0,10}$|<<\/?(?:SYS)?[^>]{0,10}$|(?:^|[\n\r\s])(?:edit|write|read|shell|websearch|grep|glob)(?:p|pa|pat|path|c|co|com|comm|comma|comman|command|q|qu|que|quer|query|pattern)?$/i;
 48: 
 49: export function stripLingLeakedTemplateTags(raw: string): string {
 50:   if (!raw) return "";
 51:   return raw.replace(LING_LEAKED_TEMPLATE_REGEX, "").trim();
 52: }
 53: 
 54: function generateCallId(): string {
 55:   return `call_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36).substring(4, 8)}`;
 56: }
 57: 
 58: function castValue(raw: string): unknown {
 59:   const trimmed = raw.trim();
 60:   const lower = trimmed.toLowerCase();
 61:   if (lower === "true") return true;
 62:   if (lower === "false") return false;
 63:   if (lower === "null") return null;
 64:   if (/^-?\d+$/.test(trimmed)) {
 65:     const num = parseInt(trimmed, 10);
 66:     if (!Number.isNaN(num)) return num;
 67:   }
 68:   if (/^-?\d+\.\d+$/.test(trimmed)) {
 69:     const num = parseFloat(trimmed);
 70:     if (!Number.isNaN(num)) return num;
 71:   }
 72:   try {
 73:     return JSON.parse(trimmed);
 74:   } catch (err: unknown) {
 75:     void err;
 76:     return trimmed;
 77:   }
 78: }
 79: 
 80: function extractMessageContentText(content: string | null | readonly OpenAIContentPart[] | undefined): string {
 81:   if (!content) return "";
 82:   if (typeof content === "string") return content;
 83:   if (Array.isArray(content)) {
 84:     return content
 85:       .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
 86:       .join("\n");
 87:   }
 88:   return "";
 89: }
 90: 
 91: // ---------------------------------------------------------------------------
 92: // 2. REQUEST SERIALIZER (Fixes Upstream 400 Schema Collisions)
 93: // ---------------------------------------------------------------------------
 94: 
 95: export function transformLingRequest(req: OpenAIRequestPayload): OpenAIRequestPayload {
 96:   const transformed: Record<string, unknown> = { ...req };
 97:   const serializedMessages: OpenAIMessage[] = [];
 98:   const pendingToolResponses: string[] = [];
 99: 
100:   const flushToolResponses = () => {
101:     if (pendingToolResponses.length > 0) {
102:       serializedMessages.push({
103:         role: "user",
104:         content: pendingToolResponses.join("\n\n"),
105:       });
106:       pendingToolResponses.length = 0;
107:     }
108:   };
109: 
110:   const messages = req.messages ?? [];
111: 
112:   for (let i = 0; i < messages.length; i++) {
113:     const msg = messages[i]!;
114:     const isLastTurn = i >= messages.length - 2;
115: 
116:     if (msg.role === "tool") {
117:       const toolId = msg.tool_call_id || "call_unknown";
118:       const text = extractMessageContentText(msg.content);
119:       pendingToolResponses.push(`<tool_response id="${toolId}">\n${text}\n</tool_response>`);
120:       continue;
121:     }
122: 
123:     flushToolResponses();
124: 
125:     const cleanMsg: Record<string, unknown> = {
126:       role: msg.role,
127:       content: msg.content,
128:     };
129: 
130:     if (msg.name) {
131:       cleanMsg.name = msg.name;
132:     }
133: 
134:     // Keep reasoning only on the immediate prior turn to maintain Jinja template health
135:     if (isLastTurn && msg.reasoning_content) {
136:       cleanMsg.reasoning_content = msg.reasoning_content;
137:     }
138: 
139:     // Format assistant tool calls into Ling XML and CRITICALLY DELETE tool_calls field
140:     if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
141:       let callXml = "";
142:       for (const tc of msg.tool_calls) {
143:         const fnName = tc.function.name;
144:         let args: Record<string, unknown> = {};
145:         try {
146:           args = typeof tc.function.arguments === "string"
147:             ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
148:             : (tc.function.arguments as unknown as Record<string, unknown>);
149:         } catch (err: unknown) {
150:           void err;
151:           args = {};
152:         }
153: 
154:         callXml += `\n<tool_call>${fnName}`;
155:         for (const [k, v] of Object.entries(args ?? {})) {
156:           const valStr = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
157:           callXml += `<arg_key>${k}</arg_key><arg_value>${valStr}</arg_value>`;
158:         }
159:         callXml += `</tool_call>`;
160:       }
161: 
162:       const baseText = extractMessageContentText(msg.content);
163:       cleanMsg.content = (baseText + callXml).trim() || " ";
164:       // DO NOT include tool_calls field; prevents upstream 400 schema error
165:     }
166: 
167:     serializedMessages.push(cleanMsg as unknown as OpenAIMessage);
168:   }
169: 
170:   flushToolResponses();
171: 
172:   // Inject tools into System Prompt as Ling XML
173:   if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
174:     const toolDefs = req.tools
175:       .map((t: unknown) => {
176:         const toolObj = t as { function?: unknown; [key: string]: unknown };
177:         return JSON.stringify(toolObj.function ?? toolObj);
178:       })
179:       .join("\n");
180: 
181:     const toolSystemPrompt =
182:       `\n\n# Tools\nYou have access to the following tools:\n<tools>\n` +
183:       toolDefs +
184:       `\n</tools>\nTo invoke a tool, output:\n<tool_call>tool_name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>\n\n# Execution Rules\n1. When calling tools, output ONLY the <tool_call> block.\n2. When receiving <tool_response>, analyze the result and continue your task immediately with more tool calls or provide your final response to the user. Do NOT repeat 'continue' or output empty messages.`;
185: 
186:     const sysIdx = serializedMessages.findIndex((m) => m.role === "system");
187:     if (sysIdx >= 0) {
188:       const existing = serializedMessages[sysIdx]!;
189:       const existingContent = extractMessageContentText(existing.content);
190:       serializedMessages[sysIdx] = {
191:         ...existing,
192:         content: (existingContent + toolSystemPrompt).trim(),
193:       };
194:     } else {
195:       serializedMessages.unshift({ role: "system", content: toolSystemPrompt.trim() });
196:     }
197:   }
198: 
199:   transformed.messages = serializedMessages;
200: 
201:   // CRITICAL: Strip tools and tool_choice from upstream payload to prevent provider rejection
202:   delete transformed.tools;
203:   delete transformed.tool_choice;
204: 
205:   // Do not force <|role_end|> into stop tokens so thinking/tool output is not terminated prematurely
206:   if (req.stop) {
207:     transformed.stop = req.stop;
208:   }
209: 
210:   return transformed as unknown as OpenAIRequestPayload;
211: }
212: 
213: // ---------------------------------------------------------------------------
214: // 3. PARSER ENGINE (Multi-dialect XML -> OpenAIToolCall[])
215: // ---------------------------------------------------------------------------
216: 
217: export function parseLingXml(rawText: string): LingParseResult {
218:   const toolCalls: OpenAIToolCall[] = [];
219:   let remainingText = rawText;
220: 
221:   // 1. Ling-3.0 / GLM <arg_key> & <arg_value> Dialect
222:   const glmPattern =
223:     /(?:<tool_call>)?\s*([a-zA-Z0-9_\-]+)\s*(<arg_key>[\s\S]*?<\/arg_value>(?:\s*<arg_key>[\s\S]*?<\/arg_value>)*)\s*(?:<\/tool_call>)?/gi;
224: 
225:   remainingText = remainingText.replace(glmPattern, (fullMatch, fnName, argsBody) => {
226:     const pairRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
227:     const argsObj: Record<string, unknown> = {};
228:     let pMatch: RegExpExecArray | null;
229: 
230:     while ((pMatch = pairRegex.exec(argsBody)) !== null) {
231:       const k = pMatch[1]!.trim();
232:       const v = pMatch[2]!.trim();
233:       argsObj[k] = castValue(v);
234:     }
235: 
236:     if (Object.keys(argsObj).length > 0) {
237:       toolCalls.push({
238:         id: generateCallId(),
239:         type: "function",
240:         function: {
241:           name: fnName.trim().toLowerCase(),
242:           arguments: JSON.stringify(argsObj),
243:         },
244:       });
245:       return "";
246:     }
247:     return fullMatch;
248:   });
249: 
250:   // 2. Qwen XML (<function=name><parameter=k>v</parameter></function>)
251:   const qwenPattern = /<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/gi;
252:   remainingText = remainingText.replace(qwenPattern, (_m, fnName, body) => {
253:     const paramRegex = /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/parameter>/gi;
254:     const argsObj: Record<string, unknown> = {};
255:     let pMatch: RegExpExecArray | null;
256:     while ((pMatch = paramRegex.exec(body)) !== null) {
257:       argsObj[pMatch[1]!.trim()] = castValue(pMatch[2]!.trim());
258:     }
259:     toolCalls.push({
260:       id: generateCallId(),
261:       type: "function",
262:       function: {
263:         name: fnName.trim().toLowerCase(),
264:         arguments: JSON.stringify(argsObj),
265:       },
266:     });
267:     return "";
268:   });
269: 
270:   // 3. DeepSeek / MiniMax / DSML / Standard (<invoke name="...">...<parameter name="k">v</parameter></invoke>)
271:   const invokePattern = /<[｜|]?(?:DSML[｜|]?)?invoke\s+name=["']?([a-zA-Z0-9_\-]+)["']?[^>]*>([\s\S]*?)<\/[｜|]?(?:DSML[｜|]?)?invoke>/gi;
272:   remainingText = remainingText.replace(invokePattern, (_m, fnName, body) => {
273:     const paramRegex = /<[｜|]?(?:DSML[｜|]?)?parameter\s+name=["']?([a-zA-Z0-9_\-]+)["']?[^>]*>([\s\S]*?)(?:<\/[｜|]?(?:DSML[｜|]?)?parameter>|(?=<[｜|]?(?:DSML[｜|]?)?parameter)|$)/gi;
274:     const argsObj: Record<string, unknown> = {};
275:     let pMatch: RegExpExecArray | null;
276:     while ((pMatch = paramRegex.exec(body)) !== null) {
277:       const k = pMatch[1]!.trim();
278:       let v = pMatch[2]!.trim();
279:       if (k === "oldString" && v.includes("newString")) {
280:         const idx = v.indexOf("newString");
281:         argsObj["oldString"] = v.slice(0, idx).trim();
282:         argsObj["newString"] = v.slice(idx + "newString".length).trim();
283:       } else {
284:         argsObj[k] = castValue(v);
285:       }
286:     }
287:     toolCalls.push({
288:       id: generateCallId(),
289:       type: "function",
290:       function: {
291:         name: fnName.trim().toLowerCase(),
292:         arguments: JSON.stringify(argsObj),
293:       },
294:     });
295:     return "";
296:   });
297: 
298:   // 4. JSON tool call (<tool_call>{...}</tool_call>)
299:   const jsonToolPattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
300:   remainingText = remainingText.replace(jsonToolPattern, (_m, jsonStr) => {
301:     try {
302:       const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
303:       if (parsed && typeof parsed === "object") {
304:         const name = parsed.name || (parsed.function as Record<string, unknown> | undefined)?.name || "tool";
305:         const args = parsed.arguments || (parsed.function as Record<string, unknown> | undefined)?.arguments || parsed.parameters || {};
306:         toolCalls.push({
307:           id: generateCallId(),
308:           type: "function",
309:           function: {
310:             name: String(name).toLowerCase(),
311:             arguments: typeof args === "string" ? args : JSON.stringify(args),
312:           },
313:         });
314:         return "";
315:       }
316:     } catch (err: unknown) {
317:       void err;
318:     }
319:     return "";
320:   });
321: 
322:   // 5. Degraded / Tagless Concat Dialects (e.g. websearchquery..., shellcommand..., editpath...)
323:   const editConcatPattern = /(?:^|[\n\r\s])editpath\s*([^\s\n\r]+?)\s*oldString\s*([\s\S]+?)\s*newString\s*([\s\S]+?)(?:\s*replaceAll\s*(true|false))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
324:   remainingText = remainingText.replace(editConcatPattern, (_m, path, oldStr, newStr, replaceAllVal) => {
325:     const editArgs: Record<string, unknown> = {
326:       path: path.trim(),
327:       oldString: oldStr.trim(),
328:       newString: newStr.trim(),
329:     };
330:     if (replaceAllVal) {
331:       editArgs.replaceAll = replaceAllVal.toLowerCase() === "true";
332:     }
333:     toolCalls.push({
334:       id: generateCallId(),
335:       type: "function",
336:       function: {
337:         name: "edit",
338:         arguments: JSON.stringify(editArgs),
339:       },
340:     });
341:     return "";
342:   });
343: 
344:   const writeConcatPattern = /(?:^|[\n\r\s])writepath\s*([^\s\n\r]+?)\s*content\s*([\s\S]+?)(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
345:   remainingText = remainingText.replace(writeConcatPattern, (_m, path, content) => {
346:     toolCalls.push({
347:       id: generateCallId(),
348:       type: "function",
349:       function: {
350:         name: "write",
351:         arguments: JSON.stringify({
352:           path: path.trim(),
353:           content: content.trim(),
354:         }),
355:       },
356:     });
357:     return "";
358:   });
359: 
360:   const websearchConcatPattern = /(?:^|[\n\r\s])websearchquery\s*([^\n\r]+)/gi;
361:   remainingText = remainingText.replace(websearchConcatPattern, (_m, query) => {
362:     const q = query.trim();
363:     if (q.length > 0) {
364:       toolCalls.push({
365:         id: generateCallId(),
366:         type: "function",
367:         function: {
368:           name: "websearch",
369:           arguments: JSON.stringify({ query: q }),
370:         },
371:       });
372:       return "";
373:     }
374:     return _m;
375:   });
376: 
377:   const shellConcatPattern = /(?:^|[\n\r\s])shellcommand\s*([\s\S]+?)(?:\s*timeout\s*(\d+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
378:   remainingText = remainingText.replace(shellConcatPattern, (_m, cmd, timeout) => {
379:     const c = cmd.trim();
380:     if (c.length > 0) {
381:       const shellArgs: Record<string, unknown> = { command: c };
382:       if (timeout) shellArgs.timeout = parseInt(timeout, 10);
383:       toolCalls.push({
384:         id: generateCallId(),
385:         type: "function",
386:         function: {
387:           name: "shell",
388:           arguments: JSON.stringify(shellArgs),
389:         },
390:       });
391:       return "";
392:     }
393:     return _m;
394:   });
395: 
396:   const readConcatPattern = /(?:^|[\n\r\s])readpath\s*([^\n\r\s]+)(?:\s*offset\s*(\d+))?(?:\s*limit\s*(\d+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
397:   remainingText = remainingText.replace(readConcatPattern, (_m, path, offset, limit) => {
398:     const args: Record<string, unknown> = { path: path.trim() };
399:     if (offset) args.offset = parseInt(offset, 10);
400:     if (limit) args.limit = parseInt(limit, 10);
401:     toolCalls.push({
402:       id: generateCallId(),
403:       type: "function",
404:       function: {
405:         name: "read",
406:         arguments: JSON.stringify(args),
407:       },
408:     });
409:     return "";
410:   });
411: 
412:   const grepConcatPattern = /(?:^|[\n\r\s])greppattern\s*([^\n\r]+?)(?:\s*path\s*([^\n\r\s]+))?(?:\s*include\s*([^\n\r\s]+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
413:   remainingText = remainingText.replace(grepConcatPattern, (_m, pat, path, include) => {
414:     const args: Record<string, unknown> = { pattern: pat.trim() };
415:     if (path) args.path = path.trim();
416:     if (include) args.include = include.trim();
417:     toolCalls.push({
418:       id: generateCallId(),
419:       type: "function",
420:       function: {
421:         name: "grep",
422:         arguments: JSON.stringify(args),
423:       },
424:     });
425:     return "";
426:   });
427: 
428:   const globConcatPattern = /(?:^|[\n\r\s])globpattern\s*([^\n\r]+?)(?:\s*path\s*([^\n\r\s]+))?(?=(?:(?:^|[\n\r\s])(?:shellcommand|readpath|editpath|writepath|websearchquery|greppattern|globpattern))|$)/gi;
429:   remainingText = remainingText.replace(globConcatPattern, (_m, pat, path) => {
430:     const args: Record<string, unknown> = { pattern: pat.trim() };
431:     if (path) args.path = path.trim();
432:     toolCalls.push({
433:       id: generateCallId(),
434:       type: "function",
435:       function: {
436:         name: "glob",
437:         arguments: JSON.stringify(args),
438:       },
439:     });
440:     return "";
441:   });
442: 
443:   // 6. Extract Thinking (<think>...</think>)
444:   let reasoningContent: string | undefined = undefined;
445:   const thinkMatch = /<(?:think|thought|thinking)>([\s\S]*?)(?:<\/(?:think|thought|thinking)>|(?=<(?:tool_calls?|invoke|function=|tool_call))|$)/i.exec(
446:     remainingText
447:   );
448:   if (thinkMatch) {
449:     const rawThink = (thinkMatch[1] ?? "").trim();
450:     if (rawThink.length > 0) {
451:       reasoningContent = rawThink.replace(LING_LEAKED_TEMPLATE_REGEX, "");
452:     }
453:     remainingText = remainingText.replace(thinkMatch[0], "");
454:   }
455: 
456:   // 6. Scrub remaining leaked control tokens
457:   const cleanText = remainingText.replace(LING_LEAKED_TEMPLATE_REGEX, "").trim();
458: 
459:   return { cleanText, toolCalls, reasoningContent };
460: }
461: 
462: // ---------------------------------------------------------------------------
463: // 4. OPENCODE2 SSE STREAM TRANSFORMER (Strict OpenAI Spec)
464: // ---------------------------------------------------------------------------
465: 
466: export function createLingStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
467:   const decoder = new TextDecoder();
468:   const encoder = new TextEncoder();
469:   let lineBuffer = "";
470:   let textBuffer = "";
471:   let isInThinkTag = false;
472:   let hasEmittedRole = false;
473:   let hasEmittedToolCalls = false;
474:   let hasEmittedFinish = false;
475:   let toolCallIndex = 0;
476:   let streamId = `chatcmpl_${Date.now()}`;
477:   let streamModel = "ling-3.0-flash";
478:   let streamUsage: Record<string, unknown> | undefined;
479: 
480:   function sse(payload: Record<string, unknown>): string {
481:     return `data: ${JSON.stringify(payload)}\n\n`;
482:   }
483: 
484:   function emitRoleHeader(): string {
485:     if (!hasEmittedRole) {
486:       hasEmittedRole = true;
487:       return sse({
488:         id: streamId,
489:         object: "chat.completion.chunk",
490:         created: Math.floor(Date.now() / 1000),
491:         model: streamModel,
492:         choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
493:       });
494:     }
495:     return "";
496:   }
497: 
498:   function emitReasoning(reasoning: string): string {
499:     return sse({
500:       id: streamId,
501:       object: "chat.completion.chunk",
502:       created: Math.floor(Date.now() / 1000),
503:       model: streamModel,
504:       choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
505:     });
506:   }
507: 
508:   function emitContent(content: string): string {
509:     return sse({
510:       id: streamId,
511:       object: "chat.completion.chunk",
512:       created: Math.floor(Date.now() / 1000),
513:       model: streamModel,
514:       choices: [{ index: 0, delta: { content }, finish_reason: null }],
515:     });
516:   }
517: 
518:   /** Emits OpenCode2 compliant tool call chunks (Declaration -> Arguments) */
519:   function emitToolCallChunks(tc: OpenAIToolCall, index: number): string {
520:     let out = "";
521:     // Chunk 1: Tool Call Header
522:     out += sse({
523:       id: streamId,
524:       object: "chat.completion.chunk",
525:       created: Math.floor(Date.now() / 1000),
526:       model: streamModel,
527:       choices: [
528:         {
529:           index: 0,
530:           delta: {
531:             tool_calls: [
532:               {
533:                 index,
534:                 id: tc.id,
535:                 type: "function",
536:                 function: { name: tc.function.name, arguments: "" },
537:               },
538:             ],
539:           },
540:           finish_reason: null,
541:         },
542:       ],
543:     });
544: 
545:     // Chunk 2: Tool Call Arguments Payload
546:     out += sse({
547:       id: streamId,
548:       object: "chat.completion.chunk",
549:       created: Math.floor(Date.now() / 1000),
550:       model: streamModel,
551:       choices: [
552:         {
553:           index: 0,
554:           delta: {
555:             tool_calls: [
556:               {
557:                 index,
558:                 function: { arguments: tc.function.arguments },
559:               },
560:             ],
561:           },
562:           finish_reason: null,
563:         },
564:       ],
565:     });
566: 
567:     return out;
568:   }
569: 
570:   function emitFinish(reason: string): string {
571:     if (!hasEmittedFinish) {
572:       hasEmittedFinish = true;
573:       const payload: Record<string, unknown> = {
574:         id: streamId,
575:         object: "chat.completion.chunk",
576:         created: Math.floor(Date.now() / 1000),
577:         model: streamModel,
578:         choices: [{ index: 0, delta: {}, finish_reason: reason }],
579:       };
580:       if (streamUsage) payload.usage = streamUsage;
581:       return sse(payload);
582:     }
583:     return "";
584:   }
585: 
586:   function processChunk(chunkText: string): string {
587:     textBuffer += chunkText;
588:     let out = emitRoleHeader();
589: 
590:     // 1. Manage Thinking & Breakout
591:     if (isInThinkTag) {
592:       const thinkEndMatch = /<\/(?:think|thought|thinking)>/i.exec(textBuffer);
593:       const toolBreakoutMatch = /<(?:tool_calls?|tool_call|invoke|function=|\/role>)/i.exec(textBuffer);
594:       const glmBreakoutMatch = /[a-zA-Z0-9_\-]+\s*<arg_key>/i.exec(textBuffer);
595: 
596:       let breakoutIdx = -1;
597:       if (toolBreakoutMatch) breakoutIdx = toolBreakoutMatch.index;
598:       if (glmBreakoutMatch && (breakoutIdx === -1 || glmBreakoutMatch.index < breakoutIdx)) {
599:         breakoutIdx = glmBreakoutMatch.index;
600:       }
601: 
602:       if (thinkEndMatch) {
603:         const thought = textBuffer.slice(0, thinkEndMatch.index);
604:         textBuffer = textBuffer.slice(thinkEndMatch.index + thinkEndMatch[0].length);
605:         isInThinkTag = false;
606:         const clean = thought.replace(LING_LEAKED_TEMPLATE_REGEX, "");
607:         if (clean) out += emitReasoning(clean);
608:       } else if (breakoutIdx !== -1) {
609:         const thought = textBuffer.slice(0, breakoutIdx);
610:         textBuffer = textBuffer.slice(breakoutIdx);
611:         isInThinkTag = false;
612:         const clean = thought.replace(LING_LEAKED_TEMPLATE_REGEX, "");
613:         if (clean) out += emitReasoning(clean);
614:       } else {
615:         const hold = LING_STREAM_PARTIAL_TAG_REGEX.exec(textBuffer);
616:         if (hold) {
617:           const emit = textBuffer.slice(0, hold.index);
618:           textBuffer = textBuffer.slice(hold.index);
619:           const clean = emit.replace(LING_LEAKED_TEMPLATE_REGEX, "");
620:           if (clean) out += emitReasoning(clean);
621:         } else {
622:           const clean = textBuffer.replace(LING_LEAKED_TEMPLATE_REGEX, "");
623:           textBuffer = "";
624:           if (clean) out += emitReasoning(clean);
625:         }
626:         return out;
627:       }
628:     }
629: 
630:     if (!isInThinkTag) {
631:       const thinkStart = /<(?:think|thought|thinking)>/i.exec(textBuffer);
632:       if (thinkStart) {
633:         const before = textBuffer.slice(0, thinkStart.index);
634:         textBuffer = textBuffer.slice(thinkStart.index + thinkStart[0].length);
635:         isInThinkTag = true;
636:         const clean = before.replace(LING_LEAKED_TEMPLATE_REGEX, "");
637:         if (clean) out += emitContent(clean);
638:         return out + processChunk("");
639:       }
640:     }
641: 
642:     // 2. Check for Tool Tag Detection and Completion
643:     const CONCAT_TOOL_START_REGEX = /(?:^|[\n\r\s])(?:editpath|writepath|readpath|shellcommand|websearchquery|greppattern|globpattern)/i;
644: 
645:     const hasToolTagStart =
646:       /<[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function=|tool_call)/i.test(textBuffer) ||
647:       /[a-zA-Z0-9_\-]+\s*<arg_key>/i.test(textBuffer) ||
648:       CONCAT_TOOL_START_REGEX.test(textBuffer);
649: 
650:     const hasToolClosure =
651:       /<\/[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function|tool_call)>/i.test(textBuffer) ||
652:       (textBuffer.includes("</arg_value>") && !textBuffer.includes("<arg_key>") && /<\/(?:arg_value)>/i.test(textBuffer));
653: 
654:     if (hasToolTagStart) {
655:       if (hasToolClosure) {
656:         const { cleanText, toolCalls, reasoningContent } = parseLingXml(textBuffer);
657:         textBuffer = "";
658: 
659:         if (reasoningContent) out += emitReasoning(reasoningContent);
660:         if (cleanText) out += emitContent(cleanText);
661: 
662:         for (const tc of toolCalls) {
663:           out += emitToolCallChunks(tc, toolCallIndex);
664:           toolCallIndex += 1;
665:           hasEmittedToolCalls = true;
666:         }
667:         return out;
668:       }
669: 
670:       // If tool tag has started but not closed, emit any leading non-tool text and hold the rest
671:       const tagMatch = /<[｜|]?(?:DSML[｜|]?)?(?:tool_calls?|invoke|function=|tool_call)/i.exec(textBuffer);
672:       const glmMatch = /[a-zA-Z0-9_\-]+\s*<arg_key>/i.exec(textBuffer);
673:       const concatMatch = CONCAT_TOOL_START_REGEX.exec(textBuffer);
674:       let earliest = -1;
675:       if (tagMatch) earliest = tagMatch.index;
676:       if (glmMatch && (earliest === -1 || glmMatch.index < earliest)) earliest = glmMatch.index;
677:       if (concatMatch && (earliest === -1 || concatMatch.index < earliest)) earliest = concatMatch.index;
678: 
679:       if (earliest > 0) {
680:         const lead = textBuffer.slice(0, earliest);
681:         textBuffer = textBuffer.slice(earliest);
682:         const clean = lead.replace(LING_LEAKED_TEMPLATE_REGEX, "");
683:         if (clean) out += emitContent(clean);
684:       }
685:       // Hold remainder in textBuffer until closure or flushPending
686:       return out;
687:     }
688: 
689:     // 3. Safe Text Streaming (Buffers ONLY actual partial tag suffixes)
690:     const partialMatch = LING_STREAM_PARTIAL_TAG_REGEX.exec(textBuffer);
691:     if (partialMatch) {
692:       const emit = textBuffer.slice(0, partialMatch.index);
693:       textBuffer = textBuffer.slice(partialMatch.index);
694:       const clean = emit.replace(LING_LEAKED_TEMPLATE_REGEX, "");
695:       if (clean) out += emitContent(clean);
696:     } else {
697:       const clean = textBuffer.replace(LING_LEAKED_TEMPLATE_REGEX, "");
698:       textBuffer = "";
699:       if (clean) out += emitContent(clean);
700:     }
701: 
702:     return out;
703:   }
704: 
705:   function flushPending(): string {
706:     let out = "";
707:     if (textBuffer.length > 0) {
708:       const { cleanText, toolCalls, reasoningContent } = parseLingXml(textBuffer);
709:       textBuffer = "";
710:       if (reasoningContent) out += emitReasoning(reasoningContent);
711:       if (cleanText) out += emitContent(cleanText);
712:       for (const tc of toolCalls) {
713:         out += emitToolCallChunks(tc, toolCallIndex);
714:         toolCallIndex += 1;
715:         hasEmittedToolCalls = true;
716:       }
717:     }
718:     return out;
719:   }
720: 
721:   return new TransformStream<Uint8Array, Uint8Array>({
722:     transform(chunk, controller) {
723:       lineBuffer += decoder.decode(chunk, { stream: true });
724:       const lines = lineBuffer.split("\n");
725:       lineBuffer = lines.pop() ?? "";
726: 
727:       for (const line of lines) {
728:         const trimmed = line.trim();
729:         if (!trimmed || trimmed.startsWith(":")) continue;
730: 
731:         if (trimmed === "data: [DONE]") {
732:           const pending = flushPending();
733:           if (pending) controller.enqueue(encoder.encode(pending));
734:           const finishReason = hasEmittedToolCalls ? "tool_calls" : "stop";
735:           const finishSse = emitFinish(finishReason);
736:           if (finishSse) controller.enqueue(encoder.encode(finishSse));
737:           controller.enqueue(encoder.encode("data: [DONE]\n\n"));
738:           continue;
739:         }
740: 
741:         if (trimmed.startsWith("data: ")) {
742:           try {
743:             const data = JSON.parse(trimmed.slice(6));
744:             if (data.id) streamId = data.id;
745:             if (data.model) streamModel = data.model;
746:             if (data.usage) streamUsage = data.usage;
747: 
748:             const choice = data.choices?.[0];
749:             const content = choice?.delta?.content;
750:             const reasoning = choice?.delta?.reasoning_content;
751:             const toolCalls = choice?.delta?.tool_calls;
752:             const incomingFinishReason = choice?.finish_reason;
753: 
754:             if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
755:               hasEmittedToolCalls = true;
756:               controller.enqueue(encoder.encode(line + "\n\n"));
757:               continue;
758:             }
759: 
760:             if (typeof reasoning === "string" && reasoning.length > 0) {
761:               controller.enqueue(encoder.encode(emitReasoning(reasoning)));
762:             }
763: 
764:             if (typeof content === "string" && content.length > 0) {
765:               const processed = processChunk(content);
766:               if (processed) controller.enqueue(encoder.encode(processed));
767:             }
768: 
769:             if (incomingFinishReason) {
770:               const pending = flushPending();
771:               if (pending) controller.enqueue(encoder.encode(pending));
772:               const finishReason = hasEmittedToolCalls || incomingFinishReason === "tool_calls" ? "tool_calls" : incomingFinishReason;
773:               const finishSse = emitFinish(finishReason);
774:               if (finishSse) controller.enqueue(encoder.encode(finishSse));
775:             }
776:           } catch (err: unknown) {
777:             void err;
778:             // Keep raw non-JSON SSE lines
779:             controller.enqueue(encoder.encode(line + "\n"));
780:           }
781:         }
782:       }
783:     },
784:     flush(controller) {
785:       const pending = flushPending();
786:       if (pending) controller.enqueue(encoder.encode(pending));
787:       const finishReason = hasEmittedToolCalls ? "tool_calls" : "stop";
788:       const finishSse = emitFinish(finishReason);
789:       if (finishSse) controller.enqueue(encoder.encode(finishSse));
790:       if (lineBuffer.length > 0) controller.enqueue(encoder.encode(lineBuffer));
791:     },
792:   });
793: }
794: 
795: // ---------------------------------------------------------------------------
796: // 5. NON-STREAMING RESPONSE HANDLER
797: // ---------------------------------------------------------------------------
798: 
799: export function transformLingResponse(rawResponse: OpenAIResponse | Record<string, unknown>): OpenAIResponse {
800:   const resp = rawResponse as OpenAIResponse;
801:   const choice = resp.choices?.[0];
802:   if (!choice) return resp;
803: 
804:   const rawText = choice.message.content || "";
805:   const { cleanText, toolCalls, reasoningContent } = parseLingXml(rawText);
806: 
807:   const modifiedChoice: OpenAIResponseChoice = {
808:     ...choice,
809:     message: {
810:       ...choice.message,
811:       content: cleanText.length > 0 ? cleanText : null,
812:       reasoning_content: reasoningContent,
813:       tool_calls: toolCalls.length > 0 ? (toolCalls as OpenAIToolCall[]) : undefined,
814:     },
815:     finish_reason: toolCalls.length > 0 ? "tool_calls" : choice.finish_reason || "stop",
816:   };
817: 
818:   return {
819:     ...resp,
820:     choices: [modifiedChoice],
821:   };
822: }
```

## File: src/transformers/nuances.ts
```typescript
  1: export interface OpenAIToolCallFunction {
  2:   readonly name: string;
  3:   readonly arguments: string;
  4: }
  5: 
  6: export interface OpenAIToolCall {
  7:   readonly id: string;
  8:   readonly type: "function";
  9:   readonly function: OpenAIToolCallFunction;
 10:   readonly extra_content?: Record<string, unknown>;
 11: }
 12: 
 13: export interface OpenAIContentPart {
 14:   readonly type: string;
 15:   readonly text?: string;
 16:   readonly [key: string]: unknown;
 17: }
 18: 
 19: export interface OpenAIMessage {
 20:   readonly role: "system" | "user" | "assistant" | "tool";
 21:   readonly content: string | null | readonly OpenAIContentPart[];
 22:   readonly name?: string;
 23:   readonly tool_call_id?: string;
 24:   readonly tool_calls?: readonly OpenAIToolCall[];
 25:   readonly [key: string]: unknown;
 26: }
 27: 
 28: export interface OpenAIRequestPayload {
 29:   readonly model: string;
 30:   readonly messages: readonly OpenAIMessage[];
 31:   readonly stream?: boolean;
 32:   readonly temperature?: number;
 33:   readonly max_tokens?: number;
 34:   readonly thinking?: { readonly budget_tokens?: number };
 35:   readonly thinkingConfig?: { readonly thinkingBudget?: number };
 36:   readonly reasoning_effort?: string;
 37:   readonly tool_choice?: unknown;
 38:   readonly tools?: readonly unknown[];
 39:   readonly [key: string]: unknown;
 40: }
 41: 
 42: function isPartEmpty(part: OpenAIContentPart): boolean {
 43:   if (part.type === "text") {
 44:     return !part.text || part.text.trim().length === 0;
 45:   }
 46:   return false;
 47: }
 48: 
 49: function isArrayContentEmpty(arr: readonly OpenAIContentPart[]): boolean {
 50:   return arr.length === 0 || arr.every(isPartEmpty);
 51: }
 52: 
 53: export function isContentEmpty(
 54:   content: string | null | readonly OpenAIContentPart[] | undefined
 55: ): boolean {
 56:   if (!content) {
 57:     return true;
 58:   }
 59:   if (typeof content === "string") {
 60:     return content.trim().length === 0;
 61:   }
 62:   if (Array.isArray(content)) {
 63:     return isArrayContentEmpty(content);
 64:   }
 65:   return false;
 66: }
 67: 
 68: function patchContentPart(part: OpenAIContentPart): OpenAIContentPart {
 69:   if (part.type === "text" && (!part.text || part.text.trim().length === 0)) {
 70:     return { ...part, text: "." };
 71:   }
 72:   return part;
 73: }
 74: 
 75: function applyDotToArray(
 76:   arr: readonly OpenAIContentPart[]
 77: ): readonly OpenAIContentPart[] {
 78:   if (arr.length === 0) {
 79:     return [{ type: "text", text: "." }];
 80:   }
 81:   return arr.map(patchContentPart);
 82: }
 83: 
 84: export function applyDotPromptToContent(
 85:   content: string | null | readonly OpenAIContentPart[]
 86: ): string | readonly OpenAIContentPart[] {
 87:   if (!content) {
 88:     return ".";
 89:   }
 90:   if (typeof content === "string") {
 91:     return content.trim().length === 0 ? "." : content;
 92:   }
 93:   if (Array.isArray(content)) {
 94:     return applyDotToArray(content);
 95:   }
 96:   return content;
 97: }
 98: 
 99: function patchMessageWithDot(msg: OpenAIMessage): OpenAIMessage {
100:   if (isContentEmpty(msg.content)) {
101:     return {
102:       ...msg,
103:       content: applyDotPromptToContent(msg.content),
104:     };
105:   }
106:   return msg;
107: }
108: 
109: export function applyDotPrompt(
110:   messages: readonly OpenAIMessage[]
111: ): readonly OpenAIMessage[] {
112:   return messages.map(patchMessageWithDot);
113: }
114: 
115: export function cleanGoogle3Nuance(
116:   payload: Record<string, unknown>
117: ): Record<string, unknown> {
118:   const cleaned = { ...payload };
119:   delete cleaned.thinkingConfig;
120:   delete cleaned.thinking_config;
121:   delete cleaned.reasoning_effort;
122:   return cleaned;
123: }
124: 
125: function normalizeToolChoiceOpenAI(toolChoice: unknown): unknown {
126:   if (typeof toolChoice === "string") {
127:     return toolChoice === "any" ? "required" : toolChoice;
128:   }
129:   if (typeof toolChoice === "object" && toolChoice !== null) {
130:     return toolChoice;
131:   }
132:   return "auto";
133: }
134: 
135: function extractFunctionName(obj: unknown): string | null {
136:   if (typeof obj !== "object" || obj === null) {
137:     return null;
138:   }
139:   const record = obj as Record<string, unknown>;
140:   const fnObj = record.function as { name?: string } | undefined;
141:   return fnObj?.name ?? null;
142: }
143: 
144: function normalizeToolChoiceAnthropic(toolChoice: unknown): unknown {
145:   if (toolChoice === "none") {
146:     return undefined;
147:   }
148:   if (toolChoice === "any" || toolChoice === "required") {
149:     return { type: "any" };
150:   }
151:   const fnName = extractFunctionName(toolChoice);
152:   if (fnName) {
153:     return { type: "tool", name: fnName };
154:   }
155:   return { type: "auto" };
156: }
157: 
158: function normalizeToolChoiceGoogle(toolChoice: unknown): unknown {
159:   if (toolChoice === "none") {
160:     return { mode: "NONE" };
161:   }
162:   if (toolChoice === "any" || toolChoice === "required") {
163:     return { mode: "ANY" };
164:   }
165:   const fnName = extractFunctionName(toolChoice);
166:   if (fnName) {
167:     return { mode: "ANY", allowedFunctionNames: [fnName] };
168:   }
169:   return { mode: "AUTO" };
170: }
171: 
172: export function normalizeToolChoice(
173:   toolChoice: unknown,
174:   targetWire: "oa" | "oo" | "cl" | "gg" | "rs" | "ao"
175: ): unknown {
176:   if (toolChoice === undefined || toolChoice === null) {
177:     return undefined;
178:   }
179:   if (targetWire === "cl") {
180:     return normalizeToolChoiceAnthropic(toolChoice);
181:   }
182:   if (targetWire === "gg") {
183:     return normalizeToolChoiceGoogle(toolChoice);
184:   }
185:   return normalizeToolChoiceOpenAI(toolChoice);
186: }
187: 
188: export function applyNuanceModifiers(
189:   payload: OpenAIRequestPayload,
190:   nuances: readonly string[],
191:   targetWire: "oa" | "oo" | "cl" | "gg" | "rs" | "ao" = "oa"
192: ): OpenAIRequestPayload {
193:   let modified: Record<string, unknown> = { ...payload };
194: 
195:   if (nuances.includes("dp")) {
196:     modified.messages = applyDotPrompt(payload.messages);
197:   }
198:   if (nuances.includes("g3")) {
199:     modified = cleanGoogle3Nuance(modified);
200:   }
201:   if (nuances.includes("tc") && payload.tool_choice !== undefined) {
202:     modified.tool_choice = normalizeToolChoice(payload.tool_choice, targetWire);
203:   }
204: 
205:   return modified as unknown as OpenAIRequestPayload;
206: }
```

## File: src/transformers/opencode_adapter.ts
```typescript
  1: import type {
  2:   OpenAIContentPart,
  3:   OpenAIMessage,
  4: } from "./nuances";
  5: import { logFinishReason } from "../ui/logger";
  6: 
  7: export const REASONING_KEYS: readonly string[] = Object.freeze([
  8:   "reasoning",
  9:   "reasoning_content",
 10:   "reasoning_details",
 11:   "reasoningDetails",
 12:   "thought",
 13:   "thoughts",
 14:   "thinking",
 15:   "thinking_content",
 16:   "think",
 17: ]);
 18: 
 19: export function deleteReasoningKeys(target: Record<string, unknown>): void {
 20:   for (const key of REASONING_KEYS) {
 21:     delete target[key];
 22:   }
 23: }
 24: 
 25: export function isOpenCodeClient(
 26:   userAgent?: string | null,
 27:   headers?: Headers | Record<string, string | string[] | undefined> | null,
 28:   nuances?: readonly string[]
 29: ): boolean {
 30:   if (nuances && nuances.includes("ts")) {
 31:     return false;
 32:   }
 33:   if (nuances && nuances.includes("sb")) {
 34:     return true;
 35:   }
 36:   if (userAgent && userAgent.toLowerCase().includes("opencode")) {
 37:     return true;
 38:   }
 39:   if (!headers) {
 40:     return false;
 41:   }
 42:   if (headers instanceof Headers) {
 43:     if (headers.has("x-opencode")) {
 44:       return true;
 45:     }
 46:     const clientName = headers.get("x-client-name");
 47:     return Boolean(clientName && clientName.toLowerCase().includes("opencode"));
 48:   }
 49:   if (headers["x-opencode"] !== undefined) {
 50:     return true;
 51:   }
 52:   const clientName = headers["x-client-name"];
 53:   return typeof clientName === "string" && clientName.toLowerCase().includes("opencode");
 54: }
 55: 
 56: export function hasMeaningfulDeltaFields(delta: Record<string, unknown>): boolean {
 57:   const hasContent = typeof delta.content === "string" && delta.content.length > 0;
 58:   const hasToolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
 59:   const hasRole = typeof delta.role === "string" && delta.role.length > 0;
 60:   const hasRefusal = typeof delta.refusal === "string" && delta.refusal.length > 0;
 61:   const hasFunctionCall = typeof delta.function_call === "object" && delta.function_call !== null;
 62:   return hasContent || hasToolCalls || hasRole || hasRefusal || hasFunctionCall;
 63: }
 64: 
 65: export function sanitizeDelta(rawDelta: unknown): { delta: Record<string, unknown>; hasContent: boolean } {
 66:   if (typeof rawDelta !== "object" || rawDelta === null) {
 67:     return { delta: {}, hasContent: false };
 68:   }
 69:   const delta: Record<string, unknown> = { ...(rawDelta as Record<string, unknown>) };
 70:   deleteReasoningKeys(delta);
 71: 
 72:   if (delta.content === null || delta.content === undefined) {
 73:     delete delta.content;
 74:   }
 75:   if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) {
 76:     delete delta.tool_calls;
 77:   }
 78: 
 79:   return { delta, hasContent: hasMeaningfulDeltaFields(delta) };
 80: }
 81: 
 82: export function filterReasoningFromChoice(
 83:   rawChoice: unknown,
 84:   reqId?: string
 85: ): { choice: Record<string, unknown>; hasData: boolean } {
 86:   if (typeof rawChoice !== "object" || rawChoice === null) {
 87:     return { choice: {}, hasData: false };
 88:   }
 89:   const choice: Record<string, unknown> = { ...(rawChoice as Record<string, unknown>) };
 90:   deleteReasoningKeys(choice);
 91: 
 92:   let hasData = choice.finish_reason !== null && choice.finish_reason !== undefined;
 93:   if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
 94:     logFinishReason(reqId ?? "stream", choice.finish_reason);
 95:   }
 96: 
 97:   if (choice.delta) {
 98:     const { delta, hasContent } = sanitizeDelta(choice.delta);
 99:     choice.delta = delta;
100:     if (hasContent) {
101:       hasData = true;
102:     }
103:   }
104: 
105:   return { choice, hasData };
106: }
107: 
108: function processChoices(
109:   rawChoices: readonly unknown[],
110:   reqId?: string
111: ): { choices: Record<string, unknown>[]; hasChoiceData: boolean } {
112:   const choices: Record<string, unknown>[] = [];
113:   let hasChoiceData = false;
114:   for (const rawChoice of rawChoices) {
115:     const { choice, hasData } = filterReasoningFromChoice(rawChoice, reqId);
116:     if (hasData) {
117:       hasChoiceData = true;
118:     }
119:     choices.push(choice);
120:   }
121:   return { choices, hasChoiceData };
122: }
123: 
124: export function filterReasoningFromChunk(
125:   data: Record<string, unknown>,
126:   reqId?: string
127: ): {
128:   filteredData: Record<string, unknown>;
129:   shouldEmit: boolean;
130: } {
131:   const filtered: Record<string, unknown> = { ...data };
132:   deleteReasoningKeys(filtered);
133: 
134:   let shouldEmit = filtered.usage != null || filtered.error != null;
135: 
136:   if (Array.isArray(filtered.choices)) {
137:     const { choices, hasChoiceData } = processChoices(filtered.choices, reqId);
138:     filtered.choices = choices;
139:     if (hasChoiceData) {
140:       shouldEmit = true;
141:     }
142:   }
143: 
144:   return { filteredData: filtered, shouldEmit };
145: }
146: 
147: export function sanitizeRawControlChars(rawJsonStr: string): string {
148:   return rawJsonStr.replace(/\r/g, "\\r");
149: }
150: 
151: export function createSyntheticHeartbeatChunk(): string {
152:   const heartbeatPayload = {
153:     id: "chatcmpl-heartbeat",
154:     object: "chat.completion.chunk",
155:     created: Math.floor(Date.now() / 1000),
156:     model: "heartbeat",
157:     choices: [
158:       {
159:         index: 0,
160:         delta: {},
161:         finish_reason: null,
162:       },
163:     ],
164:   };
165:   return `data: ${JSON.stringify(heartbeatPayload)}\n\n`;
166: }
167: 
168: function extractJsonFromSseLine(trimmed: string): string {
169:   return trimmed.slice(5).trim();
170: }
171: 
172: export function processSseDataLine(line: string, reqId?: string): string | null {
173:   const jsonStr = extractJsonFromSseLine(line);
174:   try {
175:     const sanitized = sanitizeRawControlChars(jsonStr);
176:     const data = JSON.parse(sanitized) as Record<string, unknown>;
177:     const { filteredData, shouldEmit } = filterReasoningFromChunk(data, reqId);
178:     if (!shouldEmit) {
179:       return null;
180:     }
181:     return `data: ${JSON.stringify(filteredData)}`;
182:   } catch (_err: unknown) {
183:     void _err;
184:     return line;
185:   }
186: }
187: 
188: export const FILTER_HEARTBEAT_INTERVAL_MS = 5000;
189: 
190: export interface FilterTransformerState {
191:   lastEmittedTime: number;
192:   readonly reqId?: string;
193: }
194: 
195: function handleSuppressedChunk(
196:   state: FilterTransformerState,
197:   controller: TransformStreamDefaultController<Uint8Array>,
198:   encoder: TextEncoder
199: ): void {
200:   const now = Date.now();
201:   if (now - state.lastEmittedTime >= FILTER_HEARTBEAT_INTERVAL_MS) {
202:     controller.enqueue(encoder.encode(createSyntheticHeartbeatChunk()));
203:     state.lastEmittedTime = now;
204:   }
205: }
206: 
207: function handleDataLine(
208:   trimmed: string,
209:   state: FilterTransformerState,
210:   controller: TransformStreamDefaultController<Uint8Array>,
211:   encoder: TextEncoder
212: ): void {
213:   const transformed = processSseDataLine(trimmed, state.reqId);
214:   if (transformed) {
215:     controller.enqueue(encoder.encode(transformed + "\n\n"));
216:     state.lastEmittedTime = Date.now();
217:   } else {
218:     handleSuppressedChunk(state, controller, encoder);
219:   }
220: }
221: 
222: function handleSseLine(
223:   line: string,
224:   state: FilterTransformerState,
225:   controller: TransformStreamDefaultController<Uint8Array>,
226:   encoder: TextEncoder
227: ): void {
228:   const trimmed = line.trim();
229:   if (!trimmed) {
230:     return;
231:   }
232: 
233:   if (trimmed.startsWith(":")) {
234:     controller.enqueue(encoder.encode(trimmed + "\n\n"));
235:     controller.enqueue(encoder.encode(createSyntheticHeartbeatChunk()));
236:     state.lastEmittedTime = Date.now();
237:     return;
238:   }
239: 
240:   if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
241:     controller.enqueue(encoder.encode("data: [DONE]\n\n"));
242:     state.lastEmittedTime = Date.now();
243:     return;
244:   }
245: 
246:   if (trimmed.startsWith("data:")) {
247:     handleDataLine(trimmed, state, controller, encoder);
248:     return;
249:   }
250: 
251:   controller.enqueue(encoder.encode(trimmed + "\n\n"));
252:   state.lastEmittedTime = Date.now();
253: }
254: 
255: function flushRemainingBuffer(
256:   lineBuffer: string,
257:   state: FilterTransformerState,
258:   controller: TransformStreamDefaultController<Uint8Array>,
259:   encoder: TextEncoder
260: ): void {
261:   const trimmed = lineBuffer.trim();
262:   if (!trimmed) {
263:     return;
264:   }
265:   if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
266:     const transformed = processSseDataLine(trimmed, state.reqId);
267:     if (transformed) {
268:       controller.enqueue(encoder.encode(transformed + "\n\n"));
269:       state.lastEmittedTime = Date.now();
270:     }
271:     return;
272:   }
273:   controller.enqueue(encoder.encode(trimmed + "\n\n"));
274:   state.lastEmittedTime = Date.now();
275: }
276: 
277: export function createOpenCodeReasoningFilterStreamTransformer(
278:   reqId?: string
279: ): TransformStream<Uint8Array, Uint8Array> {
280:   const decoder = new TextDecoder("utf-8", { fatal: false });
281:   const encoder = new TextEncoder();
282:   let lineBuffer = "";
283:   const state: FilterTransformerState = {
284:     lastEmittedTime: Date.now(),
285:     reqId,
286:   };
287: 
288:   return new TransformStream<Uint8Array, Uint8Array>({
289:     transform(chunk, controller) {
290:       lineBuffer += decoder.decode(chunk, { stream: true });
291:       const lines = lineBuffer.split("\n");
292:       lineBuffer = lines.pop() ?? "";
293: 
294:       for (const line of lines) {
295:         handleSseLine(line, state, controller, encoder);
296:       }
297:     },
298:     flush(controller) {
299:       if (lineBuffer.length > 0) {
300:         flushRemainingBuffer(lineBuffer, state, controller, encoder);
301:         lineBuffer = "";
302:       }
303:     },
304:   });
305: }
306: 
307: function stripReasoningFromChoiceObject(choice: Record<string, unknown>): void {
308:   deleteReasoningKeys(choice);
309:   if (choice.message && typeof choice.message === "object" && choice.message !== null) {
310:     deleteReasoningKeys(choice.message as Record<string, unknown>);
311:   }
312:   if (choice.delta && typeof choice.delta === "object" && choice.delta !== null) {
313:     deleteReasoningKeys(choice.delta as Record<string, unknown>);
314:   }
315: }
316: 
317: export function stripReasoningFromResponseBody(json: Record<string, unknown>): void {
318:   deleteReasoningKeys(json);
319:   if (!Array.isArray(json.choices)) {
320:     return;
321:   }
322:   for (const rawChoice of json.choices as Array<Record<string, unknown>>) {
323:     if (typeof rawChoice === "object" && rawChoice !== null) {
324:       stripReasoningFromChoiceObject(rawChoice);
325:     }
326:   }
327: }
328: 
329: function isReasoningContentPart(part: OpenAIContentPart | Record<string, unknown>): boolean {
330:   if (typeof part !== "object" || part === null) {
331:     return false;
332:   }
333:   const partType = typeof part.type === "string" ? part.type.toLowerCase() : "";
334:   if (partType === "reasoning" || partType === "thought" || partType === "thinking") {
335:     return true;
336:   }
337:   return (
338:     part.reasoningDetails !== undefined ||
339:     part.reasoning_details !== undefined ||
340:     part.reasoningField !== undefined ||
341:     part.reasoning_field !== undefined ||
342:     part.reasoning !== undefined ||
343:     part.thought !== undefined ||
344:     part.thinking !== undefined
345:   );
346: }
347: 
348: function normalizeCleanedParts(
349:   parts: readonly OpenAIContentPart[]
350: ): string | readonly OpenAIContentPart[] {
351:   if (parts.length === 0) {
352:     return "";
353:   }
354:   const first = parts[0];
355:   if (parts.length === 1 && first && first.type === "text" && typeof first.text === "string") {
356:     return first.text;
357:   }
358:   return parts;
359: }
360: 
361: function extractToolPartText(part: unknown): string {
362:   if (typeof part === "string") {
363:     return part;
364:   }
365:   if (typeof part === "object" && part !== null) {
366:     const textVal = (part as Record<string, unknown>).text;
367:     if (typeof textVal === "string" && textVal.length > 0) {
368:       return textVal;
369:     }
370:     return JSON.stringify(part);
371:   }
372:   return String(part ?? "");
373: }
374: 
375: export function normalizeToolContent(content: unknown): string {
376:   if (Array.isArray(content)) {
377:     return content.map(extractToolPartText).join("\n");
378:   }
379:   if (typeof content === "string") {
380:     return content;
381:   }
382:   if (content === null || content === undefined) {
383:     return "";
384:   }
385:   return String(content);
386: }
387: 
388: export function stripToolMetadata(cleaned: Record<string, unknown>): void {
389:   delete cleaned.id;
390:   delete cleaned.name;
391:   delete cleaned.providerState;
392:   delete cleaned.state;
393:   delete cleaned.createdAt;
394: }
395: 
396: export function stripClientMetadata(cleaned: Record<string, unknown>): void {
397:   delete cleaned.id;
398:   delete cleaned.providerState;
399:   delete cleaned.state;
400:   delete cleaned.reasoning_details;
401: }
402: 
403: function scrubMessageContent(cleaned: Record<string, unknown>): void {
404:   if (cleaned.role === "tool") {
405:     cleaned.content = normalizeToolContent(cleaned.content);
406:     stripToolMetadata(cleaned);
407:     return;
408:   }
409: 
410:   if (cleaned.role === "assistant" || cleaned.role === "user") {
411:     stripClientMetadata(cleaned);
412:   }
413: 
414:   if (cleaned.role === "assistant" && typeof cleaned.content === "string") {
415:     let content = cleaned.content
416:       .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "");
417:     if (Array.isArray(cleaned.tool_calls) && cleaned.tool_calls.length > 0) {
418:       content = content
419:         .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
420:         .replace(/<invoke[\s\S]*?<\/invoke>/gi, "")
421:         .replace(/<function=[a-zA-Z0-9_\-]+>[\s\S]*?<\/function>/gi, "")
422:         .replace(/(?:^|[^\w>])[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>\s*(?:<\/tool_call>)?/gi, "");
423:     }
424:     content = content
425:       .replace(/<\/?(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function|parameter|arg_key|arg_value|parameter_value|argument_name|argument_value|parameter_name|tool_response|tool_result|role)[^>]*>/gi, "")
426:       .trim();
427:     cleaned.content = content;
428:   }
429: 
430:   if (Array.isArray(cleaned.content)) {
431:     const rawParts = cleaned.content as readonly OpenAIContentPart[];
432:     const nonReasoningParts = rawParts.filter((p) => !isReasoningContentPart(p));
433:     cleaned.content = normalizeCleanedParts(nonReasoningParts);
434:   }
435: }
436: 
437: export function scrubReasoningFromMessage(msg: OpenAIMessage): OpenAIMessage {
438:   const cleaned: Record<string, unknown> = { ...msg };
439: 
440:   deleteReasoningKeys(cleaned);
441:   scrubMessageContent(cleaned);
442: 
443:   return cleaned as unknown as OpenAIMessage;
444: }
445: 
446: export function scrubReasoningFromMessages(
447:   messages: readonly OpenAIMessage[] | undefined
448: ): readonly OpenAIMessage[] {
449:   if (!Array.isArray(messages)) {
450:     return [];
451:   }
452:   return messages.map(scrubReasoningFromMessage);
453: }
```

## File: src/transformers/payload.ts
```typescript
  1: import type {
  2:   OpenAIContentPart,
  3:   OpenAIMessage,
  4:   OpenAIRequestPayload,
  5: } from "./nuances";
  6: import { applyNuanceModifiers } from "./nuances";
  7: import { serializeDotsToolHistory, injectToolsSchemaSystemPrompt } from "./dots";
  8: import { transformLingRequest } from "./ling";
  9: import {
 10:   injectThoughtSignatures,
 11:   shouldStripReasoning,
 12:   stripReasoningParameters,
 13: } from "./thinking";
 14: import {
 15:   normalizeToolContent,
 16:   stripClientMetadata,
 17:   stripToolMetadata,
 18:   scrubReasoningFromMessage,
 19:   scrubReasoningFromMessages,
 20: } from "./opencode_adapter";
 21: import {
 22:   DEFAULT_SAFE_CONTEXT_TOKENS,
 23:   DEFAULT_MAX_CONTEXT_TOKENS,
 24:   estimateTextTokens,
 25:   estimateAnthropicTokens,
 26:   estimateOpenAITokens,
 27:   isContextLengthError,
 28:   extractContextLimit,
 29:   pruneAnthropicPayload,
 30:   pruneOpenAIPayload,
 31: } from "./context_pruner";
 32: 
 33: export {
 34:   normalizeToolContent,
 35:   stripClientMetadata,
 36:   stripToolMetadata,
 37:   scrubReasoningFromMessage,
 38:   scrubReasoningFromMessages,
 39:   DEFAULT_SAFE_CONTEXT_TOKENS,
 40:   DEFAULT_MAX_CONTEXT_TOKENS,
 41:   estimateTextTokens,
 42:   estimateAnthropicTokens,
 43:   estimateOpenAITokens,
 44:   isContextLengthError,
 45:   extractContextLimit,
 46:   pruneAnthropicPayload,
 47:   pruneOpenAIPayload,
 48: };
 49: 
 50: export interface ModelCapabilities {
 51:   readonly supportsThinking?: boolean;
 52:   readonly supportsTools?: boolean;
 53:   readonly supportsSystemMessage?: boolean;
 54:   readonly maxContextTokens?: number;
 55: }
 56: 
 57: export interface PayloadTransformOptions {
 58:   readonly nuances?: readonly string[];
 59:   readonly targetWire?: "oa" | "oo" | "cl" | "gg" | "rs" | "ao";
 60:   readonly globalStripReasoning?: boolean;
 61:   readonly aoStripReasoning?: boolean;
 62:   readonly capabilities?: ModelCapabilities;
 63:   readonly enableScrubbing?: boolean;
 64: }
 65: 
 66: const LATEX_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
 67:   [/\\times\b/g, "×"],
 68:   [/\\rightarrow\b/g, "→"],
 69:   [/\\leftarrow\b/g, "←"],
 70:   [/\\leq\b/g, "≤"],
 71:   [/\\geq\b/g, "≥"],
 72:   [/\\neq\b/g, "≠"],
 73:   [/\\approx\b/g, "≈"],
 74:   [/\\pm\b/g, "±"],
 75:   [/\\infty\b/g, "∞"],
 76:   [/\\cdot\b/g, "·"],
 77:   [/\\alpha\b/g, "α"],
 78:   [/\\beta\b/g, "β"],
 79:   [/\\theta\b/g, "θ"],
 80:   [/\\pi\b/g, "π"],
 81:   [/\\mu\b/g, "μ"],
 82:   [/\\sigma\b/g, "σ"],
 83:   [/\\Delta\b/g, "Δ"],
 84:   [/\\Omega\b/g, "Ω"],
 85: ];
 86: 
 87: export function normalizeLatex(text: string): string {
 88:   let normalized = text;
 89:   for (const [pattern, replacement] of LATEX_REPLACEMENTS) {
 90:     normalized = normalized.replace(pattern, replacement);
 91:   }
 92:   return normalized;
 93: }
 94: 
 95: function normalizePartLatex(part: OpenAIContentPart): OpenAIContentPart {
 96:   if (part.type === "text" && typeof part.text === "string") {
 97:     return { ...part, text: normalizeLatex(part.text) };
 98:   }
 99:   return part;
100: }
101: 
102: function normalizeMessageLatex(msg: OpenAIMessage): OpenAIMessage {
103:   if (typeof msg.content === "string") {
104:     return { ...msg, content: normalizeLatex(msg.content) };
105:   }
106:   if (Array.isArray(msg.content)) {
107:     return { ...msg, content: msg.content.map(normalizePartLatex) };
108:   }
109:   return msg;
110: }
111: 
112: export function applyLatexNormalization(
113:   messages: readonly OpenAIMessage[]
114: ): readonly OpenAIMessage[] {
115:   return messages.map(normalizeMessageLatex);
116: }
117: 
118: function extractSystemText(msg: OpenAIMessage): string {
119:   if (typeof msg.content === "string") {
120:     return msg.content;
121:   }
122:   if (Array.isArray(msg.content)) {
123:     return msg.content
124:       .filter((p) => p.type === "text" && typeof p.text === "string")
125:       .map((p) => p.text)
126:       .join("\n");
127:   }
128:   return "";
129: }
130: 
131: function prependSystemContext(
132:   systemText: string,
133:   userMsg: OpenAIMessage
134: ): OpenAIMessage {
135:   const prefix = `[System Context: ${systemText}]\n\n`;
136:   if (typeof userMsg.content === "string") {
137:     return { ...userMsg, content: `${prefix}${userMsg.content}` };
138:   }
139:   if (Array.isArray(userMsg.content)) {
140:     const textPart: OpenAIContentPart = { type: "text", text: prefix };
141:     return { ...userMsg, content: [textPart, ...userMsg.content] };
142:   }
143:   return { ...userMsg, content: prefix };
144: }
145: 
146: function mergeSystemIntoUserMessages(
147:   messages: readonly OpenAIMessage[]
148: ): readonly OpenAIMessage[] {
149:   const systemMessages = messages.filter((m) => m.role === "system");
150:   if (systemMessages.length === 0) {
151:     return messages;
152:   }
153: 
154:   const combinedSystemText = systemMessages.map(extractSystemText).join("\n\n");
155:   const nonSystem = messages.filter((m) => m.role !== "system");
156: 
157:   const firstUserIdx = nonSystem.findIndex((m) => m.role === "user");
158:   if (firstUserIdx === -1) {
159:     const newFirstUser: OpenAIMessage = {
160:       role: "user",
161:       content: `[System Context: ${combinedSystemText}]`,
162:     };
163:     return [newFirstUser, ...nonSystem];
164:   }
165: 
166:   return nonSystem.map((msg, idx) => {
167:     if (idx === firstUserIdx) {
168:       return prependSystemContext(combinedSystemText, msg);
169:     }
170:     return msg;
171:   });
172: }
173: 
174: function toContentParts(c: string | null | readonly OpenAIContentPart[]): readonly OpenAIContentPart[] {
175:   if (Array.isArray(c)) {
176:     return c;
177:   }
178:   const s = typeof c === "string" ? c : "";
179:   return [{ type: "text", text: s }];
180: }
181: 
182: function mergeTwoContents(
183:   c1: string | null | readonly OpenAIContentPart[],
184:   c2: string | null | readonly OpenAIContentPart[]
185: ): string | readonly OpenAIContentPart[] {
186:   if (typeof c1 === "string" && typeof c2 === "string") {
187:     return `${c1}\n\n${c2}`.trim();
188:   }
189:   const parts1 = toContentParts(c1);
190:   const parts2 = toContentParts(c2);
191:   return [...parts1, ...parts2];
192: }
193: 
194: function mergeTwoMessages(m1: OpenAIMessage, m2: OpenAIMessage): OpenAIMessage {
195:   const mergedContent = mergeTwoContents(m1.content, m2.content);
196:   const toolCalls = [...(m1.tool_calls ?? []), ...(m2.tool_calls ?? [])];
197:   return {
198:     ...m1,
199:     content: mergedContent,
200:     tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
201:   };
202: }
203: 
204: function stepMergeConsecutive(
205:   acc: OpenAIMessage[],
206:   current: OpenAIMessage,
207:   next: OpenAIMessage
208: ): OpenAIMessage {
209:   if (current.role === next.role) {
210:     return mergeTwoMessages(current, next);
211:   }
212:   acc.push(current);
213:   return next;
214: }
215: 
216: export function mergeConsecutiveMessages(
217:   messages: readonly OpenAIMessage[]
218: ): readonly OpenAIMessage[] {
219:   if (messages.length <= 1) {
220:     return messages;
221:   }
222: 
223:   const result: OpenAIMessage[] = [];
224:   let current: OpenAIMessage = messages[0] as OpenAIMessage;
225: 
226:   for (let i = 1; i < messages.length; i += 1) {
227:     const next = messages[i] as OpenAIMessage;
228:     current = stepMergeConsecutive(result, current, next);
229:   }
230: 
231:   result.push(current);
232:   return result;
233: }
234: 
235: export function applyGemmaConstraints(
236:   messages: readonly OpenAIMessage[]
237: ): readonly OpenAIMessage[] {
238:   const withoutSystem = mergeSystemIntoUserMessages(messages);
239:   return mergeConsecutiveMessages(withoutSystem);
240: }
241: 
242: function scrubGemmaParameters(
243:   payload: Record<string, unknown>
244: ): Record<string, unknown> {
245:   const cleaned = { ...payload };
246:   delete cleaned.presence_penalty;
247:   delete cleaned.frequency_penalty;
248:   delete cleaned.logit_bias;
249:   delete cleaned.thinkingConfig;
250:   return cleaned;
251: }
252: 
253: export function scrubUnsupportedParameters(
254:   payload: OpenAIRequestPayload,
255:   capabilities?: ModelCapabilities,
256:   enableScrubbing = false
257: ): OpenAIRequestPayload {
258:   const cleaned: Record<string, unknown> = { ...payload };
259:   delete cleaned.prompt_cache_key;
260:   delete cleaned.prompt_cache_retrieval;
261:   delete cleaned.prompt_cache_reset;
262: 
263:   if (typeof cleaned.max_tokens === "number" && cleaned.max_tokens > 65536) {
264:     cleaned.max_tokens = 65536;
265:   }
266: 
267:   if (!enableScrubbing) {
268:     return cleaned as unknown as OpenAIRequestPayload;
269:   }
270: 
271:   if (capabilities && !capabilities.supportsThinking) {
272:     delete cleaned.thinking;
273:     delete cleaned.thinkingConfig;
274:     delete cleaned.thinking_config;
275:     delete cleaned.reasoning_effort;
276:   }
277:   if (capabilities && !capabilities.supportsTools) {
278:     delete cleaned.tools;
279:     delete cleaned.tool_choice;
280:   }
281:   return cleaned as unknown as OpenAIRequestPayload;
282: }
283: 
284: function transformMessages(
285:   messages: readonly OpenAIMessage[],
286:   nuances: readonly string[],
287:   model?: string,
288:   tools?: readonly unknown[]
289: ): readonly OpenAIMessage[] {
290:   let res = scrubReasoningFromMessages(messages);
291:   res = applyLatexNormalization(res);
292:   if (nuances.includes("gm")) {
293:     res = applyGemmaConstraints(res);
294:   }
295:   if (nuances.includes("ts")) {
296:     res = injectThoughtSignatures(res);
297:   }
298:   if (
299:     nuances.includes("tc") ||
300:     (model && model.toLowerCase().includes("dots"))
301:   ) {
302:     res = injectToolsSchemaSystemPrompt(res, tools);
303:     res = serializeDotsToolHistory(res);
304:     res = mergeConsecutiveMessages(res);
305:   }
306:   return res;
307: }
308: 
309: function applyReasoningStripIfNeeded(
310:   payload: Record<string, unknown>,
311:   globalStrip: boolean,
312:   nuances: readonly string[],
313:   targetWire?: string,
314:   aoStripReasoning?: boolean
315: ): Record<string, unknown> {
316:   if (shouldStripReasoning(globalStrip, nuances, targetWire, aoStripReasoning)) {
317:     return stripReasoningParameters(payload);
318:   }
319:   return payload;
320: }
321: 
322: export function sanitizeAndTransformPayload(
323:   payload: OpenAIRequestPayload,
324:   options: PayloadTransformOptions = {}
325: ): OpenAIRequestPayload {
326:   const nuances = options.nuances ?? [];
327:   const targetWire = options.targetWire ?? "oa";
328:   const globalStrip = options.globalStripReasoning ?? false;
329:   const aoStripReasoning = options.aoStripReasoning;
330:   const enableScrubbing = options.enableScrubbing ?? false;
331: 
332:   let currentPayload = payload;
333:   const isLing =
334:     nuances.includes("lg") ||
335:     (Boolean(payload.model && payload.model.toLowerCase().includes("ling")) && !nuances.includes("tc") && !nuances.includes("no"));
336: 
337:   if (isLing) {
338:     currentPayload = transformLingRequest(currentPayload);
339:   }
340: 
341:   const transformedMessages = transformMessages(
342:     currentPayload.messages,
343:     nuances,
344:     currentPayload.model,
345:     currentPayload.tools as readonly unknown[] | undefined
346:   );
347:   let transformed: Record<string, unknown> = { ...currentPayload, messages: transformedMessages };
348: 
349:   if (enableScrubbing && nuances.includes("gm")) {
350:     transformed = scrubGemmaParameters(transformed);
351:   }
352: 
353:   const withModifiers = applyNuanceModifiers(
354:     transformed as unknown as OpenAIRequestPayload,
355:     nuances,
356:     targetWire
357:   );
358:   const finalPayload = (enableScrubbing || targetWire === "ao")
359:     ? applyReasoningStripIfNeeded(
360:         withModifiers as unknown as Record<string, unknown>,
361:         globalStrip,
362:         nuances,
363:         targetWire,
364:         aoStripReasoning
365:       )
366:     : withModifiers;
367: 
368:   return scrubUnsupportedParameters(
369:     finalPayload as unknown as OpenAIRequestPayload,
370:     options.capabilities,
371:     enableScrubbing
372:   );
373: }
374: 
375: export function cleanOpenAIBody(
376:   body: OpenAIRequestPayload,
377:   options?: PayloadTransformOptions
378: ): OpenAIRequestPayload {
379:   return sanitizeAndTransformPayload(body, options);
380: }
```

## File: src/transformers/responses.ts
```typescript
  1: import type { OpenAIRequestPayload } from "./nuances";
  2: 
  3: export interface ResponsesUsage {
  4:   input_tokens?: number;
  5:   output_tokens?: number;
  6:   total_tokens?: number;
  7:   input_tokens_details?: {
  8:     cached_tokens?: number;
  9:   };
 10:   output_tokens_details?: {
 11:     reasoning_tokens?: number;
 12:   };
 13: }
 14: 
 15: export interface ResponsesOutputItem {
 16:   id?: string;
 17:   type: string;
 18:   status?: string;
 19:   role?: string;
 20:   content?: Array<{
 21:     type: string;
 22:     text?: string;
 23:     annotations?: unknown[];
 24:     logprobs?: unknown[];
 25:   }>;
 26:   encrypted_content?: string;
 27:   summary?: unknown[];
 28: }
 29: 
 30: export interface ResponsesResponsePayload {
 31:   id: string;
 32:   object?: string;
 33:   created_at?: number;
 34:   completed_at?: number;
 35:   status?: string;
 36:   model?: string;
 37:   output?: ResponsesOutputItem[];
 38:   output_text?: string;
 39:   usage?: ResponsesUsage;
 40:   cost?: string;
 41:   error?: unknown;
 42: }
 43: 
 44: export interface OpenAIChatCompletionChoice {
 45:   index: number;
 46:   message: {
 47:     role: "assistant";
 48:     content: string | null;
 49:     reasoning_content?: string;
 50:   };
 51:   finish_reason: string;
 52: }
 53: 
 54: export interface OpenAIChatCompletion {
 55:   id: string;
 56:   object: "chat.completion";
 57:   created: number;
 58:   model: string;
 59:   choices: OpenAIChatCompletionChoice[];
 60:   usage?: {
 61:     prompt_tokens: number;
 62:     completion_tokens: number;
 63:     total_tokens: number;
 64:     completion_tokens_details?: {
 65:       reasoning_tokens?: number;
 66:     };
 67:   };
 68: }
 69: 
 70: /**
 71:  * Transforms an OpenAI chat completions payload into a Responses API payload.
 72:  */
 73: export function transformOpenAiToResponses(
 74:   payload: OpenAIRequestPayload | Record<string, unknown>
 75: ): Record<string, unknown> {
 76:   const model = typeof payload.model === "string" ? payload.model : "";
 77:   const messages = Array.isArray(payload.messages) ? payload.messages : [];
 78: 
 79:   const input = messages.map((m) => {
 80:     let content = "";
 81:     if (typeof m.content === "string") {
 82:       content = m.content;
 83:     } else if (Array.isArray(m.content)) {
 84:       content = m.content
 85:         .map((part: unknown) => {
 86:           if (typeof part === "object" && part !== null && "text" in part) {
 87:             return String((part as { text?: unknown }).text ?? "");
 88:           }
 89:           return "";
 90:         })
 91:         .join("");
 92:     }
 93:     return {
 94:       role: m.role || "user",
 95:       content,
 96:     };
 97:   });
 98: 
 99:   const responsesPayload: Record<string, unknown> = {
100:     model,
101:     input,
102:   };
103: 
104:   if (typeof payload.stream === "boolean") {
105:     responsesPayload.stream = payload.stream;
106:   }
107:   if (typeof payload.temperature === "number") {
108:     responsesPayload.temperature = payload.temperature;
109:   }
110:   if (typeof payload.top_p === "number") {
111:     responsesPayload.top_p = payload.top_p;
112:   }
113:   if (typeof payload.max_tokens === "number") {
114:     responsesPayload.max_output_tokens = payload.max_tokens;
115:   }
116:   if (typeof payload.reasoning_effort === "string") {
117:     responsesPayload.reasoning = { effort: payload.reasoning_effort };
118:   }
119: 
120:   return responsesPayload;
121: }
122: 
123: /**
124:  * Transforms a Responses API non-streaming JSON response into standard OpenAI chat.completion format.
125:  */
126: export function transformResponsesToOpenAi(
127:   responsesObj: Record<string, unknown>,
128:   requestedModel?: string
129: ): OpenAIChatCompletion {
130:   const id = typeof responsesObj.id === "string" ? responsesObj.id : `resp_${Date.now()}`;
131:   const created = typeof responsesObj.created_at === "number"
132:     ? responsesObj.created_at
133:     : Math.floor(Date.now() / 1000);
134:   const model = (typeof responsesObj.model === "string" && responsesObj.model)
135:     ? responsesObj.model
136:     : (requestedModel || "unknown");
137: 
138:   let contentText = "";
139:   if (typeof responsesObj.output_text === "string") {
140:     contentText = responsesObj.output_text;
141:   } else if (Array.isArray(responsesObj.output)) {
142:     for (const item of responsesObj.output as ResponsesOutputItem[]) {
143:       if (item.type === "message" && Array.isArray(item.content)) {
144:         for (const part of item.content) {
145:           if (part.type === "output_text" && typeof part.text === "string") {
146:             contentText += part.text;
147:           } else if (typeof part.text === "string") {
148:             contentText += part.text;
149:           }
150:         }
151:       }
152:     }
153:   }
154: 
155:   let promptTokens = 0;
156:   let completionTokens = 0;
157:   let totalTokens = 0;
158:   let reasoningTokens: number | undefined;
159: 
160:   if (responsesObj.usage && typeof responsesObj.usage === "object") {
161:     const u = responsesObj.usage as ResponsesUsage;
162:     promptTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
163:     completionTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
164:     totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
165: 
166:     if (u.output_tokens_details && typeof u.output_tokens_details.reasoning_tokens === "number") {
167:       reasoningTokens = u.output_tokens_details.reasoning_tokens;
168:     }
169:   }
170: 
171:   const result: OpenAIChatCompletion = {
172:     id,
173:     object: "chat.completion",
174:     created,
175:     model,
176:     choices: [
177:       {
178:         index: 0,
179:         message: {
180:           role: "assistant",
181:           content: contentText,
182:         },
183:         finish_reason: "stop",
184:       },
185:     ],
186:   };
187: 
188:   if (responsesObj.usage) {
189:     result.usage = {
190:       prompt_tokens: promptTokens,
191:       completion_tokens: completionTokens,
192:       total_tokens: totalTokens,
193:       ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
194:     };
195:   }
196: 
197:   return result;
198: }
199: 
200: /**
201:  * Creates a TransformStream that converts an incoming SSE stream from Responses API
202:  * to standard OpenAI chat.completion.chunk SSE stream.
203:  */
204: export function createResponsesStreamTransformer(
205:   requestedModel?: string
206: ): TransformStream<Uint8Array, Uint8Array> {
207:   const decoder = new TextDecoder();
208:   const encoder = new TextEncoder();
209: 
210:   let lineBuffer = "";
211:   let currentEvent = "";
212:   let streamId = `chatcmpl_${Date.now()}`;
213:   let streamModel = requestedModel || "unknown";
214:   let streamCreated = Math.floor(Date.now() / 1000);
215:   let hasEmittedRole = false;
216:   let hasEmittedFinish = false;
217: 
218:   function sse(payload: Record<string, unknown>): string {
219:     return `data: ${JSON.stringify(payload)}\n\n`;
220:   }
221: 
222:   function emitRoleHeader(): string {
223:     if (!hasEmittedRole) {
224:       hasEmittedRole = true;
225:       return sse({
226:         id: streamId,
227:         object: "chat.completion.chunk",
228:         created: streamCreated,
229:         model: streamModel,
230:         choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
231:       });
232:     }
233:     return "";
234:   }
235: 
236:   function emitContentDelta(text: string): string {
237:     let out = emitRoleHeader();
238:     out += sse({
239:       id: streamId,
240:       object: "chat.completion.chunk",
241:       created: streamCreated,
242:       model: streamModel,
243:       choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
244:     });
245:     return out;
246:   }
247: 
248:   function emitFinish(usage?: ResponsesUsage): string {
249:     if (hasEmittedFinish) return "";
250:     hasEmittedFinish = true;
251:     let out = emitRoleHeader();
252: 
253:     const chunk: Record<string, unknown> = {
254:       id: streamId,
255:       object: "chat.completion.chunk",
256:       created: streamCreated,
257:       model: streamModel,
258:       choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
259:     };
260: 
261:     if (usage && typeof usage === "object") {
262:       const promptTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
263:       const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
264:       const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
265:       const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;
266: 
267:       chunk.usage = {
268:         prompt_tokens: promptTokens,
269:         completion_tokens: completionTokens,
270:         total_tokens: totalTokens,
271:         ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
272:       };
273:     }
274: 
275:     out += sse(chunk);
276:     out += "data: [DONE]\n\n";
277:     return out;
278:   }
279: 
280:   function handleSseMessage(event: string, dataStr: string): string {
281:     if (!dataStr || dataStr.trim() === "[DONE]") {
282:       return emitFinish();
283:     }
284: 
285:     let parsed: Record<string, unknown>;
286:     try {
287:       parsed = JSON.parse(dataStr);
288:     } catch {
289:       return "";
290:     }
291: 
292:     const eventType = event || (typeof parsed.type === "string" ? parsed.type : "");
293: 
294:     if (eventType === "response.created" || eventType === "response.in_progress") {
295:       const resp = parsed.response as Record<string, unknown> | undefined;
296:       if (resp) {
297:         if (typeof resp.id === "string") streamId = resp.id;
298:         if (typeof resp.model === "string") streamModel = resp.model;
299:         if (typeof resp.created_at === "number") streamCreated = resp.created_at;
300:       }
301:       return "";
302:     }
303: 
304:     if (eventType === "response.output_text.delta") {
305:       const delta = typeof parsed.delta === "string" ? parsed.delta : "";
306:       if (delta) {
307:         return emitContentDelta(delta);
308:       }
309:       return "";
310:     }
311: 
312:     if (eventType === "response.completed") {
313:       const resp = parsed.response as Record<string, unknown> | undefined;
314:       if (resp) {
315:         if (typeof resp.id === "string") streamId = resp.id;
316:         if (typeof resp.model === "string") streamModel = resp.model;
317:         if (typeof resp.created_at === "number") streamCreated = resp.created_at;
318:         return emitFinish(resp.usage as ResponsesUsage | undefined);
319:       }
320:       return emitFinish();
321:     }
322: 
323:     return "";
324:   }
325: 
326:   return new TransformStream<Uint8Array, Uint8Array>({
327:     transform(chunk, controller) {
328:       lineBuffer += decoder.decode(chunk, { stream: true });
329:       const lines = lineBuffer.split("\n");
330:       lineBuffer = lines.pop() ?? "";
331: 
332:       for (const rawLine of lines) {
333:         const line = rawLine.trim();
334:         if (line.startsWith("event:")) {
335:           currentEvent = line.slice("event:".length).trim();
336:         } else if (line.startsWith("data:")) {
337:           const dataStr = line.slice("data:".length).trim();
338:           const out = handleSseMessage(currentEvent, dataStr);
339:           if (out) {
340:             controller.enqueue(encoder.encode(out));
341:           }
342:           currentEvent = "";
343:         } else if (line === "") {
344:           currentEvent = "";
345:         }
346:       }
347:     },
348:     flush(controller) {
349:       if (lineBuffer.trim().length > 0) {
350:         const line = lineBuffer.trim();
351:         if (line.startsWith("data:")) {
352:           const dataStr = line.slice("data:".length).trim();
353:           const out = handleSseMessage(currentEvent, dataStr);
354:           if (out) controller.enqueue(encoder.encode(out));
355:         }
356:       }
357:       if (!hasEmittedFinish) {
358:         const out = emitFinish();
359:         if (out) controller.enqueue(encoder.encode(out));
360:       }
361:     },
362:   });
363: }
```

## File: src/transformers/thinking.ts
```typescript
  1: import type { OpenAIMessage, OpenAIToolCall } from "./nuances";
  2: 
  3: const THOUGHT_SIGNATURE_STORE = new Map<string, string>();
  4: 
  5: export function storeThoughtSignature(toolCallId: string, signature: string): void {
  6:   if (toolCallId && signature) {
  7:     THOUGHT_SIGNATURE_STORE.set(toolCallId, signature);
  8:   }
  9: }
 10: 
 11: export function getThoughtSignature(toolCallId: string): string | undefined {
 12:   return THOUGHT_SIGNATURE_STORE.get(toolCallId);
 13: }
 14: 
 15: export function clearThoughtSignatures(): void {
 16:   THOUGHT_SIGNATURE_STORE.clear();
 17: }
 18: 
 19: function extractFromExtraContent(obj: Record<string, unknown>): string | undefined {
 20:   const extra = obj.extra_content as Record<string, unknown> | undefined;
 21:   if (!extra) {
 22:     return undefined;
 23:   }
 24:   const google = extra.google as Record<string, unknown> | undefined;
 25:   if (!google) {
 26:     return undefined;
 27:   }
 28:   const sig = google.thought_signature;
 29:   return typeof sig === "string" ? sig : undefined;
 30: }
 31: 
 32: function extractFromCandidates(obj: Record<string, unknown>): string | undefined {
 33:   const candidates = obj.candidates as readonly Record<string, unknown>[] | undefined;
 34:   if (!Array.isArray(candidates) || candidates.length === 0) {
 35:     return undefined;
 36:   }
 37:   const first = candidates[0];
 38:   if (!first) {
 39:     return undefined;
 40:   }
 41:   return extractFromExtraContent(first);
 42: }
 43: 
 44: export function extractThoughtSignature(responseObj: unknown): string | undefined {
 45:   if (typeof responseObj !== "object" || responseObj === null) {
 46:     return undefined;
 47:   }
 48:   const obj = responseObj as Record<string, unknown>;
 49:   return extractFromExtraContent(obj) ?? extractFromCandidates(obj);
 50: }
 51: 
 52: function patchToolCallWithSignature(toolCall: OpenAIToolCall): OpenAIToolCall {
 53:   const existingSig = getThoughtSignature(toolCall.id);
 54:   if (!existingSig) {
 55:     return toolCall;
 56:   }
 57:   return {
 58:     ...toolCall,
 59:     extra_content: {
 60:       ...toolCall.extra_content,
 61:       google: {
 62:         thought_signature: existingSig,
 63:       },
 64:     },
 65:   };
 66: }
 67: 
 68: function patchAssistantMessageSignatures(msg: OpenAIMessage): OpenAIMessage {
 69:   if (msg.role !== "assistant" || !msg.tool_calls || msg.tool_calls.length === 0) {
 70:     return msg;
 71:   }
 72:   return {
 73:     ...msg,
 74:     tool_calls: msg.tool_calls.map(patchToolCallWithSignature),
 75:   };
 76: }
 77: 
 78: export function injectThoughtSignatures(
 79:   messages: readonly OpenAIMessage[]
 80: ): readonly OpenAIMessage[] {
 81:   return messages.map(patchAssistantMessageSignatures);
 82: }
 83: 
 84: export function stripReasoningParameters(
 85:   payload: Record<string, unknown>
 86: ): Record<string, unknown> {
 87:   const cleaned = { ...payload };
 88:   delete cleaned.thinking;
 89:   delete cleaned.thinkingConfig;
 90:   delete cleaned.thinking_config;
 91:   delete cleaned.reasoning_effort;
 92:   delete cleaned.budget_tokens;
 93:   return cleaned;
 94: }
 95: 
 96: export function shouldStripReasoning(
 97:   globalStrip: boolean,
 98:   nuances: readonly string[],
 99:   targetWire?: string,
100:   aoStripReasoning?: boolean
101: ): boolean {
102:   if (nuances.includes("ts")) {
103:     return false;
104:   }
105:   if (nuances.includes("sb")) {
106:     return true;
107:   }
108:   if (targetWire === "ao" && (aoStripReasoning ?? true)) {
109:     return true;
110:   }
111:   return globalStrip;
112: }
113: 
114: export interface StreamThinkingState {
115:   isInThinkTag: boolean;
116:   bufferedText: string;
117: }
118: 
119: export function createStreamThinkingState(): StreamThinkingState {
120:   return {
121:     isInThinkTag: false,
122:     bufferedText: "",
123:   };
124: }
125: 
126: function formatAnthropicThinkingDelta(text: string): string {
127:   const event = {
128:     type: "content_block_delta",
129:     index: 0,
130:     delta: {
131:       type: "thinking_delta",
132:       thinking: text,
133:     },
134:   };
135:   return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
136: }
137: 
138: function formatAnthropicTextDelta(text: string): string {
139:   const event = {
140:     type: "content_block_delta",
141:     index: 1,
142:     delta: {
143:       type: "text_delta",
144:       text: text,
145:     },
146:   };
147:   return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
148: }
149: 
150: function processTagOpen(
151:   text: string,
152:   state: StreamThinkingState,
153:   preserveThinking: boolean
154: ): string {
155:   const parts = text.split("<think>");
156:   const before = parts[0] ?? "";
157:   const after = parts.slice(1).join("<think>");
158:   state.isInThinkTag = true;
159: 
160:   let out = "";
161:   if (before.length > 0) {
162:     out += formatAnthropicTextDelta(before);
163:   }
164:   if (after.length > 0 && preserveThinking) {
165:     out += formatAnthropicThinkingDelta(after);
166:   }
167:   return out;
168: }
169: 
170: function processTagClose(
171:   text: string,
172:   state: StreamThinkingState,
173:   preserveThinking: boolean
174: ): string {
175:   const parts = text.split("</think>");
176:   const thinkPart = parts[0] ?? "";
177:   const textPart = parts.slice(1).join("</think>");
178:   state.isInThinkTag = false;
179: 
180:   let out = "";
181:   if (thinkPart.length > 0 && preserveThinking) {
182:     out += formatAnthropicThinkingDelta(thinkPart);
183:   }
184:   if (textPart.length > 0) {
185:     out += formatAnthropicTextDelta(textPart);
186:   }
187:   return out;
188: }
189: 
190: function appendThinkingIfPreserved(out: string, thinkPart: string, preserveThinking: boolean): string {
191:   if (thinkPart.length > 0 && preserveThinking) {
192:     return out + formatAnthropicThinkingDelta(thinkPart);
193:   }
194:   return out;
195: }
196: 
197: function processFullThinkTag(
198:   text: string,
199:   preserveThinking: boolean
200: ): string {
201:   const parts = text.split("<think>");
202:   const before = parts[0] ?? "";
203:   const rest = parts.slice(1).join("<think>");
204:   const closeParts = rest.split("</think>");
205:   const thinkPart = closeParts[0] ?? "";
206:   const after = closeParts.slice(1).join("</think>");
207: 
208:   let out = before.length > 0 ? formatAnthropicTextDelta(before) : "";
209:   out = appendThinkingIfPreserved(out, thinkPart, preserveThinking);
210:   if (after.length > 0) {
211:     out += formatAnthropicTextDelta(after);
212:   }
213:   return out;
214: }
215: 
216: function formatDefaultDelta(
217:   chunk: string,
218:   state: StreamThinkingState,
219:   preserveThinking: boolean
220: ): string {
221:   if (state.isInThinkTag) {
222:     return preserveThinking ? formatAnthropicThinkingDelta(chunk) : "";
223:   }
224:   return formatAnthropicTextDelta(chunk);
225: }
226: 
227: export function processThinkingDelta(
228:   chunk: string,
229:   state: StreamThinkingState,
230:   preserveThinking: boolean
231: ): string {
232:   const hasOpen = chunk.includes("<think>");
233:   const hasClose = chunk.includes("</think>");
234: 
235:   if (hasOpen && hasClose) {
236:     state.isInThinkTag = false;
237:     return processFullThinkTag(chunk, preserveThinking);
238:   }
239:   if (hasOpen) {
240:     return processTagOpen(chunk, state, preserveThinking);
241:   }
242:   if (hasClose) {
243:     return processTagClose(chunk, state, preserveThinking);
244:   }
245:   return formatDefaultDelta(chunk, state, preserveThinking);
246: }
247: 
248: export {
249:   REASONING_KEYS,
250:   deleteReasoningKeys,
251:   isOpenCodeClient,
252:   hasMeaningfulDeltaFields,
253:   sanitizeDelta,
254:   filterReasoningFromChoice,
255:   filterReasoningFromChunk,
256:   sanitizeRawControlChars,
257:   createSyntheticHeartbeatChunk,
258:   processSseDataLine,
259:   FILTER_HEARTBEAT_INTERVAL_MS,
260:   type FilterTransformerState,
261:   createOpenCodeReasoningFilterStreamTransformer,
262:   stripReasoningFromResponseBody,
263:   normalizeToolContent,
264:   stripClientMetadata,
265:   stripToolMetadata,
266:   scrubReasoningFromMessage,
267:   scrubReasoningFromMessages,
268: } from "./opencode_adapter";
```

## File: src/ui/banner.ts
```typescript
 1: export interface KeyPoolSummary {
 2:   readonly provider: string;
 3:   readonly activeKeys: number;
 4: }
 5: 
 6: export interface BannerOptions {
 7:   readonly port: number;
 8:   readonly tlsEnabled: boolean;
 9:   readonly stripReasoning: boolean;
10:   readonly keyPools: readonly KeyPoolSummary[];
11: }
12: 
13: function formatPoolLine(pool: KeyPoolSummary): string {
14:   const label = pool.provider.padEnd(14, " ");
15:   return `  • ${label}: ${pool.activeKeys} active key(s)`;
16: }
17: 
18: function renderKeyPoolsSection(pools: readonly KeyPoolSummary[]): string[] {
19:   if (pools.length === 0) {
20:     return ["  • (No active key pools loaded from .env.local)"];
21:   }
22:   return pools.map((p) => formatPoolLine(p));
23: }
24: 
25: function buildBannerLines(options: BannerOptions): string[] {
26:   const protocol = options.tlsEnabled ? "HTTP/2 (h2 ALPN) & HTTP/1.1 TLS" : "HTTP/1.1 Cleartext";
27:   const poolLines = renderKeyPoolsSection(options.keyPools);
28: 
29:   return [
30:     "================================================================================",
31:     "🚀 LITEROUTER v4.0 GATEWAY [BUN RUNTIME]",
32:     "================================================================================",
33:     `Port           : ${options.port}`,
34:     `Protocol       : ${protocol}`,
35:     `TLS Enabled    : ${options.tlsEnabled}`,
36:     `Auth Mode      : API-Key Declarative Directive (lr-xx-xx-xx-xx / lr-fse-xxxx)`,
37:     `Strip Reasoning: ${options.stripReasoning} (Global default; overridable via 'ts' nuance)`,
38:     "",
39:     "Key Pools Loaded:",
40:     ...poolLines,
41:     "",
42:     "Endpoints Registered:",
43:     "  • /v1/chat/completions        (OpenAI Chat Completions)",
44:     "  • /v1/responses                 (OpenAI Responses / oo wire)",
45:     "  • /v1/messages                (Anthropic Claude Messages)",
46:     "  • /v1/messages/count_tokens   (Anthropic Token Counter)",
47:     "  • /v1/models                  (Dynamic Model Discovery)",
48:     "  • /v1beta/openai/*            (Google OpenAI-Compat Beta)",
49:     "  • /v1/models/*, /v1beta/models/* (Google Native RPC)",
50:     "  • /reset                      (Hard Flush / Key Unfreeze)",
51:     "  • /health                     (Health Check Probe)",
52:     "================================================================================",
53:   ];
54: }
55: 
56: export function printBanner(options: BannerOptions): void {
57:   const lines = buildBannerLines(options);
58:   console.log(lines.join("\n"));
59: }
```

## File: src/ui/telemetry.ts
```typescript
 1: export interface TokenUsageMetrics {
 2:   readonly promptTokens: number;
 3:   readonly completionTokens: number;
 4:   readonly reasoningTokens?: number;
 5:   readonly totalTokens: number;
 6:   readonly durationMs: number;
 7:   readonly tokensPerSecond?: number;
 8: }
 9: 
10: export interface RequestTrace {
11:   readonly reqId: string;
12:   readonly timestamp: string;
13:   readonly inbound: {
14:     readonly method: string;
15:     readonly url: string;
16:     readonly headers: Record<string, string>;
17:     readonly body?: unknown;
18:   };
19:   readonly directive?: unknown;
20:   readonly provider?: string;
21:   readonly model?: string;
22:   readonly outbound?: {
23:     readonly url: string;
24:     readonly status: number;
25:     readonly durationMs: number;
26:     readonly ttftMs?: number;
27:   };
28:   readonly usage?: TokenUsageMetrics;
29:   readonly error?: string;
30: }
31: 
32: export class TelemetrySink {
33:   private static readonly ttftStore = new Map<string, number>();
34: 
35:   public static recordTtft(reqId: string, ttftMs: number): void {
36:     this.ttftStore.set(reqId, ttftMs);
37:   }
38: 
39:   public static getTtft(reqId: string): number | undefined {
40:     return this.ttftStore.get(reqId);
41:   }
42: 
43:   public static clearTtft(reqId: string): void {
44:     this.ttftStore.delete(reqId);
45:   }
46: 
47:   public static calculateTokPerSec(tokens: number, durationMs: number): number {
48:     if (durationMs <= 0) {
49:       return 0;
50:     }
51:     const sec = durationMs / 1000;
52:     return Number.parseFloat((tokens / sec).toFixed(1));
53:   }
54: }
```

## File: tsconfig.json
```json
 1: {
 2:   "compilerOptions": {
 3:     "target": "ES2022",
 4:     "module": "ESNext",
 5:     "moduleResolution": "bundler",
 6:     "strict": true,
 7:     "noImplicitAny": true,
 8:     "noUncheckedIndexedAccess": true,
 9:     "noFallthroughCasesInSwitch": true,
10:     "allowSyntheticDefaultImports": true,
11:     "esModuleInterop": true,
12:     "forceConsistentCasingInFileNames": true,
13:     "noEmit": true,
14:     "skipLibCheck": true,
15:     "types": [
16:       "bun"
17:     ]
18:   },
19:   "include": [
20:     "src/**/*.ts",
21:     "scripts/**/*.ts",
22:     "eval/**/*.ts",
23:     "tests/**/*.ts"
24:   ],
25:   "exclude": [
26:     "node_modules",
27:     ".checkpoints",
28:     "logs"
29:   ]
30: }
```

## File: config/location.json.example
```
1: {
2:   "host": "10.32.34.172",
3:   "port": 7766,
4:   "tls_enabled": false,
5:   "parent_dir": "arthityap",
6:   "working_folder": "literouter"
7: }
```

## File: src/config/keys.ts
```typescript
  1: import { getProviderConfig, getAllProviders, isRegisteredProvider } from "./providers";
  2: import type { ProviderCode } from "./schema";
  3: 
  4: const PROVIDER_ENV_MAP: Readonly<Record<ProviderCode, string>> = {
  5:   or: "OPENROUTER_API_KEYS",
  6:   nv: "NVIDIA_API_KEYS",
  7:   gg: "GOOGLE_API_KEYS",
  8:   oa: "OPENAI_API_KEYS",
  9:   an: "ANTHROPIC_API_KEYS",
 10:   gq: "GROQ_API_KEYS",
 11:   cb: "CEREBRAS_API_KEYS",
 12:   ds: "DEEPSEEK_API_KEYS",
 13:   ms: "MISTRAL_API_KEYS",
 14:   tg: "TOGETHER_API_KEYS",
 15:   zn: "ZEN_API_KEYS",
 16:   tp: "TESTPROVIDER_API_KEYS",
 17:   gc: "GCP_KEYS",
 18: };
 19: 
 20: const INVALID_PLACEHOLDERS = new Set([
 21:   "changeme",
 22:   "todo",
 23:   "your_key_here",
 24:   "undefined",
 25:   "null",
 26:   "",
 27: ]);
 28: 
 29: function isUsableKey(rawKey: string): boolean {
 30:   const normalized = rawKey.trim().toLowerCase();
 31:   if (INVALID_PLACEHOLDERS.has(normalized)) {
 32:     return false;
 33:   }
 34:   return normalized.length >= 4;
 35: }
 36: 
 37: export function parseKeyList(rawEnvValue: string | undefined): readonly string[] {
 38:   if (!rawEnvValue) {
 39:     return [];
 40:   }
 41:   const tokens = rawEnvValue.split(",");
 42:   const validKeys: string[] = [];
 43:   for (const token of tokens) {
 44:     const trimmed = token.trim();
 45:     if (isUsableKey(trimmed)) {
 46:       validKeys.push(trimmed);
 47:     }
 48:   }
 49:   return Object.freeze(validKeys);
 50: }
 51: 
 52: export function maskKey(apiKey: string): string {
 53:   if (apiKey.length <= 8) {
 54:     return "****";
 55:   }
 56:   const start = apiKey.slice(0, 4);
 57:   const end = apiKey.slice(-4);
 58:   return `${start}...${end}`;
 59: }
 60: 
 61: export function getProviderEnvVarName(provider: ProviderCode): string {
 62:   if (isRegisteredProvider(provider)) {
 63:     const config = getProviderConfig(provider);
 64:     if (config.env_key) {
 65:       return config.env_key;
 66:     }
 67:   }
 68:   return PROVIDER_ENV_MAP[provider];
 69: }
 70: 
 71: export function loadKeyPools(
 72:   envSource: Record<string, string | undefined>
 73: ): ReadonlyMap<ProviderCode, readonly string[]> {
 74:   const poolMap = new Map<ProviderCode, readonly string[]>();
 75:   const codes = new Set<ProviderCode>(
 76:     Object.keys(PROVIDER_ENV_MAP) as ProviderCode[]
 77:   );
 78: 
 79:   for (const provider of getAllProviders()) {
 80:     codes.add(provider.code as ProviderCode);
 81:   }
 82: 
 83:   for (const code of codes) {
 84:     const envName = getProviderEnvVarName(code);
 85:     let rawVal = envName ? envSource[envName] : undefined;
 86:     if (code === "gc" && !rawVal) {
 87:       rawVal = envSource.GCP_API_KEYS;
 88:     }
 89:     const parsedKeys = parseKeyList(rawVal);
 90:     poolMap.set(code, parsedKeys);
 91:   }
 92:   return poolMap;
 93: }
 94: 
 95: export function validateKeyPools(
 96:   pools: ReadonlyMap<ProviderCode, readonly string[]>
 97: ): Record<string, number> {
 98:   const summary: Record<string, number> = {};
 99:   for (const [code, keys] of pools.entries()) {
100:     summary[code] = keys.length;
101:   }
102:   return summary;
103: }
```

## File: src/directive/validator.ts
```typescript
  1: import { parseDirective, type ParsedDirective } from "./parser";
  2: 
  3: export const DIRECTIVE_ERROR_CODE = "invalid_api_key";
  4: export const DIRECTIVE_ERROR_TYPE = "invalid_request_error";
  5: 
  6: export interface ValidationSuccess {
  7:   readonly valid: true;
  8:   readonly directive: ParsedDirective;
  9: }
 10: 
 11: export interface ValidationFailure {
 12:   readonly valid: false;
 13:   readonly error: string;
 14: }
 15: 
 16: export type ValidationResult = ValidationSuccess | ValidationFailure;
 17: 
 18: export interface StandardErrorPayload {
 19:   readonly error: {
 20:     readonly message: string;
 21:     readonly type: "invalid_request_error";
 22:     readonly code: "invalid_api_key";
 23:   };
 24: }
 25: 
 26: function extractFromAuthHeader(header: string | null): string | null {
 27:   if (!header) {
 28:     return null;
 29:   }
 30:   const trimmed = header.trim();
 31:   if (!trimmed || trimmed.toLowerCase() === "bearer") {
 32:     return null;
 33:   }
 34:   if (trimmed.toLowerCase().startsWith("bearer ")) {
 35:     const token = trimmed.slice(7).trim();
 36:     return token.length > 0 ? token : null;
 37:   }
 38:   return trimmed;
 39: }
 40: 
 41: function extractFromQuery(urlStr: string): string | null {
 42:   const urlObj = new URL(urlStr, "http://localhost:7766");
 43:   const keyParam = urlObj.searchParams.get("key");
 44:   if (keyParam) {
 45:     return keyParam;
 46:   }
 47:   const apiKeyParam = urlObj.searchParams.get("api_key");
 48:   if (apiKeyParam) {
 49:     return apiKeyParam;
 50:   }
 51:   const tokenParam = urlObj.searchParams.get("token");
 52:   if (tokenParam) {
 53:     return tokenParam;
 54:   }
 55:   return null;
 56: }
 57: 
 58: export function extractDirectiveToken(req: Request): string | null {
 59:   const authHeader = req.headers.get("authorization");
 60:   const fromAuth = extractFromAuthHeader(authHeader);
 61:   if (fromAuth) {
 62:     return fromAuth;
 63:   }
 64:   const xApiKey = req.headers.get("x-api-key");
 65:   if (xApiKey) {
 66:     return xApiKey.trim();
 67:   }
 68:   const xGoogApiKey = req.headers.get("x-goog-api-key");
 69:   if (xGoogApiKey) {
 70:     return xGoogApiKey.trim();
 71:   }
 72:   return extractFromQuery(req.url);
 73: }
 74: 
 75: export function normalizeKey(rawKey: string): string {
 76:   return rawKey.trim().toLowerCase();
 77: }
 78: 
 79: export function validateDirective(
 80:   rawKey: string | null | undefined
 81: ): ValidationResult {
 82:   if (!rawKey) {
 83:     return {
 84:       valid: false,
 85:       error: "Missing API key directive. Pass via Authorization, x-api-key, or ?key=",
 86:     };
 87:   }
 88:   const normalized = normalizeKey(rawKey);
 89:   const directive = parseDirective(normalized);
 90:   if (!directive) {
 91:     return {
 92:       valid: false,
 93:       error: `Invalid API key directive '${rawKey}'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>`,
 94:     };
 95:   }
 96:   return {
 97:     valid: true,
 98:     directive,
 99:   };
100: }
101: 
102: export function createUnauthorizedResponse(message?: string): Response {
103:   const detail =
104:     message ??
105:     "Invalid API key directive. Must conform to lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>";
106:   const payload: StandardErrorPayload = {
107:     error: {
108:       message: detail,
109:       type: "invalid_request_error",
110:       code: "invalid_api_key",
111:     },
112:   };
113:   return new Response(JSON.stringify(payload, null, 2), {
114:     status: 401,
115:     headers: {
116:       "Content-Type": "application/json",
117:       "WWW-Authenticate": 'Bearer error="invalid_token"',
118:     },
119:   });
120: }
```

## File: src/engine/strategies/zen.ts
```typescript
 1: import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";
 2: import { buildZenHeaders } from "../zen";
 3: 
 4: export class ZenStrategy implements ProviderExecutionStrategy {
 5:   buildAuthHeaders(key: string, incomingHeaders?: Headers): Record<string, string> {
 6:     const zenHeaders = buildZenHeaders(incomingHeaders);
 7:     return {
 8:       ...zenHeaders,
 9:       Authorization: `Bearer ${key}`,
10:       "Content-Type": "application/json",
11:     };
12:   }
13: 
14:   injectHeaders(_ctx: DispatchContext, headers: Record<string, string>): Record<string, string> {
15:     return headers;
16:   }
17: }
```

## File: src/engine/circuit_breaker.ts
```typescript
  1: export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
  2: 
  3: export interface CircuitBreakerConfig {
  4:   enabled: boolean;
  5:   failure_threshold: number;
  6:   failure_window_ms: number;
  7:   open_duration_ms: number;
  8:   half_open_max_probes: number;
  9:   success_threshold_to_close: number;
 10: }
 11: 
 12: export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
 13:   enabled: true,
 14:   failure_threshold: 5,
 15:   failure_window_ms: 60000,
 16:   open_duration_ms: 30000,
 17:   half_open_max_probes: 2,
 18:   success_threshold_to_close: 2,
 19: };
 20: 
 21: function isStatusFailure(status: number): boolean {
 22:   if (status === 0) {
 23:     return true;
 24:   }
 25:   if (status >= 520 && status <= 526) {
 26:     return true;
 27:   }
 28:   return status === 500 || status === 502 || status === 503 || status === 504;
 29: }
 30: 
 31: export function isCircuitBreakerFailure(status: number | Error): boolean {
 32:   if (status instanceof Error) {
 33:     return true;
 34:   }
 35:   if (typeof status !== "number") {
 36:     return false;
 37:   }
 38:   return isStatusFailure(status);
 39: }
 40: 
 41: export class CircuitBreaker {
 42:   public readonly config: CircuitBreakerConfig;
 43:   private state: CircuitBreakerState = "CLOSED";
 44:   private failureTimestamps: number[] = [];
 45:   private openStartedAt = 0;
 46:   private activeProbes = 0;
 47:   private consecutiveSuccesses = 0;
 48: 
 49:   constructor(
 50:     public readonly providerCode: string,
 51:     config?: Partial<CircuitBreakerConfig>,
 52:     private readonly clock: () => number = Date.now
 53:   ) {
 54:     this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
 55:   }
 56: 
 57:   private now(): number {
 58:     return this.clock();
 59:   }
 60: 
 61:   private pruneFailures(now: number): void {
 62:     const windowStart = now - this.config.failure_window_ms;
 63:     this.failureTimestamps = this.failureTimestamps.filter((t) => t >= windowStart);
 64:   }
 65: 
 66:   private transitionToHalfOpen(): void {
 67:     this.state = "HALF_OPEN";
 68:     this.activeProbes = 0;
 69:     this.consecutiveSuccesses = 0;
 70:   }
 71: 
 72:   private transitionToOpen(now: number): void {
 73:     this.state = "OPEN";
 74:     this.openStartedAt = now;
 75:     this.activeProbes = 0;
 76:     this.consecutiveSuccesses = 0;
 77:   }
 78: 
 79:   private transitionToClosed(): void {
 80:     this.state = "CLOSED";
 81:     this.failureTimestamps = [];
 82:     this.activeProbes = 0;
 83:     this.consecutiveSuccesses = 0;
 84:   }
 85: 
 86:   private refreshState(now: number): CircuitBreakerState {
 87:     if (!this.config.enabled) {
 88:       this.state = "CLOSED";
 89:       return "CLOSED";
 90:     }
 91:     if (this.state === "OPEN" && now - this.openStartedAt >= this.config.open_duration_ms) {
 92:       this.transitionToHalfOpen();
 93:     }
 94:     return this.state;
 95:   }
 96: 
 97:   public getState(): CircuitBreakerState {
 98:     return this.refreshState(this.now());
 99:   }
100: 
101:   public isOpen(): boolean {
102:     if (!this.config.enabled) {
103:       return false;
104:     }
105:     return this.refreshState(this.now()) === "OPEN";
106:   }
107: 
108:   public canProbe(): boolean {
109:     if (!this.config.enabled) {
110:       return true;
111:     }
112:     if (this.refreshState(this.now()) !== "HALF_OPEN") {
113:       return false;
114:     }
115:     if (this.activeProbes >= this.config.half_open_max_probes) {
116:       return false;
117:     }
118:     this.activeProbes += 1;
119:     return true;
120:   }
121: 
122:   private releaseProbe(): void {
123:     if (this.state === "HALF_OPEN") {
124:       this.activeProbes = Math.max(0, this.activeProbes - 1);
125:     }
126:   }
127: 
128:   public recordSuccess(): void {
129:     if (!this.config.enabled || this.refreshState(this.now()) !== "HALF_OPEN") {
130:       return;
131:     }
132:     this.activeProbes = Math.max(0, this.activeProbes - 1);
133:     this.consecutiveSuccesses += 1;
134:     if (this.consecutiveSuccesses >= this.config.success_threshold_to_close) {
135:       this.transitionToClosed();
136:     }
137:   }
138: 
139:   private handleClosedFailure(now: number): void {
140:     this.pruneFailures(now);
141:     this.failureTimestamps.push(now);
142:     if (this.failureTimestamps.length >= this.config.failure_threshold) {
143:       this.transitionToOpen(now);
144:     }
145:   }
146: 
147:   public recordFailure(status: number | Error): void {
148:     if (!this.config.enabled) {
149:       return;
150:     }
151:     if (!isCircuitBreakerFailure(status)) {
152:       this.releaseProbe();
153:       return;
154:     }
155: 
156:     const now = this.now();
157:     const currentState = this.refreshState(now);
158:     if (currentState === "HALF_OPEN") {
159:       this.transitionToOpen(now);
160:       return;
161:     }
162:     if (currentState === "CLOSED") {
163:       this.handleClosedFailure(now);
164:     }
165:   }
166: 
167:   public rejectResponse(providerName: string): Response {
168:     const now = this.now();
169:     const remainingMs = Math.max(0, this.openStartedAt + this.config.open_duration_ms - now);
170:     const retryAfterSec = Math.ceil(remainingMs / 1000);
171: 
172:     return new Response(
173:       JSON.stringify({
174:         error: {
175:           code: "circuit_breaker_open",
176:           message: `Provider ${providerName} circuit breaker is open. Retry after ${remainingMs}ms.`,
177:           type: "service_unavailable",
178:         },
179:       }),
180:       {
181:         status: 503,
182:         headers: {
183:           "Content-Type": "application/json",
184:           "Retry-After": String(retryAfterSec),
185:         },
186:       }
187:     );
188:   }
189: 
190:   public getFailureCount(): number {
191:     this.pruneFailures(this.now());
192:     return this.failureTimestamps.length;
193:   }
194: 
195:   public getActiveProbes(): number {
196:     return this.activeProbes;
197:   }
198: 
199:   public getConsecutiveSuccesses(): number {
200:     return this.consecutiveSuccesses;
201:   }
202: 
203:   public reset(): void {
204:     this.transitionToClosed();
205:     this.openStartedAt = 0;
206:   }
207: }
208: 
209: const breakerRegistry = new Map<string, CircuitBreaker>();
210: 
211: export function getCircuitBreaker(
212:   providerCode: string,
213:   config?: CircuitBreakerConfig
214: ): CircuitBreaker {
215:   const norm = providerCode.toLowerCase();
216:   let breaker = breakerRegistry.get(norm);
217:   if (!breaker) {
218:     breaker = new CircuitBreaker(norm, config);
219:     breakerRegistry.set(norm, breaker);
220:   }
221:   return breaker;
222: }
223: 
224: export function resetCircuitBreakers(): void {
225:   breakerRegistry.clear();
226: }
```

## File: src/engine/pacer_adapter.ts
```typescript
 1: import type { ProviderPacerConfig } from "../config/schema";
 2: import { getPacerForProvider, type PacerAcquireResult } from "../network/pacer";
 3: 
 4: /**
 5:  * Calculates a paced interval with jitter between min_delay_ms and max_delay_ms.
 6:  */
 7: export function calculatePacerIntervalMs(
 8:   pacerConfig: Pick<ProviderPacerConfig, "min_delay_ms" | "max_delay_ms">
 9: ): number {
10:   if (pacerConfig.max_delay_ms > pacerConfig.min_delay_ms) {
11:     const jitterRange = pacerConfig.max_delay_ms - pacerConfig.min_delay_ms;
12:     return Math.round(pacerConfig.min_delay_ms + Math.random() * jitterRange);
13:   }
14:   return pacerConfig.min_delay_ms;
15: }
16: 
17: /**
18:  * Acquires a rate-limiting slot from the provider pacer.
19:  * If pacer is not enabled or configuration is undefined, returns immediately.
20:  *
21:  * @param provider Provider identifier (e.g. "or", "nv", "gg")
22:  * @param pacerConfig Declarative provider pacer configuration
23:  * @param signal Optional abort signal to cancel queued wait
24:  */
25: export async function acquirePacer(
26:   provider: string,
27:   pacerConfig: ProviderPacerConfig | undefined,
28:   signal?: AbortSignal
29: ): Promise<PacerAcquireResult | undefined> {
30:   if (!pacerConfig?.enabled) return undefined;
31: 
32:   const intervalMs = calculatePacerIntervalMs(pacerConfig);
33: 
34:   const pacer = getPacerForProvider(provider, 0, {
35:     minIntervalMs: intervalMs,
36:     maxQueueDepth: pacerConfig.max_queue_depth,
37:     maxQueueWaitMs: pacerConfig.max_queue_wait_ms,
38:     maxConcurrency: pacerConfig.max_concurrency,
39:   });
40: 
41:   return await pacer.acquire(signal);
42: }
```

## File: src/engine/status_classify.ts
```typescript
 1: export type FailureAction = "fail_fast" | "retry_same_target" | "advance_target";
 2: 
 3: export const FAIL_FAST_STATUSES: ReadonlySet<number> = new Set([
 4:   400, 401, 403, 404, 413, 414, 422, 451, 501, 505,
 5: ]);
 6: 
 7: export const KEY_ROTATION_STATUSES: ReadonlySet<number> = new Set([
 8:   429,
 9: ]);
10: 
11: export const TRANSIENT_RETRY_STATUSES: ReadonlySet<number> = new Set([
12:   500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526,
13: ]);
14: 
15: /**
16:  * Deterministically classifies upstream HTTP status codes into failure actions.
17:  */
18: export function defaultClassifyFailure(status: number): FailureAction {
19:   if (FAIL_FAST_STATUSES.has(status)) {
20:     return "fail_fast";
21:   }
22:   if (KEY_ROTATION_STATUSES.has(status)) {
23:     return "retry_same_target";
24:   }
25:   if (TRANSIENT_RETRY_STATUSES.has(status)) {
26:     return "retry_same_target";
27:   }
28:   return "fail_fast";
29: }
```

## File: src/engine/strategy.ts
```typescript
 1: import type { ParsedDirective } from "../directive/types";
 2: import type { ProviderConfigEntry } from "../config/schema";
 3: import type { RequestTelemetry } from "../telemetry/session";
 4: 
 5: export interface SelectedKey {
 6:   readonly key: string;
 7:   readonly index: number;
 8:   readonly poolSize: number;
 9: }
10: 
11: export interface DispatchContext {
12:   readonly reqId: string;
13:   readonly directive: ParsedDirective;
14:   readonly providerConfig: ProviderConfigEntry;
15:   readonly telemetry: RequestTelemetry;
16:   readonly clientSignal: AbortSignal;
17:   readonly selectedKey: SelectedKey;
18:   readonly attempt: number;
19:   readonly maxAttempts: number;
20:   readonly path?: string;
21: }
22: 
23: export interface StrategyResult {
24:   readonly response: Response;
25:   readonly committed: boolean;
26: }
27: 
28: export interface ProviderExecutionStrategy {
29:   preDispatch?(ctx: DispatchContext, body: Record<string, unknown>): Response | null;
30:   resolveTarget?(ctx: DispatchContext, body: Record<string, unknown>): {
31:     model: string;
32:     upstreamUrl: string;
33:     extraHeaders?: Record<string, string>;
34:   };
35:   classifyFailure?(
36:     ctx: DispatchContext,
37:     status: number,
38:     body?: string
39:   ): "retry_same_target" | "advance_target" | "fail_fast";
40:   buildAuthHeaders?(key: string, incomingHeaders?: Headers): Record<string, string>;
41:   injectHeaders?(ctx: DispatchContext, headers: Record<string, string>): Record<string, string>;
42: }
```

## File: src/telemetry/trace_writer.ts
```typescript
  1: import { Database } from "bun:sqlite";
  2: import { mkdirSync } from "node:fs";
  3: import { dirname } from "node:path";
  4: import type { SanitizedTrace } from "./ring_buffer";
  5: 
  6: export const FLUSH_INTERVAL_MS = 30_000;
  7: export const FLUSH_COUNT_THRESHOLD = 100;
  8: export const FLUSH_BYTES_THRESHOLD = 16 * 1024 * 1024; // 16MB
  9: export const RETENTION_DAYS = 30;
 10: 
 11: export const SCHEMA_SQL = `
 12: CREATE TABLE IF NOT EXISTS request_traces (
 13:   req_id TEXT PRIMARY KEY,
 14:   created_at INTEGER NOT NULL,
 15:   provider TEXT NOT NULL,
 16:   model TEXT NOT NULL,
 17:   status INTEGER NOT NULL,
 18:   duration_ms INTEGER NOT NULL,
 19:   ttft_ms INTEGER,
 20:   tokens_prompt INTEGER,
 21:   tokens_completion INTEGER,
 22:   client_inbound TEXT,
 23:   upstream_outbound TEXT,
 24:   upstream_inbound TEXT,
 25:   client_outbound TEXT
 26: );
 27: CREATE INDEX IF NOT EXISTS idx_traces_created ON request_traces(created_at);
 28: CREATE INDEX IF NOT EXISTS idx_traces_provider ON request_traces(provider);
 29: CREATE INDEX IF NOT EXISTS idx_traces_status ON request_traces(status);
 30: `;
 31: 
 32: export const INSERT_SQL = `
 33: INSERT OR REPLACE INTO request_traces (
 34:   req_id, created_at, provider, model, status,
 35:   duration_ms, ttft_ms, tokens_prompt, tokens_completion,
 36:   client_inbound, upstream_outbound, upstream_inbound, client_outbound
 37: ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
 38: `;
 39: 
 40: export interface TraceWriterOptions {
 41:   flushIntervalMs?: number;
 42:   flushCountThreshold?: number;
 43:   flushBytesThreshold?: number;
 44:   retentionDays?: number;
 45: }
 46: 
 47: export class TraceWriter {
 48:   private db: Database | null = null;
 49:   private queue: SanitizedTrace[] = [];
 50:   private queueBytes = 0;
 51:   private flushTimer: ReturnType<typeof setInterval> | null = null;
 52:   private initError: Error | null = null;
 53: 
 54:   public readonly flushIntervalMs: number;
 55:   public readonly flushCountThreshold: number;
 56:   public readonly flushBytesThreshold: number;
 57:   public readonly retentionDays: number;
 58: 
 59:   constructor(options: TraceWriterOptions = {}) {
 60:     this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
 61:     this.flushCountThreshold = options.flushCountThreshold ?? FLUSH_COUNT_THRESHOLD;
 62:     this.flushBytesThreshold = options.flushBytesThreshold ?? FLUSH_BYTES_THRESHOLD;
 63:     this.retentionDays = options.retentionDays ?? RETENTION_DAYS;
 64:   }
 65: 
 66:   init(dbPath?: string): void {
 67:     const resolvedDbPath =
 68:       dbPath ??
 69:       (process.env.NODE_ENV === "test" || process.env.LITEROUTER_TEST_MODE === "true"
 70:         ? ":memory:"
 71:         : "logs/traces.db");
 72: 
 73:     try {
 74:       if (resolvedDbPath !== ":memory:") {
 75:         const dir = dirname(resolvedDbPath);
 76:         if (dir && dir !== ".") {
 77:           mkdirSync(dir, { recursive: true });
 78:         }
 79:       }
 80:       if (this.flushTimer) {
 81:         clearInterval(this.flushTimer);
 82:         this.flushTimer = null;
 83:       }
 84:       if (this.db) {
 85:         try {
 86:           this.db.close();
 87:         } catch (err) {
 88:           console.warn(`[TraceWriter] Close previous db error: ${err}`);
 89:         }
 90:         this.db = null;
 91:       }
 92:       this.db = new Database(resolvedDbPath, { create: true });
 93:       this.db.exec("PRAGMA journal_mode = WAL;");
 94:       this.db.exec("PRAGMA synchronous = NORMAL;");
 95:       this.db.exec(SCHEMA_SQL);
 96:       this.pruneOldTraces();
 97:       this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
 98:       this.initError = null;
 99:     } catch (err) {
100:       // SQLite init failure is NON-FATAL. Gateway continues without persistence.
101:       // Traces remain in RAM ring buffer only.
102:       this.initError = err instanceof Error ? err : new Error(String(err));
103:       console.error(
104:         `[TraceWriter] SQLite init failed (non-fatal, RAM-only mode): ${this.initError.message}`
105:       );
106:     }
107:   }
108: 
109:   enqueue(trace: SanitizedTrace): void {
110:     if (this.initError || !this.db) {
111:       return;
112:     }
113: 
114:     this.queue.push(trace);
115:     this.queueBytes += JSON.stringify(trace).length;
116: 
117:     if (
118:       this.queue.length >= this.flushCountThreshold ||
119:       this.queueBytes >= this.flushBytesThreshold
120:     ) {
121:       this.flush();
122:     }
123:   }
124: 
125:   flush(): void {
126:     if (!this.db || this.queue.length === 0) {
127:       return;
128:     }
129: 
130:     try {
131:       const insert = this.db.prepare(INSERT_SQL);
132:       const tx = this.db.transaction((traces: SanitizedTrace[]) => {
133:         for (const t of traces) {
134:           insert.run(
135:             t.reqId,
136:             t.createdAt,
137:             t.provider,
138:             t.model,
139:             t.status,
140:             t.durationMs,
141:             t.ttftMs ?? null,
142:             t.tokensPrompt ?? null,
143:             t.tokensCompletion ?? null,
144:             t.legs?.clientInbound ?? null,
145:             t.legs?.upstreamOutbound ?? null,
146:             t.legs?.upstreamInbound ?? null,
147:             t.legs?.clientOutbound ?? null
148:           );
149:         }
150:       });
151:       tx(this.queue);
152:     } catch (err) {
153:       console.error(
154:         `[TraceWriter] Flush failed (${this.queue.length} traces lost): ${err}`
155:       );
156:     } finally {
157:       this.queue = [];
158:       this.queueBytes = 0;
159:     }
160:   }
161: 
162:   /** Synchronous drain on process exit. */
163:   drainSync(): void {
164:     this.flush();
165:     if (this.flushTimer) {
166:       clearInterval(this.flushTimer);
167:       this.flushTimer = null;
168:     }
169:     if (this.db) {
170:       try {
171:         this.db.close();
172:       } catch (err) {
173:         console.warn(`[TraceWriter] Close error: ${err}`);
174:       }
175:       this.db = null;
176:     }
177:   }
178: 
179:   pruneOldTraces(retentionDays = this.retentionDays): void {
180:     if (!this.db) {
181:       return;
182:     }
183:     try {
184:       const cutoff = Date.now() - retentionDays * 86_400_000;
185:       this.db.run("DELETE FROM request_traces WHERE created_at < ?", [cutoff]);
186:     } catch (err) {
187:       console.error(`[TraceWriter] Prune failed (non-fatal): ${err}`);
188:     }
189:   }
190: 
191:   getDb(): Database | null {
192:     return this.db;
193:   }
194: 
195:   getQueueLength(): number {
196:     return this.queue.length;
197:   }
198: 
199:   getQueueBytes(): number {
200:     return this.queueBytes;
201:   }
202: 
203:   getInitError(): Error | null {
204:     return this.initError;
205:   }
206: }
207: 
208: export const traceWriter = new TraceWriter();
209: 
210: // Register shutdown hooks
211: process.on("beforeExit", () => traceWriter.drainSync());
212: process.on("SIGINT", () => {
213:   traceWriter.drainSync();
214:   process.exit(0);
215: });
216: process.on("SIGTERM", () => {
217:   traceWriter.drainSync();
218:   process.exit(0);
219: });
```

## File: src/transformers/anthropic_openai_xwire.ts
```typescript
   1: import type { ParsedDirective } from "../directive/types";
   2: import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
   3: import type { RequestTelemetry, UsageRecord } from "../telemetry/session";
   4: import { TagSanitizerStreamBuffer, stripLeakedTemplateTags } from "./dots";
   5: import type { OpenAIMessage, OpenAIRequestPayload } from "./nuances";
   6: import { getEnv } from "../config/env";
   7: 
   8: export interface AnthropicImageSource {
   9:   readonly type: "base64" | "url";
  10:   readonly media_type?: string;
  11:   readonly data?: string;
  12:   readonly url?: string;
  13: }
  14: 
  15: export interface AnthropicContentBlock {
  16:   readonly type: "text" | "image" | "document" | "thinking" | "redacted_thinking" | "tool_use" | "tool_result";
  17:   readonly text?: string;
  18:   readonly thinking?: string;
  19:   readonly id?: string;
  20:   readonly name?: string;
  21:   readonly input?: unknown;
  22:   readonly tool_use_id?: string;
  23:   readonly content?: string | readonly unknown[];
  24:   readonly is_error?: boolean;
  25:   readonly source?: AnthropicImageSource;
  26: }
  27: 
  28: export interface AnthropicMessage {
  29:   readonly role: "user" | "assistant";
  30:   readonly content: string | readonly AnthropicContentBlock[];
  31: }
  32: 
  33: export interface AnthropicMessagesRequest {
  34:   readonly model: string;
  35:   readonly messages: readonly AnthropicMessage[];
  36:   readonly system?: string | readonly unknown[];
  37:   readonly max_tokens?: number;
  38:   readonly stream?: boolean;
  39:   readonly stream_options?: unknown;
  40:   readonly temperature?: number;
  41:   readonly top_p?: number;
  42:   readonly top_k?: number;
  43:   readonly stop_sequences?: readonly string[];
  44:   readonly metadata?: unknown;
  45:   readonly tools?: readonly unknown[];
  46:   readonly tool_choice?: unknown;
  47:   readonly thinking?: unknown;
  48:   readonly [key: string]: unknown;
  49: }
  50: 
  51: export function mapOpenAIToAnthropicStopReason(
  52:   finishReason?: string | null,
  53:   hasToolUse = false
  54: ): string {
  55:   if (finishReason === "length") {
  56:     return "max_tokens";
  57:   }
  58:   if (finishReason === "content_filter") {
  59:     return "refusal";
  60:   }
  61:   if (hasToolUse || finishReason === "tool_calls" || finishReason === "function_call") {
  62:     return "tool_use";
  63:   }
  64:   return "end_turn";
  65: }
  66: 
  67: export function mapOpenAIToAnthropicUsage(usage: unknown): Record<string, unknown> {
  68:   if (!usage || typeof usage !== "object") {
  69:     return { input_tokens: 0, output_tokens: 0 };
  70:   }
  71:   const u = usage as Record<string, unknown>;
  72:   const inputTokens = typeof u.prompt_tokens === "number"
  73:     ? u.prompt_tokens
  74:     : (typeof u.input_tokens === "number" ? u.input_tokens : 0);
  75:   const outputTokens = typeof u.completion_tokens === "number"
  76:     ? u.completion_tokens
  77:     : (typeof u.output_tokens === "number" ? u.output_tokens : 0);
  78: 
  79:   const result: Record<string, unknown> = {
  80:     input_tokens: inputTokens,
  81:     output_tokens: outputTokens,
  82:   };
  83: 
  84:   const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  85:   if (details && typeof details.cached_tokens === "number") {
  86:     result.cache_read_input_tokens = details.cached_tokens;
  87:   } else if (typeof u.cache_read_input_tokens === "number") {
  88:     result.cache_read_input_tokens = u.cache_read_input_tokens;
  89:   }
  90: 
  91:   return result;
  92: }
  93: 
  94: function extractSystemString(system: unknown): string | null {
  95:   if (typeof system === "string") {
  96:     return system;
  97:   }
  98:   if (Array.isArray(system)) {
  99:     return system
 100:       .filter((b): b is { text: string } => typeof b === "object" && b !== null && typeof b.text === "string")
 101:       .map((b) => b.text)
 102:       .join("\n");
 103:   }
 104:   return null;
 105: }
 106: 
 107: function isAnthropicTool(tool: unknown): tool is { name: string; description?: string; input_schema: unknown } {
 108:   if (typeof tool !== "object" || tool === null) {
 109:     return false;
 110:   }
 111:   const t = tool as Record<string, unknown>;
 112:   return typeof t.name === "string" && "input_schema" in t;
 113: }
 114: 
 115: function translateSingleTool(tool: unknown): unknown {
 116:   if (!isAnthropicTool(tool)) {
 117:     return tool;
 118:   }
 119:   return {
 120:     type: "function",
 121:     function: {
 122:       name: tool.name,
 123:       description: typeof tool.description === "string" ? tool.description : undefined,
 124:       parameters: tool.input_schema,
 125:     },
 126:   };
 127: }
 128: 
 129: export function translateTools(tools?: readonly unknown[]): readonly unknown[] | undefined {
 130:   if (!tools || !Array.isArray(tools)) {
 131:     return undefined;
 132:   }
 133:   return tools.map(translateSingleTool);
 134: }
 135: 
 136: const TOOL_CHOICE_MAP: Record<string, string> = {
 137:   auto: "auto",
 138:   any: "required",
 139:   none: "none",
 140: };
 141: 
 142: export function translateToolChoice(choice: unknown): unknown {
 143:   if (typeof choice === "string" || !choice || typeof choice !== "object") {
 144:     return choice;
 145:   }
 146:   const c = choice as Record<string, unknown>;
 147:   const mapped = typeof c.type === "string" ? TOOL_CHOICE_MAP[c.type] : undefined;
 148:   if (mapped) {
 149:     return mapped;
 150:   }
 151:   if (c.type === "tool" && typeof c.name === "string") {
 152:     return { type: "function", function: { name: c.name } };
 153:   }
 154:   return choice;
 155: }
 156: 
 157: function translateAssistantToolBlock(
 158:   block: AnthropicContentBlock
 159: ): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
 160:   if (block.type !== "tool_use" || !block.name) {
 161:     return null;
 162:   }
 163:   const callId = block.id || `call_${Math.random().toString(36).slice(2, 10)}`;
 164:   const args = typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
 165:   return {
 166:     id: callId,
 167:     type: "function",
 168:     function: {
 169:       name: block.name,
 170:       arguments: args,
 171:     },
 172:   };
 173: }
 174: 
 175: function extractAssistantBlocks(content: readonly AnthropicContentBlock[]): {
 176:   textContent: string;
 177:   reasoningContent: string;
 178:   toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
 179: } {
 180:   let textContent = "";
 181:   let reasoningContent = "";
 182:   const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
 183: 
 184:   for (const block of content) {
 185:     if (block.type === "thinking") {
 186:       reasoningContent += block.thinking || block.text || "";
 187:     } else if (block.type === "text" && block.text) {
 188:       textContent += block.text;
 189:     }
 190:     const tc = translateAssistantToolBlock(block);
 191:     if (tc) {
 192:       toolCalls.push(tc);
 193:     }
 194:   }
 195:   return { textContent, reasoningContent, toolCalls };
 196: }
 197: 
 198: function translateAssistantMessage(msg: AnthropicMessage): OpenAIMessage {
 199:   if (typeof msg.content === "string") {
 200:     return { role: "assistant", content: msg.content } as OpenAIMessage;
 201:   }
 202:   if (!Array.isArray(msg.content)) {
 203:     return { role: "assistant", content: null } as OpenAIMessage;
 204:   }
 205: 
 206:   const { textContent, reasoningContent, toolCalls } = extractAssistantBlocks(msg.content);
 207:   const result: Record<string, unknown> = {
 208:     role: "assistant",
 209:     content: textContent.length > 0 ? textContent : null,
 210:   };
 211:   if (reasoningContent.length > 0) {
 212:     result.reasoning_content = reasoningContent;
 213:   }
 214:   if (toolCalls.length > 0) {
 215:     result.tool_calls = toolCalls;
 216:   }
 217:   return result as unknown as OpenAIMessage;
 218: }
 219: 
 220: function formatToolResultContent(content: unknown, isError?: boolean): string {
 221:   let resultText = "";
 222:   if (typeof content === "string") {
 223:     resultText = content;
 224:   } else if (Array.isArray(content)) {
 225:     resultText = content
 226:       .map((b: unknown) => {
 227:         if (typeof b === "object" && b !== null && "text" in b && typeof (b as { text: unknown }).text === "string") {
 228:           return (b as { text: string }).text;
 229:         }
 230:         return typeof b === "string" ? b : JSON.stringify(b);
 231:       })
 232:       .join("\n");
 233:   } else if (content !== undefined && content !== null) {
 234:     resultText = JSON.stringify(content);
 235:   }
 236:   return isError ? `Error: ${resultText}` : resultText;
 237: }
 238: 
 239: function translateImageSource(source: AnthropicImageSource): { type: "image_url"; image_url: { url: string } } | null {
 240:   if (source.type === "base64" && source.data) {
 241:     const mediaType = source.media_type || "image/jpeg";
 242:     return {
 243:       type: "image_url",
 244:       image_url: { url: `data:${mediaType};base64,${source.data}` },
 245:     };
 246:   }
 247:   if (source.type === "url" && source.url) {
 248:     return {
 249:       type: "image_url",
 250:       image_url: { url: source.url },
 251:     };
 252:   }
 253:   return null;
 254: }
 255: 
 256: function translateUserContentBlock(block: AnthropicContentBlock): unknown | null {
 257:   if (block.type === "text" && block.text) {
 258:     return { type: "text", text: block.text };
 259:   }
 260:   if (block.type === "image" && block.source) {
 261:     return translateImageSource(block.source);
 262:   }
 263:   return null;
 264: }
 265: 
 266: function processUserBlocks(blocks: readonly AnthropicContentBlock[], outMessages: OpenAIMessage[]): unknown[] {
 267:   const userParts: unknown[] = [];
 268:   for (const block of blocks) {
 269:     if (block.type === "tool_result") {
 270:       const resultText = formatToolResultContent(block.content, block.is_error);
 271:       outMessages.push({
 272:         role: "tool",
 273:         tool_call_id: block.tool_use_id ?? block.id ?? "call_unknown",
 274:         content: resultText,
 275:       } as unknown as OpenAIMessage);
 276:     } else {
 277:       const part = translateUserContentBlock(block);
 278:       if (part) {
 279:         userParts.push(part);
 280:       }
 281:     }
 282:   }
 283:   return userParts;
 284: }
 285: 
 286: function translateUserMessage(msg: AnthropicMessage, outMessages: OpenAIMessage[]): void {
 287:   if (typeof msg.content === "string") {
 288:     outMessages.push({ role: "user", content: msg.content } as OpenAIMessage);
 289:     return;
 290:   }
 291:   if (!Array.isArray(msg.content)) {
 292:     return;
 293:   }
 294: 
 295:   const userParts = processUserBlocks(msg.content, outMessages);
 296:   if (userParts.length === 1 && (userParts[0] as { type?: string }).type === "text") {
 297:     outMessages.push({ role: "user", content: (userParts[0] as { text: string }).text } as OpenAIMessage);
 298:   } else if (userParts.length > 0) {
 299:     outMessages.push({ role: "user", content: userParts } as unknown as OpenAIMessage);
 300:   }
 301: }
 302: 
 303: const ALLOWED_OPENAI_KEYS = new Set([
 304:   "model",
 305:   "messages",
 306:   "stream",
 307:   "stream_options",
 308:   "max_tokens",
 309:   "max_completion_tokens",
 310:   "temperature",
 311:   "top_p",
 312:   "stop",
 313:   "tools",
 314:   "tool_choice",
 315:   "parallel_tool_calls",
 316:   "user",
 317:   "metadata",
 318:   "response_format",
 319:   "seed",
 320: ]);
 321: 
 322: function applyToolChoiceSettings(req: AnthropicMessagesRequest, result: Record<string, unknown>): void {
 323:   if (req.tool_choice !== undefined) {
 324:     result.tool_choice = translateToolChoice(req.tool_choice);
 325:     if (typeof req.tool_choice === "object" && req.tool_choice !== null) {
 326:       const tc = req.tool_choice as Record<string, unknown>;
 327:       if (tc.disable_parallel_tool_use) {
 328:         result.parallel_tool_calls = false;
 329:       }
 330:     }
 331:   }
 332: }
 333: 
 334: function copyAllowedOpenAiKeys(req: AnthropicMessagesRequest, result: Record<string, unknown>): void {
 335:   for (const [key, value] of Object.entries(req)) {
 336:     if (ALLOWED_OPENAI_KEYS.has(key) && result[key] === undefined && value !== undefined) {
 337:       result[key] = value;
 338:     }
 339:   }
 340: }
 341: 
 342: export function translateAnthropicToOpenAI(req: AnthropicMessagesRequest): OpenAIRequestPayload {
 343:   const openAiMessages: OpenAIMessage[] = [];
 344:   const systemText = extractSystemString(req.system);
 345: 
 346:   if (systemText) {
 347:     openAiMessages.push({ role: "system", content: systemText });
 348:   }
 349: 
 350:   if (Array.isArray(req.messages)) {
 351:     for (const msg of req.messages) {
 352:       if (msg.role === "assistant") {
 353:         openAiMessages.push(translateAssistantMessage(msg));
 354:       } else if (msg.role === "user") {
 355:         translateUserMessage(msg, openAiMessages);
 356:       }
 357:     }
 358:   }
 359: 
 360:   const result: Record<string, unknown> = {
 361:     model: req.model,
 362:     messages: openAiMessages,
 363:     stream: req.stream,
 364:   };
 365: 
 366:   if (req.stream_options !== undefined) {
 367:     result.stream_options = req.stream_options;
 368:   }
 369: 
 370:   const env = getEnv();
 371:   const minAoMaxTokens = env.LITEROUTER_AO_MAX_TOKENS ?? 32768;
 372:   if (minAoMaxTokens > 0) {
 373:     result.max_tokens = req.max_tokens !== undefined ? Math.max(req.max_tokens, minAoMaxTokens) : minAoMaxTokens;
 374:   } else if (req.max_tokens !== undefined) {
 375:     result.max_tokens = req.max_tokens;
 376:   }
 377:   if (req.temperature !== undefined) result.temperature = req.temperature;
 378:   if (req.top_p !== undefined) result.top_p = req.top_p;
 379:   if (req.stop_sequences !== undefined) result.stop = req.stop_sequences;
 380:   if (req.metadata !== undefined) result.metadata = req.metadata;
 381: 
 382:   const translatedTools = translateTools(req.tools);
 383:   if (translatedTools !== undefined) result.tools = translatedTools;
 384: 
 385:   applyToolChoiceSettings(req, result);
 386:   copyAllowedOpenAiKeys(req, result);
 387: 
 388:   return result as unknown as OpenAIRequestPayload;
 389: }
 390: 
 391: function parseToolCallArguments(args?: string): unknown {
 392:   if (!args) return {};
 393:   try {
 394:     return JSON.parse(args);
 395:   } catch {
 396:     return { raw: args };
 397:   }
 398: }
 399: 
 400: function extractToolUseBlocks(toolCalls?: Array<{
 401:   id?: string;
 402:   type?: string;
 403:   function?: { name?: string; arguments?: string };
 404: }>): AnthropicContentBlock[] {
 405:   if (!Array.isArray(toolCalls)) return [];
 406:   const blocks: AnthropicContentBlock[] = [];
 407:   for (const tc of toolCalls) {
 408:     if (tc.function?.name) {
 409:       blocks.push({
 410:         type: "tool_use",
 411:         id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
 412:         name: tc.function.name,
 413:         input: parseToolCallArguments(tc.function.arguments),
 414:       });
 415:     }
 416:   }
 417:   return blocks;
 418: }
 419: 
 420: function extractTextContent(content?: string | Array<{ type?: string; text?: string }> | null): string {
 421:   if (typeof content === "string") {
 422:     return stripLeakedTemplateTags(content);
 423:   }
 424:   if (Array.isArray(content)) {
 425:     return stripLeakedTemplateTags(
 426:       content
 427:         .filter((p) => p?.type === "text" && typeof p.text === "string")
 428:         .map((p) => p.text)
 429:         .join("")
 430:     );
 431:   }
 432:   return "";
 433: }
 434: 
 435: function extractMessageContentBlocks(msg?: {
 436:   content?: string | Array<{ type?: string; text?: string }> | null;
 437:   reasoning_content?: string | null;
 438:   reasoning?: string | null;
 439:   tool_calls?: Array<{
 440:     id?: string;
 441:     type?: string;
 442:     function?: { name?: string; arguments?: string };
 443:   }>;
 444: }): AnthropicContentBlock[] {
 445:   const blocks: AnthropicContentBlock[] = [];
 446:   const reasoning = msg?.reasoning_content || msg?.reasoning;
 447:   if (typeof reasoning === "string" && reasoning.length > 0) {
 448:     const cleaned = stripLeakedTemplateTags(reasoning);
 449:     if (cleaned.length > 0) {
 450:       blocks.push({ type: "thinking", thinking: cleaned } as AnthropicContentBlock);
 451:     }
 452:   }
 453: 
 454:   const textContent = extractTextContent(msg?.content);
 455:   if (textContent.length > 0) {
 456:     blocks.push({ type: "text", text: textContent });
 457:   }
 458: 
 459:   const toolBlocks = extractToolUseBlocks(msg?.tool_calls);
 460:   blocks.push(...toolBlocks);
 461: 
 462:   if (blocks.length === 0) {
 463:     blocks.push({ type: "text", text: "" });
 464:   }
 465:   return blocks;
 466: }
 467: 
 468: export function translateOpenAIToAnthropicResponse(
 469:   openAiRes: Record<string, unknown>,
 470:   model: string
 471: ): Record<string, unknown> {
 472:   const choices = (openAiRes.choices as Array<{
 473:     message?: {
 474:       content?: string | Array<{ type?: string; text?: string }> | null;
 475:       reasoning_content?: string | null;
 476:       reasoning?: string | null;
 477:       tool_calls?: Array<{
 478:         id?: string;
 479:         type?: string;
 480:         function?: { name?: string; arguments?: string };
 481:       }>;
 482:     };
 483:     finish_reason?: string;
 484:   }>) || [];
 485: 
 486:   const firstChoice = choices[0];
 487:   const contentBlocks = extractMessageContentBlocks(firstChoice?.message);
 488:   const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
 489:   const stopReason = mapOpenAIToAnthropicStopReason(firstChoice?.finish_reason, hasToolUse);
 490: 
 491:   return {
 492:     id: (openAiRes.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`,
 493:     type: "message",
 494:     role: "assistant",
 495:     content: contentBlocks,
 496:     model,
 497:     stop_reason: stopReason,
 498:     stop_sequence: null,
 499:     usage: mapOpenAIToAnthropicUsage(openAiRes.usage),
 500:   };
 501: }
 502: 
 503: interface ActiveToolInfo {
 504:   readonly blockIndex: number;
 505:   readonly id: string;
 506:   readonly name: string;
 507: }
 508: 
 509: interface StreamTransformState {
 510:   msgStartSent: boolean;
 511:   currentBlockIndex: number;
 512:   currentBlockType: "text" | "thinking" | "tool_use" | null;
 513:   messageDeltaSent: boolean;
 514:   accumulatedInputTokens: number;
 515:   accumulatedOutputTokens: number;
 516:   readonly activeToolMap: Map<number, ActiveToolInfo>;
 517:   readonly openBlockIndices: Set<number>;
 518:   pendingStopReason: string | null;
 519:   readonly thinkingSanitizer: TagSanitizerStreamBuffer;
 520:   readonly textSanitizer: TagSanitizerStreamBuffer;
 521: }
 522: 
 523: function sseEvent(encoder: TextEncoder, event: string, data: unknown): Uint8Array {
 524:   return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
 525: }
 526: 
 527: function handleNativeAnthropicPassThrough(
 528:   rawData: string,
 529:   parsed: Record<string, unknown>,
 530:   controller: TransformStreamDefaultController<Uint8Array>,
 531:   encoder: TextEncoder
 532: ): boolean {
 533:   if (
 534:     typeof parsed.type === "string" &&
 535:     (parsed.type.startsWith("message_") || parsed.type.startsWith("content_block_") || parsed.type === "ping")
 536:   ) {
 537:     controller.enqueue(encoder.encode(`event: ${parsed.type}\ndata: ${rawData}\n\n`));
 538:     return true;
 539:   }
 540:   return false;
 541: }
 542: 
 543: function ensureMessageStart(
 544:   parsed: Record<string, unknown>,
 545:   fallbackModel: string,
 546:   state: StreamTransformState,
 547:   controller: TransformStreamDefaultController<Uint8Array>,
 548:   encoder: TextEncoder
 549: ): void {
 550:   if (!state.msgStartSent) {
 551:     state.msgStartSent = true;
 552:     const msgId = (parsed.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`;
 553:     const effectiveModel = (typeof parsed.model === "string" && parsed.model.length > 0)
 554:       ? parsed.model
 555:       : fallbackModel;
 556:     controller.enqueue(
 557:       sseEvent(encoder, "message_start", {
 558:         type: "message_start",
 559:         message: {
 560:           id: msgId,
 561:           type: "message",
 562:           role: "assistant",
 563:           content: [],
 564:           model: effectiveModel,
 565:           stop_reason: null,
 566:           stop_sequence: null,
 567:           usage: {
 568:             input_tokens: state.accumulatedInputTokens,
 569:             output_tokens: 0,
 570:           },
 571:         },
 572:       })
 573:     );
 574:   }
 575: }
 576: 
 577: function closeAllOpenBlocks(
 578:   state: StreamTransformState,
 579:   controller: TransformStreamDefaultController<Uint8Array>,
 580:   encoder: TextEncoder
 581: ): void {
 582:   for (const index of state.openBlockIndices) {
 583:     controller.enqueue(
 584:       sseEvent(encoder, "content_block_stop", {
 585:         type: "content_block_stop",
 586:         index,
 587:       })
 588:     );
 589:   }
 590:   state.openBlockIndices.clear();
 591:   state.currentBlockType = null;
 592: }
 593: 
 594: function flushTrailingBlockDelta(
 595:   state: StreamTransformState,
 596:   controller: TransformStreamDefaultController<Uint8Array>,
 597:   encoder: TextEncoder
 598: ): void {
 599:   if (state.currentBlockType === "thinking") {
 600:     const trailing = state.thinkingSanitizer.flush();
 601:     if (trailing.length > 0) {
 602:       controller.enqueue(
 603:         sseEvent(encoder, "content_block_delta", {
 604:           type: "content_block_delta",
 605:           index: state.currentBlockIndex,
 606:           delta: { type: "thinking_delta", thinking: trailing },
 607:         })
 608:       );
 609:     }
 610:   } else if (state.currentBlockType === "text") {
 611:     const trailing = state.textSanitizer.flush();
 612:     if (trailing.length > 0) {
 613:       controller.enqueue(
 614:         sseEvent(encoder, "content_block_delta", {
 615:           type: "content_block_delta",
 616:           index: state.currentBlockIndex,
 617:           delta: { type: "text_delta", text: trailing },
 618:         })
 619:       );
 620:     }
 621:   }
 622: }
 623: 
 624: function closeCurrentBlock(
 625:   state: StreamTransformState,
 626:   controller: TransformStreamDefaultController<Uint8Array>,
 627:   encoder: TextEncoder
 628: ): void {
 629:   if (state.currentBlockType !== null && state.openBlockIndices.has(state.currentBlockIndex)) {
 630:     flushTrailingBlockDelta(state, controller, encoder);
 631:     controller.enqueue(
 632:       sseEvent(encoder, "content_block_stop", {
 633:         type: "content_block_stop",
 634:         index: state.currentBlockIndex,
 635:       })
 636:     );
 637:     state.openBlockIndices.delete(state.currentBlockIndex);
 638:     state.currentBlockType = null;
 639:   }
 640: }
 641: 
 642: function processReasoningDelta(
 643:   reasoningDelta: string,
 644:   state: StreamTransformState,
 645:   controller: TransformStreamDefaultController<Uint8Array>,
 646:   encoder: TextEncoder
 647: ): void {
 648:   const sanitized = state.thinkingSanitizer.process(reasoningDelta);
 649:   if (!sanitized) {
 650:     return;
 651:   }
 652:   if (state.currentBlockType !== "thinking") {
 653:     closeCurrentBlock(state, controller, encoder);
 654:     state.currentBlockIndex++;
 655:     state.currentBlockType = "thinking";
 656:     state.openBlockIndices.add(state.currentBlockIndex);
 657:     controller.enqueue(
 658:       sseEvent(encoder, "content_block_start", {
 659:         type: "content_block_start",
 660:         index: state.currentBlockIndex,
 661:         content_block: { type: "thinking", thinking: "" },
 662:       })
 663:     );
 664:   }
 665:   controller.enqueue(
 666:     sseEvent(encoder, "content_block_delta", {
 667:       type: "content_block_delta",
 668:       index: state.currentBlockIndex,
 669:       delta: { type: "thinking_delta", thinking: sanitized },
 670:     })
 671:   );
 672: }
 673: 
 674: function processTextDelta(
 675:   textDelta: string,
 676:   state: StreamTransformState,
 677:   controller: TransformStreamDefaultController<Uint8Array>,
 678:   encoder: TextEncoder
 679: ): void {
 680:   const sanitized = state.textSanitizer.process(textDelta);
 681:   if (!sanitized) {
 682:     return;
 683:   }
 684:   if (state.currentBlockType !== "text") {
 685:     closeCurrentBlock(state, controller, encoder);
 686:     state.currentBlockIndex++;
 687:     state.currentBlockType = "text";
 688:     state.openBlockIndices.add(state.currentBlockIndex);
 689:     controller.enqueue(
 690:       sseEvent(encoder, "content_block_start", {
 691:         type: "content_block_start",
 692:         index: state.currentBlockIndex,
 693:         content_block: { type: "text", text: "" },
 694:       })
 695:     );
 696:   }
 697:   controller.enqueue(
 698:     sseEvent(encoder, "content_block_delta", {
 699:       type: "content_block_delta",
 700:       index: state.currentBlockIndex,
 701:       delta: { type: "text_delta", text: sanitized },
 702:     })
 703:   );
 704: }
 705: 
 706: function startToolCallBlock(
 707:   tc: { id?: string; function?: { name?: string; arguments?: string } },
 708:   tcIdx: number,
 709:   state: StreamTransformState,
 710:   controller: TransformStreamDefaultController<Uint8Array>,
 711:   encoder: TextEncoder
 712: ): ActiveToolInfo {
 713:   closeCurrentBlock(state, controller, encoder);
 714:   state.currentBlockIndex++;
 715:   state.currentBlockType = "tool_use";
 716:   state.openBlockIndices.add(state.currentBlockIndex);
 717:   const toolId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
 718:   const toolName = tc.function?.name || "tool";
 719:   const toolInfo: ActiveToolInfo = { blockIndex: state.currentBlockIndex, id: toolId, name: toolName };
 720:   state.activeToolMap.set(tcIdx, toolInfo);
 721: 
 722:   controller.enqueue(
 723:     sseEvent(encoder, "content_block_start", {
 724:       type: "content_block_start",
 725:       index: state.currentBlockIndex,
 726:       content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
 727:     })
 728:   );
 729:   return toolInfo;
 730: }
 731: 
 732: function processToolCallsDelta(
 733:   toolCalls: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>,
 734:   state: StreamTransformState,
 735:   controller: TransformStreamDefaultController<Uint8Array>,
 736:   encoder: TextEncoder
 737: ): void {
 738:   for (const tc of toolCalls) {
 739:     const tcIdx = typeof tc.index === "number" ? tc.index : 0;
 740:     let toolInfo = state.activeToolMap.get(tcIdx);
 741: 
 742:     if (!toolInfo && (tc.id || tc.function?.name)) {
 743:       toolInfo = startToolCallBlock(tc, tcIdx, state, controller, encoder);
 744:     }
 745: 
 746:     if (tc.function?.arguments && toolInfo) {
 747:       controller.enqueue(
 748:         sseEvent(encoder, "content_block_delta", {
 749:           type: "content_block_delta",
 750:           index: toolInfo.blockIndex,
 751:           delta: { type: "input_json_delta", partial_json: tc.function.arguments },
 752:         })
 753:       );
 754:     }
 755:   }
 756: }
 757: 
 758: function updateUsageTokens(parsed: Record<string, unknown>, state: StreamTransformState): void {
 759:   if (parsed.usage && typeof parsed.usage === "object") {
 760:     const u = parsed.usage as Record<string, unknown>;
 761:     if (typeof u.prompt_tokens === "number") state.accumulatedInputTokens = u.prompt_tokens;
 762:     if (typeof u.completion_tokens === "number") state.accumulatedOutputTokens = u.completion_tokens;
 763:   }
 764: }
 765: 
 766: function handleSseErrorChunk(
 767:   parsed: Record<string, unknown>,
 768:   controller: TransformStreamDefaultController<Uint8Array>,
 769:   encoder: TextEncoder,
 770:   telemetry?: RequestTelemetry
 771: ): boolean {
 772:   if (parsed.error && typeof parsed.error === "object") {
 773:     const errObj = parsed.error as Record<string, unknown>;
 774:     const errMsg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
 775:     const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
 776:     // An in-band upstream error on an already-200 stream is otherwise invisible:
 777:     // no TTFT line, no usage line, and a success row in traces.db. Log it so the
 778:     // failure is countable, and keep the upstream error code instead of masking
 779:     // every upstream failure as the generic "api_error".
 780:     telemetry?.upstreamStreamError?.(`In-band upstream error [${errType}]: ${errMsg}`);
 781:     controller.enqueue(
 782:       sseEvent(encoder, "error", {
 783:         type: "error",
 784:         error: {
 785:           type: errType,
 786:           message: errMsg,
 787:         },
 788:       })
 789:     );
 790:     return true;
 791:   }
 792:   return false;
 793: }
 794: 
 795: interface StreamProcessorContext {
 796:   readonly state: StreamTransformState;
 797:   readonly fallbackModel: string;
 798:   readonly telemetry?: RequestTelemetry;
 799:   ttftMarked: boolean;
 800: }
 801: 
 802: function checkAndMarkTtft(
 803:   ctx: StreamProcessorContext,
 804:   choice?: {
 805:     delta?: {
 806:       content?: string | null;
 807:       reasoning_content?: string | null;
 808:       reasoning?: string | null;
 809:       tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
 810:     };
 811:   }
 812: ): void {
 813:   if (ctx.ttftMarked || !choice?.delta) {
 814:     return;
 815:   }
 816:   const hasContent = Boolean(choice.delta.content && choice.delta.content.length > 0);
 817:   const hasReasoning = Boolean((choice.delta.reasoning_content || choice.delta.reasoning));
 818:   const hasTools = Boolean(choice.delta.tool_calls && choice.delta.tool_calls.length > 0);
 819: 
 820:   if (hasContent || hasReasoning || hasTools) {
 821:     ctx.ttftMarked = true;
 822:     ctx.telemetry?.markTtft?.();
 823:   }
 824: }
 825: 
 826: function processChoiceDeltas(
 827:   choice: {
 828:     delta?: {
 829:       content?: string | null;
 830:       reasoning_content?: string | null;
 831:       reasoning?: string | null;
 832:       tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
 833:     };
 834:     finish_reason?: string | null;
 835:   },
 836:   state: StreamTransformState,
 837:   controller: TransformStreamDefaultController<Uint8Array>,
 838:   encoder: TextEncoder
 839: ): void {
 840:   const reasoningDelta = choice.delta?.reasoning_content || choice.delta?.reasoning;
 841:   if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
 842:     processReasoningDelta(reasoningDelta, state, controller, encoder);
 843:   }
 844: 
 845:   if (choice.delta?.content) {
 846:     processTextDelta(choice.delta.content, state, controller, encoder);
 847:   }
 848: 
 849:   if (Array.isArray(choice.delta?.tool_calls)) {
 850:     processToolCallsDelta(choice.delta.tool_calls, state, controller, encoder);
 851:   }
 852: 
 853:   if (choice.finish_reason) {
 854:     closeAllOpenBlocks(state, controller, encoder);
 855:     state.pendingStopReason = mapOpenAIToAnthropicStopReason(choice.finish_reason, state.activeToolMap.size > 0);
 856:   }
 857: }
 858: 
 859: function handleMissingChoice(
 860:   parsed: Record<string, unknown>,
 861:   state: StreamTransformState,
 862:   controller: TransformStreamDefaultController<Uint8Array>,
 863:   encoder: TextEncoder
 864: ): void {
 865:   if (state.pendingStopReason && !state.messageDeltaSent && parsed.usage) {
 866:     state.messageDeltaSent = true;
 867:     controller.enqueue(
 868:       sseEvent(encoder, "message_delta", {
 869:         type: "message_delta",
 870:         delta: { stop_reason: state.pendingStopReason, stop_sequence: null },
 871:         usage: { output_tokens: state.accumulatedOutputTokens },
 872:       })
 873:     );
 874:   }
 875: }
 876: 
 877: function processParsedChunk(
 878:   rawData: string,
 879:   parsed: Record<string, unknown>,
 880:   ctx: StreamProcessorContext,
 881:   controller: TransformStreamDefaultController<Uint8Array>,
 882:   encoder: TextEncoder
 883: ): void {
 884:   if (handleSseErrorChunk(parsed, controller, encoder, ctx.telemetry)) {
 885:     return;
 886:   }
 887:   if (handleNativeAnthropicPassThrough(rawData, parsed, controller, encoder)) {
 888:     return;
 889:   }
 890: 
 891:   updateUsageTokens(parsed, ctx.state);
 892:   ensureMessageStart(parsed, ctx.fallbackModel, ctx.state, controller, encoder);
 893: 
 894:   const choices = parsed.choices as Array<{
 895:     delta?: {
 896:       content?: string | null;
 897:       reasoning_content?: string | null;
 898:       reasoning?: string | null;
 899:       tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
 900:     };
 901:     finish_reason?: string | null;
 902:   }> | undefined;
 903: 
 904:   const choice = choices?.[0];
 905:   if (!choice) {
 906:     handleMissingChoice(parsed, ctx.state, controller, encoder);
 907:     return;
 908:   }
 909: 
 910:   checkAndMarkTtft(ctx, choice);
 911:   processChoiceDeltas(choice, ctx.state, controller, encoder);
 912: }
 913: 
 914: function parseSseDataLine(rawLine: string): string | null {
 915:   const line = rawLine.trim();
 916:   if (!line || line.startsWith(":")) {
 917:     return null;
 918:   }
 919:   const dataMatch = line.match(/^data:\s*(.*)$/);
 920:   if (!dataMatch || dataMatch[1] === undefined) {
 921:     return null;
 922:   }
 923:   const rawData = dataMatch[1].trim();
 924:   if (!rawData || rawData === "[DONE]") {
 925:     return null;
 926:   }
 927:   return rawData;
 928: }
 929: 
 930: export function createAnthropicXWireStreamTransformer(
 931:   telemetry?: RequestTelemetry,
 932:   clientSignal?: AbortSignal,
 933:   fallbackModel = "unknown"
 934: ): TransformStream<Uint8Array, Uint8Array> {
 935:   const decoder = new TextDecoder();
 936:   const encoder = new TextEncoder();
 937:   const state: StreamTransformState = {
 938:     msgStartSent: false,
 939:     currentBlockIndex: -1,
 940:     currentBlockType: null,
 941:     messageDeltaSent: false,
 942:     accumulatedInputTokens: 0,
 943:     accumulatedOutputTokens: 0,
 944:     activeToolMap: new Map<number, ActiveToolInfo>(),
 945:     openBlockIndices: new Set<number>(),
 946:     pendingStopReason: null,
 947:     thinkingSanitizer: new TagSanitizerStreamBuffer(),
 948:     textSanitizer: new TagSanitizerStreamBuffer(),
 949:   };
 950: 
 951:   const ctx: StreamProcessorContext = {
 952:     state,
 953:     fallbackModel,
 954:     telemetry,
 955:     ttftMarked: false,
 956:   };
 957: 
 958:   let buffer = "";
 959: 
 960:   const processLine = (rawLine: string, controller: TransformStreamDefaultController<Uint8Array>) => {
 961:     const rawData = parseSseDataLine(rawLine);
 962:     if (!rawData) {
 963:       return;
 964:     }
 965:     let parsed: Record<string, unknown>;
 966:     try {
 967:       parsed = JSON.parse(rawData) as Record<string, unknown>;
 968:     } catch {
 969:       return;
 970:     }
 971:     processParsedChunk(rawData, parsed, ctx, controller, encoder);
 972:   };
 973: 
 974:   return new TransformStream<Uint8Array, Uint8Array>({
 975:     transform(chunk, controller) {
 976:       if (clientSignal?.aborted) {
 977:         return;
 978:       }
 979:       buffer += decoder.decode(chunk, { stream: true });
 980:       buffer = buffer.replace(/\r\n/g, "\n");
 981:       const lines = buffer.split("\n");
 982:       buffer = lines.pop() ?? "";
 983: 
 984:       for (const line of lines) {
 985:         processLine(line, controller);
 986:       }
 987:     },
 988:     flush(controller) {
 989:       if (clientSignal?.aborted) {
 990:         return;
 991:       }
 992:       if (buffer.length > 0) {
 993:         processLine(buffer, controller);
 994:       }
 995:       closeAllOpenBlocks(state, controller, encoder);
 996:       if (!state.messageDeltaSent) {
 997:         state.messageDeltaSent = true;
 998:         const finalStopReason = state.pendingStopReason || "end_turn";
 999:         controller.enqueue(
1000:           sseEvent(encoder, "message_delta", {
1001:             type: "message_delta",
1002:             delta: { stop_reason: finalStopReason, stop_sequence: null },
1003:             usage: { output_tokens: state.accumulatedOutputTokens },
1004:           })
1005:         );
1006:       }
1007:       controller.enqueue(sseEvent(encoder, "message_stop", { type: "message_stop" }));
1008: 
1009:       const record: UsageRecord = {
1010:         promptTokens: state.accumulatedInputTokens,
1011:         completionTokens: state.accumulatedOutputTokens,
1012:         totalTokens: state.accumulatedInputTokens + state.accumulatedOutputTokens,
1013:         finishReason: state.pendingStopReason || "end_turn",
1014:       };
1015:       telemetry?.recordUsage?.(record);
1016:     },
1017:   });
1018: }
1019: 
1020: export class AnthropicOpenAIXWireTransformer implements PayloadTransformerContract {
1021:   transformClientToWire(
1022:     inboundBody: Record<string, unknown>,
1023:     _directive: ParsedDirective,
1024:     _headers: Headers
1025:   ): OutboundWirePayload {
1026:     const openAiPayload = translateAnthropicToOpenAI(inboundBody as unknown as AnthropicMessagesRequest);
1027:     return {
1028:       endpointKey: "ch",
1029:       method: "POST",
1030:       headers: { "Content-Type": "application/json" },
1031:       body: openAiPayload as Record<string, unknown>,
1032:       isStreaming: Boolean(inboundBody.stream),
1033:     };
1034:   }
1035: 
1036:   transformWireToClient(
1037:     upstreamJson: unknown,
1038:     _directive: ParsedDirective
1039:   ): unknown {
1040:     const jsonRec = typeof upstreamJson === "object" && upstreamJson !== null
1041:       ? (upstreamJson as Record<string, unknown>)
1042:       : {};
1043:     const model = typeof jsonRec.model === "string" ? jsonRec.model : "unknown";
1044:     return translateOpenAIToAnthropicResponse(jsonRec, model);
1045:   }
1046: 
1047:   createWireToClientStream(
1048:     _directive: ParsedDirective,
1049:     telemetry: RequestTelemetry,
1050:     clientSignal: AbortSignal
1051:   ): TransformStream<Uint8Array, Uint8Array> {
1052:     return createAnthropicXWireStreamTransformer(telemetry, clientSignal);
1053:   }
1054: }
1055: 
1056: export const anthropicOpenAiXWireTransformer = new AnthropicOpenAIXWireTransformer();
```

## File: src/transformers/google_native.ts
```typescript
  1: import type { ParsedDirective } from "../directive/types";
  2: import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
  3: import type { RequestTelemetry } from "../telemetry/session";
  4: 
  5: export interface GoogleUsage {
  6:   readonly promptTokens: number;
  7:   readonly completionTokens: number;
  8:   readonly totalTokens: number;
  9: }
 10: 
 11: export function extractNumberByPattern(text: string, pattern: RegExp): number {
 12:   const match = text.match(pattern);
 13:   return match ? Number(match[1]) : 0;
 14: }
 15: 
 16: export function parseFinishReason(text: string): string | null {
 17:   if (!text.includes("finishReason") && !text.includes("finish_reason")) {
 18:     return null;
 19:   }
 20:   const match = text.match(/"finish_?reason"\s*:\s*"([^"]+)"/i);
 21:   return match?.[1] ?? null;
 22: }
 23: 
 24: export function parseUsageMetadata(text: string): GoogleUsage | null {
 25:   if (!text.includes("usageMetadata") && !text.includes("usage_metadata")) {
 26:     return null;
 27:   }
 28:   const promptTokens = extractNumberByPattern(text, /"promptTokenCount"\s*:\s*(\d+)/i);
 29:   const completionTokens = extractNumberByPattern(text, /"candidatesTokenCount"\s*:\s*(\d+)/i);
 30:   const totalRaw = extractNumberByPattern(text, /"totalTokenCount"\s*:\s*(\d+)/i);
 31:   const totalTokens = totalRaw > 0 ? totalRaw : promptTokens + completionTokens;
 32:   if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
 33:     return null;
 34:   }
 35:   return { promptTokens, completionTokens, totalTokens };
 36: }
 37: 
 38: export function isContentChunk(text: string): boolean {
 39:   return (
 40:     text.includes('"candidates"') ||
 41:     text.includes('"content"') ||
 42:     text.includes('"parts"') ||
 43:     text.includes('"text"')
 44:   );
 45: }
 46: 
 47: export function resolveEndpointKey(directive: ParsedDirective): string {
 48:   if ("completion" in directive && directive.completion === "ch") {
 49:     return "ch";
 50:   }
 51:   return "gc";
 52: }
 53: 
 54: export function resolveIsStreaming(
 55:   inboundBody: Record<string, unknown>,
 56:   directive: ParsedDirective
 57: ): boolean {
 58:   if (Boolean(inboundBody.stream)) {
 59:     return true;
 60:   }
 61:   if (
 62:     (typeof inboundBody.path === "string" &&
 63:       inboundBody.path.includes(":streamGenerateContent")) ||
 64:     (typeof inboundBody.endpoint === "string" &&
 65:       inboundBody.endpoint.includes(":streamGenerateContent")) ||
 66:     (typeof inboundBody.url === "string" &&
 67:       inboundBody.url.includes(":streamGenerateContent"))
 68:   ) {
 69:     return true;
 70:   }
 71:   return (
 72:     "completion" in directive &&
 73:     (directive.completion === "gc" || directive.completion === "g1")
 74:   );
 75: }
 76: 
 77: function processChunkTtft(
 78:   buffer: string,
 79:   ttftMarked: boolean,
 80:   telemetry: RequestTelemetry
 81: ): boolean {
 82:   if (ttftMarked) {
 83:     return true;
 84:   }
 85:   if (isContentChunk(buffer)) {
 86:     telemetry.markTtft();
 87:     return true;
 88:   }
 89:   return false;
 90: }
 91: 
 92: function processChunkUsage(
 93:   buffer: string,
 94:   usageRecorded: boolean,
 95:   finishReason: string | null,
 96:   telemetry: RequestTelemetry
 97: ): boolean {
 98:   if (usageRecorded) {
 99:     return true;
100:   }
101:   const usage = parseUsageMetadata(buffer);
102:   if (!usage) {
103:     return false;
104:   }
105:   telemetry.recordUsage({
106:     promptTokens: usage.promptTokens,
107:     completionTokens: usage.completionTokens,
108:     totalTokens: usage.totalTokens,
109:     finishReason: finishReason ? finishReason.toLowerCase() : null,
110:   });
111:   return true;
112: }
113: 
114: export class GoogleNativeTransformer implements PayloadTransformerContract {
115:   transformClientToWire(
116:     inboundBody: Record<string, unknown>,
117:     directive: ParsedDirective,
118:     _headers: Headers
119:   ): OutboundWirePayload {
120:     return {
121:       endpointKey: resolveEndpointKey(directive),
122:       method: "POST",
123:       headers: { "Content-Type": "application/json" },
124:       body: inboundBody,
125:       isStreaming: resolveIsStreaming(inboundBody, directive),
126:     };
127:   }
128: 
129:   transformWireToClient(
130:     upstreamJson: unknown,
131:     _directive: ParsedDirective
132:   ): unknown {
133:     return upstreamJson;
134:   }
135: 
136:   createWireToClientStream(
137:     _directive: ParsedDirective,
138:     telemetry: RequestTelemetry,
139:     clientSignal: AbortSignal
140:   ): TransformStream<Uint8Array, Uint8Array> {
141:     const decoder = new TextDecoder();
142:     let buffer = "";
143:     let ttftMarked = false;
144:     let usageRecorded = false;
145:     let latestFinishReason: string | null = null;
146: 
147:     return new TransformStream<Uint8Array, Uint8Array>({
148:       transform(chunk, controller) {
149:         if (clientSignal.aborted || chunk.byteLength === 0) {
150:           return;
151:         }
152:         const text = decoder.decode(chunk, { stream: true });
153:         buffer = (buffer + text).slice(-65536);
154: 
155:         ttftMarked = processChunkTtft(buffer, ttftMarked, telemetry);
156:         latestFinishReason = parseFinishReason(buffer) ?? latestFinishReason;
157:         usageRecorded = processChunkUsage(buffer, usageRecorded, latestFinishReason, telemetry);
158: 
159:         controller.enqueue(chunk);
160:       },
161: 
162:       flush(_controller) {
163:         const remaining = decoder.decode();
164:         if (remaining.length > 0) {
165:           buffer = (buffer + remaining).slice(-65536);
166:         }
167:         processChunkUsage(buffer, usageRecorded, latestFinishReason, telemetry);
168:         buffer = "";
169:       },
170:     });
171:   }
172: }
173: 
174: export const googleNativeTransformer = new GoogleNativeTransformer();
```

## File: src/lib.ts
```typescript
 1: export * from "./config/env";
 2: export * from "./config/keys";
 3: export {
 4:   RateLimitSchema,
 5:   ProviderEndpointsSchema,
 6:   ProviderConfigEntrySchema,
 7:   ProvidersConfigSchema,
 8:   FusionTierSchema,
 9:   FusionModelConfigSchema,
10:   FusionPresetSchema,
11:   FusionConfigSchema,
12:   ModelCatalogEntrySchema,
13:   ModelsConfigSchema,
14:   EnvConfigSchema,
15:   type RateLimit,
16:   type ProviderConfigEntry,
17:   type ProvidersConfig,
18:   type FusionTier,
19:   type FusionModelConfig,
20:   type FusionPreset,
21:   type FusionConfig,
22:   type ModelCatalogEntry,
23:   type ModelsConfig,
24:   type EnvConfig,
25: } from "./config/schema";
26: export * from "./directive/parser";
27: export * from "./directive/validator";
28: export * from "./fusion/engine";
29: export * from "./fusion/sticky";
30: export * from "./handlers/anthropic_compat";
31: export * from "./handlers/discovery";
32: export * from "./handlers/gcp_compat";
33: export * from "./handlers/google_native";
34: export * from "./handlers/openai_compat";
35: export * from "./network/classifier";
36: export * from "./network/cooldown";
37: export * from "./network/fetcher";
38: export * from "./network/pool";
39: export * from "./transformers/dots";
40: export * from "./transformers/ling";
41: export * from "./transformers/nuances";
42: export * from "./transformers/opencode_adapter";
43: export * from "./transformers/payload";
44: export * from "./transformers/thinking";
45: export * from "./ui/banner";
46: export * from "./ui/logger";
47: export * from "./ui/telemetry";
48: export {
49:   createServer,
50:   handleAppRequest,
51:   handleHardReset,
52:   resetAllState,
53:   getCooldownState,
54: } from "./index";
```

## File: bunfig.toml
```toml
1: [test]
2: root = "tests/unit"
3: preload = ["./tests/preload.ts"]
4: pathIgnorePatterns = ["tests/integration/*", "tests/eval/*"]
```

## File: src/config/env.ts
```typescript
  1: import { EnvConfigSchema, type EnvConfig, type LiteRouterEngine } from "./schema";
  2: 
  3: const DEFAULT_ENV_RECORD: Record<string, string> = {
  4:   LITEROUTER_PORT: "7766",
  5:   LITEROUTER_HOST: "0.0.0.0",
  6:   LITEROUTER_AUTH_KEY: "",
  7:   LITEROUTER_TLS_ENABLED: "false",
  8:   LITEROUTER_HTTP2: "true",
  9:   LITEROUTER_STRIP_REASONING: "false",
 10:   LITEROUTER_AO_STRIP_REASONING: "true",
 11:   LITEROUTER_AO_MAX_TOKENS: "32768",
 12:   LITEROUTER_ENABLE_SCRUBBING: "false",
 13:   LITEROUTER_TTFT_TIMEOUT_MS: "120000",
 14:   LITEROUTER_NO_RESPONSE_TIMEOUT_MS: "120000",
 15:   LITEROUTER_STREAM_IDLE_TIMEOUT_MS: "120000",
 16:   LITEROUTER_HTTP_TIMEOUT_MS: "300000",
 17:   LITEROUTER_IDLE_TIMEOUT_SEC: "60",
 18:   COOLDOWN_RATE_LIMIT_TTL_SEC: "65",
 19:   COOLDOWN_SERVER_ERROR_TTL_SEC: "10",
 20:   COOLDOWN_AUTH_ERROR_TTL_SEC: "604800",
 21:   FUSION_STICKY_TTL_MS: "300000",
 22:   STREAM_STALL_MAX_RESENDS: "2",
 23:   KEEPALIVE_INTERVAL_MS: "15000",
 24:   LITEROUTER_HTTP_REFERER: "https://opencode.ai",
 25:   LITEROUTER_X_TITLE: "OpenCode",
 26:   LITEROUTER_USER_AGENT: "OpenCode/1.0.0",
 27:   LITEROUTER_H2_OUTBOUND: "true",
 28:   LITEROUTER_PACER_ENABLED: "true",
 29:   LITEROUTER_CIRCUIT_BREAKER: "true",
 30:   LITEROUTER_PACER_MAX_RPM: "600",
 31:   LITEROUTER_PACER_MAX_QUEUE_DEPTH: "100",
 32:   LITEROUTER_PACER_MAX_QUEUE_WAIT_MS: "15000",
 33:   NVIDIA_MIN_DELAY_MS: "200",
 34:   GOOGLE_MIN_DELAY_MS: "200",
 35:   TEST_PROVIDER_MIN_DELAY_MS: "0",
 36:   MOCK_TP_PORT: "8999",
 37:   LOG_LEVEL: "info",
 38:   LITEROUTER_ENGINE: "v4.1",
 39:   LITEROUTER_ENGINE_OVERRIDE: "false",
 40: };
 41: 
 42: function parseSafeEnv(source: Record<string, string | undefined>): EnvConfig {
 43:   const normalized: Record<string, string | undefined> = { ...source };
 44:   if (normalized.LITEROUTER_ENGINE === "v4") {
 45:     normalized.LITEROUTER_ENGINE = "v4.1";
 46:   }
 47:   if (!normalized.LITEROUTER_IDLE_TIMEOUT_SEC && normalized.LITEROUTER_IDLE_TIMEOUT) {
 48:     normalized.LITEROUTER_IDLE_TIMEOUT_SEC = normalized.LITEROUTER_IDLE_TIMEOUT;
 49:   }
 50:   if (!normalized.LITEROUTER_STREAM_IDLE_TIMEOUT_MS && normalized.LITEROUTER_STREAM_IDLE_TIMEOUT) {
 51:     const val = Number(normalized.LITEROUTER_STREAM_IDLE_TIMEOUT);
 52:     normalized.LITEROUTER_STREAM_IDLE_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
 53:   }
 54:   if (!normalized.LITEROUTER_HTTP_TIMEOUT_MS && normalized.LITEROUTER_HTTP_TIMEOUT) {
 55:     const val = Number(normalized.LITEROUTER_HTTP_TIMEOUT);
 56:     normalized.LITEROUTER_HTTP_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
 57:   }
 58:   if (!normalized.LITEROUTER_TTFT_TIMEOUT_MS && normalized.LITEROUTER_TTFT_TIMEOUT) {
 59:     const val = Number(normalized.LITEROUTER_TTFT_TIMEOUT);
 60:     normalized.LITEROUTER_TTFT_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
 61:   }
 62:   if (!normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS && normalized.LITEROUTER_NO_RESPONSE_TIMEOUT) {
 63:     const val = Number(normalized.LITEROUTER_NO_RESPONSE_TIMEOUT);
 64:     normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
 65:   }
 66:   if (!normalized.LITEROUTER_TTFT_TIMEOUT_MS && normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS) {
 67:     normalized.LITEROUTER_TTFT_TIMEOUT_MS = normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
 68:   }
 69:   if (!normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS && normalized.LITEROUTER_TTFT_TIMEOUT_MS) {
 70:     normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS = normalized.LITEROUTER_TTFT_TIMEOUT_MS;
 71:   }
 72:   if (normalized.LITEROUTER_HTTP2 === undefined && normalized.LITEROUTER_ENFORCE_HTTP2 !== undefined) {
 73:     normalized.LITEROUTER_HTTP2 = normalized.LITEROUTER_ENFORCE_HTTP2;
 74:   }
 75:   if (!normalized.LITEROUTER_HTTP_REFERER) {
 76:     normalized.LITEROUTER_HTTP_REFERER = "https://opencode.ai";
 77:   }
 78:   if (!normalized.LITEROUTER_X_TITLE) {
 79:     normalized.LITEROUTER_X_TITLE = "OpenCode";
 80:   }
 81:   if (!normalized.LITEROUTER_USER_AGENT) {
 82:     normalized.LITEROUTER_USER_AGENT = "OpenCode/1.0.0";
 83:   }
 84:   const result = EnvConfigSchema.safeParse(normalized);
 85:   if (result.success) {
 86:     return result.data;
 87:   }
 88:   const fallback = EnvConfigSchema.parse(DEFAULT_ENV_RECORD);
 89:   return fallback;
 90: }
 91: 
 92: let cachedEnv: EnvConfig | null = null;
 93: 
 94: export function getEnv(): EnvConfig {
 95:   if (cachedEnv !== null) {
 96:     return cachedEnv;
 97:   }
 98:   cachedEnv = parseSafeEnv(process.env);
 99:   return cachedEnv;
100: }
101: 
102: export function resetEnvCache(): void {
103:   cachedEnv = null;
104: }
105: 
106: export function parseCustomEnv(customRecord: Record<string, string | undefined>): EnvConfig {
107:   return parseSafeEnv(customRecord);
108: }
109: 
110: export type { LiteRouterEngine };
111: 
112: export function getLiteRouterEngine(): LiteRouterEngine {
113:   return getEnv().LITEROUTER_ENGINE;
114: }
115: 
116: export function isLiteRouterEngineOverrideEnabled(): boolean {
117:   return getEnv().LITEROUTER_ENGINE_OVERRIDE;
118: }
119: 
120: export function resolveEngine(req?: Request): LiteRouterEngine {
121:   const env = getEnv();
122:   if (!env.LITEROUTER_ENGINE_OVERRIDE || !req) {
123:     return env.LITEROUTER_ENGINE;
124:   }
125:   const override = req.headers.get("x-literouter-engine")?.toLowerCase().trim();
126:   if (override === "legacy" || override === "v4.1") {
127:     return override;
128:   }
129:   return env.LITEROUTER_ENGINE;
130: }
131: 
132: export function isV4Engine(req?: Request): boolean {
133:   return resolveEngine(req) === "v4.1";
134: }
```

## File: src/engine/strategies/native_cascade.ts
```typescript
  1: import {
  2:   getNativeChain,
  3:   getNativeTierIndex,
  4:   setNativeTierIndex,
  5: } from "../../handlers/google_native";
  6: import type { DispatchContext, ProviderExecutionStrategy } from "../strategy";
  7: 
  8: function extractDirectiveModel(directive: unknown): string {
  9:   if (directive && typeof directive === "object" && "model" in directive) {
 10:     const val = (directive as { model?: unknown }).model;
 11:     return typeof val === "string" ? val : "";
 12:   }
 13:   return "";
 14: }
 15: 
 16: export class NativeCascadeStrategy implements ProviderExecutionStrategy {
 17:   private readonly chains?: Record<string, readonly string[]>;
 18: 
 19:   constructor(chains?: Record<string, readonly string[]>) {
 20:     this.chains = chains;
 21:   }
 22: 
 23:   private resolveChain(model: string): readonly string[] | undefined {
 24:     if (this.chains) {
 25:       return this.chains[model];
 26:     }
 27:     const dynamicChain = getNativeChain(model);
 28:     return dynamicChain.length > 0 ? dynamicChain : undefined;
 29:   }
 30: 
 31:   private buildGoogleUrl(ctx: DispatchContext, model: string): string {
 32:     const base = ctx.providerConfig.base_url.replace(/\/+$/, "");
 33:     const completionCode =
 34:       ctx.directive.type === "direct" ? ctx.directive.completion : "gc";
 35:     const endpointTemplate = ctx.providerConfig.endpoints[completionCode];
 36:     if (!endpointTemplate) {
 37:       throw new Error(
 38:         `No endpoint for completion code "${completionCode}" on provider "${ctx.providerConfig.code}"`
 39:       );
 40:     }
 41:     let path = endpointTemplate.replace("{model}", model);
 42:     if (
 43:       (completionCode === "gc" || completionCode === "g1") &&
 44:       ctx.path?.includes(":streamGenerateContent")
 45:     ) {
 46:       path = path.replace(":generateContent", ":streamGenerateContent");
 47:     }
 48:     let normalizedPath = path.startsWith("/") ? path : `/${path}`;
 49:     if (ctx.path?.includes("?")) {
 50:       const qIndex = ctx.path.indexOf("?");
 51:       const inboundParams = new URLSearchParams(ctx.path.slice(qIndex + 1));
 52:       if (inboundParams.has("key")) {
 53:         inboundParams.delete("key");
 54:       }
 55:       const qSplitIndex = normalizedPath.indexOf("?");
 56:       const pathname =
 57:         qSplitIndex === -1 ? normalizedPath : normalizedPath.slice(0, qSplitIndex);
 58:       const existingQuery =
 59:         qSplitIndex === -1 ? "" : normalizedPath.slice(qSplitIndex + 1);
 60:       if (existingQuery) {
 61:         const params = new URLSearchParams(existingQuery);
 62:         for (const [k, v] of inboundParams.entries()) {
 63:           if (!params.has(k)) {
 64:             params.set(k, v);
 65:           }
 66:         }
 67:         const qs = params.toString();
 68:         normalizedPath = qs ? `${pathname}?${qs}` : pathname;
 69:       } else {
 70:         const qs = inboundParams.toString();
 71:         normalizedPath = qs ? `${pathname}?${qs}` : pathname;
 72:       }
 73:     }
 74:     return `${base}${normalizedPath}`;
 75:   }
 76: 
 77:   resolveTarget(
 78:     ctx: DispatchContext,
 79:     body: Record<string, unknown>
 80:   ): {
 81:     model: string;
 82:     upstreamUrl: string;
 83:     extraHeaders?: Record<string, string>;
 84:   } {
 85:     const pathModel = ctx.path?.match(/\/models\/([^:]+)/)?.[1];
 86:     const fallbackModel = pathModel || extractDirectiveModel(ctx.directive);
 87:     const requestedModel =
 88:       typeof body.model === "string" && body.model.length > 0
 89:         ? body.model
 90:         : fallbackModel;
 91:     const chain = this.resolveChain(requestedModel);
 92: 
 93:     if (!chain || chain.length === 0) {
 94:       return {
 95:         model: requestedModel,
 96:         upstreamUrl: this.buildGoogleUrl(ctx, requestedModel),
 97:       };
 98:     }
 99: 
100:     const tierIdx = getNativeTierIndex(requestedModel);
101:     const resolvedModel =
102:       chain[((tierIdx % chain.length) + chain.length) % chain.length] ?? requestedModel;
103: 
104:     return {
105:       model: resolvedModel,
106:       upstreamUrl: this.buildGoogleUrl(ctx, resolvedModel),
107:       extraHeaders: {
108:         "x-literouter-chain": requestedModel,
109:         "x-literouter-tier": `${tierIdx + 1}/${chain.length}`,
110:       },
111:     };
112:   }
113: 
114:   classifyFailure(
115:     ctx: DispatchContext,
116:     status: number,
117:     _body?: string
118:   ): "retry_same_target" | "advance_target" | "fail_fast" {
119:     const requestedModel = extractDirectiveModel(ctx.directive);
120:     const chain = this.resolveChain(requestedModel);
121: 
122:     if (chain && chain.length > 0 && status === 404) {
123:       const currentIdx = getNativeTierIndex(requestedModel);
124:       const nextIdx = (currentIdx + 1) % chain.length;
125:       setNativeTierIndex(requestedModel, nextIdx);
126:       return "advance_target";
127:     }
128: 
129:     if (status === 429 || (status >= 500 && status <= 504)) {
130:       return "retry_same_target";
131:     }
132: 
133:     return "fail_fast";
134:   }
135: 
136:   buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
137:     return {
138:       "x-goog-api-key": key,
139:       "Content-Type": "application/json",
140:     };
141:   }
142: }
```

## File: src/engine/session_id.ts
```typescript
 1: const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
 2: 
 3: export const SESSION_HEADER_KEYS = [
 4:   "session-id",
 5:   "x-session-id",
 6:   "x-opencode-session",
 7:   "x-opencode-session-id",
 8:   "opencode-session-id",
 9:   "opencode-session",
10: ] as const;
11: 
12: export function generateOpenCodeSessionId(): string {
13:   const hexBytes = new Uint8Array(4);
14:   crypto.getRandomValues(hexBytes);
15:   let hex8 = "";
16:   for (let i = 0; i < 4; i++) {
17:     hex8 += (hexBytes[i] ?? 0).toString(16).padStart(2, "0");
18:   }
19:   const tailBytes = new Uint8Array(14);
20:   crypto.getRandomValues(tailBytes);
21:   let tail14 = "";
22:   for (let i = 0; i < 14; i++) {
23:     tail14 += BASE62_CHARS.charAt((tailBytes[i] ?? 0) % BASE62_CHARS.length);
24:   }
25:   return `ses_${hex8}8ffe${tail14}`;
26: }
27: 
28: function getFromHeadersObject(headers: Headers, key: string): string | undefined {
29:   const val = headers.get(key);
30:   return val ?? undefined;
31: }
32: 
33: function getFromRecord(rec: Record<string, string>, targetKey: string): string | undefined {
34:   const target = targetKey.toLowerCase();
35:   for (const [k, v] of Object.entries(rec)) {
36:     if (k.toLowerCase() === target && v) {
37:       return v;
38:     }
39:   }
40:   return undefined;
41: }
42: 
43: export function getHeaderValue(
44:   headers: Headers | Record<string, string> | undefined,
45:   targetKey: string
46: ): string | undefined {
47:   if (!headers) return undefined;
48:   if (typeof (headers as Headers).get === "function") {
49:     return getFromHeadersObject(headers as Headers, targetKey);
50:   }
51:   return getFromRecord(headers as Record<string, string>, targetKey);
52: }
53: 
54: export function extractClientSessionId(
55:   headers?: Headers | Record<string, string>
56: ): string | undefined {
57:   if (!headers) return undefined;
58:   for (const key of SESSION_HEADER_KEYS) {
59:     const val = getHeaderValue(headers, key);
60:     if (val) {
61:       return val;
62:     }
63:   }
64:   return undefined;
65: }
66: 
67: export function ensureSessionHeaders(
68:   targetHeaders: Record<string, string>,
69:   clientHeaders?: Headers | Record<string, string>
70: ): void {
71:   const clientSession = extractClientSessionId(clientHeaders);
72:   const targetSession = extractClientSessionId(targetHeaders);
73:   const activeSession = clientSession ?? targetSession;
74: 
75:   if (activeSession) {
76:     targetHeaders["session-id"] = activeSession;
77:     const existingXSession =
78:       getHeaderValue(clientHeaders, "x-session-id") ??
79:       getHeaderValue(targetHeaders, "x-session-id");
80:     if (existingXSession) {
81:       targetHeaders["x-session-id"] = existingXSession;
82:     }
83:     return;
84:   }
85: 
86:   const generated = generateOpenCodeSessionId();
87:   targetHeaders["session-id"] = generated;
88:   targetHeaders["x-session-id"] = generated;
89: }
```

## File: src/engine/strategy_registry.ts
```typescript
 1: import { getAllProviders } from "../config/providers";
 2: import type { ProviderConfigEntry } from "../config/schema";
 3: import { AnthropicDirectStrategy } from "./strategies/anthropic_direct";
 4: import { GcpGuardedStrategy } from "./strategies/gcp_guarded";
 5: import { NativeCascadeStrategy } from "./strategies/native_cascade";
 6: import { StandardStrategy } from "./strategies/standard";
 7: import { ZenStrategy } from "./strategies/zen";
 8: import type { ProviderExecutionStrategy } from "./strategy";
 9: 
10: type StrategyFactory = () => ProviderExecutionStrategy;
11: 
12: const strategyMap = new Map<string, ProviderExecutionStrategy>();
13: const factories = new Map<string, StrategyFactory>();
14: 
15: function registerDefaultFactories(): void {
16:   if (!factories.has("standard")) {
17:     factories.set("standard", () => new StandardStrategy());
18:   }
19:   if (!factories.has("native_cascade")) {
20:     factories.set("native_cascade", () => new NativeCascadeStrategy());
21:   }
22:   if (!factories.has("gcp_guarded")) {
23:     factories.set("gcp_guarded", () => new GcpGuardedStrategy());
24:   }
25:   if (!factories.has("anthropic_direct")) {
26:     factories.set("anthropic_direct", () => new AnthropicDirectStrategy());
27:   }
28:   if (!factories.has("zen")) {
29:     factories.set("zen", () => new ZenStrategy());
30:   }
31: }
32: 
33: registerDefaultFactories();
34: 
35: export function registerStrategyFactory(
36:   type: string,
37:   factory: () => ProviderExecutionStrategy
38: ): void {
39:   factories.set(type.toLowerCase(), factory);
40: }
41: 
42: export function unregisterStrategyFactory(type: string): void {
43:   factories.delete(type.toLowerCase());
44: }
45: 
46: export function initStrategyRegistry(): void {
47:   registerDefaultFactories();
48:   strategyMap.clear();
49:   let providers: readonly ProviderConfigEntry[] = [];
50:   try {
51:     providers = getAllProviders();
52:   } catch {
53:     providers = [];
54:   }
55: 
56:   for (const prov of providers) {
57:     const strategyType = (prov.strategy ?? "standard").toLowerCase();
58:     const factory = factories.get(strategyType);
59:     if (factory) {
60:       strategyMap.set(prov.code.toLowerCase(), factory());
61:     } else {
62:       throw new Error(
63:         `Unknown strategy "${strategyType}" for provider "${prov.code}"`
64:       );
65:     }
66:   }
67: }
68: 
69: export function getStrategy(providerCode: string): ProviderExecutionStrategy {
70:   const norm = providerCode.toLowerCase();
71:   const strategy = strategyMap.get(norm);
72:   if (!strategy) {
73:     throw new Error(`[StrategyRegistry] No strategy registered for provider "${providerCode}". Check config/providers.json strategy field.`);
74:   }
75:   return strategy;
76: }
77: 
78: export function resetStrategyRegistry(): void {
79:   strategyMap.clear();
80:   factories.clear();
81:   registerDefaultFactories();
82: }
```

## File: src/handlers/v4/google_native.ts
```typescript
 1: import { executeDispatchPipeline, type DispatchRequest } from "../../engine/dispatch";
 2: import { parseDirectiveKey } from "../../directive/parser";
 3: import { googleNativeTransformer } from "../../transformers/google_native";
 4: 
 5: export async function handleGoogleNative(
 6:   req: Request,
 7:   rawKey: string,
 8:   reqId: string = crypto.randomUUID()
 9: ): Promise<Response> {
10:   let body: Record<string, unknown> = {};
11:   const text = await req.text();
12:   if (text.trim()) {
13:     try {
14:       body = JSON.parse(text) as Record<string, unknown>;
15:     } catch {
16:       return Response.json(
17:         { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
18:         { status: 400 }
19:       );
20:     }
21:   }
22: 
23:   const directive = parseDirectiveKey(rawKey);
24:   if (!directive) {
25:     return Response.json(
26:       { error: { message: `Invalid directive: ${rawKey}`, type: "invalid_request_error" } },
27:       { status: 400 }
28:     );
29:   }
30: 
31:   const url = new URL(req.url);
32:   if (!body.model) {
33:     const match = url.pathname.match(/\/(?:v1beta|v1)\/models\/([^:]+)/);
34:     if (match?.[1]) {
35:       body.model = match[1];
36:     }
37:   }
38: 
39:   const outboundPayload = googleNativeTransformer.transformClientToWire(body, directive, req.headers);
40:   const dispatchReq: DispatchRequest = {
41:     reqId,
42:     method: req.method,
43:     path: `${url.pathname}${url.search}`,
44:     directive,
45:     rawInboundBody: body,
46:     outboundPayload,
47:     clientSignal: req.signal,
48:     clientHeaders: req.headers,
49:     transformer: googleNativeTransformer,
50:   };
51: 
52:   return executeDispatchPipeline(dispatchReq);
53: }
54: 
55: export const handleV4GoogleNative = handleGoogleNative;
```

## File: src/network/circuit_breaker.ts
```typescript
  1: export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
  2: 
  3: export interface CircuitBreakerConfig {
  4:   readonly failureThreshold: number; // e.g. 5 consecutive 5xx/529
  5:   readonly cooldownMs: number; // e.g. 60_000ms
  6:   readonly maxCanaryDurationMs?: number; // e.g. 60_000ms
  7: }
  8: 
  9: export class ProviderCircuitBreaker {
 10:   private state: CircuitState = "CLOSED";
 11:   private failureCount = 0;
 12:   private nextProbeTimeMs = 0;
 13:   private isCanaryInFlight = false;
 14:   private canaryLockTimestampMs = 0;
 15:   private readonly maxCanaryDurationMs: number;
 16: 
 17:   constructor(
 18:     public readonly providerName: string,
 19:     private readonly config: CircuitBreakerConfig = { failureThreshold: 5, cooldownMs: 60000 }
 20:   ) {
 21:     this.maxCanaryDurationMs = config.maxCanaryDurationMs ?? 60000;
 22:   }
 23: 
 24:   /**
 25:    * Evaluates if traffic is allowed.
 26:    * In HALF_OPEN, permits ONLY ONE concurrent canary request with a 60s expiring lease.
 27:    */
 28:   public isAvailable(): boolean {
 29:     const now = Date.now();
 30:     if (this.state === "OPEN") {
 31:       if (now >= this.nextProbeTimeMs) {
 32:         this.state = "HALF_OPEN";
 33:         this.isCanaryInFlight = true;
 34:         this.canaryLockTimestampMs = now;
 35:         return true; // Designated single canary probe
 36:       }
 37:       return false; // Circuit still open
 38:     }
 39: 
 40:     if (this.state === "HALF_OPEN") {
 41:       // Lease check: if canary in flight has exceeded max duration, forcibly grant new lease
 42:       const isLeaseExpired = now - this.canaryLockTimestampMs > this.maxCanaryDurationMs;
 43:       if (!this.isCanaryInFlight || isLeaseExpired) {
 44:         this.isCanaryInFlight = true;
 45:         this.canaryLockTimestampMs = now;
 46:         return true;
 47:       }
 48:       // Another active canary is currently testing upstream; route other calls to fallback
 49:       return false;
 50:     }
 51: 
 52:     return true; // CLOSED - healthy
 53:   }
 54: 
 55:   public recordSuccess(): void {
 56:     this.failureCount = 0;
 57:     this.state = "CLOSED";
 58:     this.isCanaryInFlight = false;
 59:     this.canaryLockTimestampMs = 0;
 60:   }
 61: 
 62:   public recordFailure(isCritical5xx: boolean): void {
 63:     if (!isCritical5xx) {
 64:       if (this.state === "HALF_OPEN") {
 65:         this.isCanaryInFlight = false;
 66:         this.canaryLockTimestampMs = 0;
 67:       }
 68:       return;
 69:     }
 70: 
 71:     this.failureCount += 1;
 72:     this.isCanaryInFlight = false;
 73:     this.canaryLockTimestampMs = 0;
 74: 
 75:     // In HALF_OPEN, a single failure immediately kicks back to OPEN with full cooldown
 76:     if (this.state === "HALF_OPEN" || this.failureCount >= this.config.failureThreshold) {
 77:       this.state = "OPEN";
 78:       this.nextProbeTimeMs = Date.now() + this.config.cooldownMs;
 79:     }
 80:   }
 81: 
 82:   public getState(): CircuitState {
 83:     // If state is OPEN but probe time has passed, report HALF_OPEN
 84:     if (this.state === "OPEN" && Date.now() >= this.nextProbeTimeMs) {
 85:       return "HALF_OPEN";
 86:     }
 87:     return this.state;
 88:   }
 89: 
 90:   public getStats() {
 91:     return {
 92:       state: this.getState(),
 93:       failureCount: this.failureCount,
 94:       nextProbeTimeMs: this.nextProbeTimeMs,
 95:       isCanaryInFlight: this.isCanaryInFlight,
 96:     };
 97:   }
 98: 
 99:   public reset(): void {
100:     this.state = "CLOSED";
101:     this.failureCount = 0;
102:     this.nextProbeTimeMs = 0;
103:     this.isCanaryInFlight = false;
104:     this.canaryLockTimestampMs = 0;
105:   }
106: }
107: 
108: // Global registry for provider circuit breakers
109: const breakerRegistry = new Map<string, ProviderCircuitBreaker>();
110: 
111: export function getCircuitBreakerForProvider(
112:   provider: string,
113:   config?: Partial<CircuitBreakerConfig>
114: ): ProviderCircuitBreaker {
115:   let breaker = breakerRegistry.get(provider);
116:   if (!breaker) {
117:     breaker = new ProviderCircuitBreaker(provider, {
118:       failureThreshold: config?.failureThreshold ?? 5,
119:       cooldownMs: config?.cooldownMs ?? 60000,
120:       maxCanaryDurationMs: config?.maxCanaryDurationMs ?? 60000,
121:     });
122:     breakerRegistry.set(provider, breaker);
123:   }
124:   return breaker;
125: }
126: 
127: export function getAllCircuitBreakers(): Map<string, ProviderCircuitBreaker> {
128:   return breakerRegistry;
129: }
130: 
131: export function clearCircuitBreakerRegistry(): void {
132:   breakerRegistry.clear();
133: }
```

## File: src/network/classifier.ts
```typescript
  1: import { type ConserveRule, parseResetDelay, resolveConserveTtlSec } from "./cooldown";
  2: import { isProviderQuarantineEnabled } from "./pool";
  3: import { getEnv } from "../config/env";
  4: 
  5: export interface UpstreamErrorInfo {
  6:   readonly provider: string;
  7:   readonly status: number;
  8:   readonly headers?: Headers | Record<string, string>;
  9:   readonly bodyText?: string;
 10:   readonly consecutiveAuthFailures?: number;
 11:   readonly conserveRules?: readonly ConserveRule[];
 12: }
 13: 
 14: export interface ErrorDisposition {
 15:   readonly action: "retry_rotate" | "fail_fast";
 16:   readonly quarantineTtlSec: number;
 17:   readonly reason: string;
 18:   readonly isRetryable?: boolean;
 19:   readonly isConserve?: boolean;
 20:   readonly errorType?: string;
 21: }
 22: 
 23: export type ErrorClassification = ErrorDisposition;
 24: 
 25: const MAX_BODY_SCAN_BYTES = 4096;
 26: const SEVEN_DAYS_SEC = 604800;
 27: 
 28: function isRetryable400(text: string): boolean {
 29:   return (
 30:     text.includes("no available provider") ||
 31:     text.includes("temporarily unavailable")
 32:   );
 33: }
 34: 
 35: function isQuotaExhausted429(text: string): boolean {
 36:   return (
 37:     text.includes("insufficient_quota") ||
 38:     text.includes("insufficient credits") ||
 39:     text.includes("credit_limit") ||
 40:     text.includes("out of balance") ||
 41:     text.includes("credits exhausted") ||
 42:     text.includes("out of credits") ||
 43:     text.includes("free limit exceeded") ||
 44:     text.includes("account has no balance")
 45:   );
 46: }
 47: 
 48: function isStreamCanceledError(text: string): boolean {
 49:   return (
 50:     text.includes("the pending stream has been canceled") ||
 51:     text.includes("the pending stream has been cancelled") ||
 52:     text.includes("stream canceled") ||
 53:     text.includes("stream cancelled") ||
 54:     text.includes("err_http2_stream_cancel") ||
 55:     text.includes("err_http2_stream_error") ||
 56:     text.includes("rst_stream")
 57:   );
 58: }
 59: 
 60: function strField(obj: unknown, key: string): string | undefined {
 61:   if (typeof obj !== "object" || obj === null) {
 62:     return undefined;
 63:   }
 64:   const val = (obj as Record<string, unknown>)[key];
 65:   return typeof val === "string" && val.length > 0 ? val : undefined;
 66: }
 67: 
 68: /**
 69:  * Parse the canonical typed `error_type` from an upstream body across 3 skins:
 70:  * chat `error.metadata.error_type`, anthropic `error.error_type`,
 71:  * responses top-level `error_type`. Returns undefined when absent/unparseable.
 72:  */
 73: export function parseCanonicalErrorType(bodyText: string | undefined): string | undefined {
 74:   if (!bodyText) {
 75:     return undefined;
 76:   }
 77:   let parsed: unknown;
 78:   try {
 79:     parsed = JSON.parse(bodyText);
 80:   } catch {
 81:     return undefined;
 82:   }
 83:   const root = parsed as Record<string, unknown>;
 84:   return (
 85:     strField(root, "error_type") ??
 86:     strField(root.error, "error_type") ??
 87:     strField((root.error as Record<string, unknown> | undefined)?.metadata, "error_type")
 88:   );
 89: }
 90: 
 91: function resolveAuthTtl(consecutiveAuthFailures?: number): number {
 92:   const count = consecutiveAuthFailures ?? 1;
 93:   if (count === 2) {
 94:     return 1800;
 95:   }
 96:   if (count >= 3) {
 97:     return 86400;
 98:   }
 99:   return 300;
100: }
101: 
102: const ERROR_TYPE_RETRY_TTL_SEC: Readonly<Record<string, number>> = {
103:   timeout: 0,
104:   provider_overloaded: 10,
105:   provider_unavailable: 10,
106:   server: 10,
107:   unmapped: 10,
108: };
109: 
110: const ERROR_TYPE_FAIL_FAST_ZERO: ReadonlySet<string> = new Set([
111:   "context_length_exceeded",
112:   "max_tokens_exceeded",
113:   "token_limit_exceeded",
114:   "string_too_long",
115:   "invalid_request",
116:   "invalid_prompt",
117:   "not_found",
118:   "precondition_failed",
119:   "payload_too_large",
120:   "unprocessable",
121:   "invalid_image",
122:   "image_too_large",
123:   "image_too_small",
124:   "unsupported_image_format",
125:   "image_not_found",
126:   "image_download_failed",
127:   "permission_denied",
128:   "content_policy_violation",
129:   "refusal",
130:   "payment_required",
131: ]);
132: 
133: function dispositionForErrorType(
134:   errorType: string,
135:   input: UpstreamErrorInfo
136: ): ErrorDisposition | undefined {
137:   if (errorType === "authentication") {
138:     return {
139:       action: "retry_rotate",
140:       quarantineTtlSec: resolveAuthTtl(input.consecutiveAuthFailures),
141:       reason: "auth_failure_key_quarantined",
142:       isRetryable: true,
143:       errorType,
144:     };
145:   }
146:   if (errorType === "rate_limit_exceeded") {
147:     const reset = parseResetDelay(input.headers, input.bodyText);
148:     const ttlSec =
149:       !isProviderQuarantineEnabled(input.provider) || getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC === 0
150:         ? 0
151:         : Math.round(reset.delayMs / 1000);
152:     return {
153:       action: "retry_rotate",
154:       quarantineTtlSec: ttlSec,
155:       reason: "Rate limit reached (429)",
156:       isRetryable: true,
157:       errorType,
158:     };
159:   }
160:   const retryTtl = ERROR_TYPE_RETRY_TTL_SEC[errorType];
161:   if (retryTtl !== undefined) {
162:     return {
163:       action: "retry_rotate",
164:       quarantineTtlSec: retryTtl,
165:       reason: `Upstream typed error (${errorType})`,
166:       isRetryable: true,
167:       errorType,
168:     };
169:   }
170:   if (ERROR_TYPE_FAIL_FAST_ZERO.has(errorType)) {
171:     return {
172:       action: "fail_fast",
173:       quarantineTtlSec: 0,
174:       reason: `Upstream typed error (${errorType})`,
175:       isRetryable: false,
176:       errorType,
177:     };
178:   }
179:   return undefined;
180: }
181: 
182: export function classifyTransportError(error: unknown): ErrorDisposition {
183:   const message = error instanceof Error ? error.message : String(error ?? "");
184:   const lower = message.toLowerCase();
185: 
186:   if (isStreamCanceledError(lower)) {
187:     return {
188:       action: "retry_rotate",
189:       quarantineTtlSec: 0,
190:       reason: "transport_stream_canceled_immediate_retry",
191:       isRetryable: true,
192:     };
193:   }
194: 
195:   if (
196:     lower.includes("ttft") ||
197:     lower.includes("timed out waiting for first chunk") ||
198:     lower.includes("noresponse")
199:   ) {
200:     return {
201:       action: "retry_rotate",
202:       quarantineTtlSec: 2,
203:       reason: "ttft_timeout_exceeded",
204:       isRetryable: true,
205:     };
206:   }
207: 
208:   return {
209:     action: "retry_rotate",
210:     quarantineTtlSec: 2,
211:     reason: "transport_reset_cooldown",
212:     isRetryable: true,
213:   };
214: }
215: 
216: export function classifyUpstreamError(input: UpstreamErrorInfo): ErrorDisposition {
217:   const { status, headers, bodyText } = input;
218:   const rawBody = bodyText ?? "";
219:   const text = rawBody.slice(0, MAX_BODY_SCAN_BYTES).toLowerCase();
220: 
221:   // 0. Stream cancellation or transport abort in body/message -> immediate 0s retry
222:   if (isStreamCanceledError(text)) {
223:     return {
224:       action: "retry_rotate",
225:       quarantineTtlSec: 0,
226:       reason: "transport_stream_canceled_immediate_retry",
227:       isRetryable: true,
228:     };
229:   }
230: 
231:   // 0b. Status 0: Network / transport error before response headers
232:   if (status === 0) {
233:     if (text.includes("ttft") || text.includes("timeout") || text.includes("noresponse")) {
234:       return {
235:         action: "retry_rotate",
236:         quarantineTtlSec: 2,
237:         reason: "ttft_timeout_exceeded",
238:         isRetryable: true,
239:       };
240:     }
241:     return {
242:       action: "retry_rotate",
243:       quarantineTtlSec: 2,
244:       reason: "transport_reset_cooldown",
245:       isRetryable: true,
246:     };
247:   }
248: 
249:   // 1. Conserve rules FIRST: custom per-provider quota/parking rules
250:   if (input.conserveRules && input.conserveRules.length > 0) {
251:     for (const rule of input.conserveRules) {
252:       if (status === rule.status && text.includes(rule.contains.toLowerCase())) {
253:         const ttlSec = resolveConserveTtlSec(rule.ttl);
254:         return {
255:           action: "retry_rotate",
256:           quarantineTtlSec: ttlSec,
257:           reason: rule.reason,
258:           isRetryable: true,
259:           isConserve: true,
260:         };
261:       }
262:     }
263:   }
264: 
265:   // 1b. Canonical error_type wins over status (3 skins); fallback to status below.
266:   const errorType = parseCanonicalErrorType(rawBody);
267:   if (errorType) {
268:     const typed = dispositionForErrorType(errorType, input);
269:     if (typed) {
270:       return typed;
271:     }
272:   }
273: 
274:   // 2. Status 400: Check provider retryable vs client-side fail fast
275:   if (status === 400) {
276:     if (isRetryable400(text)) {
277:       return {
278:         action: "retry_rotate",
279:         quarantineTtlSec: 0,
280:         reason: "Upstream provider temporary failure (retryable 400)",
281:         isRetryable: true,
282:       };
283:     }
284:     return {
285:       action: "fail_fast",
286:       quarantineTtlSec: 0,
287:       reason: "Client request error (non-retryable 400)",
288:       isRetryable: false,
289:     };
290:   }
291: 
292:   // 2b. Status 408: request timeout — retry_rotate with zero quarantine
293:   // (delay is scheduled by the caller's providers.json request_retry, not here).
294:   if (status === 408) {
295:     return {
296:       action: "retry_rotate",
297:       quarantineTtlSec: 0,
298:       reason: "Request timeout (408)",
299:       isRetryable: true,
300:       errorType,
301:     };
302:   }
303: 
304:   // 3. Status 429: Check quota exhaustion vs standard rate limit
305:   if (status === 429) {
306:     if (isQuotaExhausted429(text)) {
307:       return {
308:         action: "retry_rotate",
309:         quarantineTtlSec: !isProviderQuarantineEnabled(input.provider) ? 0 : SEVEN_DAYS_SEC,
310:         reason: "Quota or credit exhaustion (429)",
311:         isRetryable: true,
312:       };
313:     }
314: 
315:     const reset = parseResetDelay(headers, rawBody);
316:     const ttlSec =
317:       !isProviderQuarantineEnabled(input.provider) || getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC === 0
318:         ? 0
319:         : Math.round(reset.delayMs / 1000);
320:     return {
321:       action: "retry_rotate",
322:       quarantineTtlSec: ttlSec,
323:       reason: "Rate limit reached (429)",
324:       isRetryable: true,
325:     };
326:   }
327: 
328:   // 4. Status 403: forbidden — fail_fast with zero quarantine (never park the key).
329:   if (status === 403) {
330:     return {
331:       action: "fail_fast",
332:       quarantineTtlSec: 0,
333:       reason: "Client error (403)",
334:       isRetryable: false,
335:       errorType,
336:     };
337:   }
338: 
339:   // 5. Status 401: auth failure — tiered key quarantine (300s -> 1800s -> 86400s).
340:   if (status === 401) {
341:     return {
342:       action: "retry_rotate",
343:       quarantineTtlSec: resolveAuthTtl(input.consecutiveAuthFailures),
344:       reason: "auth_failure_key_quarantined",
345:       isRetryable: true,
346:       errorType,
347:     };
348:   }
349: 
350:   // 6. Status 404: Not found (fail fast)
351:   if (status === 404) {
352:     return {
353:       action: "fail_fast",
354:       quarantineTtlSec: 0,
355:       reason: "Resource or model not found (404)",
356:       isRetryable: false,
357:     };
358:   }
359: 
360:   // 6b. Status 402: Payment required — insufficient credits (fail fast, never park the key).
361:   if (status === 402) {
362:     return {
363:       action: "fail_fast",
364:       quarantineTtlSec: 0,
365:       reason: "Payment required (402) - insufficient credits",
366:       isRetryable: false,
367:       errorType,
368:     };
369:   }
370: 
371:   // 7. Status 5xx (500, 502, 503, 504, etc.): Transient server error (10s)
372:   if (status >= 500 && status < 600) {
373:     return {
374:       action: "retry_rotate",
375:       quarantineTtlSec: 10,
376:       reason: `Transient upstream server error (${status})`,
377:       isRetryable: true,
378:     };
379:   }
380: 
381:   // 8. Other 4xx client errors: fail fast
382:   if (status >= 400 && status < 500) {
383:     return {
384:       action: "fail_fast",
385:       quarantineTtlSec: 0,
386:       reason: `Client error (${status})`,
387:       isRetryable: false,
388:     };
389:   }
390: 
391:   // 9. Any other status code (< 400)
392:   return {
393:     action: "fail_fast",
394:     quarantineTtlSec: 0,
395:     reason: `Status ${status}`,
396:     isRetryable: false,
397:   };
398: }
```

## File: src/network/cooldown.ts
```typescript
  1: export interface KeyCooldownState {
  2:   readonly quarantinedUntil: number;
  3:   readonly reason: string;
  4:   readonly lastErrorStatus?: number;
  5: }
  6: 
  7: export interface ParsedResetDelay {
  8:   readonly delayMs: number;
  9:   readonly isGraceRetry: boolean;
 10: }
 11: 
 12: export interface ConserveRule {
 13:   readonly status: number;
 14:   readonly contains: string;
 15:   readonly ttl: number | "midnight_utc";
 16:   readonly reason: string;
 17: }
 18: 
 19: const DEFAULT_COOLDOWN_SEC = 30;
 20: export const RATE_LIMIT_DEFAULT_SEC = 0;
 21: const SERVER_ERROR_DEFAULT_SEC = 10;
 22: const AUTH_ERROR_DEFAULT_SEC = 0;
 23: 
 24: const MIN_CLAMP_MS = 5000;
 25: const GRACE_RETRY_THRESHOLD_MS = 2000;
 26: 
 27: function clampDuration(delayMs: number): number {
 28:   if (delayMs < MIN_CLAMP_MS) {
 29:     return MIN_CLAMP_MS;
 30:   }
 31:   return delayMs;
 32: }
 33: 
 34: function parseDateHeader(val: string): number | null {
 35:   const dateMs = Date.parse(val);
 36:   if (Number.isNaN(dateMs)) {
 37:     return null;
 38:   }
 39:   const diff = dateMs - Date.now();
 40:   return diff > 0 ? diff : 0;
 41: }
 42: 
 43: function parseHeaderValue(headerVal: string | null | undefined): number | null {
 44:   if (!headerVal) {
 45:     return null;
 46:   }
 47:   const trimmed = headerVal.trim();
 48:   const numericSec = Number.parseFloat(trimmed);
 49:   if (!Number.isNaN(numericSec) && numericSec > 0) {
 50:     return Math.round(numericSec * 1000);
 51:   }
 52:   return parseDateHeader(trimmed);
 53: }
 54: 
 55: function extractMatchMs(pattern: RegExp, text: string): number | null {
 56:   const match = pattern.exec(text);
 57:   if (!match || !match[1]) {
 58:     return null;
 59:   }
 60:   const val = Number.parseFloat(match[1]);
 61:   const isMs = match[2]?.toLowerCase() === "ms";
 62:   return isMs ? Math.round(val) : Math.round(val * 1000);
 63: }
 64: 
 65: const QUOTA_RESET_REGEX = /quotaResetDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)(s|ms)?/i;
 66: const RETRY_AFTER_REGEX = /retry[_-]?after["']?\s*:\s*["']?(\d+(?:\.\d+)?)(s|ms)?/i;
 67: 
 68: function parseBodyRegex(bodyText: string | undefined): number | null {
 69:   if (!bodyText) {
 70:     return null;
 71:   }
 72:   const quotaMs = extractMatchMs(QUOTA_RESET_REGEX, bodyText);
 73:   if (quotaMs !== null) {
 74:     return quotaMs;
 75:   }
 76:   return extractMatchMs(RETRY_AFTER_REGEX, bodyText);
 77: }
 78: 
 79: function getHeaderString(headers?: Headers | Record<string, string>): string | null | undefined {
 80:   if (!headers) {
 81:     return undefined;
 82:   }
 83:   if (headers instanceof Headers) {
 84:     return headers.get("retry-after");
 85:   }
 86:   return headers["retry-after"];
 87: }
 88: 
 89: export function parseResetDelay(
 90:   headers?: Headers | Record<string, string>,
 91:   errorBody?: string,
 92:   configuredTtlSec?: number
 93: ): ParsedResetDelay {
 94:   const headerVal = getHeaderString(headers);
 95:   const extractedMs = parseHeaderValue(headerVal) ?? parseBodyRegex(errorBody);
 96: 
 97:   if (extractedMs !== null) {
 98:     const isGrace = extractedMs > 0 && extractedMs <= GRACE_RETRY_THRESHOLD_MS;
 99:     const delayMs = isGrace ? extractedMs : clampDuration(extractedMs);
100:     return { delayMs, isGraceRetry: isGrace };
101:   }
102: 
103:   const effectiveTtlSec = configuredTtlSec !== undefined ? configuredTtlSec : RATE_LIMIT_DEFAULT_SEC;
104:   return { delayMs: effectiveTtlSec * 1000, isGraceRetry: false };
105: }
106: 
107: const STATUS_TTL_MAP: Readonly<Record<number, number>> = {
108:   429: RATE_LIMIT_DEFAULT_SEC,
109:   401: AUTH_ERROR_DEFAULT_SEC,
110:   403: AUTH_ERROR_DEFAULT_SEC,
111:   400: 0,
112:   404: 0,
113:   500: SERVER_ERROR_DEFAULT_SEC,
114:   502: SERVER_ERROR_DEFAULT_SEC,
115:   503: SERVER_ERROR_DEFAULT_SEC,
116:   504: SERVER_ERROR_DEFAULT_SEC,
117: };
118: 
119: export function computeStatusTtlSec(status: number, configuredTtlSec?: number): number {
120:   if (status === 429) {
121:     return configuredTtlSec !== undefined ? configuredTtlSec : RATE_LIMIT_DEFAULT_SEC;
122:   }
123:   const mapped = STATUS_TTL_MAP[status];
124:   if (mapped !== undefined) {
125:     return mapped;
126:   }
127:   return DEFAULT_COOLDOWN_SEC;
128: }
129: 
130: export function calculateMidnightUtcSec(nowMs: number = Date.now()): number {
131:   const date = new Date(nowMs);
132:   const nextMidnightUtc = Date.UTC(
133:     date.getUTCFullYear(),
134:     date.getUTCMonth(),
135:     date.getUTCDate() + 1,
136:     0, 0, 0, 0
137:   );
138:   // Add 60s buffer so the upstream reset window is guaranteed to have passed
139:   const diffSec = Math.ceil((nextMidnightUtc - nowMs) / 1000) + 60;
140:   return Math.max(diffSec, 60);
141: }
142: 
143: export function resolveConserveTtlSec(ttl: number | "midnight_utc" | undefined, nowMs: number = Date.now()): number {
144:   if (ttl === "midnight_utc") {
145:     return calculateMidnightUtcSec(nowMs);
146:   }
147:   if (typeof ttl === "number" && ttl > 0) {
148:     return ttl;
149:   }
150:   return calculateMidnightUtcSec(nowMs);
151: }
152: 
153: export class CooldownManager {
154:   private readonly states = new Map<string, KeyCooldownState>();
155:   private readonly defaultRateLimitTtlSec: number;
156: 
157:   constructor(defaultRateLimitTtlSec: number = RATE_LIMIT_DEFAULT_SEC) {
158:     this.defaultRateLimitTtlSec = defaultRateLimitTtlSec;
159:   }
160: 
161:   public isQuarantined(keyId: string, now: number = Date.now()): boolean {
162:     const state = this.states.get(keyId);
163:     if (!state) {
164:       return false;
165:     }
166:     if (now >= state.quarantinedUntil) {
167:       this.states.delete(keyId);
168:       return false;
169:     }
170:     return true;
171:   }
172: 
173:   public getRemainingMs(keyId: string, now: number = Date.now()): number {
174:     const state = this.states.get(keyId);
175:     if (!state) {
176:       return 0;
177:     }
178:     const remaining = state.quarantinedUntil - now;
179:     return remaining > 0 ? remaining : 0;
180:   }
181: 
182:   public getMinQuarantineTtlMs(provider: string, now: number = Date.now()): number {
183:     const prefix = `${provider}:`;
184:     let minTtl = Number.POSITIVE_INFINITY;
185: 
186:     for (const [keyId, state] of this.states.entries()) {
187:       if (keyId === provider || keyId.startsWith(prefix)) {
188:         if (now >= state.quarantinedUntil) {
189:           this.states.delete(keyId);
190:           continue;
191:         }
192:         const remaining = state.quarantinedUntil - now;
193:         if (remaining > 0 && remaining < minTtl) {
194:           minTtl = remaining;
195:         }
196:       }
197:     }
198: 
199:     return Number.isFinite(minTtl) ? minTtl : 0;
200:   }
201: 
202:   public quarantineKey(
203:     keyId: string,
204:     status: number,
205:     headers?: Headers | Record<string, string>,
206:     errorBody?: string,
207:     now: number = Date.now(),
208:     customTtlSec?: number
209:   ): KeyCooldownState {
210:     let ttlMs =
211:       customTtlSec !== undefined
212:         ? customTtlSec * 1000
213:         : computeStatusTtlSec(status, this.defaultRateLimitTtlSec) * 1000;
214:     if (customTtlSec === undefined && status === 429) {
215:       const reset = parseResetDelay(headers, errorBody, this.defaultRateLimitTtlSec);
216:       ttlMs = reset.delayMs;
217:     }
218:     const state: KeyCooldownState = {
219:       quarantinedUntil: now + ttlMs,
220:       reason: `HTTP ${status}`,
221:       lastErrorStatus: status,
222:     };
223:     if (ttlMs > 0) {
224:       this.states.set(keyId, state);
225:     }
226:     return state;
227:   }
228: 
229:   public quarantineKeyWithTtl(
230:     keyId: string,
231:     ttlSec: number,
232:     reason: string = "quarantined",
233:     status?: number,
234:     now: number = Date.now()
235:   ): KeyCooldownState {
236:     const ttlMs = ttlSec * 1000;
237:     const state: KeyCooldownState = {
238:       quarantinedUntil: now + ttlMs,
239:       reason,
240:       lastErrorStatus: status,
241:     };
242:     if (ttlMs > 0) {
243:       this.states.set(keyId, state);
244:     }
245:     return state;
246:   }
247: 
248:   public clearCooldown(keyId: string): void {
249:     this.states.delete(keyId);
250:   }
251: 
252:   public clearAll(): void {
253:     this.states.clear();
254:   }
255: }
```

## File: src/network/fetcher.ts
```typescript
   1: import { getEnv } from "../config/env";
   2: import { getHttp2Pool } from "./h2_pool";
   3: 
   4: export interface FetcherOptions {
   5:   readonly url: string;
   6:   readonly method: "GET" | "POST";
   7:   readonly headers: Record<string, string>;
   8:   readonly body?: string;
   9:   readonly clientSignal?: AbortSignal;
  10:   readonly provider: string;
  11:   readonly keyIndex: number;
  12:   readonly model?: string;
  13: }
  14: 
  15: export interface StreamChunkResult {
  16:   readonly stream: ReadableStream<Uint8Array>;
  17:   readonly ttftMs: number;
  18:   readonly initialBuffer: Uint8Array;
  19: }
  20: 
  21: export interface UsageCallbackPayload {
  22:   readonly promptTokens: number;
  23:   readonly completionTokens: number;
  24:   readonly reasoningTokens?: number;
  25:   readonly totalTokens: number;
  26: }
  27: 
  28: export interface StreamCallbacks {
  29:   readonly onUsage?: (usage: UsageCallbackPayload) => void;
  30:   readonly onFinishReason?: (finishReason: string) => void;
  31:   readonly retryProvider?: RetryProvider;
  32:   readonly nextAttemptProvider?: RetryProvider;
  33:   readonly protocol?: "anthropic" | "openai" | string;
  34: }
  35: 
  36: export interface NextAttemptResult {
  37:   readonly firstChunk: Uint8Array;
  38:   readonly rawReader?: ReadableStreamDefaultReader<Uint8Array>;
  39:   readonly reader?: ReadableStreamDefaultReader<Uint8Array>;
  40: }
  41: 
  42: export type RetryProvider = (
  43:   reason: string,
  44:   hasEmittedTokens?: boolean
  45: ) => Promise<NextAttemptResult | null>;
  46: 
  47: export class NoResponseError extends Error {
  48:   public constructor(message: string) {
  49:     super(message);
  50:     this.name = "NoResponseError";
  51:   }
  52: }
  53: 
  54: export class StreamStallError extends Error {
  55:   public constructor(message: string) {
  56:     super(message);
  57:     this.name = "StreamStallError";
  58:   }
  59: }
  60: 
  61: export const TTFT_TIMEOUT_MS = 120000;
  62: export const STREAM_IDLE_TIMEOUT_MS = 120000;
  63: export const MAX_HTTP_TIMEOUT_MS = 300000;
  64: export const KEEPALIVE_INTERVAL_MS = 15000;
  65: export const STREAM_STALL_MAX_RESENDS = 2;
  66: 
  67: const TOKEN_SIGNATURES: readonly string[] = Object.freeze([
  68:   "content",
  69:   "reasoning_content",
  70:   "reasoning",
  71:   "thought",
  72:   "tool_calls",
  73:   "parts",
  74:   "choices",
  75:   "candidates",
  76:   "text",
  77:   "delta",
  78:   "message",
  79:   "id",
  80:   "object",
  81:   "{",
  82: ]);
  83: 
  84: export function hasContentToken(text: string): boolean {
  85:   const lines = text.split("\n");
  86:   const nonComment = lines
  87:     .map((line) => line.trim())
  88:     .filter(
  89:       (line) =>
  90:         line.length > 0 &&
  91:         !line.startsWith(":") &&
  92:         line !== "data: [DONE]" &&
  93:         line !== "[DONE]"
  94:     );
  95:   if (nonComment.length === 0) {
  96:     return false;
  97:   }
  98:   const joined = nonComment.join("\n");
  99:   for (const sig of TOKEN_SIGNATURES) {
 100:     if (joined.includes(sig)) {
 101:       return true;
 102:     }
 103:   }
 104:   return false;
 105: }
 106: 
 107: function mergeSignals(client?: AbortSignal, timeoutMs: number = MAX_HTTP_TIMEOUT_MS): AbortSignal {
 108:   const timeoutSig = AbortSignal.timeout(timeoutMs);
 109:   if (!client) {
 110:     return timeoutSig;
 111:   }
 112:   return AbortSignal.any([client, timeoutSig]);
 113: }
 114: 
 115: function createKeepAliveChunk(): Uint8Array {
 116:   const encoder = new TextEncoder();
 117:   return encoder.encode(": keep-alive\n\n");
 118: }
 119: 
 120: type IntervalHandle = ReturnType<typeof setInterval>;
 121: 
 122: export function safeEnqueue(
 123:   controller: ReadableStreamDefaultController<Uint8Array>,
 124:   chunk: Uint8Array,
 125:   isClosedRef?: { isClosed: boolean }
 126: ): boolean {
 127:   if (isClosedRef?.isClosed || controller.desiredSize === null) {
 128:     return false;
 129:   }
 130:   try {
 131:     controller.enqueue(chunk);
 132:     return true;
 133:   } catch (err: unknown) {
 134:     if (isClosedRef) {
 135:       isClosedRef.isClosed = true;
 136:     }
 137:     console.debug(`[Stream] Suppressed enqueue on closed stream: ${err instanceof Error ? err.message : String(err)}`);
 138:     return false;
 139:   }
 140: }
 141: 
 142: export function safeClose(
 143:   controller: ReadableStreamDefaultController<Uint8Array>,
 144:   isClosedRef?: { isClosed: boolean }
 145: ): void {
 146:   if (isClosedRef?.isClosed) {
 147:     return;
 148:   }
 149:   if (isClosedRef) {
 150:     isClosedRef.isClosed = true;
 151:   }
 152:   try {
 153:     if (controller.desiredSize === null) {
 154:       return;
 155:     }
 156:     controller.close();
 157:   } catch (err: unknown) {
 158:     const isDebug = Boolean(
 159:       process.env.DEBUG ||
 160:       process.env.LITEROUTER_LOG_LEVEL === "debug" ||
 161:       (getEnv() as Record<string, unknown>).LITEROUTER_LOG_LEVEL === "debug" ||
 162:       getEnv().LOG_LEVEL === "debug"
 163:     );
 164:     if (isDebug) {
 165:       console.debug(`[Stream] Suppressed controller close error: ${err instanceof Error ? err.message : String(err)}`);
 166:     }
 167:   }
 168: }
 169: 
 170: export function safeError(
 171:   controller: ReadableStreamDefaultController<Uint8Array>,
 172:   err: unknown,
 173:   isClosedRef?: { isClosed: boolean }
 174: ): void {
 175:   if (isClosedRef?.isClosed || controller.desiredSize === null) {
 176:     if (isClosedRef) {
 177:       isClosedRef.isClosed = true;
 178:     }
 179:     return;
 180:   }
 181:   if (isClosedRef) {
 182:     isClosedRef.isClosed = true;
 183:   }
 184:   try {
 185:     controller.error(err instanceof Error ? err : new Error(String(err)));
 186:   } catch (e: unknown) {
 187:     console.debug(`[Stream] Suppressed controller error dispatch: ${e instanceof Error ? e.message : String(e)}`);
 188:   }
 189: }
 190: 
 191: function tryEnqueueKeepAlive(
 192:   controller: ReadableStreamDefaultController<Uint8Array>,
 193:   isClosedRef?: { isClosed: boolean }
 194: ): void {
 195:   safeEnqueue(controller, createKeepAliveChunk(), isClosedRef);
 196: }
 197: 
 198: function startKeepAliveTimer(
 199:   controller: ReadableStreamDefaultController<Uint8Array>,
 200:   isClosedRef?: { isClosed: boolean }
 201: ): IntervalHandle | null {
 202:   const interval = getEnv().KEEPALIVE_INTERVAL_MS || KEEPALIVE_INTERVAL_MS;
 203:   try {
 204:     return setInterval(() => tryEnqueueKeepAlive(controller, isClosedRef), interval);
 205:   } catch (err: unknown) {
 206:     if (err instanceof Error) {
 207:       console.error(`[KeepAlive] Timer error: ${err.message}`);
 208:     }
 209:     return null;
 210:   }
 211: }
 212: 
 213: function clearTimer(timer: IntervalHandle | null): void {
 214:   if (timer !== null) {
 215:     clearInterval(timer);
 216:   }
 217: }
 218: 
 219: type DefaultReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
 220: 
 221: export function resolveTtftTimeout(model?: string, envTimeoutMs?: number): number {
 222:   void model;
 223:   return envTimeoutMs && envTimeoutMs > 0 ? envTimeoutMs : TTFT_TIMEOUT_MS;
 224: }
 225: 
 226: export function formatMidstreamErrorFrame(
 227:   protocol: "anthropic" | "openai" | string = "openai",
 228:   message: string,
 229:   errorType: string = "server_error"
 230: ): Uint8Array {
 231:   const encoder = new TextEncoder();
 232:   if (protocol === "anthropic" || protocol === "cl") {
 233:     return encoder.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`);
 234:   }
 235:   const payload = {
 236:     id: `err-${Date.now()}`,
 237:     object: "chat.completion.chunk",
 238:     created: Math.floor(Date.now() / 1000),
 239:     model: "error",
 240:     error: { message, code: errorType, type: errorType },
 241:     choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
 242:   };
 243:   return encoder.encode(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
 244: }
 245: 
 246: export async function readFirstChunkWithTimeout(
 247:   reader: ReadableStreamDefaultReader<Uint8Array>,
 248:   timeoutMs: number = TTFT_TIMEOUT_MS
 249: ): Promise<DefaultReadResult> {
 250:   let timerId: ReturnType<typeof setTimeout> | undefined;
 251:   const readPromise = reader.read();
 252:   const timeoutPromise = new Promise<never>((_, reject) => {
 253:     timerId = setTimeout(() => reject(new NoResponseError(`TTFT exceeded ${timeoutMs}ms`)), timeoutMs);
 254:   });
 255:   try {
 256:     return await Promise.race([readPromise, timeoutPromise]);
 257:   } finally {
 258:     if (timerId !== undefined) {
 259:       clearTimeout(timerId);
 260:     }
 261:   }
 262: }
 263: 
 264: function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
 265:   if (chunks.length === 0) {
 266:     return new Uint8Array(0);
 267:   }
 268:   if (chunks.length === 1) {
 269:     return chunks[0] ?? new Uint8Array(0);
 270:   }
 271:   const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
 272:   const result = new Uint8Array(totalLength);
 273:   let offset = 0;
 274:   for (const chunk of chunks) {
 275:     result.set(chunk, offset);
 276:     offset += chunk.length;
 277:   }
 278:   return result;
 279: }
 280: 
 281: export async function readFirstContentChunkWithTimeout(
 282:   reader: ReadableStreamDefaultReader<Uint8Array>,
 283:   timeoutMs: number = TTFT_TIMEOUT_MS,
 284:   status: number = 200
 285: ): Promise<Uint8Array> {
 286:   const startTime = Date.now();
 287:   const bufferedChunks: Uint8Array[] = [];
 288:   const decoder = new TextDecoder();
 289:   let fullBufferedText = "";
 290: 
 291:   while (true) {
 292:     const elapsed = Date.now() - startTime;
 293:     const remainingMs = Math.max(1, timeoutMs - elapsed);
 294:     const readResult = await readFirstChunkWithTimeout(reader, remainingMs);
 295: 
 296:     if (readResult.done) {
 297:       if (bufferedChunks.length === 0) {
 298:         throw new NoResponseError("Upstream emitted 0 bytes before closing");
 299:       }
 300:       const combined = concatUint8Arrays(bufferedChunks);
 301:       if (status === 200 && !hasContentToken(fullBufferedText)) {
 302:         throw new NoResponseError("HTTP 200 returned ghost response with 0 content tokens");
 303:       }
 304:       return combined;
 305:     }
 306: 
 307:     if (readResult.value && readResult.value.length > 0) {
 308:       bufferedChunks.push(readResult.value);
 309:       fullBufferedText += decoder.decode(readResult.value, { stream: true });
 310:       if (hasContentToken(fullBufferedText)) {
 311:         return concatUint8Arrays(bufferedChunks);
 312:       }
 313:     }
 314:   }
 315: }
 316: 
 317: export function extractUsageFromChunk(chunk: Uint8Array | string): UsageCallbackPayload | null {
 318:   const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
 319:   if (!text.includes("usage") && !text.includes("usageMetadata")) {
 320:     return null;
 321:   }
 322:   const lines = text.split("\n");
 323:   for (const line of lines) {
 324:     const trimmed = line.trim();
 325:     if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") {
 326:       continue;
 327:     }
 328:     const jsonStr = trimmed.slice(5).trim();
 329:     try {
 330:       const data = JSON.parse(jsonStr) as Record<string, unknown>;
 331:       if (data.usage && typeof data.usage === "object") {
 332:         const u = data.usage as Record<string, unknown>;
 333:         const promptTokens = typeof u.prompt_tokens === "number"
 334:           ? u.prompt_tokens
 335:           : typeof u.input_tokens === "number"
 336:             ? u.input_tokens
 337:             : 0;
 338:         const completionTokens = typeof u.completion_tokens === "number"
 339:           ? u.completion_tokens
 340:           : typeof u.output_tokens === "number"
 341:             ? u.output_tokens
 342:             : 0;
 343:         const totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
 344:         let reasoningTokens: number | undefined;
 345:         if (u.completion_tokens_details && typeof u.completion_tokens_details === "object") {
 346:           const details = u.completion_tokens_details as Record<string, unknown>;
 347:           if (typeof details.reasoning_tokens === "number") {
 348:             reasoningTokens = details.reasoning_tokens;
 349:           }
 350:         } else if (u.output_tokens_details && typeof u.output_tokens_details === "object") {
 351:           const details = u.output_tokens_details as Record<string, unknown>;
 352:           if (typeof details.thinking_tokens === "number") {
 353:             reasoningTokens = details.thinking_tokens;
 354:           }
 355:         }
 356:         return { promptTokens, completionTokens, totalTokens, reasoningTokens };
 357:       }
 358:       if (data.usageMetadata && typeof data.usageMetadata === "object") {
 359:         const u = data.usageMetadata as Record<string, unknown>;
 360:         const promptTokens = typeof u.promptTokenCount === "number" ? u.promptTokenCount : 0;
 361:         const completionTokens = typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : 0;
 362:         const totalTokens = typeof u.totalTokenCount === "number" ? u.totalTokenCount : promptTokens + completionTokens;
 363:         return { promptTokens, completionTokens, totalTokens };
 364:       }
 365:     } catch (_err: unknown) {
 366:       void _err;
 367:     }
 368:   }
 369:   return null;
 370: }
 371: 
 372: export function extractFinishReasonFromChunk(chunk: Uint8Array | string): string | null {
 373:   const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
 374:   if (!text.includes("finish_reason") && !text.includes("finishReason") && !text.includes("stop_reason")) {
 375:     return null;
 376:   }
 377:   const lines = text.split("\n");
 378:   for (const line of lines) {
 379:     const trimmed = line.trim();
 380:     if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
 381:       continue;
 382:     }
 383:     const jsonStr = trimmed.slice(5).trim();
 384:     try {
 385:       const data = JSON.parse(jsonStr) as Record<string, unknown>;
 386:       if (Array.isArray(data.choices) && data.choices.length > 0) {
 387:         const choice = data.choices[0] as Record<string, unknown>;
 388:         if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
 389:           return choice.finish_reason;
 390:         }
 391:       }
 392:       if (typeof data.stop_reason === "string" && data.stop_reason.length > 0) {
 393:         return data.stop_reason;
 394:       }
 395:     } catch (_err: unknown) {
 396:       void _err;
 397:     }
 398:   }
 399:   return null;
 400: }
 401: 
 402: export const HOP_BY_HOP_AND_ENCODING_HEADERS = new Set([
 403:   "connection",
 404:   "keep-alive",
 405:   "proxy-authenticate",
 406:   "proxy-authorization",
 407:   "te",
 408:   "trailer",
 409:   "transfer-encoding",
 410:   "upgrade",
 411:   "content-encoding",
 412:   "content-length",
 413: ]);
 414: 
 415: export function sanitizeDownstreamHeaders(
 416:   upstreamHeaders: Headers,
 417:   bodyLength?: number
 418: ): Headers {
 419:   const sanitized = new Headers();
 420:   upstreamHeaders.forEach((value, key) => {
 421:     if (!HOP_BY_HOP_AND_ENCODING_HEADERS.has(key.toLowerCase())) {
 422:       sanitized.set(key, value);
 423:     }
 424:   });
 425:   if (typeof bodyLength === "number") {
 426:     sanitized.set("content-length", String(bodyLength));
 427:   }
 428:   return sanitized;
 429: }
 430: 
 431: export async function executeH2Fetch(
 432:   options: FetcherOptions,
 433:   signal: AbortSignal
 434: ): Promise<Response> {
 435:   const url = new URL(options.url);
 436:   const origin = url.origin;
 437:   const poolKey =
 438:     options.provider !== undefined && options.keyIndex !== undefined
 439:       ? `${origin}#${options.provider}:${options.keyIndex}`
 440:       : origin;
 441:   const pool = getHttp2Pool();
 442:   const session = await pool.acquireSession(poolKey, origin);
 443: 
 444:   return new Promise<Response>((resolve, reject) => {
 445:     let settled = false;
 446:     const reqHeaders: Record<string, string | number | string[]> = {
 447:       ":method": options.method,
 448:       ":path": url.pathname + url.search,
 449:       ":scheme": url.protocol.replace(":", ""),
 450:       ":authority": url.host,
 451:     };
 452: 
 453:     for (const [k, v] of Object.entries(options.headers)) {
 454:       const lower = k.toLowerCase();
 455:       if (!HOP_BY_HOP_AND_ENCODING_HEADERS.has(lower) && !lower.startsWith(":")) {
 456:         reqHeaders[lower] = v;
 457:       }
 458:     }
 459: 
 460:     let stream: ReturnType<typeof session.request>;
 461:     try {
 462:       stream = session.request(reqHeaders);
 463:     } catch (reqErr) {
 464:       return reject(reqErr);
 465:     }
 466: 
 467:     pool.attachStreamGuard(poolKey, session, stream);
 468: 
 469:     const abortListener = () => {
 470:       if (!settled) {
 471:         settled = true;
 472:         try {
 473:           stream.destroy();
 474:         } catch (_err: unknown) {
 475:           console.debug("[H2 Fetcher] Stream destroy on abort error:", _err);
 476:         }
 477:         reject(new Error("Request aborted"));
 478:       }
 479:     };
 480: 
 481:     if (signal.aborted) {
 482:       abortListener();
 483:       return;
 484:     }
 485: 
 486:     signal.addEventListener("abort", abortListener, { once: true });
 487: 
 488:     stream.on("response", (headers) => {
 489:       if (settled) return;
 490:       settled = true;
 491:       signal.removeEventListener("abort", abortListener);
 492: 
 493:       const status = Number(headers[":status"]) || 200;
 494:       const respHeaders = new Headers();
 495:       for (const [k, v] of Object.entries(headers)) {
 496:         if (!k.startsWith(":") && v !== undefined) {
 497:           if (Array.isArray(v)) {
 498:             for (const item of v) respHeaders.append(k, item);
 499:           } else {
 500:             respHeaders.set(k, String(v));
 501:           }
 502:         }
 503:       }
 504: 
 505:       let isClosed = false;
 506:       const isClosedRef = { isClosed: false };
 507:       const webStream = new ReadableStream<Uint8Array>({
 508:         start(controller) {
 509:           stream.on("data", (chunk: Buffer | Uint8Array) => {
 510:             safeEnqueue(controller, new Uint8Array(chunk), isClosedRef);
 511:           });
 512:           stream.once("end", () => {
 513:             safeClose(controller, isClosedRef);
 514:           });
 515:           stream.on("error", (err) => {
 516:             if (!pool.isSessionHealthy(session)) {
 517:               pool.purgeSession(poolKey, session);
 518:             }
 519:             safeError(controller, err, isClosedRef);
 520:           });
 521:         },
 522:         cancel() {
 523:           isClosedRef.isClosed = true;
 524:           try {
 525:             stream.destroy();
 526:           } catch (_err: unknown) {
 527:             console.debug("[H2 Fetcher] Stream destroy error:", _err);
 528:           }
 529:         },
 530:       });
 531: 
 532:       const response = new Response(webStream, {
 533:         status,
 534:         headers: respHeaders,
 535:       });
 536:       resolve(response);
 537:     });
 538: 
 539:     stream.on("error", (err) => {
 540:       if (!pool.isSessionHealthy(session)) {
 541:         pool.purgeSession(poolKey, session);
 542:       }
 543:       if (!settled) {
 544:         settled = true;
 545:         signal.removeEventListener("abort", abortListener);
 546:         reject(err);
 547:       }
 548:     });
 549: 
 550:     stream.on("frameError", () => {
 551:       if (!pool.isSessionHealthy(session)) {
 552:         pool.purgeSession(poolKey, session);
 553:       }
 554:     });
 555: 
 556:     if (options.body) {
 557:       stream.write(options.body);
 558:     }
 559:     stream.end();
 560:   });
 561: }
 562: 
 563: const NATIVE_FETCH = globalThis.fetch;
 564: 
 565: export function isFetchMocked(): boolean {
 566:   return globalThis.fetch !== NATIVE_FETCH;
 567: }
 568: 
 569: export type OutboundProtocol = "HTTP/2" | "HTTP/1.1";
 570: 
 571: export async function fetchWithTtftGuard(
 572:   options: FetcherOptions
 573: ): Promise<{
 574:   response: Response;
 575:   ttftMs: number;
 576:   firstChunk: Uint8Array;
 577:   rawReader: ReadableStreamDefaultReader<Uint8Array>;
 578:   protocol: OutboundProtocol;
 579: }> {
 580:   const timeoutMs = getEnv().LITEROUTER_HTTP_TIMEOUT_MS || MAX_HTTP_TIMEOUT_MS;
 581:   const signal = mergeSignals(options.clientSignal, timeoutMs);
 582:   const startTime = Date.now();
 583:   const requestHeaders = new Headers(options.headers);
 584:   if (!requestHeaders.has("accept-encoding")) {
 585:     requestHeaders.set("accept-encoding", "identity");
 586:   }
 587:   let response: Response;
 588:   let protocol: OutboundProtocol = "HTTP/1.1";
 589:   const useH2 = getEnv().LITEROUTER_H2_OUTBOUND && options.url.startsWith("https://") && !isFetchMocked();
 590: 
 591:   if (useH2) {
 592:     try {
 593:       response = await executeH2Fetch(options, signal);
 594:       protocol = "HTTP/2";
 595:     } catch (h2Err: unknown) {
 596:       if (options.clientSignal?.aborted) {
 597:         throw h2Err;
 598:       }
 599:       // Clean fallback to standard fetch (HTTP/1.1 keep-alive) if H2 fails
 600:       try {
 601:         response = await fetch(options.url, {
 602:           method: options.method,
 603:           headers: requestHeaders,
 604:           body: options.body,
 605:           signal,
 606:         });
 607:         protocol = "HTTP/1.1";
 608:       } catch (fetchErr: unknown) {
 609:         if (options.clientSignal?.aborted) {
 610:           throw fetchErr;
 611:         }
 612:         throw new NoResponseError(`Network transport failure: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
 613:       }
 614:     }
 615:   } else {
 616:     try {
 617:       response = await fetch(options.url, {
 618:         method: options.method,
 619:         headers: requestHeaders,
 620:         body: options.body,
 621:         signal,
 622:       });
 623:       protocol = "HTTP/1.1";
 624:     } catch (err: unknown) {
 625:       if (options.clientSignal?.aborted) {
 626:         throw err;
 627:       }
 628:       throw new NoResponseError(`Network transport failure: ${err instanceof Error ? err.message : String(err)}`);
 629:     }
 630:   }
 631: 
 632:   if (!response.body) {
 633:     throw new NoResponseError("Upstream response has no body stream");
 634:   }
 635: 
 636:   const reader = response.body.getReader();
 637:   const envTtft = getEnv().LITEROUTER_TTFT_TIMEOUT_MS || getEnv().LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
 638:   const ttftTimeoutMs = resolveTtftTimeout(options.model, envTtft);
 639:   let firstChunk: Uint8Array;
 640:   try {
 641:     firstChunk = await readFirstContentChunkWithTimeout(reader, ttftTimeoutMs, response.status);
 642:   } catch (err: unknown) {
 643:     reader.releaseLock();
 644:     throw err;
 645:   }
 646: 
 647:   const ttftMs = Date.now() - startTime;
 648:   return { response, ttftMs, firstChunk, rawReader: reader, protocol };
 649: }
 650: 
 651: /**
 652:  * Reassembles a response stream where the first chunk was consumed (e.g. by TTFT guard)
 653:  * into a single unified ReadableStream without losing initial bytes or corrupting delimiters.
 654:  * CleanTS complexity: 3 (within limit of 6). Zero swallowed catches.
 655:  */
 656: export function reassembleResponse(
 657:   originalResponse: Response,
 658:   firstChunk: Uint8Array,
 659:   rawReader: ReadableStreamDefaultReader<Uint8Array>
 660: ): Response {
 661:   let firstChunkYielded = false;
 662:   const combinedStream = new ReadableStream<Uint8Array>({
 663:     async pull(controller) {
 664:       if (!firstChunkYielded) {
 665:         firstChunkYielded = true;
 666:         if (firstChunk.byteLength > 0) {
 667:           controller.enqueue(firstChunk);
 668:           return;
 669:         }
 670:       }
 671:       try {
 672:         const { done, value } = await rawReader.read();
 673:         if (done) {
 674:           controller.close();
 675:         } else if (value) {
 676:           controller.enqueue(value);
 677:         }
 678:       } catch (err: unknown) {
 679:         controller.error(err);
 680:       }
 681:     },
 682:     cancel(reason) {
 683:       return rawReader.cancel(reason);
 684:     },
 685:   });
 686: 
 687:   return new Response(combinedStream, {
 688:     status: originalResponse.status,
 689:     statusText: originalResponse.statusText,
 690:     headers: originalResponse.headers,
 691:   });
 692: }
 693: 
 694: export function isInBandErrorChunk(chunk: Uint8Array | string): { isError: boolean; message?: string } {
 695:   if (!chunk || (typeof chunk !== "string" && chunk.length === 0)) {
 696:     return { isError: false };
 697:   }
 698:   const text = typeof chunk === "string" ? chunk.trim() : new TextDecoder().decode(chunk).trim();
 699:   if (!text) {
 700:     return { isError: false };
 701:   }
 702: 
 703:   // Fast check for explicit mid-response server error strings
 704:   if (text.includes("Server error mid-response")) {
 705:     return { isError: true, message: "Server error mid-response" };
 706:   }
 707: 
 708:   if (
 709:     text.includes('"finish_reason":"network_error"') ||
 710:     text.includes('"finish_reason": "network_error"') ||
 711:     text.includes('"finish_reason":"error"') ||
 712:     text.includes('"finish_reason": "error"')
 713:   ) {
 714:     return { isError: true, message: "Upstream emitted finish_reason: network_error chunk" };
 715:   }
 716: 
 717:   // Check JSON / SSE error payloads line by line
 718:   const lines = text.split("\n");
 719:   for (const line of lines) {
 720:     const trimmed = line.trim();
 721:     if (trimmed.startsWith(":")) continue;
 722:     if (!trimmed || trimmed === ": keep-alive" || trimmed === "data: [DONE]") {
 723:       continue;
 724:     }
 725:     let jsonStr = trimmed;
 726:     if (trimmed.startsWith("data:")) {
 727:       jsonStr = trimmed.slice(5).trim();
 728:       if (jsonStr === "[DONE]") {
 729:         continue;
 730:       }
 731:     }
 732:     if (jsonStr.startsWith("{") && jsonStr.endsWith("}")) {
 733:       try {
 734:         const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
 735:         if (parsed.error && typeof parsed.error === "object") {
 736:           const errObj = parsed.error as Record<string, unknown>;
 737:           const msg = typeof errObj.message === "string"
 738:             ? errObj.message
 739:             : typeof errObj.type === "string"
 740:               ? errObj.type
 741:               : "In-band upstream error";
 742:           return { isError: true, message: msg };
 743:         }
 744:         if (parsed.type === "error") {
 745:           const msg = typeof parsed.message === "string" ? parsed.message : "In-band upstream error";
 746:           return { isError: true, message: msg };
 747:         }
 748:       } catch (_err: unknown) {
 749:         void _err;
 750:       }
 751:     }
 752:   }
 753: 
 754:   const errorSubstrings = [
 755:     "Internal Server Error",
 756:     "internal_server_error",
 757:     "server_error",
 758:     "overloaded_error",
 759:     "internal_error",
 760:   ];
 761:   for (const sub of errorSubstrings) {
 762:     if (text.includes(sub)) {
 763:       return { isError: true, message: sub };
 764:     }
 765:   }
 766: 
 767:   const codeRegex = /"(?:code|status)"\s*:\s*(500|502|503|504|"internal_error"|"server_error"|"overloaded_error")/i;
 768:   if (codeRegex.test(text)) {
 769:     return { isError: true, message: "In-band error code match" };
 770:   }
 771: 
 772:   return { isError: false };
 773: }
 774: 
 775: export interface StreamTokenState {
 776:   hasSeenDoneMarker: boolean;
 777:   hasSeenDataToken: boolean;
 778: }
 779: 
 780: export function isLikelySSEDoneMarker(chunkText: string): boolean {
 781:   if (chunkText.includes("[DONE]")) return true;
 782:   if (chunkText.includes("response.completed")) return true;
 783:   if (
 784:     chunkText.includes('"finish_reason":"stop"') ||
 785:     chunkText.includes('"finish_reason":"tool_calls"') ||
 786:     chunkText.includes('"finish_reason":"length"') ||
 787:     chunkText.includes('"finish_reason":"content_filter"') ||
 788:     chunkText.includes('"finish_reason": "stop"') ||
 789:     chunkText.includes('"finish_reason": "tool_calls"') ||
 790:     chunkText.includes('"finish_reason": "length"') ||
 791:     chunkText.includes('"finish_reason": "content_filter"')
 792:   ) {
 793:     return true;
 794:   }
 795:   return false;
 796: }
 797: 
 798: export function inspectChunkMarkers(
 799:   chunk: Uint8Array | string,
 800:   state: StreamTokenState
 801: ): void {
 802:   if (!chunk || (typeof chunk !== "string" && chunk.length === 0)) {
 803:     return;
 804:   }
 805:   const chunkText = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
 806:   if (isLikelySSEDoneMarker(chunkText)) {
 807:     state.hasSeenDoneMarker = true;
 808:   }
 809:   if (
 810:     chunkText.includes('"content":') ||
 811:     chunkText.includes('"reasoning":') ||
 812:     chunkText.includes('"reasoning_content":') ||
 813:     chunkText.includes('"tool_calls":') ||
 814:     chunkText.includes('"output_text"') ||
 815:     chunkText.includes('"delta":')
 816:   ) {
 817:     state.hasSeenDataToken = true;
 818:   }
 819: }
 820: 
 821: export async function readWithChunkTimeout(
 822:   reader: ReadableStreamDefaultReader<Uint8Array>,
 823:   timeoutMs: number = STREAM_IDLE_TIMEOUT_MS
 824: ): Promise<DefaultReadResult> {
 825:   let timerId: ReturnType<typeof setTimeout> | undefined;
 826:   const readPromise = reader.read();
 827:   const timeoutPromise = new Promise<never>((_, reject) => {
 828:     timerId = setTimeout(
 829:       () => reject(new StreamStallError(`Stream idle timeout exceeded ${timeoutMs}ms`)),
 830:       timeoutMs
 831:     );
 832:   });
 833:   try {
 834:     return await Promise.race([readPromise, timeoutPromise]);
 835:   } finally {
 836:     if (timerId !== undefined) {
 837:       clearTimeout(timerId);
 838:     }
 839:   }
 840: }
 841: 
 842: export function emitStreamError(
 843:   controller: ReadableStreamDefaultController<Uint8Array>,
 844:   reason: string,
 845:   rawError?: unknown,
 846:   callbacks?: StreamCallbacks,
 847:   hasEmittedTokens: boolean = false,
 848:   isClosedRef?: { isClosed: boolean }
 849: ): void {
 850:   if (isClosedRef?.isClosed || controller.desiredSize === null) {
 851:     if (isClosedRef) {
 852:       isClosedRef.isClosed = true;
 853:     }
 854:     return;
 855:   }
 856:   if (callbacks?.protocol || hasEmittedTokens) {
 857:     const protocol = callbacks?.protocol || "openai";
 858:     const errorType = hasEmittedTokens ? "stream_error" : "server_error";
 859:     safeEnqueue(controller, formatMidstreamErrorFrame(protocol, reason, errorType), isClosedRef);
 860:     safeClose(controller, isClosedRef);
 861:     return;
 862:   }
 863:   safeError(controller, rawError instanceof Error ? rawError : new Error(reason), isClosedRef);
 864: }
 865: 
 866: function applyNextAttempt(
 867:   next: NextAttemptResult,
 868:   controller: ReadableStreamDefaultController<Uint8Array>,
 869:   state: StreamTokenState,
 870:   callbacks?: StreamCallbacks,
 871:   usageState?: { usageEmitted: boolean },
 872:   isClosedRef?: { isClosed: boolean }
 873: ): ReadableStreamDefaultReader<Uint8Array> | undefined {
 874:   if (isClosedRef?.isClosed || controller.desiredSize === null) {
 875:     return undefined;
 876:   }
 877:   const nextReader = next.rawReader ?? next.reader;
 878:   if (next.firstChunk && next.firstChunk.length > 0) {
 879:     inspectChunkMarkers(next.firstChunk, state);
 880:     if (usageState && !usageState.usageEmitted && callbacks?.onUsage) {
 881:       const usage = extractUsageFromChunk(next.firstChunk);
 882:       if (usage) {
 883:         usageState.usageEmitted = true;
 884:         callbacks.onUsage(usage);
 885:       }
 886:     }
 887:     safeEnqueue(controller, next.firstChunk, isClosedRef);
 888:   }
 889:   return nextReader;
 890: }
 891: 
 892: export async function handlePrematureEof(
 893:   state: StreamTokenState,
 894:   callbacks?: StreamCallbacks,
 895:   hasEmittedTokens: boolean = false
 896: ): Promise<NextAttemptResult | null> {
 897:   if (state.hasSeenDoneMarker) {
 898:     return null;
 899:   }
 900:   const provider = callbacks?.retryProvider ?? callbacks?.nextAttemptProvider;
 901:   if (!provider) {
 902:     return null;
 903:   }
 904:   return await provider("Upstream terminated stream prematurely with 0 tokens and no [DONE] marker", hasEmittedTokens);
 905: }
 906: 
 907: async function handleInBandErrorIfPresent(
 908:   text: string,
 909:   controller: ReadableStreamDefaultController<Uint8Array>,
 910:   callbacks?: StreamCallbacks,
 911:   hasEmittedTokens: boolean = false,
 912:   isClosedRef?: { isClosed: boolean }
 913: ): Promise<{ isHandled: boolean; next: NextAttemptResult | null }> {
 914:   const errCheck = isInBandErrorChunk(text);
 915:   if (!errCheck.isError) {
 916:     return { isHandled: false, next: null };
 917:   }
 918:   const reason = errCheck.message ?? "In-band error detected";
 919:   const provider = callbacks?.nextAttemptProvider ?? callbacks?.retryProvider;
 920:   if (provider) {
 921:     try {
 922:       const next = await provider(reason, hasEmittedTokens);
 923:       if (next) {
 924:         return { isHandled: true, next };
 925:       }
 926:     } catch (retryErr: unknown) {
 927:       const retryReason = retryErr instanceof Error ? retryErr.message : String(retryErr);
 928:       emitStreamError(controller, retryReason, retryErr, callbacks, hasEmittedTokens, isClosedRef);
 929:       return { isHandled: true, next: null };
 930:     }
 931:   }
 932:   emitStreamError(controller, reason, new Error(reason), callbacks, hasEmittedTokens, isClosedRef);
 933:   return { isHandled: true, next: null };
 934: }
 935: 
 936: export async function handleStreamFailure(
 937:   err: unknown,
 938:   controller: ReadableStreamDefaultController<Uint8Array>,
 939:   callbacks?: StreamCallbacks,
 940:   hasEmittedTokens: boolean = false,
 941:   isClosedRef?: { isClosed: boolean }
 942: ): Promise<NextAttemptResult | null> {
 943:   const reason = err instanceof Error ? err.message : String(err);
 944:   const provider = callbacks?.nextAttemptProvider ?? callbacks?.retryProvider;
 945:   if (provider) {
 946:     try {
 947:       const next = await provider(reason, hasEmittedTokens);
 948:       if (next) {
 949:         return next;
 950:       }
 951:     } catch (retryErr: unknown) {
 952:       const retryReason = retryErr instanceof Error ? retryErr.message : String(retryErr);
 953:       emitStreamError(controller, retryReason, retryErr, callbacks, hasEmittedTokens, isClosedRef);
 954:       return null;
 955:     }
 956:   }
 957:   emitStreamError(controller, reason, err, callbacks, hasEmittedTokens, isClosedRef);
 958:   return null;
 959: }
 960: 
 961: interface ProcessChunkContext {
 962:   controller: ReadableStreamDefaultController<Uint8Array>;
 963:   tokenState: StreamTokenState;
 964:   callbacks?: StreamCallbacks;
 965:   usageState: { usageEmitted: boolean };
 966:   isClosedRef: { isClosed: boolean };
 967: }
 968: 
 969: async function processBufferedText(
 970:   text: string,
 971:   ctx: ProcessChunkContext
 972: ): Promise<{ isHandled: boolean; nextReader?: ReadableStreamDefaultReader<Uint8Array> }> {
 973:   if (ctx.isClosedRef.isClosed) {
 974:     return { isHandled: true };
 975:   }
 976:   const inBandResult = await handleInBandErrorIfPresent(
 977:     text,
 978:     ctx.controller,
 979:     ctx.callbacks,
 980:     ctx.tokenState.hasSeenDataToken,
 981:     ctx.isClosedRef
 982:   );
 983:   if (inBandResult.isHandled) {
 984:     if (inBandResult.next && !ctx.isClosedRef.isClosed) {
 985:       const nextReader = applyNextAttempt(
 986:         inBandResult.next,
 987:         ctx.controller,
 988:         ctx.tokenState,
 989:         ctx.callbacks,
 990:         ctx.usageState,
 991:         ctx.isClosedRef
 992:       );
 993:       return { isHandled: true, nextReader };
 994:     }
 995:     return { isHandled: true };
 996:   }
 997: 
 998:   inspectChunkMarkers(text, ctx.tokenState);
 999:   if (ctx.callbacks?.onFinishReason) {
1000:     const finishReason = extractFinishReasonFromChunk(text);
1001:     if (finishReason) {
1002:       ctx.callbacks.onFinishReason(finishReason);
1003:     }
1004:   }
1005:   if (!ctx.usageState.usageEmitted && ctx.callbacks?.onUsage) {
1006:     const usage = extractUsageFromChunk(text);
1007:     if (usage) {
1008:       ctx.usageState.usageEmitted = true;
1009:       ctx.callbacks.onUsage(usage);
1010:     }
1011:   }
1012:   const encoder = new TextEncoder();
1013:   safeEnqueue(ctx.controller, encoder.encode(text), ctx.isClosedRef);
1014:   return { isHandled: false };
1015: }
1016: 
1017: export function createResilientStream(
1018:   firstChunk: Uint8Array,
1019:   reader: ReadableStreamDefaultReader<Uint8Array>,
1020:   callbacks?: StreamCallbacks
1021: ): ReadableStream<Uint8Array> {
1022:   let currentReader = reader;
1023:   let keepAliveTimer: IntervalHandle | null = null;
1024:   let pendingFirstChunk: Uint8Array | null = firstChunk;
1025:   let lineBuffer = "";
1026:   const isClosedRef = { isClosed: false };
1027:   const decoder = new TextDecoder("utf-8", { fatal: false });
1028:   const usageState = { usageEmitted: false };
1029:   const tokenState: StreamTokenState = {
1030:     hasSeenDoneMarker: false,
1031:     hasSeenDataToken: false,
1032:   };
1033: 
1034:   const idleTimeoutMs = getEnv().LITEROUTER_STREAM_IDLE_TIMEOUT_MS || STREAM_IDLE_TIMEOUT_MS;
1035: 
1036:   function safeCloseController(controller: ReadableStreamDefaultController<Uint8Array>): void {
1037:     clearTimer(keepAliveTimer);
1038:     safeClose(controller, isClosedRef);
1039:   }
1040: 
1041:   async function handleEof(
1042:     controller: ReadableStreamDefaultController<Uint8Array>
1043:   ): Promise<boolean> {
1044:     if (isClosedRef.isClosed) {
1045:       return false;
1046:     }
1047:     clearTimer(keepAliveTimer);
1048:     if (lineBuffer.length > 0) {
1049:       const remaining = lineBuffer;
1050:       lineBuffer = "";
1051:       const flushCtx: ProcessChunkContext = {
1052:         controller,
1053:         tokenState,
1054:         callbacks,
1055:         usageState,
1056:         isClosedRef,
1057:       };
1058:       const res = await processBufferedText(remaining, flushCtx);
1059:       if (res.isHandled) {
1060:         if (res.nextReader && !isClosedRef.isClosed) {
1061:           currentReader = res.nextReader;
1062:           keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1063:           return true;
1064:         }
1065:         return false;
1066:       }
1067:     }
1068: 
1069:     if (isClosedRef.isClosed) {
1070:       return false;
1071:     }
1072: 
1073:     const next = await handlePrematureEof(tokenState, callbacks, tokenState.hasSeenDataToken);
1074:     if (next && !isClosedRef.isClosed) {
1075:       lineBuffer = "";
1076:       const nextReader = applyNextAttempt(next, controller, tokenState, callbacks, usageState, isClosedRef);
1077:       if (nextReader) {
1078:         currentReader = nextReader;
1079:       }
1080:       keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1081:       return true;
1082:     }
1083: 
1084:     if (tokenState.hasSeenDataToken && !tokenState.hasSeenDoneMarker && !isClosedRef.isClosed) {
1085:       const provider = callbacks?.nextAttemptProvider ?? callbacks?.retryProvider;
1086:       if (provider) {
1087:         try {
1088:           const nextDrop = await provider("Upstream stream dropped mid-generation", true);
1089:           if (nextDrop && !isClosedRef.isClosed) {
1090:             lineBuffer = "";
1091:             const nextReader = applyNextAttempt(nextDrop, controller, tokenState, callbacks, usageState, isClosedRef);
1092:             if (nextReader) {
1093:               currentReader = nextReader;
1094:             }
1095:             keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1096:             return true;
1097:           }
1098:         } catch (_dropErr: unknown) {
1099:           void _dropErr;
1100:         }
1101:       }
1102:       emitStreamError(
1103:         controller,
1104:         "Upstream stream dropped mid-generation",
1105:         new Error("Upstream stream dropped mid-generation"),
1106:         callbacks,
1107:         true,
1108:         isClosedRef
1109:       );
1110:       return false;
1111:     }
1112: 
1113:     safeCloseController(controller);
1114:     return false;
1115:   }
1116: 
1117:   async function ingestBytes(
1118:     rawBytes: Uint8Array,
1119:     ctx: ProcessChunkContext
1120:   ): Promise<{ isHandled: boolean; enqueued: boolean; nextReader?: ReadableStreamDefaultReader<Uint8Array> }> {
1121:     lineBuffer += decoder.decode(rawBytes, { stream: true });
1122:     const lastNewlineIdx = lineBuffer.lastIndexOf("\n");
1123:     if (lastNewlineIdx === -1) {
1124:       return { isHandled: false, enqueued: false };
1125:     }
1126:     const completeText = lineBuffer.slice(0, lastNewlineIdx + 1);
1127:     lineBuffer = lineBuffer.slice(lastNewlineIdx + 1);
1128:     const res = await processBufferedText(completeText, ctx);
1129:     return { isHandled: res.isHandled, enqueued: !res.isHandled, nextReader: res.nextReader };
1130:   }
1131: 
1132:   return new ReadableStream<Uint8Array>({
1133:     start(controller) {
1134:       keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1135:     },
1136:     async pull(controller) {
1137:       if (isClosedRef.isClosed || controller.desiredSize === null) {
1138:         return;
1139:       }
1140:       const chunkCtx: ProcessChunkContext = {
1141:         controller,
1142:         tokenState,
1143:         callbacks,
1144:         usageState,
1145:         isClosedRef,
1146:       };
1147: 
1148:       try {
1149:         if (pendingFirstChunk !== null) {
1150:           const chunk = pendingFirstChunk;
1151:           pendingFirstChunk = null;
1152:           if (chunk.length > 0) {
1153:             const result = await ingestBytes(chunk, chunkCtx);
1154:             if (result.isHandled) {
1155:               clearTimer(keepAliveTimer);
1156:               if (result.nextReader && !isClosedRef.isClosed) {
1157:                 lineBuffer = "";
1158:                 currentReader = result.nextReader;
1159:                 keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1160:               }
1161:               return;
1162:             }
1163:             if (result.enqueued) {
1164:               return;
1165:             }
1166:           }
1167:         }
1168: 
1169:         const { done, value } = await readWithChunkTimeout(currentReader, idleTimeoutMs);
1170:         if (isClosedRef.isClosed) {
1171:           return;
1172:         }
1173:         if (done) {
1174:           await handleEof(controller);
1175:           return;
1176:         }
1177: 
1178:         if (value && value.length > 0) {
1179:           const result = await ingestBytes(value, chunkCtx);
1180:           if (result.isHandled) {
1181:             clearTimer(keepAliveTimer);
1182:             if (result.nextReader && !isClosedRef.isClosed) {
1183:               lineBuffer = "";
1184:               currentReader = result.nextReader;
1185:               keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1186:             }
1187:           }
1188:         }
1189:       } catch (err: unknown) {
1190:         clearTimer(keepAliveTimer);
1191:         if (isClosedRef.isClosed) {
1192:           return;
1193:         }
1194:         const next = await handleStreamFailure(
1195:           err,
1196:           controller,
1197:           callbacks,
1198:           tokenState.hasSeenDataToken,
1199:           isClosedRef
1200:         );
1201:         if (next && !isClosedRef.isClosed) {
1202:           lineBuffer = "";
1203:           const nextReader = applyNextAttempt(next, controller, tokenState, callbacks, usageState, isClosedRef);
1204:           if (nextReader) {
1205:             currentReader = nextReader;
1206:           }
1207:           keepAliveTimer = startKeepAliveTimer(controller, isClosedRef);
1208:         }
1209:       }
1210:     },
1211:     cancel() {
1212:       isClosedRef.isClosed = true;
1213:       clearTimer(keepAliveTimer);
1214:       currentReader.cancel().catch((err: unknown) => {
1215:         if (err instanceof Error) {
1216:           console.error(`[StreamCancel] Cancel error: ${err.message}`);
1217:         }
1218:       });
1219:     },
1220:   });
1221: }
```

## File: src/transformers/openai_chat.ts
```typescript
  1: import type { ParsedDirective } from "../directive/types";
  2: import type {
  3:   OutboundWirePayload,
  4:   PayloadTransformerContract,
  5: } from "../engine/transformer";
  6: import type { RequestTelemetry, UsageRecord } from "../telemetry/session";
  7: import {
  8:   filterReasoningFromChunk,
  9:   stripReasoningFromResponseBody,
 10: } from "./opencode_adapter";
 11: import { sanitizeAndTransformPayload } from "./payload";
 12: import type { OpenAIRequestPayload } from "./nuances";
 13: import { EMOJI, logWarn } from "../ui/logger";
 14: 
 15: interface ParsedUsageDetails {
 16:   readonly reasoning_tokens?: number;
 17:   readonly thinking_tokens?: number;
 18: }
 19: 
 20: interface RawUsagePayload {
 21:   readonly prompt_tokens?: number;
 22:   readonly completion_tokens?: number;
 23:   readonly total_tokens?: number;
 24:   readonly input_tokens?: number;
 25:   readonly output_tokens?: number;
 26:   readonly completion_tokens_details?: ParsedUsageDetails;
 27:   readonly output_tokens_details?: ParsedUsageDetails;
 28: }
 29: 
 30: interface StreamState {
 31:   lineBuffer: string;
 32:   ttftMarked: boolean;
 33:   usageRecorded: boolean;
 34:   latestFinishReason: string | null;
 35: }
 36: 
 37: function extractDirectiveNuances(directive: ParsedDirective): readonly string[] {
 38:   return "nuances" in directive ? directive.nuances : [];
 39: }
 40: 
 41: function extractDirectiveWire(directive: ParsedDirective): string {
 42:   if ("payload" in directive) {
 43:     return directive.wire ?? directive.payload;
 44:   }
 45:   return "oa";
 46: }
 47: 
 48: function shouldScrubReasoning(directive: ParsedDirective): boolean {
 49:   const nuances = extractDirectiveNuances(directive);
 50:   const wire = extractDirectiveWire(directive);
 51:   if (nuances.includes("ts")) {
 52:     return false;
 53:   }
 54:   return wire === "oa" || nuances.includes("sb");
 55: }
 56: 
 57: function extractReasoningTokens(usage: RawUsagePayload): number | undefined {
 58:   const details = usage.completion_tokens_details ?? usage.output_tokens_details;
 59:   if (!details || typeof details !== "object") {
 60:     return undefined;
 61:   }
 62:   return details.reasoning_tokens ?? details.thinking_tokens;
 63: }
 64: 
 65: function parseOpenAiUsage(data: Record<string, unknown>): UsageRecord | null {
 66:   if (!data.usage || typeof data.usage !== "object") {
 67:     return null;
 68:   }
 69:   const u = data.usage as RawUsagePayload;
 70:   const promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0;
 71:   const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0;
 72:   const totalTokens = u.total_tokens ?? (promptTokens + completionTokens);
 73:   const reasoningTokens = extractReasoningTokens(u);
 74: 
 75:   return {
 76:     promptTokens,
 77:     completionTokens,
 78:     totalTokens,
 79:     reasoningTokens,
 80:   };
 81: }
 82: 
 83: function extractFinishReason(data: Record<string, unknown>): string | null {
 84:   if (!Array.isArray(data.choices) || data.choices.length === 0) {
 85:     return null;
 86:   }
 87:   const choice = data.choices[0] as { finish_reason?: unknown };
 88:   if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
 89:     return choice.finish_reason;
 90:   }
 91:   return null;
 92: }
 93: 
 94: function hasContentToken(data: Record<string, unknown>, shouldScrub: boolean): boolean {
 95:   if (!Array.isArray(data.choices) || data.choices.length === 0) {
 96:     return false;
 97:   }
 98:   const first = data.choices[0] as { delta?: Record<string, unknown> };
 99:   const delta = first?.delta;
100:   if (!delta || typeof delta !== "object") {
101:     return false;
102:   }
103:   if (typeof delta.content === "string" && delta.content.length > 0) {
104:     return true;
105:   }
106:   if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
107:     return true;
108:   }
109:   if (!shouldScrub && typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
110:     return true;
111:   }
112:   return false;
113: }
114: 
115: function recordTelemetryEvents(
116:   parsed: Record<string, unknown>,
117:   state: StreamState,
118:   shouldScrub: boolean,
119:   telemetry: RequestTelemetry
120: ): void {
121:   if (!state.ttftMarked && hasContentToken(parsed, shouldScrub)) {
122:     state.ttftMarked = true;
123:     telemetry.markTtft("openai");
124:   }
125: 
126:   const finishReason = extractFinishReason(parsed);
127:   if (finishReason) {
128:     state.latestFinishReason = finishReason;
129:   }
130: 
131:   const usage = parseOpenAiUsage(parsed);
132:   if (usage && !state.usageRecorded) {
133:     state.usageRecorded = true;
134:     telemetry.recordUsage({
135:       ...usage,
136:       finishReason: state.latestFinishReason,
137:     });
138:   }
139: }
140: 
141: function emitFilteredOrRaw(
142:   parsed: Record<string, unknown>,
143:   shouldScrub: boolean,
144:   reqId: string | undefined,
145:   controller: TransformStreamDefaultController<Uint8Array>,
146:   encoder: TextEncoder
147: ): void {
148:   if (!shouldScrub) {
149:     controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
150:     return;
151:   }
152: 
153:   const { filteredData, shouldEmit } = filterReasoningFromChunk(parsed, reqId);
154:   if (shouldEmit) {
155:     controller.enqueue(encoder.encode(`data: ${JSON.stringify(filteredData)}\n\n`));
156:   }
157: }
158: 
159: function handleDataChunk(
160:   dataStr: string,
161:   state: StreamState,
162:   directive: ParsedDirective,
163:   telemetry: RequestTelemetry,
164:   controller: TransformStreamDefaultController<Uint8Array>,
165:   encoder: TextEncoder
166: ): void {
167:   if (dataStr === "[DONE]") {
168:     controller.enqueue(encoder.encode("data: [DONE]\n\n"));
169:     return;
170:   }
171: 
172:   let parsed: Record<string, unknown>;
173:   try {
174:     parsed = JSON.parse(dataStr) as Record<string, unknown>;
175:   } catch (parseErr) {
176:     const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
177:     logWarn(EMOJI.amber, `Invalid JSON in SSE data line: ${msg}`);
178:     controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
179:     return;
180:   }
181: 
182:   const shouldScrub = shouldScrubReasoning(directive);
183:   recordTelemetryEvents(parsed, state, shouldScrub, telemetry);
184:   emitFilteredOrRaw(parsed, shouldScrub, telemetry.reqId, controller, encoder);
185: }
186: 
187: function handleLine(
188:   rawLine: string,
189:   state: StreamState,
190:   directive: ParsedDirective,
191:   telemetry: RequestTelemetry,
192:   controller: TransformStreamDefaultController<Uint8Array>,
193:   encoder: TextEncoder
194: ): void {
195:   const line = rawLine.trim();
196:   if (line.length === 0) {
197:     return;
198:   }
199:   if (line.startsWith(":")) {
200:     controller.enqueue(encoder.encode(`${line}\n\n`));
201:     return;
202:   }
203:   if (line.startsWith("data:")) {
204:     const dataStr = line.slice(5).trim();
205:     handleDataChunk(dataStr, state, directive, telemetry, controller, encoder);
206:     return;
207:   }
208:   controller.enqueue(encoder.encode(`${line}\n\n`));
209: }
210: 
211: export class OpenAIChatTransformer implements PayloadTransformerContract {
212:   /** Pure: converts client request body to upstream wire format */
213:   transformClientToWire(
214:     inboundBody: Record<string, unknown>,
215:     directive: ParsedDirective,
216:     headers: Headers
217:   ): OutboundWirePayload {
218:     const isStreaming = Boolean(inboundBody.stream);
219:     const wireHeaders: Record<string, string> = {
220:       "content-type": "application/json",
221:     };
222:     headers.forEach((value, key) => {
223:       wireHeaders[key.toLowerCase()] = value;
224:     });
225: 
226:     const nuances = extractDirectiveNuances(directive);
227:     const wire = extractDirectiveWire(directive);
228:     let transformedBody = sanitizeAndTransformPayload(
229:       inboundBody as OpenAIRequestPayload,
230:       {
231:         nuances,
232:         targetWire: wire as "oa" | "oo" | "cl" | "gg" | "rs" | "ao",
233:         enableScrubbing: true,
234:       }
235:     ) as Record<string, unknown>;
236: 
237:     const providerCode = directive.type === "direct" ? String(directive.provider) : "";
238:     if (providerCode === "zn" || providerCode === "zen") {
239:       const { adaptZenPayload, scrubZenHeaders } = require("../engine/zen");
240:       scrubZenHeaders(wireHeaders);
241:       const adapted = adaptZenPayload(transformedBody);
242:       transformedBody = adapted.adaptedBody;
243:     }
244: 
245:     return {
246:       endpointKey: "ch",
247:       method: "POST",
248:       headers: wireHeaders,
249:       body: transformedBody,
250:       isStreaming,
251:     };
252:   }
253: 
254:   /** Pure: converts upstream non-streaming response to client format */
255:   transformWireToClient(
256:     upstreamJson: unknown,
257:     directive: ParsedDirective
258:   ): unknown {
259:     if (!upstreamJson || typeof upstreamJson !== "object") {
260:       return upstreamJson;
261:     }
262: 
263:     if (shouldScrubReasoning(directive)) {
264:       const cloned = structuredClone(upstreamJson) as Record<string, unknown>;
265:       stripReasoningFromResponseBody(cloned);
266:       return cloned;
267:     }
268: 
269:     return upstreamJson;
270:   }
271: 
272:   /**
273:    * Returns a TransformStream for streaming response translation.
274:    * Parses inbound SSE chunks (data: {...}).
275:    * Calls telemetry.markTtft() on first content chunk.
276:    * Calls telemetry.recordUsage() on final chunk if usage block is present.
277:    * Handles reasoning scrubbing per nuance (oa wire scrubs reasoning_content unless ts nuance is present).
278:    * Emits standard OpenAI SSE chunks.
279:    */
280:   createWireToClientStream(
281:     directive: ParsedDirective,
282:     telemetry: RequestTelemetry,
283:     clientSignal: AbortSignal
284:   ): TransformStream<Uint8Array, Uint8Array> {
285:     const decoder = new TextDecoder();
286:     const encoder = new TextEncoder();
287:     const state: StreamState = {
288:       lineBuffer: "",
289:       ttftMarked: false,
290:       usageRecorded: false,
291:       latestFinishReason: null,
292:     };
293: 
294:     return new TransformStream<Uint8Array, Uint8Array>({
295:       transform(chunk, controller) {
296:         if (clientSignal.aborted || chunk.byteLength === 0) {
297:           return;
298:         }
299:         state.lineBuffer += decoder.decode(chunk, { stream: true });
300:         const lines = state.lineBuffer.split("\n");
301:         state.lineBuffer = lines.pop() ?? "";
302: 
303:         for (const line of lines) {
304:           if (clientSignal.aborted) {
305:             return;
306:           }
307:           handleLine(line, state, directive, telemetry, controller, encoder);
308:         }
309:       },
310: 
311:       flush(controller) {
312:         if (clientSignal.aborted) {
313:           return;
314:         }
315:         const remaining = decoder.decode();
316:         if (remaining.length > 0) {
317:           state.lineBuffer += remaining;
318:         }
319:         if (state.lineBuffer.trim().length > 0) {
320:           const lines = state.lineBuffer.split("\n");
321:           state.lineBuffer = "";
322:           for (const line of lines) {
323:             handleLine(line, state, directive, telemetry, controller, encoder);
324:           }
325:         }
326:       },
327:     });
328:   }
329: }
330: 
331: export const openAiChatTransformer = new OpenAIChatTransformer();
```

## File: src/transformers/openai_responses.ts
```typescript
  1: import type { ParsedDirective } from "../directive/types";
  2: import type {
  3:   OutboundWirePayload,
  4:   PayloadTransformerContract,
  5: } from "../engine/transformer";
  6: import type { RequestTelemetry } from "../telemetry/session";
  7: 
  8: export interface ResponsesUsageDetails {
  9:   readonly reasoning_tokens?: number;
 10: }
 11: 
 12: export interface ResponsesInputTokensDetails {
 13:   readonly cached_tokens?: number;
 14: }
 15: 
 16: export interface ResponsesUsagePayload {
 17:   readonly prompt_tokens?: number;
 18:   readonly completion_tokens?: number;
 19:   readonly total_tokens?: number;
 20:   readonly input_tokens?: number;
 21:   readonly output_tokens?: number;
 22:   readonly cached_tokens?: number;
 23:   readonly cachedTokens?: number;
 24:   readonly completion_tokens_details?: ResponsesUsageDetails;
 25:   readonly output_tokens_details?: ResponsesUsageDetails;
 26:   readonly input_tokens_details?: ResponsesInputTokensDetails;
 27:   readonly prompt_tokens_details?: ResponsesInputTokensDetails;
 28: }
 29: 
 30: export interface ParsedUsageInfo {
 31:   readonly promptTokens: number;
 32:   readonly completionTokens: number;
 33:   readonly totalTokens: number;
 34:   readonly reasoningTokens?: number;
 35:   readonly cachedTokens?: number;
 36: }
 37: 
 38: export function parseResponsesUsage(usageObj: unknown): ParsedUsageInfo | null {
 39:   if (!usageObj || typeof usageObj !== "object") {
 40:     return null;
 41:   }
 42:   const u = usageObj as ResponsesUsagePayload;
 43:   const prompt = typeof u.input_tokens === "number"
 44:     ? u.input_tokens
 45:     : typeof u.prompt_tokens === "number"
 46:       ? u.prompt_tokens
 47:       : null;
 48:   const completion = typeof u.output_tokens === "number"
 49:     ? u.output_tokens
 50:     : typeof u.completion_tokens === "number"
 51:       ? u.completion_tokens
 52:       : null;
 53: 
 54:   if (prompt === null || completion === null) {
 55:     return null;
 56:   }
 57: 
 58:   const total = typeof u.total_tokens === "number" ? u.total_tokens : prompt + completion;
 59: 
 60:   let reasoning: number | undefined;
 61:   if (typeof u.output_tokens_details?.reasoning_tokens === "number") {
 62:     reasoning = u.output_tokens_details.reasoning_tokens;
 63:   } else if (typeof u.completion_tokens_details?.reasoning_tokens === "number") {
 64:     reasoning = u.completion_tokens_details.reasoning_tokens;
 65:   }
 66: 
 67:   let cached: number | undefined;
 68:   if (typeof u.input_tokens_details?.cached_tokens === "number") {
 69:     cached = u.input_tokens_details.cached_tokens;
 70:   } else if (typeof u.prompt_tokens_details?.cached_tokens === "number") {
 71:     cached = u.prompt_tokens_details.cached_tokens;
 72:   } else if (typeof u.cached_tokens === "number") {
 73:     cached = u.cached_tokens;
 74:   } else if (typeof u.cachedTokens === "number") {
 75:     cached = u.cachedTokens;
 76:   }
 77: 
 78:   return {
 79:     promptTokens: prompt,
 80:     completionTokens: completion,
 81:     totalTokens: total,
 82:     reasoningTokens: reasoning,
 83:     cachedTokens: cached,
 84:   };
 85: }
 86: 
 87: export function extractResponsesUsageFromPayload(payload: Record<string, unknown>): ParsedUsageInfo | null {
 88:   if (payload.response && typeof payload.response === "object") {
 89:     const resp = payload.response as Record<string, unknown>;
 90:     const parsed = parseResponsesUsage(resp.usage);
 91:     if (parsed) return parsed;
 92:   }
 93:   return parseResponsesUsage(payload.usage);
 94: }
 95: 
 96: export function extractResponsesFinishReason(payload: Record<string, unknown>): string | null {
 97:   const resp = payload.response && typeof payload.response === "object"
 98:     ? (payload.response as Record<string, unknown>)
 99:     : payload;
100: 
101:   if (typeof resp.status === "string" && resp.status.length > 0) {
102:     if (resp.status === "completed") {
103:       return "stop";
104:     }
105:     if (resp.status === "incomplete") {
106:       const details = resp.incomplete_details as Record<string, unknown> | undefined;
107:       const reason = details && typeof details === "object" ? details.reason : undefined;
108:       if (reason === "max_output_tokens") {
109:         return "length";
110:       }
111:       if (reason === "content_filter") {
112:         return "content_filter";
113:       }
114:       return "incomplete";
115:     }
116:     if (resp.status === "cancelled") {
117:       return "cancelled";
118:     }
119:     if (resp.status === "failed") {
120:       return "error";
121:     }
122:     if (resp.status !== "in_progress") {
123:       return resp.status;
124:     }
125:   }
126: 
127:   if (Array.isArray(resp.choices) && resp.choices[0] && typeof resp.choices[0].finish_reason === "string") {
128:     return resp.choices[0].finish_reason;
129:   }
130:   return null;
131: }
132: 
133: export function isContentEventOrDelta(eventType: string, parsed: Record<string, unknown>): boolean {
134:   if (
135:     eventType === "response.output_text.delta" ||
136:     eventType === "response.reasoning_text.delta" ||
137:     eventType === "response.function_call_arguments.delta" ||
138:     eventType === "response.audio.delta" ||
139:     eventType === "response.refusal.delta"
140:   ) {
141:     return true;
142:   }
143:   if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
144:     return true;
145:   }
146:   if (parsed.delta && typeof parsed.delta === "object") {
147:     return true;
148:   }
149:   return false;
150: }
151: 
152: export class OpenAIResponsesTransformer implements PayloadTransformerContract {
153:   /** Pure: converts client request body to upstream Responses wire format */
154:   transformClientToWire(
155:     inboundBody: Record<string, unknown>,
156:     directive: ParsedDirective,
157:     headers: Headers
158:   ): OutboundWirePayload {
159:     const isStreaming = Boolean(inboundBody.stream);
160:     const wireHeaders: Record<string, string> = {
161:       "Content-Type": "application/json",
162:     };
163: 
164:     if (headers && typeof headers.forEach === "function") {
165:       headers.forEach((value, key) => {
166:         wireHeaders[key.toLowerCase()] = value;
167:       });
168:     }
169: 
170:     let transformedBody = { ...inboundBody };
171:     const providerCode = directive.type === "direct" ? String(directive.provider) : "";
172:     if (providerCode === "zn" || providerCode === "zen") {
173:       const { adaptZenResponsesPayload, scrubZenHeaders } = require("../engine/zen");
174:       scrubZenHeaders(wireHeaders);
175:       const adapted = adaptZenResponsesPayload(transformedBody);
176:       transformedBody = adapted.adaptedBody;
177:     }
178: 
179:     return {
180:       endpointKey: "rs",
181:       method: "POST",
182:       headers: wireHeaders,
183:       body: transformedBody,
184:       isStreaming,
185:     };
186:   }
187: 
188:   /**
189:    * Pure: converts upstream non-streaming response to client format.
190:    * Responses API native wire format preserves reasoning and outputs verbatim.
191:    */
192:   transformWireToClient(
193:     upstreamJson: unknown,
194:     _directive: ParsedDirective
195:   ): unknown {
196:     return upstreamJson;
197:   }
198: 
199:   /**
200:    * Returns a TransformStream for native OpenAI Responses SSE stream handling.
201:    * Preserves all reasoning tokens and SSE events without scrubbing.
202:    * Calls telemetry.markTtft() on the first content delta.
203:    * Calls telemetry.recordUsage() when usage metadata is encountered (e.g. response.done / response.completed).
204:    */
205:   createWireToClientStream(
206:     _directive: ParsedDirective,
207:     telemetry: RequestTelemetry,
208:     clientSignal: AbortSignal
209:   ): TransformStream<Uint8Array, Uint8Array> {
210:     const decoder = new TextDecoder();
211:     let lineBuffer = "";
212:     let currentEvent = "";
213:     let ttftMarked = false;
214:     let usageRecorded = false;
215:     let latestFinishReason: string | null = null;
216: 
217:     const recordUsageOnce = (usageInfo: ParsedUsageInfo, finishReason?: string | null) => {
218:       if (usageRecorded) return;
219:       usageRecorded = true;
220:       telemetry.recordUsage({
221:         promptTokens: usageInfo.promptTokens,
222:         completionTokens: usageInfo.completionTokens,
223:         totalTokens: usageInfo.totalTokens,
224:         reasoningTokens: usageInfo.reasoningTokens,
225:         finishReason: finishReason ?? latestFinishReason,
226:       });
227:     };
228: 
229:     const processLine = (rawLine: string) => {
230:       const line = rawLine.trim();
231:       if (line.startsWith("event:")) {
232:         currentEvent = line.slice("event:".length).trim();
233:         return;
234:       }
235:       if (!line.startsWith("data:")) {
236:         if (line === "") {
237:           currentEvent = "";
238:         }
239:         return;
240:       }
241: 
242:       const dataStr = line.slice("data:".length).trim();
243:       if (!dataStr || dataStr === "[DONE]") {
244:         return;
245:       }
246: 
247:       let parsed: Record<string, unknown>;
248:       try {
249:         parsed = JSON.parse(dataStr);
250:       } catch {
251:         return;
252:       }
253: 
254:       const eventType = currentEvent || (typeof parsed.type === "string" ? parsed.type : "");
255: 
256:       // 1. Mark TTFT on first content delta chunk
257:       if (!ttftMarked && isContentEventOrDelta(eventType, parsed)) {
258:         ttftMarked = true;
259:         telemetry.markTtft();
260:       }
261: 
262:       // 2. Track finish reason
263:       const reason = extractResponsesFinishReason(parsed);
264:       if (reason) {
265:         latestFinishReason = reason;
266:       }
267: 
268:       // 3. Record usage if present in response.done / response.completed or root
269:       const usage = extractResponsesUsageFromPayload(parsed);
270:       if (usage) {
271:         recordUsageOnce(usage, reason);
272:       }
273:     };
274: 
275:     return new TransformStream<Uint8Array, Uint8Array>({
276:       transform(chunk, controller) {
277:         if (clientSignal.aborted || chunk.byteLength === 0) {
278:           return;
279:         }
280: 
281:         lineBuffer += decoder.decode(chunk, { stream: true });
282:         const lines = lineBuffer.split("\n");
283:         lineBuffer = lines.pop() ?? "";
284: 
285:         for (const line of lines) {
286:           processLine(line);
287:         }
288: 
289:         controller.enqueue(chunk);
290:       },
291: 
292:       flush(controller) {
293:         const remaining = decoder.decode();
294:         if (remaining.length > 0) {
295:           lineBuffer += remaining;
296:         }
297:         if (lineBuffer.trim().length > 0) {
298:           for (const line of lineBuffer.split("\n")) {
299:             processLine(line);
300:           }
301:         }
302:         lineBuffer = "";
303:       },
304:     });
305:   }
306: }
307: 
308: export const openAiResponsesTransformer = new OpenAIResponsesTransformer();
```

## File: src/ui/logger.ts
```typescript
  1: import { getProviderDisplayName as getRegistryProviderDisplayName } from "../config/providers";
  2: 
  3: function pad2(n: number): string {
  4:   return n.toString().padStart(2, "0");
  5: }
  6: 
  7: function pad3(n: number): string {
  8:   return n.toString().padStart(3, "0");
  9: }
 10: 
 11: export function formatTimestamp(d: Date = new Date()): string {
 12:   const mm = pad2(d.getMonth() + 1);
 13:   const dd = pad2(d.getDate());
 14:   const hh = pad2(d.getHours());
 15:   const min = pad2(d.getMinutes());
 16:   const ss = pad2(d.getSeconds());
 17:   const ms = pad3(d.getMilliseconds());
 18:   return `[${mm}-${dd}-${hh}:${min}:${ss}:${ms}]`;
 19: }
 20: 
 21: export const PROVIDER_NAMES: Readonly<Record<string, string>> = Object.freeze({
 22:   or: "OpenRouter",
 23:   nv: "NVIDIA NIM",
 24:   gg: "Google",
 25:   zn: "Zen",
 26:   oa: "OpenAI",
 27:   an: "Anthropic",
 28:   gq: "Groq",
 29:   cb: "Cerebras",
 30:   ds: "DeepSeek",
 31:   ms: "Mistral",
 32:   tg: "Together",
 33:   tp: "TestProvider",
 34:   gc: "GCP (Gemma)",
 35: });
 36: 
 37: export const WIRE_NAMES: Readonly<Record<string, string>> = Object.freeze({
 38:   oa: "OpenAI",
 39:   cl: "Claude",
 40:   gg: "Google",
 41:   rs: "Responses",
 42: });
 43: 
 44: export const EMOJI = Object.freeze({
 45:   inbound: "🔵",
 46:   ttft: "🟢",
 47:   usage: "🟣",
 48:   servedOk: "🟢",
 49:   servedErr: "⚠️",
 50:   rotate: "🔄",
 51:   limit: "⚠️",
 52:   retry: "🟠",
 53:   exhausted: "🔴",
 54:   amber: "🟡",
 55:   pacer: "🐢",
 56:   boot: "🚀",
 57:   error: "💥",
 58:   fusion: "🔗",
 59:   finish: "🏁",
 60:   finishTrunc: "⚠️",
 61:   prep: "📦",
 62:   upstream: "🔌",
 63:   stats: "📊",
 64:   prune: "✂️",
 65:   zap: "⚡",
 66:   hourglass: "⏳",
 67:   directive: "🎯",
 68:   model: "🤖",
 69:   tokens: "💬",
 70: });
 71: 
 72: export function getProviderDisplayName(code: string): string {
 73:   const normalized = code.toLowerCase();
 74:   return PROVIDER_NAMES[normalized] || code.toUpperCase();
 75: }
 76: 
 77: export function getProviderDisplayNameCompat(code: string): string {
 78:   const normalized = code.toLowerCase();
 79:   return PROVIDER_NAMES[code] ?? PROVIDER_NAMES[normalized] ?? getRegistryProviderDisplayName(code) ?? code.toUpperCase();
 80: }
 81: 
 82: export function getWireDisplayName(code: string): string {
 83:   const normalized = code.toLowerCase();
 84:   return WIRE_NAMES[normalized] || code.toUpperCase();
 85: }
 86: 
 87: export function formatModelDisplay(
 88:   model: string,
 89:   resolvedModel?: string,
 90:   tier?: number
 91: ): string {
 92:   if (resolvedModel && resolvedModel !== model) {
 93:     return `${model} ➔ ${resolvedModel}${tier !== undefined ? ` (Tier ${tier})` : ""}`;
 94:   }
 95:   return `${model}`;
 96: }
 97: 
 98: export function logModel(
 99:   reqId: string,
100:   model: string,
101:   resolvedModel?: string,
102:   tier?: number
103: ): void {
104:   const ts = formatTimestamp();
105:   const display = formatModelDisplay(model, resolvedModel, tier);
106:   console.log(`${EMOJI.model} ${ts} [${reqId}] Model: ${display}`);
107: }
108: 
109: export interface InboundLogDetails {
110:   readonly reqId: string;
111:   readonly method: string;
112:   readonly path: string;
113:   readonly clientAgent: string;
114:   readonly protocol?: string;
115:   readonly directiveStr?: string;
116:   readonly targetProvider?: string;
117:   readonly wireFormat?: string;
118:   readonly endpoint?: string;
119:   readonly model?: string;
120:   readonly resolvedModel?: string;
121:   readonly tier?: number;
122:   readonly keyIndex?: number;
123:   readonly totalKeys?: number;
124:   readonly nuances?: readonly string[];
125:   readonly referrer?: string;
126: }
127: 
128: export function logInbound(
129:   reqIdOrDetails: string | InboundLogDetails,
130:   method?: string,
131:   path?: string,
132:   clientAgent?: string,
133:   directiveStr?: string
134: ): void {
135:   const ts = formatTimestamp();
136: 
137:   if (typeof reqIdOrDetails === "object") {
138:     const d = reqIdOrDetails;
139:     const client = d.clientAgent || "Unknown";
140:     const protoStr = d.protocol ? ` [${d.protocol}]` : "";
141:     console.log(`${EMOJI.inbound} ${ts} [${d.reqId}] Inbound ${d.method} ${d.path}${protoStr} from ${client}`);
142:     
143:     if (d.directiveStr) {
144:       const target = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Direct";
145:       const wire = d.wireFormat ? getWireDisplayName(d.wireFormat) : "OpenAI";
146:       const ep = d.endpoint ? ` | EP: ${d.endpoint}` : "";
147:       console.log(`${EMOJI.directive} ${ts} [${d.reqId}] Directive: ${d.directiveStr} -> Target: ${target} | Wire: ${wire}${ep}`);
148:     }
149: 
150:     if (d.model) {
151:       const provLabel = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Provider";
152:       let keyInfo = "";
153:       if (d.keyIndex !== undefined) {
154:         const keyIdx = d.keyIndex + 1;
155:         const keyTotal = d.totalKeys !== undefined ? `/${d.totalKeys}` : "";
156:         keyInfo = ` | Key: ${provLabel} [Key #${keyIdx}${keyTotal}]`;
157:       } else if (d.totalKeys !== undefined) {
158:         keyInfo = ` | Pool: ${provLabel} (${d.totalKeys} ${d.totalKeys === 1 ? "key" : "keys"})`;
159:       }
160:       const nuanceInfo = d.nuances && d.nuances.length > 0 && d.nuances[0] !== "no"
161:         ? ` | Nuances: [${d.nuances.join(", ")}]`
162:         : "";
163:       const refInfo = d.referrer ? ` | Ref: ${d.referrer.split(" @ ")[0]}` : "";
164:       const modelDisplay = formatModelDisplay(d.model, d.resolvedModel, d.tier);
165:       console.log(`${EMOJI.model} ${ts} [${d.reqId}] Model: ${modelDisplay}${keyInfo}${nuanceInfo}${refInfo}`);
166:     }
167:     return;
168:   }
169: 
170:   const reqId = reqIdOrDetails;
171:   const dir = directiveStr ? ` | Directive: ${directiveStr}` : "";
172:   console.log(`${EMOJI.inbound} ${ts} [${reqId}] Inbound ${method || "POST"} ${path || "/"} (${clientAgent || "Client"})${dir}`);
173: }
174: 
175: export function logTtft(
176:   reqId: string,
177:   ttftMs: number,
178:   details = "Stream established",
179:   protocol?: string
180: ): void {
181:   const ts = formatTimestamp();
182:   const protoStr = protocol ? ` [Upstream: ${protocol}]` : "";
183:   console.log(`${EMOJI.ttft} ${ts} [TTFT ${reqId}] TTFT = ${ttftMs}ms | ${details}${protoStr}`);
184: }
185: 
186: export interface UsageLogDetails {
187:   readonly reqId: string;
188:   readonly provider: string;
189:   readonly keyIndex?: number;
190:   readonly totalKeys?: number;
191:   readonly promptTokens: number;
192:   readonly reasoningTokens?: number;
193:   readonly completionTokens: number;
194:   readonly totalTokens: number;
195:   readonly durationMs?: number;
196: }
197: 
198: export function formatTokenNumber(num: number): string {
199:   return num.toLocaleString("en-US");
200: }
201: 
202: export function logUsage(details: UsageLogDetails): void {
203:   const ts = formatTimestamp();
204:   const provName = getProviderDisplayName(details.provider);
205:   const keyIdx = details.keyIndex !== undefined ? details.keyIndex + 1 : 1;
206:   const totalKeysStr = details.totalKeys !== undefined ? `/${details.totalKeys}` : "";
207:   
208:   let speedStr = "";
209:   if (details.durationMs && details.durationMs > 0 && details.completionTokens > 0) {
210:     const sec = details.durationMs / 1000;
211:     const speed = (details.completionTokens / sec).toFixed(1);
212:     speedStr = ` | Speed=${speed} tok/s`;
213:   }
214: 
215:   const reasoningStr = details.reasoningTokens && details.reasoningTokens > 0
216:     ? ` | Reasoning=${formatTokenNumber(details.reasoningTokens)}`
217:     : "";
218: 
219:   console.log(`${EMOJI.usage} ${ts} [USAGE ${details.reqId}] ${provName} (Key #${keyIdx}${totalKeysStr})`);
220:   console.log(
221:     `${EMOJI.tokens} ${ts} [USAGE ${details.reqId}] Tokens: Prompt=${formatTokenNumber(details.promptTokens)}${reasoningStr} | Completion=${formatTokenNumber(details.completionTokens)} | Total=${formatTokenNumber(details.totalTokens)}${speedStr}`
222:   );
223: }
224: 
225: export function logRotate(
226:   reqId: string,
227:   provider: string,
228:   oldIdx: number,
229:   newIdx: number,
230:   total: number,
231:   attempt?: number,
232:   maxAttempts?: number
233: ): void {
234:   const ts = formatTimestamp();
235:   const provName = getProviderDisplayName(provider);
236:   const attemptStr = attempt && maxAttempts ? ` (Attempt ${attempt}/${maxAttempts})` : "";
237:   console.log(`${EMOJI.rotate} ${ts} [ROTATE ${reqId}] Advancing to ${provName} [Key #${newIdx + 1}/${total}] -> Retrying immediately${attemptStr}`);
238: }
239: 
240: export function getHttpStatusText(status: number): string {
241:   switch (status) {
242:     case 429:
243:       return "429 Too Many Requests";
244:     case 500:
245:       return "500 Internal Server Error";
246:     case 502:
247:       return "502 Bad Gateway";
248:     case 503:
249:       return "503 Service Unavailable";
250:     case 504:
251:       return "504 Gateway Timeout";
252:     default:
253:       return `HTTP ${status}`;
254:   }
255: }
256: 
257: export function extractErrorMessage(bodyText?: string): string | undefined {
258:   if (!bodyText || !bodyText.trim()) {
259:     return undefined;
260:   }
261:   const trimmed = bodyText.trim();
262:   try {
263:     const json = JSON.parse(trimmed) as Record<string, unknown>;
264:     if (json.error && typeof json.error === "object") {
265:       const errObj = json.error as Record<string, unknown>;
266:       if (typeof errObj.message === "string" && errObj.message) {
267:         return errObj.message;
268:       }
269:     }
270:     if (typeof json.error === "string" && json.error) {
271:       return json.error;
272:     }
273:     if (typeof json.message === "string" && json.message) {
274:       return json.message;
275:     }
276:     if (typeof json.detail === "string" && json.detail) {
277:       return json.detail;
278:     }
279:   } catch (parseErr) {
280:     void parseErr;
281:   }
282:   return trimmed;
283: }
284: 
285: /**
286:  * Derive a condensed snake_case error taxonomy token from an upstream error
287:  * message and HTTP status. Defensive fallback used when the classifier does
288:  * not supply an error_type (classifier ErrorDisposition carries only `reason`).
289:  * Returns only fixed taxonomy tokens — never echoes raw message content, so
290:  * the condensed terminal line cannot leak keys or secrets.
291:  */
292: export function deriveErrorType(rawMessage?: string, status?: number): string {
293:   const text = (rawMessage ?? "").toLowerCase();
294: 
295:   if (
296:     text.includes("content policy") ||
297:     text.includes("content_policy") ||
298:     text.includes("content filter") ||
299:     text.includes("content_filter") ||
300:     text.includes("moderation") ||
301:     text.includes("harmful content") ||
302:     text.includes("safety")
303:   ) {
304:     return "content_policy_violation";
305:   }
306:   if (
307:     text.includes("context length") ||
308:     text.includes("context_length") ||
309:     text.includes("context window") ||
310:     text.includes("max_tokens") ||
311:     text.includes("maximum context") ||
312:     text.includes("too many tokens") ||
313:     text.includes("token limit")
314:   ) {
315:     return "context_length_exceeded";
316:   }
317:   if (
318:     text.includes("insufficient_quota") ||
319:     text.includes("insufficient quota") ||
320:     text.includes("credit_limit") ||
321:     text.includes("credit limit") ||
322:     text.includes("out of balance") ||
323:     text.includes("quota exceeded") ||
324:     text.includes("quota_exceeded")
325:   ) {
326:     return "insufficient_quota";
327:   }
328:   if (
329:     text.includes("rate limit") ||
330:     text.includes("rate_limit") ||
331:     text.includes("too many requests") ||
332:     text.includes("throttl")
333:   ) {
334:     return "rate_limit_exceeded";
335:   }
336:   if (
337:     text.includes("invalid api key") ||
338:     text.includes("invalid_api_key") ||
339:     text.includes("invalid key") ||
340:     text.includes("incorrect api key") ||
341:     text.includes("invalid authentication")
342:   ) {
343:     return "invalid_api_key";
344:   }
345:   if (
346:     text.includes("model not found") ||
347:     text.includes("model_not_found") ||
348:     text.includes("no such model")
349:   ) {
350:     return "model_not_found";
351:   }
352:   if (text.includes("overloaded") || text.includes("capacity")) {
353:     return "overloaded";
354:   }
355:   if (
356:     text.includes("permission") ||
357:     text.includes("forbidden") ||
358:     text.includes("access denied") ||
359:     text.includes("not allowed") ||
360:     text.includes("unauthorized")
361:   ) {
362:     return "permission_denied";
363:   }
364:   if (
365:     text.includes("internal server error") ||
366:     text.includes("internal error") ||
367:     text.includes("bad gateway") ||
368:     text.includes("service unavailable") ||
369:     text.includes("gateway timeout")
370:   ) {
371:     return "server_error";
372:   }
373:   if (
374:     text.includes("invalid request") ||
375:     text.includes("bad request") ||
376:     text.includes("validation") ||
377:     text.includes("invalid parameter") ||
378:     text.includes("malformed")
379:   ) {
380:     return "invalid_request_error";
381:   }
382: 
383:   switch (status) {
384:     case 400:
385:       return "invalid_request_error";
386:     case 401:
387:       return "authentication_error";
388:     case 403:
389:       return "permission_denied";
390:     case 404:
391:       return "model_not_found";
392:     case 409:
393:       return "conflict";
394:     case 422:
395:       return "unprocessable_entity";
396:     case 429:
397:       return "rate_limit_exceeded";
398:     default:
399:       break;
400:   }
401:   if (status !== undefined && status >= 500 && status < 600) {
402:     return "server_error";
403:   }
404:   return "upstream_error";
405: }
406: 
407: export function logLimit(
408:   reqId: string,
409:   provider: string,
410:   keyIdx: number,
411:   status = 429,
412:   retryAfterSec?: number,
413:   totalKeys?: number,
414:   rawMessage?: string,
415:   errorType?: string
416: ): void {
417:   const ts = formatTimestamp();
418:   const provName = getProviderDisplayName(provider);
419:   const keyTotal = totalKeys !== undefined ? `/${totalKeys}` : "";
420:   const statusText = getHttpStatusText(status);
421:   const condensedType = errorType ?? deriveErrorType(rawMessage, status);
422:   console.warn(`${EMOJI.limit} ${ts} [LIMIT ${reqId}] ${provName} [Key #${keyIdx + 1}${keyTotal}] returned ${statusText} [${condensedType} ${status}]`);
423:   if (retryAfterSec) {
424:     console.warn(`${EMOJI.limit} ${ts} [LIMIT ${reqId}] Parsed Retry-After: ${retryAfterSec}s -> Quarantined Key #${keyIdx + 1} for ${retryAfterSec}s`);
425:   }
426:   if (rawMessage) {
427:     console.warn(`${EMOJI.limit} ${ts} [LIMIT ${reqId}] Upstream Error: "${rawMessage.slice(0, 300)}"`);
428:   }
429: }
430: 
431: export function logRetry(
432:   reqId: string,
433:   provider: string,
434:   keyIdx: number,
435:   attempt: number,
436:   maxAttempts: number,
437:   reason: string
438: ): void {
439:   const ts = formatTimestamp();
440:   const provName = getProviderDisplayName(provider);
441:   console.log(`${EMOJI.retry} ${ts} [RETRY ${reqId}] ${provName} [Key #${keyIdx + 1}] attempt ${attempt}/${maxAttempts} (${reason})`);
442: }
443: 
444: export function logExhausted(
445:   reqId: string,
446:   provider: string,
447:   backoffMs: number
448: ): void {
449:   const ts = formatTimestamp();
450:   const provName = getProviderDisplayName(provider);
451:   console.error(`${EMOJI.exhausted} ${ts} [EXHAUSTED ${reqId}] All keys in ${provName} cooling down. Applying backoff: ${backoffMs}ms`);
452: }
453: 
454: export function logAmber(reqId: string, message: string): void {
455:   const ts = formatTimestamp();
456:   console.warn(`${EMOJI.amber} ${ts} [AMBER ${reqId}] ${message}`);
457: }
458: 
459: export function logPacer(
460:   reqId: string,
461:   provider: string,
462:   dwellMs: number,
463:   stats: { queueDepth: number; avgDwellMs: number; minIntervalMs: number }
464: ): void {
465:   const ts = formatTimestamp();
466:   const provName = getProviderDisplayName(provider);
467:   console.log(
468:     `${EMOJI.pacer} ${ts} [PACER ${reqId}] ${provName} dwell=${dwellMs}ms depth=${stats.queueDepth} avg=${stats.avgDwellMs}ms interval=${stats.minIntervalMs}ms`
469:   );
470: }
471: 
472: export function logServed(
473:   reqId: string,
474:   durationMs: number,
475:   status = 200,
476:   attempt?: number,
477:   maxAttempts?: number
478: ): void {
479:   const ts = formatTimestamp();
480:   const attemptStr = attempt && maxAttempts && maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
481:   const icon = status >= 400 ? EMOJI.servedErr : EMOJI.servedOk;
482:   if (status >= 400) {
483:     console.warn(`${icon} ${ts} [SERVED ${reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
484:   } else {
485:     console.log(`${icon} ${ts} [SERVED ${reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
486:   }
487: }
488: 
489: export function logBoot(message: string): void {
490:   const ts = formatTimestamp();
491:   console.log(`${EMOJI.boot} ${ts} BOOT ${message}`);
492: }
493: 
494: export function logError(
495:   reqId: string,
496:   message: string,
497:   error?: unknown
498: ): void {
499:   const ts = formatTimestamp();
500:   const errDetail = error instanceof Error ? ` - ${error.message}` : "";
501:   console.error(`${EMOJI.error} ${ts} [ERROR ${reqId}] ${message}${errDetail}`);
502: }
503: 
504: export function logFusion(
505:   reqId: string,
506:   preset: string,
507:   model: string,
508:   tier: number,
509:   provider: string
510: ): void {
511:   const ts = formatTimestamp();
512:   const provName = getProviderDisplayName(provider);
513:   console.log(`${EMOJI.fusion} ${ts} [FUSION ${reqId}] Preset: ${preset} | Model: ${model} -> Tier ${tier} (${provName})`);
514: }
515: 
516: /** Log an info line. Prefer a value from EMOJI for the first argument. */
517: export function logInfo(emoji: string, message: string): void {
518:   const ts = formatTimestamp();
519:   console.log(`${emoji} ${ts} ${message}`);
520: }
521: 
522: /** Log a warning line. Prefer a value from EMOJI for the first argument. */
523: export function logWarn(emoji: string, message: string): void {
524:   const ts = formatTimestamp();
525:   console.warn(`${emoji} ${ts} ${message}`);
526: }
527: 
528: export function logFinishReason(
529:   reqId: string,
530:   finishReason?: string | null
531: ): void {
532:   if (!finishReason || typeof finishReason !== "string") {
533:     return;
534:   }
535:   if (finishReason === "length") {
536:     logWarn(EMOJI.finishTrunc, `[FINISH ${reqId}] Upstream token truncation occurred (finish_reason=length)`);
537:   } else {
538:     logInfo(EMOJI.finish, `[FINISH ${reqId}] Stream finished: finish_reason=${finishReason}`);
539:   }
540: }
541: 
542: export function logSeparator(): void {
543:   console.log("────────────────────────────────────────────────────────────────────────────────");
544: }
```

## File: src/config/location.ts
```typescript
 1: import { existsSync, readFileSync } from "node:fs";
 2: import { resolve } from "node:path";
 3: import { z } from "zod";
 4: 
 5: export const LocationConfigSchema = z.object({
 6:   host: z.string().min(1),
 7:   port: z.number().int().min(1).max(65535),
 8:   tls_enabled: z.boolean(),
 9:   parent_dir: z.string().min(1).optional(),
10:   working_folder: z.string().min(1).optional(),
11:   path: z.string().min(1).optional(),
12: });
13: 
14: export type LocationConfig = z.infer<typeof LocationConfigSchema>;
15: 
16: export function loadLocationConfig(filePath?: string): LocationConfig {
17:   const projectRoot = resolve(import.meta.dir, "../..");
18:   const targetPath = resolve(projectRoot, filePath ?? "config/location.json");
19: 
20:   if (!existsSync(targetPath)) {
21:     throw new Error(
22:       "[FATAL] Missing or invalid config/location.json. Required fields: host (string), port (int), tls_enabled (boolean)."
23:     );
24:   }
25: 
26:   try {
27:     const raw = readFileSync(targetPath, "utf-8");
28:     const json = JSON.parse(raw);
29:     return LocationConfigSchema.parse(json);
30:   } catch (err) {
31:     throw new Error(
32:       "[FATAL] Missing or invalid config/location.json. Required fields: host (string), port (int), tls_enabled (boolean).",
33:       { cause: err }
34:     );
35:   }
36: }
```

## File: src/engine/zen.ts
```typescript
  1: import { getProviderConfig } from "../config/providers";
  2: import {
  3:   extractClientSessionId,
  4:   generateOpenCodeSessionId,
  5: } from "./session_id";
  6: 
  7: /**
  8:  * Strict OpenCode session ID regular expression:
  9:  * Prefix: 'ses_'
 10:  * Hex timestamp/random: 8 hex characters [0-9a-f]{8}
 11:  * Fixed marker: '8ffe'
 12:  * Tail: 14 base62 characters [0-9a-zA-Z]{14}
 13:  * Total length: 4 + 8 + 4 + 14 = 30 characters
 14:  */
 15: export const OPENCODE_SESSION_REGEX = /^ses_[0-9a-f]{8}8ffe[0-9a-zA-Z]{14}$/;
 16: 
 17: /**
 18:  * Validates whether a candidate string strictly matches the OpenCode session ID format.
 19:  */
 20: export function isValidOpenCodeSessionId(sessionId: string): boolean {
 21:   if (typeof sessionId !== "string") {
 22:     return false;
 23:   }
 24:   return OPENCODE_SESSION_REGEX.test(sessionId);
 25: }
 26: 
 27: /**
 28:  * Validates whether a candidate string is an acceptable incoming session ID:
 29:  * either strictly matching standard OpenCode format, an 8-character OpenCode session ID,
 30:  * or a valid client session ID token.
 31:  */
 32: export function isAcceptableSessionId(sessionId: string): boolean {
 33:   if (typeof sessionId !== "string" || sessionId.length === 0) {
 34:     return false;
 35:   }
 36:   if (isValidOpenCodeSessionId(sessionId)) {
 37:     return true;
 38:   }
 39:   // 8-character alphanumeric session IDs (used by OpenCode CLI / test suites)
 40:   if (/^[0-9a-zA-Z]{8}$/.test(sessionId)) {
 41:     return true;
 42:   }
 43:   // Other well-formed client session ID tokens starting with ses_
 44:   if (/^ses_[0-9a-zA-Z_-]{6,32}$/.test(sessionId) && sessionId !== "ses_invalid") {
 45:     return true;
 46:   }
 47:   return false;
 48: }
 49: 
 50: export const ZEN_SCRUB_HEADER_PREFIXES: ReadonlyArray<string> = [
 51:   "x-client-",
 52:   "client-",
 53:   "x-opencode-",
 54:   "opencode-",
 55:   "x-application-",
 56:   "application-",
 57:   "sec-ch-ua",
 58: ];
 59: 
 60: export const ZEN_SCRUB_EXACT_HEADERS: ReadonlySet<string> = new Set([
 61:   "user-agent",
 62:   "origin",
 63:   "referer",
 64:   "http-referer",
 65:   "x-title",
 66:   "x-requested-with",
 67:   "session-id",
 68:   "x-session-id",
 69: ]);
 70: 
 71: /**
 72:  * Removes any client-specific identity or application headers from outbound request headers.
 73:  */
 74: export function scrubZenHeaders(headers: Record<string, string>): void {
 75:   for (const key of Object.keys(headers)) {
 76:     const lower = key.toLowerCase();
 77:     if (
 78:       ZEN_SCRUB_EXACT_HEADERS.has(lower) ||
 79:       ZEN_SCRUB_HEADER_PREFIXES.some((p) => lower.startsWith(p))
 80:     ) {
 81:       delete headers[key];
 82:     }
 83:   }
 84: }
 85: 
 86: /**
 87:  * Retrieves configured headers for the Zen provider ("zn") from config/providers.json
 88:  * as the single source of truth.
 89:  */
 90: function getZenConfiguredHeaders(): Record<string, string> {
 91:   try {
 92:     const znConfig = getProviderConfig("zn");
 93:     return znConfig?.headers ? { ...znConfig.headers } : {};
 94:   } catch {
 95:     return {};
 96:   }
 97: }
 98: 
 99: /**
100:  * Builds Zen upstream attribution and session headers.
101:  * Unconditionally overwrites User-Agent, Referer, HTTP-Referer, X-Title, and session headers
102:  * with authentic OpenCode runtime identity.
103:  */
104: export function buildZenHeaders(
105:   incomingHeaders?: Headers | Record<string, string>,
106:   sessionId?: string
107: ): Record<string, string> {
108:   const candidate = sessionId ?? extractClientSessionId(incomingHeaders);
109:   const activeSessionId =
110:     candidate && isAcceptableSessionId(candidate)
111:       ? candidate
112:       : generateOpenCodeSessionId();
113: 
114:   const tail = activeSessionId.startsWith("ses_")
115:     ? activeSessionId.slice(4)
116:     : activeSessionId;
117:   const requestId = `msg_${tail}`;
118: 
119:   const configured = getZenConfiguredHeaders();
120:   const configuredUa =
121:     configured["User-Agent"] ||
122:     configured["user-agent"] ||
123:     "opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2";
124: 
125:   return {
126:     ...configured,
127:     "User-Agent": configuredUa,
128:     "HTTP-Referer": "https://opencode.ai",
129:     "Referer": "https://opencode.ai",
130:     "X-Title": "OpenCode",
131:     "x-opencode-session": activeSessionId,
132:     "x-opencode-request": requestId,
133:     "session-id": activeSessionId,
134:     "x-session-id": activeSessionId,
135:   };
136: }
137: 
138: /**
139:  * Standard OpenCode core tools (bash, read, write, edit, glob, grep)
140:  * required by Zen upstream for anti-abuse and capability probing.
141:  */
142: const ZEN_PROBE_TOOLS: ReadonlyArray<Record<string, unknown>> = [
143:   {
144:     type: "function",
145:     function: {
146:       name: "bash",
147:       description:
148:         "Execute bash commands with tolerant parameter resolution and scratch overflow offloading",
149:       parameters: {
150:         $schema: "https://json-schema.org/draft/2020-12/schema",
151:         type: "object",
152:         properties: {
153:           command: {
154:             type: "string",
155:             description: "The shell command to execute",
156:           },
157:         },
158:         required: ["command"],
159:       },
160:     },
161:   },
162:   {
163:     type: "function",
164:     function: {
165:       name: "read",
166:       description: "Read a file or directory from the local filesystem.",
167:       parameters: {
168:         $schema: "https://json-schema.org/draft/2020-12/schema",
169:         type: "object",
170:         properties: {
171:           filePath: {
172:             type: "string",
173:             description: "The absolute path to the file or directory to read",
174:           },
175:         },
176:         required: ["filePath"],
177:       },
178:     },
179:   },
180:   {
181:     type: "function",
182:     function: {
183:       name: "write",
184:       description: "Writes a file to the local filesystem.",
185:       parameters: {
186:         $schema: "https://json-schema.org/draft/2020-12/schema",
187:         type: "object",
188:         properties: {
189:           filePath: {
190:             type: "string",
191:             description: "The absolute path to the file to write",
192:           },
193:           content: {
194:             type: "string",
195:             description: "The content to write to the file",
196:           },
197:         },
198:         required: ["filePath", "content"],
199:       },
200:     },
201:   },
202:   {
203:     type: "function",
204:     function: {
205:       name: "edit",
206:       description: "Performs exact string replacements in files.",
207:       parameters: {
208:         $schema: "https://json-schema.org/draft/2020-12/schema",
209:         type: "object",
210:         properties: {
211:           filePath: {
212:             type: "string",
213:             description: "The absolute path to the file to modify",
214:           },
215:           oldString: {
216:             type: "string",
217:             description: "The text to replace",
218:           },
219:           newString: {
220:             type: "string",
221:             description: "The text to replace it with",
222:           },
223:         },
224:         required: ["filePath", "oldString", "newString"],
225:       },
226:     },
227:   },
228:   {
229:     type: "function",
230:     function: {
231:       name: "glob",
232:       description:
233:         "Fast file pattern matching tool that works with any codebase size",
234:       parameters: {
235:         $schema: "https://json-schema.org/draft/2020-12/schema",
236:         type: "object",
237:         properties: {
238:           pattern: {
239:             type: "string",
240:             description: "The glob pattern to match files against",
241:           },
242:         },
243:         required: ["pattern"],
244:       },
245:     },
246:   },
247:   {
248:     type: "function",
249:     function: {
250:       name: "grep",
251:       description:
252:         "Fast content search tool that works with any codebase size",
253:       parameters: {
254:         $schema: "https://json-schema.org/draft/2020-12/schema",
255:         type: "object",
256:         properties: {
257:           pattern: {
258:             type: "string",
259:             description: "The regex pattern to search for in file contents",
260:           },
261:         },
262:         required: ["pattern"],
263:       },
264:     },
265:   },
266: ];
267: 
268: /**
269:  * Returns fresh clones of standard OpenCode probe tools formatted for OpenAI Chat Completions.
270:  */
271: export function getZenProbeTools(): Array<Record<string, unknown>> {
272:   return JSON.parse(JSON.stringify(ZEN_PROBE_TOOLS));
273: }
274: 
275: /**
276:  * Returns fresh clones of standard OpenCode probe tools formatted for OpenAI Responses API.
277:  * In Responses API, tools have name, description, parameters at top-level.
278:  */
279: export function getZenResponsesProbeTools(): Array<Record<string, unknown>> {
280:   return ZEN_PROBE_TOOLS.map((t) => {
281:     const fn = t.function as { name: string; description: string; parameters: unknown };
282:     return {
283:       type: "function",
284:       name: fn.name,
285:       description: fn.description,
286:       parameters: JSON.parse(JSON.stringify(fn.parameters)),
287:     };
288:   });
289: }
290: 
291: /**
292:  * Adapts payload for Zen upstream requirements (Chat Completions wire):
293:  * Ensures authentic OpenCode probe tools (bash, read, write, edit, glob, grep) are present,
294:  * preserving any custom client/subagent tools while satisfying Zen anti-abuse gates.
295:  * Normalizes tool_choice (replaces "none" with "auto" to prevent FreeTierError).
296:  * If !body.stream, sets body.stream = true and flags requiresAccumulation = true.
297:  */
298: export function adaptZenPayload(body: Record<string, any>): {
299:   adaptedBody: Record<string, any>;
300:   requiresAccumulation: boolean;
301: } {
302:   const adaptedBody: Record<string, any> = { ...body };
303:   let requiresAccumulation = false;
304: 
305:   const existingTools = Array.isArray(adaptedBody.tools) ? [...adaptedBody.tools] : [];
306:   const probeTools = getZenProbeTools();
307:   const existingNames = new Set(
308:     existingTools.map((t: any) => t?.function?.name || t?.name).filter(Boolean)
309:   );
310:   const missingProbes = probeTools.filter(
311:     (t: any) => !existingNames.has(t?.function?.name)
312:   );
313:   adaptedBody.tools = [...existingTools, ...missingProbes];
314: 
315:   if (!adaptedBody.tool_choice || adaptedBody.tool_choice === "none") {
316:     adaptedBody.tool_choice = "auto";
317:   }
318: 
319:   if (!adaptedBody.stream) {
320:     adaptedBody.stream = true;
321:     requiresAccumulation = true;
322:   }
323: 
324:   return { adaptedBody, requiresAccumulation };
325: }
326: 
327: /**
328:  * Adapts payload for Zen upstream requirements (Responses API wire):
329:  * Ensures authentic OpenCode Responses probe tools are present,
330:  * preserving any custom client/subagent tools while satisfying Zen anti-abuse gates.
331:  * Normalizes tool_choice (replaces "none" with "auto" to prevent FreeTierError).
332:  * If !body.stream, sets body.stream = true and flags requiresAccumulation = true.
333:  */
334: export function adaptZenResponsesPayload(body: Record<string, any>): {
335:   adaptedBody: Record<string, any>;
336:   requiresAccumulation: boolean;
337: } {
338:   const adaptedBody: Record<string, any> = { ...body };
339:   let requiresAccumulation = false;
340: 
341:   const existingTools = Array.isArray(adaptedBody.tools) ? [...adaptedBody.tools] : [];
342:   const probeTools = getZenResponsesProbeTools();
343:   const existingNames = new Set(
344:     existingTools.map((t: any) => t?.name || t?.function?.name).filter(Boolean)
345:   );
346:   const missingProbes = probeTools.filter(
347:     (t: any) => !existingNames.has(t?.name)
348:   );
349:   adaptedBody.tools = [...existingTools, ...missingProbes];
350: 
351:   if (!adaptedBody.tool_choice || adaptedBody.tool_choice === "none") {
352:     adaptedBody.tool_choice = "auto";
353:   }
354: 
355:   if (!adaptedBody.stream) {
356:     adaptedBody.stream = true;
357:     requiresAccumulation = true;
358:   }
359: 
360:   return { adaptedBody, requiresAccumulation };
361: }
362: 
363: interface AccumulatedToolCall {
364:   id: string;
365:   type: string;
366:   function: {
367:     name: string;
368:     arguments: string;
369:   };
370: }
371: 
372: /**
373:  * Accumulates an SSE ReadableStream from Zen into a single complete OpenAI-compliant
374:  * chat.completion response JSON object.
375:  */
376: export async function accumulateZenStreamToCompletion(
377:   stream: ReadableStream<Uint8Array>,
378:   model: string
379: ): Promise<Record<string, any>> {
380:   const reader = stream.getReader();
381:   const decoder = new TextDecoder();
382:   let buffer = "";
383: 
384:   let completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
385:   let created = Math.floor(Date.now() / 1000);
386:   let finalModel = model;
387:   let systemFingerprint: string | undefined = undefined;
388:   let finishReason: string | null = null;
389:   let content: string | null = null;
390:   let reasoningContent: string | null = null;
391:   let usage: Record<string, any> | null = null;
392: 
393:   const toolCallsMap = new Map<number, AccumulatedToolCall>();
394: 
395:   const processChunk = (chunk: Record<string, any>) => {
396:     if (chunk.id && typeof chunk.id === "string") {
397:       completionId = chunk.id;
398:     }
399:     if (typeof chunk.created === "number") {
400:       created = chunk.created;
401:     }
402:     if (chunk.model && typeof chunk.model === "string") {
403:       finalModel = chunk.model;
404:     }
405:     if (chunk.system_fingerprint && typeof chunk.system_fingerprint === "string") {
406:       systemFingerprint = chunk.system_fingerprint;
407:     }
408:     if (chunk.usage && typeof chunk.usage === "object") {
409:       usage = chunk.usage;
410:     }
411: 
412:     if (Array.isArray(chunk.choices)) {
413:       for (const choice of chunk.choices) {
414:         if (choice.index === 0 || chunk.choices.length === 1) {
415:           if (choice.finish_reason) {
416:             finishReason = choice.finish_reason;
417:           }
418: 
419:           const delta = choice.delta ?? choice.message ?? {};
420: 
421:           if (delta.content !== undefined && delta.content !== null) {
422:             if (content === null) content = "";
423:             content += String(delta.content);
424:           }
425: 
426:           const reasoning = delta.reasoning_content ?? delta.reasoning;
427:           if (reasoning !== undefined && reasoning !== null) {
428:             if (reasoningContent === null) reasoningContent = "";
429:             reasoningContent += String(reasoning);
430:           }
431: 
432:           if (Array.isArray(delta.tool_calls)) {
433:             for (const tc of delta.tool_calls) {
434:               const idx =
435:                 typeof tc.index === "number" ? tc.index : toolCallsMap.size;
436:               let existing = toolCallsMap.get(idx);
437:               if (!existing) {
438:                 existing = {
439:                   id: tc.id || "",
440:                   type: tc.type || "function",
441:                   function: {
442:                     name: tc.function?.name || "",
443:                     arguments: tc.function?.arguments || "",
444:                   },
445:                 };
446:                 toolCallsMap.set(idx, existing);
447:               } else {
448:                 if (tc.id) existing.id = tc.id;
449:                 if (tc.type) existing.type = tc.type;
450:                 if (tc.function?.name) existing.function.name += tc.function.name;
451:                 if (tc.function?.arguments) {
452:                   existing.function.arguments += tc.function.arguments;
453:                 }
454:               }
455:             }
456:           }
457:         }
458:       }
459:     }
460:   };
461: 
462:   const processLine = (line: string) => {
463:     const trimmed = line.trim();
464:     if (!trimmed || trimmed.startsWith(":")) {
465:       return;
466:     }
467: 
468:     let payload: string | null = null;
469:     if (trimmed.startsWith("data: ")) {
470:       payload = trimmed.slice(6).trim();
471:     } else if (trimmed.startsWith("data:")) {
472:       payload = trimmed.slice(5).trim();
473:     }
474: 
475:     if (!payload || payload === "[DONE]") {
476:       return;
477:     }
478: 
479:     try {
480:       const parsed = JSON.parse(payload);
481:       if (parsed && typeof parsed === "object") {
482:         processChunk(parsed);
483:       }
484:     } catch (_err) {
485:       void _err;
486:     }
487:   };
488: 
489:   try {
490:     while (true) {
491:       const { done, value } = await reader.read();
492:       if (done) {
493:         break;
494:       }
495:       buffer += decoder.decode(value, { stream: true });
496:       const lines = buffer.split("\n");
497:       buffer = lines.pop() ?? "";
498:       for (const line of lines) {
499:         processLine(line);
500:       }
501:     }
502: 
503:     buffer += decoder.decode();
504:     if (buffer.length > 0) {
505:       const lines = buffer.split("\n");
506:       for (const line of lines) {
507:         processLine(line);
508:       }
509:     }
510:   } finally {
511:     reader.releaseLock();
512:   }
513: 
514:   const sortedToolIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
515:   const finalToolCalls = sortedToolIndices.map((idx) => {
516:     const tc = toolCallsMap.get(idx)!;
517:     if (!tc.id) {
518:       tc.id = `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
519:     }
520:     return tc;
521:   });
522: 
523:   const effectiveContent = (content && (content as string).length > 0)
524:     ? content
525:     : (reasoningContent && (reasoningContent as string).length > 0)
526:       ? reasoningContent
527:       : content !== null
528:         ? content
529:         : finalToolCalls.length > 0
530:           ? null
531:           : "";
532: 
533:   const message: Record<string, any> = {
534:     role: "assistant",
535:     content: effectiveContent,
536:   };
537: 
538:   if (reasoningContent !== null) {
539:     message.reasoning_content = reasoningContent;
540:   }
541: 
542:   if (finalToolCalls.length > 0) {
543:     message.tool_calls = finalToolCalls;
544:   }
545: 
546:   const determinedFinishReason =
547:     finishReason ?? (finalToolCalls.length > 0 ? "tool_calls" : "stop");
548: 
549:   const response: Record<string, any> = {
550:     id: completionId,
551:     object: "chat.completion",
552:     created,
553:     model: finalModel,
554:     choices: [
555:       {
556:         index: 0,
557:         message,
558:         finish_reason: determinedFinishReason,
559:       },
560:     ],
561:     usage: usage ?? {
562:       prompt_tokens: 0,
563:       completion_tokens: 0,
564:       total_tokens: 0,
565:     },
566:   };
567: 
568:   if (systemFingerprint) {
569:     response.system_fingerprint = systemFingerprint;
570:   }
571: 
572:   return response;
573: }
574: 
575: /**
576:  * Accumulates an upstream SSE event stream from Zen /v1/responses into a standard
577:  * Responses API response object for clients that requested non-streaming (stream: false).
578:  */
579: export async function accumulateZenResponsesStream(
580:   stream: ReadableStream<Uint8Array>,
581:   model: string
582: ): Promise<Record<string, any>> {
583:   const reader = stream.getReader();
584:   const decoder = new TextDecoder();
585:   let buffer = "";
586:   let completedResponse: Record<string, any> | null = null;
587:   let createdResponse: Record<string, any> | null = null;
588:   let accumulatedText = "";
589: 
590:   const processLine = (line: string) => {
591:     const trimmed = line.trim();
592:     if (!trimmed || trimmed.startsWith(":")) return;
593: 
594:     let payload = "";
595:     if (trimmed.startsWith("data: ")) {
596:       payload = trimmed.slice(6).trim();
597:     } else if (trimmed.startsWith("data:")) {
598:       payload = trimmed.slice(5).trim();
599:     }
600: 
601:     if (!payload || payload === "[DONE]") return;
602: 
603:     try {
604:       const parsed = JSON.parse(payload);
605:       if (parsed && typeof parsed === "object") {
606:         if (parsed.type === "response.completed" && parsed.response) {
607:           completedResponse = parsed.response;
608:         } else if (parsed.type === "response.created" && parsed.response) {
609:           createdResponse = parsed.response;
610:         } else if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
611:           accumulatedText += parsed.delta;
612:         }
613:       }
614:     } catch (_err) {
615:       void _err;
616:     }
617:   };
618: 
619:   try {
620:     while (true) {
621:       const { done, value } = await reader.read();
622:       if (done) break;
623:       buffer += decoder.decode(value, { stream: true });
624:       const lines = buffer.split("\n");
625:       buffer = lines.pop() ?? "";
626:       for (const line of lines) {
627:         processLine(line);
628:       }
629:     }
630: 
631:     buffer += decoder.decode();
632:     if (buffer.length > 0) {
633:       const lines = buffer.split("\n");
634:       for (const line of lines) {
635:         processLine(line);
636:       }
637:     }
638:   } finally {
639:     reader.releaseLock();
640:   }
641: 
642:   if (completedResponse) {
643:     return completedResponse;
644:   }
645: 
646:   if (createdResponse) {
647:     const fallback: Record<string, any> = Object.assign({}, createdResponse);
648:     fallback.status = "completed";
649:     if (accumulatedText) {
650:       fallback.output = [
651:         {
652:           id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
653:           type: "message",
654:           status: "completed",
655:           role: "assistant",
656:           content: [
657:             {
658:               type: "output_text",
659:               text: accumulatedText,
660:               annotations: [],
661:               logprobs: [],
662:             },
663:           ],
664:         },
665:       ];
666:     }
667:     return fallback;
668:   }
669: 
670:   return {
671:     id: `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
672:     object: "response",
673:     created_at: Math.floor(Date.now() / 1000),
674:     status: "completed",
675:     model,
676:     output: [
677:       {
678:         id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
679:         type: "message",
680:         status: "completed",
681:         role: "assistant",
682:         content: [
683:           {
684:             type: "output_text",
685:             text: accumulatedText,
686:             annotations: [],
687:             logprobs: [],
688:           },
689:         ],
690:       },
691:     ],
692:   };
693: }
```

## File: src/handlers/v4/router.ts
```typescript
  1: import { Database } from "bun:sqlite";
  2: import { existsSync } from "node:fs";
  3: import { parseDirectiveKey } from "../../directive/parser";
  4: import { traceBuffer, type SanitizedTrace } from "../../telemetry/ring_buffer";
  5: import { traceWriter } from "../../telemetry/trace_writer";
  6: import { handleV4OpenAIChat } from "./openai_chat";
  7: import { handleV4AnthropicMessages } from "./anthropic_messages";
  8: import { handleV4GoogleNative } from "./google_native";
  9: import { handleV4OpenAIResponses } from "./openai_responses";
 10: import { handleV4GcpCompat } from "./gcp_compat";
 11: import { handleGoogleInteractionsPassthrough } from "../google_native";
 12: 
 13: export interface TraceDbRow {
 14:   req_id: string;
 15:   created_at: number;
 16:   provider: string;
 17:   model: string;
 18:   status: number;
 19:   duration_ms: number;
 20:   ttft_ms: number | null;
 21:   tokens_prompt: number | null;
 22:   tokens_completion: number | null;
 23:   client_inbound: string | null;
 24:   upstream_outbound: string | null;
 25:   upstream_inbound: string | null;
 26:   client_outbound: string | null;
 27: }
 28: 
 29: const SELECT_TRACE_SQL = `
 30:   SELECT req_id, created_at, provider, model, status, duration_ms, ttft_ms,
 31:          tokens_prompt, tokens_completion, client_inbound, upstream_outbound,
 32:          upstream_inbound, client_outbound
 33:   FROM request_traces WHERE req_id = ?
 34: `;
 35: 
 36: function mapRowToTrace(row: TraceDbRow): SanitizedTrace {
 37:   return {
 38:     reqId: row.req_id,
 39:     createdAt: row.created_at,
 40:     provider: row.provider,
 41:     model: row.model,
 42:     status: row.status,
 43:     durationMs: row.duration_ms,
 44:     ttftMs: row.ttft_ms ?? undefined,
 45:     tokensPrompt: row.tokens_prompt ?? undefined,
 46:     tokensCompletion: row.tokens_completion ?? undefined,
 47:     legs: {
 48:       clientInbound: row.client_inbound ?? "",
 49:       upstreamOutbound: row.upstream_outbound ?? "",
 50:       upstreamInbound: row.upstream_inbound ?? "",
 51:       clientOutbound: row.client_outbound ?? "",
 52:     },
 53:   };
 54: }
 55: 
 56: function queryDbHandle(db: Database, traceId: string): SanitizedTrace | null {
 57:   try {
 58:     const row = db.query<TraceDbRow, [string]>(SELECT_TRACE_SQL).get(traceId);
 59:     return row ? mapRowToTrace(row) : null;
 60:   } catch (err) {
 61:     console.warn(`[RouterV4] SQLite query failed: ${err}`);
 62:     return null;
 63:   }
 64: }
 65: 
 66: function queryDbFile(dbPath: string, traceId: string): SanitizedTrace | null {
 67:   if (!existsSync(dbPath)) {
 68:     return null;
 69:   }
 70:   try {
 71:     const db = new Database(dbPath, { readonly: true });
 72:     try {
 73:       return queryDbHandle(db, traceId);
 74:     } finally {
 75:       db.close();
 76:     }
 77:   } catch (err) {
 78:     console.warn(`[RouterV4] SQLite file read failed: ${err}`);
 79:     return null;
 80:   }
 81: }
 82: 
 83: export function findTraceInDb(traceId: string, customDbPath?: string): SanitizedTrace | null {
 84:   const activeDb = traceWriter.getDb();
 85:   if (activeDb) {
 86:     const result = queryDbHandle(activeDb, traceId);
 87:     if (result) {
 88:       return result;
 89:     }
 90:   }
 91:   return queryDbFile(customDbPath ?? "logs/traces.db", traceId);
 92: }
 93: 
 94: function isTracePath(path: string): boolean {
 95:   return path === "/v1/traces" || path.startsWith("/v1/traces/");
 96: }
 97: 
 98: function handleTraceDetail(traceId: string): Response {
 99:   if (!traceId) {
100:     return Response.json(
101:       {
102:         error: {
103:           code: "not_found",
104:           message: "Trace not found: ",
105:           type: "invalid_request_error",
106:         },
107:       },
108:       { status: 404 }
109:     );
110:   }
111: 
112:   const memTrace = traceBuffer.get(traceId);
113:   if (memTrace) {
114:     return Response.json(memTrace);
115:   }
116: 
117:   const dbTrace = findTraceInDb(traceId);
118:   if (dbTrace) {
119:     return Response.json(dbTrace);
120:   }
121: 
122:   return Response.json(
123:     {
124:       error: {
125:         code: "not_found",
126:         message: `Trace not found: ${traceId}`,
127:         type: "invalid_request_error",
128:       },
129:     },
130:     { status: 404 }
131:   );
132: }
133: 
134: function handleTraceList(url: URL): Response {
135:   const errors = url.searchParams.get("errors") === "true";
136:   const rawN = url.searchParams.get("n");
137:   const parsedN = parseInt(rawN ?? "10", 10);
138:   const n = Number.isNaN(parsedN) || parsedN <= 0 ? 10 : parsedN;
139: 
140:   const traces = errors ? traceBuffer.getErrors(n) : traceBuffer.getRecent(n);
141:   return Response.json({ traces });
142: }
143: 
144: function handleTraceEndpoints(url: URL, path: string, rawKey: string): Response {
145:   const directive = parseDirectiveKey(rawKey);
146:   if (!directive) {
147:     return Response.json(
148:       {
149:         error: {
150:           code: "unauthorized",
151:           message: "Directive key authorization required to access trace inspection endpoints",
152:           type: "authentication_error",
153:         },
154:       },
155:       { status: 401 }
156:     );
157:   }
158: 
159:   if (path.startsWith("/v1/traces/")) {
160:     const traceId = path.slice("/v1/traces/".length);
161:     return handleTraceDetail(traceId);
162:   }
163: 
164:   return handleTraceList(url);
165: }
166: 
167: const CHAT_PATHS: ReadonlySet<string> = new Set([
168:   "/v1/chat/completions",
169:   "/chat/completions",
170:   "/api/v1/chat/completions",
171:   "/v1/chat/completions/chat/completions",
172:   "/chat/completions/chat/completions",
173: ]);
174: 
175: const ANTHROPIC_PATHS: ReadonlySet<string> = new Set([
176:   "/v1/messages",
177:   "/messages",
178:   "/api/v1/messages",
179:   "/v1/messages/messages",
180:   "/messages/messages",
181:   "/v1/message",
182:   "/message",
183:   "/api/v1/message",
184:   "/v1/message/message",
185:   "/message/message",
186:   "/v1/messages/message",
187:   "/v1/message/messages",
188:   "/messages/message",
189:   "/message/messages",
190: ]);
191: 
192: const RESPONSES_PATHS: ReadonlySet<string> = new Set([
193:   "/v1/responses",
194:   "/responses",
195:   "/api/v1/responses",
196:   "/v1/responses/responses",
197:   "/responses/responses",
198:   "/v1/response",
199:   "/response",
200:   "/api/v1/response",
201:   "/v1/response/response",
202:   "/response/response",
203:   "/v1/responses/response",
204:   "/v1/response/responses",
205:   "/responses/response",
206:   "/response/responses",
207: ]);
208: 
209: function isGoogleNativePath(path: string): boolean {
210:   if (!path.startsWith("/v1beta/models/") && !path.startsWith("/v1/models/")) {
211:     return false;
212:   }
213:   return path.endsWith(":generateContent") || path.endsWith(":streamGenerateContent");
214: }
215: 
216: function dispatchGoogleRoute(
217:   path: string,
218:   req: Request,
219:   rawKey: string,
220:   reqId: string
221: ): Promise<Response> | null {
222:   if (path.startsWith("/v1beta/interactions") || path.startsWith("/v1beta/files")) {
223:     return handleGoogleInteractionsPassthrough(req, rawKey, reqId);
224:   }
225:   if (req.method !== "POST") {
226:     return null;
227:   }
228:   if (isGoogleNativePath(path)) {
229:     return handleV4GoogleNative(req, rawKey, reqId);
230:   }
231:   if (path.startsWith("/v1beta/openai/")) {
232:     return handleV4GcpCompat(req, rawKey, reqId);
233:   }
234:   return null;
235: }
236: 
237: function dispatchPostRoute(
238:   path: string,
239:   req: Request,
240:   rawKey: string,
241:   reqId: string
242: ): Promise<Response> | null {
243:   if (req.method !== "POST") {
244:     return null;
245:   }
246:   if (CHAT_PATHS.has(path)) {
247:     return handleV4OpenAIChat(req, rawKey, reqId);
248:   }
249:   if (ANTHROPIC_PATHS.has(path)) {
250:     return handleV4AnthropicMessages(req, rawKey, reqId);
251:   }
252:   if (RESPONSES_PATHS.has(path)) {
253:     return handleV4OpenAIResponses(req, rawKey, reqId);
254:   }
255:   return null;
256: }
257: 
258: export async function dispatchV4(
259:   req: Request,
260:   rawKey: string,
261:   reqId: string
262: ): Promise<Response> {
263:   const url = new URL(req.url);
264:   const rawPath = url.pathname;
265:   const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
266: 
267:   if (isTracePath(path)) {
268:     return handleTraceEndpoints(url, path, rawKey);
269:   }
270: 
271:   const postRes = dispatchPostRoute(path, req, rawKey, reqId) ?? dispatchGoogleRoute(path, req, rawKey, reqId);
272:   if (postRes !== null) {
273:     return postRes;
274:   }
275: 
276:   return Response.json(
277:     {
278:       error: {
279:         code: "not_found",
280:         message: `Route not found: ${req.method} ${path}`,
281:         type: "invalid_request_error",
282:       },
283:     },
284:     { status: 404 }
285:   );
286: }
```

## File: src/handlers/google_native.ts
```typescript
  1: import { existsSync, readFileSync } from "node:fs";
  2: import { resolve } from "node:path";
  3: import { getEnv } from "../config/env";
  4: import { getProviderConfig, overrideProviderUrl, resolveUpstreamEndpoint } from "../config/providers";
  5: import type { ParsedDirective } from "../directive/parser";
  6: import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
  7: import { fetchWithTtftGuard } from "../network/fetcher";
  8: import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
  9: import { isFatalAuthError } from "../network/pool";
 10: import {
 11:   EMOJI,
 12:   logError,
 13:   logFinishReason,
 14:   logInbound,
 15:   logInfo,
 16:   logLimit,
 17:   logSeparator,
 18:   logServed,
 19:   logTtft,
 20:   logUsage,
 21:   logWarn,
 22: } from "../ui/logger";
 23: import { globalKeyPool, handleOpenAICompat } from "./openai_compat";
 24: 
 25: function getGoogleMaxAttempts(): number {
 26:   const ggConfig = getProviderConfig("gg");
 27:   return ggConfig.request_retry.enabled ? ggConfig.request_retry.max_attempts : 1;
 28: }
 29: 
 30: const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
 31: const STRIPPED_UPSTREAM_HEADERS = new Set([
 32:   "authorization",
 33:   "x-goog-api-key",
 34:   "host",
 35:   "content-length",
 36: ]);
 37: const STRIPPED_DOWNSTREAM_HEADERS = new Set([
 38:   "content-encoding",
 39:   "content-length",
 40:   "transfer-encoding",
 41: ]);
 42: 
 43: export const DEFAULT_FLASH_CHAIN: readonly string[] = Object.freeze([
 44:   "gemini-3.8-flash",
 45:   "gemini-3.7-flash",
 46:   "gemini-3.6-flash",
 47:   "gemini-3.5-flash",
 48: ]);
 49: export const DEFAULT_NATIVE_FLASH_CHAIN = DEFAULT_FLASH_CHAIN;
 50: 
 51: export const DEFAULT_FLASH_LITE_CHAIN: readonly string[] = Object.freeze([
 52:   "gemini-3.5-flash-lite",
 53:   "gemini-3.1-flash-lite",
 54: ]);
 55: 
 56: let cachedNativeChains: Readonly<Record<string, readonly string[]>> = {};
 57: const nativeTierIndices = new Map<string, number>();
 58: 
 59: export function getNativeTierIndex(chainKey: string): number {
 60:   return nativeTierIndices.get(chainKey) ?? 0;
 61: }
 62: 
 63: export function setNativeTierIndex(chainKey: string, index: number): void {
 64:   nativeTierIndices.set(chainKey, index);
 65: }
 66: 
 67: export function resetNativeTierIndices(): void {
 68:   nativeTierIndices.clear();
 69: }
 70: 
 71: export function resetNativeFlashTierIndex(): void {
 72:   resetNativeTierIndices();
 73: }
 74: 
 75: export function getCurrentFlashTierIndex(): number {
 76:   return getNativeTierIndex("gemini-flash");
 77: }
 78: 
 79: export function resolveNativeChain(normalizedModel: string): readonly string[] | undefined {
 80:   const configuredChain = cachedNativeChains[normalizedModel];
 81:   if (Array.isArray(configuredChain) && configuredChain.length > 0) {
 82:     return configuredChain;
 83:   }
 84:   if (normalizedModel === "gemini-flash") {
 85:     return DEFAULT_FLASH_CHAIN;
 86:   }
 87:   if (normalizedModel === "gemini-flash-lite") {
 88:     return DEFAULT_FLASH_LITE_CHAIN;
 89:   }
 90:   return undefined;
 91: }
 92: 
 93: export function loadAndCacheNativeChains(): void {
 94:   try {
 95:     const configPath = resolve(process.cwd(), "config", "fusion.json");
 96:     if (existsSync(configPath)) {
 97:       const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
 98:       if (parsed.native_chains && typeof parsed.native_chains === "object") {
 99:         cachedNativeChains = parsed.native_chains;
100:         return;
101:       }
102:     }
103:   } catch {
104:     logWarn(EMOJI.error, "Failed to load native_chains from config/fusion.json — using hardcoded fallback");
105:   }
106:   cachedNativeChains = {};
107: }
108: 
109: export function getNativeChain(chainName: string): readonly string[] {
110:   return resolveNativeChain(chainName) ?? [];
111: }
112: 
113: export function isNativeFusionModel(model: string): boolean {
114:   const chain = resolveNativeChain(model);
115:   return chain !== undefined && chain.length > 0;
116: }
117: 
118: type SelectedKey = NonNullable<ReturnType<typeof globalKeyPool.selectNextKey>>;
119: type GuardFetchResult = Awaited<ReturnType<typeof fetchWithTtftGuard>>;
120: 
121: interface GoogleUsage {
122:   readonly promptTokens: number;
123:   readonly completionTokens: number;
124:   readonly totalTokens: number;
125: }
126: 
127: interface TelemetryScannerState {
128:   finishLogged: boolean;
129:   usageLogged: boolean;
130:   servedLogged: boolean;
131:   buffer: string;
132:   readonly decoder: TextDecoder;
133:   readonly startTime: number;
134:   readonly reqId: string;
135:   readonly keyIndex: number;
136:   readonly totalKeys: number;
137:   readonly status: number;
138:   readonly attempt: number;
139:   readonly maxAttempts: number;
140: }
141: 
142: interface NativeForwardContext {
143:   readonly req: Request;
144:   readonly rawKey: string;
145:   readonly reqId: string;
146:   readonly url: URL;
147:   readonly upstreamUrl: URL;
148:   readonly model: string;
149:   readonly bodyBuffer: ArrayBuffer;
150: }
151: 
152: function prepareUpstreamHeaders(reqHeaders: Headers, apiKey: string): Headers {
153:   const upstreamHeaders = new Headers();
154:   for (const [k, v] of reqHeaders) {
155:     if (!STRIPPED_UPSTREAM_HEADERS.has(k.toLowerCase())) {
156:       upstreamHeaders.set(k, v);
157:     }
158:   }
159:   upstreamHeaders.set("x-goog-api-key", apiKey);
160:   upstreamHeaders.set("accept-encoding", "identity");
161:   const ggHeaders = getProviderConfig("gg").headers ?? {};
162:   upstreamHeaders.set("user-agent", process.env.LITEROUTER_USER_AGENT || ggHeaders["User-Agent"] || "OpenCode/1.18.29");
163:   upstreamHeaders.set("http-referer", process.env.LITEROUTER_HTTP_REFERER || ggHeaders["HTTP-Referer"] || ggHeaders["Referer"] || "https://opencode.ai");
164:   upstreamHeaders.set("referer", process.env.LITEROUTER_HTTP_REFERER || ggHeaders["HTTP-Referer"] || ggHeaders["Referer"] || "https://opencode.ai");
165:   upstreamHeaders.set("x-title", process.env.LITEROUTER_X_TITLE || "OpenCode");
166:   return upstreamHeaders;
167: }
168: 
169: function prepareDownstreamHeaders(resHeaders: Headers): Headers {
170:   const downstreamHeaders = new Headers();
171:   for (const [k, v] of resHeaders) {
172:     if (!STRIPPED_DOWNSTREAM_HEADERS.has(k.toLowerCase())) {
173:       downstreamHeaders.set(k, v);
174:     }
175:   }
176:   return downstreamHeaders;
177: }
178: 
179: function handlePacerError(err: unknown, signal?: AbortSignal): Response {
180:   if (signal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
181:     return Response.json(
182:       { error: { message: "Request aborted", type: "client_closed_request" } },
183:       { status: 499 }
184:     );
185:   }
186:   if (err instanceof PacerQueueOverflowError) {
187:     return Response.json(
188:       {
189:         error: {
190:           message: err.message,
191:           type: "rate_limit_exceeded",
192:           code: "rate_limit_exceeded",
193:         },
194:       },
195:       {
196:         status: 429,
197:         headers: { "Retry-After": String(err.retryAfterSec) },
198:       }
199:     );
200:   }
201:   throw err;
202: }
203: 
204: async function acquireNativePacer(signal?: AbortSignal): Promise<Response | null> {
205:   const ggPacer = getProviderConfig("gg").pacer;
206:   if (!getEnv().LITEROUTER_PACER_ENABLED || !ggPacer?.enabled) {
207:     return null;
208:   }
209:   try {
210:     const pacer = getPacerForProvider("gg");
211:     await pacer.acquire(signal);
212:     return null;
213:   } catch (err: unknown) {
214:     return handlePacerError(err, signal);
215:   }
216: }
217: 
218: function resolveGoogleReferrer(model: string): string | undefined {
219:   const refHeaders = resolveUpstreamEndpoint("gg", "gc", model).headers;
220:   const refUa = refHeaders?.["User-Agent"];
221:   const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
222:   if (refUa && refUrl) {
223:     return `${refUa} @ ${refUrl}`;
224:   }
225:   return refUa ?? refUrl ?? undefined;
226: }
227: 
228: function logNativeInbound(
229:   reqId: string,
230:   req: Request,
231:   url: URL,
232:   model: string,
233:   rawKey: string,
234:   totalKeys: number
235: ): void {
236:   logInbound({
237:     reqId,
238:     method: req.method,
239:     path: url.pathname,
240:     clientAgent: req.headers.get("user-agent") || "unknown",
241:     protocol: req.headers.get("x-http-version") || "HTTP/1.1",
242:     directiveStr: rawKey,
243:     targetProvider: "gg",
244:     wireFormat: "gg",
245:     endpoint: url.pathname,
246:     model,
247:     totalKeys,
248:     referrer: resolveGoogleReferrer(model),
249:   });
250: }
251: 
252: function validateGoogleDirective(rawKey: string): { directive?: ParsedDirective; error?: Response } {
253:   const validation = validateDirective(rawKey);
254:   if (validation.valid === false) {
255:     return { error: createUnauthorizedResponse(validation.error) };
256:   }
257:   const directive = validation.directive;
258:   if (directive.type !== "direct" || directive.provider !== "gg") {
259:     return {
260:       error: Response.json(
261:         {
262:           error: {
263:             message: "Google native requires a Google directive (lr-gg-*)",
264:             type: "invalid_request_error",
265:           },
266:         },
267:         { status: 400 }
268:       ),
269:     };
270:   }
271:   return { directive };
272: }
273: 
274: function getRequestBody(method: string, bodyBuffer: ArrayBuffer): ArrayBuffer | undefined {
275:   if (method === "GET" || method === "HEAD" || bodyBuffer.byteLength === 0) {
276:     return undefined;
277:   }
278:   return bodyBuffer;
279: }
280: 
281: function extractNumberByPattern(text: string, pattern: RegExp): number {
282:   const match = text.match(pattern);
283:   return match ? Number(match[1]) : 0;
284: }
285: 
286: function parseFinishReason(text: string): string | null {
287:   if (!text.includes("finishReason") && !text.includes("finish_reason")) {
288:     return null;
289:   }
290:   const match = text.match(/"finish_?reason"\s*:\s*"([^"]+)"/i);
291:   return match?.[1] ?? null;
292: }
293: 
294: function parseUsageMetadata(text: string): GoogleUsage | null {
295:   if (!text.includes("usageMetadata") && !text.includes("usage_metadata")) {
296:     return null;
297:   }
298:   const promptTokens = extractNumberByPattern(text, /"promptTokenCount"\s*:\s*(\d+)/i);
299:   const completionTokens = extractNumberByPattern(text, /"candidatesTokenCount"\s*:\s*(\d+)/i);
300:   const totalRaw = extractNumberByPattern(text, /"totalTokenCount"\s*:\s*(\d+)/i);
301:   const totalTokens = totalRaw > 0 ? totalRaw : promptTokens + completionTokens;
302:   if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
303:     return null;
304:   }
305:   return { promptTokens, completionTokens, totalTokens };
306: }
307: 
308: function scanFinishReason(text: string, state: TelemetryScannerState): void {
309:   if (state.finishLogged) {
310:     return;
311:   }
312:   const reason = parseFinishReason(text);
313:   if (reason) {
314:     logFinishReason(state.reqId, reason.toLowerCase());
315:     state.finishLogged = true;
316:   }
317: }
318: 
319: function scanUsageMetadata(text: string, state: TelemetryScannerState): void {
320:   if (state.usageLogged) {
321:     return;
322:   }
323:   const usage = parseUsageMetadata(text);
324:   if (!usage) {
325:     return;
326:   }
327:   const durationMs = Date.now() - state.startTime;
328:   logUsage({
329:     reqId: state.reqId,
330:     provider: "gg",
331:     keyIndex: state.keyIndex,
332:     totalKeys: state.totalKeys,
333:     promptTokens: usage.promptTokens,
334:     completionTokens: usage.completionTokens,
335:     totalTokens: usage.totalTokens,
336:     durationMs,
337:   });
338:   state.usageLogged = true;
339: }
340: 
341: function scanChunkTelemetry(chunk: Uint8Array, state: TelemetryScannerState): void {
342:   if (chunk.byteLength === 0) {
343:     return;
344:   }
345:   const text = state.decoder.decode(chunk, { stream: true });
346:   state.buffer = (state.buffer + text).slice(-65536);
347:   scanFinishReason(state.buffer, state);
348:   scanUsageMetadata(state.buffer, state);
349:   if (state.finishLogged && state.usageLogged) {
350:     state.buffer = "";
351:   }
352: }
353: 
354: function emitStreamEndTelemetry(state: TelemetryScannerState): void {
355:   if (state.servedLogged) {
356:     return;
357:   }
358:   state.servedLogged = true;
359:   const remaining = state.decoder.decode();
360:   if (remaining.length > 0) {
361:     state.buffer = (state.buffer + remaining).slice(-65536);
362:     scanFinishReason(state.buffer, state);
363:     scanUsageMetadata(state.buffer, state);
364:   }
365:   state.buffer = "";
366:   const durationMs = Date.now() - state.startTime;
367:   logServed(state.reqId, durationMs, state.status, state.attempt, state.maxAttempts);
368:   logSeparator();
369: }
370: 
371: async function cancelRawReader(
372:   rawReader: ReadableStreamDefaultReader<Uint8Array>,
373:   reason: unknown
374: ): Promise<void> {
375:   try {
376:     await rawReader.cancel(reason);
377:   } catch (err: unknown) {
378:     logWarn(EMOJI.limit, `Google native stream cancel warning: ${err}`);
379:   }
380: }
381: 
382: function yieldFirstChunk(
383:   firstChunk: Uint8Array,
384:   controller: ReadableStreamDefaultController<Uint8Array>,
385:   state: TelemetryScannerState
386: ): void {
387:   if (firstChunk.byteLength === 0) {
388:     return;
389:   }
390:   scanChunkTelemetry(firstChunk, state);
391:   controller.enqueue(firstChunk);
392: }
393: 
394: async function handleNextChunk(
395:   rawReader: ReadableStreamDefaultReader<Uint8Array>,
396:   controller: ReadableStreamDefaultController<Uint8Array>,
397:   state: TelemetryScannerState
398: ): Promise<void> {
399:   try {
400:     const { done, value } = await rawReader.read();
401:     if (done) {
402:       emitStreamEndTelemetry(state);
403:       controller.close();
404:       return;
405:     }
406:     if (value) {
407:       scanChunkTelemetry(value, state);
408:       controller.enqueue(value);
409:     }
410:   } catch (err: unknown) {
411:     emitStreamEndTelemetry(state);
412:     controller.error(err);
413:   }
414: }
415: 
416: function createMonitoredStream(
417:   firstChunk: Uint8Array,
418:   rawReader: ReadableStreamDefaultReader<Uint8Array>,
419:   state: TelemetryScannerState
420: ): ReadableStream<Uint8Array> {
421:   let firstChunkYielded = false;
422: 
423:   return new ReadableStream<Uint8Array>({
424:     async pull(controller) {
425:       if (!firstChunkYielded) {
426:         firstChunkYielded = true;
427:         if (firstChunk.byteLength > 0) {
428:           yieldFirstChunk(firstChunk, controller, state);
429:           return;
430:         }
431:       }
432:       await handleNextChunk(rawReader, controller, state);
433:     },
434:     async cancel(reason) {
435:       emitStreamEndTelemetry(state);
436:       await cancelRawReader(rawReader, reason);
437:     },
438:   });
439: }
440: 
441: function logNativeInboundAttempt(
442:   context: NativeForwardContext,
443:   totalKeys: number,
444:   attempt: number
445: ): void {
446:   if (attempt !== 1) {
447:     return;
448:   }
449:   logNativeInbound(
450:     context.reqId,
451:     context.req,
452:     context.url,
453:     context.model,
454:     context.rawKey,
455:     totalKeys
456:   );
457: }
458: 
459: function createPoolExhaustedResponse(): { retry: boolean; response: Response } {
460:   return {
461:     retry: false,
462:     response: Response.json(
463:       { error: { message: "Google key pool exhausted", type: "rate_limit_error" } },
464:       { status: 503 }
465:     ),
466:   };
467: }
468: 
469: function logTtftDetails(
470:   reqId: string,
471:   pathname: string,
472:   ttftMs: number,
473:   protocol: string
474: ): void {
475:   const isStream = pathname.includes(":streamGenerateContent");
476:   const detail = isStream ? "Stream established" : "First chunk streamed downstream";
477:   logTtft(reqId, ttftMs, detail, protocol);
478: }
479: 
480: async function executeNativeFetch(
481:   context: NativeForwardContext,
482:   selected: SelectedKey
483: ): Promise<GuardFetchResult> {
484:   const upstreamHeaders = prepareUpstreamHeaders(context.req.headers, selected.key);
485:   const body = getRequestBody(context.req.method, context.bodyBuffer);
486:   const bodyString = body ? Buffer.from(body).toString("utf-8") : undefined;
487: 
488:   return fetchWithTtftGuard({
489:     url: context.upstreamUrl.toString(),
490:     method: context.req.method as "GET" | "POST",
491:     headers: Object.fromEntries(upstreamHeaders.entries()),
492:     body: bodyString,
493:     clientSignal: context.req.signal,
494:     provider: "gg",
495:     keyIndex: selected.index,
496:     model: context.model,
497:   });
498: }
499: 
500: async function handleNativeResponse(
501:   guardResult: GuardFetchResult,
502:   context: NativeForwardContext,
503:   selected: SelectedKey,
504:   attempt: number,
505:   startTime: number,
506:   maxAttempts: number
507: ): Promise<{ retry: boolean; response: Response }> {
508:   const { response: res, ttftMs, firstChunk, rawReader, protocol } = guardResult;
509: 
510:   if (res.status === 401 || res.status === 403) {
511:     logError(
512:       context.reqId,
513:       `Google native upstream auth failure (${res.status}): Key #${selected.index + 1} rejected. Failing fast.`
514:     );
515:     try {
516:       globalKeyPool.reportFailure("gg", selected.index, res.status);
517:     } catch (_err) {
518:       void _err;
519:     }
520:     const scannerState: TelemetryScannerState = {
521:       finishLogged: false,
522:       usageLogged: false,
523:       servedLogged: false,
524:       buffer: "",
525:       decoder: new TextDecoder(),
526:       startTime,
527:       reqId: context.reqId,
528:       keyIndex: selected.index,
529:       totalKeys: selected.totalKeys,
530:       status: res.status,
531:       attempt,
532:       maxAttempts,
533:     };
534:     const monitoredStream = createMonitoredStream(firstChunk, rawReader, scannerState);
535:     const downstreamHeaders = prepareDownstreamHeaders(res.headers);
536:     return {
537:       retry: false,
538:       response: new Response(monitoredStream, {
539:         status: res.status,
540:         statusText: res.statusText,
541:         headers: downstreamHeaders,
542:       }),
543:     };
544:   }
545: 
546:   const isRetryable = RETRYABLE_STATUSES.has(res.status);
547: 
548:   if (isRetryable) {
549:     logLimit(context.reqId, "gg", selected.index, res.status, undefined, selected.totalKeys);
550:     globalKeyPool.reportFailure("gg", selected.index, res.status);
551:     await cancelRawReader(rawReader, "retry");
552:     if (attempt < maxAttempts) {
553:       return { retry: true, response: res };
554:     }
555:   } else {
556:     globalKeyPool.reportSuccess("gg", selected.index);
557:   }
558: 
559:   logTtftDetails(context.reqId, context.url.pathname, ttftMs, protocol);
560: 
561:   const scannerState: TelemetryScannerState = {
562:     finishLogged: false,
563:     usageLogged: false,
564:     servedLogged: false,
565:     buffer: "",
566:     decoder: new TextDecoder(),
567:     startTime,
568:     reqId: context.reqId,
569:     keyIndex: selected.index,
570:     totalKeys: selected.totalKeys,
571:     status: res.status,
572:     attempt,
573:     maxAttempts,
574:   };
575: 
576:   const monitoredStream = createMonitoredStream(firstChunk, rawReader, scannerState);
577:   const downstreamHeaders = prepareDownstreamHeaders(res.headers);
578:   return {
579:     retry: false,
580:     response: new Response(monitoredStream, {
581:       status: res.status,
582:       statusText: res.statusText,
583:       headers: downstreamHeaders,
584:     }),
585:   };
586: }
587: 
588: function handleFetchNetworkError(
589:   err: unknown,
590:   reqId: string,
591:   keyIndex: number,
592:   isLastAttempt: boolean
593: ): { retry: boolean; response: Response } {
594:   globalKeyPool.reportFailure("gg", keyIndex, 502);
595:   logError(reqId, `Google native upstream network failure: ${err}`);
596:   if (!isLastAttempt) {
597:     return { retry: true, response: new Response(null, { status: 502 }) };
598:   }
599:   return {
600:     retry: false,
601:     response: Response.json(
602:       { error: { message: "Upstream Google request failed", type: "server_error" } },
603:       { status: 502 }
604:     ),
605:   };
606: }
607: 
608: async function attemptNativeForward(
609:   context: NativeForwardContext,
610:   attempt: number,
611:   maxAttempts: number = getGoogleMaxAttempts()
612: ): Promise<{ retry: boolean; response: Response }> {
613:   const pacerError = await acquireNativePacer(context.req.signal);
614:   if (pacerError) {
615:     return { retry: false, response: pacerError };
616:   }
617: 
618:   const selected = globalKeyPool.selectNextKey("gg");
619:   if (!selected) {
620:     return createPoolExhaustedResponse();
621:   }
622: 
623:   logNativeInboundAttempt(context, selected.totalKeys, attempt);
624: 
625:   const startTime = Date.now();
626:   try {
627:     const guardResult = await executeNativeFetch(context, selected);
628:     return await handleNativeResponse(guardResult, context, selected, attempt, startTime, maxAttempts);
629:   } catch (err: unknown) {
630:     if (isFatalAuthError(err)) {
631:       logError(context.reqId, `Google native fatal auth error: ${err.message}`);
632:       return {
633:         retry: false,
634:         response: Response.json(
635:           { error: { message: err.message, type: "authentication_error", code: err.status } },
636:           { status: err.status }
637:         ),
638:       };
639:     }
640:     const isLast = attempt >= maxAttempts;
641:     return handleFetchNetworkError(err, context.reqId, selected.index, isLast);
642:   }
643: }
644: 
645: function buildFusionServedResponse(
646:   outcomeResponse: Response,
647:   tierModel: string,
648:   tierIdx: number
649: ): Response {
650:   const resHeaders = new Headers(outcomeResponse.headers);
651:   for (const h of STRIPPED_DOWNSTREAM_HEADERS) {
652:     resHeaders.delete(h);
653:   }
654:   resHeaders.set("x-literouter-model", tierModel);
655:   resHeaders.set("x-literouter-tier", String(tierIdx + 1));
656: 
657:   return new Response(outcomeResponse.body, {
658:     status: outcomeResponse.status,
659:     statusText: outcomeResponse.statusText,
660:     headers: resHeaders,
661:   });
662: }
663: 
664: type TierOutcome =
665:   | { readonly kind: "success"; readonly response: Response }
666:   | { readonly kind: "fast_advance"; readonly response: Response }
667:   | { readonly kind: "fast_fail"; readonly response: Response }
668:   | { readonly kind: "exhausted"; readonly response?: Response };
669: 
670: async function executeTierKeyLoop(
671:   context: NativeForwardContext,
672:   chainKey: string,
673:   tierModel: string,
674:   tierIdx: number,
675:   totalTiers: number,
676:   chain: readonly string[]
677: ): Promise<TierOutcome> {
678:   const totalActiveKeys = Math.max(1, globalKeyPool.getPoolSize("gg"));
679:   let lastResponse: Response | undefined;
680: 
681:   for (let attempt = 1; attempt <= totalActiveKeys; attempt++) {
682:     const outcome = await attemptNativeForward(context, attempt, totalActiveKeys);
683:     lastResponse = outcome.response;
684:     if (outcome.retry) {
685:       continue;
686:     }
687: 
688:     const status = outcome.response.status;
689:     if (status === 401 || status === 403) {
690:       logError(
691:         context.reqId,
692:         `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) -> ${status} Fatal Auth Failure. Halting cascade.`
693:       );
694:       return { kind: "fast_fail", response: outcome.response };
695:     }
696: 
697:     if (status === 404) {
698:       const nextModel = chain[(tierIdx + 1) % totalTiers];
699:       logWarn(
700:         EMOJI.fusion,
701:         `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → 404. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${nextModel})`
702:       );
703:       return { kind: "fast_advance", response: outcome.response };
704:     }
705: 
706:     if (status < 429) {
707:       setNativeTierIndex(chainKey, tierIdx);
708:       logInfo(
709:         EMOJI.fusion,
710:         `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → ${status} OK. Served by Tier ${tierIdx + 1}.`
711:       );
712:       return {
713:         kind: "success",
714:         response: buildFusionServedResponse(outcome.response, tierModel, tierIdx),
715:       };
716:     }
717:   }
718: 
719:   const nextModel = chain[(tierIdx + 1) % totalTiers];
720:   logWarn(
721:     EMOJI.fusion,
722:     `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → all ${totalActiveKeys} keys exhausted. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${nextModel})`
723:   );
724:   return { kind: "exhausted", response: lastResponse };
725: }
726: 
727: async function executeNativeFusionCascade(
728:   req: Request,
729:   rawKey: string,
730:   reqId: string,
731:   url: URL,
732:   endpointKey: string,
733:   bodyBuffer: ArrayBuffer,
734:   chainKey = "gemini-flash",
735:   chain: readonly string[] = resolveNativeChain(chainKey) ?? DEFAULT_FLASH_CHAIN
736: ): Promise<Response> {
737:   const totalTiers = chain.length;
738:   if (totalTiers === 0) {
739:     return Response.json(
740:       { error: { message: `No native chain configured for ${chainKey}`, type: "configuration_error" } },
741:       { status: 500 }
742:     );
743:   }
744: 
745:   const startTier = getNativeTierIndex(chainKey);
746:   let lastResponse: Response | undefined;
747: 
748:   for (let cycleStep = 0; cycleStep < totalTiers; cycleStep++) {
749:     const tierIdx = (startTier + cycleStep) % totalTiers;
750:     const tierModel = chain[tierIdx] ?? chain[0] ?? "gemini-3.5-flash";
751:     const resolvedEndpoint = resolveUpstreamEndpoint("gg", endpointKey, tierModel);
752:     const tierUpstreamUrl = new URL(resolvedEndpoint.url);
753:     if (url.pathname.includes(":streamGenerateContent")) {
754:       tierUpstreamUrl.pathname = tierUpstreamUrl.pathname.replace(":generateContent", ":streamGenerateContent");
755:     }
756:     for (const [k, v] of url.searchParams) {
757:       if (k.toLowerCase() !== "key") {
758:         tierUpstreamUrl.searchParams.set(k, v);
759:       }
760:     }
761: 
762:     const context: NativeForwardContext = {
763:       req,
764:       rawKey,
765:       reqId,
766:       url,
767:       upstreamUrl: tierUpstreamUrl,
768:       model: tierModel,
769:       bodyBuffer,
770:     };
771: 
772:     const outcome = await executeTierKeyLoop(context, chainKey, tierModel, tierIdx, totalTiers, chain);
773:     if (outcome.kind === "success" || outcome.kind === "fast_fail") {
774:       return outcome.response;
775:     }
776:     lastResponse = outcome.response;
777:     setNativeTierIndex(chainKey, (startTier + cycleStep + 1) % totalTiers);
778:   }
779: 
780:   logWarn(EMOJI.exhausted, `[FUSION ${reqId}] All ${totalTiers} tiers exhausted. Returning 503.`);
781:   return Response.json(
782:     { error: { message: "All Google native fusion tiers exhausted", type: "service_unavailable" } },
783:     { status: 503 }
784:   );
785: }
786: 
787: async function executeSingleModelForward(context: NativeForwardContext): Promise<Response> {
788:   const maxAttempts = getGoogleMaxAttempts();
789:   let lastResponse: Response | undefined;
790:   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
791:     const outcome = await attemptNativeForward(context, attempt, maxAttempts);
792:     if (!outcome.retry) {
793:       return outcome.response;
794:     }
795:     lastResponse = outcome.response;
796:   }
797: 
798:   return (
799:     lastResponse ??
800:     Response.json(
801:       { error: { message: "Google request failed after retries", type: "server_error" } },
802:       { status: 502 }
803:     )
804:   );
805: }
806: 
807: function extractModelFromPath(pathname: string): string {
808:   const match = pathname.match(/\/(?:v1beta|v1)\/models\/([^:]+)/);
809:   const raw = match?.[1] ?? "";
810:   return raw.replace(/^(?:google\/|gcp\/)/i, "");
811: }
812: 
813: export async function handleGoogleNative(
814:   req: Request,
815:   rawKey: string,
816:   reqId: string
817: ): Promise<Response> {
818:   const auth = validateGoogleDirective(rawKey);
819:   if (auth.error) {
820:     return auth.error;
821:   }
822:   const directive = auth.directive!;
823:   const endpointKey = directive.type === "direct" && directive.completion ? directive.completion : "gc";
824: 
825:   const url = new URL(req.url);
826:   const bodyBuffer = await req.arrayBuffer();
827: 
828:   let model = extractModelFromPath(url.pathname);
829:   if (!model && bodyBuffer.byteLength > 0) {
830:     try {
831:       const parsedBody = JSON.parse(new TextDecoder().decode(bodyBuffer)) as Record<string, unknown>;
832:       if (typeof parsedBody.model === "string") {
833:         model = parsedBody.model.replace(/^(?:google\/|gcp\/)/i, "");
834:       }
835:     } catch {
836:       // not JSON or body without model
837:     }
838:   }
839: 
840:   const chain = resolveNativeChain(model);
841:   if (chain && chain.length > 0) {
842:     return executeNativeFusionCascade(
843:       req,
844:       rawKey,
845:       reqId,
846:       url,
847:       endpointKey,
848:       bodyBuffer,
849:       model,
850:       chain
851:     );
852:   }
853: 
854:   const resolvedEndpoint = resolveUpstreamEndpoint("gg", endpointKey, model);
855:   const upstreamUrl = new URL(resolvedEndpoint.url);
856:   if (url.pathname.includes(":streamGenerateContent")) {
857:     upstreamUrl.pathname = upstreamUrl.pathname.replace(":generateContent", ":streamGenerateContent");
858:   }
859:   for (const [k, v] of url.searchParams) {
860:     if (k.toLowerCase() !== "key") {
861:       upstreamUrl.searchParams.set(k, v);
862:     }
863:   }
864: 
865:   const context: NativeForwardContext = {
866:     req,
867:     rawKey,
868:     reqId,
869:     url,
870:     upstreamUrl,
871:     model,
872:     bodyBuffer,
873:   };
874: 
875:   return executeSingleModelForward(context);
876: }
877: 
878: export async function handleGoogleOpenAIBeta(
879:   req: Request,
880:   rawKey: string,
881:   reqId: string
882: ): Promise<Response> {
883:   return handleOpenAICompat(req, rawKey, reqId);
884: }
885: 
886: /**
887:  * Verbatim pass-through for the Antigravity Agent Interactions API
888:  * (`POST /v1beta/interactions`, `GET /v1beta/files/{id}:download`).
889:  *
890:  * The directive (api-key as filter) selects the Google provider; the request
891:  * path + query are forwarded as-is to GOOGLE_NATIVE_BASE_URL and authenticated
892:  * with a rotated key from the `gg` pool. The gateway master key (sk-lr-*) is
893:  * intentionally NOT accepted here.
894:  */
895: export async function handleGoogleInteractionsPassthrough(
896:   req: Request,
897:   rawKey: string,
898:   reqId: string
899: ): Promise<Response> {
900:   const validation = validateDirective(rawKey);
901:   if (validation.valid === false) {
902:     return createUnauthorizedResponse(validation.error);
903:   }
904:   const directive = validation.directive;
905:   if (directive.type !== "direct" || directive.provider !== "gg") {
906:     return Response.json(
907:       {
908:         error: {
909:           message: "Antigravity interactions requires a Google directive (lr-gg-*)",
910:           type: "invalid_request_error",
911:         },
912:       },
913:       { status: 400 }
914:     );
915:   }
916: 
917:   const url = new URL(req.url);
918:   const ggConfig = getProviderConfig("gg");
919:   const base = overrideProviderUrl(ggConfig.base_url, "gg");
920:   const upstreamUrl = new URL(`${base}${url.pathname}${url.search}`);
921: 
922:   const pacerError = await acquireNativePacer(req.signal);
923:   if (pacerError) {
924:     return pacerError;
925:   }
926: 
927:   const selected = globalKeyPool.selectNextKey("gg");
928:   if (!selected) {
929:     return Response.json(
930:       { error: { message: "Google key pool exhausted", type: "rate_limit_error" } },
931:       { status: 503 }
932:     );
933:   }
934: 
935:   const upstreamHeaders = prepareUpstreamHeaders(req.headers, selected.key);
936:   const ggReferrer = resolveGoogleReferrer("antigravity");
937: 
938:   logInbound({
939:     reqId,
940:     method: req.method,
941:     path: url.pathname,
942:     clientAgent: req.headers.get("user-agent") || "unknown",
943:     protocol: req.headers.get("x-http-version") || "HTTP/1.1",
944:     directiveStr: rawKey,
945:     targetProvider: "gg",
946:     wireFormat: "gg",
947:     endpoint: url.pathname,
948:     model: "antigravity",
949:     totalKeys: selected.totalKeys,
950:     referrer: ggReferrer,
951:   });
952: 
953:   try {
954:     const upstreamReq = new Request(upstreamUrl.toString(), {
955:       method: req.method,
956:       headers: upstreamHeaders,
957:       body: req.body,
958:       signal: req.signal,
959:     });
960:     const res = await fetch(upstreamReq);
961:     if (res.status === 401 || res.status === 403) {
962:       logError(
963:         reqId,
964:         `Google interactions passthrough upstream auth failure (${res.status}): Key #${selected.index + 1} rejected. Failing fast.`
965:       );
966:       try {
967:         globalKeyPool.reportFailure("gg", selected.index, res.status);
968:       } catch (_err) {
969:         void _err;
970:       }
971:     } else if (res.status >= 400) {
972:       globalKeyPool.reportFailure("gg", selected.index, res.status);
973:     } else {
974:       globalKeyPool.reportSuccess("gg", selected.index);
975:     }
976:     const outHeaders = prepareDownstreamHeaders(res.headers);
977:     return new Response(res.body, { status: res.status, headers: outHeaders });
978:   } catch (err: unknown) {
979:     globalKeyPool.reportFailure("gg", selected.index, 502);
980:     logError(reqId, `Google interactions passthrough upstream failure: ${err}`);
981:     return Response.json(
982:       { error: { message: "Upstream Google interactions request failed", type: "server_error" } },
983:       { status: 502 }
984:     );
985:   }
986: }
987: 
988: export {
989:   GoogleNativeTransformer,
990:   googleNativeTransformer,
991:   type GoogleUsage,
992:   parseFinishReason,
993:   parseUsageMetadata,
994: } from "../transformers/google_native";
```

## File: src/config/providers.ts
```typescript
  1: import { readFileSync, existsSync } from "node:fs";
  2: import { resolve } from "node:path";
  3: import { ZodError } from "zod";
  4: import { ProvidersConfigSchema, type ProviderConfigEntry } from "./schema";
  5: import { logWarn, EMOJI } from "../ui/logger";
  6: 
  7: const logger = {
  8:   warn: (msg: string) => logWarn(EMOJI.amber, msg),
  9: };
 10: 
 11: interface ProviderRegistrySnapshot {
 12:   readonly byCode: ReadonlyMap<string, ProviderConfigEntry>;
 13:   readonly byName: ReadonlyMap<string, ProviderConfigEntry>;
 14: }
 15: 
 16: // Atomic reference — single pointer swap on reload
 17: let registry: ProviderRegistrySnapshot = {
 18:   byCode: new Map(),
 19:   byName: new Map(),
 20: };
 21: 
 22: function loadRawProvidersJson(): unknown {
 23:   const defaultPath = resolve(import.meta.dir, "../../config/providers.json");
 24:   if (existsSync(defaultPath)) {
 25:     try {
 26:       const file = Bun.file(defaultPath);
 27:       // Synchronous fast check if size available, read synchronously via readFileSync for safe atomic init
 28:       if (typeof file.size === "number") {
 29:         return JSON.parse(readFileSync(defaultPath, "utf-8"));
 30:       }
 31:     } catch {
 32:       return JSON.parse(readFileSync(defaultPath, "utf-8"));
 33:     }
 34:     return JSON.parse(readFileSync(defaultPath, "utf-8"));
 35:   }
 36:   throw new Error(`[ProviderRegistry] providers.json not found at: ${defaultPath}`);
 37: }
 38: 
 39: export function initProviderRegistry(rawConfig?: unknown): void {
 40:   const source = rawConfig ?? loadRawProvidersJson();
 41:   let parsed: ReturnType<typeof ProvidersConfigSchema.parse>;
 42:   try {
 43:     parsed = ProvidersConfigSchema.parse(source);
 44:   } catch (err: unknown) {
 45:     if (err instanceof ZodError) {
 46:       const formattedErrors = err.issues
 47:         .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
 48:         .join("\n");
 49:       console.error(
 50:         `[FATAL] [ProviderRegistry] Provider configuration validation failed loudly refusing to start:\n${formattedErrors}`
 51:       );
 52:     }
 53:     throw err;
 54:   }
 55:   const byCode = new Map<string, ProviderConfigEntry>();
 56:   const byName = new Map<string, ProviderConfigEntry>();
 57: 
 58:   for (const [key, entry] of Object.entries(parsed.providers)) {
 59:     // Populate name if omitted in JSON
 60:     const fullEntry: ProviderConfigEntry = {
 61:       ...entry,
 62:       name: entry.name ?? key,
 63:     };
 64:     byCode.set(entry.code.toLowerCase(), fullEntry);
 65:     byName.set(key.toLowerCase(), fullEntry);
 66:   }
 67: 
 68:   // Atomic single-pointer swap
 69:   registry = Object.freeze({ byCode, byName });
 70: }
 71: 
 72: export function getProviderConfig(codeOrName: string): ProviderConfigEntry {
 73:   if (registry.byCode.size === 0) {
 74:     initProviderRegistry();
 75:   }
 76:   const norm = codeOrName.toLowerCase();
 77:   const snap = registry; // Read once — consistent snapshot
 78:   const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
 79:   if (!entry) {
 80:     throw new Error(`[ProviderRegistry] Unknown provider: "${codeOrName}"`);
 81:   }
 82:   return entry;
 83: }
 84: 
 85: export function getProviderDisplayName(codeOrName: string): string {
 86:   if (registry.byCode.size === 0) {
 87:     initProviderRegistry();
 88:   }
 89:   const norm = codeOrName.toLowerCase();
 90:   const snap = registry;
 91:   const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
 92:   return entry?.name ?? codeOrName.toUpperCase();
 93: }
 94: 
 95: export function isRegisteredProvider(code: string): boolean {
 96:   if (registry.byCode.size === 0) {
 97:     initProviderRegistry();
 98:   }
 99:   return registry.byCode.has(code.toLowerCase());
100: }
101: 
102: export function getAllProviders(): readonly ProviderConfigEntry[] {
103:   if (registry.byCode.size === 0) {
104:     initProviderRegistry();
105:   }
106:   return Array.from(registry.byCode.values());
107: }
108: 
109: export function overrideProviderUrl(url: string, providerCode: string): string {
110:   const code = providerCode.toUpperCase();
111:   const mockPort = process.env[`MOCK_${code}_PORT`];
112:   if (!mockPort) {
113:     return url;
114:   }
115:   try {
116:     const parsed = new URL(url);
117:     parsed.protocol = "http:";
118:     parsed.host = `localhost:${mockPort}`;
119:     return parsed.toString();
120:   } catch {
121:     logger.warn(`[overrideProviderUrl] Invalid MOCK_${code}_PORT env var — falling back to production URL`);
122:     return url;
123:   }
124: }
125: 
126: export function resolveUpstreamEndpoint(
127:   providerCodeOrName: string,
128:   endpointKey: string,
129:   model?: string
130: ): { url: string; authHeader: "Bearer" | "x-api-key"; rawPath: string; headers: Record<string, string> } {
131:   if (isRegisteredProvider(providerCodeOrName)) {
132:     const p = getProviderConfig(providerCodeOrName);
133:     const endpoints = p.endpoints as Record<string, string | undefined>;
134:     const rawPath = endpoints[endpointKey] ?? (endpointKey.startsWith("/") ? endpointKey : undefined);
135:     if (rawPath) {
136:       const formatted = model !== undefined ? rawPath.replace("{model}", model) : rawPath;
137:       const originalUrl = `${p.base_url}${formatted.startsWith("/") ? formatted : `/${formatted}`}`;
138:       return {
139:         url: overrideProviderUrl(originalUrl, p.code),
140:         authHeader: p.auth_header ?? "Bearer",
141:         rawPath: formatted.startsWith("/") ? formatted : `/${formatted}`,
142:         headers: p.headers ?? {},
143:       };
144:     }
145:     throw new Error(
146:       `[resolveUpstreamEndpoint] Unknown endpoint key "${endpointKey}" for provider "${providerCodeOrName}"`
147:     );
148:   }
149: 
150:   return {
151:     url: overrideProviderUrl("https://openrouter.ai/api/v1/chat/completions", providerCodeOrName),
152:     authHeader: "Bearer",
153:     rawPath: "/api/v1/chat/completions",
154:     headers: {},
155:   };
156: }
```

## File: src/config/schema.ts
```typescript
  1: import { z } from "zod";
  2: 
  3: export const ProviderCodeSchema = z.enum([
  4:   "or",
  5:   "nv",
  6:   "gg",
  7:   "oa",
  8:   "an",
  9:   "gq",
 10:   "cb",
 11:   "ds",
 12:   "ms",
 13:   "tg",
 14:   "zn",
 15:   "tp",
 16:   "gc",
 17: ]);
 18: 
 19: export const PayloadCodeSchema = z.enum(["oa", "oo", "cl", "gg", "rs", "ao"]);
 20: 
 21: export const CompletionCodeSchema = z.enum([
 22:   "ch",
 23:   "ms",
 24:   "ob",
 25:   "gc",
 26:   "g1",
 27:   "im",
 28:   "em",
 29:   "au",
 30:   "md",
 31:   "rs",
 32: ]);
 33: 
 34: export const NuanceCodeSchema = z.enum([
 35:   "no",
 36:   "dp",
 37:   "ts",
 38:   "gm",
 39:   "g3",
 40:   "sb",
 41:   "tc",
 42: ]);
 43: 
 44: export const RateLimitSchema = z.object({
 45:   rpm: z.number().int().nonnegative(),
 46:   rpd: z.number().int().nonnegative(),
 47:   tpm: z.number().int().nonnegative(),
 48: });
 49: 
 50: export const ProviderEndpointsSchema = z.record(
 51:   CompletionCodeSchema,
 52:   z.string().min(1)
 53: );
 54: 
 55: export const RequestRetryDelaySchema = z
 56:   .object({
 57:     min_ms: z.number().int().nonnegative(),
 58:     max_ms: z.number().int().nonnegative(),
 59:   })
 60:   .refine((data) => data.max_ms >= data.min_ms, {
 61:     message: "max_ms must be >= min_ms",
 62:     path: ["max_ms"],
 63:   });
 64: 
 65: export const RequestRetrySchema = z.object({
 66:   enabled: z.boolean(),
 67:   max_attempts: z.number().int().positive(),
 68:   delay: RequestRetryDelaySchema,
 69: });
 70: 
 71: export const KeyCooldownSchema = z.object({
 72:   enabled: z.boolean(),
 73:   initial_cooldown_ms: z.number().int().positive(),
 74:   backoff_factor: z.number().positive().default(1.5),
 75:   max_cooldown_ms: z.number().int().positive(),
 76:   max_consecutive_failures: z.number().int().positive().default(5),
 77:   jitter_percent: z.number().min(0).max(50).default(20),
 78:   respect_retry_after: z.boolean().default(true),
 79:   reset_after_success: z.boolean().default(true),
 80: });
 81: 
 82: export const ProviderPacerConfigSchema = z
 83:   .object({
 84:     enabled: z.boolean(),
 85:     min_delay_ms: z.number().int().nonnegative(),
 86:     max_delay_ms: z.number().int().nonnegative(),
 87:     max_queue_depth: z.number().int().positive(),
 88:     max_queue_wait_ms: z.number().int().positive(),
 89:     max_concurrency: z.number().int().nonnegative().optional().default(0),
 90:   })
 91:   .refine((data) => data.max_delay_ms >= data.min_delay_ms, {
 92:     message: "max_delay_ms must be >= min_delay_ms",
 93:     path: ["max_delay_ms"],
 94:   });
 95: 
 96: export const ConserveRuleSchema = z.object({
 97:   status: z.number().int(),
 98:   contains: z.string().min(1),
 99:   ttl: z
100:     .enum(["midnight_utc", "midnight_pacific", "indefinite", "1h", "24h"])
101:     .default("midnight_utc"),
102:   reason: z.string().min(1),
103: });
104: 
105: export const ProviderStrategySchema = z
106:   .enum([
107:     "standard",
108:     "native_cascade",
109:     "gcp_guarded",
110:     "anthropic_direct",
111:     "zen",
112:   ])
113:   .default("standard");
114: 
115: export const ProviderConfigEntrySchema = z.object({
116:   code: z.string().regex(/^[a-z0-9]{2,6}$/),
117:   base_url: z.string().url(),
118:   auth_header: z.enum(["Bearer", "x-api-key"]).default("Bearer"),
119:   headers: z.record(z.string(), z.string()).optional(),
120:   endpoints: ProviderEndpointsSchema,
121:   limits: z.record(z.string(), RateLimitSchema).optional(),
122:   conserve_rules: z.array(ConserveRuleSchema).optional().default([]),
123:   name: z.string().min(1).optional(),
124:   env_key: z.string().min(1),
125:   strategy: ProviderStrategySchema.optional().default("standard"),
126:   request_retry: RequestRetrySchema,
127:   key_cooldown: KeyCooldownSchema.optional(),
128:   pacer: ProviderPacerConfigSchema,
129: });
130: 
131: export const ProvidersConfigSchema = z.object({
132:   providers: z.record(z.string(), ProviderConfigEntrySchema),
133: });
134: 
135: export const FusionTierSchema = z.object({
136:   priority: z.number().int().positive(),
137:   apikey: z.string().min(1),
138:   model: z.string().min(1),
139: });
140: 
141: export const FusionModelConfigSchema = z.object({
142:   tiers: z.array(FusionTierSchema).min(1),
143: });
144: 
145: export const FusionPresetSchema = z.object({
146:   strategy: z.literal("sticky_fallback"),
147:   timeout_ms: z.number().int().positive().default(30000),
148:   models: z.record(z.string(), FusionModelConfigSchema),
149: });
150: 
151: export const FusionConfigSchema = z.object({
152:   $schema: z.string().optional(),
153:   version: z.string().default("3.1"),
154:   presets: z.record(z.string(), FusionPresetSchema),
155: });
156: 
157: export const ModelCatalogEntrySchema = z.object({
158:   id: z.string().min(1),
159:   provider: z.string().min(1),
160:   category: z.string().min(1),
161:   supports_thinking: z.boolean().default(false),
162:   supports_tools: z.boolean().default(false),
163:   context_window: z.number().int().positive(),
164:   quota: RateLimitSchema.optional(),
165: });
166: 
167: export const ModelsConfigSchema = z.object({
168:   models: z.array(ModelCatalogEntrySchema),
169: });
170: 
171: const TRUTHY_SET: ReadonlySet<string> = new Set(["true", "1", "yes"]);
172: const FALSY_SET: ReadonlySet<string> = new Set(["false", "0", "no"]);
173: 
174: function parseBooleanString(val: unknown): unknown {
175:   if (typeof val !== "string") {
176:     return val;
177:   }
178:   const lower = val.toLowerCase().trim();
179:   if (TRUTHY_SET.has(lower)) {
180:     return true;
181:   }
182:   if (FALSY_SET.has(lower)) {
183:     return false;
184:   }
185:   return val;
186: }
187: 
188: export const BooleanCoerceSchema = z.preprocess(parseBooleanString, z.boolean());
189: 
190: export const LiteRouterEngineSchema = z.enum(["legacy", "v4.1"]).default("v4.1");
191: export type LiteRouterEngine = z.infer<typeof LiteRouterEngineSchema>;
192: 
193: export const EnvConfigSchema = z.object({
194:   LITEROUTER_PORT: z.coerce.number().int().positive().default(7766),
195:   LITEROUTER_HOST: z.string().default("0.0.0.0"),
196:   LITEROUTER_AUTH_KEY: z.string().default(""),
197:   LITEROUTER_TLS_ENABLED: BooleanCoerceSchema.default(false),
198:   LITEROUTER_HTTP2: BooleanCoerceSchema.default(false),
199:   LITEROUTER_STRIP_REASONING: BooleanCoerceSchema.default(false),
200:   LITEROUTER_AO_STRIP_REASONING: BooleanCoerceSchema.default(true),
201:   LITEROUTER_AO_MAX_TOKENS: z.coerce.number().int().nonnegative().default(32768),
202:   LITEROUTER_ENABLE_SCRUBBING: BooleanCoerceSchema.default(false),
203:   LITEROUTER_TTFT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
204:   LITEROUTER_NO_RESPONSE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
205:   LITEROUTER_STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
206:   LITEROUTER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
207:   LITEROUTER_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive().default(60),
208:   COOLDOWN_RATE_LIMIT_TTL_SEC: z.coerce.number().int().nonnegative().default(65),
209:   COOLDOWN_SERVER_ERROR_TTL_SEC: z.coerce.number().int().positive().default(10),
210:   COOLDOWN_AUTH_ERROR_TTL_SEC: z.coerce.number().int().positive().default(604800),
211:   FUSION_STICKY_TTL_MS: z.coerce.number().int().positive().default(300000),
212:   STREAM_STALL_MAX_RESENDS: z.coerce.number().int().nonnegative().default(2),
213:   KEEPALIVE_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
214:   LITEROUTER_HTTP_REFERER: z.string().default("https://opencode.ai"),
215:   LITEROUTER_X_TITLE: z.string().default("OpenCode"),
216:   LITEROUTER_USER_AGENT: z.string().default("OpenCode/1.0.0"),
217:   LITEROUTER_H2_OUTBOUND: BooleanCoerceSchema.default(true),
218:   LITEROUTER_PACER_ENABLED: BooleanCoerceSchema.default(true),
219:   LITEROUTER_CIRCUIT_BREAKER: BooleanCoerceSchema.default(true),
220:   LITEROUTER_PACER_MAX_RPM: z.coerce.number().int().positive().default(600),
221:   LITEROUTER_PACER_MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
222:   LITEROUTER_PACER_MAX_QUEUE_WAIT_MS: z.coerce.number().int().positive().default(15000),
223:   NVIDIA_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
224:   GOOGLE_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
225:   TEST_PROVIDER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
226:   MOCK_TP_PORT: z.coerce.number().int().positive().default(8999),
227:   LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
228:   LITEROUTER_ENGINE: LiteRouterEngineSchema,
229:   LITEROUTER_ENGINE_OVERRIDE: BooleanCoerceSchema.default(false),
230: });
231: 
232: export type ProviderCode = z.infer<typeof ProviderCodeSchema>;
233: export type PayloadCode = z.infer<typeof PayloadCodeSchema>;
234: export type CompletionCode = z.infer<typeof CompletionCodeSchema>;
235: export type NuanceCode = z.infer<typeof NuanceCodeSchema>;
236: export type RateLimit = z.infer<typeof RateLimitSchema>;
237: export type RequestRetryDelayConfig = z.infer<typeof RequestRetryDelaySchema>;
238: export type RequestRetryConfig = z.infer<typeof RequestRetrySchema>;
239: export type KeyCooldownConfig = z.infer<typeof KeyCooldownSchema>;
240: export type ProviderPacerConfig = z.infer<typeof ProviderPacerConfigSchema>;
241: export type ConserveRule = z.infer<typeof ConserveRuleSchema>;
242: export type ProviderStrategyType = z.infer<typeof ProviderStrategySchema>;
243: export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;
244: export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
245: export type FusionTier = z.infer<typeof FusionTierSchema>;
246: export type FusionModelConfig = z.infer<typeof FusionModelConfigSchema>;
247: export type FusionPreset = z.infer<typeof FusionPresetSchema>;
248: export type FusionConfig = z.infer<typeof FusionConfigSchema>;
249: export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;
250: export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
251: export type EnvConfig = z.infer<typeof EnvConfigSchema>;
```

## File: src/handlers/anthropic_compat.ts
```typescript
   1: import { TagSanitizerStreamBuffer, stripLeakedTemplateTags } from "../transformers/dots";
   2: import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
   3: import { validateDirective } from "../directive/validator";
   4: import {
   5:   acquireProviderPacer,
   6:   buildAuthHeaders,
   7:   globalKeyPool,
   8:   handleOpenAICompat,
   9:   resolveUpstreamEndpoint,
  10:   UpstreamRetryableError,
  11:   waitAndSelectKey,
  12: } from "./openai_compat";
  13: import { classifyTransportError, classifyUpstreamError } from "../network/classifier";
  14: import {
  15:   EMOJI,
  16:   extractErrorMessage,
  17:   logError,
  18:   logExhausted,
  19:   logInbound,
  20:   logLimit,
  21:   logRotate,
  22:   logSeparator,
  23:   logServed,
  24:   logTtft,
  25:   logUsage,
  26:   logWarn,
  27: } from "../ui/logger";
  28: import {
  29:   createResilientStream,
  30:   fetchWithTtftGuard,
  31:   NoResponseError,
  32:   sanitizeDownstreamHeaders,
  33: } from "../network/fetcher";
  34: import { scrubUnsupportedParameters } from "../transformers/payload";
  35: import {
  36:   DEFAULT_MAX_CONTEXT_TOKENS,
  37:   DEFAULT_SAFE_CONTEXT_TOKENS,
  38:   estimateAnthropicTokens,
  39:   extractContextLimit,
  40:   isContextLengthError,
  41:   pruneAnthropicPayload,
  42: } from "../transformers/context_pruner";
  43: import { getEnv } from "../config/env";
  44: import { getProviderConfig, isRegisteredProvider } from "../config/providers";
  45: import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
  46: import type { DirectDirective } from "../directive/parser";
  47: import { isFatalAuthError, type SelectedKey } from "../network/pool";
  48: 
  49: export interface AnthropicImageSource {
  50:   readonly type: "base64" | "url";
  51:   readonly media_type?: string;
  52:   readonly data?: string;
  53:   readonly url?: string;
  54: }
  55: 
  56: export interface AnthropicContentBlock {
  57:   readonly type: "text" | "image" | "document" | "thinking" | "redacted_thinking" | "tool_use" | "tool_result";
  58:   readonly text?: string;
  59:   readonly thinking?: string;
  60:   readonly id?: string;
  61:   readonly name?: string;
  62:   readonly input?: unknown;
  63:   readonly tool_use_id?: string;
  64:   readonly content?: string | readonly unknown[];
  65:   readonly is_error?: boolean;
  66:   readonly source?: AnthropicImageSource;
  67: }
  68: 
  69: export interface AnthropicMessage {
  70:   readonly role: "user" | "assistant";
  71:   readonly content: string | readonly AnthropicContentBlock[];
  72: }
  73: 
  74: export interface AnthropicMessagesRequest {
  75:   readonly model: string;
  76:   readonly messages: readonly AnthropicMessage[];
  77:   readonly system?: string | readonly unknown[];
  78:   readonly max_tokens?: number;
  79:   readonly stream?: boolean;
  80:   readonly stream_options?: unknown;
  81:   readonly temperature?: number;
  82:   readonly top_p?: number;
  83:   readonly top_k?: number;
  84:   readonly stop_sequences?: readonly string[];
  85:   readonly metadata?: unknown;
  86:   readonly tools?: readonly unknown[];
  87:   readonly tool_choice?: unknown;
  88:   readonly thinking?: unknown;
  89:   readonly [key: string]: unknown;
  90: }
  91: 
  92: export function createAnthropicErrorResponse(
  93:   status: number,
  94:   message: string,
  95:   errorType = "invalid_request_error",
  96:   headers?: Record<string, string>
  97: ): Response {
  98:   return Response.json(
  99:     {
 100:       type: "error",
 101:       error: {
 102:         type: errorType,
 103:         message,
 104:       },
 105:     },
 106:     {
 107:       status,
 108:       headers: { "Content-Type": "application/json", ...(headers || {}) },
 109:     }
 110:   );
 111: }
 112: 
 113: export function mapOpenAIToAnthropicStopReason(
 114:   finishReason?: string | null,
 115:   hasToolUse = false
 116: ): string {
 117:   if (finishReason === "length") {
 118:     return "max_tokens";
 119:   }
 120:   if (finishReason === "content_filter") {
 121:     return "refusal";
 122:   }
 123:   if (hasToolUse || finishReason === "tool_calls" || finishReason === "function_call") {
 124:     return "tool_use";
 125:   }
 126:   return "end_turn";
 127: }
 128: 
 129: export function mapOpenAIToAnthropicUsage(usage: unknown): Record<string, unknown> {
 130:   if (!usage || typeof usage !== "object") {
 131:     return { input_tokens: 0, output_tokens: 0 };
 132:   }
 133:   const u = usage as Record<string, unknown>;
 134:   const inputTokens = typeof u.prompt_tokens === "number"
 135:     ? u.prompt_tokens
 136:     : (typeof u.input_tokens === "number" ? u.input_tokens : 0);
 137:   const outputTokens = typeof u.completion_tokens === "number"
 138:     ? u.completion_tokens
 139:     : (typeof u.output_tokens === "number" ? u.output_tokens : 0);
 140: 
 141:   const result: Record<string, unknown> = {
 142:     input_tokens: inputTokens,
 143:     output_tokens: outputTokens,
 144:   };
 145: 
 146:   const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
 147:   if (details && typeof details.cached_tokens === "number") {
 148:     result.cache_read_input_tokens = details.cached_tokens;
 149:   } else if (typeof u.cache_read_input_tokens === "number") {
 150:     result.cache_read_input_tokens = u.cache_read_input_tokens;
 151:   }
 152: 
 153:   return result;
 154: }
 155: 
 156: function extractSystemString(system: unknown): string | null {
 157:   if (typeof system === "string") {
 158:     return system;
 159:   }
 160:   if (Array.isArray(system)) {
 161:     return system
 162:       .filter((b): b is { text: string } => typeof b === "object" && b !== null && typeof b.text === "string")
 163:       .map((b) => b.text)
 164:       .join("\n");
 165:   }
 166:   return null;
 167: }
 168: 
 169: function isAnthropicTool(tool: unknown): tool is { name: string; description?: string; input_schema: unknown } {
 170:   if (typeof tool !== "object" || tool === null) {
 171:     return false;
 172:   }
 173:   const t = tool as Record<string, unknown>;
 174:   return typeof t.name === "string" && "input_schema" in t;
 175: }
 176: 
 177: function translateSingleTool(tool: unknown): unknown {
 178:   if (!isAnthropicTool(tool)) {
 179:     return tool;
 180:   }
 181:   return {
 182:     type: "function",
 183:     function: {
 184:       name: tool.name,
 185:       description: typeof tool.description === "string" ? tool.description : undefined,
 186:       parameters: tool.input_schema,
 187:     },
 188:   };
 189: }
 190: 
 191: function translateTools(tools?: readonly unknown[]): readonly unknown[] | undefined {
 192:   if (!tools || !Array.isArray(tools)) {
 193:     return undefined;
 194:   }
 195:   return tools.map(translateSingleTool);
 196: }
 197: 
 198: function translateToolChoice(choice: unknown): unknown {
 199:   if (typeof choice === "string") {
 200:     return choice;
 201:   }
 202:   if (typeof choice !== "object" || choice === null) {
 203:     return choice;
 204:   }
 205:   const c = choice as Record<string, unknown>;
 206:   if (c.type === "auto") return "auto";
 207:   if (c.type === "any") return "required";
 208:   if (c.type === "none") return "none";
 209:   if (c.type === "tool" && typeof c.name === "string") {
 210:     return { type: "function", function: { name: c.name } };
 211:   }
 212:   return choice;
 213: }
 214: 
 215: export function validateAnthropicPayload(payload: AnthropicMessagesRequest): string | null {
 216:   if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
 217:     return "messages must be a non-empty array";
 218:   }
 219:   for (const msg of payload.messages) {
 220:     if (Array.isArray(msg.content)) {
 221:       for (const block of msg.content) {
 222:         if (block && typeof block === "object" && block.type === "document") {
 223:           return "Document content blocks (PDF/binary) are not supported by OpenAI-compatible endpoints.";
 224:         }
 225:       }
 226:     }
 227:   }
 228:   return null;
 229: }
 230: 
 231: function translateAssistantToolBlock(
 232:   block: AnthropicContentBlock
 233: ): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
 234:   if (block.type !== "tool_use" || !block.name) {
 235:     return null;
 236:   }
 237:   const callId = block.id || `call_${Math.random().toString(36).slice(2, 10)}`;
 238:   const args = typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
 239:   return {
 240:     id: callId,
 241:     type: "function",
 242:     function: {
 243:       name: block.name,
 244:       arguments: args,
 245:     },
 246:   };
 247: }
 248: 
 249: function translateAssistantMessage(msg: AnthropicMessage): OpenAIMessage {
 250:   if (typeof msg.content === "string") {
 251:     return { role: "assistant", content: msg.content } as OpenAIMessage;
 252:   }
 253:   if (!Array.isArray(msg.content)) {
 254:     return { role: "assistant", content: null } as OpenAIMessage;
 255:   }
 256: 
 257:   let textContent = "";
 258:   let reasoningContent = "";
 259:   const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
 260: 
 261:   for (const block of msg.content) {
 262:     if (block.type === "thinking") {
 263:       reasoningContent += (block.thinking || block.text || "");
 264:     } else if (block.type === "text" && block.text) {
 265:       textContent += block.text;
 266:     }
 267:     const tc = translateAssistantToolBlock(block);
 268:     if (tc) {
 269:       toolCalls.push(tc);
 270:     }
 271:   }
 272: 
 273:   const result: Record<string, unknown> = {
 274:     role: "assistant",
 275:     content: textContent.length > 0 ? textContent : null,
 276:   };
 277:   if (reasoningContent.length > 0) {
 278:     result.reasoning_content = reasoningContent;
 279:   }
 280:   if (toolCalls.length > 0) {
 281:     result.tool_calls = toolCalls;
 282:   }
 283:   return result as unknown as OpenAIMessage;
 284: }
 285: 
 286: function formatToolResultContent(content: unknown, isError?: boolean): string {
 287:   let resultText = "";
 288:   if (typeof content === "string") {
 289:     resultText = content;
 290:   } else if (Array.isArray(content)) {
 291:     resultText = content
 292:       .map((b: unknown) => {
 293:         if (typeof b === "object" && b !== null && "text" in b && typeof (b as { text: unknown }).text === "string") {
 294:           return (b as { text: string }).text;
 295:         }
 296:         return typeof b === "string" ? b : JSON.stringify(b);
 297:       })
 298:       .join("\n");
 299:   } else if (content !== undefined && content !== null) {
 300:     resultText = JSON.stringify(content);
 301:   }
 302:   return isError ? `Error: ${resultText}` : resultText;
 303: }
 304: 
 305: function translateUserContentBlock(block: AnthropicContentBlock): unknown | null {
 306:   if (block.type === "text" && block.text) {
 307:     return { type: "text", text: block.text };
 308:   }
 309:   if (block.type === "image" && block.source) {
 310:     if (block.source.type === "base64" && block.source.data) {
 311:       const mediaType = block.source.media_type || "image/jpeg";
 312:       return {
 313:         type: "image_url",
 314:         image_url: { url: `data:${mediaType};base64,${block.source.data}` },
 315:       };
 316:     }
 317:     if (block.source.type === "url" && block.source.url) {
 318:       return {
 319:         type: "image_url",
 320:         image_url: { url: block.source.url },
 321:       };
 322:     }
 323:   }
 324:   return null;
 325: }
 326: 
 327: function translateUserMessage(msg: AnthropicMessage, outMessages: OpenAIMessage[]): void {
 328:   if (typeof msg.content === "string") {
 329:     outMessages.push({ role: "user", content: msg.content } as OpenAIMessage);
 330:     return;
 331:   }
 332:   if (!Array.isArray(msg.content)) {
 333:     return;
 334:   }
 335: 
 336:   const userParts: unknown[] = [];
 337:   for (const block of msg.content) {
 338:     if (block.type === "tool_result") {
 339:       const resultText = formatToolResultContent(block.content, block.is_error);
 340:       outMessages.push({
 341:         role: "tool",
 342:         tool_call_id: block.tool_use_id ?? block.id ?? "call_unknown",
 343:         content: resultText,
 344:       } as unknown as OpenAIMessage);
 345:     } else {
 346:       const part = translateUserContentBlock(block);
 347:       if (part) {
 348:         userParts.push(part);
 349:       }
 350:     }
 351:   }
 352: 
 353:   if (userParts.length === 1 && typeof (userParts[0] as { type?: string; text?: string }).text === "string" && (userParts[0] as { type?: string }).type === "text") {
 354:     outMessages.push({ role: "user", content: (userParts[0] as { text: string }).text } as OpenAIMessage);
 355:   } else if (userParts.length > 0) {
 356:     outMessages.push({ role: "user", content: userParts } as unknown as OpenAIMessage);
 357:   }
 358: }
 359: 
 360: const ALLOWED_OPENAI_KEYS = new Set([
 361:   "model",
 362:   "messages",
 363:   "stream",
 364:   "stream_options",
 365:   "max_tokens",
 366:   "max_completion_tokens",
 367:   "temperature",
 368:   "top_p",
 369:   "stop",
 370:   "tools",
 371:   "tool_choice",
 372:   "parallel_tool_calls",
 373:   "user",
 374:   "metadata",
 375:   "response_format",
 376:   "seed",
 377: ]);
 378: 
 379: export function translateAnthropicToOpenAI(req: AnthropicMessagesRequest): OpenAIRequestPayload {
 380:   const openAiMessages: OpenAIMessage[] = [];
 381:   const systemText = extractSystemString(req.system);
 382: 
 383:   if (systemText) {
 384:     openAiMessages.push({ role: "system", content: systemText });
 385:   }
 386: 
 387:   if (Array.isArray(req.messages)) {
 388:     for (const msg of req.messages) {
 389:       if (msg.role === "assistant") {
 390:         openAiMessages.push(translateAssistantMessage(msg));
 391:       } else if (msg.role === "user") {
 392:         translateUserMessage(msg, openAiMessages);
 393:       }
 394:     }
 395:   }
 396: 
 397:   const result: Record<string, unknown> = {
 398:     model: req.model,
 399:     messages: openAiMessages,
 400:     stream: req.stream,
 401:   };
 402: 
 403:   if (req.stream_options !== undefined) {
 404:     result.stream_options = req.stream_options;
 405:   }
 406: 
 407:   const env = getEnv();
 408:   const minAoMaxTokens = env.LITEROUTER_AO_MAX_TOKENS ?? 32768;
 409:   if (minAoMaxTokens > 0) {
 410:     result.max_tokens = req.max_tokens !== undefined ? Math.max(req.max_tokens, minAoMaxTokens) : minAoMaxTokens;
 411:   } else if (req.max_tokens !== undefined) {
 412:     result.max_tokens = req.max_tokens;
 413:   }
 414:   if (req.temperature !== undefined) result.temperature = req.temperature;
 415:   if (req.top_p !== undefined) result.top_p = req.top_p;
 416:   if (req.stop_sequences !== undefined) result.stop = req.stop_sequences;
 417:   if (req.metadata !== undefined) result.metadata = req.metadata;
 418: 
 419:   const translatedTools = translateTools(req.tools);
 420:   if (translatedTools !== undefined) result.tools = translatedTools;
 421: 
 422:   if (req.tool_choice !== undefined) {
 423:     result.tool_choice = translateToolChoice(req.tool_choice);
 424:     if (typeof req.tool_choice === "object" && req.tool_choice !== null) {
 425:       const tc = req.tool_choice as Record<string, unknown>;
 426:       if (tc.disable_parallel_tool_use) {
 427:         result.parallel_tool_calls = false;
 428:       }
 429:     }
 430:   }
 431: 
 432:   for (const [key, value] of Object.entries(req)) {
 433:     if (ALLOWED_OPENAI_KEYS.has(key) && result[key] === undefined && value !== undefined) {
 434:       result[key] = value;
 435:     }
 436:   }
 437: 
 438:   return result as unknown as OpenAIRequestPayload;
 439: }
 440: 
 441: export function translateOpenAIToAnthropicResponse(
 442:   openAiRes: Record<string, unknown>,
 443:   model: string
 444: ): Record<string, unknown> {
 445:   const choices = (openAiRes.choices as Array<{
 446:     message?: {
 447:       content?: string | Array<{ type?: string; text?: string }> | null;
 448:       reasoning_content?: string | null;
 449:       reasoning?: string | null;
 450:       tool_calls?: Array<{
 451:         id?: string;
 452:         type?: string;
 453:         function?: { name?: string; arguments?: string };
 454:       }>;
 455:     };
 456:     finish_reason?: string;
 457:   }>) || [];
 458: 
 459:   const firstChoice = choices[0];
 460:   const msg = firstChoice?.message;
 461:   const contentBlocks: AnthropicContentBlock[] = [];
 462: 
 463:   const reasoning = msg?.reasoning_content || msg?.reasoning;
 464:   if (typeof reasoning === "string" && reasoning.length > 0) {
 465:     const cleaned = stripLeakedTemplateTags(reasoning);
 466:     if (cleaned.length > 0) {
 467:       contentBlocks.push({ type: "thinking", thinking: cleaned } as AnthropicContentBlock);
 468:     }
 469:   }
 470: 
 471:   let textContent = "";
 472:   if (typeof msg?.content === "string") {
 473:     textContent = stripLeakedTemplateTags(msg.content);
 474:   } else if (Array.isArray(msg?.content)) {
 475:     textContent = stripLeakedTemplateTags(
 476:       msg.content
 477:         .filter((p) => p?.type === "text" && typeof p.text === "string")
 478:         .map((p) => p.text)
 479:         .join("")
 480:     );
 481:   }
 482: 
 483:   if (textContent.length > 0) {
 484:     contentBlocks.push({ type: "text", text: textContent });
 485:   }
 486: 
 487:   if (Array.isArray(msg?.tool_calls)) {
 488:     for (const tc of msg.tool_calls) {
 489:       if (tc.function?.name) {
 490:         let parsedInput: unknown = {};
 491:         if (tc.function.arguments) {
 492:           try {
 493:             parsedInput = JSON.parse(tc.function.arguments);
 494:           } catch {
 495:             parsedInput = { raw: tc.function.arguments };
 496:           }
 497:         }
 498:         contentBlocks.push({
 499:           type: "tool_use",
 500:           id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
 501:           name: tc.function.name,
 502:           input: parsedInput,
 503:         });
 504:       }
 505:     }
 506:   }
 507: 
 508:   if (contentBlocks.length === 0) {
 509:     contentBlocks.push({ type: "text", text: "" });
 510:   }
 511: 
 512:   const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
 513:   const stopReason = mapOpenAIToAnthropicStopReason(firstChoice?.finish_reason, hasToolUse);
 514: 
 515:   return {
 516:     id: (openAiRes.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`,
 517:     type: "message",
 518:     role: "assistant",
 519:     content: contentBlocks,
 520:     model,
 521:     stop_reason: stopReason,
 522:     stop_sequence: null,
 523:     usage: mapOpenAIToAnthropicUsage(openAiRes.usage),
 524:   };
 525: }
 526: 
 527: interface ActiveToolInfo {
 528:   readonly blockIndex: number;
 529:   readonly id: string;
 530:   readonly name: string;
 531: }
 532: 
 533: interface StreamTransformState {
 534:   msgStartSent: boolean;
 535:   currentBlockIndex: number;
 536:   currentBlockType: "text" | "thinking" | "tool_use" | null;
 537:   messageDeltaSent: boolean;
 538:   accumulatedInputTokens: number;
 539:   accumulatedOutputTokens: number;
 540:   readonly activeToolMap: Map<number, ActiveToolInfo>;
 541:   readonly openBlockIndices: Set<number>;
 542:   pendingStopReason: string | null;
 543:   readonly thinkingSanitizer: TagSanitizerStreamBuffer;
 544:   readonly textSanitizer: TagSanitizerStreamBuffer;
 545: }
 546: 
 547: function sseEvent(encoder: TextEncoder, event: string, data: unknown): Uint8Array {
 548:   return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
 549: }
 550: 
 551: function handleNativeAnthropicPassThrough(
 552:   rawData: string,
 553:   parsed: Record<string, unknown>,
 554:   controller: TransformStreamDefaultController<Uint8Array>,
 555:   encoder: TextEncoder
 556: ): boolean {
 557:   if (
 558:     typeof parsed.type === "string" &&
 559:     (parsed.type.startsWith("message_") || parsed.type.startsWith("content_block_") || parsed.type === "ping")
 560:   ) {
 561:     controller.enqueue(encoder.encode(`event: ${parsed.type}\ndata: ${rawData}\n\n`));
 562:     return true;
 563:   }
 564:   return false;
 565: }
 566: 
 567: function ensureMessageStart(
 568:   parsed: Record<string, unknown>,
 569:   model: string,
 570:   state: StreamTransformState,
 571:   controller: TransformStreamDefaultController<Uint8Array>,
 572:   encoder: TextEncoder
 573: ): void {
 574:   if (!state.msgStartSent) {
 575:     state.msgStartSent = true;
 576:     const msgId = (parsed.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`;
 577:     controller.enqueue(
 578:       sseEvent(encoder, "message_start", {
 579:         type: "message_start",
 580:         message: {
 581:           id: msgId,
 582:           type: "message",
 583:           role: "assistant",
 584:           content: [],
 585:           model,
 586:           stop_reason: null,
 587:           stop_sequence: null,
 588:           usage: {
 589:             input_tokens: state.accumulatedInputTokens,
 590:             output_tokens: 0,
 591:           },
 592:         },
 593:       })
 594:     );
 595:   }
 596: }
 597: 
 598: function closeAllOpenBlocks(
 599:   state: StreamTransformState,
 600:   controller: TransformStreamDefaultController<Uint8Array>,
 601:   encoder: TextEncoder
 602: ): void {
 603:   for (const index of state.openBlockIndices) {
 604:     controller.enqueue(
 605:       sseEvent(encoder, "content_block_stop", {
 606:         type: "content_block_stop",
 607:         index,
 608:       })
 609:     );
 610:   }
 611:   state.openBlockIndices.clear();
 612:   state.currentBlockType = null;
 613: }
 614: 
 615: function closeCurrentBlock(
 616:   state: StreamTransformState,
 617:   controller: TransformStreamDefaultController<Uint8Array>,
 618:   encoder: TextEncoder
 619: ): void {
 620:   if (state.currentBlockType !== null && state.openBlockIndices.has(state.currentBlockIndex)) {
 621:     if (state.currentBlockType === "thinking") {
 622:       const trailing = state.thinkingSanitizer.flush();
 623:       if (trailing.length > 0) {
 624:         controller.enqueue(
 625:           sseEvent(encoder, "content_block_delta", {
 626:             type: "content_block_delta",
 627:             index: state.currentBlockIndex,
 628:             delta: { type: "thinking_delta", thinking: trailing },
 629:           })
 630:         );
 631:       }
 632:     } else if (state.currentBlockType === "text") {
 633:       const trailing = state.textSanitizer.flush();
 634:       if (trailing.length > 0) {
 635:         controller.enqueue(
 636:           sseEvent(encoder, "content_block_delta", {
 637:             type: "content_block_delta",
 638:             index: state.currentBlockIndex,
 639:             delta: { type: "text_delta", text: trailing },
 640:           })
 641:         );
 642:       }
 643:     }
 644:     controller.enqueue(
 645:       sseEvent(encoder, "content_block_stop", {
 646:         type: "content_block_stop",
 647:         index: state.currentBlockIndex,
 648:       })
 649:     );
 650:     state.openBlockIndices.delete(state.currentBlockIndex);
 651:     state.currentBlockType = null;
 652:   }
 653: }
 654: 
 655: function processReasoningDelta(
 656:   reasoningDelta: string,
 657:   state: StreamTransformState,
 658:   controller: TransformStreamDefaultController<Uint8Array>,
 659:   encoder: TextEncoder
 660: ): void {
 661:   const sanitized = state.thinkingSanitizer.process(reasoningDelta);
 662:   if (!sanitized) {
 663:     return;
 664:   }
 665:   if (state.currentBlockType !== "thinking") {
 666:     closeCurrentBlock(state, controller, encoder);
 667:     state.currentBlockIndex++;
 668:     state.currentBlockType = "thinking";
 669:     state.openBlockIndices.add(state.currentBlockIndex);
 670:     controller.enqueue(
 671:       sseEvent(encoder, "content_block_start", {
 672:         type: "content_block_start",
 673:         index: state.currentBlockIndex,
 674:         content_block: { type: "thinking", thinking: "" },
 675:       })
 676:     );
 677:   }
 678:   controller.enqueue(
 679:     sseEvent(encoder, "content_block_delta", {
 680:       type: "content_block_delta",
 681:       index: state.currentBlockIndex,
 682:       delta: { type: "thinking_delta", thinking: sanitized },
 683:     })
 684:   );
 685: }
 686: 
 687: function processTextDelta(
 688:   textDelta: string,
 689:   state: StreamTransformState,
 690:   controller: TransformStreamDefaultController<Uint8Array>,
 691:   encoder: TextEncoder
 692: ): void {
 693:   const sanitized = state.textSanitizer.process(textDelta);
 694:   if (!sanitized) {
 695:     return;
 696:   }
 697:   if (state.currentBlockType !== "text") {
 698:     closeCurrentBlock(state, controller, encoder);
 699:     state.currentBlockIndex++;
 700:     state.currentBlockType = "text";
 701:     state.openBlockIndices.add(state.currentBlockIndex);
 702:     controller.enqueue(
 703:       sseEvent(encoder, "content_block_start", {
 704:         type: "content_block_start",
 705:         index: state.currentBlockIndex,
 706:         content_block: { type: "text", text: "" },
 707:       })
 708:     );
 709:   }
 710:   controller.enqueue(
 711:     sseEvent(encoder, "content_block_delta", {
 712:       type: "content_block_delta",
 713:       index: state.currentBlockIndex,
 714:       delta: { type: "text_delta", text: sanitized },
 715:     })
 716:   );
 717: }
 718: 
 719: function processToolCallsDelta(
 720:   toolCalls: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>,
 721:   state: StreamTransformState,
 722:   controller: TransformStreamDefaultController<Uint8Array>,
 723:   encoder: TextEncoder
 724: ): void {
 725:   for (const tc of toolCalls) {
 726:     const tcIdx = typeof tc.index === "number" ? tc.index : 0;
 727:     let toolInfo = state.activeToolMap.get(tcIdx);
 728: 
 729:     if (!toolInfo && (tc.id || tc.function?.name)) {
 730:       closeCurrentBlock(state, controller, encoder);
 731:       state.currentBlockIndex++;
 732:       state.currentBlockType = "tool_use";
 733:       state.openBlockIndices.add(state.currentBlockIndex);
 734:       const toolId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
 735:       const toolName = tc.function?.name || "tool";
 736:       toolInfo = { blockIndex: state.currentBlockIndex, id: toolId, name: toolName };
 737:       state.activeToolMap.set(tcIdx, toolInfo);
 738: 
 739:       controller.enqueue(
 740:         sseEvent(encoder, "content_block_start", {
 741:           type: "content_block_start",
 742:           index: state.currentBlockIndex,
 743:           content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
 744:         })
 745:       );
 746:     }
 747: 
 748:     if (tc.function?.arguments && toolInfo) {
 749:       controller.enqueue(
 750:         sseEvent(encoder, "content_block_delta", {
 751:           type: "content_block_delta",
 752:           index: toolInfo.blockIndex,
 753:           delta: { type: "input_json_delta", partial_json: tc.function.arguments },
 754:         })
 755:       );
 756:     }
 757:   }
 758: }
 759: 
 760: export function createAnthropicStreamTransformer(model: string): TransformStream<Uint8Array, Uint8Array> {
 761:   const decoder = new TextDecoder();
 762:   const encoder = new TextEncoder();
 763:   const state: StreamTransformState = {
 764:     msgStartSent: false,
 765:     currentBlockIndex: -1,
 766:     currentBlockType: null,
 767:     messageDeltaSent: false,
 768:     accumulatedInputTokens: 0,
 769:     accumulatedOutputTokens: 0,
 770:     activeToolMap: new Map<number, ActiveToolInfo>(),
 771:     openBlockIndices: new Set<number>(),
 772:     pendingStopReason: null,
 773:     thinkingSanitizer: new TagSanitizerStreamBuffer(),
 774:     textSanitizer: new TagSanitizerStreamBuffer(),
 775:   };
 776:   let buffer = "";
 777: 
 778:   const processLine = (rawLine: string, controller: TransformStreamDefaultController<Uint8Array>) => {
 779:     const line = rawLine.trim();
 780:     if (!line || line.startsWith(":")) {
 781:       return;
 782:     }
 783:     const dataMatch = line.match(/^data:\s*(.*)$/);
 784:     if (!dataMatch || dataMatch[1] === undefined) {
 785:       return;
 786:     }
 787:     const rawData = dataMatch[1].trim();
 788:     if (!rawData || rawData === "[DONE]") {
 789:       return;
 790:     }
 791: 
 792:     let parsed: Record<string, unknown>;
 793:     try {
 794:       parsed = JSON.parse(rawData) as Record<string, unknown>;
 795:     } catch {
 796:       return;
 797:     }
 798: 
 799:     if (parsed.error && typeof parsed.error === "object") {
 800:       const errObj = parsed.error as Record<string, unknown>;
 801:       const errMsg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
 802:       const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
 803:       controller.enqueue(
 804:         sseEvent(encoder, "error", {
 805:           type: "error",
 806:           error: {
 807:             type: errType,
 808:             message: errMsg,
 809:           },
 810:         })
 811:       );
 812:       return;
 813:     }
 814: 
 815:     if (handleNativeAnthropicPassThrough(rawData, parsed, controller, encoder)) {
 816:       return;
 817:     }
 818: 
 819:     if (parsed.usage && typeof parsed.usage === "object") {
 820:       const u = parsed.usage as Record<string, unknown>;
 821:       if (typeof u.prompt_tokens === "number") state.accumulatedInputTokens = u.prompt_tokens;
 822:       if (typeof u.completion_tokens === "number") state.accumulatedOutputTokens = u.completion_tokens;
 823:     }
 824: 
 825:     ensureMessageStart(parsed, model, state, controller, encoder);
 826: 
 827:     const choices = parsed.choices as Array<{
 828:       delta?: {
 829:         content?: string | null;
 830:         reasoning_content?: string | null;
 831:         reasoning?: string | null;
 832:         tool_calls?: Array<{
 833:           index?: number;
 834:           id?: string;
 835:           type?: string;
 836:           function?: { name?: string; arguments?: string };
 837:         }>;
 838:       };
 839:       finish_reason?: string | null;
 840:     }> | undefined;
 841: 
 842:     const choice = choices?.[0];
 843:     if (!choice) {
 844:       if (state.pendingStopReason && !state.messageDeltaSent && parsed.usage) {
 845:         state.messageDeltaSent = true;
 846:         controller.enqueue(
 847:           sseEvent(encoder, "message_delta", {
 848:             type: "message_delta",
 849:             delta: { stop_reason: state.pendingStopReason, stop_sequence: null },
 850:             usage: { output_tokens: state.accumulatedOutputTokens },
 851:           })
 852:         );
 853:       }
 854:       return;
 855:     }
 856: 
 857:     const reasoningDelta = choice.delta?.reasoning_content || choice.delta?.reasoning;
 858:     if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
 859:       processReasoningDelta(reasoningDelta, state, controller, encoder);
 860:     }
 861: 
 862:     if (choice.delta?.content) {
 863:       processTextDelta(choice.delta.content, state, controller, encoder);
 864:     }
 865: 
 866:     if (Array.isArray(choice.delta?.tool_calls)) {
 867:       processToolCallsDelta(choice.delta.tool_calls, state, controller, encoder);
 868:     }
 869: 
 870:     if (choice.finish_reason) {
 871:       closeAllOpenBlocks(state, controller, encoder);
 872:       state.pendingStopReason = mapOpenAIToAnthropicStopReason(choice.finish_reason, state.activeToolMap.size > 0);
 873:     }
 874:   };
 875: 
 876:   return new TransformStream<Uint8Array, Uint8Array>({
 877:     transform(chunk, controller) {
 878:       buffer += decoder.decode(chunk, { stream: true });
 879:       buffer = buffer.replace(/\r\n/g, "\n");
 880:       const lines = buffer.split("\n");
 881:       buffer = lines.pop() ?? "";
 882: 
 883:       for (const line of lines) {
 884:         processLine(line, controller);
 885:       }
 886:     },
 887:     flush(controller) {
 888:       if (buffer.length > 0) {
 889:         processLine(buffer, controller);
 890:       }
 891:       closeAllOpenBlocks(state, controller, encoder);
 892:       if (!state.messageDeltaSent) {
 893:         state.messageDeltaSent = true;
 894:         const finalStopReason = state.pendingStopReason || "end_turn";
 895:         controller.enqueue(
 896:           sseEvent(encoder, "message_delta", {
 897:             type: "message_delta",
 898:             delta: { stop_reason: finalStopReason, stop_sequence: null },
 899:             usage: { output_tokens: state.accumulatedOutputTokens },
 900:           })
 901:         );
 902:       }
 903:       controller.enqueue(sseEvent(encoder, "message_stop", { type: "message_stop" }));
 904:     },
 905:   });
 906: }
 907: 
 908: async function handleStreamingResult(
 909:   openAiRes: Response,
 910:   model: string
 911: ): Promise<Response> {
 912:   if (!openAiRes.body) {
 913:     return openAiRes;
 914:   }
 915:   const transformedStream = openAiRes.body.pipeThrough(createAnthropicStreamTransformer(model));
 916:   return new Response(transformedStream, {
 917:     status: openAiRes.status,
 918:     headers: {
 919:       "Content-Type": "text/event-stream",
 920:       "Cache-Control": "no-cache",
 921:       Connection: "keep-alive",
 922:     },
 923:   });
 924: }
 925: 
 926: async function parseAnthropicRequest(req: Request): Promise<AnthropicMessagesRequest | null> {
 927:   try {
 928:     return (await req.json()) as AnthropicMessagesRequest;
 929:   } catch {
 930:     return null;
 931:   }
 932: }
 933: 
 934: async function handleNonStreamingResult(
 935:   openAiRes: Response,
 936:   model: string
 937: ): Promise<Response> {
 938:   if (!openAiRes.ok) {
 939:     return openAiRes;
 940:   }
 941:   const json = (await openAiRes.json()) as Record<string, unknown>;
 942:   const translated = translateOpenAIToAnthropicResponse(json, model);
 943:   return Response.json(translated, { status: 200 });
 944: }
 945: 
 946: async function collectFullBody(
 947:   firstChunk: Uint8Array,
 948:   rawReader: ReadableStreamDefaultReader<Uint8Array>
 949: ): Promise<Uint8Array> {
 950:   const chunks: Uint8Array[] = [firstChunk];
 951:   let totalLength = firstChunk.length;
 952: 
 953:   while (true) {
 954:     const { done, value } = await rawReader.read();
 955:     if (done) break;
 956:     if (value) {
 957:       chunks.push(value);
 958:       totalLength += value.length;
 959:     }
 960:   }
 961: 
 962:   const result = new Uint8Array(totalLength);
 963:   let offset = 0;
 964:   for (const chunk of chunks) {
 965:     result.set(chunk, offset);
 966:     offset += chunk.length;
 967:   }
 968:   return result;
 969: }
 970: 
 971: async function executeAnthropicDirectCall(
 972:   directive: DirectDirective,
 973:   payload: AnthropicMessagesRequest,
 974:   clientSignal: AbortSignal | undefined,
 975:   selected: SelectedKey,
 976:   reqId: string,
 977:   attempt: number,
 978:   maxAttempts: number,
 979:   clientHeaders?: Headers
 980: ): Promise<Response> {
 981:   const env = getEnv();
 982:   const quarantineEnabled = globalKeyPool.isQuarantineEnabled(directive.provider);
 983: 
 984:   const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, payload.model);
 985:   const headers = buildAuthHeaders(endpoint.authHeader, selected.key, directive.provider, clientHeaders);
 986: 
 987:   const startTime = Date.now();
 988:   const { response, ttftMs, firstChunk, rawReader, protocol } = await fetchWithTtftGuard({
 989:     url: endpoint.url,
 990:     method: "POST",
 991:     headers,
 992:     body: JSON.stringify(payload),
 993:     clientSignal,
 994:     provider: directive.provider,
 995:     keyIndex: selected.index,
 996:     model: payload.model,
 997:   });
 998:   const duration = Date.now() - startTime;
 999:   const isStream = Boolean(payload.stream);
1000: 
1001:   if (response.status >= 400) {
1002:     const fullBody = await collectFullBody(firstChunk, rawReader);
1003:     const bodyText = new TextDecoder().decode(fullBody);
1004: 
1005:     if (response.status === 401 || response.status === 403) {
1006:       logWarn(
1007:         EMOJI.zap,
1008:         `[${directive.provider.toUpperCase()} ${reqId}] Fatal auth error ${response.status}: failing fast and loud without retry.`
1009:       );
1010:       try {
1011:         if (quarantineEnabled) {
1012:           globalKeyPool.reportFailure(directive.provider, selected.index, response.status, response.headers, bodyText);
1013:         }
1014:       } catch (err: unknown) {
1015:         if (isFatalAuthError(err)) {
1016:           logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Auth failure confirmed fatal: ${err.message}`);
1017:         } else {
1018:           throw err;
1019:         }
1020:       }
1021:       logServed(reqId, duration, response.status, attempt, maxAttempts);
1022:       logSeparator();
1023: 
1024:       return new Response(fullBody.buffer as ArrayBuffer, {
1025:         status: response.status,
1026:         headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
1027:       });
1028:     }
1029: 
1030:     const classification = classifyUpstreamError({
1031:       provider: directive.provider,
1032:       status: response.status,
1033:       headers: response.headers,
1034:       bodyText,
1035:     });
1036: 
1037:     try {
1038:       if (quarantineEnabled && classification.quarantineTtlSec > 0) {
1039:         globalKeyPool.reportFailure(
1040:           directive.provider,
1041:           selected.index,
1042:           response.status,
1043:           response.headers,
1044:           bodyText,
1045:           Date.now(),
1046:           classification.quarantineTtlSec
1047:         );
1048:       } else if (!quarantineEnabled && classification.quarantineTtlSec > 0) {
1049:         logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode (${directive.provider.toUpperCase()}_ENABLE_QUARANTINE=false): Key ${selected.index} quarantine bypassed.`);
1050:       }
1051:     } catch (err: unknown) {
1052:       if (isFatalAuthError(err)) {
1053:         logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Auth failure confirmed fatal: ${err.message}`);
1054:         return new Response(fullBody.buffer as ArrayBuffer, {
1055:           status: response.status,
1056:           headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
1057:         });
1058:       }
1059:       throw err;
1060:     }
1061: 
1062:     const rawErrorMsg = extractErrorMessage(bodyText);
1063:     const ttlSec = !quarantineEnabled || classification.quarantineTtlSec === 0
1064:       ? undefined
1065:       : classification.quarantineTtlSec;
1066:     logLimit(reqId, directive.provider, selected.index, response.status, ttlSec, selected.totalKeys, rawErrorMsg);
1067: 
1068:     if (isContextLengthError(response.status, bodyText) && !clientSignal?.aborted) {
1069:       const detectedLimit = extractContextLimit(bodyText);
1070:       const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
1071:       const pruned = pruneAnthropicPayload(payload, targetLimit);
1072:       if (pruned.messages.length < payload.messages.length || estimateAnthropicTokens(pruned) < estimateAnthropicTokens(payload)) {
1073:         logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
1074:         return executeAnthropicDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts, clientHeaders);
1075:       }
1076:     }
1077: 
1078:     const canRetry = classification.action === "retry_rotate" && attempt < maxAttempts && !clientSignal?.aborted;
1079:     if (canRetry) {
1080:       throw new UpstreamRetryableError(
1081:         `Upstream error ${response.status}: ${classification.reason}`,
1082:         response.status,
1083:         classification
1084:       );
1085:     }
1086: 
1087:     logServed(reqId, duration, response.status, attempt, maxAttempts);
1088:     logSeparator();
1089: 
1090:     return new Response(fullBody.buffer as ArrayBuffer, {
1091:       status: response.status,
1092:       headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
1093:     });
1094:   }
1095: 
1096:   if (!isStream) {
1097:     const fullBody = await collectFullBody(firstChunk, rawReader);
1098:     let isErrorPayload = false;
1099:     let errorStatus = response.status >= 400 ? response.status : 400;
1100:     let errorMessage = "";
1101:     let errorType = "invalid_request_error";
1102: 
1103:     try {
1104:       const decoded = new TextDecoder().decode(fullBody);
1105:       const json = JSON.parse(decoded) as Record<string, unknown>;
1106: 
1107:       if (json.type === "error" || json.error) {
1108:         isErrorPayload = true;
1109:         if (json.error && typeof json.error === "object") {
1110:           const errObj = json.error as Record<string, unknown>;
1111:           errorMessage = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
1112:           if (errObj.type === "rate_limit_error" || errObj.error_type === "rate_limit") {
1113:             errorStatus = 429;
1114:             errorType = "rate_limit_error";
1115:           } else if (errObj.type === "overloaded_error") {
1116:             errorStatus = 529;
1117:             errorType = "overloaded_error";
1118:           } else if (errObj.type === "authentication_error") {
1119:             errorStatus = 401;
1120:             errorType = "authentication_error";
1121:           } else if (errObj.type === "permission_error") {
1122:             errorStatus = 403;
1123:             errorType = "permission_error";
1124:           } else if (errObj.type === "not_found_error") {
1125:             errorStatus = 404;
1126:             errorType = "not_found_error";
1127:           } else if (errObj.type === "api_error") {
1128:             errorStatus = 500;
1129:             errorType = "api_error";
1130:           } else {
1131:             errorStatus = 400;
1132:             errorType = typeof errObj.type === "string" ? errObj.type : "invalid_request_error";
1133:           }
1134:         } else if (typeof json.error === "string") {
1135:           errorMessage = json.error;
1136:           errorStatus = 400;
1137:           errorType = "invalid_request_error";
1138:         }
1139:       }
1140: 
1141:       if (!isErrorPayload) {
1142:         globalKeyPool.reportSuccess(directive.provider, selected.index);
1143:         logTtft(reqId, ttftMs, "First chunk streamed downstream", protocol);
1144: 
1145:         if (json.usage && typeof json.usage === "object") {
1146:           const u = json.usage as Record<string, unknown>;
1147:           const promptTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
1148:           const completionTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
1149:           const totalTokens = promptTokens + completionTokens;
1150:           let reasoningTokens: number | undefined;
1151:           if (u.output_tokens_details && typeof u.output_tokens_details === "object") {
1152:             const details = u.output_tokens_details as Record<string, unknown>;
1153:             if (typeof details.thinking_tokens === "number") {
1154:               reasoningTokens = details.thinking_tokens;
1155:             }
1156:           }
1157:           logUsage({
1158:             reqId,
1159:             provider: directive.provider,
1160:             keyIndex: selected.index,
1161:             totalKeys: selected.totalKeys,
1162:             promptTokens,
1163:             reasoningTokens,
1164:             completionTokens,
1165:             totalTokens,
1166:             durationMs: duration,
1167:           });
1168:         }
1169:       }
1170:     } catch (parseErr) {
1171:       void parseErr;
1172:     }
1173: 
1174:     if (isErrorPayload) {
1175:       if (isContextLengthError(errorStatus, errorMessage) && !clientSignal?.aborted) {
1176:         const detectedLimit = extractContextLimit(errorMessage);
1177:         const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
1178:         const pruned = pruneAnthropicPayload(payload, targetLimit);
1179:         if (pruned.messages.length < payload.messages.length || estimateAnthropicTokens(pruned) < estimateAnthropicTokens(payload)) {
1180:           logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
1181:           return executeAnthropicDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts, clientHeaders);
1182:         }
1183:       }
1184: 
1185:       logError(reqId, `Direct Anthropic non-streaming error [HTTP ${errorStatus}]: ${errorMessage}`);
1186:       logServed(reqId, duration, errorStatus, attempt, maxAttempts);
1187:       logSeparator();
1188:       return createAnthropicErrorResponse(errorStatus, errorMessage, errorType);
1189:     }
1190: 
1191:     logServed(reqId, duration, response.status, attempt, maxAttempts);
1192:     logSeparator();
1193: 
1194:     return new Response(fullBody.buffer as ArrayBuffer, {
1195:       status: response.status,
1196:       headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
1197:     });
1198:   }
1199: 
1200:   globalKeyPool.reportSuccess(directive.provider, selected.index);
1201:   logTtft(reqId, ttftMs, "Stream established", protocol);
1202: 
1203:   let currentKeyIndex = selected.index;
1204:   let currentAttempt = attempt;
1205: 
1206:   const resilientStream = createResilientStream(firstChunk, rawReader, {
1207:     protocol: "anthropic",
1208:     onUsage: (u) => {
1209:       const streamDuration = Date.now() - startTime;
1210:       logUsage({
1211:         reqId,
1212:         provider: directive.provider,
1213:         keyIndex: currentKeyIndex,
1214:         totalKeys: selected.totalKeys,
1215:         promptTokens: u.promptTokens,
1216:         reasoningTokens: u.reasoningTokens,
1217:         completionTokens: u.completionTokens,
1218:         totalTokens: u.totalTokens,
1219:         durationMs: streamDuration,
1220:       });
1221:       logServed(reqId, streamDuration, response.status, currentAttempt, maxAttempts);
1222:       logSeparator();
1223:     },
1224:     retryProvider: async (reason: string, hasEmittedTokens?: boolean) => {
1225:       if (hasEmittedTokens) {
1226:         return null;
1227:       }
1228:       const classification = classifyTransportError(reason);
1229:       if (quarantineEnabled && classification.quarantineTtlSec > 0) {
1230:         globalKeyPool.reportFailure(directive.provider, currentKeyIndex, 500, undefined, reason, Date.now(), classification.quarantineTtlSec);
1231:       } else if (!quarantineEnabled && classification.quarantineTtlSec > 0) {
1232:         logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode (${directive.provider.toUpperCase()}_ENABLE_QUARANTINE=false): Key ${currentKeyIndex} quarantine bypassed.`);
1233:       }
1234:       logLimit(reqId, directive.provider, currentKeyIndex, 500, !quarantineEnabled || classification.quarantineTtlSec === 0 ? undefined : classification.quarantineTtlSec, selected.totalKeys, reason);
1235: 
1236:       while (currentAttempt < maxAttempts) {
1237:         currentAttempt++;
1238:         if (clientSignal?.aborted) {
1239:           return null;
1240:         }
1241:         const nextSelected = globalKeyPool.selectNextKey(directive.provider);
1242:         if (!nextSelected) {
1243:           return null;
1244:         }
1245:         logRotate(reqId, directive.provider, currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
1246:         currentKeyIndex = nextSelected.index;
1247: 
1248:         const nextHeaders = buildAuthHeaders(endpoint.authHeader, nextSelected.key, directive.provider, clientHeaders);
1249: 
1250:         if (env.LITEROUTER_PACER_ENABLED) {
1251:           const pacer = getPacerForProvider(directive.provider);
1252:           await pacer.acquire(clientSignal);
1253:         }
1254: 
1255:         try {
1256:           const nextResult = await fetchWithTtftGuard({
1257:             url: endpoint.url,
1258:             method: "POST",
1259:             headers: nextHeaders,
1260:             body: JSON.stringify(payload),
1261:             clientSignal,
1262:             provider: directive.provider,
1263:             keyIndex: nextSelected.index,
1264:             model: payload.model,
1265:           });
1266:           if (nextResult.response.status >= 400) {
1267:             if (nextResult.response.status === 401 || nextResult.response.status === 403) {
1268:               logWarn(
1269:                 EMOJI.zap,
1270:                 `[${directive.provider.toUpperCase()} ${reqId}] Fatal auth error ${nextResult.response.status}: rejecting immediately with zero retry.`
1271:               );
1272:               try {
1273:                 if (quarantineEnabled) {
1274:                   globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
1275:                 }
1276:               } catch (err: unknown) {
1277:                 if (isFatalAuthError(err)) {
1278:                   logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Auth failure confirmed fatal: ${err.message}`);
1279:                 } else {
1280:                   throw err;
1281:                 }
1282:               }
1283:               return null;
1284:             }
1285:             if (quarantineEnabled) {
1286:               globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
1287:             }
1288:             continue;
1289:           }
1290:           globalKeyPool.reportSuccess(directive.provider, nextSelected.index);
1291:           return {
1292:             firstChunk: nextResult.firstChunk,
1293:             rawReader: nextResult.rawReader,
1294:             reader: nextResult.rawReader,
1295:           };
1296:         } catch (fetchErr: unknown) {
1297:           if (isFatalAuthError(fetchErr)) {
1298:             logWarn(
1299:               EMOJI.zap,
1300:               `[${directive.provider.toUpperCase()} ${reqId}] Fatal auth error in resilient stream: rejecting immediately with zero retry.`
1301:             );
1302:             return null;
1303:           }
1304:           if (quarantineEnabled) {
1305:             globalKeyPool.reportFailure(directive.provider, nextSelected.index, 500);
1306:           }
1307:           continue;
1308:         }
1309:       }
1310:       return null;
1311:     },
1312:   });
1313: 
1314:   return new Response(resilientStream, {
1315:     status: response.status,
1316:     headers: {
1317:       "Content-Type": "text/event-stream",
1318:       "Cache-Control": "no-cache",
1319:       Connection: "keep-alive",
1320:     },
1321:   });
1322: }
1323: 
1324: async function executeAnthropicDirectLoop(
1325:   directive: DirectDirective,
1326:   payload: AnthropicMessagesRequest,
1327:   clientSignal: AbortSignal | undefined,
1328:   reqId: string,
1329:   clientHeaders?: Headers
1330: ): Promise<Response> {
1331:   const poolSize = globalKeyPool.getPoolSize(directive.provider);
1332:   const provConfig = getProviderConfig(directive.provider);
1333:   const maxAttempts = provConfig.request_retry.enabled
1334:     ? Math.min(provConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
1335:     : 1;
1336:   let lastError: unknown = null;
1337:   let prevKeyIndex = -1;
1338:   const startTime = Date.now();
1339:   const env = getEnv();
1340:   const maxWaitMs = env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS || 20000;
1341: 
1342:   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
1343:     const dwellMs = Date.now() - startTime;
1344:     if (globalKeyPool.shouldLoadShed(directive.provider, dwellMs, maxWaitMs)) {
1345:       const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
1346:       const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
1347:       return createAnthropicErrorResponse(
1348:         503,
1349:         `Provider '${directive.provider}' unavailable: all keys in cooldown exceed wait budget.`,
1350:         "api_error",
1351:         { "Retry-After": String(retryAfterSec) }
1352:       );
1353:     }
1354: 
1355:     const shouldPace =
1356:       isRegisteredProvider(directive.provider) &&
1357:       Boolean(getProviderConfig(directive.provider).pacer?.enabled);
1358:     if (shouldPace) {
1359:       try {
1360:         await acquireProviderPacer(directive.provider, clientSignal);
1361:       } catch (err: unknown) {
1362:         if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
1363:           return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
1364:         }
1365:         if (err instanceof PacerQueueOverflowError) {
1366:           return Response.json(
1367:             {
1368:               type: "error",
1369:               error: {
1370:                 type: "rate_limit_error",
1371:                 message: err.message,
1372:               },
1373:             },
1374:             {
1375:               status: 429,
1376:               headers: {
1377:                 "Retry-After": String(err.retryAfterSec),
1378:                 "Content-Type": "application/json",
1379:               },
1380:             }
1381:           );
1382:         }
1383:         throw err;
1384:       }
1385:     }
1386: 
1387:     const selected = await waitAndSelectKey(directive.provider, startTime, maxWaitMs, clientSignal);
1388:     if (!selected) {
1389:       if (clientSignal?.aborted) {
1390:         return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
1391:       }
1392:       const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
1393:       logExhausted(reqId, directive.provider, minTtl);
1394:       return createAnthropicErrorResponse(
1395:         429,
1396:         `All API keys for provider '${directive.provider}' are cooling down.`,
1397:         "rate_limit_error"
1398:       );
1399:     }
1400: 
1401:     if (attempt > 1) {
1402:       logRotate(reqId, directive.provider, prevKeyIndex, selected.index, selected.totalKeys, attempt, maxAttempts);
1403:     }
1404:     prevKeyIndex = selected.index;
1405: 
1406:     try {
1407:       return await executeAnthropicDirectCall(directive, payload, clientSignal, selected, reqId, attempt, maxAttempts, clientHeaders);
1408:     } catch (err: unknown) {
1409:       lastError = err;
1410:       if (isFatalAuthError(err)) {
1411:         logWarn(
1412:           EMOJI.zap,
1413:           `[${directive.provider.toUpperCase()} ${reqId}] Fatal auth error ${err.status}: failing fast and loud without retry.`
1414:         );
1415:         return createAnthropicErrorResponse(
1416:           err.status,
1417:           err.message,
1418:           "authentication_error"
1419:         );
1420:       }
1421:       if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
1422:         return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
1423:       }
1424:       if (err instanceof PacerQueueOverflowError) {
1425:         return Response.json(
1426:           {
1427:             type: "error",
1428:             error: {
1429:               type: "rate_limit_error",
1430:               message: err.message,
1431:             },
1432:           },
1433:           {
1434:             status: 429,
1435:             headers: {
1436:               "Retry-After": String(err.retryAfterSec),
1437:               "Content-Type": "application/json",
1438:             },
1439:           }
1440:         );
1441:       }
1442:       if (err instanceof UpstreamRetryableError) {
1443:         if (attempt < maxAttempts) {
1444:           const { min_ms, max_ms } = provConfig.request_retry.delay;
1445:           const delayMs = min_ms < max_ms
1446:             ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
1447:             : min_ms;
1448:           if (delayMs > 0) {
1449:             await Bun.sleep(delayMs);
1450:           }
1451:         }
1452:         continue;
1453:       }
1454:       if (err instanceof NoResponseError) {
1455:         if (globalKeyPool.isQuarantineEnabled(directive.provider)) {
1456:           globalKeyPool.reportFailure(directive.provider, selected.index, 0, undefined, err.message, Date.now(), 2);
1457:         }
1458:         if (attempt < maxAttempts) {
1459:           const { min_ms, max_ms } = provConfig.request_retry.delay;
1460:           const delayMs = min_ms < max_ms
1461:             ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
1462:             : min_ms;
1463:           if (delayMs > 0) {
1464:             await Bun.sleep(delayMs);
1465:           }
1466:         }
1467:         continue;
1468:       }
1469:       logError(reqId, "Direct request error", err);
1470:       break;
1471:     }
1472:   }
1473: 
1474:   const errMsg = lastError instanceof Error ? lastError.message : "All direct request attempts failed";
1475:   return createAnthropicErrorResponse(502, `Direct request attempts exhausted - ${errMsg}`, "api_error");
1476: }
1477: 
1478: export async function handleAnthropicCompat(
1479:   req: Request,
1480:   rawKey: string,
1481:   reqId: string
1482: ): Promise<Response> {
1483:   const validation = validateDirective(rawKey);
1484:   if (validation.valid === false) {
1485:     return createAnthropicErrorResponse(401, validation.error, "authentication_error");
1486:   }
1487: 
1488:   const directive = validation.directive;
1489:   const anthropicBody = await parseAnthropicRequest(req);
1490:   if (!anthropicBody) {
1491:     logError(reqId, "Failed to parse Anthropic messages body");
1492:     return createAnthropicErrorResponse(400, "Malformed JSON", "invalid_request_error");
1493:   }
1494: 
1495:   const validationError = validateAnthropicPayload(anthropicBody);
1496:   if (validationError) {
1497:     return createAnthropicErrorResponse(400, validationError, "invalid_request_error");
1498:   }
1499: 
1500:   const clientAgent = req.headers.get("user-agent") || "unknown";
1501:   const endpoint = directive.type === "direct"
1502:     ? resolveUpstreamEndpoint(directive.provider, directive.completion, anthropicBody.model)
1503:     : undefined;
1504:   const poolSize = directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1;
1505:   const refHeaders = endpoint?.headers;
1506:   const refUa = refHeaders?.["User-Agent"];
1507:   const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
1508:   const referrer = refUa && refUrl ? `${refUa} @ ${refUrl}` : (refUa ?? refUrl ?? undefined);
1509: 
1510:   logInbound({
1511:     reqId,
1512:     method: req.method,
1513:     path: "/v1/messages",
1514:     clientAgent,
1515:     protocol: req.headers.get("x-http-version") || "HTTP/1.1",
1516:     directiveStr: rawKey,
1517:     targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
1518:     wireFormat: directive.type === "direct" ? directive.payload : "cl",
1519:     endpoint: endpoint?.rawPath,
1520:     model: anthropicBody.model,
1521:     totalKeys: poolSize,
1522:     nuances: directive.type === "direct" ? directive.nuances : undefined,
1523:     referrer,
1524:   });
1525: 
1526:   let effectiveAnthropicBody = anthropicBody;
1527:   const initialTokens = estimateAnthropicTokens(anthropicBody);
1528:   if (initialTokens > DEFAULT_MAX_CONTEXT_TOKENS) {
1529:     effectiveAnthropicBody = pruneAnthropicPayload(anthropicBody, DEFAULT_SAFE_CONTEXT_TOKENS);
1530:     logWarn(EMOJI.prune, `[PRUNE ${reqId}] Proactively pruned Anthropic messages: ${initialTokens} -> ${estimateAnthropicTokens(effectiveAnthropicBody)} tokens.`);
1531:   }
1532: 
1533:   if (directive.type === "direct" && directive.payload === "cl" && directive.completion === "ms") {
1534:     const payload = scrubUnsupportedParameters(
1535:       effectiveAnthropicBody as unknown as OpenAIRequestPayload,
1536:       undefined,
1537:       getEnv().LITEROUTER_ENABLE_SCRUBBING
1538:     ) as unknown as AnthropicMessagesRequest;
1539:     return executeAnthropicDirectLoop(directive, payload, req.signal, reqId, req.headers);
1540:   }
1541: 
1542:   const openAiPayload = translateAnthropicToOpenAI(effectiveAnthropicBody);
1543: 
1544:   const cleanHeaders = new Headers(req.headers);
1545:   cleanHeaders.delete("authorization");
1546:   cleanHeaders.delete("content-length");
1547:   cleanHeaders.delete("anthropic-version");
1548:   cleanHeaders.delete("anthropic-beta");
1549:   cleanHeaders.delete("x-api-key");
1550:   cleanHeaders.set("Content-Type", "application/json");
1551: 
1552:   const syntheticReq = new Request("http://localhost:7766/v1/chat/completions", {
1553:     method: "POST",
1554:     headers: cleanHeaders,
1555:     body: JSON.stringify(openAiPayload),
1556:     signal: req.signal,
1557:   });
1558: 
1559:   const openAiRes = await handleOpenAICompat(syntheticReq, rawKey, reqId, { skipInboundLog: true });
1560:   if (req.signal?.aborted && openAiRes.status === 499) {
1561:     return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
1562:   }
1563:   if (openAiRes.status >= 400) {
1564:     const errClone = openAiRes.clone();
1565:     try {
1566:       const errJson = (await errClone.json()) as Record<string, unknown>;
1567:       const errObj = (errJson.error as Record<string, unknown>) || {};
1568:       const errMsg = typeof errObj.message === "string"
1569:         ? errObj.message
1570:         : (typeof errJson.message === "string" ? errJson.message : JSON.stringify(errJson));
1571:       const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
1572:       logError(reqId, `OpenAI Compat returned HTTP ${openAiRes.status}: ${errMsg}`);
1573:       return createAnthropicErrorResponse(openAiRes.status, errMsg, errType);
1574:     } catch {
1575:       const errText = await openAiRes.text();
1576:       logError(reqId, `OpenAI Compat returned HTTP ${openAiRes.status}: ${errText}`);
1577:       return createAnthropicErrorResponse(openAiRes.status, errText || "Upstream error", "api_error");
1578:     }
1579:   }
1580: 
1581:   if (anthropicBody.stream) {
1582:     return handleStreamingResult(openAiRes, anthropicBody.model);
1583:   }
1584:   return handleNonStreamingResult(openAiRes, anthropicBody.model);
1585: }
1586: 
1587: export { estimateTextTokens, estimateAnthropicTokens as estimateAnthropicInputTokens } from "../transformers/context_pruner";
1588: 
1589: export async function handleAnthropicCountTokens(
1590:   req: Request,
1591:   rawKey: string,
1592:   reqId: string
1593: ): Promise<Response> {
1594:   const startTime = Date.now();
1595:   const validation = validateDirective(rawKey);
1596:   if (validation.valid === false) {
1597:     return createAnthropicErrorResponse(401, validation.error, "authentication_error");
1598:   }
1599: 
1600:   const directive = validation.directive;
1601:   const anthropicBody = await parseAnthropicRequest(req);
1602:   if (!anthropicBody) {
1603:     logError(reqId, "Failed to parse Anthropic count_tokens body");
1604:     return createAnthropicErrorResponse(400, "Malformed JSON", "invalid_request_error");
1605:   }
1606: 
1607:   const validationError = validateAnthropicPayload(anthropicBody);
1608:   if (validationError) {
1609:     return createAnthropicErrorResponse(400, validationError, "invalid_request_error");
1610:   }
1611: 
1612:   const clientAgent = req.headers.get("user-agent") || "unknown";
1613:   const countEndpoint = directive.type === "direct"
1614:     ? resolveUpstreamEndpoint(directive.provider, directive.completion, anthropicBody.model)
1615:     : undefined;
1616:   const countRefHeaders = countEndpoint?.headers;
1617:   const countRefUa = countRefHeaders?.["User-Agent"];
1618:   const countRefUrl = countRefHeaders?.["HTTP-Referer"] ?? countRefHeaders?.["Referer"];
1619:   const referrer = countRefUa && countRefUrl ? `${countRefUa} @ ${countRefUrl}` : (countRefUa ?? countRefUrl ?? undefined);
1620:   logInbound({
1621:     reqId,
1622:     method: req.method,
1623:     path: "/v1/messages/count_tokens",
1624:     clientAgent,
1625:     protocol: req.headers.get("x-http-version") || "HTTP/1.1",
1626:     directiveStr: rawKey,
1627:     targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
1628:     wireFormat: directive.type === "direct" ? directive.payload : "cl",
1629:     model: anthropicBody.model,
1630:     totalKeys: directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1,
1631:     nuances: directive.type === "direct" ? directive.nuances : undefined,
1632:     referrer,
1633:   });
1634: 
1635:   const inputTokens = estimateAnthropicTokens(anthropicBody);
1636:   logServed(reqId, Date.now() - startTime, 200);
1637: 
1638:   return Response.json(
1639:     { input_tokens: inputTokens },
1640:     {
1641:       status: 200,
1642:       headers: {
1643:         "Content-Type": "application/json",
1644:       },
1645:     }
1646:   );
1647: }
1648: 
1649: export const handleAnthropicOpenAICompat = handleAnthropicCompat;
1650: 
1651: export {
1652:   AnthropicMessagesTransformer,
1653:   anthropicMessagesTransformer,
1654: } from "../transformers/anthropic_messages";
```

## File: src/handlers/gcp_compat.ts
```typescript
  1: import type { DirectDirective, ParsedDirective } from "../directive/parser";
  2: import { parseDirective } from "../directive/parser";
  3: import { createUnauthorizedResponse, extractDirectiveToken, validateDirective } from "../directive/validator";
  4: import { classifyTransportError, classifyUpstreamError } from "../network/classifier";
  5: import {
  6:   createResilientStream,
  7:   fetchWithTtftGuard,
  8:   type FetcherOptions,
  9:   NoResponseError,
 10:   sanitizeDownstreamHeaders,
 11: } from "../network/fetcher";
 12: import { isFatalAuthError, type SelectedKey } from "../network/pool";
 13: import { sanitizeAndTransformPayload } from "../transformers/payload";
 14: import type { OpenAIRequestPayload } from "../transformers/nuances";
 15: import { getEnv } from "../config/env";
 16: import { getProviderConfig, resolveUpstreamEndpoint } from "../config/providers";
 17: import { calculateRetryDelay } from "../engine/retry";
 18: import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
 19: import {
 20:   EMOJI,
 21:   extractErrorMessage,
 22:   logError,
 23:   logExhausted,
 24:   logFinishReason,
 25:   logInbound,
 26:   logLimit,
 27:   logRotate,
 28:   logSeparator,
 29:   logServed,
 30:   logTtft,
 31:   logUsage,
 32:   logWarn,
 33: } from "../ui/logger";
 34: import {
 35:   DEFAULT_MAX_CONTEXT_TOKENS,
 36:   DEFAULT_SAFE_CONTEXT_TOKENS,
 37:   estimateOpenAITokens,
 38:   extractContextLimit,
 39:   isContextLengthError,
 40:   pruneOpenAIPayload,
 41: } from "../transformers/context_pruner";
 42: import {
 43:   globalKeyPool,
 44:   type RequestClientOptions,
 45:   UpstreamRetryableError,
 46:   waitAndSelectKey,
 47: } from "./openai_compat";
 48: 
 49: export interface GcpHandleOptions extends RequestClientOptions {
 50:   readonly customPath?: string;
 51:   readonly skipInboundLog?: boolean;
 52: }
 53: 
 54: export function normalizeGcpModel(model: string | undefined | null): string {
 55:   if (!model || typeof model !== "string") {
 56:     return "";
 57:   }
 58:   return model.replace(/^(?:gcp|google)\//i, "");
 59: }
 60: 
 61: export function isGemmaModel(model: string | undefined | null): boolean {
 62:   if (!model || typeof model !== "string") {
 63:     return false;
 64:   }
 65:   const normalized = normalizeGcpModel(model).toLowerCase().trim();
 66:   return normalized.includes("gemma");
 67: }
 68: 
 69: export function buildGcpAuthHeaders(key: string): Record<string, string> {
 70:   return {
 71:     Authorization: `Bearer ${key}`,
 72:     "x-goog-api-key": key,
 73:     "Content-Type": "application/json",
 74:   };
 75: }
 76: 
 77: function mergeUint8Arrays(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
 78:   const result = new Uint8Array(totalLength);
 79:   let offset = 0;
 80:   for (const chunk of chunks) {
 81:     result.set(chunk, offset);
 82:     offset += chunk.length;
 83:   }
 84:   return result;
 85: }
 86: 
 87: async function collectFullBody(
 88:   firstChunk: Uint8Array,
 89:   reader: ReadableStreamDefaultReader<Uint8Array>
 90: ): Promise<Uint8Array> {
 91:   const chunks: Uint8Array[] = [firstChunk];
 92:   let totalLength = firstChunk.length;
 93:   let reading = true;
 94: 
 95:   while (reading) {
 96:     const { done, value } = await reader.read();
 97:     if (done) {
 98:       reading = false;
 99:     } else if (value) {
100:       chunks.push(value);
101:       totalLength += value.length;
102:     }
103:   }
104:   return mergeUint8Arrays(chunks, totalLength);
105: }
106: 
107: async function acquireGcpPacer(clientSignal: AbortSignal | undefined): Promise<number> {
108:   const env = getEnv();
109:   const gcPacer = getProviderConfig("gc").pacer;
110:   const enabled = gcPacer?.enabled ?? false;
111: 
112:   if (!env.LITEROUTER_PACER_ENABLED || !enabled) {
113:     return 0;
114:   }
115: 
116:   const pacer = getPacerForProvider("gc");
117:   const { queueDwellMs } = await pacer.acquire(clientSignal);
118:   return queueDwellMs;
119: }
120: 
121: async function executeGcpDirectCall(
122:   directive: DirectDirective,
123:   payload: OpenAIRequestPayload,
124:   clientSignal: AbortSignal | undefined,
125:   selected: SelectedKey,
126:   reqId: string,
127:   attempt: number,
128:   maxAttempts: number,
129:   _clientOptions?: RequestClientOptions
130: ): Promise<Response> {
131:   const env = getEnv();
132:   const gcConfig = getProviderConfig("gc");
133: 
134:   const normalizedModel = normalizeGcpModel(payload.model);
135:   const activePayload = payload.model !== normalizedModel ? { ...payload, model: normalizedModel } : payload;
136:   const endpoint = resolveUpstreamEndpoint("gc", directive.completion || "ch", activePayload.model);
137:   const headers = buildGcpAuthHeaders(selected.key);
138:   const fetchOpts: FetcherOptions = {
139:     url: endpoint.url,
140:     method: "POST",
141:     headers,
142:     body: JSON.stringify(activePayload),
143:     clientSignal,
144:     provider: "gc",
145:     keyIndex: selected.index,
146:     model: activePayload.model,
147:   };
148: 
149:   const startTime = Date.now();
150: 
151:   const { response, ttftMs, firstChunk, rawReader, protocol } = await fetchWithTtftGuard(fetchOpts);
152:   const duration = Date.now() - startTime;
153: 
154:   const isStream = Boolean(payload.stream);
155: 
156:   if (response.status >= 400) {
157:     const fullBody = await collectFullBody(firstChunk, rawReader);
158:     const bodyText = new TextDecoder().decode(fullBody);
159: 
160:     if (response.status === 401 || response.status === 403) {
161:       logError(
162:         reqId,
163:         `[GCP ${reqId}] Fatal auth error (${response.status}) on key #${selected.index + 1}. Upstream rejected credentials.`
164:       );
165:       try {
166:         globalKeyPool.reportFailure(
167:           "gc",
168:           selected.index,
169:           response.status,
170:           response.headers,
171:           bodyText,
172:           Date.now()
173:         );
174:       } catch (_err) {
175:         void _err;
176:       }
177:       logServed(reqId, duration, response.status, attempt, maxAttempts);
178:       logSeparator();
179:       return new Response(fullBody.buffer as ArrayBuffer, {
180:         status: response.status,
181:         headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
182:       });
183:     }
184: 
185:     const classification = classifyUpstreamError({
186:       provider: "gc",
187:       status: response.status,
188:       headers: response.headers,
189:       bodyText,
190:     });
191: 
192:     const default429Ttl = Math.ceil((gcConfig.key_cooldown?.initial_cooldown_ms ?? 60000) / 1000);
193:     const effectiveQuarantineTtl = classification.quarantineTtlSec > 0
194:       ? classification.quarantineTtlSec
195:       : (response.status === 429 ? default429Ttl : 0);
196: 
197:     if (gcConfig.key_cooldown?.enabled && effectiveQuarantineTtl > 0) {
198:       globalKeyPool.reportFailure(
199:         "gc",
200:         selected.index,
201:         response.status,
202:         response.headers,
203:         bodyText,
204:         Date.now(),
205:         effectiveQuarantineTtl
206:       );
207:     } else if (!gcConfig.key_cooldown?.enabled && effectiveQuarantineTtl > 0) {
208:       logWarn(EMOJI.zap, `[GCP ${reqId}] Dumb-forwarder mode: Key ${selected.index} quarantine bypassed.`);
209:     }
210: 
211:     const rawErrorMsg = extractErrorMessage(bodyText);
212:     const ttlSec = gcConfig.key_cooldown?.enabled
213:       ? (effectiveQuarantineTtl > 0 ? effectiveQuarantineTtl : undefined)
214:       : undefined;
215:     logLimit(reqId, "gc", selected.index, response.status, ttlSec, selected.totalKeys, rawErrorMsg);
216: 
217:     if (gcConfig.request_retry.enabled && isContextLengthError(response.status, bodyText) && !clientSignal?.aborted) {
218:       const detectedLimit = extractContextLimit(bodyText);
219:       const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
220:       const pruned = pruneOpenAIPayload(payload, targetLimit);
221:       if (pruned.messages.length < payload.messages.length || estimateOpenAITokens(pruned) < estimateOpenAITokens(payload)) {
222:         logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
223:         return executeGcpDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts, _clientOptions);
224:       }
225:     }
226: 
227:     const canRetry =
228:       gcConfig.request_retry.enabled &&
229:       classification.action === "retry_rotate" &&
230:       attempt < maxAttempts &&
231:       !clientSignal?.aborted;
232:     if (canRetry) {
233:       throw new UpstreamRetryableError(
234:         `Upstream error ${response.status}: ${classification.reason}`,
235:         response.status,
236:         classification
237:       );
238:     }
239: 
240:     if (!gcConfig.request_retry.enabled && classification.action === "retry_rotate") {
241:       logWarn(EMOJI.zap, `[GCP ${reqId}] Single-flight mode: Passing HTTP ${response.status} directly downstream.`);
242:     }
243: 
244:     logServed(reqId, duration, response.status, attempt, maxAttempts);
245:     logSeparator();
246: 
247:     return new Response(fullBody.buffer as ArrayBuffer, {
248:       status: response.status,
249:       headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
250:     });
251:   }
252: 
253:   globalKeyPool.reportSuccess("gc", selected.index);
254:   logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", protocol);
255: 
256:   if (!isStream) {
257:     const fullBody = await collectFullBody(firstChunk, rawReader);
258:     try {
259:       const decoded = new TextDecoder().decode(fullBody);
260:       const json = JSON.parse(decoded) as {
261:         usage?: {
262:           prompt_tokens?: number;
263:           completion_tokens?: number;
264:           reasoning_tokens?: number;
265:           total_tokens?: number;
266:         };
267:       };
268:       if (json.usage) {
269:         logUsage({
270:           reqId,
271:           provider: "gc",
272:           keyIndex: selected.index,
273:           totalKeys: selected.totalKeys,
274:           promptTokens: json.usage.prompt_tokens || 0,
275:           reasoningTokens: json.usage.reasoning_tokens || 0,
276:           completionTokens: json.usage.completion_tokens || 0,
277:           totalTokens: json.usage.total_tokens || 0,
278:           durationMs: duration,
279:         });
280:       }
281:     } catch (parseErr) {
282:       void parseErr;
283:     }
284: 
285:     logServed(reqId, duration, response.status, attempt, maxAttempts);
286:     logSeparator();
287: 
288:     return new Response(fullBody.buffer as ArrayBuffer, {
289:       status: response.status,
290:       headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
291:     });
292:   }
293: 
294:   let currentKeyIndex = selected.index;
295:   let currentAttempt = attempt;
296: 
297:   const resilientStream = createResilientStream(firstChunk, rawReader, {
298:     protocol: "openai",
299:     onUsage: (u) => {
300:       const streamDuration = Date.now() - startTime;
301:       logUsage({
302:         reqId,
303:         provider: "gc",
304:         keyIndex: currentKeyIndex,
305:         totalKeys: selected.totalKeys,
306:         promptTokens: u.promptTokens,
307:         reasoningTokens: u.reasoningTokens,
308:         completionTokens: u.completionTokens,
309:         totalTokens: u.totalTokens,
310:         durationMs: streamDuration,
311:       });
312:       logServed(reqId, streamDuration, response.status, currentAttempt, maxAttempts);
313:       logSeparator();
314:     },
315:     onFinishReason: (finishReason) => {
316:       logFinishReason(reqId, finishReason);
317:     },
318:     retryProvider: async (reason: string, _hasEmittedTokens?: boolean) => {
319:       const classification = classifyTransportError(reason);
320:       if (gcConfig.key_cooldown?.enabled && classification.quarantineTtlSec > 0) {
321:         globalKeyPool.reportFailure("gc", currentKeyIndex, 500, undefined, reason, Date.now(), classification.quarantineTtlSec);
322:       }
323:       const ttlSec = gcConfig.key_cooldown?.enabled && classification.quarantineTtlSec > 0
324:         ? classification.quarantineTtlSec
325:         : undefined;
326:       logLimit(reqId, "gc", currentKeyIndex, 500, ttlSec, selected.totalKeys, reason);
327: 
328:       if (!gcConfig.request_retry.enabled) {
329:         logWarn(EMOJI.zap, `[GCP ${reqId}] Mid-stream drop occurred. Retries disabled. Closing stream.`);
330:         return null;
331:       }
332: 
333:       while (currentAttempt < maxAttempts) {
334:         currentAttempt++;
335:         if (clientSignal?.aborted) {
336:           return null;
337:         }
338:         const nextSelected = globalKeyPool.selectNextKey("gc");
339:         if (!nextSelected) {
340:           return null;
341:         }
342:         logRotate(reqId, "gc", currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
343:         currentKeyIndex = nextSelected.index;
344: 
345:         const nextHeaders = buildGcpAuthHeaders(nextSelected.key);
346:         const nextFetchOpts: FetcherOptions = {
347:           url: endpoint.url,
348:           method: "POST",
349:           headers: nextHeaders,
350:           body: JSON.stringify(activePayload),
351:           clientSignal,
352:           provider: "gc",
353:           keyIndex: nextSelected.index,
354:           model: activePayload.model,
355:         };
356: 
357:         const gcPacer = getProviderConfig("gc").pacer;
358:         if (env.LITEROUTER_PACER_ENABLED && (gcPacer?.enabled ?? false)) {
359:           await acquireGcpPacer(clientSignal);
360:         }
361: 
362:         try {
363:           const nextResult = await fetchWithTtftGuard(nextFetchOpts);
364:           if (nextResult.response.status === 401 || nextResult.response.status === 403) {
365:             logError(reqId, `[GCP ${reqId}] Mid-stream retry hit fatal auth error ${nextResult.response.status}. Halting retries.`);
366:             try {
367:               globalKeyPool.reportFailure("gc", nextSelected.index, nextResult.response.status);
368:             } catch (_err) {
369:               void _err;
370:             }
371:             return null;
372:           }
373:           if (nextResult.response.status >= 400) {
374:             if (gcConfig.key_cooldown?.enabled) {
375:               globalKeyPool.reportFailure("gc", nextSelected.index, nextResult.response.status);
376:             }
377:             continue;
378:           }
379:           globalKeyPool.reportSuccess("gc", nextSelected.index);
380:           return {
381:             firstChunk: nextResult.firstChunk,
382:             rawReader: nextResult.rawReader,
383:           };
384:         } catch (retryErr: unknown) {
385:           if (retryErr instanceof NoResponseError && gcConfig.key_cooldown?.enabled) {
386:             const transportClass = classifyTransportError(retryErr);
387:             globalKeyPool.reportFailure("gc", nextSelected.index, 0, undefined, retryErr.message, Date.now(), transportClass.quarantineTtlSec);
388:           }
389:           continue;
390:         }
391:       }
392:       return null;
393:     },
394:   });
395: 
396:   return new Response(resilientStream, {
397:     status: response.status,
398:     headers: sanitizeDownstreamHeaders(response.headers),
399:   });
400: }
401: 
402: interface AttemptExecutionResult {
403:   readonly success: boolean;
404:   readonly response?: Response;
405:   readonly error?: unknown;
406:   readonly retryable: boolean;
407: }
408: 
409: async function tryGcpAttempt(
410:   directive: DirectDirective,
411:   transformed: OpenAIRequestPayload,
412:   clientSignal: AbortSignal | undefined,
413:   selected: SelectedKey,
414:   reqId: string,
415:   attempt: number,
416:   maxAttempts: number,
417:   startTime: number,
418:   clientOptions?: RequestClientOptions
419: ): Promise<AttemptExecutionResult> {
420:   const env = getEnv();
421:   const gcConfig = getProviderConfig("gc");
422:   try {
423:     const res = await executeGcpDirectCall(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts, clientOptions);
424:     return { success: true, response: res, retryable: false };
425:   } catch (err: unknown) {
426:     if (clientSignal?.aborted) {
427:       return { success: false, error: err, retryable: false };
428:     }
429:     if (err instanceof Error && err.message.includes("aborted")) {
430:       return { success: false, error: err, retryable: false };
431:     }
432:     if (isFatalAuthError(err)) {
433:       logError(reqId, `[GCP ${reqId}] Fatal auth error: ${err.message}`);
434:       logServed(reqId, Date.now() - startTime, err.status, attempt, maxAttempts);
435:       logSeparator();
436:       return {
437:         success: true,
438:         response: Response.json(
439:           {
440:             error: {
441:               message: err.message,
442:               type: "authentication_error",
443:               code: err.status,
444:             },
445:           },
446:           {
447:             status: err.status,
448:             headers: { "Content-Type": "application/json" },
449:           }
450:         ),
451:         retryable: false,
452:       };
453:     }
454:     if (err instanceof PacerQueueOverflowError) {
455:       logWarn(EMOJI.hourglass, `[PACER ${reqId}] GCP Pacer queue overflow: ${err.message} (Retry-After: ${err.retryAfterSec}s)`);
456:       logServed(reqId, Date.now() - startTime, 429, attempt, maxAttempts);
457:       logSeparator();
458:       return {
459:         success: true,
460:         response: Response.json(
461:           {
462:             error: {
463:               message: err.message,
464:               type: "rate_limit_exceeded",
465:               code: "rate_limit_exceeded",
466:             },
467:           },
468:           {
469:             status: 429,
470:             headers: {
471:               "Retry-After": String(err.retryAfterSec),
472:               "Content-Type": "application/json",
473:             },
474:           }
475:         ),
476:         retryable: false,
477:       };
478:     }
479:     if (err instanceof UpstreamRetryableError) {
480:       return { success: false, error: err, retryable: true };
481:     }
482:     if (err instanceof NoResponseError) {
483:       if (gcConfig.key_cooldown?.enabled) {
484:         const transportClass = classifyTransportError(err);
485:         globalKeyPool.reportFailure("gc", selected.index, 0, undefined, err.message, Date.now(), transportClass.quarantineTtlSec);
486:       }
487:       if (!gcConfig.request_retry.enabled) {
488:         logWarn(EMOJI.zap, `[GCP ${reqId}] Single-flight mode: Upstream transport error: ${err.message}`);
489:         logServed(reqId, Date.now() - startTime, 502, attempt, maxAttempts);
490:         logSeparator();
491:         return {
492:           success: true,
493:           response: Response.json(
494:             {
495:               error: {
496:                 message: `GCP upstream connection failed: ${err.message}`,
497:                 type: "upstream_connection_error",
498:                 code: 502,
499:               },
500:             },
501:             {
502:               status: 502,
503:               headers: { "Content-Type": "application/json" },
504:             }
505:           ),
506:           retryable: false,
507:         };
508:       }
509:       return { success: false, error: err, retryable: true };
510:     }
511:     logError(reqId, "Direct GCP request error", err);
512:     return { success: false, error: err, retryable: false };
513:   }
514: }
515: 
516: async function executeGcpAttemptLoop(
517:   directive: DirectDirective,
518:   transformed: OpenAIRequestPayload,
519:   clientSignal: AbortSignal | undefined,
520:   reqId: string,
521:   clientOptions?: RequestClientOptions
522: ): Promise<Response> {
523:   const env = getEnv();
524:   const poolSize = globalKeyPool.getPoolSize("gc");
525:   const provConfig = getProviderConfig("gc");
526:   const maxAttempts = provConfig.request_retry.enabled
527:     ? Math.min(provConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
528:     : 1;
529:   let lastError: unknown = null;
530:   let prevKeyIndex = -1;
531:   const startTime = Date.now();
532:   const maxWaitMs = provConfig.pacer?.max_queue_wait_ms ?? 0;
533: 
534:   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
535:     if (clientSignal?.aborted) {
536:       return Response.json(
537:         { error: { message: "Request aborted by client", type: "client_closed_request" } },
538:         { status: 499 }
539:       );
540:     }
541: 
542:     const dwellMs = Date.now() - startTime;
543:     if (provConfig.key_cooldown?.enabled && globalKeyPool.shouldLoadShed("gc", dwellMs, maxWaitMs)) {
544:       const minTtl = globalKeyPool.getMinQuarantineTtlMs("gc");
545:       const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
546:       return Response.json(
547:         { error: { message: "Provider 'gc' unavailable: all keys in cooldown exceed wait budget.", type: "service_unavailable" } },
548:         {
549:           status: 503,
550:           headers: {
551:             "Retry-After": String(retryAfterSec),
552:           },
553:         }
554:       );
555:     }
556: 
557:     try {
558:       await acquireGcpPacer(clientSignal);
559:     } catch (err: unknown) {
560:       if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
561:         return Response.json(
562:           { error: { message: "Request aborted by client", type: "client_closed_request" } },
563:           { status: 499 }
564:         );
565:       }
566:       if (err instanceof PacerQueueOverflowError) {
567:         logWarn(EMOJI.hourglass, `[PACER ${reqId}] GCP Pacer queue overflow: ${err.message} (Retry-After: ${err.retryAfterSec}s)`);
568:         logServed(reqId, Date.now() - startTime, 429, attempt, maxAttempts);
569:         logSeparator();
570:         return Response.json(
571:           {
572:             error: {
573:               message: err.message,
574:               type: "rate_limit_exceeded",
575:               code: "rate_limit_exceeded",
576:             },
577:           },
578:           {
579:             status: 429,
580:             headers: {
581:               "Retry-After": String(err.retryAfterSec),
582:               "Content-Type": "application/json",
583:             },
584:           }
585:         );
586:       }
587:       throw err;
588:     }
589: 
590:     let selected: SelectedKey | null = null;
591:     try {
592:       selected = await waitAndSelectKey("gc", startTime, maxWaitMs, clientSignal);
593:     } catch (err) {
594:       void err;
595:     }
596: 
597:     if (!selected) {
598:       if (clientSignal?.aborted) {
599:         return Response.json(
600:           { error: { message: "Request aborted by client", type: "client_closed_request" } },
601:           { status: 499 }
602:         );
603:       }
604:       const minTtl = globalKeyPool.getMinQuarantineTtlMs("gc");
605:       const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
606:       logExhausted(reqId, "gc", minTtl);
607:       return Response.json(
608:         {
609:           error: {
610:             message: "All GCP API keys are currently rate-limited or in cooldown.",
611:             type: "rate_limit_exceeded",
612:             code: "all_keys_in_cooldown",
613:           },
614:         },
615:         {
616:           status: 429,
617:           headers: {
618:             "Retry-After": String(retryAfterSec),
619:             "Content-Type": "application/json",
620:           },
621:         }
622:       );
623:     }
624: 
625:     if (attempt > 1) {
626:       logRotate(reqId, "gc", prevKeyIndex, selected.index, selected.totalKeys, attempt, maxAttempts);
627:     }
628:     prevKeyIndex = selected.index;
629: 
630:     const outcome = await tryGcpAttempt(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts, startTime, clientOptions);
631:     if (outcome.success && outcome.response) {
632:       return outcome.response;
633:     }
634:     lastError = outcome.error;
635:     if (clientSignal?.aborted || (lastError instanceof Error && lastError.message.includes("aborted"))) {
636:       return Response.json(
637:         { error: { message: "Request aborted by client", type: "client_closed_request" } },
638:         { status: 499 }
639:       );
640:     }
641:     if (!outcome.retryable) {
642:       if (isFatalAuthError(lastError)) {
643:         logServed(reqId, Date.now() - startTime, lastError.status, attempt, maxAttempts);
644:         logSeparator();
645:         return Response.json(
646:           { error: { message: lastError.message, type: "authentication_error", code: lastError.status } },
647:           { status: lastError.status }
648:         );
649:       }
650:       throw lastError;
651:     }
652:     if (attempt < maxAttempts) {
653:       const delayMs = calculateRetryDelay(provConfig.request_retry.delay, attempt);
654:       if (delayMs > 0) {
655:         await Bun.sleep(delayMs);
656:       }
657:     }
658:   }
659: 
660:   logError(reqId, "GCP request attempts exhausted", lastError);
661:   if (isFatalAuthError(lastError)) {
662:     logServed(reqId, Date.now() - startTime, lastError.status, maxAttempts, maxAttempts);
663:     logSeparator();
664:     return Response.json(
665:       { error: { message: lastError.message, type: "authentication_error", code: lastError.status } },
666:       { status: lastError.status }
667:     );
668:   }
669:   const errMsg = lastError instanceof Error ? lastError.message : "All GCP request attempts failed";
670:   const statusCode = lastError instanceof UpstreamRetryableError ? lastError.status : 502;
671:   logServed(reqId, Date.now() - startTime, statusCode, maxAttempts, maxAttempts);
672:   logSeparator();
673:   return Response.json(
674:     { error: { message: `GCP request attempts exhausted - ${errMsg}`, type: "gateway_error" } },
675:     { status: statusCode }
676:   );
677: }
678: 
679: export async function handleGcpCompat(
680:   req: Request,
681:   directiveOrRawKey?: ParsedDirective | string,
682:   reqIdOrOptions?: string | GcpHandleOptions,
683:   maybeOptions?: GcpHandleOptions
684: ): Promise<Response> {
685:   const reqId =
686:     typeof reqIdOrOptions === "string"
687:       ? reqIdOrOptions
688:       : `req_${Math.random().toString(36).slice(2, 9)}`;
689: 
690:   const options = typeof reqIdOrOptions === "object" ? reqIdOrOptions : maybeOptions;
691: 
692:   let directive: ParsedDirective | null = null;
693:   let rawDirectiveStr = "";
694: 
695:   if (typeof directiveOrRawKey === "string") {
696:     rawDirectiveStr = directiveOrRawKey;
697:     const valResult = validateDirective(directiveOrRawKey);
698:     if (!valResult.valid) {
699:       return createUnauthorizedResponse(valResult.error);
700:     }
701:     directive = valResult.directive;
702:   } else if (directiveOrRawKey && typeof directiveOrRawKey === "object") {
703:     directive = directiveOrRawKey;
704:     rawDirectiveStr = directive.raw || "lr-gc-oa-ch-no";
705:   } else {
706:     rawDirectiveStr = extractDirectiveToken(req) || "";
707:     const valResult = validateDirective(rawDirectiveStr);
708:     if (!valResult.valid) {
709:       return createUnauthorizedResponse(valResult.error);
710:     }
711:     directive = valResult.directive;
712:   }
713: 
714:   if (directive.type !== "direct" || directive.provider !== "gc") {
715:     // If directive is not gc direct, coerce to gc direct directive
716:     directive = {
717:       type: "direct",
718:       raw: rawDirectiveStr,
719:       provider: "gc",
720:       payload: directive.type === "direct" ? directive.payload : "oa",
721:       completion: directive.type === "direct" ? directive.completion : "ch",
722:       nuances: directive.type === "direct" ? directive.nuances : ["no"],
723:     };
724:   }
725: 
726:   let body: OpenAIRequestPayload;
727:   try {
728:     body = (await req.json()) as OpenAIRequestPayload;
729:   } catch (err: unknown) {
730:     logError(reqId, "Failed to parse JSON body for GCP", err);
731:     return Response.json(
732:       { error: { message: "Malformed JSON body", type: "invalid_request_error" } },
733:       { status: 400 }
734:     );
735:   }
736: 
737:   if (typeof body.model === "string") {
738:     body = { ...body, model: normalizeGcpModel(body.model) };
739:   }
740: 
741:   // Zero-Cost Billing Guardrail: Provider 'gc' strictly restricted to Gemma models
742:   if (!isGemmaModel(body.model)) {
743:     return Response.json(
744:       {
745:         error: {
746:           message: `Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models to prevent GCP billing overruns. Model requested: ${body.model}`,
747:           type: "billing_guardrail_violation",
748:           code: 403,
749:         },
750:       },
751:       { status: 403 }
752:     );
753:   }
754: 
755:   if (!options?.skipInboundLog) {
756:     const path = options?.customPath || new URL(req.url).pathname;
757:     const clientAgent = req.headers.get("user-agent") || "unknown";
758:     const endpoint = resolveUpstreamEndpoint("gc", directive.completion || "ch", body.model);
759:     const poolSize = globalKeyPool.getPoolSize("gc");
760:     const refHeaders = endpoint?.headers;
761:     const refUa = refHeaders?.["User-Agent"];
762:     const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
763:     const referrer = refUa && refUrl ? `${refUa} @ ${refUrl}` : (refUa ?? refUrl ?? undefined);
764: 
765:     logInbound({
766:       reqId,
767:       method: req.method,
768:       path,
769:       clientAgent,
770:       protocol: req.headers.get("x-http-version") || "HTTP/1.1",
771:       directiveStr: rawDirectiveStr,
772:       targetProvider: "gc",
773:       wireFormat: directive.payload,
774:       endpoint: endpoint?.rawPath,
775:       model: body.model,
776:       totalKeys: poolSize,
777:       nuances: directive.nuances,
778:       referrer,
779:     });
780:   }
781: 
782:   let effectiveBody = body;
783:   const initialTokens = estimateOpenAITokens(body);
784:   if (initialTokens > DEFAULT_MAX_CONTEXT_TOKENS) {
785:     effectiveBody = pruneOpenAIPayload(body, DEFAULT_SAFE_CONTEXT_TOKENS);
786:     logWarn(EMOJI.prune, `[PRUNE ${reqId}] Proactively pruned OpenAI messages: ${initialTokens} -> ${estimateOpenAITokens(effectiveBody)} tokens.`);
787:   }
788: 
789:   const clientOptions: RequestClientOptions = {
790:     userAgent: req.headers.get("user-agent") || undefined,
791:     headers: req.headers,
792:   };
793: 
794:   const env = getEnv();
795:   const transformed = sanitizeAndTransformPayload(effectiveBody, {
796:     nuances: directive.nuances,
797:     targetWire: directive.payload,
798:     enableScrubbing: env.LITEROUTER_ENABLE_SCRUBBING,
799:     globalStripReasoning: env.LITEROUTER_STRIP_REASONING,
800:     aoStripReasoning: env.LITEROUTER_AO_STRIP_REASONING,
801:   });
802: 
803:   return executeGcpAttemptLoop(directive, transformed, req.signal, reqId, clientOptions);
804: }
```

## File: src/network/pacer.ts
```typescript
  1: import { getProviderConfig, isRegisteredProvider } from "../config/providers";
  2: 
  3: export class PacerQueueOverflowError extends Error {
  4:   public readonly retryAfterSec: number;
  5:   constructor(message: string, retryAfterSec = 5) {
  6:     super(message);
  7:     this.name = "PacerQueueOverflowError";
  8:     this.retryAfterSec = retryAfterSec;
  9:   }
 10: }
 11: 
 12: interface QueueEntry {
 13:   readonly signal?: AbortSignal;
 14:   readonly resolve: (result: PacerAcquireResult) => void;
 15:   readonly reject: (err: Error) => void;
 16:   readonly enqueuedAt: number;
 17: }
 18: 
 19: export interface PacerAcquireResult {
 20:   queueDwellMs: number;
 21:   release: () => void;
 22: }
 23: 
 24: export interface QueueNode<T> {
 25:   value: T;
 26:   next: QueueNode<T> | null;
 27:   prev: QueueNode<T> | null;
 28: }
 29: 
 30: export class FastFifoQueue<T> {
 31:   private head: QueueNode<T> | null = null;
 32:   private tail: QueueNode<T> | null = null;
 33:   private _size = 0;
 34: 
 35:   public get size(): number {
 36:     return this._size;
 37:   }
 38: 
 39:   public enqueue(value: T): QueueNode<T> {
 40:     const node: QueueNode<T> = { value, next: null, prev: this.tail };
 41:     if (this.tail) {
 42:       this.tail.next = node;
 43:       this.tail = node;
 44:     } else {
 45:       this.head = node;
 46:       this.tail = node;
 47:     }
 48:     this._size++;
 49:     return node;
 50:   }
 51: 
 52:   public dequeue(): T | undefined {
 53:     if (!this.head) return undefined;
 54:     const value = this.head.value;
 55:     this.head = this.head.next;
 56:     if (this.head) {
 57:       this.head.prev = null;
 58:     } else {
 59:       this.tail = null;
 60:     }
 61:     this._size--;
 62:     return value;
 63:   }
 64: 
 65:   public remove(node: QueueNode<T>): void {
 66:     if (node.prev) node.prev.next = node.next;
 67:     if (node.next) node.next.prev = node.prev;
 68:     if (node === this.head) this.head = node.next;
 69:     if (node === this.tail) this.tail = node.prev;
 70:     this._size--;
 71:   }
 72: 
 73:   public clear(): void {
 74:     this.head = null;
 75:     this.tail = null;
 76:     this._size = 0;
 77:   }
 78: }
 79: 
 80: export interface PacerConfig {
 81:   readonly minIntervalMs?: number; // Minimum wait between consecutive request dispatches
 82:   readonly maxDelayMs?: number; // Optional upper bound for randomized jitter interval
 83:   readonly maxRpm?: number; // Optional backwards compatibility / fallback calculation
 84:   readonly maxQueueDepth?: number; // Optional queue depth limit
 85:   readonly maxQueueWaitMs?: number; // Maximum queue dwell before timeout
 86:   readonly maxConcurrency?: number; // Maximum concurrent in-flight requests (0 or undefined = unconstrained)
 87: }
 88: 
 89: export class RequestPacer {
 90:   private lastDispatchTimeMs = 0;
 91:   private readonly queue = new FastFifoQueue<QueueEntry>();
 92:   private drainTimer: ReturnType<typeof setTimeout> | null = null;
 93:   private emaDwellTimeMs = 0;
 94:   private activeInFlight = 0;
 95:   private readonly maxConcurrency: number;
 96: 
 97:   constructor(private readonly config: PacerConfig = {}) {
 98:     this.maxConcurrency = config.maxConcurrency ?? 0;
 99:   }
100: 
101:   public getMinInterval(): number {
102:     if (this.config.minIntervalMs !== undefined) {
103:       return this.config.minIntervalMs;
104:     }
105:     if (this.config.maxRpm && this.config.maxRpm > 0) {
106:       return Math.max(10, Math.ceil(60000 / this.config.maxRpm));
107:     }
108:     return 200;
109:   }
110: 
111:   public get maxQueueDepth(): number {
112:     return this.config.maxQueueDepth ?? 500;
113:   }
114: 
115:   public get maxQueueWaitMs(): number {
116:     return this.config.maxQueueWaitMs ?? 15000;
117:   }
118: 
119:   public async acquire(signal?: AbortSignal): Promise<PacerAcquireResult> {
120:     if (signal?.aborted) {
121:       throw new Error("Request aborted while queued in LiteRouter pacer");
122:     }
123: 
124:     const minInterval = this.getMinInterval();
125:     const now = Date.now();
126:     const timeSinceLastDispatch = now - this.lastDispatchTimeMs;
127:     const canBypass =
128:       this.queue.size === 0 &&
129:       timeSinceLastDispatch >= minInterval &&
130:       (this.maxConcurrency <= 0 || this.activeInFlight < this.maxConcurrency);
131: 
132:     // If queue is empty AND minInterval has elapsed AND within concurrency limit: dispatch immediately!
133:     if (canBypass) {
134:       this.lastDispatchTimeMs = now;
135:       this.activeInFlight++;
136:       this.updateEma(0);
137:       return { queueDwellMs: 0, release: this.createRelease() };
138:     }
139: 
140:     // Capacity check
141:     if (this.queue.size >= this.maxQueueDepth) {
142:       const estimatedWaitSec = Math.ceil(
143:         ((this.queue.size + 1) * minInterval) / 1000
144:       );
145:       throw new PacerQueueOverflowError(
146:         `LiteRouter rate limit capacity (${this.maxQueueDepth}) saturated.`,
147:         Math.max(1, estimatedWaitSec)
148:       );
149:     }
150: 
151:     return this.enqueueRequest(signal);
152:   }
153: 
154:   private enqueueRequest(signal?: AbortSignal): Promise<PacerAcquireResult> {
155:     const enqueuedAt = Date.now();
156: 
157:     return new Promise<PacerAcquireResult>((resolve, reject) => {
158:       let node: QueueNode<QueueEntry> | null = null;
159:       let finished = false;
160: 
161:       const abortHandler = () => {
162:         if (finished) return;
163:         finished = true;
164:         if (node) {
165:           this.queue.remove(node);
166:           node = null;
167:         }
168:         signal?.removeEventListener("abort", abortHandler);
169:         reject(new Error("Request aborted while queued in LiteRouter pacer"));
170:       };
171: 
172:       const entry: QueueEntry = {
173:         signal,
174:         resolve: (result: PacerAcquireResult) => {
175:           if (finished) return;
176:           finished = true;
177:           node = null;
178:           signal?.removeEventListener("abort", abortHandler);
179:           resolve(result);
180:         },
181:         reject: (err: Error) => {
182:           if (finished) return;
183:           finished = true;
184:           if (node) {
185:             this.queue.remove(node);
186:             node = null;
187:           }
188:           signal?.removeEventListener("abort", abortHandler);
189:           reject(err);
190:         },
191:         enqueuedAt,
192:       };
193: 
194:       if (signal?.aborted) {
195:         return reject(new Error("Request aborted while queued in LiteRouter pacer"));
196:       }
197: 
198:       signal?.addEventListener("abort", abortHandler, { once: true });
199:       node = this.queue.enqueue(entry);
200:       this.scheduleDrain();
201:     });
202:   }
203: 
204:   private createRelease(): () => void {
205:     let released = false;
206:     return () => {
207:       if (released) return;
208:       released = true;
209:       this.activeInFlight = Math.max(0, this.activeInFlight - 1);
210:       this.scheduleDrain();
211:     };
212:   }
213: 
214:   public getStats(): { currentTokens: number; queueDepth: number; avgDwellTimeMs: number } {
215:     return {
216:       currentTokens: this.activeInFlight,
217:       queueDepth: this.queue.size,
218:       avgDwellTimeMs: Math.round(this.emaDwellTimeMs),
219:     };
220:   }
221: 
222:   public clear(): void {
223:     if (this.drainTimer !== null) {
224:       clearTimeout(this.drainTimer);
225:       this.drainTimer = null;
226:     }
227:     this.queue.clear();
228:     this.activeInFlight = 0;
229:   }
230: 
231:   private updateEma(dwellMs: number): void {
232:     if (this.emaDwellTimeMs === 0) {
233:       this.emaDwellTimeMs = dwellMs;
234:     } else {
235:       // Exponential Moving Average: 10% weight to new sample, 90% historical
236:       this.emaDwellTimeMs = dwellMs * 0.1 + this.emaDwellTimeMs * 0.9;
237:     }
238:   }
239: 
240:   private scheduleDrain(): void {
241:     if (this.drainTimer !== null || this.queue.size === 0) return;
242:     if (this.maxConcurrency > 0 && this.activeInFlight >= this.maxConcurrency) {
243:       return;
244:     }
245:     const min = this.getMinInterval();
246:     const max = this.config.maxDelayMs;
247:     const interval = max && max > min
248:       ? min + Math.floor(Math.random() * (max - min + 1))
249:       : min;
250:     const elapsed = Date.now() - this.lastDispatchTimeMs;
251:     const waitMs = Math.max(0, interval - elapsed);
252: 
253:     this.drainTimer = setTimeout(() => {
254:       this.drainTimer = null;
255:       this.dispatchNext();
256:       if (this.queue.size > 0 && (this.maxConcurrency <= 0 || this.activeInFlight < this.maxConcurrency)) {
257:         this.scheduleDrain();
258:       }
259:     }, waitMs);
260:   }
261: 
262:   private dispatchNext(): void {
263:     if (this.maxConcurrency > 0 && this.activeInFlight >= this.maxConcurrency) {
264:       return;
265:     }
266:     while (this.queue.size > 0) {
267:       const entry = this.queue.dequeue();
268:       if (!entry) break;
269:       if (entry.signal?.aborted) {
270:         continue;
271:       }
272:       this.lastDispatchTimeMs = Date.now();
273:       this.activeInFlight++;
274:       const dwellMs = Math.max(0, this.lastDispatchTimeMs - entry.enqueuedAt);
275:       this.updateEma(dwellMs);
276:       entry.resolve({ queueDwellMs: dwellMs, release: this.createRelease() });
277:       break; // only 1 item dispatched per tick
278:     }
279:   }
280: }
281: 
282: // Global registry for per-provider pacers (all keys for a provider share the single pipe)
283: const pacerRegistry = new Map<string, RequestPacer>();
284: 
285: export function getPacerForProvider(
286:   provider: string,
287:   _keyIndex = 0,
288:   config?: Partial<PacerConfig>
289: ): RequestPacer {
290:   const pacerKey = provider;
291:   let pacer = pacerRegistry.get(pacerKey);
292:   if (!pacer) {
293:     const provPacer = isRegisteredProvider(provider)
294:       ? getProviderConfig(provider).pacer
295:       : undefined;
296:     const minIntervalMs = config?.minIntervalMs ?? provPacer?.min_delay_ms;
297:     if (minIntervalMs === undefined) {
298:       throw new Error(`[RequestPacer] Missing or invalid minIntervalMs for provider "${provider}"`);
299:     }
300:     const maxDelayMs = config?.maxDelayMs ?? provPacer?.max_delay_ms;
301:     const maxQueueDepth = config?.maxQueueDepth ?? provPacer?.max_queue_depth ?? 500;
302:     const maxQueueWaitMs = config?.maxQueueWaitMs ?? provPacer?.max_queue_wait_ms ?? 15000;
303:     const maxConcurrency = config?.maxConcurrency ?? provPacer?.max_concurrency ?? 0;
304:     pacer = new RequestPacer({
305:       minIntervalMs,
306:       maxDelayMs,
307:       maxQueueDepth,
308:       maxRpm: config?.maxRpm,
309:       maxQueueWaitMs,
310:       maxConcurrency,
311:     });
312:     pacerRegistry.set(pacerKey, pacer);
313:   }
314:   return pacer;
315: }
316: 
317: export function clearPacerRegistry(): void {
318:   pacerRegistry.clear();
319: }
```

## File: src/telemetry/session.ts
```typescript
  1: import { getProviderDisplayName } from "../config/providers";
  2: import {
  3:   EMOJI,
  4:   deriveErrorType,
  5:   formatTimestamp,
  6:   formatTokenNumber,
  7:   getHttpStatusText,
  8:   logInbound,
  9:   logModel,
 10: } from "../ui/logger";
 11: import { type MetricsHook, noopMetrics } from "./hooks";
 12: 
 13: export interface SessionData {
 14:   readonly reqId: string;
 15:   readonly method: string;
 16:   readonly path: string;
 17:   readonly clientAgent: string;
 18:   readonly protocol?: string;
 19:   readonly directiveStr?: string;
 20:   readonly targetProvider?: string;
 21:   readonly wireFormat?: string;
 22:   readonly endpoint?: string;
 23:   readonly model?: string;
 24:   resolvedModel?: string;
 25:   tier?: number;
 26:   readonly keyIndex?: number;
 27:   readonly totalKeys?: number;
 28:   readonly nuances?: readonly string[];
 29:   readonly referrer?: string;
 30:   readonly metricsHook?: MetricsHook;
 31: }
 32: 
 33: export interface TelemetryInit extends SessionData {}
 34: 
 35: export interface UsageRecord {
 36:   readonly promptTokens: number;
 37:   readonly completionTokens: number;
 38:   readonly reasoningTokens?: number;
 39:   readonly totalTokens?: number;
 40:   readonly finishReason?: string | null;
 41: }
 42: 
 43: export interface RotateKeyInfo {
 44:   readonly fromIndex: number;
 45:   readonly toIndex: number;
 46:   readonly totalKeys?: number;
 47:   readonly attempt?: number;
 48:   readonly maxAttempts?: number;
 49: }
 50: 
 51: export interface RecordLimitInfo {
 52:   readonly status: number;
 53:   readonly retryAfterSec?: number;
 54:   readonly totalKeys?: number;
 55:   readonly rawMessage?: string;
 56:   readonly hasUpstreamRetryAfter?: boolean;
 57:   readonly errorType?: string;
 58: }
 59: 
 60: export interface TraceMetrics {
 61:   readonly reqId: string;
 62:   readonly provider: string;
 63:   readonly model: string;
 64:   readonly durationMs: number;
 65:   readonly ttftMs?: number;
 66:   readonly promptTokens?: number;
 67:   readonly completionTokens?: number;
 68:   readonly totalTokens?: number;
 69: }
 70: 
 71: function buildSpeedString(durationMs: number, completionTokens: number): string {
 72:   if (durationMs <= 0 || completionTokens <= 0) {
 73:     return "";
 74:   }
 75:   const sec = durationMs / 1000;
 76:   const speed = (completionTokens / sec).toFixed(1);
 77:   return ` | Speed=${speed} tok/s`;
 78: }
 79: 
 80: export class RequestTelemetry {
 81:   private readonly startTime: number = performance.now();
 82:   private firstTokenTime?: number;
 83:   public readonly reqId: string;
 84:   private readonly providerCode: string;
 85:   private currentKeyIndex?: number;
 86:   private totalKeys?: number;
 87:   private readonly metrics: MetricsHook;
 88:   private lastUsage?: UsageRecord;
 89:   private status?: number;
 90:   public readonly session: SessionData;
 91: 
 92:   constructor(private readonly init: TelemetryInit) {
 93:     this.session = { ...init };
 94:     this.reqId = init.reqId;
 95:     this.providerCode = init.targetProvider ?? "unknown";
 96:     this.currentKeyIndex = init.keyIndex;
 97:     this.totalKeys = init.totalKeys;
 98:     this.metrics = init.metricsHook ?? noopMetrics;
 99:   }
100: 
101:   // ── Lifecycle Methods ──
102: 
103:   /** Update resolved model target and tier. */
104:   setResolvedTarget(model?: string, tier?: number): void {
105:     this.session.resolvedModel = model;
106:     this.session.tier = tier;
107:   }
108: 
109:   /** Emits resolved model banner if strategy resolution happened post-inbound. */
110:   emitResolvedModel(): void {
111:     logModel(
112:       this.reqId,
113:       this.session.model ?? "unknown",
114:       this.session.resolvedModel,
115:       this.session.tier
116:     );
117:   }
118: 
119:   /** Called once at request receipt. Emits inbound banner. */
120:   emitInbound(): void {
121:     logInbound({
122:       reqId: this.session.reqId,
123:       method: this.session.method,
124:       path: this.session.path,
125:       clientAgent: this.session.clientAgent,
126:       protocol: this.session.protocol,
127:       directiveStr: this.session.directiveStr,
128:       targetProvider: this.session.targetProvider,
129:       wireFormat: this.session.wireFormat,
130:       endpoint: this.session.endpoint,
131:       model: this.session.model,
132:       resolvedModel: this.session.resolvedModel,
133:       tier: this.session.tier,
134:       keyIndex: this.currentKeyIndex !== undefined && this.currentKeyIndex >= 0 ? this.currentKeyIndex : undefined,
135:       totalKeys: this.totalKeys,
136:       nuances: this.session.nuances,
137:       referrer: this.session.referrer,
138:     });
139: 
140:     this.metrics.onRequestStart(this.reqId, this.providerCode, this.session.model ?? "unknown");
141:   }
142: 
143:   /** Update key index and optionally total keys count. */
144:   setKeyIndex(index: number, totalKeys?: number): void {
145:     this.currentKeyIndex = index;
146:     if (totalKeys !== undefined) {
147:       this.totalKeys = totalKeys;
148:     }
149:   }
150: 
151:   /** Called on key rotation. Updates internal key index. */
152:   rotateKey(info: RotateKeyInfo): void {
153:     if (info.toIndex >= 0) {
154:       this.currentKeyIndex = info.toIndex;
155:     }
156:     if (info.totalKeys !== undefined) {
157:       this.totalKeys = info.totalKeys;
158:     }
159: 
160:     const ts = formatTimestamp();
161:     const provName = getProviderDisplayName(this.providerCode);
162:     const total = info.totalKeys ?? this.totalKeys;
163:     const totalStr = total !== undefined ? `/${total}` : "";
164:     const attemptStr = info.attempt && info.maxAttempts ? ` (Attempt ${info.attempt}/${info.maxAttempts})` : "";
165:     const keyStr = info.toIndex >= 0 ? ` [Key #${info.toIndex + 1}${totalStr}] ` : " ";
166:     console.log(`${EMOJI.rotate} ${ts} [ROTATE ${this.reqId}] Advancing to ${provName}${keyStr}-> Retrying immediately${attemptStr}`);
167: 
168:     this.metrics.onKeyRotation(this.reqId, this.providerCode, info.fromIndex, info.toIndex);
169:   }
170: 
171:   /** Called on upstream rate limit or quota. */
172:   recordLimit(info: RecordLimitInfo): void {
173:     const ts = formatTimestamp();
174:     const provName = getProviderDisplayName(this.providerCode);
175:     const keyIdx = this.currentKeyIndex !== undefined && this.currentKeyIndex >= 0 ? this.currentKeyIndex : 0;
176:     const total = info.totalKeys ?? this.totalKeys;
177:     const keyTotal = total !== undefined ? `/${total}` : "";
178:     const statusText = getHttpStatusText(info.status);
179:     const condensedType = info.errorType ?? deriveErrorType(info.rawMessage, info.status);
180: 
181:     console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] ${provName} [Key #${keyIdx + 1}${keyTotal}] returned ${statusText} [${condensedType} ${info.status}]`);
182:     if (info.retryAfterSec && info.hasUpstreamRetryAfter !== false) {
183:       console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] Parsed Retry-After: ${info.retryAfterSec}s -> Quarantined Key #${keyIdx + 1} for ${info.retryAfterSec}s`);
184:     }
185:     if (info.rawMessage) {
186:       console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] Upstream Error: "${info.rawMessage.slice(0, 300)}"`);
187:     }
188:   }
189: 
190:   /** Called on first SSE chunk received. Idempotent (ignores subsequent calls). */
191:   markTtft(protocol?: string, details = "First chunk streamed downstream"): void {
192:     if (this.firstTokenTime !== undefined) {
193:       return;
194:     }
195:     this.firstTokenTime = performance.now();
196:     const ttftMs = this.getTtftMs() ?? 0;
197:     const ts = formatTimestamp();
198:     const protoStr = protocol ? ` [Upstream: ${protocol}]` : "";
199:     console.log(`${EMOJI.ttft} ${ts} [TTFT ${this.reqId}] TTFT = ${ttftMs}ms | ${details}${protoStr}`);
200:   }
201: 
202:   /** Called when tokens are extracted from response. Computes speed, emits usage. */
203:   recordUsage(record: UsageRecord): void {
204:     this.lastUsage = record;
205:     const ts = formatTimestamp();
206:     const provName = getProviderDisplayName(this.providerCode);
207:     const keyIdx = this.currentKeyIndex !== undefined && this.currentKeyIndex >= 0 ? this.currentKeyIndex + 1 : 1;
208:     const totalKeysStr = this.totalKeys !== undefined ? `/${this.totalKeys}` : "";
209: 
210:     const durationMs = this.getDurationMs();
211:     const speedStr = buildSpeedString(durationMs, record.completionTokens);
212: 
213:     const reasoningStr = record.reasoningTokens && record.reasoningTokens > 0
214:       ? ` | Reasoning=${formatTokenNumber(record.reasoningTokens)}`
215:       : "";
216: 
217:     const totalTokens = record.totalTokens ?? (record.promptTokens + record.completionTokens);
218: 
219:     console.log(`${EMOJI.usage} ${ts} [USAGE ${this.reqId}] ${provName} (Key #${keyIdx}${totalKeysStr})`);
220:     console.log(
221:       `${EMOJI.tokens} ${ts} [USAGE ${this.reqId}] Tokens: Prompt=${formatTokenNumber(record.promptTokens)}${reasoningStr} | Completion=${formatTokenNumber(record.completionTokens)} | Total=${formatTokenNumber(totalTokens)}${speedStr}`
222:     );
223: 
224:     if (record.finishReason === "length") {
225:       console.warn(`${EMOJI.finishTrunc} ${ts} [FINISH ${this.reqId}] Upstream token truncation occurred (finish_reason=length)`);
226:     }
227:   }
228: 
229:   /** Called at response completion. Emits served banner with total duration. */
230:   served(status = 200, attempt?: number, maxAttempts?: number): void {
231:     this.status = status;
232:     const durationMs = this.getDurationMs();
233:     const ts = formatTimestamp();
234:     const attemptStr = attempt && maxAttempts && maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
235:     const icon = status >= 400 ? EMOJI.servedErr : EMOJI.servedOk;
236: 
237:     if (status >= 400) {
238:       console.warn(`${icon} ${ts} [SERVED ${this.reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
239:     } else {
240:       console.log(`${icon} ${ts} [SERVED ${this.reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
241:     }
242: 
243:     this.metrics.onRequestEnd(this.reqId, status, durationMs, this.getTtftMs());
244:   }
245: 
246:   /** Called on error. */
247:   error(message: string, err?: unknown): void {
248:     this.status = 500;
249:     const durationMs = this.getDurationMs();
250:     const ts = formatTimestamp();
251:     const errDetail = err instanceof Error ? ` - ${err.message}` : "";
252:     console.error(`${EMOJI.error} ${ts} [ERROR ${this.reqId}] ${message}${errDetail}`);
253:     this.metrics.onRequestEnd(this.reqId, 500, durationMs, this.getTtftMs());
254:   }
255: 
256:   /**
257:    * Logs an upstream error observed INSIDE an already-serving response stream.
258:    *
259:    * Deliberately side-effect free on `status` and on `metrics.onRequestEnd`:
260:    * the streaming dispatch path has already called `served(200)` before the
261:    * body is handed to the client, so routing through `error()` would both
262:    * corrupt the recorded status to 500 and fire `onRequestEnd` twice. An
263:    * in-band upstream error is otherwise completely invisible: the client
264:    * receives an `event: error` frame over a 200 response, no TTFT line is
265:    * emitted, and the request counts as a success in traces.db.
266:    */
267:   upstreamStreamError(message: string): void {
268:     const ts = formatTimestamp();
269:     console.warn(`${EMOJI.limit} ${ts} [STREAM ${this.reqId}] ${message}`);
270:   }
271: 
272:   // ── Derived Metrics ──
273: 
274:   /** Returns TTFT in ms, or undefined if no first token received. */
275:   getTtftMs(): number | undefined {
276:     return this.firstTokenTime !== undefined
277:       ? Math.round(this.firstTokenTime - this.startTime)
278:       : undefined;
279:   }
280: 
281:   /** Returns total request duration in ms. */
282:   getDurationMs(): number {
283:     return Math.round(performance.now() - this.startTime);
284:   }
285: 
286:   /** Returns structured snapshot for trace storage. */
287:   toTraceMetrics(): TraceMetrics {
288:     return {
289:       reqId: this.reqId,
290:       provider: this.providerCode,
291:       model: this.session.model ?? "unknown",
292:       durationMs: this.getDurationMs(),
293:       ttftMs: this.getTtftMs(),
294:       ...(this.lastUsage ? {
295:         promptTokens: this.lastUsage.promptTokens,
296:         completionTokens: this.lastUsage.completionTokens,
297:         totalTokens: this.lastUsage.totalTokens ?? (this.lastUsage.promptTokens + this.lastUsage.completionTokens),
298:       } : {}),
299:     };
300:   }
301: }
```

## File: src/network/pool.ts
```typescript
  1: import { EventEmitter } from "node:events";
  2: import type { ProviderCode } from "../directive/parser";
  3: import { CooldownManager, type KeyCooldownState } from "./cooldown";
  4: import { getProviderConfig } from "../config/providers";
  5: 
  6: export interface SelectedKey {
  7:   readonly key: string;
  8:   readonly index: number;
  9:   readonly totalKeys: number;
 10: }
 11: 
 12: export interface PoolStatus {
 13:   readonly total: number;
 14:   readonly active: number;
 15:   readonly quarantined: number;
 16: }
 17: 
 18: export class FatalAuthError extends Error {
 19:   public readonly status: number;
 20:   public readonly provider: string;
 21:   public readonly keyIndex: number;
 22:   public readonly isFatal = true;
 23: 
 24:   constructor(provider: string, keyIndex: number, status: number, body?: string) {
 25:     super(
 26:       `Fatal authentication failure (HTTP ${status}) for provider "${provider}" key index ${keyIndex}: rejecting immediately with zero retry.`
 27:     );
 28:     this.name = "FatalAuthError";
 29:     this.status = status;
 30:     this.provider = provider;
 31:     this.keyIndex = keyIndex;
 32:   }
 33: }
 34: 
 35: export function isFatalAuthError(err: unknown): err is FatalAuthError {
 36:   return err instanceof FatalAuthError || (err instanceof Error && err.name === "FatalAuthError");
 37: }
 38: 
 39: export function isProviderQuarantineEnabled(provider: string): boolean {
 40:   try {
 41:     const provConfig = getProviderConfig(provider) as { key_cooldown?: { enabled?: boolean } };
 42:     const norm = provider.toLowerCase();
 43:     const defaultEnabled = norm === "zn" || norm === "gc" ? false : true;
 44:     return provConfig.key_cooldown?.enabled ?? defaultEnabled;
 45:   } catch {
 46:     return true;
 47:   }
 48: }
 49: 
 50: export class KeyPool extends EventEmitter {
 51:   private readonly pools = new Map<string, readonly string[]>();
 52:   private readonly pointers = new Map<string, number>();
 53:   private readonly activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
 54:   private readonly cooldownManager: CooldownManager;
 55: 
 56:   public constructor(cooldownManager?: CooldownManager) {
 57:     super();
 58:     this.cooldownManager = cooldownManager ?? new CooldownManager();
 59:   }
 60: 
 61:   public setPool(provider: ProviderCode | string, keys: readonly string[]): void {
 62:     this.pools.set(provider, Object.freeze([...keys]));
 63:     if (!this.pointers.has(provider)) {
 64:       this.pointers.set(provider, 0);
 65:     }
 66:   }
 67: 
 68:   public getCooldownManager(): CooldownManager {
 69:     return this.cooldownManager;
 70:   }
 71: 
 72:   private makeKeyId(provider: string, index: number): string {
 73:     return `${provider}:${index}`;
 74:   }
 75: 
 76:   private getKeys(provider: string): readonly string[] {
 77:     return this.pools.get(provider) ?? [];
 78:   }
 79: 
 80:   private advancePointer(provider: string, total: number): void {
 81:     const curr = this.pointers.get(provider) ?? 0;
 82:     this.pointers.set(provider, (curr + 1) % total);
 83:   }
 84: 
 85:   public isQuarantineEnabled(provider: string): boolean {
 86:     return isProviderQuarantineEnabled(provider);
 87:   }
 88: 
 89:   private tryPickIndex(
 90:     provider: string,
 91:     idx: number,
 92:     keys: readonly string[],
 93:     now: number
 94:   ): SelectedKey | null {
 95:     const keyId = this.makeKeyId(provider, idx);
 96:     if (this.isQuarantineEnabled(provider) && this.cooldownManager.isQuarantined(keyId, now)) {
 97:       return null;
 98:     }
 99:     const key = keys[idx];
100:     if (!key) {
101:       return null;
102:     }
103:     this.advancePointer(provider, keys.length);
104:     return { key, index: idx, totalKeys: keys.length };
105:   }
106: 
107:   public selectNextKey(provider: ProviderCode | string, now: number = Date.now()): SelectedKey | null {
108:     const keys = this.getKeys(provider);
109:     const total = keys.length;
110:     if (total === 0) {
111:       return null;
112:     }
113:     const startIndex = this.pointers.get(provider) ?? 0;
114:     for (let offset = 0; offset < total; offset += 1) {
115:       const idx = (startIndex + offset) % total;
116:       const picked = this.tryPickIndex(provider, idx, keys, now);
117:       if (picked !== null) {
118:         return picked;
119:       }
120:     }
121:     return null;
122:   }
123: 
124:   private scheduleAvailabilityTimer(keyId: string, provider: string, ttlMs: number): void {
125:     const existing = this.activeTimers.get(keyId);
126:     if (existing) {
127:       clearTimeout(existing);
128:       this.activeTimers.delete(keyId);
129:     }
130:     if (ttlMs > 0) {
131:       const timer = setTimeout(() => {
132:         this.activeTimers.delete(keyId);
133:         this.emit(`available:${provider}`, provider);
134:         this.emit("available", provider);
135:       }, ttlMs);
136:       this.activeTimers.set(keyId, timer);
137:     }
138:   }
139: 
140:   public reportSuccess(provider: string, index: number): void {
141:     const keyId = this.makeKeyId(provider, index);
142:     this.cooldownManager.clearCooldown(keyId);
143:     const existing = this.activeTimers.get(keyId);
144:     if (existing) {
145:       clearTimeout(existing);
146:       this.activeTimers.delete(keyId);
147:     }
148:     this.emit(`available:${provider}`, provider);
149:     this.emit("available", provider);
150:   }
151: 
152:   public reportFailure(
153:     provider: string,
154:     index: number,
155:     status: number,
156:     headers?: Headers | Record<string, string>,
157:     body?: string,
158:     now: number = Date.now(),
159:     customTtlSec?: number
160:   ): KeyCooldownState {
161:     if (status === 401 || status === 403) {
162:       throw new FatalAuthError(provider, index, status, body);
163:     }
164:     if (!this.isQuarantineEnabled(provider)) {
165:       return {
166:         quarantinedUntil: 0,
167:         reason: "quarantine_disabled",
168:         lastErrorStatus: status,
169:       };
170:     }
171:     const keyId = this.makeKeyId(provider, index);
172:     const state = this.cooldownManager.quarantineKey(keyId, status, headers, body, now, customTtlSec);
173:     this.scheduleAvailabilityTimer(keyId, provider, state.quarantinedUntil - now);
174:     return state;
175:   }
176: 
177:   public quarantineKey(
178:     provider: string,
179:     index: number,
180:     ttlSec: number,
181:     reason?: string,
182:     status?: number,
183:     now: number = Date.now()
184:   ): KeyCooldownState {
185:     if (!this.isQuarantineEnabled(provider)) {
186:       return {
187:         quarantinedUntil: 0,
188:         reason: reason ?? "quarantine_disabled",
189:         lastErrorStatus: status,
190:       };
191:     }
192:     const keyId = this.makeKeyId(provider, index);
193:     const state = this.cooldownManager.quarantineKeyWithTtl(keyId, ttlSec, reason, status, now);
194:     this.scheduleAvailabilityTimer(keyId, provider, state.quarantinedUntil - now);
195:     return state;
196:   }
197: 
198:   public conserveKey(
199:     provider: string,
200:     index: number,
201:     ttlSec: number,
202:     reason: string = "conserve_key",
203:     status?: number,
204:     now: number = Date.now()
205:   ): KeyCooldownState {
206:     const keyId = this.makeKeyId(provider, index);
207:     const state = this.cooldownManager.quarantineKeyWithTtl(keyId, ttlSec, reason, status, now);
208:     this.scheduleAvailabilityTimer(keyId, provider, state.quarantinedUntil - now);
209:     return state;
210:   }
211: 
212:   public async waitForKeyAvailable(
213:     provider: ProviderCode | string,
214:     timeoutMs: number,
215:     signal?: AbortSignal,
216:     now: number = Date.now()
217:   ): Promise<SelectedKey | null> {
218:     const immediate = this.selectNextKey(provider, now);
219:     if (immediate !== null) {
220:       return immediate;
221:     }
222:     if (timeoutMs <= 0 || signal?.aborted) {
223:       return null;
224:     }
225:     return new Promise<SelectedKey | null>((resolve) => {
226:       let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
227:       const eventName = `available:${provider}`;
228: 
229:       const cleanup = (): void => {
230:         if (timeoutTimer !== null) {
231:           clearTimeout(timeoutTimer);
232:           timeoutTimer = null;
233:         }
234:         this.removeListener(eventName, onAvailable);
235:         if (signal) {
236:           signal.removeEventListener("abort", onAbort);
237:         }
238:       };
239: 
240:       const onAvailable = (): void => {
241:         const selected = this.selectNextKey(provider);
242:         if (selected !== null) {
243:           cleanup();
244:           resolve(selected);
245:         }
246:       };
247: 
248:       const onAbort = (): void => {
249:         cleanup();
250:         resolve(null);
251:       };
252: 
253:       timeoutTimer = setTimeout(() => {
254:         cleanup();
255:         resolve(this.selectNextKey(provider));
256:       }, timeoutMs);
257: 
258:       this.on(eventName, onAvailable);
259:       if (signal) {
260:         signal.addEventListener("abort", onAbort, { once: true });
261:       }
262:     });
263:   }
264: 
265:   public getPoolSize(provider: string): number {
266:     return this.getKeys(provider).length;
267:   }
268: 
269:   public getStatus(provider: string, now: number = Date.now()): PoolStatus {
270:     const keys = this.getKeys(provider);
271:     const total = keys.length;
272:     if (!this.isQuarantineEnabled(provider)) {
273:       return { total, active: total, quarantined: 0 };
274:     }
275:     let quarantined = 0;
276:     for (let i = 0; i < total; i += 1) {
277:       const keyId = this.makeKeyId(provider, i);
278:       if (this.cooldownManager.isQuarantined(keyId, now)) {
279:         quarantined += 1;
280:       }
281:     }
282:     return { total, active: total - quarantined, quarantined };
283:   }
284: 
285:   public getMinQuarantineTtlMs(provider: string, now: number = Date.now()): number {
286:     if (!this.isQuarantineEnabled(provider)) {
287:       return 0;
288:     }
289:     return this.cooldownManager.getMinQuarantineTtlMs(provider, now);
290:   }
291: 
292:   public getDynamicMaxQueueDepth(provider: string): number {
293:     const status = this.getStatus(provider);
294:     return Math.max(10, status.active * 10);
295:   }
296: 
297:   public shouldLoadShed(
298:     provider: string,
299:     currentDwellMs: number,
300:     maxWaitMs: number = 20000,
301:     now: number = Date.now()
302:   ): boolean {
303:     const status = this.getStatus(provider, now);
304:     if (status.active > 0) return false;
305:     if (status.total === 0) return false;
306:     const minTtl = this.getMinQuarantineTtlMs(provider, now);
307:     const remainingWaitMs = Math.max(0, maxWaitMs - currentDwellMs);
308:     return minTtl > remainingWaitMs;
309:   }
310: 
311:   private resetProvider(provider: string): void {
312:     this.pointers.delete(provider);
313:     const prefix = `${provider}:`;
314:     for (const [keyId, timer] of this.activeTimers) {
315:       if (keyId === provider || keyId.startsWith(prefix)) {
316:         clearTimeout(timer);
317:         this.activeTimers.delete(keyId);
318:       }
319:     }
320:     const keys = this.getKeys(provider);
321:     for (let i = 0; i < keys.length; i += 1) {
322:       this.cooldownManager.clearCooldown(this.makeKeyId(provider, i));
323:     }
324:     this.emit(`available:${provider}`, provider);
325:     this.emit("available", provider);
326:   }
327: 
328:   public reset(provider?: string): void {
329:     if (provider) {
330:       this.resetProvider(provider);
331:       return;
332:     }
333:     this.pointers.clear();
334:     for (const timer of this.activeTimers.values()) {
335:       clearTimeout(timer);
336:     }
337:     this.activeTimers.clear();
338:     this.cooldownManager.clearAll();
339:     this.emit("available");
340:   }
341: }
```

## File: package.json
```json
 1: {
 2:   "name": "literouter",
 3:   "version": "4.1.0",
 4:   "description": "Ultra-fast declarative LLM API gateway and resilient proxy on Bun",
 5:   "main": "src/index.ts",
 6:   "types": "src/lib.ts",
 7:   "scripts": {
 8:     "start": "bun run src/index.ts",
 9:     "dev": "bun --watch src/index.ts",
10:     "test": "bun run scripts/test/test_runner.ts",
11:     "test:lr": "bun run scripts/test/test_runner.ts",
12:     "test:gateway": "bun run scripts/test/test_runner.ts",
13:     "test:unit": "bun run scripts/test/test_runner.ts",
14:     "test:raw": "bun test",
15:     "test:eval": "bun run scripts/test/test_runner.ts eval",
16:     "test:failures": "bun test --only-failures",
17:     "test:zen": "bun run scripts/test/test_zen_fixes.ts",
18:     "typecheck": "tsc --noEmit",
19:     "doctor": "bun run scripts/diagnose/doctor.ts",
20:     "doctor:full": "bun run scripts/diagnose/doctor_full.ts",
21:     "flush": "bun run scripts/gateway/flush.ts",
22:     "guardrail": "bun run scripts/hooks/guardrail.ts"
23:   },
24:   "dependencies": {
25:     "zod": "^3.23.8"
26:   },
27:   "devDependencies": {
28:     "@types/bun": "latest",
29:     "@types/node": "^22.5.4",
30:     "typescript": "^5.5.4"
31:   }
32: }
```

## File: src/engine/dispatch.ts
```typescript
  1: import { getEnv } from "../config/env";
  2: import { getProviderConfig } from "../config/providers";
  3: import type { ProviderConfigEntry } from "../config/schema";
  4: import type { ParsedDirective } from "../directive/types";
  5: import { acquirePacer } from "./pacer_adapter";
  6: import { calculateRetryDelay } from "./retry";
  7: import { defaultClassifyFailure, type FailureAction } from "./status_classify";
  8: import type { DispatchContext, ProviderExecutionStrategy } from "./strategy";
  9: import { getStrategy } from "./strategy_registry";
 10: import { safeClose, safeEnqueue, NoResponseError } from "../network/fetcher";
 11: import { isProviderQuarantineEnabled } from "../network/pool";
 12: import type { OutboundWirePayload, PayloadTransformerContract } from "./transformer";
 13: import { globalKeyPool, overrideProviderUrl } from "../handlers/openai_compat";
 14: import { RequestTelemetry, type UsageRecord } from "../telemetry/session";
 15: import { traceBuffer, type SanitizedTrace } from "../telemetry/ring_buffer";
 16: import { traceWriter } from "../telemetry/trace_writer";
 17: import { sanitizeBody } from "../telemetry/sanitize";
 18: import { extractErrorMessage } from "../ui/logger";
 19: import { ensureSessionHeaders } from "./session_id";
 20: 
 21: export type { OutboundWirePayload, PayloadTransformerContract };
 22: 
 23: export interface DispatchRequest {
 24:   readonly reqId: string;
 25:   readonly method: string;
 26:   readonly path: string;
 27:   readonly directive: ParsedDirective;
 28:   readonly rawInboundBody: Record<string, unknown>;
 29:   readonly outboundPayload: OutboundWirePayload;
 30:   readonly clientSignal: AbortSignal;
 31:   readonly clientHeaders: Headers;
 32:   readonly transformer: PayloadTransformerContract;
 33: }
 34: 
 35: export interface ResolvedTarget {
 36:   readonly model: string;
 37:   readonly upstreamUrl: string;
 38:   readonly extraHeaders?: Record<string, string>;
 39:   readonly tier?: number;
 40: }
 41: 
 42: export type FetchFn = (
 43:   input: string | URL | Request,
 44:   init?: RequestInit
 45: ) => Promise<Response>;
 46: 
 47: function defaultTarget(
 48:   provConfig: ProviderConfigEntry,
 49:   req: DispatchRequest
 50: ): ResolvedTarget {
 51:   const endpointKey = req.outboundPayload.endpointKey as keyof typeof provConfig.endpoints;
 52:   const endpointPath = (provConfig.endpoints[endpointKey] as string | undefined) ?? "";
 53:   const base = provConfig.base_url.replace(/\/+$/, "");
 54:   const rel = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
 55:   const model = String(req.rawInboundBody.model ?? "default");
 56: 
 57:   return {
 58:     model,
 59:     upstreamUrl: `${base}${rel}`,
 60:   };
 61: }
 62: 
 63: function defaultAuthHeaders(
 64:   provConfig: ProviderConfigEntry,
 65:   key: string
 66: ): Record<string, string> {
 67:   const authType = provConfig.auth_header;
 68:   if (authType === "x-api-key") {
 69:     return { "x-api-key": key };
 70:   }
 71:   return { Authorization: `Bearer ${key}` };
 72: }
 73: 
 74: function setHeaderCaseInsensitive(
 75:   headers: Record<string, string>,
 76:   key: string,
 77:   value: string
 78: ): void {
 79:   const lower = key.toLowerCase();
 80:   for (const existingKey of Object.keys(headers)) {
 81:     if (existingKey.toLowerCase() === lower) {
 82:       delete headers[existingKey];
 83:     }
 84:   }
 85:   headers[key] = value;
 86: }
 87: 
 88: export const BANNED_OUTBOUND_HEADERS = new Set([
 89:   "host",
 90:   "connection",
 91:   "keep-alive",
 92:   "proxy-authenticate",
 93:   "proxy-authorization",
 94:   "te",
 95:   "trailer",
 96:   "transfer-encoding",
 97:   "upgrade",
 98:   "content-encoding",
 99:   "content-length",
100: ]);
101: 
102: function isBannedOutboundHeader(key: string): boolean {
103:   const lowerKey = key.toLowerCase();
104:   return lowerKey === "host" || BANNED_OUTBOUND_HEADERS.has(lowerKey);
105: }
106: 
107: function mergeHeaderSource(
108:   target: Record<string, string>,
109:   source?: Record<string, string>,
110:   filterHopByHop = false
111: ): void {
112:   if (!source) return;
113:   for (const [k, v] of Object.entries(source)) {
114:     if (filterHopByHop && isBannedOutboundHeader(k)) {
115:       continue;
116:     }
117:     setHeaderCaseInsensitive(target, k, v);
118:   }
119: }
120: 
121: export function mergeOutboundHeaders(
122:   authHeaders: Record<string, string>,
123:   injectedHeaders: Record<string, string>,
124:   provHeaders?: Record<string, string>,
125:   targetExtraHeaders?: Record<string, string>,
126:   payloadHeaders?: Record<string, string>,
127:   clientHeaders?: Headers | Record<string, string>,
128:   isZen?: boolean
129: ): Record<string, string> {
130:   const merged: Record<string, string> = {};
131:   setHeaderCaseInsensitive(merged, "content-type", "application/json");
132: 
133:   mergeHeaderSource(merged, payloadHeaders, true);
134:   mergeHeaderSource(merged, authHeaders);
135:   mergeHeaderSource(merged, injectedHeaders);
136:   mergeHeaderSource(merged, targetExtraHeaders);
137:   mergeHeaderSource(merged, provHeaders);
138: 
139:   ensureSessionHeaders(merged, clientHeaders ?? payloadHeaders);
140: 
141:   if (isZen) {
142:     const { scrubZenHeaders, buildZenHeaders } = require("./zen");
143:     scrubZenHeaders(merged);
144:     const zenHeaders = buildZenHeaders();
145:     for (const [k, v] of Object.entries(zenHeaders)) {
146:       setHeaderCaseInsensitive(merged, k, String(v));
147:     }
148:   }
149: 
150:   return merged;
151: }
152: 
153: function parseRetryAfterSec(headerVal: string | null): number | undefined {
154:   if (!headerVal) return undefined;
155:   const num = Number(headerVal);
156:   if (!Number.isNaN(num) && num >= 0) {
157:     return num;
158:   }
159:   const dateMs = Date.parse(headerVal);
160:   if (!Number.isNaN(dateMs)) {
161:     const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
162:     return Math.max(0, diffSec);
163:   }
164:   return undefined;
165: }
166: 
167: function extractUsage(body: unknown): UsageRecord {
168:   if (body && typeof body === "object" && "usage" in body) {
169:     const raw = (body as { usage?: Record<string, unknown> }).usage;
170:     if (raw && typeof raw === "object") {
171:       const promptTokens = typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : 0;
172:       const completionTokens = typeof raw.completion_tokens === "number" ? raw.completion_tokens : 0;
173:       const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : promptTokens + completionTokens;
174:       return {
175:         promptTokens,
176:         completionTokens,
177:         totalTokens,
178:       };
179:     }
180:   }
181:   return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
182: }
183: 
184: const DONE_CHUNK = new TextEncoder().encode("data: [DONE]\n\n");
185: 
186: function isAbortError(err: unknown): boolean {
187:   if (!err || typeof err !== "object") return false;
188:   const rec = err as { name?: unknown; code?: unknown };
189:   return rec.name === "AbortError" || rec.code === 20;
190: }
191: 
192: function resolveTtftTimeoutMs(): number {
193:   const env = getEnv();
194:   const configured = env.LITEROUTER_TTFT_TIMEOUT_MS || env.LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
195:   return configured && configured > 0 ? configured : 120000;
196: }
197: 
198: async function fetchWithTtftGuard(
199:   fetchFn: FetchFn,
200:   url: string,
201:   init: RequestInit,
202:   timeoutMs: number,
203:   clientSignal: AbortSignal
204: ): Promise<Response> {
205:   const linked = new AbortController();
206:   const onClientAbort = (): void => {
207:     linked.abort(clientSignal.reason);
208:   };
209:   if (clientSignal.aborted) {
210:     linked.abort(clientSignal.reason);
211:   } else {
212:     clientSignal.addEventListener("abort", onClientAbort, { once: true });
213:   }
214:   let timer: ReturnType<typeof setTimeout> | undefined;
215:   const timeoutPromise = new Promise<never>((_, reject) => {
216:     timer = setTimeout(() => {
217:       linked.abort(new DOMException(`TTFT exceeded ${timeoutMs}ms`, "TimeoutError"));
218:       reject(new NoResponseError(`Upstream TTFT timeout after ${timeoutMs}ms`));
219:     }, timeoutMs);
220:   });
221:   try {
222:     return await Promise.race([fetchFn(url, { ...init, signal: linked.signal }), timeoutPromise]);
223:   } finally {
224:     if (timer !== undefined) {
225:       clearTimeout(timer);
226:     }
227:     clientSignal.removeEventListener("abort", onClientAbort);
228:   }
229: }
230: 
231: function buildTtftTimeoutResponse(reqId: string, timeoutMs: number): Response {
232:   return new Response(
233:     JSON.stringify({
234:       error: {
235:         message: `Upstream TTFT timeout after ${timeoutMs}ms`,
236:         type: "timeout_error",
237:         code: "ttft_timeout",
238:       },
239:     }),
240:     {
241:       status: 504,
242:       headers: { "content-type": "application/json", "x-request-id": reqId },
243:     }
244:   );
245: }
246: 
247: function createCleanErrorResponse(
248:   upstreamResponse: Response,
249:   errText: string
250: ): Response {
251:   const cleanHeaders = new Headers(upstreamResponse.headers);
252:   cleanHeaders.delete("content-encoding");
253:   cleanHeaders.delete("content-length");
254:   cleanHeaders.delete("transfer-encoding");
255:   return new Response(errText, {
256:     status: upstreamResponse.status,
257:     statusText: upstreamResponse.statusText,
258:     headers: cleanHeaders,
259:   });
260: }
261: 
262: function createCutoffResilientStream(
263:   sourceStream: ReadableStream<Uint8Array>,
264:   onMidStreamError: (err: unknown) => void,
265:   clientSignal?: AbortSignal,
266:   onStreamComplete?: () => void
267: ): ReadableStream<Uint8Array> {
268:   const reader = sourceStream.getReader();
269:   let emittedDone = false;
270:   let cleanedUp = false;
271: 
272:   const doCleanup = () => {
273:     if (!cleanedUp) {
274:       cleanedUp = true;
275:       if (clientSignal) {
276:         clientSignal.removeEventListener("abort", doCleanup);
277:       }
278:       onStreamComplete?.();
279:     }
280:   };
281: 
282:   if (clientSignal?.aborted) {
283:     doCleanup();
284:   } else if (clientSignal) {
285:     clientSignal.addEventListener("abort", doCleanup, { once: true });
286:   }
287: 
288:   return new ReadableStream<Uint8Array>({
289:     async pull(controller): Promise<void> {
290:       try {
291:         const { done, value } = await reader.read();
292:         if (done) {
293:           doCleanup();
294:           safeClose(controller);
295:           return;
296:         }
297:         controller.enqueue(value);
298:       } catch (streamErr) {
299:         doCleanup();
300:         if (clientSignal?.aborted || isAbortError(streamErr)) {
301:           safeClose(controller);
302:           return;
303:         }
304:         onMidStreamError(streamErr);
305:         if (!emittedDone) {
306:           emittedDone = true;
307:           const errorChunk = new TextEncoder().encode(
308:             `data: ${JSON.stringify({
309:               id: `err-${Date.now()}`,
310:               object: "chat.completion.chunk",
311:               created: Math.floor(Date.now() / 1000),
312:               model: "error",
313:               error: {
314:                 message: streamErr instanceof Error ? streamErr.message : "Mid-stream connection error",
315:                 type: "server_error",
316:                 code: "mid_stream_error",
317:               },
318:               choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
319:             })}\n\n`
320:           );
321:           safeEnqueue(controller, errorChunk);
322:           safeEnqueue(controller, DONE_CHUNK);
323:         }
324:         safeClose(controller);
325:       }
326:     },
327:     async cancel(reason): Promise<void> {
328:       doCleanup();
329:       await reader.cancel(reason);
330:     },
331:   });
332: }
333: 
334: function buildDirectiveTelemetryParams(req: DispatchRequest): {
335:   targetProvider?: string;
336:   wireFormat?: string;
337:   endpoint?: string;
338:   nuances?: readonly string[];
339: } {
340:   if (req.directive.type === "direct") {
341:     return {
342:       targetProvider: req.directive.provider,
343:       wireFormat: req.directive.wire,
344:       endpoint: req.directive.completion,
345:       nuances: req.directive.nuances,
346:     };
347:   }
348:   return {
349:     targetProvider: "fusion",
350:     wireFormat: "oa",
351:     endpoint: "ch",
352:   };
353: }
354: 
355: function recordTrace(
356:   telemetry: RequestTelemetry,
357:   status: number,
358:   legs: {
359:     clientInbound?: string;
360:     upstreamOutbound?: string;
361:     upstreamInbound?: string;
362:     clientOutbound?: string;
363:   }
364: ): void {
365:   const metrics = telemetry.toTraceMetrics();
366:   const trace: SanitizedTrace = {
367:     reqId: metrics.reqId,
368:     createdAt: Date.now(),
369:     provider: metrics.provider,
370:     model: metrics.model,
371:     status,
372:     durationMs: metrics.durationMs,
373:     ttftMs: metrics.ttftMs,
374:     tokensPrompt: metrics.promptTokens,
375:     tokensCompletion: metrics.completionTokens,
376:     legs: {
377:       clientInbound: legs.clientInbound ?? "",
378:       upstreamOutbound: legs.upstreamOutbound ?? "",
379:       upstreamInbound: legs.upstreamInbound ?? "",
380:       clientOutbound: legs.clientOutbound ?? "",
381:     },
382:   };
383:   traceBuffer.push(trace);
384:   traceWriter.enqueue(trace);
385: }
386: 
387: export async function executeDispatchPipeline(
388:   req: DispatchRequest,
389:   fetchFn: FetchFn = fetch
390: ): Promise<Response> {
391:   const providerCode = req.directive.type === "direct" ? req.directive.provider : "or";
392:   const provConfig = getProviderConfig(providerCode);
393:   const strategy: ProviderExecutionStrategy = getStrategy(providerCode);
394: 
395:   const dirParams = buildDirectiveTelemetryParams(req);
396:   const modelName = String(req.rawInboundBody.model ?? "unknown");
397: 
398:   const telemetry = new RequestTelemetry({
399:     reqId: req.reqId,
400:     method: req.method,
401:     path: req.path,
402:     clientAgent: req.clientHeaders.get("user-agent") ?? "Unknown",
403:     directiveStr: req.directive.raw,
404:     model: modelName,
405:     ...dirParams,
406:   });
407: 
408:   let initialTarget: ResolvedTarget;
409:   try {
410:     const resolutionCtx: DispatchContext = {
411:       reqId: req.reqId,
412:       path: req.path,
413:       directive: req.directive,
414:       providerConfig: provConfig,
415:       telemetry,
416:       clientSignal: req.clientSignal,
417:       selectedKey: { key: "", index: 0, poolSize: 1 },
418:       attempt: 1,
419:       maxAttempts: provConfig.request_retry.enabled ? provConfig.request_retry.max_attempts : 1,
420:     };
421:     initialTarget =
422:       (strategy.resolveTarget?.(resolutionCtx, req.rawInboundBody) as ResolvedTarget | undefined) ??
423:       defaultTarget(provConfig, req);
424:   } catch {
425:     initialTarget = defaultTarget(provConfig, req);
426:   }
427: 
428:   const initialTier =
429:     initialTarget.tier ??
430:     (initialTarget.extraHeaders?.["x-literouter-tier"]
431:       ? parseInt(initialTarget.extraHeaders["x-literouter-tier"].split("/")[0] ?? "", 10) || undefined
432:       : undefined);
433: 
434:   telemetry.setResolvedTarget(initialTarget.model, initialTier);
435:   telemetry.emitInbound();
436: 
437:   const poolSize = globalKeyPool.getPoolSize(providerCode);
438:   const initialKey = globalKeyPool.selectNextKey(providerCode);
439: 
440:   const initialCtx: DispatchContext = {
441:     reqId: req.reqId,
442:     path: req.path,
443:     directive: req.directive,
444:     providerConfig: provConfig,
445:     telemetry,
446:     clientSignal: req.clientSignal,
447:     selectedKey: {
448:       key: initialKey?.key ?? "",
449:       index: initialKey?.index ?? 0,
450:       poolSize: Math.max(1, poolSize),
451:     },
452:     attempt: 1,
453:     maxAttempts: provConfig.request_retry.enabled ? provConfig.request_retry.max_attempts : 1,
454:   };
455: 
456:   const preResult = strategy.preDispatch?.(initialCtx, req.rawInboundBody);
457:   if (preResult) {
458:     telemetry.served(preResult.status);
459:     recordTrace(telemetry, preResult.status, {
460:       clientInbound: sanitizeBody(req.rawInboundBody),
461:     });
462:     return preResult;
463:   }
464: 
465:   const retryConfig = provConfig.request_retry;
466:   const maxAttempts = retryConfig.enabled ? retryConfig.max_attempts : 1;
467:   const ttftTimeoutMs = resolveTtftTimeoutMs();
468: 
469:   for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
470:     if (req.clientSignal.aborted) {
471:       throw new DOMException("The operation was aborted.", "AbortError");
472:     }
473: 
474:     const pacerLease = await acquirePacer(providerCode, provConfig.pacer, req.clientSignal);
475: 
476:     const key = attempt === 1 && initialKey
477:       ? initialKey
478:       : globalKeyPool.selectNextKey(providerCode);
479: 
480:     if (!key) {
481:       pacerLease?.release();
482:       telemetry.error("All keys exhausted or in cooldown");
483:       telemetry.served(429, attempt, maxAttempts);
484:       recordTrace(telemetry, 429, {
485:         clientInbound: sanitizeBody(req.rawInboundBody),
486:         clientOutbound: JSON.stringify({
487:           error: {
488:             message: "All keys in cooldown or exhausted",
489:             type: "rate_limit_error",
490:             code: "keys_exhausted",
491:           },
492:         }),
493:       });
494:       return new Response(
495:         JSON.stringify({
496:           error: {
497:             message: "All keys in cooldown or exhausted",
498:             type: "rate_limit_error",
499:             code: "keys_exhausted",
500:           },
501:         }),
502:         {
503:           status: 429,
504:           headers: { "content-type": "application/json", "x-request-id": req.reqId },
505:         }
506:       );
507:     }
508: 
509:     telemetry.setKeyIndex(key.index, key.totalKeys);
510: 
511:     const currentCtx: DispatchContext = {
512:       ...initialCtx,
513:       selectedKey: {
514:         key: key.key,
515:         index: key.index,
516:         poolSize: Math.max(1, key.totalKeys),
517:       },
518:       attempt,
519:       maxAttempts,
520:     };
521: 
522:     const resolvedTarget = strategy.resolveTarget?.(currentCtx, req.rawInboundBody) ?? defaultTarget(provConfig, req);
523:     const targetTier =
524:       (resolvedTarget as ResolvedTarget).tier ??
525:       (resolvedTarget.extraHeaders?.["x-literouter-tier"]
526:         ? parseInt(resolvedTarget.extraHeaders["x-literouter-tier"].split("/")[0] ?? "", 10) || undefined
527:         : undefined);
528:     const target: ResolvedTarget = {
529:       ...resolvedTarget,
530:       tier: targetTier,
531:       upstreamUrl: overrideProviderUrl(resolvedTarget.upstreamUrl, providerCode),
532:     };
533: 
534:     if (
535:       resolvedTarget.model !== telemetry.session.resolvedModel ||
536:       targetTier !== telemetry.session.tier
537:     ) {
538:       telemetry.setResolvedTarget(resolvedTarget.model, targetTier);
539:       telemetry.emitResolvedModel();
540:     } else {
541:       telemetry.setResolvedTarget(resolvedTarget.model, targetTier);
542:     }
543:     const authHeaders = strategy.buildAuthHeaders?.(key.key, req.clientHeaders) ?? defaultAuthHeaders(provConfig, key.key);
544:     const injectedHeaders = strategy.injectHeaders?.(currentCtx, authHeaders) ?? authHeaders;
545:     const isZen =
546:       provConfig.code === "zn" ||
547:       provConfig.name?.toLowerCase() === "zen" ||
548:       provConfig.strategy === "zen";
549:     const finalHeaders = mergeOutboundHeaders(
550:       authHeaders,
551:       injectedHeaders,
552:       provConfig.headers,
553:       target.extraHeaders,
554:       req.outboundPayload.headers,
555:       req.clientHeaders,
556:       isZen
557:     );
558: 
559:     try {
560:       const upstreamResponse = await fetchWithTtftGuard(
561:         fetchFn,
562:         target.upstreamUrl,
563:         {
564:           method: req.outboundPayload.method,
565:           headers: finalHeaders,
566:           body: JSON.stringify(req.outboundPayload.body),
567:           signal: req.clientSignal,
568:         },
569:         ttftTimeoutMs,
570:         req.clientSignal
571:       );
572: 
573:       if (upstreamResponse.status < 400) {
574:         if (provConfig.key_cooldown?.reset_after_success) {
575:           globalKeyPool.reportSuccess(providerCode, key.index);
576:         }
577: 
578:         if (req.outboundPayload.isStreaming) {
579:           const wireTransformStream = req.transformer.createWireToClientStream(
580:             req.directive,
581:             telemetry,
582:             req.clientSignal
583:           );
584: 
585:           const rawBody = upstreamResponse.body ?? new ReadableStream<Uint8Array>();
586:           const transformedStream = rawBody.pipeThrough(wireTransformStream);
587: 
588:           const resilientStream = createCutoffResilientStream(
589:             transformedStream,
590:             (streamErr) => {
591:               telemetry.error("Mid-stream upstream failure encountered", streamErr);
592:             },
593:             req.clientSignal,
594:             () => pacerLease?.release()
595:           );
596: 
597:           telemetry.served(upstreamResponse.status, attempt, maxAttempts);
598:           recordTrace(telemetry, upstreamResponse.status, {
599:             clientInbound: sanitizeBody(req.rawInboundBody),
600:             upstreamOutbound: sanitizeBody(req.outboundPayload.body),
601:             clientOutbound: "[STREAM]",
602:           });
603: 
604:           return new Response(resilientStream, {
605:             status: upstreamResponse.status,
606:             statusText: upstreamResponse.statusText,
607:             headers: {
608:               "content-type": "text/event-stream; charset=utf-8",
609:               "cache-control": "no-cache",
610:               connection: "keep-alive",
611:               "x-request-id": req.reqId,
612:             },
613:           });
614:         }
615: 
616:         // If the upstream responded with an event stream but client requested non-streaming (e.g. Zen adaptation),
617:         // accumulate SSE events into a chat.completion or responses JSON object
618:         if (upstreamResponse.headers.get("content-type")?.includes("text/event-stream") && upstreamResponse.body) {
619:           const { accumulateZenStreamToCompletion, accumulateZenResponsesStream } = require("./zen");
620:           const isResponses = req.outboundPayload.endpointKey === "rs";
621:           const accumulated = isResponses
622:             ? await accumulateZenResponsesStream(upstreamResponse.body, String(req.outboundPayload.body?.model ?? ""))
623:             : await accumulateZenStreamToCompletion(upstreamResponse.body, String(req.outboundPayload.body?.model ?? ""));
624:           const clientJson = req.transformer.transformWireToClient(accumulated, req.directive);
625:           telemetry.recordUsage(extractUsage(accumulated));
626:           telemetry.served(upstreamResponse.status, attempt, maxAttempts);
627:           pacerLease?.release();
628:           return new Response(JSON.stringify(clientJson), {
629:             status: upstreamResponse.status,
630:             statusText: upstreamResponse.statusText,
631:             headers: {
632:               "content-type": "application/json; charset=utf-8",
633:               "x-request-id": req.reqId,
634:             },
635:           });
636:         }
637: 
638:         // Read outside the parse guard: transport failures retain their retry policy.
639:         const responseText = await upstreamResponse.text();
640:         let jsonBody: Record<string, unknown>;
641:         try {
642:           jsonBody = JSON.parse(responseText) as Record<string, unknown>;
643:         } catch {
644:           // Never echo the body or parser exception: upstream pages may contain secrets.
645:           const contentType = (upstreamResponse.headers.get("content-type") ?? "missing")
646:             .split(";")[0]!.trim().slice(0, 100).replace(/[^a-zA-Z0-9/+._-]/g, "_");
647:           const error = {
648:             message: `Provider ${providerCode} returned non-JSON or malformed JSON (HTTP ${upstreamResponse.status}, content-type ${contentType})`,
649:             type: "upstream_response_error",
650:             code: "invalid_upstream_response",
651:             upstream_status: upstreamResponse.status,
652:             upstream_content_type: contentType,
653:           };
654:           pacerLease?.release();
655:           telemetry.error(error.message);
656:           telemetry.served(502, attempt, maxAttempts);
657:           return Response.json({ error }, {
658:             status: 502,
659:             headers: { "x-request-id": req.reqId },
660:           });
661:         }
662:         const clientJson = req.transformer.transformWireToClient(jsonBody, req.directive);
663:         telemetry.recordUsage(extractUsage(jsonBody));
664:         telemetry.served(upstreamResponse.status, attempt, maxAttempts);
665:         recordTrace(telemetry, upstreamResponse.status, {
666:           clientInbound: sanitizeBody(req.rawInboundBody),
667:           upstreamOutbound: sanitizeBody(req.outboundPayload.body),
668:           upstreamInbound: sanitizeBody(jsonBody),
669:           clientOutbound: sanitizeBody(clientJson),
670:         });
671: 
672:         pacerLease?.release();
673:         return new Response(JSON.stringify(clientJson), {
674:           status: upstreamResponse.status,
675:           statusText: upstreamResponse.statusText,
676:           headers: {
677:             "content-type": "application/json",
678:             "x-request-id": req.reqId,
679:           },
680:         });
681:       }
682: 
683:       // Upstream failure classification
684:       const errText = await upstreamResponse.text();
685:       const rawErrorMsg = extractErrorMessage(errText);
686:       const quarantineEnabled = isProviderQuarantineEnabled(providerCode);
687:       const rawRetryAfterSec = parseRetryAfterSec(upstreamResponse.headers.get("retry-after"));
688:       const retryAfterSec = quarantineEnabled ? rawRetryAfterSec : undefined;
689: 
690:       telemetry.recordLimit({
691:         status: upstreamResponse.status,
692:         retryAfterSec,
693:         totalKeys: key.totalKeys,
694:         rawMessage: rawErrorMsg,
695:         hasUpstreamRetryAfter: retryAfterSec !== undefined,
696:       });
697: 
698:       const failureAction: FailureAction = strategy.classifyFailure?.(currentCtx, upstreamResponse.status)
699:         ?? defaultClassifyFailure(upstreamResponse.status);
700: 
701:       if (failureAction === "fail_fast") {
702:         pacerLease?.release();
703:         telemetry.served(upstreamResponse.status, attempt, maxAttempts);
704:         recordTrace(telemetry, upstreamResponse.status, {
705:           clientInbound: sanitizeBody(req.rawInboundBody),
706:           upstreamOutbound: sanitizeBody(req.outboundPayload.body),
707:         });
708:         return createCleanErrorResponse(upstreamResponse, errText);
709:       }
710: 
711:       if (failureAction === "advance_target") {
712:         pacerLease?.release();
713:         telemetry.rotateKey({
714:           fromIndex: key.index,
715:           toIndex: -1,
716:           totalKeys: key.totalKeys,
717:           attempt,
718:           maxAttempts,
719:         });
720:         continue;
721:       }
722: 
723:       // failureAction === "retry_same_target"
724:       pacerLease?.release();
725: 
726:       if (attempt < maxAttempts) {
727:         const delayMs = retryAfterSec !== undefined
728:           ? Math.min(retryAfterSec * 1000, 15000)
729:           : calculateRetryDelay(retryConfig.delay, attempt);
730:         await Bun.sleep(delayMs);
731:         telemetry.rotateKey({
732:           fromIndex: key.index,
733:           toIndex: -1,
734:           totalKeys: key.totalKeys,
735:           attempt: attempt + 1,
736:           maxAttempts,
737:         });
738:         continue;
739:       }
740: 
741:       telemetry.served(upstreamResponse.status, attempt, maxAttempts);
742:       recordTrace(telemetry, upstreamResponse.status, {
743:         clientInbound: sanitizeBody(req.rawInboundBody),
744:         upstreamOutbound: sanitizeBody(req.outboundPayload.body),
745:       });
746:       return createCleanErrorResponse(upstreamResponse, errText);
747:     } catch (err) {
748:       pacerLease?.release();
749:       if (req.clientSignal.aborted) {
750:         throw err;
751:       }
752: 
753:       if (err instanceof NoResponseError) {
754:         telemetry.error("Upstream TTFT timeout during dispatch attempt", err);
755: 
756:         if (attempt < maxAttempts) {
757:           const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
758:           await Bun.sleep(delayMs);
759:           continue;
760:         }
761: 
762:         telemetry.served(504, attempt, maxAttempts);
763:         recordTrace(telemetry, 504, {
764:           clientInbound: sanitizeBody(req.rawInboundBody),
765:           upstreamOutbound: sanitizeBody(req.outboundPayload.body),
766:         });
767:         return buildTtftTimeoutResponse(req.reqId, ttftTimeoutMs);
768:       }
769: 
770:       telemetry.error("Network or fetch error during dispatch attempt", err);
771: 
772:       if (attempt < maxAttempts) {
773:         const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
774:         await Bun.sleep(delayMs);
775:         continue;
776:       }
777: 
778:       telemetry.served(500, attempt, maxAttempts);
779:       recordTrace(telemetry, 500, {
780:         clientInbound: sanitizeBody(req.rawInboundBody),
781:         upstreamOutbound: sanitizeBody(req.outboundPayload.body),
782:       });
783: 
784:       throw err;
785:     }
786:   }
787: 
788:   telemetry.error("All retry attempts exhausted");
789:   telemetry.served(502);
790:   recordTrace(telemetry, 502, {
791:     clientInbound: sanitizeBody(req.rawInboundBody),
792:     upstreamOutbound: sanitizeBody(req.outboundPayload.body),
793:   });
794:   return new Response(
795:     JSON.stringify({
796:       error: {
797:         message: `Provider ${provConfig.name ?? providerCode} retry attempts exhausted`,
798:         type: "gateway_error",
799:         code: "retries_exhausted",
800:       },
801:     }),
802:     {
803:       status: 502,
804:       headers: { "content-type": "application/json" },
805:     }
806:   );
807: }
```

## File: src/handlers/openai_original.ts
```typescript
   1: import type { ParsedDirective } from "../directive/parser";
   2: import { validateDirective } from "../directive/validator";
   3: import { getEnv } from "../config/env";
   4: import { getProviderConfig, isRegisteredProvider } from "../config/providers";
   5: import { calculateRetryDelay } from "../engine/retry";
   6: import { classifyUpstreamError } from "../network/classifier";
   7: import {
   8:   fetchWithTtftGuard,
   9:   reassembleResponse,
  10:   sanitizeDownstreamHeaders,
  11:   type FetcherOptions,
  12:   type OutboundProtocol,
  13: } from "../network/fetcher";
  14: import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
  15: import { isFatalAuthError } from "../network/pool";
  16: import {
  17:   buildAuthHeaders,
  18:   globalKeyPool,
  19:   initializeKeyPools,
  20:   overrideProviderUrl,
  21:   resolveUpstreamEndpoint,
  22: } from "./openai_compat";
  23: import {
  24:   EMOJI,
  25:   extractErrorMessage,
  26:   formatTimestamp,
  27:   logError,
  28:   logExhausted,
  29:   logFinishReason,
  30:   logInbound,
  31:   logInfo,
  32:   logLimit,
  33:   logRotate,
  34:   logSeparator,
  35:   logServed,
  36:   logTtft,
  37:   logUsage,
  38:   logWarn,
  39: } from "../ui/logger";
  40: export {
  41:   OpenAIResponsesTransformer,
  42:   openAiResponsesTransformer,
  43: } from "../transformers/openai_responses";
  44: 
  45: export type Directive =
  46:   | ParsedDirective
  47:   | {
  48:       readonly provider: string;
  49:       readonly raw?: string;
  50:       readonly type?: string;
  51:       readonly [key: string]: unknown;
  52:     };
  53: 
  54: export interface KeyPoolManager {
  55:   getKey?(provider: string): string | null;
  56:   selectNextKey?(provider: string): { key: string; index: number } | null;
  57:   getNextKey?(provider: string): string | null;
  58: }
  59: 
  60: export interface GatewayState {
  61:   readonly keyPoolManager?: KeyPoolManager;
  62: }
  63: 
  64: interface ResolvedRoute {
  65:   readonly provider: string;
  66:   readonly upstreamUrl: string;
  67:   readonly key: string;
  68:   readonly keyIndex: number;
  69: }
  70: 
  71: export function resolveUpstreamResponsesUrl(provider: string): string | null {
  72:   if (!isRegisteredProvider(provider)) {
  73:     return null;
  74:   }
  75:   const config = getProviderConfig(provider);
  76:   const endpoints = config.endpoints as Record<string, string | undefined>;
  77:   const rawPath = endpoints["rs"];
  78:   if (!rawPath) {
  79:     return null;
  80:   }
  81:   const targetUrl = `${config.base_url}${rawPath}`;
  82:   return overrideProviderUrl(targetUrl, provider);
  83: }
  84: 
  85: export function buildUpstreamHeaders(
  86:   key: string,
  87:   provider: string,
  88:   incomingHeaders?: Headers | Record<string, string>
  89: ): Record<string, string> {
  90:   const headers = buildAuthHeaders("Bearer", key, provider, incomingHeaders);
  91:   if (incomingHeaders) {
  92:     if (incomingHeaders instanceof Headers) {
  93:       if (incomingHeaders.has("accept")) {
  94:         headers["Accept"] = incomingHeaders.get("accept") ?? "*/*";
  95:       }
  96:     } else {
  97:       const accept = incomingHeaders["accept"] ?? incomingHeaders["Accept"];
  98:       if (accept) {
  99:         headers["Accept"] = accept;
 100:       }
 101:     }
 102:   }
 103:   const strategyIsZen = isRegisteredProvider(provider) && getProviderConfig(provider)?.strategy === "zen";
 104:   if (strategyIsZen) {
 105:     const { scrubZenHeaders, buildZenHeaders } = require("../engine/zen");
 106:     scrubZenHeaders(headers);
 107:     Object.assign(headers, buildZenHeaders(incomingHeaders));
 108:   }
 109:   return headers;
 110: }
 111: 
 112: function tryStateKeyPool(
 113:   provider: string,
 114:   manager?: KeyPoolManager
 115: ): { key: string; index: number } | null {
 116:   if (!manager) {
 117:     return null;
 118:   }
 119:   if (manager.selectNextKey) {
 120:     return manager.selectNextKey(provider);
 121:   }
 122:   if (manager.getKey) {
 123:     const key = manager.getKey(provider);
 124:     return key ? { key, index: 0 } : null;
 125:   }
 126:   if (manager.getNextKey) {
 127:     const key = manager.getNextKey(provider);
 128:     return key ? { key, index: 0 } : null;
 129:   }
 130:   return null;
 131: }
 132: 
 133: export function resolveApiKey(
 134:   provider: string,
 135:   state?: GatewayState
 136: ): { key: string; index: number } | null {
 137:   const fromState = tryStateKeyPool(provider, state?.keyPoolManager);
 138:   if (fromState) {
 139:     return fromState;
 140:   }
 141:   initializeKeyPools();
 142:   const selected = globalKeyPool.selectNextKey(provider);
 143:   return selected ? { key: selected.key, index: selected.index } : null;
 144: }
 145: 
 146: export function buildSseHeaders(): Headers {
 147:   const headers = new Headers();
 148:   headers.set("Content-Type", "text/event-stream");
 149:   headers.set("Cache-Control", "no-cache");
 150:   headers.set("Connection", "keep-alive");
 151:   return headers;
 152: }
 153: 
 154: export interface ResponsesTelemetry {
 155:   readonly reqId: string;
 156:   readonly provider: string;
 157:   readonly keyIndex: number;
 158:   readonly totalKeys?: number;
 159:   readonly startTime: number;
 160:   readonly status: number;
 161: }
 162: 
 163: function extractReasoningEffort(body: { readonly [key: string]: unknown }): string | undefined {
 164:   const reasoning = body.reasoning;
 165:   if (reasoning && typeof reasoning === "object") {
 166:     const effort = (reasoning as Record<string, unknown>).effort;
 167:     return typeof effort === "string" && effort.length > 0 ? effort : undefined;
 168:   }
 169:   return undefined;
 170: }
 171: 
 172: function extractDirectiveNuances(directiveOrRawKey: Directive | string): readonly string[] | undefined {
 173:   if (typeof directiveOrRawKey === "string") {
 174:     return undefined;
 175:   }
 176:   const nuances = (directiveOrRawKey as Record<string, unknown>).nuances;
 177:   const isStringArray = Array.isArray(nuances) && nuances.every((n) => typeof n === "string");
 178:   return isStringArray ? (nuances as readonly string[]) : undefined;
 179: }
 180: 
 181: function logPrepLine(reqId: string, model: string | undefined, inputBytes: number, effort: string | undefined, stream: boolean): void {
 182:   const effortStr = effort ? ` effort=${effort}` : "";
 183:   const msg = `[PREP ${reqId}] model=${model ?? "unknown"} input=${inputBytes}B${effortStr} stream=${stream}`;
 184:   if (model) {
 185:     logInfo(EMOJI.prep, msg);
 186:   } else {
 187:     logWarn(EMOJI.prep, msg);
 188:   }
 189: }
 190: 
 191: function logUpstreamLine(reqId: string, provider: string, upstreamUrl: string, isStream: boolean): void {
 192:   logInfo(EMOJI.upstream, `[UPSTREAM ${reqId}] ${provider} -> ${upstreamUrl} stream=${isStream}`);
 193: }
 194: 
 195: function getRetryAfterSec(res: Response): number | undefined {
 196:   const raw = res.headers.get("retry-after");
 197:   if (!raw) {
 198:     return undefined;
 199:   }
 200:   const parsed = Number.parseInt(raw, 10);
 201:   return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
 202: }
 203: 
 204: async function logUpstreamError(reqId: string, route: ResolvedRoute, totalKeys: number | undefined, res: Response): Promise<void> {
 205:   try {
 206:     const bodyText = await res.clone().text();
 207:     const rawMsg = extractErrorMessage(bodyText);
 208:     const quarantineEnabled = globalKeyPool.isQuarantineEnabled(route.provider);
 209:     const ttl = quarantineEnabled && (res.status !== 429 || getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC > 0)
 210:       ? (getRetryAfterSec(res) ?? (res.status === 429 ? getEnv().COOLDOWN_RATE_LIMIT_TTL_SEC : undefined))
 211:       : undefined;
 212:     logLimit(reqId, route.provider, route.keyIndex, res.status, ttl, totalKeys, rawMsg);
 213:   } catch (err: unknown) {
 214:     logWarn(EMOJI.limit, `Failed to inspect upstream error body: ${err}`);
 215:   }
 216: }
 217: 
 218: export interface ParsedResponsesUsage {
 219:   readonly promptTokens: number;
 220:   readonly completionTokens: number;
 221:   readonly totalTokens: number;
 222:   readonly reasoningTokens?: number;
 223:   readonly cachedTokens?: number;
 224: }
 225: 
 226: export function tryParseResponsesUsage(text: string): ParsedResponsesUsage | null {
 227:   try {
 228:     const json = JSON.parse(text) as Record<string, unknown>;
 229:     const root = (json.response && typeof json.response === "object")
 230:       ? (json.response as Record<string, unknown>)
 231:       : json;
 232:     const rawUsage = (root.usage && typeof root.usage === "object")
 233:       ? root.usage
 234:       : (json.usage && typeof json.usage === "object")
 235:         ? json.usage
 236:         : (typeof json.input_tokens === "number" || typeof json.prompt_tokens === "number")
 237:           ? json
 238:           : null;
 239:     if (!rawUsage || typeof rawUsage !== "object") {
 240:       return null;
 241:     }
 242:     const u = rawUsage as Record<string, unknown>;
 243:     const prompt = typeof u.input_tokens === "number"
 244:       ? u.input_tokens
 245:       : typeof u.prompt_tokens === "number"
 246:         ? u.prompt_tokens
 247:         : null;
 248:     const completion = typeof u.output_tokens === "number"
 249:       ? u.output_tokens
 250:       : typeof u.completion_tokens === "number"
 251:         ? u.completion_tokens
 252:         : null;
 253:     if (prompt === null || completion === null) {
 254:       return null;
 255:     }
 256:     const total = typeof u.total_tokens === "number" ? u.total_tokens : prompt + completion;
 257: 
 258:     let reasoningTokens: number | undefined;
 259:     const outputDetails = (u.output_tokens_details ?? u.completion_tokens_details) as Record<string, unknown> | undefined;
 260:     if (outputDetails && typeof outputDetails === "object") {
 261:       const r = outputDetails.reasoning_tokens;
 262:       if (typeof r === "number") {
 263:         reasoningTokens = r;
 264:       }
 265:     }
 266: 
 267:     let cachedTokens: number | undefined;
 268:     const inputDetails = (u.input_tokens_details ?? u.prompt_tokens_details) as Record<string, unknown> | undefined;
 269:     if (inputDetails && typeof inputDetails === "object") {
 270:       const c = inputDetails.cached_tokens;
 271:       if (typeof c === "number") {
 272:         cachedTokens = c;
 273:       }
 274:     }
 275: 
 276:     return {
 277:       promptTokens: prompt,
 278:       completionTokens: completion,
 279:       totalTokens: total,
 280:       ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
 281:       ...(cachedTokens !== undefined ? { cachedTokens } : {}),
 282:     };
 283:   } catch {
 284:     return null;
 285:   }
 286: }
 287: 
 288: function emitNonStreamCompletion(telemetry: ResponsesTelemetry, bodyText: string, byteLength: number): void {
 289:   const durationMs = Date.now() - telemetry.startTime;
 290:   const usage = tryParseResponsesUsage(bodyText);
 291:   if (usage) {
 292:     logUsage({
 293:       reqId: telemetry.reqId,
 294:       provider: telemetry.provider,
 295:       keyIndex: telemetry.keyIndex,
 296:       totalKeys: telemetry.totalKeys,
 297:       promptTokens: usage.promptTokens,
 298:       reasoningTokens: usage.reasoningTokens,
 299:       completionTokens: usage.completionTokens,
 300:       totalTokens: usage.totalTokens,
 301:       durationMs,
 302:     });
 303:   } else {
 304:     logInfo(EMOJI.stats, `[COMPLETE ${telemetry.reqId}] bytes=${byteLength} duration=${durationMs}ms (usage unavailable)`);
 305:   }
 306:   const finishReason = tryParseResponsesFinishReason(bodyText) || "stop";
 307:   logFinishReason(telemetry.reqId, finishReason);
 308:   logServed(telemetry.reqId, durationMs, telemetry.status);
 309:   logSeparator();
 310: }
 311: 
 312: export function tryParseResponsesFinishReason(text: string): string | null {
 313:   try {
 314:     const data = JSON.parse(text) as Record<string, unknown>;
 315:     const response = (data.response && typeof data.response === "object")
 316:       ? (data.response as Record<string, unknown>)
 317:       : data;
 318:     if (typeof response.status === "string" && response.status) {
 319:       if (response.status === "completed") {
 320:         return "stop";
 321:       }
 322:       if (response.status === "incomplete") {
 323:         const details = response.incomplete_details;
 324:         if (details && typeof details === "object") {
 325:           const reason = (details as Record<string, unknown>).reason;
 326:           if (reason === "max_output_tokens") {
 327:             return "length";
 328:           }
 329:           if (reason === "content_filter") {
 330:             return "content_filter";
 331:           }
 332:         }
 333:         return "incomplete";
 334:       }
 335:       if (response.status === "cancelled") {
 336:         return "cancelled";
 337:       }
 338:       if (response.status === "failed") {
 339:         return "error";
 340:       }
 341:       return response.status;
 342:     }
 343:     if (Array.isArray(response.choices) && response.choices[0] && typeof response.choices[0].finish_reason === "string") {
 344:       return response.choices[0].finish_reason;
 345:     }
 346:     return null;
 347:   } catch {
 348:     return null;
 349:   }
 350: }
 351: 
 352: export function tryParseStreamedResponsesFinishReason(sseText: string): string | null {
 353:   const lines = sseText.split("\n");
 354:   for (let i = lines.length - 1; i >= 0; i--) {
 355:     const line = lines[i];
 356:     if (!line) continue;
 357:     const trimmed = line.trim();
 358:     if (!trimmed.startsWith("data:")) continue;
 359:     const payload = trimmed.slice(5).trim();
 360:     if (!payload || payload === "[DONE]") continue;
 361:     const reason = tryParseResponsesFinishReason(payload);
 362:     if (reason) return reason;
 363:   }
 364:   return "stop";
 365: }
 366: 
 367: export function tryParseStreamedResponsesUsage(sseText: string): ParsedResponsesUsage | null {
 368:   let last: ParsedResponsesUsage | null = null;
 369:   const lines = sseText.split("\n");
 370:   for (const line of lines) {
 371:     const trimmed = line.trim();
 372:     if (!trimmed.startsWith("data:")) {
 373:       continue;
 374:     }
 375:     const payload = trimmed.slice(5).trim();
 376:     if (!payload || payload === "[DONE]") {
 377:       continue;
 378:     }
 379:     let evt: Record<string, unknown> | null = null;
 380:     try {
 381:       evt = JSON.parse(payload) as Record<string, unknown>;
 382:     } catch {
 383:       continue;
 384:     }
 385:     const response = evt.response;
 386:     if (response && typeof response === "object") {
 387:       const candidate = tryParseResponsesUsage(JSON.stringify(response));
 388:       if (candidate) {
 389:         last = candidate;
 390:       }
 391:       continue;
 392:     }
 393:     const direct = tryParseResponsesUsage(payload);
 394:     if (direct) {
 395:       last = direct;
 396:     }
 397:   }
 398:   if (last) {
 399:     return last;
 400:   }
 401:   const trimmedBody = sseText.trim();
 402:   if (!trimmedBody) {
 403:     return null;
 404:   }
 405:   return tryParseResponsesUsage(trimmedBody);
 406: }
 407: 
 408: function emitStreamCompletion(telemetry: ResponsesTelemetry, bytes: number, accumulatedText?: string): void {
 409:   const durationMs = Date.now() - telemetry.startTime;
 410:   logInfo(EMOJI.stats, `[STREAM-DONE ${telemetry.reqId}] bytes=${bytes} duration=${durationMs}ms`);
 411:   if (accumulatedText) {
 412:     const usage = tryParseStreamedResponsesUsage(accumulatedText);
 413:     if (usage) {
 414:       logUsage({
 415:         reqId: telemetry.reqId,
 416:         provider: telemetry.provider,
 417:         keyIndex: telemetry.keyIndex,
 418:         totalKeys: telemetry.totalKeys,
 419:         promptTokens: usage.promptTokens,
 420:         reasoningTokens: usage.reasoningTokens,
 421:         completionTokens: usage.completionTokens,
 422:         totalTokens: usage.totalTokens,
 423:         durationMs,
 424:       });
 425:     }
 426:     const finishReason = tryParseStreamedResponsesFinishReason(accumulatedText);
 427:     if (finishReason) {
 428:       logFinishReason(telemetry.reqId, finishReason);
 429:     }
 430:   } else {
 431:     logFinishReason(telemetry.reqId, "stop");
 432:   }
 433:   logServed(telemetry.reqId, durationMs, telemetry.status);
 434:   logSeparator();
 435: }
 436: 
 437: function safeCloseController(controller: ReadableStreamDefaultController<Uint8Array>): void {
 438:   try {
 439:     controller.close();
 440:   } catch (err: unknown) {
 441:     logWarn(EMOJI.limit, `Controller close warning: ${err}`);
 442:   }
 443: }
 444: 
 445: function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
 446:   try {
 447:     reader.releaseLock();
 448:   } catch (err: unknown) {
 449:     logWarn(EMOJI.limit, `Reader release lock warning: ${err}`);
 450:   }
 451: }
 452: 
 453: async function readLoop(
 454:   reader: ReadableStreamDefaultReader<Uint8Array>,
 455:   controller: ReadableStreamDefaultController<Uint8Array>,
 456:   bytesRef?: { value: number },
 457:   textRef?: { value: string }
 458: ): Promise<void> {
 459:   const decoder = textRef ? new TextDecoder() : null;
 460:   let reading = true;
 461:   while (reading) {
 462:     const { done, value } = await reader.read();
 463:     if (done) {
 464:       if (decoder) {
 465:         try {
 466:           const tail = decoder.decode();
 467:           if (tail && textRef) {
 468:             textRef.value += tail;
 469:           }
 470:         } catch (decodeErr: unknown) {
 471:           void decodeErr;
 472:         }
 473:       }
 474:       reading = false;
 475:       safeCloseController(controller);
 476:     } else if (value) {
 477:       if (bytesRef) {
 478:         bytesRef.value += value.byteLength;
 479:       }
 480:       if (textRef && decoder) {
 481:         try {
 482:           textRef.value += decoder.decode(value, { stream: true });
 483:           if (textRef.value.length > 1048576) {
 484:             textRef.value = textRef.value.slice(-262144);
 485:           }
 486:         } catch (chunkErr: unknown) {
 487:           void chunkErr;
 488:         }
 489:       }
 490:       controller.enqueue(value);
 491:     }
 492:   }
 493: }
 494: 
 495: function setupAbortHandler(
 496:   reader: ReadableStreamDefaultReader<Uint8Array>,
 497:   controller: ReadableStreamDefaultController<Uint8Array>,
 498:   clientSignal?: AbortSignal,
 499:   abortController?: AbortController
 500: ): () => void {
 501:   const onAbort = () => {
 502:     abortController?.abort();
 503:     void reader.cancel("aborted");
 504:     safeCloseController(controller);
 505:   };
 506:   if (clientSignal?.aborted) {
 507:     onAbort();
 508:   } else {
 509:     clientSignal?.addEventListener("abort", onAbort, { once: true });
 510:   }
 511:   return () => {
 512:     clientSignal?.removeEventListener("abort", onAbort);
 513:   };
 514: }
 515: 
 516: function handleStreamError(
 517:   err: unknown,
 518:   controller: ReadableStreamDefaultController<Uint8Array>,
 519:   clientSignal?: AbortSignal
 520: ): void {
 521:   if (clientSignal?.aborted) {
 522:     return;
 523:   }
 524:   logWarn(EMOJI.limit, `Stream pump error: ${err}`);
 525:   try {
 526:     controller.error(err);
 527:   } catch (controllerErr: unknown) {
 528:     logWarn(EMOJI.limit, `Controller error warning: ${controllerErr}`);
 529:   }
 530: }
 531: 
 532: async function pumpStream(
 533:   reader: ReadableStreamDefaultReader<Uint8Array>,
 534:   controller: ReadableStreamDefaultController<Uint8Array>,
 535:   clientSignal?: AbortSignal,
 536:   abortController?: AbortController,
 537:   telemetry?: ResponsesTelemetry,
 538:   bytesRef?: { value: number },
 539:   textRef?: { value: string },
 540:   onComplete?: () => void
 541: ): Promise<void> {
 542:   const cleanup = setupAbortHandler(reader, controller, clientSignal, abortController);
 543:   try {
 544:     await readLoop(reader, controller, bytesRef, textRef);
 545:     if (telemetry && bytesRef) {
 546:       emitStreamCompletion(telemetry, bytesRef.value, textRef?.value);
 547:     }
 548:   } catch (err: unknown) {
 549:     handleStreamError(err, controller, clientSignal);
 550:   } finally {
 551:     cleanup();
 552:     releaseReaderLock(reader);
 553:     onComplete?.();
 554:   }
 555: }
 556: 
 557: export function createStreamingResponse(
 558:   upstreamResponse: Response,
 559:   clientSignal?: AbortSignal,
 560:   abortController?: AbortController,
 561:   telemetry?: ResponsesTelemetry,
 562:   pacerRelease?: () => void
 563: ): Response {
 564:   if (upstreamResponse.status >= 400) {
 565:     pacerRelease?.();
 566:     return upstreamResponse;
 567:   }
 568: 
 569:   let released = false;
 570:   const safeRelease = () => {
 571:     if (!released) {
 572:       released = true;
 573:       pacerRelease?.();
 574:     }
 575:   };
 576: 
 577:   const upstreamBody = upstreamResponse.body;
 578:   if (!upstreamBody) {
 579:     safeRelease();
 580:     return new Response(null, {
 581:       status: upstreamResponse.status,
 582:       headers: buildSseHeaders(),
 583:     });
 584:   }
 585: 
 586:   const reader = upstreamBody.getReader();
 587:   const bytesRef = { value: 0 };
 588:   const textRef = { value: "" };
 589:   const stream = new ReadableStream<Uint8Array>({
 590:     start(controller) {
 591:       void pumpStream(reader, controller, clientSignal, abortController, telemetry, bytesRef, textRef, safeRelease);
 592:     },
 593:     cancel(reason) {
 594:       safeRelease();
 595:       abortController?.abort();
 596:       return reader.cancel(reason);
 597:     },
 598:   });
 599: 
 600:   return new Response(stream, {
 601:     status: upstreamResponse.status,
 602:     headers: buildSseHeaders(),
 603:   });
 604: }
 605: 
 606: export async function createNonStreamingResponse(
 607:   upstreamResponse: Response,
 608:   telemetry?: ResponsesTelemetry
 609: ): Promise<Response> {
 610:   const arrayBuffer = await upstreamResponse.arrayBuffer();
 611:   const sanitizedHeaders = sanitizeDownstreamHeaders(
 612:     upstreamResponse.headers,
 613:     arrayBuffer.byteLength
 614:   );
 615:   if (telemetry) {
 616:     const bodyText = new TextDecoder().decode(arrayBuffer);
 617:     emitNonStreamCompletion(telemetry, bodyText, arrayBuffer.byteLength);
 618:   }
 619:   return new Response(arrayBuffer, {
 620:     status: upstreamResponse.status,
 621:     headers: sanitizedHeaders,
 622:   });
 623: }
 624: 
 625: export function shouldStreamResponse(
 626:   upstreamResponse: Response,
 627:   clientStreamRequested: boolean
 628: ): boolean {
 629:   if (upstreamResponse.status >= 400) {
 630:     return false;
 631:   }
 632:   const contentType = upstreamResponse.headers.get("content-type") ?? "";
 633:   if (contentType.includes("text/event-stream")) {
 634:     return true;
 635:   }
 636:   return clientStreamRequested;
 637: }
 638: 
 639: function extractProviderFromString(rawKey: string): string | null {
 640:   if (isRegisteredProvider(rawKey)) {
 641:     return rawKey.toLowerCase();
 642:   }
 643:   const validation = validateDirective(rawKey);
 644:   if (validation.valid && validation.directive.type === "direct") {
 645:     return validation.directive.provider;
 646:   }
 647:   return null;
 648: }
 649: 
 650: export function extractProvider(
 651:   directiveOrRawKey: Directive | string
 652: ): string | null {
 653:   if (typeof directiveOrRawKey === "string") {
 654:     return extractProviderFromString(directiveOrRawKey);
 655:   }
 656:   if (directiveOrRawKey && typeof directiveOrRawKey === "object" && "provider" in directiveOrRawKey) {
 657:     const p = directiveOrRawKey.provider;
 658:     return typeof p === "string" ? p : null;
 659:   }
 660:   return null;
 661: }
 662: 
 663: interface ParsedRequestBody {
 664:   readonly bodyText: string;
 665:   readonly clientStream: boolean;
 666:   readonly body: {
 667:     readonly model?: string;
 668:     readonly [key: string]: unknown;
 669:   };
 670: }
 671: 
 672: async function parseRequestBody(
 673:   req: Request
 674: ): Promise<ParsedRequestBody> {
 675:   try {
 676:     const bodyText = await req.text();
 677:     if (!bodyText) {
 678:       return { bodyText: "", clientStream: false, body: {} };
 679:     }
 680:     const parsed = JSON.parse(bodyText) as Record<string, unknown>;
 681:     const model = typeof parsed.model === "string" ? parsed.model : undefined;
 682:     return {
 683:       bodyText,
 684:       clientStream: Boolean(parsed.stream),
 685:       body: { ...parsed, model },
 686:     };
 687:   } catch (err: unknown) {
 688:     logWarn(EMOJI.limit, `Failed to inspect request body JSON: ${err}`);
 689:     return { bodyText: "", clientStream: false, body: {} };
 690:   }
 691: }
 692: 
 693: interface UpstreamExecutionResult {
 694:   readonly response: Response;
 695:   readonly upstreamProtocol: OutboundProtocol;
 696:   readonly measuredTtftMs: number;
 697: }
 698: 
 699: async function executeUpstreamFetch(
 700:   options: FetcherOptions
 701: ): Promise<UpstreamExecutionResult> {
 702:   const guard = await fetchWithTtftGuard(options);
 703:   const reassembled = reassembleResponse(
 704:     guard.response,
 705:     guard.firstChunk,
 706:     guard.rawReader
 707:   );
 708:   return {
 709:     response: reassembled,
 710:     upstreamProtocol: guard.protocol,
 711:     measuredTtftMs: guard.ttftMs,
 712:   };
 713: }
 714: 
 715: function resolveRequestRoute(
 716:   directiveOrRawKey: Directive | string,
 717:   state?: GatewayState
 718: ): { route?: ResolvedRoute; errorResponse?: Response } {
 719:   const provider = extractProvider(directiveOrRawKey);
 720:   if (!provider || !isRegisteredProvider(provider)) {
 721:     return {
 722:       errorResponse: Response.json(
 723:         {
 724:           error: {
 725:             message: `Unsupported or invalid provider '${String(provider)}' for /v1/responses.`,
 726:             type: "invalid_request_error",
 727:           },
 728:         },
 729:         { status: 400 }
 730:       ),
 731:     };
 732:   }
 733: 
 734:   const upstreamUrl = resolveUpstreamResponsesUrl(provider);
 735:   if (!upstreamUrl) {
 736:     return {
 737:       errorResponse: Response.json(
 738:         {
 739:           error: {
 740:             message: `No upstream responses endpoint configured for provider '${provider}'`,
 741:             type: "invalid_request_error",
 742:           },
 743:         },
 744:         { status: 400 }
 745:       ),
 746:     };
 747:   }
 748: 
 749:   const selectedKey = resolveApiKey(provider, state);
 750:   if (!selectedKey) {
 751:     return {
 752:       errorResponse: Response.json(
 753:         {
 754:           error: {
 755:             message: `No active API keys available for provider '${provider}'`,
 756:             type: "insufficient_quota",
 757:           },
 758:         },
 759:         { status: 429 }
 760:       ),
 761:     };
 762:   }
 763: 
 764:   return {
 765:     route: {
 766:       provider,
 767:       upstreamUrl,
 768:       key: selectedKey.key,
 769:       keyIndex: selectedKey.index,
 770:     },
 771:   };
 772: }
 773: 
 774: interface PacerLeaseResult {
 775:   readonly errorResponse?: Response;
 776:   readonly release?: () => void;
 777: }
 778: 
 779: async function acquireProviderRetryPacer(
 780:   provider: string,
 781:   signal?: AbortSignal,
 782:   reqId?: string
 783: ): Promise<PacerLeaseResult> {
 784:   const env = getEnv();
 785:   const provConfig = isRegisteredProvider(provider) ? getProviderConfig(provider) : undefined;
 786:   if (!env.LITEROUTER_PACER_ENABLED || !(provConfig?.pacer?.enabled ?? false)) {
 787:     return {};
 788:   }
 789:   try {
 790:     const pacer = getPacerForProvider(provider);
 791:     const acquireResult = await pacer.acquire(signal);
 792:     return { release: acquireResult.release };
 793:   } catch (err: unknown) {
 794:     if (err instanceof PacerQueueOverflowError) {
 795:       logWarn(
 796:         EMOJI.hourglass,
 797:         `[PACER ${reqId ?? "unknown"}] ${provider.toUpperCase()} pacer queue overflow: ${err.message} (Retry-After: ${err.retryAfterSec}s)`
 798:       );
 799:       return {
 800:         errorResponse: Response.json(
 801:           {
 802:             error: {
 803:               message: err.message,
 804:               type: "rate_limit_exceeded",
 805:               code: "rate_limit_exceeded",
 806:             },
 807:           },
 808:           {
 809:             status: 429,
 810:             headers: {
 811:               "Retry-After": String(err.retryAfterSec),
 812:               "Content-Type": "application/json",
 813:             },
 814:           }
 815:         ),
 816:       };
 817:     }
 818:     throw err;
 819:   }
 820: }
 821: 
 822: interface FetchResult {
 823:   readonly response?: Response;
 824:   readonly errorResponse?: Response;
 825:   readonly keyIndex?: number;
 826:   readonly upstreamProtocol?: OutboundProtocol;
 827:   readonly measuredTtftMs?: number;
 828:   readonly pacerRelease?: () => void;
 829: }
 830: 
 831: async function dispatchUpstreamFetch(
 832:   route: ResolvedRoute,
 833:   bodyText: string,
 834:   clientHeaders: Headers,
 835:   signal: AbortSignal,
 836:   reqId: string,
 837:   model?: string
 838: ): Promise<FetchResult> {
 839:   const env = getEnv();
 840:   const quarantineEnabled = globalKeyPool.isQuarantineEnabled(route.provider);
 841:   const poolSize = globalKeyPool.getPoolSize(route.provider);
 842:   const provConfig = isRegisteredProvider(route.provider) ? getProviderConfig(route.provider) : undefined;
 843:   const retriesEnabled = Boolean(provConfig?.request_retry?.enabled && provConfig.request_retry.max_attempts > 1);
 844:   const maxAttempts = provConfig?.request_retry?.enabled
 845:     ? Math.min(provConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
 846:     : 1;
 847:   const maxWaitMs = provConfig?.pacer?.max_queue_wait_ms ?? (env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS || 300000);
 848:   const totalKeys = poolSize > 0 ? poolSize : 1;
 849: 
 850:   let currentKey = route.key;
 851:   let currentKeyIndex = route.keyIndex;
 852:   const loopStart = Date.now();
 853: 
 854:   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
 855:     if (signal.aborted) {
 856:       return {
 857:         errorResponse: Response.json(
 858:           { error: { message: "Request aborted by client", type: "client_closed_request" } },
 859:           { status: 499 }
 860:         ),
 861:       };
 862:     }
 863: 
 864:     if (quarantineEnabled) {
 865:       const dwellMs = Date.now() - loopStart;
 866:       if (globalKeyPool.shouldLoadShed(route.provider, dwellMs, maxWaitMs)) {
 867:         const minTtl = globalKeyPool.getMinQuarantineTtlMs(route.provider);
 868:         const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
 869:         return {
 870:           errorResponse: Response.json(
 871:             { error: { message: `Provider '${route.provider}' unavailable: all keys in cooldown exceed wait budget.`, type: "service_unavailable" } },
 872:             { status: 503, headers: { "Retry-After": String(retryAfterSec) } }
 873:           ),
 874:         };
 875:       }
 876:     }
 877: 
 878:     const pacerResult = await acquireProviderRetryPacer(route.provider, signal, reqId);
 879:     if (pacerResult.errorResponse) {
 880:       return { errorResponse: pacerResult.errorResponse };
 881:     }
 882: 
 883:     if (attempt > 1) {
 884:       const next = globalKeyPool.selectNextKey(route.provider);
 885:       if (!next) {
 886:         pacerResult.release?.();
 887:         const minTtl = globalKeyPool.getMinQuarantineTtlMs(route.provider);
 888:         logExhausted(reqId, route.provider, minTtl);
 889:         return {
 890:           errorResponse: Response.json(
 891:             {
 892:               error: {
 893:                 message: `All API keys for provider '${route.provider}' are cooling down.`,
 894:                 type: "insufficient_quota",
 895:               },
 896:             },
 897:             { status: 429 }
 898:           ),
 899:         };
 900:       }
 901:       logRotate(reqId, route.provider, currentKeyIndex, next.index, next.totalKeys, attempt, maxAttempts);
 902:       currentKey = next.key;
 903:       currentKeyIndex = next.index;
 904:     }
 905: 
 906:     const upstreamHeaders = buildUpstreamHeaders(currentKey, route.provider, clientHeaders);
 907:     let execResult: UpstreamExecutionResult;
 908:     try {
 909:       const fetchOpts: FetcherOptions = {
 910:         url: route.upstreamUrl,
 911:         method: "POST",
 912:         headers: upstreamHeaders,
 913:         body: bodyText.length > 0 ? bodyText : undefined,
 914:         clientSignal: signal,
 915:         provider: route.provider,
 916:         keyIndex: currentKeyIndex,
 917:         model,
 918:       };
 919:       execResult = await executeUpstreamFetch(fetchOpts);
 920:     } catch (err: unknown) {
 921:       if (isFatalAuthError(err)) {
 922:         pacerResult.release?.();
 923:         logWarn(
 924:           EMOJI.zap,
 925:           `[${route.provider.toUpperCase()} ${reqId}] Fatal auth error ${err.status}: failing fast and loud without retry.`
 926:         );
 927:         return {
 928:           errorResponse: Response.json(
 929:             { error: { message: err.message, type: "authentication_error" } },
 930:             { status: err.status }
 931:           ),
 932:         };
 933:       }
 934:       if (quarantineEnabled) {
 935:         globalKeyPool.reportFailure(route.provider, currentKeyIndex, 502);
 936:       } else {
 937:         logWarn(EMOJI.zap, `[${route.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode: Key ${currentKeyIndex} quarantine bypassed.`);
 938:       }
 939:       if (retriesEnabled && attempt < maxAttempts && !signal.aborted) {
 940:         pacerResult.release?.();
 941:         logWarn(EMOJI.zap, `[${route.provider.toUpperCase()} ${reqId}] Transport error on attempt ${attempt}/${maxAttempts}, rotating key...`);
 942:         const delayMs = provConfig ? calculateRetryDelay(provConfig.request_retry.delay, attempt) : 0;
 943:         if (delayMs > 0) {
 944:           await Bun.sleep(delayMs);
 945:         }
 946:         continue;
 947:       }
 948:       pacerResult.release?.();
 949:       logError(reqId, `Upstream request to ${route.upstreamUrl} failed`, err);
 950:       return {
 951:         errorResponse: Response.json(
 952:           {
 953:             error: {
 954:               message: `Upstream request failed: ${extractErrorMessage(String(err)) ?? String(err)}`,
 955:               type: "server_error",
 956:             },
 957:           },
 958:           { status: 502 }
 959:         ),
 960:       };
 961:     }
 962: 
 963:     const res = execResult.response;
 964:     if (res.status < 400) {
 965:       globalKeyPool.reportSuccess(route.provider, currentKeyIndex);
 966:       return {
 967:         response: res,
 968:         keyIndex: currentKeyIndex,
 969:         upstreamProtocol: execResult.upstreamProtocol,
 970:         measuredTtftMs: execResult.measuredTtftMs,
 971:         pacerRelease: pacerResult.release,
 972:       };
 973:     }
 974: 
 975:     const errBodyText = await res.clone().text().catch(() => "");
 976:     if (res.status === 401 || res.status === 403) {
 977:       pacerResult.release?.();
 978:       logWarn(
 979:         EMOJI.zap,
 980:         `[${route.provider.toUpperCase()} ${reqId}] Fatal auth error ${res.status}: failing fast and loud without retry.`
 981:       );
 982:       try {
 983:         if (quarantineEnabled) {
 984:           globalKeyPool.reportFailure(route.provider, currentKeyIndex, res.status, res.headers, errBodyText);
 985:         }
 986:       } catch (err: unknown) {
 987:         if (isFatalAuthError(err)) {
 988:           logWarn(EMOJI.zap, `[${route.provider.toUpperCase()} ${reqId}] Auth failure confirmed fatal: ${err.message}`);
 989:         } else {
 990:           throw err;
 991:         }
 992:       }
 993:       return { response: res, keyIndex: currentKeyIndex };
 994:     }
 995: 
 996:     const classification = classifyUpstreamError({
 997:       provider: route.provider,
 998:       status: res.status,
 999:       headers: res.headers,
1000:       bodyText: errBodyText,
1001:     });
1002:     try {
1003:       if (quarantineEnabled && classification.quarantineTtlSec > 0) {
1004:         globalKeyPool.reportFailure(route.provider, currentKeyIndex, res.status, res.headers, errBodyText, Date.now(), classification.quarantineTtlSec);
1005:       } else if (classification.quarantineTtlSec > 0) {
1006:         logWarn(EMOJI.zap, `[${route.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode (${route.provider.toUpperCase()}_ENABLE_QUARANTINE=false): Key ${currentKeyIndex} quarantine bypassed.`);
1007:       }
1008:     } catch (err: unknown) {
1009:       if (isFatalAuthError(err)) {
1010:         pacerResult.release?.();
1011:         logWarn(
1012:           EMOJI.zap,
1013:           `[${route.provider.toUpperCase()} ${reqId}] Fatal auth error ${err.status}: failing fast and loud without retry.`
1014:         );
1015:         return { response: res, keyIndex: currentKeyIndex };
1016:       }
1017:       throw err;
1018:     }
1019: 
1020:     const canRetry =
1021:       retriesEnabled &&
1022:       classification.action === "retry_rotate" &&
1023:       attempt < maxAttempts &&
1024:       !signal.aborted;
1025:     if (canRetry) {
1026:       pacerResult.release?.();
1027:       const ttlSec = quarantineEnabled && classification.quarantineTtlSec > 0
1028:         ? classification.quarantineTtlSec
1029:         : undefined;
1030:       logLimit(reqId, route.provider, currentKeyIndex, res.status, ttlSec, totalKeys, extractErrorMessage(errBodyText));
1031:       const delayMs = provConfig ? calculateRetryDelay(provConfig.request_retry.delay, attempt) : 0;
1032:       if (delayMs > 0) {
1033:         await Bun.sleep(delayMs);
1034:       }
1035:       continue;
1036:     }
1037: 
1038:     if (!retriesEnabled && classification.action === "retry_rotate") {
1039:       logWarn(EMOJI.zap, `[${route.provider.toUpperCase()} ${reqId}] Single-flight mode: Passing HTTP ${res.status} directly downstream.`);
1040:     }
1041:     pacerResult.release?.();
1042:     return { response: res, keyIndex: currentKeyIndex };
1043:   }
1044: 
1045:   logError(reqId, `${route.provider} Responses request attempts exhausted`, null);
1046:   return {
1047:     errorResponse: Response.json(
1048:       { error: { message: `${route.provider} Responses request attempts exhausted`, type: "gateway_error" } },
1049:       { status: 502 }
1050:     ),
1051:   };
1052: }
1053: 
1054: function extractReqContext(stateOrReqId?: GatewayState | string): {
1055:   reqId: string;
1056:   state?: GatewayState;
1057: } {
1058:   if (typeof stateOrReqId === "string") {
1059:     return { reqId: stateOrReqId };
1060:   }
1061:   return {
1062:     reqId: `req_${Math.random().toString(36).slice(2, 9)}`,
1063:     state: stateOrReqId,
1064:   };
1065: }
1066: 
1067: function createClientAbortedResponse(): Response {
1068:   return Response.json(
1069:     { error: { message: "Request aborted by client", type: "client_closed_request" } },
1070:     { status: 499 }
1071:   );
1072: }
1073: 
1074: function bindAbortSignal(
1075:   clientSignal: AbortSignal,
1076:   abortController: AbortController
1077: ): () => void {
1078:   const onAbort = () => abortController.abort();
1079:   clientSignal.addEventListener("abort", onAbort, { once: true });
1080:   return () => clientSignal.removeEventListener("abort", onAbort);
1081: }
1082: 
1083: function resolveDirectiveString(
1084:   directiveOrRawKey: Directive | string,
1085:   fallback: string
1086: ): string {
1087:   if (typeof directiveOrRawKey === "string") {
1088:     return directiveOrRawKey;
1089:   }
1090:   return typeof directiveOrRawKey.raw === "string"
1091:     ? directiveOrRawKey.raw
1092:     : fallback;
1093: }
1094: 
1095: export async function handleOpenAiOriginal(
1096:   req: Request,
1097:   directive: Directive,
1098:   state?: GatewayState
1099: ): Promise<Response>;
1100: export async function handleOpenAiOriginal(
1101:   req: Request,
1102:   rawKey: string,
1103:   stateOrReqId?: GatewayState | string
1104: ): Promise<Response>;
1105: export async function handleOpenAiOriginal(
1106:   req: Request,
1107:   directiveOrRawKey: Directive | string,
1108:   stateOrReqId?: GatewayState | string
1109: ): Promise<Response> {
1110:   const { reqId, state } = extractReqContext(stateOrReqId);
1111:   const routeResult = resolveRequestRoute(directiveOrRawKey, state);
1112:   if (routeResult.errorResponse) {
1113:     return routeResult.errorResponse;
1114:   }
1115:   const route = routeResult.route as ResolvedRoute;
1116: 
1117:   if (req.signal.aborted) {
1118:     return createClientAbortedResponse();
1119:   }
1120: 
1121:   const { bodyText, clientStream, body } = await parseRequestBody(req);
1122:   let activeBodyText = bodyText;
1123:   let zenRequiresAccumulation = false;
1124:   const strategyIsZen = isRegisteredProvider(route.provider) && getProviderConfig(route.provider)?.strategy === "zen";
1125:   if (strategyIsZen) {
1126:     const { adaptZenResponsesPayload } = require("../engine/zen");
1127:     const adapted = adaptZenResponsesPayload(body);
1128:     zenRequiresAccumulation = adapted.requiresAccumulation;
1129:     activeBodyText = JSON.stringify(adapted.adaptedBody);
1130:   }
1131:   const directiveStr = resolveDirectiveString(directiveOrRawKey, route.provider);
1132:   const method = req.method;
1133:   const path = new URL(req.url, "http://localhost").pathname;
1134:   const clientAgent = req.headers.get("user-agent") ?? "unknown";
1135:   const clientProtocol = req.headers.get("x-http-version") ?? "HTTP/1.1";
1136:   const targetProvider = route.provider;
1137:   const totalKeys = globalKeyPool.getPoolSize(route.provider);
1138:   const refHeaders = resolveUpstreamEndpoint(route.provider, "ch", body.model ?? "").headers;
1139:   const refUa = refHeaders?.["User-Agent"];
1140:   const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
1141:   const referrer = refUa && refUrl ? `${refUa} @ ${refUrl}` : (refUa ?? refUrl ?? undefined);
1142: 
1143:   logInbound({
1144:     reqId,
1145:     method,
1146:     path,
1147:     clientAgent,
1148:     protocol: clientProtocol,
1149:     directiveStr,
1150:     targetProvider,
1151:     wireFormat: "rs",
1152:     endpoint: "/v1/responses",
1153:     model: body.model,
1154:     keyIndex: route.keyIndex,
1155:     totalKeys,
1156:     nuances: extractDirectiveNuances(directiveOrRawKey),
1157:     referrer,
1158:   });
1159: 
1160:   logPrepLine(reqId, body.model, activeBodyText.length, extractReasoningEffort(body), clientStream);
1161: 
1162:   const abortController = new AbortController();
1163:   const cleanup = bindAbortSignal(req.signal, abortController);
1164: 
1165:   const startTime = Date.now();
1166:   const fetchResult = await dispatchUpstreamFetch(
1167:     route,
1168:     activeBodyText,
1169:     req.headers,
1170:     abortController.signal,
1171:     reqId,
1172:     body.model
1173:   );
1174:   if (fetchResult.errorResponse) {
1175:     cleanup();
1176:     return req.signal.aborted ? createClientAbortedResponse() : fetchResult.errorResponse;
1177:   }
1178: 
1179:   const ttftMs = Date.now() - startTime;
1180:   const upstreamRes = fetchResult.response as Response;
1181:   const isStream = shouldStreamResponse(upstreamRes, clientStream);
1182:   if (upstreamRes.status >= 400) {
1183:     await logUpstreamError(reqId, route, totalKeys, upstreamRes);
1184:   } else {
1185:     logUpstreamLine(reqId, route.provider, route.upstreamUrl, isStream);
1186:   }
1187:   const actualUpstreamProtocol = fetchResult.upstreamProtocol ?? "HTTP/1.1";
1188:   const effectiveTtftMs = fetchResult.measuredTtftMs ?? ttftMs;
1189:   logTtft(
1190:     reqId,
1191:     effectiveTtftMs,
1192:     isStream ? "Stream established" : "First chunk streamed downstream",
1193:     actualUpstreamProtocol
1194:   );
1195: 
1196:   const telemetry: ResponsesTelemetry = {
1197:     reqId,
1198:     provider: route.provider,
1199:     keyIndex: fetchResult.keyIndex ?? route.keyIndex,
1200:     totalKeys,
1201:     startTime,
1202:     status: upstreamRes.status,
1203:   };
1204: 
1205:   if (upstreamRes.status >= 400) {
1206:     cleanup();
1207:     fetchResult.pacerRelease?.();
1208:     return upstreamRes;
1209:   }
1210: 
1211:   const isEventStream = (upstreamRes.headers.get("content-type") ?? "").includes("text/event-stream");
1212:   if (zenRequiresAccumulation && isEventStream && upstreamRes.body) {
1213:     cleanup();
1214:     fetchResult.pacerRelease?.();
1215:     const { accumulateZenResponsesStream } = require("../engine/zen");
1216:     const accumulated = await accumulateZenResponsesStream(upstreamRes.body);
1217:     return Response.json(accumulated, {
1218:       status: 200,
1219:       headers: { "Content-Type": "application/json" },
1220:     });
1221:   }
1222: 
1223:   if (isStream) {
1224:     return createStreamingResponse(
1225:       upstreamRes,
1226:       req.signal,
1227:       abortController,
1228:       telemetry,
1229:       fetchResult.pacerRelease
1230:     );
1231:   }
1232: 
1233:   cleanup();
1234:   fetchResult.pacerRelease?.();
1235:   return createNonStreamingResponse(upstreamRes, telemetry);
1236: }
```

## File: src/index.ts
```typescript
  1: import { existsSync, readFileSync } from "node:fs";
  2: import http2 from "node:http2";
  3: import { resolve } from "node:path";
  4: import type { Server } from "bun";
  5: import { getEnv, resolveEngine } from "./config/env";
  6: import { loadKeyPools } from "./config/keys";
  7: import {
  8:   getAllProviders,
  9:   initProviderRegistry,
 10: } from "./config/providers";
 11: import { loadLocationConfig } from "./config/location";
 12: import { initStrategyRegistry } from "./engine/strategy_registry";
 13: import { parseDirective, type ParsedDirective } from "./directive/parser";
 14: import { extractDirectiveToken } from "./directive/validator";
 15: import { handleAnthropicCompat, handleAnthropicCountTokens } from "./handlers/anthropic_compat";
 16: import { handleModelsDiscovery } from "./handlers/discovery";
 17: import { handleGcpCompat } from "./handlers/gcp_compat";
 18: import { dispatchV4 } from "./handlers/v4/router";
 19: import {
 20:   handleGoogleInteractionsPassthrough,
 21:   handleGoogleNative,
 22:   handleGoogleOpenAIBeta,
 23:   loadAndCacheNativeChains,
 24:   resetNativeFlashTierIndex,
 25: } from "./handlers/google_native";
 26: import {
 27:   globalCooldownManager,
 28:   globalKeyPool,
 29:   handleOpenAICompat,
 30:   initializeKeyPools,
 31:   resetProvidersRegistryCache,
 32: } from "./handlers/openai_compat";
 33: import {
 34:   type Directive,
 35:   type GatewayState,
 36:   handleOpenAiOriginal,
 37: } from "./handlers/openai_original";
 38: import { getHttp2Pool, resetHttp2Pool } from "./network/h2_pool";
 39: import { getAllCircuitBreakers, clearCircuitBreakerRegistry } from "./network/circuit_breaker";
 40: import { resetCircuitBreakers } from "./engine/circuit_breaker";
 41: import { traceBuffer } from "./telemetry/ring_buffer";
 42: import { traceWriter } from "./telemetry/trace_writer";
 43: import {
 44:   clearPacerRegistry,
 45: } from "./network/pacer";
 46: import { type BannerOptions, printBanner } from "./ui/banner";
 47: import { logAmber, logError, logInfo } from "./ui/logger";
 48: 
 49: // Boot initialization: Load provider registry and emit deprecation warnings
 50: try {
 51:   initProviderRegistry();
 52:   initStrategyRegistry();
 53:   traceWriter.init();
 54: } catch (err) {
 55:   console.error(`[BOOT] FATAL: Provider registry failed to load`, err);
 56:   process.exit(1);
 57: }
 58: 
 59: initializeKeyPools(process.env);
 60: 
 61: function loadTlsOptions(tlsEnabledFlag?: boolean): { cert: string; key: string } | undefined {
 62:   if (process.env.LITEROUTER_TLS_ENABLED === "false" || tlsEnabledFlag === false) {
 63:     return undefined;
 64:   }
 65:   const certPath = resolve(process.cwd(), "certs", "localhost.pem");
 66:   const keyPath = resolve(process.cwd(), "certs", "localhost-key.pem");
 67: 
 68:   if (existsSync(certPath) && existsSync(keyPath)) {
 69:     try {
 70:       const cert = readFileSync(certPath, "utf-8");
 71:       const key = readFileSync(keyPath, "utf-8");
 72:       return { cert, key };
 73:     } catch (err) {
 74:       logError("BOOT", "Failed to read TLS certificates", err);
 75:       return undefined;
 76:     }
 77:   }
 78:   return undefined;
 79: }
 80: 
 81: export function handleHardReset(req?: Request, rawKey?: string): Response {
 82:   const token = rawKey || (req ? extractDirectiveToken(req) : "") || "";
 83:   const authKey = getEnv().LITEROUTER_AUTH_KEY;
 84:   const isValid = (authKey && token === authKey) || parseDirective(token) !== null;
 85: 
 86:   if (!isValid) {
 87:     return Response.json(
 88:       { error: { message: "Unauthorized admin access", type: "authentication_error" } },
 89:       { status: 401 }
 90:     );
 91:   }
 92: 
 93:   try {
 94:     initProviderRegistry();
 95:     initStrategyRegistry();
 96:     traceWriter.init();
 97:     globalCooldownManager.clearAll();
 98:     globalKeyPool.reset();
 99:     initializeKeyPools();
100:     clearCircuitBreakerRegistry();
101:     resetCircuitBreakers();
102:     clearPacerRegistry();
103:     traceBuffer.clear();
104:     resetHttp2Pool();
105:     resetProvidersRegistryCache();
106:     loadAndCacheNativeChains();
107:     resetNativeFlashTierIndex();
108:     if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
109:       Bun.gc(true); // Proactive compaction of JIT and heap after resetting registries
110:     }
111:     return Response.json(
112:       {
113:         status: "ok",
114:         message: "Hard reset successful. Cooldowns, circuit breakers, pacers, and H2 pools reloaded.",
115:         timestamp: new Date().toISOString(),
116:       },
117:       { status: 200 }
118:     );
119:   } catch (err) {
120:     console.error(`[RESET] Registry reload failed, keeping previous config`, err);
121:     return Response.json(
122:       {
123:         status: "error",
124:         message: err instanceof Error ? err.message : String(err),
125:       },
126:       { status: 500 }
127:     );
128:   }
129: }
130: 
131: async function handleAdminPoolReset(req: Request, rawKey: string): Promise<Response> {
132:   const token = rawKey || extractDirectiveToken(req) || "";
133:   const authKey = getEnv().LITEROUTER_AUTH_KEY;
134:   const isValid = (authKey && token === authKey) || parseDirective(token) !== null;
135: 
136:   if (!isValid) {
137:     return Response.json(
138:       { error: { message: "Unauthorized admin access", type: "authentication_error" } },
139:       { status: 401 }
140:     );
141:   }
142: 
143:   const url = new URL(req.url);
144:   let provider = url.searchParams.get("provider")?.toLowerCase().trim();
145: 
146:   if (!provider && (req.method === "POST" || req.method === "PUT")) {
147:     const contentType = req.headers.get("content-type") || "";
148:     if (contentType.includes("application/json")) {
149:       try {
150:         const body = (await req.json()) as { provider?: unknown };
151:         if (typeof body?.provider === "string") {
152:           provider = body.provider.toLowerCase().trim();
153:         }
154:       } catch (err: unknown) {
155:         logAmber("ADMIN", `Failed to parse body JSON for pool reset: ${String(err)}`);
156:       }
157:     }
158:   }
159: 
160:   if (provider) {
161:     globalKeyPool.reset(provider);
162:     return Response.json(
163:       {
164:         status: "ok",
165:         message: `Reset pool for provider '${provider}'. Cooldowns and timers cleared.`,
166:         provider,
167:         timestamp: new Date().toISOString(),
168:       },
169:       { status: 200 }
170:     );
171:   }
172: 
173:   return handleHardReset(req, rawKey);
174: }
175: 
176: function handleHealthCheck(): Response {
177:   const circuitStats: Record<string, unknown> = {};
178:   for (const [provider, breaker] of getAllCircuitBreakers().entries()) {
179:     circuitStats[provider] = breaker.getStats();
180:   }
181: 
182:   const h2Stats = getHttp2Pool().getSessionStats();
183: 
184:   return Response.json(
185:     {
186:       status: "healthy",
187:       uptime: process.uptime(),
188:       timestamp: new Date().toISOString(),
189:       h2_outbound: h2Stats,
190:       circuit_breakers: circuitStats,
191:     },
192:     { status: 200 }
193:   );
194: }
195: 
196: type RouteHandler = (req: Request, rawKey: string, reqId: string) => Promise<Response>;
197: 
198: export const CHAT_PATHS: ReadonlySet<string> = new Set([
199:   "/v1/chat/completions",
200:   "/chat/completions",
201:   "/api/v1/chat/completions",
202:   "/v1/chat/completions/chat/completions",
203:   "/chat/completions/chat/completions",
204: ]);
205: 
206: export const RESPONSES_PATHS: ReadonlySet<string> = new Set([
207:   "/v1/responses",
208:   "/responses",
209:   "/api/v1/responses",
210:   "/v1/responses/responses",
211:   "/responses/responses",
212:   "/v1/response",
213:   "/response",
214:   "/api/v1/response",
215:   "/v1/response/response",
216:   "/response/response",
217:   "/v1/responses/response",
218:   "/v1/response/responses",
219:   "/responses/response",
220:   "/response/responses",
221: ]);
222: 
223: export const ANTHROPIC_PATHS: ReadonlySet<string> = new Set([
224:   "/v1/messages",
225:   "/messages",
226:   "/api/v1/messages",
227:   "/v1/messages/messages",
228:   "/messages/messages",
229:   "/v1/message",
230:   "/message",
231:   "/api/v1/message",
232:   "/v1/message/message",
233:   "/message/message",
234:   "/v1/messages/message",
235:   "/v1/message/messages",
236:   "/messages/message",
237:   "/message/messages",
238: ]);
239: 
240: export const ANTHROPIC_COUNT_TOKENS_PATHS: ReadonlySet<string> = new Set([
241:   "/v1/messages/count_tokens",
242:   "/messages/count_tokens",
243:   "/api/v1/messages/count_tokens",
244:   "/v1/messages/messages/count_tokens",
245:   "/messages/messages/count_tokens",
246:   "/v1/message/count_tokens",
247:   "/message/count_tokens",
248:   "/api/v1/message/count_tokens",
249:   "/v1/message/message/count_tokens",
250:   "/message/message/count_tokens",
251: ]);
252: 
253: export const MODELS_PATHS: ReadonlySet<string> = new Set([
254:   "/v1/models",
255:   "/v1beta/models",
256:   "/models",
257:   "/api/v1/models",
258: ]);
259: 
260: const ROUTE_MAP: Readonly<Record<string, RouteHandler>> = {
261:   "/v1/chat/completions": handleOpenAICompat,
262:   "/chat/completions": handleOpenAICompat,
263:   "/api/v1/chat/completions": handleOpenAICompat,
264:   "/v1/chat/completions/chat/completions": handleOpenAICompat,
265:   "/chat/completions/chat/completions": handleOpenAICompat,
266:   "/v1/messages": handleAnthropicCompat,
267:   "/messages": handleAnthropicCompat,
268:   "/api/v1/messages": handleAnthropicCompat,
269:   "/v1/messages/messages": handleAnthropicCompat,
270:   "/messages/messages": handleAnthropicCompat,
271:   "/v1/message": handleAnthropicCompat,
272:   "/message": handleAnthropicCompat,
273:   "/api/v1/message": handleAnthropicCompat,
274:   "/v1/message/message": handleAnthropicCompat,
275:   "/message/message": handleAnthropicCompat,
276:   "/v1/messages/message": handleAnthropicCompat,
277:   "/v1/message/messages": handleAnthropicCompat,
278:   "/messages/message": handleAnthropicCompat,
279:   "/message/messages": handleAnthropicCompat,
280:   "/v1/messages/count_tokens": handleAnthropicCountTokens,
281:   "/messages/count_tokens": handleAnthropicCountTokens,
282:   "/api/v1/messages/count_tokens": handleAnthropicCountTokens,
283:   "/v1/messages/messages/count_tokens": handleAnthropicCountTokens,
284:   "/messages/messages/count_tokens": handleAnthropicCountTokens,
285:   "/v1/message/count_tokens": handleAnthropicCountTokens,
286:   "/message/count_tokens": handleAnthropicCountTokens,
287:   "/api/v1/message/count_tokens": handleAnthropicCountTokens,
288:   "/v1/message/message/count_tokens": handleAnthropicCountTokens,
289:   "/message/message/count_tokens": handleAnthropicCountTokens,
290: };
291: 
292: const SYSTEM_MAP: Readonly<Record<string, () => Response>> = {
293:   "/health": handleHealthCheck,
294:   "/api/hello": handleHealthCheck,
295:   "/hello": handleHealthCheck,
296: };
297: 
298: function dispatchModelsRoute(path: string, req: Request, rawKey: string): Promise<Response> | null {
299:   if (MODELS_PATHS.has(path)) {
300:     if (!rawKey) {
301:       return Promise.resolve(
302:         Response.json(
303:           {
304:             error: {
305:               message: "Missing API key directive. Directives format: lr-<prov>-<payload>-<compl>-<nuances>",
306:               type: "invalid_request_error",
307:               code: "invalid_api_key",
308:             },
309:           },
310:           { status: 401 }
311:         )
312:       );
313:     }
314:     const directive = parseDirective(rawKey);
315:     if (!directive) {
316:       return Promise.resolve(
317:         Response.json(
318:           {
319:             error: {
320:               message: `Invalid API key directive '${rawKey}'. Must follow lr-<provider>-<payload>-<completions>-<nuance>`,
321:               type: "invalid_request_error",
322:               code: "invalid_api_key",
323:             },
324:           },
325:           { status: 401 }
326:         )
327:       );
328:     }
329:     return handleModelsDiscovery(req, directive);
330:   }
331:   return null;
332: }
333: 
334: function dispatchGoogleBeta(path: string, req: Request, rawKey: string, reqId: string): Promise<Response> | null {
335:   if (path.startsWith("/v1beta/interactions") || path.startsWith("/v1beta/files/")) {
336:     return handleGoogleInteractionsPassthrough(req, rawKey, reqId);
337:   }
338:   if (path.startsWith("/v1beta/openai/")) {
339:     return handleGoogleOpenAIBeta(req, rawKey, reqId);
340:   }
341:   if (path.startsWith("/v1beta/models/") || path.startsWith("/v1/models/")) {
342:     return handleGoogleNative(req, rawKey, reqId);
343:   }
344:   return null;
345: }
346: 
347: function parseDirectiveWithEndpoint(
348:   rawKey: string
349: ): (ParsedDirective & { readonly endpoint?: string }) | null {
350:   const parsed = parseDirective(rawKey);
351:   if (!parsed) {
352:     return null;
353:   }
354:   if (parsed.type === "direct") {
355:     return {
356:       ...parsed,
357:       endpoint: parsed.completion,
358:     };
359:   }
360:   return parsed;
361: }
362: 
363: export function validateEndpointMatch(
364:   pathname: string,
365:   directive?: { readonly endpoint?: string } | null
366: ): Response | null {
367:   if (CHAT_PATHS.has(pathname) && directive?.endpoint === "rs") {
368:     return new Response(
369:       JSON.stringify({
370:         error: {
371:           message: "Endpoint mismatch: Directive specifies Responses API (-rs-). Use /v1/responses.",
372:           type: "invalid_request_error",
373:         },
374:       }),
375:       { status: 400, headers: { "Content-Type": "application/json" } }
376:     );
377:   }
378:   if (RESPONSES_PATHS.has(pathname) && directive?.endpoint === "ch") {
379:     return new Response(
380:       JSON.stringify({
381:         error: {
382:           message: "Endpoint mismatch: Directive specifies Chat Completions (-ch-). Use /v1/chat/completions.",
383:           type: "invalid_request_error",
384:         },
385:       }),
386:       { status: 400, headers: { "Content-Type": "application/json" } }
387:     );
388:   }
389:   return null;
390: }
391: 
392: function isGcpRequest(rawKey: string, parsed: ParsedDirective | null): boolean {
393:   if (rawKey.startsWith("lr-gc-")) {
394:     return true;
395:   }
396:   return parsed?.type === "direct" && parsed.provider === "gc";
397: }
398: 
399: function dispatchGcpRoute(
400:   path: string,
401:   req: Request,
402:   rawKey: string,
403:   reqId: string,
404:   parsed: ParsedDirective | null
405: ): Promise<Response> | null {
406:   if (!isGcpRequest(rawKey, parsed)) {
407:     return null;
408:   }
409:   if (CHAT_PATHS.has(path) || path.startsWith("/v1beta/openai/")) {
410:     return handleGcpCompat(req, rawKey, reqId);
411:   }
412:   return null;
413: }
414: 
415: function dispatchResponsesRoute(
416:   req: Request,
417:   path: string,
418:   directive: Directive,
419:   state?: GatewayState
420: ): Promise<Response> | null {
421:   if (req.method === "POST" && RESPONSES_PATHS.has(path)) {
422:     return handleOpenAiOriginal(req, directive, state);
423:   }
424:   return null;
425: }
426: 
427: export { dispatchV4 };
428: 
429: export async function dispatchRoute(
430:   req: Request,
431:   rawKey: string,
432:   reqId: string,
433:   state?: GatewayState
434: ): Promise<Response> {
435:   const rawPath = new URL(req.url).pathname;
436:   const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
437: 
438:   if (path === "/admin/pool/reset") {
439:     return handleAdminPoolReset(req, rawKey);
440:   }
441: 
442:   if (path === "/reset") {
443:     return handleHardReset(req, rawKey);
444:   }
445: 
446:   const sysHandler = SYSTEM_MAP[path];
447:   if (sysHandler) {
448:     return sysHandler();
449:   }
450: 
451:   const modelsRes = dispatchModelsRoute(path, req, rawKey);
452:   if (modelsRes !== null) {
453:     return modelsRes;
454:   }
455: 
456:   const engine = resolveEngine(req);
457:   if (engine === "v4.1") {
458:     return dispatchV4(req, rawKey, reqId);
459:   }
460: 
461:   const directive = parseDirectiveWithEndpoint(rawKey);
462:   const mismatchRes = validateEndpointMatch(path, directive);
463:   if (mismatchRes !== null) {
464:     return mismatchRes;
465:   }
466: 
467:   const directiveObj = directive ?? { provider: "", raw: rawKey };
468:   const responsesRes = dispatchResponsesRoute(req, path, directiveObj, state);
469:   if (responsesRes !== null) {
470:     return responsesRes;
471:   }
472: 
473:   const gcpRes = dispatchGcpRoute(path, req, rawKey, reqId, directive);
474:   if (gcpRes !== null) {
475:     return gcpRes;
476:   }
477: 
478:   const directHandler = ROUTE_MAP[path];
479:   if (directHandler) {
480:     return directHandler(req, rawKey, reqId);
481:   }
482: 
483:   const betaRes = dispatchGoogleBeta(path, req, rawKey, reqId);
484:   if (betaRes !== null) {
485:     return betaRes;
486:   }
487: 
488:   logAmber(reqId, `404 Route Not Found: ${req.method} ${path} from ${req.headers.get("user-agent") || "unknown"}`);
489:   return Response.json({ error: { message: `Not Found: ${path}`, type: "invalid_request_error" } }, { status: 404 });
490: }
491: 
492: export function resetAllState(): void {
493:   initProviderRegistry();
494:   initStrategyRegistry();
495:   traceWriter.init();
496:   globalCooldownManager.clearAll();
497:   globalKeyPool.reset();
498:   initializeKeyPools();
499:   clearCircuitBreakerRegistry();
500:   resetCircuitBreakers();
501:   clearPacerRegistry();
502:   traceBuffer.clear();
503:   resetHttp2Pool();
504:   resetProvidersRegistryCache();
505:   loadAndCacheNativeChains();
506:   resetNativeFlashTierIndex();
507: }
508: 
509: export function getCooldownState(): Record<string, unknown> {
510:   return {};
511: }
512: 
513: export async function handleAppRequest(req: Request): Promise<Response> {
514:   initializeKeyPools();
515:   const reqId =
516:     req.headers.get("x-request-id") ||
517:     req.headers.get("x-req-id") ||
518:     `req_${Math.random().toString(36).slice(2, 9)}`;
519:   const rawKey = extractDirectiveToken(req) || "";
520:   try {
521:     const res = await dispatchRoute(req, rawKey, reqId);
522:     try {
523:       res.headers.set("x-request-id", reqId);
524:     } catch (headerErr) {
525:       logAmber(reqId, `Could not set x-request-id header: ${headerErr}`);
526:     }
527:     return res;
528:   } catch (err: unknown) {
529:     const msg = err instanceof Error ? err.message : String(err ?? "");
530:     const isStreamAbort =
531:       (req.signal && req.signal.aborted) ||
532:       msg.includes("The pending stream has been canceled") ||
533:       msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
534:       msg.includes("aborted");
535: 
536:     if (isStreamAbort) {
537:       logInfo(reqId, "Client aborted / stream canceled");
538:       return Response.json(
539:         { error: { message: "Request aborted by client", type: "client_closed_request" } },
540:         { status: 499 }
541:       );
542:     }
543:     logError(reqId, "Unhandled exception in request handler", err);
544:     return Response.json({ error: { message: "Internal Gateway Error", type: "server_error" } }, { status: 500 });
545:   }
546: }
547: 
548: function nodeHeadersToFetchHeaders(rawHeaders: NodeJS.Dict<string | string[]>): Headers {
549:   const headers = new Headers();
550:   for (const [key, value] of Object.entries(rawHeaders)) {
551:     if (!key || key.startsWith(":") || value === undefined) {
552:       continue;
553:     }
554:     if (Array.isArray(value)) {
555:       for (const v of value) {
556:         headers.append(key, v);
557:       }
558:     } else {
559:       headers.set(key, value);
560:     }
561:   }
562:   return headers;
563: }
564: 
565: async function pipeWebResponseToNode(
566:   webRes: Response,
567:   _nodeReq: http2.Http2ServerRequest,
568:   nodeRes: http2.Http2ServerResponse
569: ): Promise<void> {
570:   if (nodeRes.destroyed || nodeRes.writableEnded) {
571:     return;
572:   }
573: 
574:   nodeRes.statusCode = webRes.status;
575:   webRes.headers.forEach((val, key) => {
576:     const lower = key.toLowerCase();
577:     if (lower !== "transfer-encoding" && lower !== "connection") {
578:       nodeRes.setHeader(key, val);
579:     }
580:   });
581: 
582:   if (!webRes.body) {
583:     if (!nodeRes.writableEnded && !nodeRes.destroyed) {
584:       nodeRes.end();
585:     }
586:     return;
587:   }
588: 
589:   const reader = webRes.body.getReader();
590:   let isAborted = false;
591: 
592:   const cancelReader = () => {
593:     if (isAborted) return;
594:     isAborted = true;
595:     reader.cancel().catch((cancelErr: unknown) => {
596:       const cancelMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr ?? "");
597:       console.debug(`[H2 Server] Reader cancel error: ${cancelMsg}`);
598:     });
599:   };
600: 
601:   const onResClose = () => {
602:     if (!nodeRes.writableEnded) {
603:       cancelReader();
604:     }
605:   };
606: 
607:   nodeRes.once("close", onResClose);
608: 
609:   try {
610:     while (!isAborted && !nodeRes.destroyed && !nodeRes.writableEnded) {
611:       const { done, value } = await reader.read();
612:       if (done) {
613:         break;
614:       }
615:       if (value && !nodeRes.destroyed && !nodeRes.writableEnded) {
616:         const canContinue = nodeRes.write(value);
617:         if (!canContinue && !nodeRes.destroyed && !nodeRes.writableEnded) {
618:           await new Promise<void>((resolve) => nodeRes.once("drain", resolve));
619:         }
620:       }
621:     }
622:   } catch (err: unknown) {
623:     const msg = err instanceof Error ? err.message : String(err ?? "");
624:     const isStreamAbort =
625:       isAborted ||
626:       nodeRes.destroyed ||
627:       msg.includes("The pending stream has been canceled") ||
628:       msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
629:       msg.includes("aborted");
630: 
631:     if (!isStreamAbort) {
632:       logError("STREAM", "Stream read error during HTTP/2 response piping", err);
633:     }
634:     if (!nodeRes.destroyed && !nodeRes.writableEnded) {
635:       try {
636:         nodeRes.destroy(err instanceof Error ? err : new Error(String(err)));
637:       } catch (destroyErr: unknown) {
638:         console.debug("[H2 Server] Error destroying nodeRes stream:", destroyErr);
639:       }
640:     }
641:   } finally {
642:     nodeRes.removeListener("close", onResClose);
643:     if (!nodeRes.writableEnded && !nodeRes.destroyed) {
644:       try {
645:         nodeRes.end();
646:       } catch (endErr: unknown) {
647:         console.debug("[H2 Server] Error ending nodeRes stream:", endErr);
648:       }
649:     }
650:   }
651: }
652: 
653: export interface LiteRouterServer {
654:   readonly port: number;
655:   readonly stop: () => void | Promise<void>;
656: }
657: 
658: export function createServer(portOverride?: number): Server<unknown> | LiteRouterServer {
659:   initProviderRegistry();
660:   initStrategyRegistry();
661:   traceWriter.init();
662:   initializeKeyPools();
663:   loadAndCacheNativeChains();
664:   const env = getEnv();
665: 
666:   // Single authority: config/location.json. No env/hardcoded fallback for bind.
667:   const location = loadLocationConfig();
668: 
669:   const port = portOverride ?? location.port;
670:   const host = location.host;
671:   const tlsEnabled = location.tls_enabled;
672:   const tls = tlsEnabled ? loadTlsOptions(true) : undefined;
673: 
674:   const pools = loadKeyPools(process.env);
675:   const keyPools = Array.from(pools.entries())
676:     .map(([code, keys]) => ({ provider: code, activeKeys: keys.length }))
677:     .filter((p) => p.activeKeys > 0);
678: 
679:   const bannerOpts: BannerOptions = {
680:     port,
681:     tlsEnabled: Boolean(tls),
682:     stripReasoning: env.LITEROUTER_STRIP_REASONING,
683:     keyPools,
684:   };
685:   printBanner(bannerOpts);
686: 
687:   if (tls && env.LITEROUTER_HTTP2) {
688:     const h2Server = http2.createSecureServer(
689:       {
690:         cert: tls.cert,
691:         key: tls.key,
692:         allowHTTP1: true,
693:         ALPNProtocols: ["h2", "http/1.1"],
694:       },
695:       async (nodeReq, nodeRes) => {
696:         nodeReq.on("error", () => {});
697:         nodeRes.on("error", () => {});
698: 
699:         const abortController = new AbortController();
700:         const onAbort = () => {
701:           if (!nodeRes.writableEnded) {
702:             try {
703:               if (!abortController.signal.aborted) {
704:                 abortController.abort();
705:               }
706:             } catch (abortErr: unknown) {
707:               console.debug("[H2 Server] Client abort exception:", abortErr);
708:             }
709:           }
710:         };
711:         nodeReq.once("aborted", onAbort);
712:         nodeRes.once("close", onAbort);
713: 
714:         const chunks: Buffer[] = [];
715:         nodeReq.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
716:         nodeReq.on("end", async () => {
717:           const reqId = `req_${Math.random().toString(36).slice(2, 9)}`;
718:           try {
719:             const hasBody = !["GET", "HEAD"].includes(nodeReq.method || "");
720:             const body = hasBody && chunks.length > 0 ? Buffer.concat(chunks) : undefined;
721:             const authority = (nodeReq.headers[":authority"] as string) || nodeReq.headers.host || `localhost:${port}`;
722:             const url = `https://${authority}${nodeReq.url}`;
723: 
724:             const fetchHeaders = nodeHeadersToFetchHeaders(nodeReq.headers);
725:             fetchHeaders.set("x-http-version", `HTTP/${nodeReq.httpVersion}`);
726: 
727:             const req = new Request(url, {
728:               method: nodeReq.method,
729:               headers: fetchHeaders,
730:               body,
731:               signal: abortController.signal,
732:             });
733: 
734:             const webRes = await handleAppRequest(req);
735:             await pipeWebResponseToNode(webRes, nodeReq, nodeRes);
736:           } catch (err) {
737:             const msg = err instanceof Error ? err.message : String(err ?? "");
738:             const isClientAbort =
739:               abortController.signal.aborted ||
740:               nodeRes.destroyed ||
741:               msg.includes("The pending stream has been canceled") ||
742:               msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
743:               msg.includes("aborted") ||
744:               msg.includes("premature close");
745: 
746:             if (isClientAbort) {
747:               logAmber(reqId, `Downstream HTTP/2 client stream aborted/canceled: ${msg}`);
748:             } else {
749:               logError(reqId, "Unhandled exception in HTTP/2 server route dispatch", err);
750:               if (!nodeRes.headersSent && !nodeRes.destroyed) {
751:                 nodeRes.writeHead(500, { "content-type": "application/json" });
752:                 nodeRes.end(JSON.stringify({ error: { message: "Internal Gateway Error", type: "server_error" } }));
753:               }
754:             }
755:           } finally {
756:             nodeReq.removeListener("aborted", onAbort);
757:             nodeRes.removeListener("close", onAbort);
758:           }
759:         });
760:       }
761:     );
762: 
763:     h2Server.on("clientError", (_err, socket) => {
764:       if (!socket.destroyed) {
765:         socket.destroy();
766:       }
767:     });
768: 
769:     h2Server.on("unknownProtocol", (socket) => {
770:       if (!socket.destroyed) {
771:         socket.destroy();
772:       }
773:     });
774: 
775:     h2Server.listen(port, host);
776: 
777:     return {
778:       port,
779:       stop: () =>
780:         new Promise<void>((resolve) => {
781:           traceWriter.drainSync();
782:           h2Server.close(() => resolve());
783:         }),
784:     };
785:   }
786: 
787:   return Bun.serve({
788:     port,
789:     hostname: host,
790:     idleTimeout: env.LITEROUTER_IDLE_TIMEOUT_SEC,
791:     tls: tls ? { cert: tls.cert, key: tls.key } : undefined,
792:     async fetch(req: Request) {
793:       return handleAppRequest(req);
794:     },
795:   });
796: }
797: 
798: export function closeServer(server?: Server<unknown> | LiteRouterServer): void {
799:   traceWriter.drainSync();
800:   if (!server) return;
801:   if ("stop" in server && typeof server.stop === "function") {
802:     server.stop();
803:   }
804: }
805: 
806: const isClientAbortReason = (reason: unknown): boolean => {
807:   const isAbort = reason instanceof Error && reason.name === "AbortError";
808:   if (isAbort) {
809:     return true;
810:   }
811:   const msg = reason instanceof Error ? reason.message : String(reason ?? "");
812:   return (
813:     msg.includes("aborted") ||
814:     msg.includes("ECONNRESET") ||
815:     msg.includes("EPIPE") ||
816:     msg.includes("ERR_HTTP2_STREAM_CANCEL")
817:   );
818: };
819: 
820: process.on("uncaughtException", (err) => {
821:   if (isClientAbortReason(err)) {
822:     return;
823:   }
824:   console.error("FATAL: Uncaught exception in gateway process:", err);
825:   traceWriter.drainSync();
826:   process.exit(1);
827: });
828: 
829: process.on("unhandledRejection", (reason) => {
830:   if (isClientAbortReason(reason)) {
831:     return;
832:   }
833:   console.error("Unhandled promise rejection in gateway process:", reason);
834: });
835: 
836: process.on("SIGINT", () => {
837:   traceWriter.drainSync();
838:   process.exit(0);
839: });
840: 
841: process.on("SIGTERM", () => {
842:   traceWriter.drainSync();
843:   process.exit(0);
844: });
845: 
846: process.on("beforeExit", () => {
847:   traceWriter.drainSync();
848: });
849: 
850: if (import.meta.main) {
851:   createServer();
852: }
```

## File: src/handlers/openai_compat.ts
```typescript
   1: import { existsSync, readFileSync } from "node:fs";
   2: import { resolve } from "node:path";
   3: import { loadKeyPools } from "../config/keys";
   4: import type { DirectDirective, ParsedDirective } from "../directive/parser";
   5: import { parseDirective } from "../directive/parser";
   6: import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
   7: import { FusionEngine } from "../fusion/engine";
   8: import { classifyTransportError, classifyUpstreamError, type ErrorDisposition } from "../network/classifier";
   9: import { CooldownManager } from "../network/cooldown";
  10: import {
  11:   createResilientStream,
  12:   fetchWithTtftGuard,
  13:   type FetcherOptions,
  14:   NoResponseError,
  15:   sanitizeDownstreamHeaders,
  16: } from "../network/fetcher";
  17: import { FatalAuthError, isFatalAuthError, KeyPool, type SelectedKey } from "../network/pool";
  18: import { sanitizeAndTransformPayload } from "../transformers/payload";
  19: import type { OpenAIRequestPayload } from "../transformers/nuances";
  20: import { createDotsStreamTransformer, parseDotsXml, stripLeakedTemplateTags } from "../transformers/dots";
  21: import { createLingStreamTransformer, parseLingXml, transformLingResponse } from "../transformers/ling";
  22: import {
  23:   createResponsesStreamTransformer,
  24:   transformOpenAiToResponses,
  25:   transformResponsesToOpenAi,
  26: } from "../transformers/responses";
  27: 
  28: import type { FusionConfig, FusionTier, ProviderConfigEntry } from "../config/schema";
  29: import {
  30:   getProviderConfig,
  31:   isRegisteredProvider,
  32:   initProviderRegistry,
  33:   getAllProviders,
  34:   overrideProviderUrl,
  35:   resolveUpstreamEndpoint,
  36: } from "../config/providers";
  37: import { getEnv } from "../config/env";
  38: import { getPacerForProvider, PacerQueueOverflowError, type PacerAcquireResult } from "../network/pacer";
  39: import {
  40:   EMOJI,
  41:   extractErrorMessage,
  42:   formatTimestamp,
  43:   getProviderDisplayName,
  44:   logError,
  45:   logExhausted,
  46:   logFinishReason,
  47:   logInbound,
  48:   logLimit,
  49:   logRotate,
  50:   logSeparator,
  51:   logServed,
  52:   logTtft,
  53:   logUsage,
  54:   logWarn,
  55:   type UsageLogDetails,
  56: } from "../ui/logger";
  57: import type { ConserveRule } from "../network/cooldown";
  58: import {
  59:   DEFAULT_MAX_CONTEXT_TOKENS,
  60:   DEFAULT_SAFE_CONTEXT_TOKENS,
  61:   estimateOpenAITokens,
  62:   extractContextLimit,
  63:   isContextLengthError,
  64:   pruneOpenAIPayload,
  65: } from "../transformers/context_pruner";
  66: import { ensureSessionHeaders, extractClientSessionId, generateOpenCodeSessionId } from "../engine/session_id";
  67: import {
  68:   buildZenHeaders,
  69:   adaptZenPayload,
  70:   accumulateZenStreamToCompletion,
  71: } from "../engine/zen";
  72: 
  73: export interface ProviderEndpointConfig extends Omit<ProviderConfigEntry, "conserve_rules"> {
  74:   readonly conserve_rules?: readonly ConserveRule[];
  75: }
  76: 
  77: export function resetProvidersRegistryCache(): void {
  78:   initProviderRegistry();
  79: }
  80: 
  81: export function getProviderEndpointConfig(providerCode: string): ProviderEndpointConfig | undefined {
  82:   return isRegisteredProvider(providerCode)
  83:     ? (getProviderConfig(providerCode) as unknown as ProviderEndpointConfig)
  84:     : undefined;
  85: }
  86: 
  87: export { overrideProviderUrl, resolveUpstreamEndpoint, ensureSessionHeaders, extractClientSessionId };
  88: 
  89: function generateZenSessionId(): string {
  90:   return generateOpenCodeSessionId();
  91: }
  92: 
  93: export function buildAuthHeaders(
  94:   authHeader: "Bearer" | "x-api-key",
  95:   key: string,
  96:   provider?: string,
  97:   incomingHeaders?: Headers | Record<string, string>
  98: ): Record<string, string> {
  99:   const headers: Record<string, string> = {
 100:     "Content-Type": "application/json",
 101:     "Accept-Encoding": "identity",
 102:   };
 103:   if (authHeader === "x-api-key") {
 104:     headers["x-api-key"] = key;
 105:     headers["anthropic-version"] = "2023-06-01";
 106:   } else {
 107:     headers["Authorization"] = `Bearer ${key}`;
 108:   }
 109:   if (provider === "gg") {
 110:     headers["x-goog-api-key"] = key;
 111:   }
 112:   if (provider) {
 113:     const norm = provider.toLowerCase();
 114:     const entry = getAllProviders().find(
 115:       (p) => p.code.toLowerCase() === norm || p.name?.toLowerCase() === norm
 116:     );
 117:     if (entry?.headers) {
 118:       Object.assign(headers, entry.headers);
 119:     }
 120:   }
 121:   if (incomingHeaders) {
 122:     const entries =
 123:       typeof (incomingHeaders as Headers).entries === "function"
 124:         ? (incomingHeaders as Headers).entries()
 125:         : Object.entries(incomingHeaders);
 126:     for (const [k, v] of entries) {
 127:       const lower = k.toLowerCase();
 128:       if (lower === "x-client-version" || lower === "x-client-name") {
 129:         headers[k] = v;
 130:       }
 131:     }
 132:   }
 133:   ensureSessionHeaders(headers, incomingHeaders);
 134:   if (provider === "zn" || provider === "zen") {
 135:     const { buildZenHeaders } = require("../engine/zen");
 136:     const zenHeaders = buildZenHeaders(incomingHeaders, headers["session-id"]);
 137:     Object.assign(headers, zenHeaders);
 138:   }
 139:   return headers;
 140: }
 141: 
 142: export const globalCooldownManager = new CooldownManager();
 143: export const globalKeyPool = new KeyPool(globalCooldownManager);
 144: 
 145: export function initializeKeyPools(envSource: Record<string, string | undefined> = process.env): void {
 146:   const pools = loadKeyPools(envSource);
 147:   for (const [code, keys] of pools.entries()) {
 148:     if (keys.length > 0) {
 149:       globalKeyPool.setPool(code, keys);
 150:     } else {
 151:       globalKeyPool.setPool(code, [`sk-stub-${code}-mock-key-1`, `sk-stub-${code}-mock-key-2`]);
 152:     }
 153:   }
 154: }
 155: 
 156: function mergeUint8Arrays(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
 157:   const result = new Uint8Array(totalLength);
 158:   let offset = 0;
 159:   for (const chunk of chunks) {
 160:     result.set(chunk, offset);
 161:     offset += chunk.length;
 162:   }
 163:   return result;
 164: }
 165: 
 166: async function collectFullBody(
 167:   firstChunk: Uint8Array,
 168:   reader: ReadableStreamDefaultReader<Uint8Array>
 169: ): Promise<Uint8Array> {
 170:   const chunks: Uint8Array[] = [firstChunk];
 171:   let totalLength = firstChunk.length;
 172:   let reading = true;
 173: 
 174:   while (reading) {
 175:     const { done, value } = await reader.read();
 176:     if (done) {
 177:       reading = false;
 178:     } else if (value) {
 179:       chunks.push(value);
 180:       totalLength += value.length;
 181:     }
 182:   }
 183:   return mergeUint8Arrays(chunks, totalLength);
 184: }
 185: 
 186: export class UpstreamRetryableError extends Error {
 187:   public readonly status: number;
 188:   public readonly classification: ErrorDisposition;
 189: 
 190:   public constructor(message: string, status: number, classification: ErrorDisposition) {
 191:     super(message);
 192:     this.name = "UpstreamRetryableError";
 193:     this.status = status;
 194:     this.classification = classification;
 195:   }
 196: }
 197: 
 198: export interface RequestClientOptions {
 199:   readonly userAgent?: string;
 200:   readonly headers?: Headers | Record<string, string | string[] | undefined>;
 201:   readonly filterReasoning?: boolean;
 202: }
 203: 
 204: 
 205: 
 206: export function parseRetryAfterHeader(headers: Headers): number | undefined {
 207:   const ra = headers.get("retry-after");
 208:   if (!ra) {
 209:     return undefined;
 210:   }
 211:   const parsed = Number.parseInt(ra, 10);
 212:   return Number.isNaN(parsed) ? undefined : parsed;
 213: }
 214: 
 215: async function executeDirectCall(
 216:   directive: DirectDirective,
 217:   payload: OpenAIRequestPayload,
 218:   clientSignal: AbortSignal | undefined,
 219:   selected: SelectedKey,
 220:   reqId: string,
 221:   attempt: number,
 222:   maxAttempts: number,
 223:   clientOptions?: RequestClientOptions
 224: ): Promise<Response> {
 225:   const env = getEnv();
 226:   const provConfig = isRegisteredProvider(directive.provider)
 227:     ? getProviderConfig(directive.provider)
 228:     : undefined;
 229:   const isSingleFlight = !(provConfig?.request_retry?.enabled ?? true);
 230: 
 231:   let activePayload = payload;
 232:   let zenRequiresAccumulation = false;
 233:   if ((directive.provider === "or" || (directive.provider as string) === "openrouter") && payload.model.startsWith("openrouter/")) {
 234:     activePayload = {
 235:       ...payload,
 236:       model: payload.model.slice("openrouter/".length),
 237:     };
 238:   } else if (directive.provider === "zn" || (directive.provider as string) === "zen") {
 239:     const adapted = adaptZenPayload(activePayload);
 240:     activePayload = adapted.adaptedBody as OpenAIRequestPayload;
 241:     zenRequiresAccumulation = adapted.requiresAccumulation;
 242:   }
 243: 
 244:   const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, activePayload.model);
 245:   const clientHdrs = clientOptions?.headers instanceof Headers
 246:     ? clientOptions.headers
 247:     : (clientOptions?.headers ? new Headers(clientOptions.headers as Record<string, string>) : undefined);
 248:   const headers = buildAuthHeaders(endpoint.authHeader, selected.key, directive.provider, clientHdrs);
 249:   if (directive.provider === "zn" || (directive.provider as string) === "zen") {
 250:     const { scrubZenHeaders, buildZenHeaders } = require("../engine/zen");
 251:     scrubZenHeaders(headers);
 252:     Object.assign(headers, buildZenHeaders(clientHdrs));
 253:   }
 254:   const isResponses = directive.completion === "rs";
 255:   const outboundBody = isResponses
 256:     ? JSON.stringify(transformOpenAiToResponses(activePayload))
 257:     : JSON.stringify(activePayload);
 258: 
 259:   const fetchOpts: FetcherOptions = {
 260:     url: endpoint.url,
 261:     method: "POST",
 262:     headers,
 263:     body: outboundBody,
 264:     clientSignal,
 265:     provider: directive.provider,
 266:     keyIndex: selected.index,
 267:     model: activePayload.model,
 268:   };
 269: 
 270:   const startTime = Date.now();
 271:   const { response, ttftMs, firstChunk, rawReader, protocol } = await fetchWithTtftGuard(fetchOpts);
 272:   const duration = Date.now() - startTime;
 273: 
 274:   const isStream = Boolean(payload.stream);
 275: 
 276:   if (response.status >= 400) {
 277:     const fullBody = await collectFullBody(firstChunk, rawReader);
 278:     const bodyText = new TextDecoder().decode(fullBody);
 279:     const providerConfig = getProviderEndpointConfig(directive.provider);
 280:     const classification = classifyUpstreamError({
 281:       provider: directive.provider,
 282:       status: response.status,
 283:       headers: response.headers,
 284:       bodyText,
 285:       conserveRules: providerConfig?.conserve_rules,
 286:     });
 287: 
 288:     if (response.status === 401 || response.status === 403) {
 289:       try {
 290:         globalKeyPool.reportFailure(
 291:           directive.provider,
 292:           selected.index,
 293:           response.status,
 294:           response.headers,
 295:           bodyText,
 296:           Date.now(),
 297:           classification.quarantineTtlSec
 298:         );
 299:       } catch (authErr: unknown) {
 300:         if (!isFatalAuthError(authErr)) {
 301:           throw authErr;
 302:         }
 303:       }
 304: 
 305:       logLimit(reqId, directive.provider, selected.index, response.status, undefined, selected.totalKeys, extractErrorMessage(bodyText));
 306:       logServed(reqId, duration, response.status, attempt, maxAttempts);
 307:       logSeparator();
 308: 
 309:       if (fullBody.byteLength > 0) {
 310:         return new Response(fullBody.buffer as ArrayBuffer, {
 311:           status: response.status,
 312:           headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
 313:         });
 314:       }
 315: 
 316:       return Response.json(
 317:         {
 318:           error: {
 319:             message: `Fatal authentication failure (HTTP ${response.status}) for provider "${directive.provider}" key index ${selected.index}`,
 320:             type: "authentication_error",
 321:             code: response.status,
 322:           },
 323:         },
 324:         {
 325:           status: response.status,
 326:           headers: { "Content-Type": "application/json" },
 327:         }
 328:       );
 329:     }
 330: 
 331:     const quarantineEnabled = globalKeyPool.isQuarantineEnabled(directive.provider);
 332:     if (classification.isConserve && classification.quarantineTtlSec > 0) {
 333:       globalKeyPool.conserveKey(
 334:         directive.provider,
 335:         selected.index,
 336:         classification.quarantineTtlSec,
 337:         classification.reason,
 338:         response.status
 339:       );
 340:       console.warn(
 341:         `${EMOJI.limit} ${formatTimestamp()} [CONSERVE ${reqId}] ${getProviderDisplayName(directive.provider)} [Key #${selected.index + 1}/${selected.totalKeys}] matched conserve rule "${classification.reason}" -> Parked for ${classification.quarantineTtlSec}s`
 342:       );
 343:     } else if (quarantineEnabled && classification.quarantineTtlSec > 0) {
 344:       globalKeyPool.reportFailure(
 345:         directive.provider,
 346:         selected.index,
 347:         response.status,
 348:         response.headers,
 349:         bodyText,
 350:         Date.now(),
 351:         classification.quarantineTtlSec
 352:       );
 353:     } else if (!quarantineEnabled && classification.quarantineTtlSec > 0) {
 354:       logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode (${directive.provider.toUpperCase()}_ENABLE_QUARANTINE=false): Key ${selected.index} quarantine bypassed.`);
 355:     }
 356: 
 357:     if (!classification.isConserve) {
 358:       const rawErrorMsg = extractErrorMessage(bodyText);
 359:       const ttlSec = !quarantineEnabled || classification.quarantineTtlSec === 0
 360:         ? undefined
 361:         : classification.quarantineTtlSec;
 362:       logLimit(reqId, directive.provider, selected.index, response.status, ttlSec, selected.totalKeys, rawErrorMsg);
 363:     }
 364: 
 365:     if (isContextLengthError(response.status, bodyText) && !clientSignal?.aborted) {
 366:       const detectedLimit = extractContextLimit(bodyText);
 367:       const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
 368:       const pruned = pruneOpenAIPayload(payload, targetLimit);
 369:       if (pruned.messages.length < payload.messages.length || estimateOpenAITokens(pruned) < estimateOpenAITokens(payload)) {
 370:         logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
 371:         return executeDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts, clientOptions);
 372:       }
 373:     }
 374: 
 375:     const retriesEnabled = !isSingleFlight;
 376:     const canRetry =
 377:       (classification.isConserve || retriesEnabled) &&
 378:       classification.action === "retry_rotate" &&
 379:       attempt < maxAttempts &&
 380:       !clientSignal?.aborted;
 381:     if (canRetry) {
 382:       throw new UpstreamRetryableError(
 383:         `Upstream error ${response.status}: ${classification.reason}`,
 384:         response.status,
 385:         classification
 386:       );
 387:     }
 388: 
 389:     if (isSingleFlight && classification.action === "retry_rotate") {
 390:       logWarn(
 391:         EMOJI.zap,
 392:         `[${directive.provider.toUpperCase()} ${reqId}] Single-flight mode: Passing HTTP ${response.status} directly downstream.`
 393:       );
 394:     }
 395: 
 396:     logServed(reqId, duration, response.status, attempt, maxAttempts);
 397:     logSeparator();
 398: 
 399:     return new Response(fullBody.buffer as ArrayBuffer, {
 400:       status: response.status,
 401:       headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
 402:     });
 403:   }
 404: 
 405:   globalKeyPool.reportSuccess(directive.provider, selected.index);
 406:   logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", protocol);
 407: 
 408:   const isLing =
 409:     directive.nuances.includes("lg") ||
 410:     Boolean(payload.model && payload.model.toLowerCase().includes("ling"));
 411: 
 412:   const isXmlTranslationActive =
 413:     directive.nuances.includes("tc") ||
 414:     Boolean(payload.model && payload.model.toLowerCase().includes("dots"));
 415: 
 416:   if (!isStream) {
 417:     let finalBody: Uint8Array;
 418:     let json: Record<string, unknown> | null = null;
 419:     if (zenRequiresAccumulation) {
 420:       let firstChunkYielded = false;
 421:       const stream = new ReadableStream<Uint8Array>({
 422:         async pull(controller) {
 423:           if (!firstChunkYielded) {
 424:             firstChunkYielded = true;
 425:             if (firstChunk.byteLength > 0) {
 426:               controller.enqueue(firstChunk);
 427:               return;
 428:             }
 429:           }
 430:           try {
 431:             const { done, value } = await rawReader.read();
 432:             if (done) {
 433:               controller.close();
 434:             } else if (value) {
 435:               controller.enqueue(value);
 436:             }
 437:           } catch (err: unknown) {
 438:             controller.error(err);
 439:           }
 440:         },
 441:         cancel(reason) {
 442:           return rawReader.cancel(reason);
 443:         },
 444:       });
 445:       const completion = await accumulateZenStreamToCompletion(stream, activePayload.model);
 446:       finalBody = new TextEncoder().encode(JSON.stringify(completion));
 447:       json = completion;
 448:     } else {
 449:       const fullBody = await collectFullBody(firstChunk, rawReader);
 450:       finalBody = fullBody;
 451:       try {
 452:         const decoded = new TextDecoder().decode(fullBody);
 453:         json = JSON.parse(decoded) as Record<string, unknown>;
 454:       } catch (parseErr) {
 455:         void parseErr;
 456:       }
 457:     }
 458: 
 459:     try {
 460:       if (json && !zenRequiresAccumulation) {
 461:         if (isResponses) {
 462:           const transformedResponse = transformResponsesToOpenAi(json, activePayload.model);
 463:           finalBody = new TextEncoder().encode(JSON.stringify(transformedResponse));
 464:         } else {
 465:           const choice = (json.choices as Array<{ message?: { content?: string | null; reasoning_content?: string | null; thought?: string | null; tool_calls?: unknown }; finish_reason?: string }>)?.[0];
 466:           if (choice?.message && isLing) {
 467:             const transformedResponse = transformLingResponse(json);
 468:             finalBody = new TextEncoder().encode(JSON.stringify(transformedResponse));
 469:           } else if (choice?.message && isXmlTranslationActive) {
 470:             let msgModified = false;
 471:             if (typeof choice.message.content === "string") {
 472:               const { cleanText, toolCalls, reasoningContent } = parseDotsXml(choice.message.content);
 473:               if (toolCalls.length > 0 || cleanText !== choice.message.content || reasoningContent) {
 474:                 choice.message.content = cleanText || null;
 475:                 if (toolCalls.length > 0) {
 476:                   choice.message.tool_calls = toolCalls;
 477:                   choice.finish_reason = "tool_calls";
 478:                 }
 479:                 if (reasoningContent && !choice.message.reasoning_content) {
 480:                   choice.message.reasoning_content = reasoningContent;
 481:                 }
 482:                 msgModified = true;
 483:               }
 484:             }
 485:             if (typeof choice.message.reasoning_content === "string") {
 486:               const cleaned = stripLeakedTemplateTags(choice.message.reasoning_content);
 487:               if (cleaned !== choice.message.reasoning_content) {
 488:                 choice.message.reasoning_content = cleaned || null;
 489:                 msgModified = true;
 490:               }
 491:             }
 492:             if (typeof choice.message.thought === "string") {
 493:               const cleaned = stripLeakedTemplateTags(choice.message.thought);
 494:               if (cleaned !== choice.message.thought) {
 495:                 choice.message.thought = cleaned || null;
 496:                 msgModified = true;
 497:               }
 498:             }
 499:             if (msgModified) {
 500:               finalBody = new TextEncoder().encode(JSON.stringify(json));
 501:             }
 502:           }
 503:         }
 504:       }
 505: 
 506:       if (json) {
 507:         const choiceForFinish = isResponses
 508:           ? { finish_reason: "stop" }
 509:           : (json.choices as Array<{ finish_reason?: string | null }>)?.[0];
 510:         if (choiceForFinish?.finish_reason) {
 511:           logFinishReason(reqId, choiceForFinish.finish_reason);
 512:         }
 513: 
 514:         if (json.usage && typeof json.usage === "object") {
 515:           const u = json.usage as Record<string, unknown>;
 516:           const promptTokens = typeof u.prompt_tokens === "number"
 517:             ? u.prompt_tokens
 518:             : typeof u.input_tokens === "number"
 519:             ? u.input_tokens
 520:             : 0;
 521:           const completionTokens = typeof u.completion_tokens === "number"
 522:             ? u.completion_tokens
 523:             : typeof u.output_tokens === "number"
 524:             ? u.output_tokens
 525:             : 0;
 526:           const totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
 527:           let reasoningTokens: number | undefined;
 528:           if (u.completion_tokens_details && typeof u.completion_tokens_details === "object") {
 529:             const details = u.completion_tokens_details as Record<string, unknown>;
 530:             if (typeof details.reasoning_tokens === "number") {
 531:               reasoningTokens = details.reasoning_tokens;
 532:             }
 533:           } else if (u.output_tokens_details && typeof u.output_tokens_details === "object") {
 534:             const details = u.output_tokens_details as Record<string, unknown>;
 535:             if (typeof details.reasoning_tokens === "number") {
 536:               reasoningTokens = details.reasoning_tokens;
 537:             }
 538:           }
 539:           logUsage({
 540:             reqId,
 541:             provider: directive.provider,
 542:             keyIndex: selected.index,
 543:             totalKeys: selected.totalKeys,
 544:             promptTokens,
 545:             reasoningTokens,
 546:             completionTokens,
 547:             totalTokens,
 548:             durationMs: duration,
 549:           });
 550:         }
 551:       }
 552:     } catch (parseErr) {
 553:       void parseErr;
 554:     }
 555: 
 556:     logServed(reqId, duration, response.status, attempt, maxAttempts);
 557:     logSeparator();
 558: 
 559:     return new Response(finalBody.buffer as ArrayBuffer, {
 560:       status: response.status,
 561:       headers: sanitizeDownstreamHeaders(response.headers, finalBody.byteLength),
 562:     });
 563:   }
 564: 
 565:   let currentKeyIndex = selected.index;
 566:   let currentAttempt = attempt;
 567: 
 568:   let resilientStream = createResilientStream(firstChunk, rawReader, {
 569:     protocol: "openai",
 570:     onUsage: (u) => {
 571:       const streamDuration = Date.now() - startTime;
 572:       logUsage({
 573:         reqId,
 574:         provider: directive.provider,
 575:         keyIndex: currentKeyIndex,
 576:         totalKeys: selected.totalKeys,
 577:         promptTokens: u.promptTokens,
 578:         reasoningTokens: u.reasoningTokens,
 579:         completionTokens: u.completionTokens,
 580:         totalTokens: u.totalTokens,
 581:         durationMs: streamDuration,
 582:       });
 583:       logServed(reqId, streamDuration, response.status, currentAttempt, maxAttempts);
 584:       logSeparator();
 585:     },
 586:     onFinishReason: (finishReason) => {
 587:       logFinishReason(reqId, finishReason);
 588:     },
 589:     retryProvider: async (reason: string, _hasEmittedTokens?: boolean) => {
 590:       const classification = classifyTransportError(reason);
 591:       const midQuarantineEnabled = globalKeyPool.isQuarantineEnabled(directive.provider);
 592:       if (midQuarantineEnabled && classification.quarantineTtlSec > 0) {
 593:         globalKeyPool.reportFailure(directive.provider, currentKeyIndex, 500, undefined, reason, Date.now(), classification.quarantineTtlSec);
 594:       } else if (!midQuarantineEnabled && classification.quarantineTtlSec > 0) {
 595:         logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Dumb-forwarder mode (${directive.provider.toUpperCase()}_ENABLE_QUARANTINE=false): Key ${currentKeyIndex} quarantine bypassed.`);
 596:       }
 597:       const midTtlSec = !midQuarantineEnabled || classification.quarantineTtlSec === 0
 598:         ? undefined
 599:         : classification.quarantineTtlSec;
 600:       logLimit(reqId, directive.provider, currentKeyIndex, 500, midTtlSec, selected.totalKeys, reason);
 601: 
 602:       if (isSingleFlight) {
 603:         logWarn(
 604:           EMOJI.zap,
 605:           `[${directive.provider.toUpperCase()} ${reqId}] Mid-stream drop occurred. Retries disabled in single-flight mode. Closing stream.`
 606:         );
 607:         return null;
 608:       }
 609: 
 610:       while (currentAttempt < maxAttempts) {
 611:         currentAttempt++;
 612:         if (clientSignal?.aborted) {
 613:           return null;
 614:         }
 615:         const nextSelected = globalKeyPool.selectNextKey(directive.provider);
 616:         if (!nextSelected) {
 617:           return null;
 618:         }
 619:         logRotate(reqId, directive.provider, currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
 620:         currentKeyIndex = nextSelected.index;
 621: 
 622:         const nextHeaders = buildAuthHeaders(endpoint.authHeader, nextSelected.key, directive.provider, clientHdrs);
 623:         const nextFetchOpts: FetcherOptions = {
 624:           url: endpoint.url,
 625:           method: "POST",
 626:           headers: nextHeaders,
 627:           body: outboundBody,
 628:           clientSignal,
 629:           provider: directive.provider,
 630:           keyIndex: nextSelected.index,
 631:           model: activePayload.model,
 632:         };
 633: 
 634:         await acquireProviderPacer(directive.provider, clientSignal);
 635: 
 636:         try {
 637:           const nextResult = await fetchWithTtftGuard(nextFetchOpts);
 638:           if (nextResult.response.status >= 400) {
 639:             if (nextResult.response.status === 401 || nextResult.response.status === 403) {
 640:               try {
 641:                 globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
 642:               } catch (authErr: unknown) {
 643:                 if (!isFatalAuthError(authErr)) throw authErr;
 644:               }
 645:               return null;
 646:             }
 647:             if (globalKeyPool.isQuarantineEnabled(directive.provider)) {
 648:               try {
 649:                 globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
 650:               } catch (authErr: unknown) {
 651:                 if (isFatalAuthError(authErr)) return null;
 652:                 throw authErr;
 653:               }
 654:             }
 655:             continue;
 656:           }
 657:           globalKeyPool.reportSuccess(directive.provider, nextSelected.index);
 658:           return {
 659:             firstChunk: nextResult.firstChunk,
 660:             rawReader: nextResult.rawReader,
 661:             reader: nextResult.rawReader,
 662:           };
 663:         } catch (fetchErr: unknown) {
 664:           void fetchErr;
 665:           if (globalKeyPool.isQuarantineEnabled(directive.provider)) {
 666:             globalKeyPool.reportFailure(directive.provider, nextSelected.index, 500);
 667:           }
 668:           continue;
 669:         }
 670:       }
 671:       return null;
 672:     },
 673:   });
 674: 
 675:   if (isResponses) {
 676:     resilientStream = resilientStream.pipeThrough(createResponsesStreamTransformer(activePayload.model));
 677:   } else if (isLing) {
 678:     resilientStream = resilientStream.pipeThrough(createLingStreamTransformer());
 679:   } else if (isXmlTranslationActive) {
 680:     resilientStream = resilientStream.pipeThrough(createDotsStreamTransformer());
 681:   }
 682: 
 683:   return new Response(resilientStream, {
 684:     status: response.status,
 685:     headers: {
 686:       "Content-Type": "text/event-stream",
 687:       "Cache-Control": "no-cache",
 688:       Connection: "keep-alive",
 689:     },
 690:   });
 691: }
 692: 
 693: export function wrapStreamWithPacerLease(
 694:   body: ReadableStream<Uint8Array>,
 695:   lease: PacerAcquireResult
 696: ): ReadableStream<Uint8Array> {
 697:   let released = false;
 698:   const releaseOnce = () => {
 699:     if (!released) {
 700:       released = true;
 701:       lease.release();
 702:     }
 703:   };
 704: 
 705:   const reader = body.getReader();
 706:   return new ReadableStream<Uint8Array>({
 707:     async pull(controller) {
 708:       try {
 709:         const { value, done } = await reader.read();
 710:         if (done) {
 711:           releaseOnce();
 712:           controller.close();
 713:           return;
 714:         }
 715:         controller.enqueue(value);
 716:       } catch (err: unknown) {
 717:         releaseOnce();
 718:         controller.error(err);
 719:       }
 720:     },
 721:     cancel(reason) {
 722:       releaseOnce();
 723:       return reader.cancel(reason);
 724:     },
 725:   });
 726: }
 727: 
 728: function finalizeAttemptResponse(
 729:   response: Response,
 730:   pacerLease: PacerAcquireResult | undefined
 731: ): Response {
 732:   if (!pacerLease) {
 733:     return response;
 734:   }
 735:   const isStreaming =
 736:     response.headers.get("content-type")?.includes("text/event-stream") &&
 737:     response.body !== null;
 738:   if (isStreaming && response.body) {
 739:     return new Response(wrapStreamWithPacerLease(response.body, pacerLease), {
 740:       status: response.status,
 741:       statusText: response.statusText,
 742:       headers: response.headers,
 743:     });
 744:   }
 745:   pacerLease.release();
 746:   return response;
 747: }
 748: 
 749: export async function acquireProviderPacer(
 750:   provider: string,
 751:   clientSignal?: AbortSignal
 752: ): Promise<PacerAcquireResult | undefined> {
 753:   const env = getEnv();
 754:   if (!env.LITEROUTER_PACER_ENABLED) return undefined;
 755:   const provConfig = isRegisteredProvider(provider) ? getProviderConfig(provider) : undefined;
 756:   if (provConfig?.pacer?.enabled === false) return undefined;
 757:   const pacer = getPacerForProvider(provider);
 758:   return await pacer.acquire(clientSignal);
 759: }
 760: 
 761: export async function waitAndSelectKey(
 762:   provider: string,
 763:   startTime: number,
 764:   maxWaitMs: number,
 765:   clientSignal?: AbortSignal
 766: ): Promise<SelectedKey | null> {
 767:   const remainingWait = Math.max(0, maxWaitMs - (Date.now() - startTime));
 768:   return globalKeyPool.waitForKeyAvailable(provider, remainingWait, clientSignal);
 769: }
 770: 
 771: interface AttemptExecutionResult {
 772:   readonly success: boolean;
 773:   readonly response?: Response;
 774:   readonly error?: unknown;
 775:   readonly retryable: boolean;
 776: }
 777: 
 778: async function tryDirectAttempt(
 779:   directive: DirectDirective,
 780:   transformed: OpenAIRequestPayload,
 781:   clientSignal: AbortSignal | undefined,
 782:   selected: SelectedKey,
 783:   reqId: string,
 784:   attempt: number,
 785:   maxAttempts: number,
 786:   clientOptions?: RequestClientOptions,
 787:   startTime?: number
 788: ): Promise<AttemptExecutionResult> {
 789:   try {
 790:     const res = await executeDirectCall(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts, clientOptions);
 791:     return { success: true, response: res, retryable: false };
 792:   } catch (err: unknown) {
 793:     if (clientSignal?.aborted) {
 794:       return { success: false, error: err, retryable: false };
 795:     }
 796:     if (err instanceof Error && err.message.includes("aborted")) {
 797:       return { success: false, error: err, retryable: false };
 798:     }
 799:     if (isFatalAuthError(err)) {
 800:       return {
 801:         success: true,
 802:         response: Response.json(
 803:           {
 804:             error: {
 805:               message: err.message,
 806:               type: "authentication_error",
 807:               code: err.status,
 808:             },
 809:           },
 810:           {
 811:             status: err.status,
 812:             headers: { "Content-Type": "application/json" },
 813:           }
 814:         ),
 815:         retryable: false,
 816:       };
 817:     }
 818:     if (err instanceof PacerQueueOverflowError) {
 819:       return {
 820:         success: true,
 821:         response: Response.json(
 822:           {
 823:             error: {
 824:               message: err.message,
 825:               type: "rate_limit_exceeded",
 826:               code: "rate_limit_exceeded",
 827:             },
 828:           },
 829:           {
 830:             status: 429,
 831:             headers: {
 832:               "Retry-After": String(err.retryAfterSec),
 833:               "Content-Type": "application/json",
 834:             },
 835:           }
 836:         ),
 837:         retryable: false,
 838:       };
 839:     }
 840:     if (err instanceof UpstreamRetryableError) {
 841:       return { success: false, error: err, retryable: true };
 842:     }
 843:     if (err instanceof NoResponseError) {
 844:       const provConfig = isRegisteredProvider(directive.provider)
 845:         ? getProviderConfig(directive.provider)
 846:         : undefined;
 847:       const isSingleFlight = !(provConfig?.request_retry?.enabled ?? true);
 848:       if (globalKeyPool.isQuarantineEnabled(directive.provider)) {
 849:         globalKeyPool.reportFailure(directive.provider, selected.index, 0, undefined, err.message, Date.now(), 2);
 850:       }
 851:       if (isSingleFlight) {
 852:         logWarn(EMOJI.zap, `[${directive.provider.toUpperCase()} ${reqId}] Single-flight mode: Upstream transport error: ${err.message}`);
 853:         logServed(reqId, Date.now() - (startTime ?? Date.now()), 502, attempt, maxAttempts);
 854:         logSeparator();
 855:         return {
 856:           success: true,
 857:           response: Response.json(
 858:             {
 859:               error: {
 860:                 message: `${directive.provider.toUpperCase()} upstream connection failed: ${err.message}`,
 861:                 type: "upstream_connection_error",
 862:                 code: 502,
 863:               },
 864:             },
 865:             {
 866:               status: 502,
 867:               headers: { "Content-Type": "application/json" },
 868:             }
 869:           ),
 870:           retryable: false,
 871:         };
 872:       }
 873:       return { success: false, error: err, retryable: true };
 874:     }
 875:     logError(reqId, "Direct request error", err);
 876:     return { success: false, error: err, retryable: false };
 877:   }
 878: }
 879: 
 880: async function executeSingleAttemptLoop(
 881:   directive: DirectDirective,
 882:   transformed: OpenAIRequestPayload,
 883:   clientSignal: AbortSignal | undefined,
 884:   reqId: string,
 885:   clientOptions?: RequestClientOptions
 886: ): Promise<Response> {
 887:   const env = getEnv();
 888:   const poolSize = globalKeyPool.getPoolSize(directive.provider);
 889:   const provConfig = isRegisteredProvider(directive.provider)
 890:     ? getProviderConfig(directive.provider)
 891:     : undefined;
 892:   const maxAttempts = provConfig?.request_retry?.enabled
 893:     ? Math.min(provConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
 894:     : 1;
 895:   let lastError: unknown = null;
 896:   let prevKeyIndex = -1;
 897:   const startTime = Date.now();
 898:   const maxWaitMs = provConfig?.pacer?.max_queue_wait_ms ?? env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS;
 899: 
 900:   for (let attempt = 0; attempt < maxAttempts; attempt++) {
 901:     const dwellMs = Date.now() - startTime;
 902:     if (globalKeyPool.isQuarantineEnabled(directive.provider) && globalKeyPool.shouldLoadShed(directive.provider, dwellMs, maxWaitMs)) {
 903:       const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
 904:       const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
 905:       return Response.json(
 906:         { error: { message: `Provider '${directive.provider}' unavailable: all keys in cooldown exceed wait budget.`, type: "service_unavailable" } },
 907:         {
 908:           status: 503,
 909:           headers: {
 910:             "Retry-After": String(retryAfterSec),
 911:           },
 912:         }
 913:       );
 914:     }
 915: 
 916:     const shouldPaceIngress = provConfig?.pacer?.enabled ?? false;
 917:     let pacerLease: PacerAcquireResult | undefined;
 918:     if (shouldPaceIngress) {
 919:       try {
 920:         pacerLease = await acquireProviderPacer(directive.provider, clientSignal);
 921:       } catch (err: unknown) {
 922:         if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
 923:           return Response.json(
 924:             { error: { message: "Request aborted by client", type: "client_closed_request" } },
 925:             { status: 499 }
 926:           );
 927:         }
 928:         if (err instanceof PacerQueueOverflowError) {
 929:           return Response.json(
 930:             {
 931:               error: {
 932:                 message: err.message,
 933:                 type: "rate_limit_exceeded",
 934:                 code: "rate_limit_exceeded",
 935:               },
 936:             },
 937:             {
 938:               status: 429,
 939:               headers: {
 940:                 "Retry-After": String(err.retryAfterSec),
 941:                 "Content-Type": "application/json",
 942:               },
 943:             }
 944:           );
 945:         }
 946:         throw err;
 947:       }
 948:     }
 949: 
 950:     const selected = await waitAndSelectKey(directive.provider, startTime, maxWaitMs, clientSignal);
 951:     if (!selected) {
 952:       pacerLease?.release();
 953:       if (clientSignal?.aborted) {
 954:         return Response.json(
 955:           { error: { message: "Request aborted by client", type: "client_closed_request" } },
 956:           { status: 499 }
 957:         );
 958:       }
 959:       const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
 960:       logExhausted(reqId, directive.provider, minTtl);
 961:       return Response.json(
 962:         { error: { message: `All API keys for provider '${directive.provider}' are cooling down.`, type: "insufficient_quota" } },
 963:         { status: 429 }
 964:       );
 965:     }
 966: 
 967:     if (attempt > 0) {
 968:       logRotate(reqId, directive.provider, prevKeyIndex, selected.index, selected.totalKeys, attempt + 1, maxAttempts);
 969:     }
 970:     prevKeyIndex = selected.index;
 971: 
 972:     const outcome = await tryDirectAttempt(directive, transformed, clientSignal, selected, reqId, attempt + 1, maxAttempts, clientOptions, startTime);
 973:     if (outcome.response && (!outcome.retryable || outcome.response.status === 200)) {
 974:       return finalizeAttemptResponse(outcome.response, pacerLease);
 975:     }
 976: 
 977:     pacerLease?.release();
 978:     lastError = outcome.error;
 979:     if (clientSignal?.aborted || (lastError instanceof Error && lastError.message.includes("aborted"))) {
 980:       return Response.json(
 981:         { error: { message: "Request aborted by client", type: "client_closed_request" } },
 982:         { status: 499 }
 983:       );
 984:     }
 985:     if (!outcome.retryable) {
 986:       if (outcome.response) {
 987:         return outcome.response;
 988:       }
 989:       if (isFatalAuthError(lastError)) {
 990:         return Response.json(
 991:           {
 992:             error: {
 993:               message: lastError.message,
 994:               type: "authentication_error",
 995:               code: lastError.status,
 996:             },
 997:           },
 998:           {
 999:             status: lastError.status,
1000:             headers: { "Content-Type": "application/json" },
1001:           }
1002:         );
1003:       }
1004:       throw lastError;
1005:     }
1006: 
1007:     if (attempt + 1 < maxAttempts && provConfig?.request_retry?.delay) {
1008:       const { min_ms, max_ms } = provConfig.request_retry.delay;
1009:       const delayMs = min_ms < max_ms
1010:         ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
1011:         : min_ms;
1012:       if (delayMs > 0) {
1013:         await Bun.sleep(delayMs);
1014:       }
1015:     }
1016:   }
1017:   logError(reqId, "Direct request attempts exhausted", lastError);
1018:   const errMsg = lastError instanceof Error ? lastError.message : "All direct request attempts failed";
1019:   const statusCode = lastError instanceof UpstreamRetryableError ? lastError.status : 502;
1020:   return Response.json(
1021:     { error: { message: `Direct request attempts exhausted - ${errMsg}`, type: "gateway_error" } },
1022:     { status: statusCode }
1023:   );
1024: }
1025: 
1026: export async function executeDirectRequest(
1027:   directive: DirectDirective,
1028:   body: OpenAIRequestPayload,
1029:   clientSignal: AbortSignal | undefined,
1030:   reqId: string,
1031:   clientOptions?: RequestClientOptions
1032: ): Promise<Response> {
1033:   let targetBody = body;
1034:   if ((directive.provider === "or" || (directive.provider as string) === "openrouter") && body.model.startsWith("openrouter/")) {
1035:     targetBody = {
1036:       ...body,
1037:       model: body.model.slice("openrouter/".length),
1038:     };
1039:   }
1040:   const env = getEnv();
1041:   const transformed = sanitizeAndTransformPayload(targetBody, {
1042:     nuances: directive.nuances,
1043:     targetWire: directive.payload,
1044:     enableScrubbing: env.LITEROUTER_ENABLE_SCRUBBING,
1045:     globalStripReasoning: env.LITEROUTER_STRIP_REASONING,
1046:     aoStripReasoning: env.LITEROUTER_AO_STRIP_REASONING,
1047:   });
1048:   return executeSingleAttemptLoop(directive, transformed, clientSignal, reqId, clientOptions);
1049: }
1050: 
1051: function loadFusionConfig(): FusionConfig {
1052:   const p = resolve(process.cwd(), "config", "fusion.json");
1053:   if (!existsSync(p)) {
1054:     return { version: "3.1", presets: {} };
1055:   }
1056:   try {
1057:     return JSON.parse(readFileSync(p, "utf-8")) as FusionConfig;
1058:   } catch {
1059:     return { version: "3.1", presets: {} };
1060:   }
1061: }
1062: 
1063: async function tryExecuteTier(
1064:   tier: FusionTier,
1065:   body: OpenAIRequestPayload,
1066:   clientSignal: AbortSignal | undefined,
1067:   reqId: string,
1068:   clientOptions?: RequestClientOptions
1069: ): Promise<Response | null> {
1070:   const tierDirective = parseDirective(tier.apikey);
1071:   if (!tierDirective || tierDirective.type !== "direct") {
1072:     return null;
1073:   }
1074:   const tierBody: OpenAIRequestPayload = { ...body, model: tier.model };
1075:   try {
1076:     const res = await executeDirectRequest(tierDirective, tierBody, clientSignal, reqId, clientOptions);
1077:     return res.status < 400 ? res : null;
1078:   } catch {
1079:     return null;
1080:   }
1081: }
1082: 
1083: export async function executeFusionFlow(
1084:   presetName: string,
1085:   body: OpenAIRequestPayload,
1086:   clientSignal: AbortSignal | undefined,
1087:   reqId: string,
1088:   clientOptions?: RequestClientOptions
1089: ): Promise<Response> {
1090:   const fusionCfg = loadFusionConfig();
1091:   const engine = new FusionEngine(fusionCfg);
1092:   const plan = engine.createExecutionPlan(presetName, body.model);
1093: 
1094:   if (!plan || plan.orderedTiers.length === 0) {
1095:     return Response.json(
1096:       { error: { message: `No fusion configuration found for model '${body.model}' in preset '${presetName}'.`, type: "invalid_request_error" } },
1097:       { status: 404 }
1098:     );
1099:   }
1100: 
1101:   for (const tier of plan.orderedTiers) {
1102:     const res = await tryExecuteTier(tier, body, clientSignal, reqId, clientOptions);
1103:     if (res !== null) {
1104:       engine.handleTierSuccess(presetName, body.model, tier);
1105:       return res;
1106:     }
1107:     engine.handleTierFailure(presetName, body.model, tier);
1108:   }
1109: 
1110:   return Response.json(
1111:     { error: { message: `All fallback tiers exhausted for model '${body.model}'.`, type: "service_unavailable" } },
1112:     { status: 503 }
1113:   );
1114: }
1115: 
1116: export interface HandleOptions {
1117:   readonly customPath?: string;
1118:   readonly skipInboundLog?: boolean;
1119: }
1120: 
1121: export async function handleOpenAICompat(
1122:   req: Request,
1123:   rawKey: string,
1124:   reqId: string,
1125:   options?: HandleOptions
1126: ): Promise<Response> {
1127:   const validation = validateDirective(rawKey);
1128:   if (validation.valid === false) {
1129:     return createUnauthorizedResponse(validation.error);
1130:   }
1131: 
1132:   const directive = validation.directive;
1133: 
1134:   let body: OpenAIRequestPayload;
1135:   try {
1136:     body = (await req.json()) as OpenAIRequestPayload;
1137:   } catch (err: unknown) {
1138:     logError(reqId, "Failed to parse JSON body", err);
1139:     return Response.json({ error: { message: "Malformed JSON body", type: "invalid_request_error" } }, { status: 400 });
1140:   }
1141: 
1142:   if (!options?.skipInboundLog) {
1143:     const path = options?.customPath || new URL(req.url).pathname;
1144:     const clientAgent = req.headers.get("user-agent") || "unknown";
1145:     const endpoint = directive.type === "direct"
1146:       ? resolveUpstreamEndpoint(directive.provider, directive.completion, body.model)
1147:       : undefined;
1148:     const providerConfig = directive.type === "direct"
1149:       ? getProviderEndpointConfig(directive.provider)
1150:       : undefined;
1151:     const _conserveRules = providerConfig?.conserve_rules;
1152:     const poolSize = directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1;
1153:     const refHeaders = endpoint?.headers;
1154:     const refUa = refHeaders?.["User-Agent"];
1155:     const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
1156:     const referrer = refUa && refUrl ? `${refUa} @ ${refUrl}` : (refUa ?? refUrl ?? undefined);
1157: 
1158:     logInbound({
1159:       reqId,
1160:       method: req.method,
1161:       path,
1162:       clientAgent,
1163:       protocol: req.headers.get("x-http-version") || "HTTP/1.1",
1164:       directiveStr: rawKey,
1165:       targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
1166:       wireFormat: directive.type === "direct" ? directive.payload : "oa",
1167:       endpoint: endpoint?.rawPath,
1168:       model: body.model,
1169:       totalKeys: poolSize,
1170:       nuances: directive.type === "direct" ? directive.nuances : undefined,
1171:       referrer,
1172:     });
1173:   }
1174: 
1175:   let effectiveBody = body;
1176:   const initialTokens = estimateOpenAITokens(body);
1177:   if (initialTokens > DEFAULT_MAX_CONTEXT_TOKENS) {
1178:     effectiveBody = pruneOpenAIPayload(body, DEFAULT_SAFE_CONTEXT_TOKENS);
1179:     logWarn(EMOJI.prune, `[PRUNE ${reqId}] Proactively pruned OpenAI messages: ${initialTokens} -> ${estimateOpenAITokens(effectiveBody)} tokens.`);
1180:   }
1181: 
1182:   const clientOptions: RequestClientOptions = {
1183:     userAgent: req.headers.get("user-agent") || undefined,
1184:     headers: req.headers,
1185:   };
1186: 
1187:   if (directive.type === "fusion") {
1188:     return executeFusionFlow(directive.preset, effectiveBody, req.signal, reqId, clientOptions);
1189:   }
1190: 
1191:   return executeDirectRequest(directive, effectiveBody, req.signal, reqId, clientOptions);
1192: }
1193: 
1194: export {
1195:   OpenAIChatTransformer,
1196:   openAiChatTransformer,
1197: } from "../transformers/openai_chat";
```

## File: config/providers.json
```json
  1: {
  2:   "providers": {
  3:     "openrouter": {
  4:       "code": "or",
  5:       "name": "OpenRouter",
  6:       "env_key": "OPENROUTER_API_KEYS",
  7:       "strategy": "standard",
  8:       "base_url": "https://openrouter.ai",
  9:       "auth_header": "Bearer",
 10:       "headers": {
 11:         "HTTP-Referer": "https://opencode.ai",
 12:         "X-Title": "OpenCode",
 13:         "User-Agent": "OpenCode/1.18.29"
 14:       },
 15:       "endpoints": {
 16:         "ch": "/api/v1/chat/completions",
 17:         "ms": "/api/v1/messages",
 18:         "em": "/api/v1/embeddings",
 19:         "md": "/api/v1/models",
 20:         "rs": "/api/v1/responses"
 21:       },
 22:       "conserve_rules": [
 23:         {
 24:           "status": 429,
 25:           "contains": "free-models-per-day",
 26:           "ttl": "midnight_utc",
 27:           "reason": "openrouter_daily_free_quota_exhausted"
 28:         }
 29:       ],
 30:       "request_retry": {
 31:         "enabled": true,
 32:         "max_attempts": 3,
 33:         "delay": {
 34:           "min_ms": 150,
 35:           "max_ms": 500
 36:         }
 37:       },
 38:       "pacer": {
 39:         "enabled": true,
 40:         "min_delay_ms": 200,
 41:         "max_delay_ms": 500,
 42:         "max_queue_depth": 500,
 43:         "max_queue_wait_ms": 15000
 44:       }
 45:     },
 46:     "nvidia": {
 47:       "code": "nv",
 48:       "name": "NVIDIA NIM",
 49:       "env_key": "NVIDIA_API_KEYS",
 50:       "strategy": "standard",
 51:       "base_url": "https://integrate.api.nvidia.com",
 52:       "auth_header": "Bearer",
 53:       "endpoints": {
 54:         "ch": "/v1/chat/completions",
 55:         "em": "/v1/embeddings",
 56:         "md": "/v1/models"
 57:       },
 58:       "request_retry": {
 59:         "enabled": true,
 60:         "max_attempts": 3,
 61:         "delay": {
 62:           "min_ms": 150,
 63:           "max_ms": 300
 64:         }
 65:       },
 66:       "pacer": {
 67:         "enabled": true,
 68:         "min_delay_ms": 200,
 69:         "max_delay_ms": 500,
 70:         "max_queue_depth": 500,
 71:         "max_queue_wait_ms": 15000
 72:       }
 73:     },
 74:     "google": {
 75:       "code": "gg",
 76:       "name": "Google AI Studio",
 77:       "env_key": "GOOGLE_API_KEYS",
 78:       "strategy": "native_cascade",
 79:       "base_url": "https://generativelanguage.googleapis.com",
 80:       "auth_header": "Bearer",
 81:       "endpoints": {
 82:         "ob": "/v1beta/openai/chat/completions",
 83:         "gc": "/v1beta/models/{model}:generateContent",
 84:         "g1": "/v1/models/{model}:generateContent",
 85:         "em": "/v1beta/models/{model}:embedContent",
 86:         "md": "/v1beta/models"
 87:       },
 88:       "request_retry": {
 89:         "enabled": true,
 90:         "max_attempts": 3,
 91:         "delay": {
 92:           "min_ms": 200,
 93:           "max_ms": 500
 94:         }
 95:       },
 96:       "pacer": {
 97:         "enabled": true,
 98:         "min_delay_ms": 200,
 99:         "max_delay_ms": 500,
100:         "max_queue_depth": 500,
101:         "max_queue_wait_ms": 15000
102:       }
103:     },
104:     "zen": {
105:       "code": "zn",
106:       "name": "Zen",
107:       "env_key": "ZEN_API_KEYS",
108:       "strategy": "zen",
109:       "base_url": "https://opencode.ai/zen",
110:       "auth_header": "Bearer",
111:       "headers": {
112:         "HTTP-Referer": "https://opencode.ai",
113:         "Referer": "https://opencode.ai",
114:         "X-Title": "OpenCode",
115:         "User-Agent": "opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2"
116:       },
117:       "endpoints": {
118:         "ch": "/v1/chat/completions",
119:         "ms": "/v1/messages",
120:         "md": "/v1/models",
121:         "rs": "/v1/responses"
122:       },
123:       "request_retry": {
124:         "enabled": true,
125:         "max_attempts": 5,
126:         "delay": {
127:           "min_ms": 200,
128:           "max_ms": 2000
129:         }
130:       },
131:       "pacer": {
132:         "enabled": true,
133:         "min_delay_ms": 200,
134:         "max_delay_ms": 2000,
135:         "max_queue_depth": 500,
136:         "max_queue_wait_ms": 15000,
137:         "max_concurrency": 0
138:       }
139:     },
140:     "gcp": {
141:       "code": "gc",
142:       "name": "Google Cloud (GCP)",
143:       "env_key": "GCP_KEYS",
144:       "strategy": "gcp_guarded",
145:       "base_url": "https://generativelanguage.googleapis.com",
146:       "auth_header": "Bearer",
147:       "endpoints": {
148:         "ch": "/v1beta/openai/chat/completions",
149:         "ob": "/v1beta/openai/chat/completions",
150:         "gc": "/v1beta/models/{model}:generateContent",
151:         "em": "/v1beta/models/{model}:embedContent",
152:         "md": "/v1beta/models"
153:       },
154:       "request_retry": {
155:         "enabled": true,
156:         "max_attempts": 3,
157:         "delay": {
158:           "min_ms": 200,
159:           "max_ms": 500
160:         }
161:       },
162:       "pacer": {
163:         "enabled": true,
164:         "min_delay_ms": 2000,
165:         "max_delay_ms": 3000,
166:         "max_queue_depth": 500,
167:         "max_queue_wait_ms": 240000
168:       }
169:     }
170:   }
171: }
```
