/**
 * src/logger.ts
 *
 * Simple logger that writes to console and appends to an error.log file
 * for critical events like key quarantines and upstream failures.
 */

import { appendFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join(process.cwd(), "error.log");

// Ensure the log file exists
if (!existsSync(LOG_FILE)) {
  writeFileSync(LOG_FILE, `--- LiteRouter Error Log Started: ${new Date().toISOString()} ---\n`);
}

function formatMsg(level: string, msg: string) {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${msg}\n`;
}

export const logger = {
  info: (msg: string) => {
    console.log(`[INFO] ${msg}`);
  },
  
  warn: (msg: string) => {
    const formatted = formatMsg("WARN", msg);
    console.warn(`\x1b[33m[WARN] ${msg}\x1b[0m`);
    appendFileSync(LOG_FILE, formatted);
  },
  
  error: (msg: string, err?: any) => {
    const errorMsg = err ? `${msg} | Error: ${err.message || String(err)}` : msg;
    const formatted = formatMsg("ERROR", errorMsg);
    console.error(`\x1b[31m[ERROR] ${errorMsg}\x1b[0m`);
    appendFileSync(LOG_FILE, formatted);
  }
};
