import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

# Resolve repository root
REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=REPO_ROOT / ".env")

PROMPT_FILE = REPO_ROOT / "research" / "prompt_template.txt"
OUTPUT_FILE = REPO_ROOT / "research" / "report.md"
RAW_JSON_FILE = REPO_ROOT / "research" / "raw_response.json"

LITEROUTER_PORT = os.getenv("LITEROUTER_PORT", "7766")
LITEROUTER_KEY = os.getenv("LITEROUTER_AUTH_KEY", "sk-lr-8f2a9e3b1c4d7e5f")
GATEWAY_URL = f"http://localhost:{LITEROUTER_PORT}/v1beta/interactions"


def transform_json_to_report(res_json: dict, elapsed: float | None = None) -> str:
    """Transforms raw Antigravity interaction JSON response into a rich readable Markdown report."""
    output_text_parts = []

    # 1. Check top-level keys first
    for k in ["output_text", "output", "response", "answer", "result"]:
        v = res_json.get(k)
        if isinstance(v, str) and v.strip():
            output_text_parts.append(v.strip())
        elif isinstance(v, dict) and (v.get("text") or v.get("message")):
            output_text_parts.append(str(v.get("text") or v.get("message")).strip())

    # 2. Parse execution steps
    steps = res_json.get("steps", [])
    thoughts = []
    search_queries = []
    sources = []
    sources_seen = set()

    for step in steps:
        stype = step.get("type")
        if stype == "model_output":
            contents = step.get("content", [])
            for c in contents:
                if isinstance(c, dict) and c.get("text"):
                    output_text_parts.append(c["text"].strip())
                elif isinstance(c, str) and c.strip():
                    output_text_parts.append(c.strip())
        elif stype == "thought":
            summaries = step.get("summary", [])
            if isinstance(summaries, list):
                for s in summaries:
                    if isinstance(s, dict) and s.get("text"):
                        thoughts.append(s["text"].strip())
                    elif isinstance(s, str) and s.strip():
                        thoughts.append(s.strip())
            elif isinstance(summaries, str) and summaries.strip():
                thoughts.append(summaries.strip())
        elif stype == "google_search_call":
            args = step.get("arguments", {})
            if isinstance(args, dict):
                queries = args.get("queries", [])
                for q in queries:
                    if q not in search_queries:
                        search_queries.append(q)
        elif stype == "google_search_result":
            results = step.get("result", [])
            for r in results:
                s_sug = r.get("search_suggestions")
                if s_sug:
                    try:
                        parsed = json.loads(s_sug)
                        for f in parsed.get("fields", []):
                            if f.get("name") == "result":
                                vals = f.get("value", {}).get("listValue", {}).get("values", [])
                                for v in vals:
                                    q_struct = v.get("structValue", {}).get("fields", [])
                                    for qf in q_struct:
                                        if qf.get("name") == "results":
                                            res_items = qf.get("value", {}).get("listValue", {}).get("values", [])
                                            for res_item in res_items:
                                                item_fields = res_item.get("structValue", {}).get("fields", [])
                                                item_dict = {}
                                                for ifield in item_fields:
                                                    val_obj = ifield.get("value", {})
                                                    if "stringValue" in val_obj:
                                                        item_dict[ifield["name"]] = val_obj["stringValue"]
                                                title = item_dict.get("source_title", "Untitled Source")
                                                url = item_dict.get("url")
                                                snippet = item_dict.get("snippet", "")
                                                pub_time = item_dict.get("publication_time", "")
                                                if url and url not in sources_seen:
                                                    sources_seen.add(url)
                                                    sources.append({
                                                        "title": title,
                                                        "url": url,
                                                        "snippet": snippet,
                                                        "date": pub_time,
                                                    })
                    except Exception:
                        pass

    full_output_text = "\n\n".join(output_text_parts).strip()

    report_lines = []
    agent_name = res_json.get("agent", "antigravity-preview-05-2026")
    env_id = res_json.get("environment_id", "N/A")
    usage = res_json.get("usage", {})

    if full_output_text:
        report_lines.append(full_output_text)
        report_lines.append("\n\n---\n\n")
    else:
        report_lines.append("# Deep Research Report\n\n*(No model output text found in JSON response)*\n\n---\n\n")

    report_lines.append("## Appendix: Agent Execution & Grounding Provenance\n\n")

    report_lines.append("### Execution Metadata\n")
    report_lines.append(f"- **Agent:** `{agent_name}`\n")
    report_lines.append(f"- **Environment ID:** `{env_id}`\n")
    if elapsed:
        report_lines.append(f"- **Execution Time:** {elapsed:.1f} seconds\n")
    if usage:
        tot_tok = usage.get("total_tokens", 0)
        in_tok = usage.get("total_input_tokens", 0)
        out_tok = usage.get("total_output_tokens", 0)
        thought_tok = usage.get("total_thought_tokens", 0)
        report_lines.append(
            f"- **Token Usage:** {tot_tok:,} total ({in_tok:,} input, {out_tok:,} output, {thought_tok:,} thought)\n"
        )
    report_lines.append("\n")

    if search_queries:
        report_lines.append("### Verified Search Queries\n")
        for q in search_queries:
            report_lines.append(f"- `{q}`\n")
        report_lines.append("\n")

    if sources:
        report_lines.append("### Grounding Sources & References\n")
        for i, src in enumerate(sources, 1):
            stitle = src.get("title", "Source")
            surl = src.get("url", "#")
            ssnip = src.get("snippet", "")
            d = src.get("date", "")
            date_str = f" ({d})" if d else ""
            report_lines.append(f"{i}. [{stitle}]({surl}){date_str}\n")
            if ssnip:
                report_lines.append(f"   > *{ssnip}*\n")
        report_lines.append("\n")

    if thoughts:
        report_lines.append("<details>\n<summary><b>Agent Reasoning & Thought Process Log (Expand)</b></summary>\n\n")
        for t in thoughts:
            report_lines.append(f"{t}\n\n")
        report_lines.append("</details>\n")

    return "".join(report_lines)


def run_deep_research(transform_only: bool = False):
    if transform_only or "--transform" in sys.argv or "--offline" in sys.argv:
        if not RAW_JSON_FILE.exists():
            print(f"❌ Error: Raw JSON file not found at {RAW_JSON_FILE}")
            sys.exit(1)
        print(f"🔄 Transforming existing {RAW_JSON_FILE} -> {OUTPUT_FILE}...")
        res_json = json.loads(RAW_JSON_FILE.read_text(encoding="utf-8"))
        final_report = transform_json_to_report(res_json)
        OUTPUT_FILE.write_text(final_report, encoding="utf-8")
        print(f"🎉 Successfully transformed JSON report to: {OUTPUT_FILE}")
        return

    if not PROMPT_FILE.exists():
        print(f"❌ Error: Prompt template not found at {PROMPT_FILE}")
        sys.exit(1)

    prompt_content = PROMPT_FILE.read_text(encoding="utf-8").strip()
    print("==================================================================")
    print("🔬 DEEP RESEARCH AGENT (via LiteRouter + Antigravity)")
    print("==================================================================")
    print(f"📍 Target Gateway: {GATEWAY_URL}")
    print(f"📄 Reading Prompt: {PROMPT_FILE}")
    print("------------------------------------------------------------------")
    print(prompt_content[:300] + ("..." if len(prompt_content) > 300 else ""))
    print("==================================================================\n")

    payload = {
        "agent": "antigravity-preview-05-2026",
        "input": prompt_content,
        "environment": "remote",
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITEROUTER_KEY}",
    }

    req = urllib.request.Request(
        GATEWAY_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    print("🚀 Dispatching request to Antigravity Agent (Google Cloud Remote Sandbox)...")
    print("⏳ This multi-step execution takes approximately 1-3 minutes. Please wait...\n")

    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            elapsed = time.time() - start_time
            print(f"✅ Response received in {elapsed:.1f} seconds (HTTP {resp.status})!")

            res_body = resp.read().decode("utf-8")
            res_json = json.loads(res_body)

            # --- 1. SAVE RAW JSON FOR DEBUGGING ---
            RAW_JSON_FILE.write_text(json.dumps(res_json, indent=2), encoding="utf-8")
            print(f"💾 Saved raw API response to: {RAW_JSON_FILE}")

            # --- 2. TRANSFORM JSON INTO READABLE REPORT ---
            final_report_str = transform_json_to_report(res_json, elapsed=elapsed)
            OUTPUT_FILE.write_text(final_report_str, encoding="utf-8")

            print("\n🎉 Deep Research Complete!")
            print(f"📄 Report written to: {OUTPUT_FILE}")
            print(f"📊 Usage stats: {json.dumps(res_json.get('usage', {}), indent=2)}")

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        print(f"❌ HTTP Error {e.code}: {err_body[:500]}")
    except Exception as e:
        print(f"❌ Execution Error: {e}")


if __name__ == "__main__":
    run_deep_research()