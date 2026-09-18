#!/usr/bin/env python3
"""
Test script for inclusionai/ling-3.0-flash-fin:free (OpenRouter).

Uses curl to test whether the model emits XML <invoke><parameter>...</parameter></invoke>
tool call format, and verifies the LiteRouter gateway's dots.ts XML↔JSON translation.

Usage:
    cd /home/yapilwsl/arthityap/literouter
    python3 scripts/test_dots_xml_model.py

Prerequisites:
    - LiteRouter gateway running at localhost:7766
    - .env.local has OPENROUTER_API_KEYS populated
"""

import json
import re
import subprocess
from pathlib import Path

# ── Config ──────────────────────────────────────────────
MODEL = "inclusionai/ling-3.0-flash-fin:free"
LR  = "http://localhost:7766/v1/chat/completions"
UP  = "https://openrouter.ai/api/v1/chat/completions"

DIR_NO_TC = "lr-or-ao-ch-no"
DIR_TC    = "lr-or-ao-ch-tc"

PROMPT_TEXT   = "Say hello in one sentence."
PROMPT_WEATHER = (
    "You are a helpful assistant. "
    "Use the get_weather tool to check the weather in Tokyo. "
    "The tool takes a location parameter."
)
PROMPT_XML = (
    "Use the get_weather tool. "
    "The tool takes a location parameter. "
    "What is the weather in Tokyo?"
)

UPSTREAM_TIMEOUT = 30
GATEWAY_TIMEOUT  = 60
STREAM_TIMEOUT   = 120

# ── Helpers ─────────────────────────────────────────────
def load_key():
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    content = env_path.read_text().strip()
    for line in content.split("\n"):
        if line.startswith("OPENROUTER_API_KEYS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'").split(",")[0].strip()
    raise SystemExit("ERROR: No OPENROUTER_API_KEYS in .env.local")


def curl_post(url, key, payload, directive=None, stream=False, timeout=30):
    """Run curl and return (stdout, stderr, returncode)."""
    cmd = [
        "curl", "-s", "-k", "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {key}",
        "-d", json.dumps(payload),
        "--connect-timeout", str(timeout),
        "--max-time", str(timeout),
    ]
    if directive:
        cmd += ["-H", f"x-api-key: {directive}"]
    if stream:
        cmd += ["-H", "Accept: text/event-stream"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1


def curl_stream(url, key, payload, directive=None, timeout=120):
    """Stream via curl and return parsed SSE events."""
    cmd = [
        "curl", "-s", "-k", "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {key}",
        "-H", "Accept: text/event-stream",
        "-d", json.dumps(payload),
        "-H", f"x-api-key: {directive}" if directive else "",
        "--connect-timeout", "10",
        "--max-time", str(timeout),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
    except subprocess.TimeoutExpired:
        return []

    events = []
    for line in result.stdout.split("\n"):
        line = line.strip()
        if line.startswith("data: ") and line not in ("data: [DONE]", "data:[DONE]"):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


def has_xml(text):
    return bool(text and ("<invoke" in text or "<parameter" in text))


def extract_params(text):
    params = {}
    for m in re.finditer(r'<parameter\s+name="([^"]+)">([\s\S]*?)</parameter>', text):
        params[m.group(1)] = m.group(2).strip()
    return params


def show_json(data, label, max_lines=40):
    print(f"\n  --- {label} ---")
    if isinstance(data, dict):
        pretty = json.dumps(data, indent=2)
    elif isinstance(data, list):
        pretty = json.dumps(data, indent=2)
    else:
        pretty = str(data)
    lines = pretty.split("\n")
    for line in lines[:max_lines]:
        print(f"    {line}")
    if len(lines) > max_lines:
        print(f"    ... ({len(lines)} total lines)")


# ── Tests ───────────────────────────────────────────────
def t1_basic(key):
    print("\n" + "=" * 70)
    print("TEST 1: Basic connectivity (text completion, gateway)")
    print("=" * 70)
    out, err, rc = curl_post(LR, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_TEXT}],
        "stream": False,
    }, directive=DIR_NO_TC, timeout=GATEWAY_TIMEOUT)
    if rc != 0 or not out.strip():
        print(f"  ❌ Failed (rc={rc}): {err[:200]}")
        return False
    try:
        data = json.loads(out)
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        finish = data.get("choices", [{}])[0].get("finish_reason", "?")
        print(f"  finish_reason: {finish}")
        print(f"  Content: {content}")
        return bool(content)
    except json.JSONDecodeError:
        print(f"  Raw output: {out[:300]}")
        return False


def t2_upstream_plain(key):
    print("\n" + "=" * 70)
    print("TEST 2: Direct upstream — plain wire, weather prompt (no tc)")
    print("=" * 70)
    out, err, rc = curl_post(UP, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_WEATHER}],
        "stream": False,
    }, timeout=UPSTREAM_TIMEOUT)
    if rc != 0 or not out.strip():
        print(f"  ❌ Failed (rc={rc}): {err[:200]}")
        return None
    try:
        data = json.loads(out)
        msg = data.get("choices", [{}])[0].get("message", {})
        content = msg.get("content", "")
        tool_calls = msg.get("tool_calls")
        finish = data.get("choices", [{}])[0].get("finish_reason", "?")
        print(f"  finish_reason: {finish}")
        if has_xml(content):
            print("  ✅ XML DETECTED in upstream content!")
            params = extract_params(content)
            if params:
                print(f"  Parameters: {json.dumps(params, indent=4)}")
        elif tool_calls:
            print("  ⚠️  OpenAI-format tool_calls (no XML):")
            for tc in tool_calls[:2]:
                fn = tc.get("function", {})
                print(f"    {fn.get('name')}({fn.get('arguments', '')[:100]})")
        else:
            print(f"  Content: {str(content)[:300]}")
        return {"content": content, "tool_calls": tool_calls, "finish_reason": finish}
    except json.JSONDecodeError:
        print(f"  Raw: {out[:300]}")
        return None


def t3_gateway_no_tc(key):
    print("\n" + "=" * 70)
    print("TEST 3: Gateway — lr-or-ao-ch-no (no dots)")
    print("=" * 70)
    out, err, rc = curl_post(LR, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_WEATHER}],
        "stream": False,
    }, directive=DIR_NO_TC, timeout=GATEWAY_TIMEOUT)
    if rc != 0 or not out.strip():
        print(f"  ❌ Failed (rc={rc}): {err[:200]}")
        return None
    try:
        data = json.loads(out)
        msg = data.get("choices", [{}])[0].get("message", {})
        content = msg.get("content", "")
        tool_calls = msg.get("tool_calls")
        finish = data.get("choices", [{}])[0].get("finish_reason", "?")
        print(f"  finish_reason: {finish}")
        if has_xml(content):
            print("  ⚠️  XML present (no tc nuance)")
        elif tool_calls:
            print("  ✅ tool_calls returned:")
            for tc in tool_calls[:2]:
                fn = tc.get("function", {})
                print(f"    {fn.get('name')}({fn.get('arguments', '')[:100]})")
        else:
            print(f"  Content: {str(content)[:300]}")
        return {"content": content, "tool_calls": tool_calls, "finish_reason": finish}
    except json.JSONDecodeError:
        print(f"  Raw: {out[:300]}")
        return None


def t4_gateway_tc(key):
    print("\n" + "=" * 70)
    print("TEST 4: Gateway — lr-or-ao-ch-tc (with dots XML translation)")
    print("=" * 70)
    out, err, rc = curl_post(LR, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_WEATHER}],
        "stream": False,
    }, directive=DIR_TC, timeout=GATEWAY_TIMEOUT)
    if rc != 0 or not out.strip():
        print(f"  ❌ Failed (rc={rc}): {err[:200]}")
        return None
    try:
        data = json.loads(out)
        msg = data.get("choices", [{}])[0].get("message", {})
        content = msg.get("content", "")
        tool_calls = msg.get("tool_calls")
        finish = data.get("choices", [{}])[0].get("finish_reason", "?")
        print(f"  finish_reason: {finish}")
        if has_xml(content):
            print("  ⚠️  XML present in gateway output")
        elif tool_calls:
            print("  ✅ tool_calls returned:")
            for tc in tool_calls[:2]:
                fn = tc.get("function", {})
                print(f"    {fn.get('name')}({fn.get('arguments', '')[:100]})")
        else:
            print(f"  Content: {str(content)[:300]}")
        return {"content": content, "tool_calls": tool_calls, "finish_reason": finish}
    except json.JSONDecodeError:
        print(f"  Raw: {out[:300]}")
        return None


def t5_stream(key):
    print("\n" + "=" * 70)
    print("TEST 5: Streaming through gateway — XML/tool_calls in SSE")
    print("=" * 70)
    events = curl_stream(LR, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_WEATHER}],
        "stream": True,
    }, directive=DIR_TC, timeout=STREAM_TIMEOUT)
    if not events:
        print("  ❌ No stream events")
        return None
    all_content = ""
    xml_found = False
    tc_found = False
    for ev in events:
        delta = ev.get("choices", [{}])[0].get("delta", {})
        c = delta.get("content", "")
        tc = delta.get("tool_calls")
        fr = ev.get("choices", [{}])[0].get("finish_reason")
        all_content += c
        if c and has_xml(c):
            xml_found = True
        if tc:
            tc_found = True
        if fr:
            print(f"  finish_reason: {fr}")
    print(f"  Events: {len(events)}, Content len: {len(all_content)}")
    print(f"  XML in stream: {xml_found}, Tool calls in stream: {tc_found}")
    print(f"  Content preview: {all_content[:200]}")
    return {"xml": xml_found, "tool_calls": tc_found, "chunks": len(events)}


def t6_direct_upstream_stream(key):
    print("\n" + "=" * 70)
    print("TEST 6: Direct upstream stream — raw XML check (no gateway)")
    print("=" * 70)
    events = curl_stream(UP, key, {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT_XML}],
        "stream": True,
    }, timeout=STREAM_TIMEOUT)
    if not events:
        print("  ❌ No events")
        return None
    all_content = ""
    for ev in events:
        delta = ev.get("choices", [{}])[0].get("delta", {})
        all_content += delta.get("content", "")
    print(f"  Events: {len(events)}, Content length: {len(all_content)}")
    if has_xml(all_content):
        print("  ✅ XML DETECTED from upstream!")
        params = extract_params(all_content)
        if params:
            print(f"  Parameters: {json.dumps(params, indent=4)}")
    else:
        print("  ⚠️  No XML from upstream")
        print(f"  Preview: {all_content[:300]}")
    return {"content": all_content, "xml": has_xml(all_content)}


# ── Main ────────────────────────────────────────────────
def main():
    key = load_key()
    print(f"Model: {MODEL}")
    print(f"Key: ...{key[-8:]}")
    print(f"Gateway: {LR}")

    t1_basic(key)
    upstream = t2_upstream_plain(key)
    t3_gateway_no_tc(key)
    t4_gateway_tc(key)
    t5_stream(key)
    t6_direct_upstream_stream(key)

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    if upstream and upstream.get("content") and has_xml(upstream["content"]):
        print("  ✅ Model EMITS XML → use lr-or-ao-ch-tc")
        params = extract_params(upstream["content"])
        if params:
            print(f"     Parameter names: {list(params.keys())}")
    elif upstream and upstream.get("tool_calls"):
        print("  ⚠️  Model returns OpenAI-format tool_calls (not XML)")
        print("     → lr-or-ao-ch-no is correct (tc not needed)")
    else:
        print("  ℹ️  Model returns plain text or unknown format")
        print("     → tc nuance only needed for XML-emitting models")

    print("\n  Directive format: lr-<provider>-<payload>-<completion>-<nuance>")
    print("    Provider:  or=OpenRouter, nv=NVIDIA, gg=Google, ...")
    print("    Payload:   oa=OpenAI, cl=Claude, ao=Anthropic→OpenAI, gg=Google, rs=Responses")
    print("    Completion: ch=Chat, ms=Messages, ob=OpenAI Beta, gc=GenerateContent")
    print("    Nuances:   tc=dots XML mode, ts=thinking, sb=strip reasoning, dp=dot prompt")
    print("\n  For this model (OpenRouter open-weights):")
    print("    lr-or-ao-ch-no  ← default (no XML translation)")
    print("    lr-or-ao-ch-tc  ← if model emits XML <invoke><parameter>")
    print()


if __name__ == "__main__":
    main()
