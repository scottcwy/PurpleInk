type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const normalizeJson = (input: unknown): JsonValue => {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("Canonical JSON only supports finite numbers");
    return input;
  }
  if (Array.isArray(input)) return input.map(normalizeJson);
  if (typeof input === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(input).sort()) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) throw new TypeError("Canonical JSON does not support undefined values");
      output[key] = normalizeJson(value);
    }
    return output;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof input} values`);
};

export function canonicalJson(input: unknown): string {
  return JSON.stringify(normalizeJson(input));
}

export async function contentHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
