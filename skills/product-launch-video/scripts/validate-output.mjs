#!/usr/bin/env node
import { planErrors, printResult, provenanceErrors, readJson, validateSchema } from "./validation-lib.mjs";

const planPath = process.argv[2];
if (!planPath) throw new Error("usage: validate-output.mjs <plan.json> [--input <input.json>]");
const inputFlag = process.argv.indexOf("--input");
const input = inputFlag >= 0 ? await readJson(process.argv[inputFlag + 1]) : undefined;
const plan = await readJson(planPath);
const errors = [...(await validateSchema(plan, "launch-video-plan-v1.schema.json"))];
if (input) errors.push(...(await validateSchema(input, "input-v1.schema.json")), ...provenanceErrors(input));
errors.push(...planErrors(plan, input));
printResult(errors);
