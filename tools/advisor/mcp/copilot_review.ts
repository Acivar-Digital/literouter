import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

export interface ViewResult { mdPath: string; chars: number; }
export interface PromptBundle { system: string; user: string; }

export function getView(url: string, selector?: string): ViewResult {
  const fetchScript = path.resolve(import.meta.dir, "../fetch/copilot_view.ts");
  const parseScript = path.resolve(import.meta.dir, "../fetch/parse_view.py");
  let mdPath = `/tmp/copilot_view_${Date.now()}.md`;
  if (fs.existsSync(fetchScript)) {
    const args = selector ? [fetchScript, url, selector] : [fetchScript, url];
    const proc = spawnSync("bun", args, { encoding: "utf-8" });
    const last = proc.stdout?.trim().split("\n").pop();
    if (last && fs.existsSync(last)) mdPath = last;
  }
  if (fs.existsSync(parseScript)) spawnSync("python3", [parseScript, mdPath]);
  const chars = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf-8").length : 0;
  return { mdPath, chars };
}

export function reviewScript(filePath: string, viewContext: string = ""): PromptBundle {
  const norm = path.normalize(filePath).replace(/^(\.\/)+/, "");
  if (!norm.startsWith("advisor/") && norm !== "advisor") {
    throw new Error(`Access denied: path must be inside advisor/ (got '${filePath}')`);
  }
  const fullPath = path.resolve(process.cwd(), norm);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${filePath}`);
  const code = fs.readFileSync(fullPath, "utf-8");
  const viewStr = viewContext.trim() ? viewContext : "<view>";
  return {
    system: "critical senior QA, fail loud file:line",
    user: `review ${filePath} vs ${viewStr}:\n\n${code}`.trim(),
  };
}

export function critiquePlan(planText: string): PromptBundle {
  return { system: "red-team plan critique", user: (planText || "").slice(0, 2000) };
}

export const TOOLS = [
  {
    name: "getView",
    description: "Fetch web view and parse to markdown",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, selector: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "reviewScript",
    description: "Review advisor/ script vs view context with QA bundle",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, view: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "critiquePlan",
    description: "Critique execution plan with red-team bundle",
    inputSchema: {
      type: "object",
      properties: { planText: { type: "string" } },
      required: ["planText"],
    },
  },
];

if (process.argv.includes("--list")) {
  console.log("Registered Tools (3):");
  TOOLS.forEach((t) => console.log(`- ${t.name}: ${t.description}`));
  process.exit(0);
}

const send = (msg: Record<string, unknown>) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line: string) => {
  const raw = line.trim();
  if (!raw) return;
  let req: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  try { req = JSON.parse(raw); } catch { return; }
  const { id, method, params } = req;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "copilot-review", version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    try {
      const name = params?.name;
      const args = params?.arguments ?? {};
      let result: unknown;
      if (name === "getView") result = getView(String(args.url || ""), args.selector ? String(args.selector) : undefined);
      else if (name === "reviewScript") result = reviewScript(String(args.path || ""), args.view ? String(args.view) : "");
      else if (name === "critiquePlan") result = critiquePlan(String(args.planText || ""));
      else throw new Error(`Unknown tool: ${name}`);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
    }
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, result: {} });
  }
});
