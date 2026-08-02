/**
 * 每日备份常驻调度器（Dockerfile.backup 的 CMD）。
 *
 * 为什么不用 crond：容器环境变量不会进入 cron 的执行环境，注入需要把含
 * secret 的环境写盘再 source；Node 调度天然继承容器 env，无明文落盘。
 *
 * 行为：启动 10s 后首跑（等容器网络/DNS 就绪），成功后每 24h 一次；
 * 失败则 1 小时后自动重试，避免单次网络抖动漏掉一整天的备份。
 * 每次运行输出恒为单行 JSON，直接进容器日志。
 *
 * 定时器必须保持 ref'd：Dockerfile.backup 容器里没有其他事件循环句柄，
 * 对 keep-alive 定时器调用 unref() 会让进程在首跑或每次 tick 后立刻退出，
 * 每日备份永远不会发生（源契约测试禁止该调用出现）。
 * createScheduler 暴露可注入延迟与 run，测试用 5-20ms 的真实短定时器做冒烟验证；
 * 生产入口在文件末尾按 10s / 24h / 1h 装配并 start()。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runBackupOnce } from "./run-backup";
import type { BackupResult } from "./run-backup";

/** 首跑延迟：10s，等容器网络/DNS 就绪。 */
export const FIRST_RUN_DELAY_MS = 10 * 1000;
/** 成功后的运行间隔：24h。 */
export const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 失败后的重试间隔：1h。 */
export const RETRY_INTERVAL_MS = 60 * 60 * 1000;

export interface CreateSchedulerOptions {
  firstDelayMs: number;
  runIntervalMs: number;
  retryIntervalMs: number;
  run: () => Promise<BackupResult>;
}

export interface Scheduler {
  /** 启动常驻循环；定时器保持 ref'd，进程不会自行退出。 */
  start(): void;
  /** 停止循环并清除 pending 定时器（主要用于测试清理）。 */
  stop(): void;
  /** 当前已调度定时器的延迟（ms）；未调度时为 null。 */
  nextDelayMs(): number | null;
}

/** 可注入延迟与 run 的小型常驻调度器，便于用真实短定时器做冒烟测试。 */
export function createScheduler(options: CreateSchedulerOptions): Scheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingDelayMs: number | null = null;

  function scheduleNext(delayMs: number): void {
    pendingDelayMs = delayMs;
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  }

  async function tick(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const result = await options.run();
      console.log(JSON.stringify({ at, status: "ok", ...result }));
      scheduleNext(options.runIntervalMs);
    } catch (error: unknown) {
      // 失败只给稳定类别；连接串/密钥值/原始 stderr 不回显。
      const message = error instanceof Error ? error.message : "BACKUP_FAILED";
      console.error(JSON.stringify({ at, status: "failed", message }));
      scheduleNext(options.retryIntervalMs);
    }
  }

  return {
    start(): void {
      scheduleNext(options.firstDelayMs);
    },
    stop(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingDelayMs = null;
    },
    nextDelayMs(): number | null {
      return pendingDelayMs;
    },
  };
}

// 生产入口：仅当作为脚本直接运行（pnpm tsx scripts/backup/schedule.ts）时启动；
// 被测试 import 时不启动，避免测试进程被一个 10s 定时器挂住。
if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  createScheduler({
    firstDelayMs: FIRST_RUN_DELAY_MS,
    runIntervalMs: RUN_INTERVAL_MS,
    retryIntervalMs: RETRY_INTERVAL_MS,
    run: runBackupOnce,
  }).start();
}
