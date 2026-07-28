'use client'

import type { ReactNode } from "react";
import type { JobPhase } from "@/lib/api";

/**
 * LaunchComposer 的展示常量、纯函数与小件（从 launch-composer.tsx 拆出，
 * 职责：无状态的呈现支撑；主组件只保留状态机与编排）。
 */
export type Stage = "idle" | "input" | "running" | "done" | "error";
export type Quality = "draft" | "standard" | "high";

export const PHASE_LABEL: Record<JobPhase, string> = {
  queued: "排队中…",
  capturing: "正在采集网站…",
  scripting: "正在编写旁白…",
  synthesizing: "正在合成语音…",
  timing: "正在对齐音画…",
  composing: "正在合成分镜…",
  rendering: "正在渲染视频…",
  verifying: "正在校验金样本…",
  muxing: "正在混流旁白音轨…",
  done: "完成",
  failed: "失败",
};

/** 各阶段进度带 [起, 止, 时间常数τ(秒)]：τ 越大爬得越慢。采集不稳定所以带最宽、τ 最大 */
export const PHASE_BAND: Record<JobPhase, [number, number, number]> = {
  queued: [2, 8, 4],
  capturing: [8, 55, 150],
  scripting: [55, 60, 10],
  synthesizing: [60, 68, 20],
  timing: [68, 72, 8],
  composing: [72, 78, 8],
  rendering: [78, 93, 70],
  verifying: [93, 98, 4],
  muxing: [98, 99, 3],
  done: [100, 100, 1],
  failed: [0, 0, 1],
};

export const QUALITY_OPTS: { value: Quality; label: string }[] = [
  { value: "draft", label: "草稿" },
  { value: "standard", label: "标准" },
  { value: "high", label: "高清" },
];

export const DURATION_OPTS = [15, 24, 40];

export const PILL_BASE =
  "focus-ring group bg-background text-foreground relative isolate inline-flex h-16 w-full max-w-md items-center overflow-hidden rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

/** 右侧圆形动作钮（沿用 hero 的规格） */
export function ActionCircle({
  children,
  active,
}: {
  children: ReactNode;
  active?: boolean;
}): ReactNode {
  return (
    <span
      className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{
        backgroundColor: active ? "#352e82" : "var(--foreground)",
        color: active ? "#ffffff" : "var(--background)",
      }}
    >
      {children}
    </span>
  );
}

/** 分段选择用的小胶囊 */
export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? "#352e82" : "color-mix(in oklab, var(--foreground) 8%, transparent)",
        color: active ? "#ffffff" : "var(--foreground)",
      }}
    >
      {children}
    </button>
  );
}

export function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]+/gi, "-");
  } catch {
    return "video";
  }
}

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) {
    return "连不上后端，请先启动 server（npm run start）";
  }
  return firstLine(msg);
}
