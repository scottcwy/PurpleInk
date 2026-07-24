#!/usr/bin/env node
import { readJson } from "./read-json.mjs";
import { printResult, provenanceErrors, validateSchema } from "./validation-lib.mjs";

const path = process.argv[2];
if (!path) throw new Error("usage: validate-input.mjs <input.json>");
const input = await readJson(path);
printResult([...(await validateSchema(input, "input-v1.schema.json")), ...provenanceErrors(input)]);
