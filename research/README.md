# Deep Research Tool (LiteRouter + Antigravity)

This directory contains the tools necessary to execute **Institutional-Grade Deep Research** using the local LiteRouter API gateway and the `antigravity-preview-05-2026` agent.

The tool automates the process of orchestrating a multi-perspective "Persona Council" (Tech, Macro, Quant, Risk, and Bear Case) to research complex topics, fetch live data via Google Search, and synthesize a comprehensive, cited Markdown whitepaper.

## 📂 Core Components

1. **`prompt_template.txt`** 
   - The primary input file. It contains the prompt instructions, the rubric, and the **Target Topic**.
   - Defines the 5 personas and the rigid 8-section report structure required.
2. **`deep-research.py`**
   - The Python execution script. It reads the prompt template, dispatches it to the local LiteRouter gateway, and waits for the agent to finish its multi-step execution.
   - Saves the raw JSON response and compiles a rich `report.md`.
3. **`raw_response.json`** (Generated)
   - The raw output from the agent, saved automatically. Useful for debugging or re-rendering the report.
4. **`report.md`** (Generated)
   - The final, synthesized Markdown report.
   - Includes an appendix with Execution Metadata, Verified Search Queries, Grounding Sources (citations/URLs), and a collapsible section containing the Agent's Reasoning/Thought Process.

## 🚀 How to Use (For Humans)

1. **Ensure the Gateway is running:**
   The LiteRouter gateway must be running locally (usually on port 7766).
   ```bash
   # From the project root
   bash scripts/start.sh
   # OR
   bun run src/index.ts
   ```

2. **Set your Topic:**
   Open `prompt_template.txt` and modify the **"OBJECTIVE & TARGET TOPIC"** section at the top of the file to reflect your research goals. 

3. **Run the Script:**
   Execute the script. Since the project enforces `uv`, run it via:
   ```bash
   uv run python research/deep-research.py
   ```
   *(Note: This process takes 1-3 minutes as the agent autonomously browses the web and synthesizes the data).*

4. **Review the Results:**
   Open `report.md` to read the generated whitepaper.

### Offline / Transform Mode
If you want to re-generate `report.md` from an existing `raw_response.json` (e.g., if you tweaked the markdown generation logic in the python script) without hitting the API again:
```bash
uv run python research/deep-research.py --transform
```

## 🤖 Instructions for AI Agents

When a user asks you to "conduct deep research", "research a topic", or "run the deep research tool":

1. **Target Topic Alignment:**
   - Edit `research/prompt_template.txt` using the `edit` tool. 
   - Replace the existing topic under `## OBJECTIVE & TARGET TOPIC` with the user's requested topic.
2. **Execution:**
   - Run the script using the `bash` tool: `uv run python research/deep-research.py`
   - *Note: Do not run it in the background (`&`) unless you are explicitly tracking the process, as you need to wait for it to finish to verify the output.*
3. **Verification & Delivery:**
   - Verify that `research/report.md` was successfully generated.
   - Read the generated `report.md` to confirm it looks correct, and inform the user that the research is complete.

## 🔧 Environment Variables

The script looks for a `.env` file in the repository root for the following overrides (otherwise it uses defaults):
- `LITEROUTER_PORT` (Default: `7766`)
- `LITEROUTER_AUTH_KEY` (Default: `sk-lr-8f2a9e3b1c4d7e5f`)
