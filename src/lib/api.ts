/**
 * Purple Ink 后端 API 客户端。
 * 默认走同源 /api/*，由 Next rewrites 反向代理到渲染 worker（见 next.config.ts）。
 * 这样浏览器无跨域；如需直连后端可用 NEXT_PUBLIC_API_BASE 覆盖。
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "/api/engine";

export type JobPhase =
  | "queued"
  | "capturing"
  | "scripting"
  | "synthesizing"
  | "timing"
  | "composing"
  | "rendering"
  | "verifying"
  | "muxing"
  | "done"
  | "failed"
  | "cancelled";

export interface JobView {
  id: string;
  kind: "url" | "capture";
  input: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  phase: JobPhase;
  checkPassed?: boolean;
  durationSec?: number;
  elapsedSec?: number;
  goldenVerified?: boolean;
  goldenDetails?: string[];
  hasVideo: boolean;
  videoUrl: string | null;
  error?: string;
  logs: { at: number; msg: string }[];
}

export interface RenderRequest {
  /** 目标网址（http/https）；与 captureDir 二选一 */
  url?: string;
  /** 已有 capture/ 目录（本地调试用） */
  captureDir?: string;
  /** 目标时长秒 */
  duration?: number;
  /** 渲染质量 draft|standard|high */
  quality?: string;
  /** 跳过 hyperframes check */
  skipCheck?: boolean;
  /** URL 模式透传给采集层（如 { driver: "mock" } 无浏览器冒烟） */
  capture?: { driver?: "mock" | "playwright" };
}

/** 起一个渲染任务，返回 jobId */
export async function startRender(req: RenderRequest): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `render failed: ${res.status}`);
  return data;
}

/** 查询单个任务状态 */
export async function getJob(id: string): Promise<JobView> {
  const res = await fetch(`${API_BASE}/jobs/${id}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `job not found: ${res.status}`);
  return data;
}

/** 视频直链（可用于 <video src> 或下载） */
export function videoUrl(id: string): string {
  return `${API_BASE}/jobs/${encodeURIComponent(id)}/video`;
}

/**
 * 轮询任务直到完成/失败。
 * @param onUpdate 每次拿到最新状态时回调（用于更新进度 UI）
 */
export async function pollUntilDone(
  id: string,
  onUpdate: (job: JobView) => void,
  intervalMs = 1500,
  signal?: AbortSignal,
): Promise<JobView> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const job = await getJob(id);
    onUpdate(job);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** 把产物 mp4 拉成 blob 后触发浏览器下载（拿到干净的文件名） */
export async function downloadVideo(id: string, filename: string): Promise<void> {
  const res = await fetch(videoUrl(id), { cache: "no-store" });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
