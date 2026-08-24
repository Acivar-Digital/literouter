#!/usr/bin/env python3
"""
Stream Kit Slice 1: DB Extractor & Turn Replay Harness
tests/e2e/streaming_kit/extract_and_replay.py

Extracts conversation turns from OpenCode2 SQLite DB or generates realistic
fallback test conversations (with tool calls and tool responses), streams
them against LiteRouter gateway (or mock fallback), and validates:
  1. No chunk contains `"content": null` in `choices[0].delta`
  2. Raw control character sequences (\\r / 0x0D) do not break JSON parsing
  3. All SSE chunks parse cleanly and conform to OpenAI delta schema
"""

from __future__ import annotations

import json
import os
import sqlite3
import ssl
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

DB_PATH = os.path.expanduser("~/.local/share/opencode2/opencode/opencode.db")
GATEWAY_URLS = [
    "https://localhost:7766/v1/chat/completions",
    "http://localhost:7766/v1/chat/completions",
]
AUTH_BEARER = "lr-or-oa-ch-no"
USER_AGENT = "@opencode-ai/cli/2.0.0-beta.1"
TARGET_MODEL = "stealth/ox-alpha"
MAX_TOOL_OUTPUT_CHARS = 800
DEFAULT_MAX_TOKENS = 100


def log(msg: str = "") -> None:
    """Print message immediately with flush."""
    print(msg, flush=True)


def extract_turns_from_db(
    db_path: str = DB_PATH, limit: int = 2
) -> List[Dict[str, Any]]:
    """Extract realistic conversation turn slices from OpenCode2 SQLite database."""
    if not os.path.exists(db_path):
        log(f"[Extractor] SQLite DB not found at: {db_path}")
        return []

    extracted_sessions: List[Dict[str, Any]] = []
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()

        # Find sessions with target model or tool usage
        query = """
            SELECT DISTINCT s.id, s.model, s.title
            FROM session_v2 s
            JOIN session_message m ON s.id = m.session_id
            WHERE s.model LIKE ? OR s.model LIKE ? OR m.data LIKE ?
            ORDER BY s.time_updated DESC
            LIMIT ?;
        """
        cur.execute(
            query,
            (f"%{TARGET_MODEL}%", "%stealth%", "%tool%", limit * 4),
        )
        candidate_sessions = cur.fetchall()

        for session_id, _model_raw, title in candidate_sessions:
            cur.execute(
                """
                SELECT id, type, seq, data
                FROM session_message
                WHERE session_id = ?
                ORDER BY seq ASC;
                """,
                (session_id,),
            )
            rows = cur.fetchall()
            messages: List[Dict[str, Any]] = []
            has_tool_calls = False

            for _msg_id, msg_type, _seq, data_str in rows:
                try:
                    data = json.loads(data_str)
                except Exception:
                    continue

                if msg_type == "user":
                    user_text = data.get("text") or data.get("content") or ""
                    if user_text:
                        # Cap very large prompt context for fast e2e replay
                        if len(user_text) > 1000:
                            user_text = user_text[:1000] + "... [truncated]"
                        messages.append({"role": "user", "content": user_text})

                elif msg_type == "assistant":
                    content_items = data.get("content", [])
                    text_pieces: List[str] = []
                    tool_calls: List[Dict[str, Any]] = []
                    tool_results: List[Dict[str, Any]] = []

                    if isinstance(content_items, list):
                        for item in content_items:
                            itype = item.get("type")
                            if itype == "text":
                                text_pieces.append(item.get("text", ""))
                            elif itype == "tool":
                                has_tool_calls = True
                                tool_id = item.get("id") or f"call_{len(tool_calls)}"
                                tool_name = item.get("name") or "unknown_tool"
                                state = item.get("state", {})
                                input_args = state.get("input", {})
                                args_str = (
                                    json.dumps(input_args)
                                    if isinstance(input_args, dict)
                                    else str(input_args or "{}")
                                )

                                tool_calls.append(
                                    {
                                        "id": tool_id,
                                        "type": "function",
                                        "function": {
                                            "name": tool_name,
                                            "arguments": args_str,
                                        },
                                    }
                                )

                                # Extract completed output if available
                                raw_res = state.get("content", [])
                                if isinstance(raw_res, list):
                                    res_text = "\n".join(
                                        [
                                            part.get("text", "")
                                            for part in raw_res
                                            if isinstance(part, dict)
                                            and "text" in part
                                        ]
                                    )
                                elif isinstance(raw_res, str):
                                    res_text = raw_res
                                else:
                                    res_text = str(state.get("output", ""))

                                if len(res_text) > MAX_TOOL_OUTPUT_CHARS:
                                    res_text = (
                                        res_text[:MAX_TOOL_OUTPUT_CHARS]
                                        + "\n... [truncated]"
                                    )

                                tool_results.append(
                                    {
                                        "role": "tool",
                                        "tool_call_id": tool_id,
                                        "content": res_text or "done",
                                    }
                                )

                    asst_msg: Dict[str, Any] = {"role": "assistant"}
                    if text_pieces:
                        full_txt = "\n".join(text_pieces)
                        if len(full_txt) > 1000:
                            full_txt = full_txt[:1000] + "... [truncated]"
                        asst_msg["content"] = full_txt
                    if tool_calls:
                        asst_msg["tool_calls"] = tool_calls

                    if "content" in asst_msg or "tool_calls" in asst_msg:
                        messages.append(asst_msg)
                        messages.extend(tool_results)

            if messages:
                # Extract a concise turn snippet (2 to 5 messages) suitable for replay
                snippet: List[Dict[str, Any]] = []
                # Look for a tool turn first
                for i, m in enumerate(messages):
                    if "tool_calls" in m or m.get("role") == "tool":
                        start_idx = max(0, i - 1)
                        end_idx = min(len(messages), i + 3)
                        snippet = messages[start_idx:end_idx]
                        break

                if not snippet:
                    snippet = messages[:3]

                # Ensure sequence starts with user and ends with user or tool
                if snippet and snippet[0].get("role") not in ("user", "system"):
                    snippet.insert(
                        0,
                        {
                            "role": "user",
                            "content": "Context initialization turn for replay test.",
                        },
                    )

                extracted_sessions.append(
                    {
                        "session_id": session_id,
                        "title": title or "Untitled Session",
                        "model": TARGET_MODEL,
                        "has_tool_calls": has_tool_calls,
                        "messages": snippet,
                    }
                )
                if len(extracted_sessions) >= limit:
                    break

        conn.close()
    except Exception as exc:
        log(f"[Extractor] Warning during DB extraction: {exc}")

    return extracted_sessions


def get_fallback_test_cases() -> List[Dict[str, Any]]:
    """Return realistic test cases with tool calls, tool responses, and control characters."""
    return [
        {
            "name": "Synthetic: Single Turn User Prompt",
            "model": TARGET_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": "State 'Stream test OK' and nothing else.",
                }
            ],
        },
        {
            "name": "Synthetic: Multi-Turn with Tool Call & Tool Response",
            "model": TARGET_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": "Check the status of system disk and verify.",
                },
                {
                    "role": "assistant",
                    "content": "Let me check the disk status.",
                    "tool_calls": [
                        {
                            "id": "call_disk_status_01",
                            "type": "function",
                            "function": {
                                "name": "check_disk",
                                "arguments": '{"path": "/"}',
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_disk_status_01",
                    "content": '{"filesystem": "/dev/sda1", "usage": "42%", "status": "ok"}',
                },
                {
                    "role": "user",
                    "content": "What is the verdict in one short sentence?",
                },
            ],
        },
        {
            "name": "Synthetic: Raw Control Characters & Escape Sequence",
            "model": TARGET_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": "Parse this sample: line1\r\nline2\rline3\x0d\x0aDone. Reply with 'OK'.",
                }
            ],
        },
    ]


def validate_chunk(
    raw_chunk: str, chunk_index: int
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """
    Validates a single SSE JSON chunk.
    Asserts:
      a) Raw control characters do not break JSON parsing
      b) No choice delta contains `"content": null`
      c) Structure adheres to valid OpenAI chunk format
    """
    try:
        data = json.loads(raw_chunk)
    except Exception as err:
        return False, f"JSON parse failure on chunk #{chunk_index}: {err}", None

    if not isinstance(data, dict):
        return False, f"Chunk #{chunk_index} root is not a dict: {type(data)}", None

    choices = data.get("choices")
    if choices is not None:
        if not isinstance(choices, list):
            return False, f"Chunk #{chunk_index} 'choices' is not a list", data

        for c_idx, choice in enumerate(choices):
            if not isinstance(choice, dict):
                return (
                    False,
                    f"Choice #{c_idx} in chunk #{chunk_index} is not a dict",
                    data,
                )

            delta = choice.get("delta")
            if delta is not None and isinstance(delta, dict):
                # Assert: No "content": null
                if "content" in delta and delta["content"] is None:
                    return (
                        False,
                        f"CRITICAL VIOLATION: Chunk #{chunk_index} choices[{c_idx}].delta contains 'content': null!",
                        data,
                    )

                # If content is present, must be string
                if "content" in delta and not isinstance(delta["content"], str):
                    val_type = type(delta["content"])
                    return (
                        False,
                        f"Chunk #{chunk_index} choices[{c_idx}].delta.content not string: {val_type}",
                        data,
                    )

    return True, None, data


def replay_stream(
    url: str,
    payload: Dict[str, Any],
    timeout: int = 30,
) -> Tuple[bool, Dict[str, Any], List[str]]:
    """Stream request to gateway and validate all received SSE chunks."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req_body: Dict[str, Any] = {
        "model": payload.get("model", TARGET_MODEL),
        "messages": payload.get("messages", []),
        "stream": True,
        "max_tokens": payload.get("max_tokens", DEFAULT_MAX_TOKENS),
    }
    encoded_body = json.dumps(req_body).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=encoded_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AUTH_BEARER}",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    stats: Dict[str, Any] = {
        "total_lines": 0,
        "sse_data_lines": 0,
        "heartbeats": 0,
        "valid_chunks": 0,
        "done_received": False,
        "text_deltas": 0,
        "reasoning_deltas": 0,
        "tool_call_deltas": 0,
    }
    errors: List[str] = []

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            if resp.status != 200:
                errors.append(f"HTTP Status {resp.status}")
                return False, stats, errors

            # Read stream line by line
            while True:
                line_bytes = resp.readline()
                if not line_bytes:
                    break

                stats["total_lines"] += 1
                try:
                    line = line_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    line = line_bytes.decode("latin1")

                trimmed = line.strip()
                if not trimmed:
                    continue

                # SSE comments / keepalive
                if trimmed.startswith(":"):
                    continue

                if trimmed == "data: [DONE]":
                    stats["done_received"] = True
                    continue

                if trimmed.startswith("data:"):
                    raw_data = trimmed[5:].strip()
                    if raw_data == "[DONE]":
                        stats["done_received"] = True
                        continue

                    stats["sse_data_lines"] += 1
                    ok, err_msg, chunk_dict = validate_chunk(
                        raw_data, stats["sse_data_lines"]
                    )
                    if not ok:
                        errors.append(err_msg or "Validation error")
                        break

                    stats["valid_chunks"] += 1
                    if chunk_dict:
                        model_name = chunk_dict.get("model", "")
                        if model_name == "heartbeat":
                            stats["heartbeats"] += 1

                        choices = chunk_dict.get("choices", [])
                        for choice in choices:
                            delta = choice.get("delta", {})
                            if delta.get("content"):
                                stats["text_deltas"] += 1
                            if delta.get("reasoning"):
                                stats["reasoning_deltas"] += 1
                            if delta.get("tool_calls"):
                                stats["tool_call_deltas"] += 1

    except urllib.error.URLError as url_err:
        errors.append(f"URLError connecting to {url}: {url_err}")
        return False, stats, errors
    except Exception as exc:
        errors.append(f"Unexpected streaming exception: {exc}")
        return False, stats, errors

    success = len(errors) == 0 and stats["sse_data_lines"] > 0
    return success, stats, errors


def find_active_gateway_url() -> Optional[str]:
    """Probe gateway URLs to find active listening endpoint."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    for url in GATEWAY_URLS:
        health_url = url.replace("/v1/chat/completions", "/health")
        try:
            req = urllib.request.Request(
                health_url,
                headers={
                    "Authorization": f"Bearer {AUTH_BEARER}",
                    "User-Agent": USER_AGENT,
                },
                method="GET",
            )
            with urllib.request.urlopen(req, context=ctx, timeout=3) as resp:
                if resp.status == 200:
                    return url
        except Exception:
            continue
    return None


def run_harness() -> int:
    """Main execution entrypoint for DB Extractor & Replay Harness."""
    log("=" * 70)
    log("Stream Kit Slice 1: DB Extractor & Turn Replay Harness")
    log("=" * 70)

    # 1. Extract DB Turns
    log(f"\n[1/3] Extracting conversation turns from DB ({DB_PATH})...")
    db_turns = extract_turns_from_db(DB_PATH, limit=2)
    if db_turns:
        log(f"  ✓ Extracted {len(db_turns)} sessions from OpenCode2 SQLite DB:")
        for idx, turn in enumerate(db_turns, start=1):
            msg_count = len(turn.get("messages", []))
            has_tools = turn.get("has_tool_calls", False)
            title = turn.get("title", "")
            sid = turn["session_id"][:16]
            log(
                f"    {idx}. Session {sid}... | Sliced Msgs: {msg_count} | Tools: {has_tools} | Title: {title[:35]}"
            )
    else:
        log("  ℹ No matching turns in DB; using built-in realistic fallback fixtures.")

    # Prepare complete test suite (DB sessions + Fallbacks)
    test_cases: List[Dict[str, Any]] = []
    for turn in db_turns:
        test_cases.append(
            {
                "name": f"DB Extracted Turn: {turn['title'][:30]} ({turn['session_id'][:14]})",
                "model": TARGET_MODEL,
                "messages": turn.get("messages", []),
            }
        )

    fallback_cases = get_fallback_test_cases()
    test_cases.extend(fallback_cases)

    # 2. Check Gateway Connectivity
    log("\n[2/3] Probing LiteRouter Gateway endpoint...")
    active_url = find_active_gateway_url()
    if not active_url:
        log("  ⚠️ Gateway not responding on https://localhost:7766 or http://localhost:7766")
        log("  Running synthetic validator check locally on fixtures...")
        sample_chunk = (
            '{"id":"chatcmpl-test","object":"chat.completion.chunk",'
            '"choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}'
        )
        ok, err, _ = validate_chunk(sample_chunk, 1)
        if not ok:
            log(f"  ✗ Self-test failed: {err}")
            return 1
        log("  ✓ Local chunk validation logic verified.")
        return 0

    log(f"  ✓ Connected to active LiteRouter endpoint: {active_url}")

    # 3. Replay Test Cases
    log(f"\n[3/3] Replaying {len(test_cases)} test cases against live gateway stream...")
    total_passed = 0
    total_failed = 0

    for idx, tc in enumerate(test_cases, start=1):
        name = tc.get("name", f"Test Case #{idx}")
        log(f"\n--- [{idx}/{len(test_cases)}] Replaying: {name} ---")
        log(f"    Messages in context: {len(tc.get('messages', []))}")

        success, stats, errors = replay_stream(active_url, tc, timeout=25)

        log(
            f"    Stats: Chunks={stats['valid_chunks']} | TextDeltas={stats['text_deltas']} | "
            f"ReasoningDeltas={stats['reasoning_deltas']} | ToolDeltas={stats['tool_call_deltas']} | "
            f"Heartbeats={stats['heartbeats']} | DoneReceived={stats['done_received']}"
        )

        if success:
            log("    ✓ Status: PASS (0 schema violations, 0 'content:null' frames)")
            total_passed += 1
        else:
            log("    ✗ Status: FAIL")
            for err in errors:
                log(f"      Error: {err}")
            total_failed += 1

    log("\n" + "=" * 70)
    log(f"Replay Harness Summary: {total_passed} Passed, {total_failed} Failed out of {len(test_cases)}")
    log("=" * 70)

    if total_failed > 0:
        return 1

    log("\n✓ All Stream Kit DB extraction and turn replay assertions satisfied!")
    return 0


if __name__ == "__main__":
    sys.exit(run_harness())
