import { createHash, createHmac } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const awsEncode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const canonicalPath = (bucket, key) => `/${awsEncode(bucket)}/${key.split("/").map(awsEncode).join("/")}`;
const amzTimestamp = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");

export class R2ObjectStore {
  constructor(options) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? fetch;
  }

  async signPut(input) {
    const headers = {
      "content-length": String(input.bytes),
      "content-type": input.mimeType,
      "x-amz-checksum-sha256": Buffer.from(input.sha256, "hex").toString("base64"),
      "x-amz-meta-sha256": input.sha256,
    };
    return {
      url: this.presign({ method: "PUT", key: input.key, expiresInSeconds: input.expiresInSeconds, headers }),
      headers,
      expiresAt: new Date(this.now().getTime() + input.expiresInSeconds * 1_000).toISOString(),
    };
  }

  async put(key, bytes, metadata = {}) {
    const body = Buffer.from(bytes);
    const signed = await this.signPut({
      key,
      bytes: body.length,
      sha256: hash(body),
      mimeType: metadata.contentType ?? "application/octet-stream",
      expiresInSeconds: 300,
    });
    const response = await this.fetcher(signed.url, { method: "PUT", headers: signed.headers, body });
    if (!response.ok) throw new Error(`R2 PUT failed with status ${response.status}`);
  }

  async get(key) {
    const response = await this.fetcher(this.presign({ method: "GET", key, expiresInSeconds: 60, headers: {} }), { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 GET failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async head(key) {
    const response = await this.fetcher(this.presign({ method: "HEAD", key, expiresInSeconds: 60, headers: {} }), { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 HEAD failed with status ${response.status}`);
    const checksum = response.headers.get("x-amz-checksum-sha256");
    return {
      bytes: Number(response.headers.get("content-length")),
      sha256: response.headers.get("x-amz-meta-sha256") ?? (checksum ? Buffer.from(checksum, "base64").toString("hex") : ""),
      mimeType: response.headers.get("content-type")?.split(";")[0] ?? "",
    };
  }

  presign(input) {
    const timestamp = amzTimestamp(this.now());
    const date = timestamp.slice(0, 8);
    const host = `${this.options.accountId}.r2.cloudflarestorage.com`;
    const scope = `${date}/auto/s3/aws4_request`;
    const headers = { host, ...input.headers };
    const headerNames = Object.keys(headers).sort();
    const signedHeaders = headerNames.join(";");
    const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
    const query = new Map([
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.options.accessKeyId}/${scope}`],
      ["X-Amz-Date", timestamp],
      ["X-Amz-Expires", String(input.expiresInSeconds)],
      ["X-Amz-SignedHeaders", signedHeaders],
    ]);
    const canonicalQuery = [...query.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join("&");
    const path = canonicalPath(this.options.bucket, input.key);
    const canonicalRequest = [input.method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, hash(canonicalRequest)].join("\n");
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, date);
    const regionKey = hmac(dateKey, "auto");
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}
