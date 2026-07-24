import { createHmac, timingSafeEqual } from "node:crypto";

type RunnerPort = {
  run(request: Record<string, unknown>): Promise<unknown>;
  publishCallback(publication: Record<string, unknown>): Promise<unknown>;
};

type TaskClaims = {
  workspaceId: string;
  jobId: string;
  attempt: number;
  expiresAt: number;
};

class LaunchVideoHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LaunchVideoHttpError";
  }
}

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

function bearer(request: Request): string {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchVideoHttpError("INVALID_REQUEST", "request body must be an object", 400);
  }
  return value as Record<string, unknown>;
}

export class LaunchVideoHttpController {
  private readonly runner: RunnerPort;
  private readonly secret: string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor({
    runner,
    secret,
    now = Date.now,
    ttlMs = 65 * 60_000,
  }: {
    runner: RunnerPort;
    secret: string;
    now?: () => number;
    ttlMs?: number;
  }) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error("launch video task signing secret must be at least 32 bytes");
    }
    this.runner = runner;
    this.secret = secret;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  create(request: Request): Promise<Response> {
    return this.jsonRoute(request, async (body) => {
      if (!constantTimeEqual(bearer(request), this.secret)) {
        throw new LaunchVideoHttpError("WORKLOAD_UNAUTHORIZED", "Unauthorized", 401);
      }
      const claims = this.claimsFrom(body);
      const expiresAt = this.now() + this.ttlMs;
      const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt })).toString("base64url");
      return {
        ...claims,
        expiresAt,
        workloadToken: `${payload}.${sign(this.secret, payload)}`,
      };
    });
  }

  execute(request: Request, jobId: string): Promise<Response> {
    return this.jsonRoute(request, async (body) => {
      const claims = this.claimsFrom(body, jobId);
      this.authorizeTask(request, claims);
      return this.runner.run(body);
    });
  }

  callback(request: Request, jobId: string): Promise<Response> {
    return this.jsonRoute(request, async (body) => {
      const claims = this.claimsFrom(body, jobId);
      this.authorizeTask(request, claims);
      await this.runner.publishCallback({ ...body, jobId });
      return { accepted: true };
    });
  }

  private claimsFrom(body: Record<string, unknown>, expectedJobId?: string): Omit<TaskClaims, "expiresAt"> {
    const jobId = expectedJobId ?? body.jobId;
    const workspaceId = body.workspaceId;
    const attempt = body.attempt;
    if (
      typeof jobId !== "string" || !jobId ||
      (expectedJobId !== undefined && body.jobId !== undefined && body.jobId !== expectedJobId) ||
      typeof workspaceId !== "string" || !workspaceId ||
      !Number.isInteger(attempt) || Number(attempt) < 1
    ) {
      throw new LaunchVideoHttpError("INVALID_REQUEST", "workspaceId, jobId, and attempt are required", 400);
    }
    return { workspaceId, jobId, attempt: Number(attempt) };
  }

  private authorizeTask(request: Request, expected: Omit<TaskClaims, "expiresAt">): void {
    const [payload = "", suppliedSignature = "", ...extra] = bearer(request).split(".");
    if (extra.length > 0 || !payload || !constantTimeEqual(suppliedSignature, sign(this.secret, payload))) {
      throw new LaunchVideoHttpError("WORKLOAD_UNAUTHORIZED", "Unauthorized", 401);
    }
    let claims: TaskClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TaskClaims;
    } catch {
      throw new LaunchVideoHttpError("WORKLOAD_UNAUTHORIZED", "Unauthorized", 401);
    }
    if (
      claims.workspaceId !== expected.workspaceId ||
      claims.jobId !== expected.jobId ||
      claims.attempt !== expected.attempt ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt <= this.now()
    ) {
      throw new LaunchVideoHttpError("WORKLOAD_UNAUTHORIZED", "Unauthorized", 401);
    }
  }

  private async jsonRoute(
    request: Request,
    handler: (body: Record<string, unknown>) => Promise<unknown>
  ): Promise<Response> {
    try {
      const body = objectBody(await request.json());
      return Response.json(await handler(body));
    } catch (error) {
      if (error instanceof LaunchVideoHttpError) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
      }
      const name = error instanceof Error ? error.name : "";
      const status = ["StaleAttemptError", "IdempotencyConflictError"].includes(name) ? 409 : 400;
      return Response.json({ error: { code: name || "LAUNCH_VIDEO_REJECTED", message: "Launch video request rejected" } }, { status });
    }
  }
}
