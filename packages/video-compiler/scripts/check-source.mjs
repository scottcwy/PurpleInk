#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = ["src/compile.mjs", "src/template.mjs"];
const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /new\s+Date\s*\(/, /https?:\/\//, /fetch\s*\(/, /repeat\s*:\s*-1/];
const failures = [];
for (const file of files) {
  const source = await readFile(resolve(file), "utf8");
  for (const pattern of banned) if (pattern.test(source)) failures.push(`${file}: prohibited non-deterministic or network source ${pattern}`);
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("source policy valid\n");
