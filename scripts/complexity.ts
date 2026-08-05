import { readdirSync, statSync } from "fs";
import { join, resolve, normalize } from "path";

// @ts-ignore
import tsComplex from "ts-complex";

const PROJECT_ROOT = resolve(import.meta.dir, "..");

function isPathWithinBase(target: string, base: string): boolean {
  const resolved = normalize(resolve(target));
  const baseResolved = normalize(resolve(base));
  return resolved === baseResolved || resolved.startsWith(baseResolved + "/");
}

function getAllTsFiles(dir: string): string[] {
  if (!isPathWithinBase(dir, PROJECT_ROOT)) {
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
if (!isPathWithinBase(targetDir, PROJECT_ROOT)) {
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
