#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import ts from "typescript";

const MAX_NESTING_DEPTH = 3;
const MAX_CYCLOMATIC_COMPLEXITY = 5;
const CHECKPOINT_DIR = resolve(process.cwd(), ".checkpoints");

interface Violation {
  readonly name: string;
  readonly metric: number;
  readonly line: number;
  readonly message: string;
}

interface FileValidationResult {
  readonly filePath: string;
  readonly passed: boolean;
  readonly violations: readonly Violation[];
}

const NESTING_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

const BRANCH_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
]);

function isNestingNode(node: ts.Node): boolean {
  return NESTING_KINDS.has(node.kind);
}

function isBranchNode(node: ts.Node): boolean {
  return BRANCH_KINDS.has(node.kind);
}

function isBinaryDecision(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) {
    return false;
  }
  const op = node.operatorToken.kind;
  return (
    op === ts.SyntaxKind.BarBarToken ||
    op === ts.SyntaxKind.AmpersandAmpersandToken ||
    op === ts.SyntaxKind.QuestionQuestionToken
  );
}

function isFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function getFunctionName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return `anonymous@L${line + 1}`;
}

function measureDepth(node: ts.Node, currentDepth: number): number {
  let nextDepth = currentDepth;
  if (isNestingNode(node)) {
    nextDepth += 1;
  }
  let maxFound = nextDepth;
  ts.forEachChild(node, (child) => {
    const childDepth = measureDepth(child, nextDepth);
    if (childDepth > maxFound) {
      maxFound = childDepth;
    }
  });
  return maxFound;
}

function calculateCC(funcNode: ts.Node): number {
  let complexity = 1;
  function walk(node: ts.Node): void {
    if (isBranchNode(node) || isBinaryDecision(node)) {
      complexity += 1;
    }
    if (ts.isCaseClause(node) && node.expression) {
      complexity += 1;
    }
    ts.forEachChild(node, (child) => {
      if (!isFunctionNode(child)) {
        walk(child);
      }
    });
  }
  ts.forEachChild(funcNode, walk);
  return complexity;
}

function checkEmptyCatch(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  function walk(node: ts.Node): void {
    if (ts.isCatchClause(node)) {
      const statements = node.block.statements;
      if (statements.length === 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          name: "catch",
          metric: 0,
          line: line + 1,
          message: "Empty catch block detected (swallowed error)",
        });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return violations;
}

function checkNakedAny(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  function walk(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push({
        name: "any",
        metric: 0,
        line: line + 1,
        message: "Naked 'any' type detected. Use strict types or unknown.",
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return violations;
}

const FORBIDDEN_MARKERS: readonly string[] = [
  ["/", "/", " ", "T", "O", "D", "O"].join(""),
  ["/", "/", " ", ".", ".", ".", " ", "existing", " ", "code"].join(""),
];

function isSlopLine(line: string): boolean {
  for (const marker of FORBIDDEN_MARKERS) {
    if (line.includes(marker)) {
      return true;
    }
  }
  return false;
}

function checkCommentSlop(content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineText = lines[idx] ?? "";
    if (isSlopLine(lineText)) {
      violations.push({
        name: "slop_comment",
        metric: 0,
        line: idx + 1,
        message: `Forbidden placeholder comment: '${lineText.trim()}'`,
      });
    }
  }
  return violations;
}

function checkFunctionMetrics(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  violations: Violation[]
): void {
  const name = getFunctionName(node, sourceFile);
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const depth = measureDepth(node, 0);
  if (depth > MAX_NESTING_DEPTH) {
    violations.push({
      name,
      metric: depth,
      line: line + 1,
      message: `Function '${name}' exceeds max nesting depth (${depth} > ${MAX_NESTING_DEPTH})`,
    });
  }
  const cc = calculateCC(node);
  if (cc > MAX_CYCLOMATIC_COMPLEXITY) {
    violations.push({
      name,
      metric: cc,
      line: line + 1,
      message: `Function '${name}' exceeds max cyclomatic complexity (${cc} > ${MAX_CYCLOMATIC_COMPLEXITY})`,
    });
  }
}

function scanFunctionMetrics(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  function walk(node: ts.Node): void {
    if (isFunctionNode(node)) {
      checkFunctionMetrics(node, sourceFile, violations);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return violations;
}

export function sanitizeFile(targetPath: string): boolean {
  if (!existsSync(targetPath)) {
    return false;
  }
  const content = readFileSync(targetPath, "utf-8");
  const sanitized = content
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+$/gm, "");
  writeFileSync(targetPath, sanitized, "utf-8");
  return true;
}

export function checkpointFile(targetPath: string): string | null {
  const fullPath = resolve(targetPath);
  if (!existsSync(fullPath)) {
    return null;
  }
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const base = basename(fullPath, extname(fullPath));
  const ext = extname(fullPath);
  const tsStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = resolve(CHECKPOINT_DIR, `${base}_${tsStamp}${ext}.bak`);
  const content = readFileSync(fullPath, "utf-8");
  writeFileSync(destPath, content, "utf-8");
  return destPath;
}

export function validateFile(targetPath: string): FileValidationResult {
  const fullPath = resolve(targetPath);
  if (!existsSync(fullPath)) {
    return {
      filePath: targetPath,
      passed: false,
      violations: [
        {
          name: "fs",
          metric: 0,
          line: 0,
          message: `File not found: ${targetPath}`,
        },
      ],
    };
  }
  const content = readFileSync(fullPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    fullPath,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const fnViolations = scanFunctionMetrics(sourceFile);
  const catchViolations = checkEmptyCatch(sourceFile);
  const anyViolations = checkNakedAny(sourceFile);
  const slopViolations = checkCommentSlop(content);
  const allViolations = [
    ...fnViolations,
    ...catchViolations,
    ...anyViolations,
    ...slopViolations,
  ];
  return {
    filePath: targetPath,
    passed: allViolations.length === 0,
    violations: allViolations,
  };
}

function handleCheckpointCmd(filePath: string): number {
  const dest = checkpointFile(filePath);
  if (!dest) {
    console.error(`[Guardrail] Failed to checkpoint ${filePath}`);
    return 1;
  }
  console.log(`[Guardrail] Checkpoint created: ${dest}`);
  return 0;
}

function handleValidateCmd(filePath: string): number {
  const res = validateFile(filePath);
  if (res.passed) {
    console.log(`[Guardrail] PASSED: ${filePath}`);
    return 0;
  }
  console.error(`[Guardrail] FAILED: ${filePath}`);
  for (const v of res.violations) {
    console.error(`  - L${v.line}: ${v.message}`);
  }
  return 1;
}

function handleSanitizeCmd(filePath: string): number {
  const ok = sanitizeFile(filePath);
  if (!ok) {
    console.error(`[Guardrail] Failed to sanitize ${filePath}`);
    return 1;
  }
  console.log(`[Guardrail] Sanitized: ${filePath}`);
  return 0;
}

function handleFullCmd(filePath: string): number {
  handleCheckpointCmd(filePath);
  const valCode = handleValidateCmd(filePath);
  if (valCode === 0) {
    handleSanitizeCmd(filePath);
  }
  return valCode;
}

const COMMAND_MAP: Readonly<Record<string, (p: string) => number>> = {
  checkpoint: handleCheckpointCmd,
  validate: handleValidateCmd,
  sanitize: handleSanitizeCmd,
  "kill-tries": handleValidateCmd,
  "cc-check": handleValidateCmd,
  full: handleFullCmd,
};

function handleDispatch(command: string, targetPath: string): number {
  const handler = COMMAND_MAP[command];
  if (!handler) {
    console.error(`Unknown guardrail command: ${command}`);
    return 1;
  }
  return handler(targetPath);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const targetPath = args[1];
  if (!command || !targetPath) {
    console.log("Usage: bun run scripts/guardrail.ts <checkpoint|validate|sanitize|kill-tries|full> <file>");
    process.exit(1);
  }
  const exitCode = handleDispatch(command, targetPath);
  process.exit(exitCode);
}

if (import.meta.main) {
  main();
}
