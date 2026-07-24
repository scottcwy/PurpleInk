import { readFile, writeFile } from "node:fs/promises";

import AdmZip from "adm-zip";

import { CaptureProtocolError } from "./protocol.mjs";
import { sanitizeText } from "./redaction.mjs";

const inputMethods = new Set([
  "fill",
  "press",
  "selectOption",
  "setInputFiles",
  "type",
]);

function sanitizeValue(value, field) {
  if (field === "sha1") return value;
  if (typeof value === "string") return sanitizeText(value).text;
  if (Array.isArray(value)) return value.map((child) => sanitizeValue(child));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child, key)]));
}

function sanitizeTraceLine(line, screencastResources, inputCallIds) {
  const rawEvent = JSON.parse(line);
  if (rawEvent.type === "screencast-frame" && typeof rawEvent.sha1 === "string") {
    screencastResources.add(rawEvent.sha1);
  }
  const event = sanitizeValue(rawEvent);
  if (["action", "before"].includes(event.type) && inputMethods.has(event.method)) {
    inputCallIds.add(event.callId);
    event.params = { redacted: true };
  }
  if (event.type === "log" && inputCallIds.has(event.callId)) event.message = "[REDACTED]";
  return JSON.stringify(event);
}

export async function sanitizeTraceArchive(path) {
  try {
    const input = new AdmZip(await readFile(path));
    const traceEntry = input.getEntry("trace.trace");
    if (!traceEntry) throw new Error("trace.trace is missing");
    const screencastResources = new Set();
    const inputCallIds = new Set();
    const trace = input.readAsText(traceEntry)
      .split("\n")
      .filter(Boolean)
      .map((line) => sanitizeTraceLine(line, screencastResources, inputCallIds))
      .join("\n");
    const output = new AdmZip();
    for (const entry of input.getEntries()) {
      if (entry.entryName === "trace.trace") {
        output.addFile(entry.entryName, Buffer.from(`${trace}\n`));
      } else if (entry.entryName === "trace.network") {
        output.addFile(entry.entryName, Buffer.alloc(0));
      } else if (!entry.entryName.startsWith("resources/") || screencastResources.has(entry.entryName.slice("resources/".length))) {
        output.addFile(entry.entryName, entry.getData());
      }
    }
    await writeFile(path, output.toBuffer());
  } catch (error) {
    throw new CaptureProtocolError(
      "TRACE_REDACTION_FAILED",
      error instanceof Error ? error.message : "trace archive could not be sanitized"
    );
  }
}
