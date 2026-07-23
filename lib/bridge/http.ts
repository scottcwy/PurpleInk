import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { BridgeError, sha256Hex } from "./service";
import { getBridgeService } from "./runtime";

export function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new BridgeError("token_missing", "Bearer access token is required", 401);
  }
  return authorization.slice("Bearer ".length);
}

export async function authenticatedJson(request: NextRequest): Promise<{
  token: string;
  body: Record<string, unknown>;
}> {
  const token = bearerToken(request);
  const rawBody = await request.text();
  const suppliedHash = request.headers.get("x-bridge-body-sha256") ?? "";
  if (suppliedHash !== sha256Hex(rawBody)) {
    throw new BridgeError("request_body_hash_invalid", "Request body hash does not match", 401);
  }
  getBridgeService().authenticateRequest({
    token,
    method: request.method,
    path: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    timestamp: request.headers.get("x-bridge-timestamp") ?? "",
    nonce: request.headers.get("x-bridge-nonce") ?? "",
    bodyHash: suppliedHash,
    signature: request.headers.get("x-bridge-signature") ?? "",
  });
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new BridgeError("json_invalid", "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BridgeError("json_invalid", "Request body must be a JSON object");
  }
  return { token, body: body as Record<string, unknown> };
}

export function authenticatedEmpty(request: NextRequest): string {
  const token = bearerToken(request);
  const bodyHash = request.headers.get("x-bridge-body-sha256") ?? "";
  if (bodyHash !== sha256Hex("")) {
    throw new BridgeError("request_body_hash_invalid", "Request body hash does not match", 401);
  }
  getBridgeService().authenticateRequest({
    token,
    method: request.method,
    path: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    timestamp: request.headers.get("x-bridge-timestamp") ?? "",
    nonce: request.headers.get("x-bridge-nonce") ?? "",
    bodyHash,
    signature: request.headers.get("x-bridge-signature") ?? "",
  });
  return token;
}

export function bridgeResponse(error: unknown): NextResponse {
  if (error instanceof BridgeError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Bridge request failed validation" } },
      { status: 400 },
    );
  }
  console.error("Bridge API request failed", error);
  return NextResponse.json(
    { error: { code: "bridge_internal_error", message: "Bridge request failed" } },
    { status: 500 },
  );
}
