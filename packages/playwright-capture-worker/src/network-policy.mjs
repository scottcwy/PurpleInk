import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { CaptureProtocolError } from "./protocol.mjs";

function parseIpv4(address) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) return undefined;
  return octets;
}

function parseIpv6(address) {
  const withoutZone = address.toLowerCase().split("%")[0];
  let normalized = withoutZone;
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return undefined;
    const first = ((octets[0] << 8) | octets[1]).toString(16);
    const second = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.slice(0, -ipv4Tail.length) + `${first}:${second}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    return undefined;
  }
  return words;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = parseIpv4(address);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const words = parseIpv6(address);
    if (!words) return false;
    const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (ipv4Mapped) {
      return isPublicAddress(`${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`);
    }
    const globallyRoutable = words[0] >= 0x2000 && words[0] <= 0x3fff;
    const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
    return globallyRoutable && !documentation;
  }
  return false;
}

function parseHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CaptureProtocolError("URL_INVALID", "request URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new CaptureProtocolError("URL_INVALID", "only credential-free HTTP(S) URLs are allowed");
  }
  return url;
}

export class CaptureNetworkPolicy {
  #resolved = new Map();

  constructor({ allowedOrigins, resolve = lookup, allowPrivateTestOrigins = false }) {
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
      throw new CaptureProtocolError("ORIGIN_POLICY_INVALID", "allowedOrigins is required");
    }
    this.allowedOrigins = new Set(allowedOrigins.map((value) => parseHttpUrl(value).origin));
    this.resolve = resolve;
    this.allowPrivateTestOrigins = allowPrivateTestOrigins;
  }

  async resolveUrl(value) {
    const url = parseHttpUrl(value);
    if (!this.allowedOrigins.has(url.origin)) {
      throw new CaptureProtocolError("ORIGIN_NOT_ALLOWED", `${url.origin} is not allowed`);
    }
    let resolution = this.#resolved.get(url.hostname);
    if (!resolution) {
      resolution = (async () => {
        let records;
        if (isIP(url.hostname)) {
          records = [{ address: url.hostname, family: isIP(url.hostname) }];
        } else {
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              records = await this.resolve(url.hostname, { all: true, verbatim: true });
              break;
            } catch {
              if (attempt === 3) {
                throw new CaptureProtocolError("DNS_RESOLUTION_FAILED", `cannot resolve ${url.hostname}`);
              }
              await new Promise((retry) => setTimeout(retry, attempt * 50));
            }
          }
        }
        if (!Array.isArray(records) || records.length === 0) {
          throw new CaptureProtocolError("DNS_RESOLUTION_FAILED", `cannot resolve ${url.hostname}`);
        }
        const addresses = [...new Set(records.map((record) => record.address.toLowerCase()))].sort();
        if (!this.allowPrivateTestOrigins && addresses.some((address) => !isPublicAddress(address))) {
          throw new CaptureProtocolError("SSRF_ADDRESS_BLOCKED", `${url.hostname} resolved to a non-public address`);
        }
        return addresses;
      })();
      this.#resolved.set(url.hostname, resolution);
    }
    let addresses;
    try {
      addresses = await resolution;
    } catch (error) {
      if (this.#resolved.get(url.hostname) === resolution) this.#resolved.delete(url.hostname);
      throw error;
    }
    return { url, addresses };
  }

  async assertUrl(value) {
    await this.resolveUrl(value);
  }
}
