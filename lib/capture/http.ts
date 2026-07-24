import { createHmac, timingSafeEqual } from "node:crypto";

import { CaptureControlError } from "@/lib/capture/control-plane";

type CaptureTaskClaims = {
  workspaceId: string;
  jobId: string;
  attempt: number;
  expiresAt: number;
};

const unauthorized = () => new Error("Unauthorized capture worker");
const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function issueCaptureTaskToken(secret: string, claims: CaptureTaskClaims): string {
  if (Buffer.byteLength(secret) < 32) throw new Error("capture task signing secret must be at least 32 bytes");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function authorizeCaptureTask(
  request: Request,
  secret: string,
  expected: Omit<CaptureTaskClaims, "expiresAt">
): void {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const [payload = "", suppliedSignature = "", ...extra] = token.split(".");
  const expectedSignature = sign(secret, payload);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (
    extra.length > 0 || !payload || suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw unauthorized();
  }
  let claims: CaptureTaskClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CaptureTaskClaims;
  } catch {
    throw unauthorized();
  }
  if (
    claims.workspaceId !== expected.workspaceId || claims.jobId !== expected.jobId ||
    claims.attempt !== expected.attempt || !Number.isFinite(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  ) {
    throw unauthorized();
  }
}

export function authorizeCaptureWorker(request: Request, expectedToken: string): void {
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expectedToken);
  if (
    expectedBytes.length < 32 || suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw unauthorized();
  }
}

export function captureErrorResponse(error: unknown): Response {
  if (error instanceof CaptureControlError) {
    const status = ["STALE_ATTEMPT", "ATTEMPT_CONFLICT", "EVENT_CONFLICT", "INVALID_RELEASE_STATE"].includes(error.code)
      ? 409
      : error.code.endsWith("_NOT_FOUND") ? 404 : 400;
    return Response.json({ error: { code: error.code, message: error.message } }, { status });
  }
  if (error instanceof Error && error.message === "Unauthorized capture worker") {
    return Response.json({ error: { code: "WORKLOAD_UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal capture error" } }, { status: 500 });
}

export async function captureJsonRoute(
  request: Request,
  handler: (body: Record<string, unknown>) => Promise<unknown>
): Promise<Response> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new CaptureControlError("INVALID_REQUEST", "request body must be an object");
    }
    return Response.json(await handler(body as Record<string, unknown>));
  } catch (error) {
    return captureErrorResponse(error);
  }
}
