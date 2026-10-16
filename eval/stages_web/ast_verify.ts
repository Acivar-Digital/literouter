/**
 * Zero-Overhead TSX AST Gating using Bun's native C++/Zig Transpiler.
 * Validates that generated React/TSX code parses cleanly without syntax errors
 * before awarding full points for heuristic regex patterns.
 */

const tsxTranspiler = new Bun.Transpiler({ loader: "tsx", target: "browser" });

export interface TsxCompileResult {
  valid: boolean;
  exportsCount: number;
  error?: string;
}

const HTML_VOID_TAGS = [
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
];

/**
 * Safely normalizes HTML void tags (<img ...>, <input ...>) into self-closing JSX syntax
 * while respecting quoted string literals so arrow functions `(e) =>` in JSX expressions
 * are never corrupted.
 */
function normalizeVoidTagsForJsx(html: string): string {
  let normalized = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of HTML_VOID_TAGS) {
    const regex = new RegExp(`<(${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*?)(?<!\\/)>`, "gi");
    normalized = normalized.replace(regex, "<$1 />");
  }

  return normalized;
}

export function verifyTsxCompiles(code: string): TsxCompileResult {
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return {
      valid: false,
      exportsCount: 0,
      error: "Empty code snippet provided",
    };
  }

  // Tier 1: Try compiling code directly as a complete TSX module
  try {
    const transpiled = tsxTranspiler.transformSync(code);
    if (transpiled.length > 0) {
      const scanned = tsxTranspiler.scan(code);
      return {
        valid: true,
        exportsCount: scanned.exports.length,
      };
    }
  } catch {
    // Fall through to next tier
  }

  // Tier 2: Try direct compilation with normalized void tags
  try {
    const normalized = normalizeVoidTagsForJsx(code);
    const transpiled = tsxTranspiler.transformSync(normalized);
    if (transpiled.length > 0) {
      const scanned = tsxTranspiler.scan(normalized);
      return {
        valid: true,
        exportsCount: scanned.exports.length,
      };
    }
  } catch {
    // Fall through to next tier
  }

  // Tier 3: Try wrapping snippet in a JSX component fragment
  const wrapped = `export default function _Snippet() { return (<>\n${code}\n</>); }`;
  try {
    const transpiled = tsxTranspiler.transformSync(wrapped);
    if (transpiled.length > 0) {
      const scanned = tsxTranspiler.scan(wrapped);
      return {
        valid: true,
        exportsCount: scanned.exports.length,
      };
    }
  } catch {
    // Fall through to next tier
  }

  // Tier 4: Try wrapping normalized snippet in a JSX component fragment
  try {
    const normalized = normalizeVoidTagsForJsx(code);
    const wrappedNorm = `export default function _Snippet() { return (<>\n${normalized}\n</>); }`;
    const transpiled = tsxTranspiler.transformSync(wrappedNorm);
    if (transpiled.length > 0) {
      const scanned = tsxTranspiler.scan(wrappedNorm);
      return {
        valid: true,
        exportsCount: scanned.exports.length,
      };
    }
  } catch (errFinal) {
    return {
      valid: false,
      exportsCount: 0,
      error: errFinal instanceof Error ? errFinal.message : String(errFinal),
    };
  }

  return {
    valid: false,
    exportsCount: 0,
    error: "Failed to transpile TSX snippet",
  };
}

export const verifyComponentAst = verifyTsxCompiles;
