## Twitter/X Thread

**Tweet 1 (Hook):**
You're paying full price for every AI API call? Here's what nobody tells you… 🤫

Every 429 stalls your agent for 65 seconds. Keys go idle while others burn out. Your reasoning tokens get charged again and again.

There's a better way. ↓

**Tweet 2:**
429 Hell: One API key gets rate-limited and your ENTIRE workflow freezes for 65 seconds. No coding agent, no IDE, no output.

Most proxies sleep the full backoff. That's 65 seconds of dead time — per call.
💀

**Tweet 3:**
Key Waste: With 3–10 keys across orgs, some burn through quota while others sit collecting dust.

Python proxies do round-robin but without atomic Lua ZSET — concurrent requests cause thundering-herd key exhaustion. Your $500+ keys are leaking money. 🔥

**Tweet 4:**
Reasoning Token Bleed: Models like DeepSeek-R1 and Gemini 2.5 Pro emit `<thinking>` blocks — sometimes 50,000+ tokens.

These get injected into EVERY subsequent turn. You literally pay for the same reasoning tokens over and over. Nobody warned you. 😱

**Tweet 5:**
LiteRouter fixes all 3.

A single Bun/TypeScript process — sub-ms overhead. No Python. No sidecars.

Just atomic Redis/Valkey Lua key rotation that picks healthy keys in a single ZSET script. 429 recovery: 2 seconds, not 65. ⚡

**Tweet 6:**
Atomic Rolling-Window Key Rotation: Every request is timestamped into a 60s Redis ZSET. Key selection + quota check + cooldown — all in ONE Lua script. Zero race conditions.

When a key 429s, the next key is live in 2,000ms. Client never stalls. 🛡️

**Tweet 7:**
Google Thought Signature Preservation: Gemini 2.5 Pro emits `thought_signature` tokens on tool calls. Google's OWN SDK doesn't reinject them across turns → "Invalid tool call signature" errors on the 2nd+ call.

LiteRouter captures & reinjects them transparently. 🧠

**Tweet 8:**
Reasoning Stripping: Up to 70% token cost savings.

LiteRouter strips `<thinking>`, thought, reasoning_content from HISTORICAL turns while preserving the current response's reasoning. LiteLLM passes it through. OpenRouter charges full price.

Same quality, half the cost. 💰

**Tweet 9:**
70% cost savings isn't theoretical. Multi-turn agent logs balloon with repeated reasoning blocks.

LiteRouter's `shouldStripReasoning()` + `stripReasoningParameters()` in `src/transformers/thinking.ts` removes past reasoning, keeps current. Measurable via /health. 📉

**Tweet 10:**
Fusion Fallback Chains: Set `model: "fusion/my-chain"`. If primary 429s/5xx, auto-route to next model in the chain. Once it falls back, STICKS for 5 minutes (no flapping). 65s circuit breaker per model. 5-model failover.

Response header `X-Literouter-Model` tells you which won. 🎯

**Tweet 11:**
Quick start (30s):

`git clone https://github.com/Acivar-Digital/literouter.git && cd literouter && bun install && cp .env.example .env && ./scripts/start.sh`

Drop-in for OpenCode. Port 7766. MIT. Bun + Redis. ⚡

**Tweet 12:**
⭐ Star https://github.com/Acivar-Digital/literouter

Try it. Rip out your fragile key rotation. Replace 65s 429 stalls with 2s recovery. Save 70% on tokens. Fix Gemini signature errors.

Your coding agents will thank you. RT if this saved you money! 🚀
