// Purple Ink 后端 HTTP API（Node 内置 http，零额外依赖）。
// 路由：
//   GET  /health            健康检查
//   POST /render            起一个渲染 Job，返回 { jobId }
//   GET  /jobs              列出所有 Job
//   GET  /jobs/:id          单个 Job 状态/进度
//   GET  /jobs/:id/video    产物 mp4（支持 Range，可在浏览器直接播放）
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createJob, getJob, listJobs, toPublicJob } from "./job-store"
import { runJob, type RenderRequest } from "./job-runner"
import { logger } from "../lib/logger"
import { errorMessage } from "../lib/error-message"

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (c) => {
      raw += c
      if (raw.length > 1_000_000) reject(new Error("body too large"))
    })
    req.on("end", () => resolve(raw))
    req.on("error", reject)
  })
}

/** 串流 mp4，支持 Range（浏览器 <video> 拖动进度条） */
async function streamVideo(res: ServerResponse, req: IncomingMessage, filePath: string): Promise<void> {
  const s = await stat(filePath)
  const range = req.headers.range
  const headersBase = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  }
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? parseInt(m[1], 10) : 0
    const end = m && m[2] ? parseInt(m[2], 10) : s.size - 1
    if (start >= s.size || end >= s.size) {
      res.writeHead(416, { "Content-Range": `bytes */${s.size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...headersBase,
      "Content-Range": `bytes ${start}-${end}/${s.size}`,
      "Content-Length": end - start + 1,
    })
    createReadStream(filePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { ...headersBase, "Content-Length": s.size })
    createReadStream(filePath).pipe(res)
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method || "GET"
  const url = new URL(req.url || "/", "http://localhost")
  const path = url.pathname

  // CORS 预检
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    res.end()
    return
  }

  // GET /health
  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, jobs: listJobs().length })
    return
  }

  // POST /render
  if (method === "POST" && path === "/render") {
    let body: RenderRequest
    try {
      body = JSON.parse((await readBody(req)) || "{}")
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" })
      return
    }
    const hasUrl = typeof body.url === "string" && /^https?:\/\//i.test(body.url)
    const hasCapture = typeof body.captureDir === "string" && body.captureDir.length > 0
    if (!hasUrl && !hasCapture) {
      sendJson(res, 400, { error: "need `url`(http/https) or `captureDir`" })
      return
    }
    // 规范化可选字段
    if (body.fps !== undefined) {
      const fpsNum = Number(body.fps)
      if (fpsNum) body.fps = fpsNum
      else delete body.fps
    }
    if (body.generation && !["llm", "template", "auto"].includes(body.generation)) body.generation = "auto"
    const kind = hasUrl ? "url" : "capture"
    const input = (hasUrl ? body.url : body.captureDir) as string
    const job = createJob(kind, input)
    logger.info("api:render_queued", { id: job.id, kind, input })
    runJob(job, body)
    sendJson(res, 202, { jobId: job.id, statusUrl: `/jobs/${job.id}` })
    return
  }

  // GET /jobs
  if (method === "GET" && path === "/jobs") {
    sendJson(res, 200, { jobs: listJobs().map(toPublicJob) })
    return
  }

  // GET /jobs/:id  和 GET /jobs/:id/video
  const jobMatch = /^\/jobs\/([^/]+)(\/video)?$/.exec(path)
  if (method === "GET" && jobMatch) {
    const job = getJob(jobMatch[1]!)
    if (!job) {
      sendJson(res, 404, { error: "job not found" })
      return
    }
    if (jobMatch[2] === "/video") {
      if (!job.videoPath) {
        sendJson(res, 409, { error: "video not ready", phase: job.phase, status: job.status })
        return
      }
      try {
        await streamVideo(res, req, job.videoPath)
      } catch (err) {
        logger.error("api:video_stream_failed", { id: job.id, error: String(err) })
        sendJson(res, 500, { error: errorMessage(err) })
      }
      return
    }
    sendJson(res, 200, toPublicJob(job))
    return
  }

  sendJson(res, 404, { error: "not found", path })
}

/** 启动 HTTP 服务，返回 server 实例 */
export function startServer(port: number): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error("api:unhandled", { stack: String(err?.stack || err) })
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(err) })
    })
  })
  server.listen(port, () => {
    logger.info("api:listening", { port })
    console.log(`\n  Purple Ink API  →  http://localhost:${port}`)
    console.log(`  POST /render    {"url":"https://...","duration":24,"quality":"draft"}`)
    console.log(`  POST /render    {"captureDir":"./out/demo-cap","quality":"draft"}\n`)
  })
}
