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

export function verifyTsxCompiles(code: string): TsxCompileResult {
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return {
      valid: false,
      exportsCount: 0,
      error: "Empty code snippet provided",
    };
  }

  try {
    // If snippet is a pure JSX/HTML template without function/export wrapper,
    // wrap it so the transpiler does not discard it as unused top-level JSX expressions.
    const toTest = !/export\s+|function\s+|const\s+|class\s+/i.test(code)
      ? `export default function _Snippet() { return (\n${code}\n); }`
      : code;

    const transpiled = tsxTranspiler.transformSync(toTest);
    const scanned = tsxTranspiler.scan(toTest);
    return {
      valid: transpiled.length > 0,
      exportsCount: scanned.exports.length,
    };
  } catch (err) {
    return {
      valid: false,
      exportsCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const verifyComponentAst = verifyTsxCompiles;
