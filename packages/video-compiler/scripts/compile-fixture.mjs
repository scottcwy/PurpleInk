#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, writeBundle } from "../src/index.mjs";
import { sha256 } from "../src/canonical-json.mjs";

const sourcePath = resolve(process.argv[2]);
const outputPath = resolve(process.argv[3]);
const fixtureRoot = dirname(sourcePath);
const input = JSON.parse(await readFile(sourcePath, "utf8"));
for (const entry of input.assetPackage.entries) {
  const bytes = await readFile(resolve(fixtureRoot, entry.fixturePath));
  entry.contentBase64 = bytes.toString("base64");
  entry.bytes = bytes.length;
  entry.sha256 = sha256(bytes);
  delete entry.fixturePath;
}
await rm(outputPath, { recursive: true, force: true });
const bundle = compile(input);
await writeBundle(bundle, outputPath);
process.stdout.write(`${bundle.bundleHash}\n`);
