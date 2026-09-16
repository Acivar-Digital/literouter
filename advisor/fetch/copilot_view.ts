#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

function showHelp(): void {
  console.log(`copilot_view.ts - Extract web content to clean markdown

Usage:
  bun advisor/fetch/copilot_view.ts <url> [--selector <css_selector>] [--diet] [--keep-all] [--help]

Options:
  --selector, -s  Target CSS selector (default: "article,main")
  --diet          Diet mode: AI-targeted extraction / strip noise (default: false)
  --keep-all      Raw mode: keep-all content without stripping (default: true, raw)
  --help, -h      Display this help message and exit

Output:
  Prints JSON { mdPath, size, profile, fallback, diet } to stdout.`);
}

function parseArgs(argv: string[]): { url: string; selector: string; diet: boolean } {
  let url = "";
  let selector = "article,main";
  let diet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (arg === "--selector" || arg === "-s") {
      selector = argv[++i] ?? selector;
    } else if (arg === "--diet") {
      diet = true;
    } else if (arg === "--keep-all") {
      diet = false;
    } else if (arg && !arg.startsWith("-") && !url) {
      url = arg;
    }
  }

  if (!url) {
    console.error("Error: URL argument is required.");
    showHelp();
    process.exit(1);
  }

  return { url, selector, diet };
}

function findChrome(): string {
  const candidates = [
    "google-chrome",
    "chromium",
    "chromium-browser",
    "chrome",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
  ];
  for (const bin of candidates) {
    const found = Bun.which(bin);
    if (found) return found;
    if (fs.existsSync(bin)) return bin;
  }
  return "google-chrome";
}

const { url, selector, diet } = parseArgs(process.argv.slice(2));

const profile = process.env.ADVISOR_PROFILE || path.join(process.env.HOME || "", ".advisor_tools", "profile");
if (!fs.existsSync(profile) || !fs.statSync(profile).isDirectory()) {
  console.error(`Error: Missing profile directory: ${profile}`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join("/tmp", "advisor-"));
const mdPath = path.join(tmpDir, "content.md");
const htmlPath = path.join(tmpDir, "content.html");

const scraplingBin = Bun.which("scrapling");
const fallback = !scraplingBin;

if (scraplingBin) {
  const cmd = [scraplingBin, "extract", "stealthy-fetch", url, mdPath];
  if (diet) cmd.push("--ai-targeted");
  cmd.push("-s", selector);
  Bun.spawnSync(cmd, { stderr: "ignore" });
} else {
  const chromeBin = findChrome();
  const proc = Bun.spawnSync(
    [chromeBin, "--headless", "--dump-dom", `--user-data-dir=${profile}`, "--no-sandbox", "--disable-gpu", url],
    { stderr: "ignore" },
  );
  const html = proc.stdout ? Buffer.from(proc.stdout).toString("utf-8") : "";
  fs.writeFileSync(htmlPath, html, "utf-8");
  const md = diet
    ? html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : html;
  fs.writeFileSync(mdPath, md, "utf-8");
}

const size = fs.existsSync(mdPath) ? fs.statSync(mdPath).size : 0;
console.log(JSON.stringify({ mdPath, size, profile, fallback, diet }));
