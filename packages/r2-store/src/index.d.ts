export type R2ObjectStoreOptions = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: () => Date;
  fetch?: typeof fetch;
};

export class R2ObjectStore {
  constructor(options: R2ObjectStoreOptions);
  signPut(input: { key: string; bytes: number; sha256: string; mimeType: string; expiresInSeconds: number }): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }>;
  put(key: string, bytes: Uint8Array, metadata?: { contentType?: string; bundleHash?: string }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ bytes: number; sha256: string; mimeType: string } | null>;
}
