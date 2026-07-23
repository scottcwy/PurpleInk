import { BridgeService } from "./service";
import { R2BridgeStore } from "./r2";

let bridgeService: BridgeService | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Bridge API`);
  return value;
}

export function getBridgeService(): BridgeService {
  if (!bridgeService) {
    const store = new R2BridgeStore({
      accountId: required("R2_ACCOUNT_ID"),
      bucket: required("R2_EVIDENCE_BUCKET"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    });
    bridgeService = new BridgeService({
      tokenSecret: Buffer.from(required("BRIDGE_TOKEN_SECRET"), "base64"),
      uploadSigner: store,
      objectStore: store,
    });
  }
  return bridgeService;
}
