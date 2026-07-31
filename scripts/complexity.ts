import { readdirSync, statSync } from "fs";
import { join } from "path";

// @ts-ignore
import tsComplex from "ts-complex";

function getAllTsFiles(dir: string): string[] {
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

const targetDir = process.argv[2] || "src";
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
