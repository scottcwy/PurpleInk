import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { logger } from "../lib/logger"
import { PublicUrlPolicyError } from "../security/public-url-policy"
import { verifyInternalEngineKey } from "./internal-auth"
import {
  fingerprintInternalRenderRequest,
  InternalRenderRequestError,
  normalizeInternalRenderRequest,
} from "./internal-render-request"
import {
  createIntegratedJob,
  getJob,
  toIntegratedJobView,
} from "./job-store"
import { runJob } from "./job-runner"

export async function handleInternalRequest(
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): Promise<boolean> {
  if (!path.startsWith("/internal/")) return false

  const auth = verifyInternalEngineKey(req.headers)
  if (auth === "unconfigured") {
    sendJson(res, 503, { error: "internal engine unavailable" })
    return true
  }
  if (auth !== "authorized") {
    res.setHeader("WWW-Authenticate", "Bearer")
    sendJson(res, 401, { error: "unauthorized" })
    return true
  }

  if (req.method === "POST" && path === "/internal/render") {
    await startIntegratedRender(req, res)
    return true
  }

  const match = /^\/internal\/jobs\/([^/]+)(\/video)?$/.exec(path)
  if (req.method === "GET" && match) {
    const job = getJob(match[1]!)
    if (!job?.integrated) {
      sendJson(res, 404, { error: "job not found" })
      return true
    }
    if (match[2] === "/video") {
      await sendIntegratedVideo(req, res, job.id, job.videoPath)
      return true
    }
    sendJson(res, 200, toIntegratedJobView(job))
    return true
  }

  sendJson(res, 404, { error: "not found" })
  return true
}

async function startIntegratedRender(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse((await readBody(req)) || "{}")
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" })
    return
  }

  let normalized
  try {
    normalized = await normalizeInternalRenderRequest(body)
  } catch (error) {
    if (
      error instanceof InternalRenderRequestError ||
      error instanceof PublicUrlPolicyError
    ) {
      sendJson(res, 422, {
        error: "invalid internal render request",
        code: error.code,
      })
      return
    }
    throw error
  }

  const created = createIntegratedJob(
    normalized.url,
    normalized.requestId,
    fingerprintInternalRenderRequest(normalized)
  )
  if (created.kind === "conflict") {
    sendJson(res, 409, {
      error: "requestId conflict",
      code: "IDEMPOTENCY_CONFLICT",
    })
    return
  }

  if (created.kind === "created") {
    runJob(created.job, normalized)
    logger.info("api:internal_render_queued", {
      id: created.job.id,
      requestId: normalized.requestId,
      origin: new URL(normalized.url).origin,
    })
  }

  sendJson(res, created.kind === "created" ? 202 : 200, {
    reused: created.kind === "reused",
    job: toIntegratedJobView(created.job),
  })
}

async function sendIntegratedVideo(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string,
  videoPath: string | null | undefined
): Promise<void> {
  if (!videoPath) {
    const job = getJob(jobId)!
    sendJson(res, 409, {
      error: "video not ready",
      phase: job.phase,
      status: job.status,
    })
    return
  }

  try {
    await streamVideo(res, req, videoPath)
  } catch (error) {
    logger.error("api:internal_video_stream_failed", {
      id: jobId,
      error: String(error),
    })
    if (!res.headersSent) sendJson(res, 500, { error: "video unavailable" })
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      raw += chunk
      if (raw.length > 100_000) reject(new Error("body too large"))
    })
    req.on("end", () => resolve(raw))
    req.on("error", reject)
  })
}

async function streamVideo(
  res: ServerResponse,
  req: IncomingMessage,
  filePath: string
): Promise<void> {
  const metadata = await stat(filePath)
  const range = req.headers.range
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  }
  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": metadata.size })
    createReadStream(filePath).pipe(res)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const start = match?.[1] ? Number.parseInt(match[1], 10) : 0
  const end = match?.[2] ? Number.parseInt(match[2], 10) : metadata.size - 1
  if (!match || start > end || start >= metadata.size || end >= metadata.size) {
    res.writeHead(416, { "Content-Range": `bytes */${metadata.size}` })
    res.end()
    return
  }
  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${metadata.size}`,
    "Content-Length": end - start + 1,
  })
  createReadStream(filePath, { start, end }).pipe(res)
}
