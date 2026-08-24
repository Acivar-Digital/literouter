#!/usr/bin/env python3
"""
Reproduction Script: Failing DB Turn Extractor & Live Stream Replay
tests/e2e/streaming_kit/reproduce_failing_db_turn.py

Extracts the exact sequence of messages leading up to a specific turn
(default: msg_0328eded4001jk816m46dSoid2 in session ses_fcd71dd78ffeuRd5wpUekhfwIp)
from the OpenCode2 SQLite database, builds the exact OpenAI-compatible request payload,
streams it through LiteRouter on https://localhost:7766/v1/chat/completions, and
validates / logs the stream lifecycle, chunk metrics, and any errors.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Tuple

DB_PATH = os.path.expanduser("~/.local/share/opencode2/opencode/opencode.db")
DEFAULT_SESSION_ID = "ses_fcd71dd78ffeuRd5wpUekhfwIp"
DEFAULT_TARGET_MSG_ID = "msg_0328eded4001jk816m46dSoid2"
DEFAULT_GATEWAY_URL = "https://localhost:7766/v1/chat/completions"
FALLBACK_GATEWAY_URL = "http://localhost:7766/v1/chat/completions"
AUTH_BEARER = "lr-or-oa-ch-no"
TARGET_MODEL = "stealth/ox-alpha"
USER_AGENT = "@opencode-ai/cli/2.0.0-beta.1"


def log(msg: str = "") -> None:
    """Print message immediately with flush."""
    print(msg, flush=True)


def extract_turn_payload_from_db(
    db_path: str,
    session_id: str,
    target_msg_id: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Extracts all messages leading up to target_msg_id from SQLite DB.
    Includes user prompts, assistant text, assistant tool calls, and tool outputs.
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"OpenCode database not found at {db_path}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Query session info
    cur.execute(
        "SELECT id, title, directory, model FROM session_v2 WHERE id = ?",
        (session_id,),
    )
    session_row = cur.fetchone()
    session_meta = {
        "id": session_id,
        "title": session_row[1] if session_row else "Unknown",
        "directory": session_row[2] if session_row else "Unknown",
        "model": session_row[3] if session_row else TARGET_MODEL,
    }

    # Query all messages in session in sequential order
    cur.execute(
        "SELECT seq, id, type, data FROM session_message WHERE session_id = ? ORDER BY seq ASC",
        (session_id,),
    )
    rows = cur.fetchall()
    conn.close()

    if not rows:
        raise ValueError(f"No messages found for session ID {session_id}")

    messages: List[Dict[str, Any]] = []
    found_target = False

    for seq, msg_id, msg_type, data_str in rows:
        if msg_id == target_msg_id:
            found_target = True
            log(f"[*] Reached target msg {target_msg_id} (seq={seq}, type={msg_type}) — cutting off for replay.")
            break

        try:
            data = json.loads(data_str)
        except Exception as err:
            log(f"[!] Warning: failed to parse JSON for msg {msg_id} (seq={seq}): {err}")
            continue

        if msg_type == "user":
            user_text = data.get("text") or data.get("content") or ""
            messages.append({"role": "user", "content": user_text})

        elif msg_type == "assistant":
            asst_msg: Dict[str, Any] = {"role": "assistant"}
            content_parts: List[str] = []
            tool_calls: List[Dict[str, Any]] = []
            tool_responses: List[Dict[str, Any]] = []

            raw_content = data.get("content", [])
            if isinstance(raw_content, list):
                for item in raw_content:
                    if not isinstance(item, dict):
                        continue
                    itype = item.get("type")
                    if itype == "text":
                        content_parts.append(item.get("text", ""))
                    elif itype == "tool":
                        tool_id = item.get("id") or item.get("callID") or f"call_{len(tool_calls)}"
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

                        # Extract tool output
                        raw_out = state.get("content") or state.get("output") or ""
                        if isinstance(raw_out, list):
                            out_text = "\n".join(
                                [
                                    part.get("text", "")
                                    for part in raw_out
                                    if isinstance(part, dict) and "text" in part
                                ]
                            )
                        elif isinstance(raw_out, dict):
                            out_text = json.dumps(raw_out)
                        else:
                            out_text = str(raw_out)

                        tool_responses.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_id,
                                "content": out_text,
                            }
                        )

            if content_parts:
                asst_msg["content"] = "\n".join(content_parts)
            if tool_calls:
                asst_msg["tool_calls"] = tool_calls

            if "content" in asst_msg or "tool_calls" in asst_msg:
                messages.append(asst_msg)
                messages.extend(tool_responses)

    if not found_target:
        log(f"[!] Warning: target msg {target_msg_id} not found in session; using all {len(rows)} messages.")

    return messages, session_meta


def replay_db_turn_stream(
    url: str,
    messages: List[Dict[str, Any]],
    model: str = TARGET_MODEL,
    auth_bearer: str = AUTH_BEARER,
    timeout: int = 120,
) -> Dict[str, Any]:
    """
    Sends the exact request payload to LiteRouter / OpenRouter via streaming SSE.
    Captures HTTP status, first 5 chunks, token counts, timing, and errors.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    encoded_data = json.dumps(payload).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_bearer}",
        "User-Agent": USER_AGENT,
    }

    req = urllib.request.Request(
        url,
        data=encoded_data,
        headers=headers,
        method="POST",
    )

    results: Dict[str, Any] = {
        "url": url,
        "model": model,
        "http_status": None,
        "first_5_chunks": [],
        "total_lines": 0,
        "total_bytes": 0,
        "heartbeat_count": 0,
        "sse_data_chunks": 0,
        "text_deltas": 0,
        "reasoning_deltas": 0,
        "tool_call_deltas": 0,
        "stream_completed_cleanly": False,
        "error": None,
        "elapsed_seconds": 0.0,
        "time_to_first_byte": 0.0,
    }

    start_time = time.time()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            results["http_status"] = resp.status
            results["time_to_first_byte"] = round(time.time() - start_time, 3)

            while True:
                line_bytes = resp.readline()
                if not line_bytes:
                    break

                results["total_bytes"] += len(line_bytes)
                results["total_lines"] += 1

                try:
                    line = line_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    line = line_bytes.decode("latin1")

                stripped = line.strip()
                if not stripped:
                    continue

                if len(results["first_5_chunks"]) < 5:
                    results["first_5_chunks"].append(stripped)

                # Check SSE comments / heartbeats
                if stripped.startswith(":"):
                    results["heartbeat_count"] += 1
                    continue

                if stripped == "data: [DONE]":
                    results["stream_completed_cleanly"] = True
                    continue

                if stripped.startswith("data: "):
                    results["sse_data_chunks"] += 1
                    raw_json = stripped[6:].strip()
                    try:
                        chunk_obj = json.loads(raw_json)
                        # Check for API errors embedded in chunk
                        if "error" in chunk_obj:
                            results["error"] = chunk_obj["error"]
                        choices = chunk_obj.get("choices", [])
                        if choices and isinstance(choices, list):
                            delta = choices[0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                results["text_deltas"] += 1
                            if "reasoning" in delta and delta["reasoning"]:
                                results["reasoning_deltas"] += 1
                            if "tool_calls" in delta and delta["tool_calls"]:
                                results["tool_call_deltas"] += 1
                    except json.JSONDecodeError as jde:
                        log(f"[!] Warning: SSE chunk JSON parse failed: {jde}")

    except urllib.error.HTTPError as http_err:
        results["http_status"] = http_err.code
        err_body = http_err.read().decode("utf-8", errors="replace")
        results["error"] = f"HTTP {http_err.code}: {http_err.reason} - {err_body}"
    except Exception as exc:
        results["error"] = f"Network / Stream Error: {type(exc).__name__}: {exc}"

    results["elapsed_seconds"] = round(time.time() - start_time, 3)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Reproduction harness for failing OpenCode DB turns.")
    parser.add_argument("--db-path", default=DB_PATH, help="Path to opencode.db")
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID, help="OpenCode session ID")
    parser.add_argument("--target-msg-id", default=DEFAULT_TARGET_MSG_ID, help="Target message ID to reproduce")
    parser.add_argument("--gateway-url", default=DEFAULT_GATEWAY_URL, help="Gateway URL")
    parser.add_argument("--model", default=TARGET_MODEL, help="Model ID")
    parser.add_argument("--auth", default=AUTH_BEARER, help="Auth bearer token")
    parser.add_argument("--timeout", type=int, default=60, help="Stream timeout in seconds")

    args = parser.parse_args()

    log("=" * 75)
    log("OpenCode DB Turn Reproduction & Live Stream Harness")
    log("=" * 75)
    log(f"DB Path:         {args.db_path}")
    log(f"Session ID:      {args.session_id}")
    log(f"Target Msg ID:   {args.target_msg_id}")
    log(f"Gateway URL:     {args.gateway_url}")
    log(f"Target Model:    {args.model}")
    log(f"Auth Bearer:     {args.auth}")
    log("=" * 75)

    log("\n[1/3] Extracting conversation turn history from SQLite database...")
    try:
        messages, session_meta = extract_turn_payload_from_db(
            db_path=args.db_path,
            session_id=args.session_id,
            target_msg_id=args.target_msg_id,
        )
    except Exception as exc:
        log(f"[FATAL] Failed to extract from DB: {exc}")
        return 1

    total_chars = sum(len(str(m.get("content", ""))) for m in messages)
    log(f"[+] Session Title:     {session_meta['title']}")
    log(f"[+] Session Directory: {session_meta['directory']}")
    log(f"[+] Extracted {len(messages)} messages (approx {total_chars} chars payload):")
    for idx, msg in enumerate(messages):
        role = msg.get("role", "unknown")
        c_len = len(str(msg.get("content", "")))
        tc_count = len(msg.get("tool_calls", []))
        log(f"    [{idx:02d}] role={role:<10} content_chars={c_len:<7} tool_calls={tc_count}")

    log("\n[2/3] Sending request payload to gateway and reading live stream...")
    url_to_try = args.gateway_url
    res = replay_db_turn_stream(
        url=url_to_try,
        messages=messages,
        model=args.model,
        auth_bearer=args.auth,
        timeout=args.timeout,
    )

    err_str = str(res.get("error") or "")
    if res["error"] and ("ConnectionRefusedError" in err_str or "CERTIFICATE_VERIFY_FAILED" in err_str):
        if url_to_try == DEFAULT_GATEWAY_URL:
            log(f"[!] Primary URL failed ({res['error']}), trying fallback {FALLBACK_GATEWAY_URL}...")
            res = replay_db_turn_stream(
                url=FALLBACK_GATEWAY_URL,
                messages=messages,
                model=args.model,
                auth_bearer=args.auth,
                timeout=args.timeout,
            )

    log("\n[3/3] Reproduction Results & Stream Metrics")
    log("-" * 75)
    log(f"HTTP Status Code:          {res['http_status']}")
    log(f"Time to First Byte (TTFB): {res['time_to_first_byte']}s")
    log(f"Total Stream Duration:     {res['elapsed_seconds']}s")
    log(f"Total Stream Bytes:        {res['total_bytes']} bytes")
    log(f"Total SSE Lines:           {res['total_lines']}")
    log(f"Heartbeats / Keepalive:    {res['heartbeat_count']}")
    log(f"SSE Data Chunks:           {res['sse_data_chunks']}")
    log(f"Text Content Deltas:       {res['text_deltas']}")
    log(f"Reasoning Deltas:          {res['reasoning_deltas']}")
    log(f"Tool Call Deltas:          {res['tool_call_deltas']}")
    log(f"Stream Completed Cleanly:  {res['stream_completed_cleanly']}")

    log("\nFirst 5 Chunks Received:")
    if res["first_5_chunks"]:
        for i, chunk in enumerate(res["first_5_chunks"]):
            log(f"  [{i+1}] {chunk}")
    else:
        log("  (None received)")

    if res["error"]:
        log("\n[!] ERROR ENCOUNTERED:")
        log(f"  {res['error']}")
        log("-" * 75)
        return 1
    else:
        log("\n[+] Stream completed successfully with zero errors.")
        log("-" * 75)
        return 0


if __name__ == "__main__":
    sys.exit(main())
