import { createHash } from "node:crypto";

export function assertDeterministicJson(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path} contains a non-deterministic number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDeterministicJson(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${path} must contain JSON data only`);
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) throw new TypeError(`${path}.${key} must not be undefined`);
    assertDeterministicJson(value[key], `${path}.${key}`);
  }
}

export function canonicalJson(value) {
  assertDeterministicJson(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value) {
  return sha256(canonicalJson(value));
}
