# Deep Research Tool (LiteRouter + Antigravity)

This directory contains the tools necessary to execute **Institutional-Grade Deep Research** using the local LiteRouter API gateway and the `antigravity-preview-05-2026` agent.

The tool automates the process of orchestrating a multi-perspective "Persona Council" (Tech, Macro, Quant, Risk, and Bear Case) to research complex topics, fetch live data via Google Search, and synthesize a comprehensive, cited Markdown whitepaper.

## 📂 Core Components

1. **`prompts/` directory** 
   - Stores your target research prompts. 
   - A template guide is available at `prompts/_template_guide.md` to teach you how to write an effective institutional-grade prompt with 5 tailored personas.
2. **`deep-research.py`**
   - The Python execution script. It reads your specific prompt file, dispatches it to the local LiteRouter gateway, and waits for the agent to finish its multi-step execution.
3. **`reports/` directory** (Generated)
   - The script outputs the final synthesized whitepaper here as a Markdown file, timestamped for historical tracking (e.g., `Direction_of_JPY_YYYYMMDD_HHMM.md`).
   - It also saves the raw JSON response (`..._raw.json`) alongside the report for debugging or re-rendering.
4. **`run.sh`**
   - A batch-execution shell script. You can configure this script with a list of prompts and run it manually or via a weekly cron job.

## 🚀 How to Use (For Humans)

1. **Ensure the Gateway is running:**
   The LiteRouter gateway must be running locally (usually on port 7766).
   ```bash
   # From the project root
   bash scripts/start.sh
   # OR
   bun run src/index.ts
   ```

2. **Create your Prompt:**
   - Copy `prompts/_template_guide.md` to a new file, e.g., `prompts/Direction_of_JPY.md`.
   - Modify the **"OBJECTIVE & TARGET TOPIC"** and customize the **5 Personas** so they fit your domain.

3. **Run the Script:**
   Execute the script and pass the name of your prompt. 
   ```bash
   uv run python research/deep-research.py Direction_of_JPY
   ```
   *(Note: This process takes 1-3 minutes. It can safely be run via cron jobs using the included `run.sh` wrapper).*

4. **Review the Results:**
   Open the generated file in `reports/` to read the whitepaper.

### Offline / Transform Mode
If you want to re-generate the Markdown report from an existing raw JSON file (e.g., if you tweaked the markdown generation logic in the python script) without hitting the API again:
```bash
uv run python research/deep-research.py --transform research/reports/Direction_of_JPY_20260729_1430_raw.json
```

## 🤖 Instructions for AI Agents

When a user asks you to "conduct deep research", "research a topic", or "run the deep research tool":

1. **Target Topic Alignment:**
   - Create a new file in `research/prompts/` (e.g., `research/prompts/Topic_Name.md`) using `_template_guide.md` as your structural template.
   - You MUST fill out the entire file, including customizing the 5 Personas to match the user's specific request.
2. **Execution:**
   - Run the script: `uv run python research/deep-research.py Topic_Name`
   - *Note: Do not run it in the background (`&`) unless you are explicitly tracking the process, as you need to wait for it to finish to verify the output.*
3. **Verification & Delivery:**
   - Verify that the report was successfully generated in `research/reports/`.
   - Read the generated report to confirm it looks correct, and inform the user that the research is complete.

## 🔧 Environment Variables

The script looks for a `.env` file in the repository root for the following overrides (otherwise it uses defaults):
- `LITEROUTER_PORT` (Default: `7766`)
- `LITEROUTER_AUTH_KEY` (Default: `sk-lr-8f2a9e3b1c4d7e5f`)
