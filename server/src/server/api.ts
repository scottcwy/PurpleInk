// Purple Ink 后端 HTTP API（Node 内置 http，零额外依赖）。
// 路由：
//   GET  /health            健康检查
//   POST /render            已退役（410）；Products 只走受鉴权的 /internal/render
//   GET  /jobs              列出所有 Job
//   GET  /jobs/:id          单个 Job 状态/进度
//   GET  /jobs/:id/video    产物 mp4（支持 Range，可在浏览器直接播放）
//   /internal/*             server-only key 保护的 Products 工作流集成边界
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { getJob, listJobs, toPublicJob } from "./job-store"
import { logger } from "../lib/logger"
import { errorMessage } from "../lib/error-message"
import { handleInternalRequest } from "./internal-api"

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  })
  res.end(data)
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

  if (await handleInternalRequest(req, res, path)) return

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

  // 公开直启会绕过 workspace/attempt 归属、统一模型路由和计费，固定退役。
  if (method === "POST" && path === "/render") {
    sendJson(res, 410, { error: "public render endpoint retired" })
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
    console.log("  Products render → authenticated /internal/render\n")
  })
}
