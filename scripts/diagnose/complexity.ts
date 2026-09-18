import { readdirSync, statSync, realpathSync } from "fs";
import { join, resolve, normalize } from "path";

// @ts-ignore
import tsComplex from "ts-complex";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const PROJECT_ROOT_REAL = realpathSync(PROJECT_ROOT);

function isPathWithinBase(target: string, base: string, baseReal: string): boolean {
  const resolved = normalize(resolve(target));
  if (resolved !== baseReal && !resolved.startsWith(baseReal + "/")) {
    return false;
  }
  const realResolved = normalize(realpathSync(resolved));
  return (
    realResolved === baseReal || realResolved.startsWith(baseReal + "/")
  );
}

function getAllTsFiles(dir: string): string[] {
  if (!isPathWithinBase(dir, PROJECT_ROOT, PROJECT_ROOT_REAL)) {
    throw new Error(
      `Path traversal detected: "${dir}" escapes the project root "${PROJECT_ROOT}"`,
    );
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const rawTargetDir = process.argv[2] || "src";
const targetDir = resolve(rawTargetDir);
if (!isPathWithinBase(targetDir, PROJECT_ROOT, PROJECT_ROOT_REAL)) {
  console.error(
    `Error: Target directory "${rawTargetDir}" resolves outside the project root.`,
  );
  process.exit(1);
}
const tsFiles = getAllTsFiles(targetDir);

console.log(`\n==================================================`);
console.log(` Cyclomatic Complexity & Maintainability Report (${targetDir})`);
console.log(`==================================================\n`);

for (const file of tsFiles) {
  console.log(`📄 File: ${file}`);
  try {
    const cyclomatic: Record<string, number> = tsComplex.calculateCyclomaticComplexity(file);
    const maintainability: { averageMaintainability: number } = tsComplex.calculateMaintainability(file);

    console.log(`   Maintainability Index: ${maintainability.averageMaintainability.toFixed(2)} / 100`);
    console.log(`   Functions & Complexity:`);

    const entries = Object.entries(cyclomatic);
    const sorted = entries.sort((a, b) => b[1] - a[1]);

    for (const [name, score] of sorted) {
      if (typeof name === "string" && name.startsWith("{")) continue; // skip anonymous block spans
      const status = score > 15 ? "🚨 (HIGH)" : score > 10 ? "⚠️ (MODERATE)" : "✅";
      console.log(`     - ${name}: ${score} ${status}`);
    }
  } catch (err) {
    console.error(`   Error processing ${file}:`, err);
  }
  console.log("");
}
