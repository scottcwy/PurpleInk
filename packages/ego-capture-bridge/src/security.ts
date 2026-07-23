import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const forbiddenKey = /(^|_)(authorization|cookie|password|passcode|secret|token|local_?storage|profile)(_|$)/i;
const blockedHostnames = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data.ec2.internal",
]);

function normalizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_");
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

export type AddressResolver = (hostname: string) => Promise<string[]>;

async function defaultResolver(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  return (await lookup(hostname, { all: true })).map(({ address }) => address);
}

export async function assertNavigationAllowed(
  rawUrl: string,
  allowedOrigins: string[],
  resolveAddresses: AddressResolver = defaultResolver,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Navigation blocked: invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Navigation blocked: only HTTPS URLs are allowed");
  }
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (!allowed.has(url.origin)) {
    throw new Error("Navigation blocked: origin is not on the allowlist");
  }
  if (blockedHostnames.has(url.hostname.toLowerCase())) {
    throw new Error("Navigation blocked: metadata and local hosts are forbidden");
  }
  const addresses = await resolveAddresses(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("Navigation blocked: private address resolution is forbidden");
  }
}

export function assertSafeEvidencePayload(payload: unknown): void {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKey.test(normalizeKey(key))) {
        throw new Error(`Sensitive evidence field is forbidden: ${key}`);
      }
      visit(nested);
    }
  };
  visit(payload);
}

type RawDomNode = {
  tag: string;
  role?: string;
  text?: string;
  value?: string;
  attributes?: Record<string, string>;
};

export function sanitizeDomSummary(nodes: RawDomNode[]): Array<{
  tag: string;
  role?: string;
  text?: string;
}> {
  return nodes.map(({ tag, role, text }) => ({
    tag: tag.slice(0, 64),
    ...(role ? { role: role.slice(0, 128) } : {}),
    ...(text ? { text: text.replace(/\s+/g, " ").trim().slice(0, 500) } : {}),
  }));
}
