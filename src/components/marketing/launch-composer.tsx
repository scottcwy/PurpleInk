"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, LoaderCircle, Check, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  startRender,
  pollUntilDone,
  downloadVideo,
  type JobView,
  type JobPhase,
} from "@/lib/api";
import {
  LoginRequiredDialog,
  useRequireLogin,
} from "@/features/auth/login-required-dialog";
import {
  ActionCircle,
  Chip,
  DURATION_OPTS,
  fmtElapsed,
  firstLine,
  friendlyError,
  PHASE_BAND,
  PHASE_LABEL,
  PILL_BASE,
  QUALITY_OPTS,
  safeHost,
  type Quality,
  type Stage,
} from "./launch-composer-support";

export function LaunchComposer(): ReactNode {
  const [stage, setStage] = useState<Stage>("idle");
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<JobPhase>("queued");
  const [message, setMessage] = useState("");
  const [quality, setQuality] = useState<Quality>("standard");
  const [duration, setDuration] = useState(24);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const prefersReducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const phaseRef = useRef<JobPhase>("queued");
  const phaseStartRef = useRef(0);
  // 落地页 AI 演示也要求登录（产品决策，PLAN-002 §4.4 第 4 点）：只在 Next 侧
  // 客户端加门，worker 与 /api/engine/* 代理行为不变。
  const { loginRequired, closeLoginDialog, ensureLoggedIn } = useRequireLogin();

  // 运行中：本地定时器驱动进度爬升 + 已用时长（不依赖后端在途返回耗时）
  useEffect(() => {
    if (stage !== "running") return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsed(Math.floor((now - startRef.current) / 1000));
      const [lo, hi, tau] = PHASE_BAND[phaseRef.current];
      const t = (now - phaseStartRef.current) / 1000;
      const p = lo + (hi - lo) * (1 - Math.exp(-t / tau));
      setProgress((prev) => Math.max(prev, Math.min(hi, p)));
    }, 250);
    return () => clearInterval(id);
  }, [stage]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage("idle");
    setUrl("");
    setMessage("");
  }, []);

  const openInput = useCallback(() => {
    setStage("input");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const run = useCallback(async () => {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setMessage("请输入以 http(s):// 开头的网址");
      inputRef.current?.focus();
      return;
    }
    // 未登录先弹登录引导并中止，不消耗渲染算力。
    if (!(await ensureLoggedIn())) return;

    const now = Date.now();
    startRef.current = now;
    phaseStartRef.current = now;
    phaseRef.current = "queued";
    setProgress(0);
    setElapsed(0);
    setStage("running");
    setPhase("queued");
    setMessage("");
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const { jobId } = await startRender({ url: target, duration, quality });
      const job: JobView = await pollUntilDone(
        jobId,
        (j) => {
          if (j.phase !== phaseRef.current) {
            phaseRef.current = j.phase;
            phaseStartRef.current = Date.now();
            setPhase(j.phase);
          }
        },
        1500,
        ac.signal,
      );

      if (job.status === "failed" || !job.hasVideo) {
        setStage("error");
        setMessage(job.error ? firstLine(job.error) : "渲染失败，请查看后端日志");
        return;
      }

      setProgress(100);
      const host = safeHost(target);
      await downloadVideo(job.id, `purpleink-${host}.mp4`);
      setStage("done");
      const checkWarn = job.checkPassed === false ? "（check 有告警）" : "";
      const goldenOk = job.goldenVerified ? " · 金样本校验通过" : "";
      setMessage(`已生成${checkWarn}${goldenOk}，正在下载`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setStage("error");
      setMessage(friendlyError(err));
    }
  }, [url, duration, quality, ensureLoggedIn]);

  // exactOptionalPropertyTypes: 用条件展开而非传 undefined
  const interactive = prefersReducedMotion
    ? {}
    : { whileHover: { y: -2 }, whileTap: { scale: 0.98, y: 1 } };

  const enter = prefersReducedMotion
    ? { initial: false as const, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  const accessory = prefersReducedMotion
    ? { initial: false as const, animate: { opacity: 1, height: "auto" as const } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" as const },
        exit: { opacity: 0, height: 0 },
      };

  const spin = prefersReducedMotion
    ? {}
    : {
        animate: { rotate: 360 },
        transition: { duration: 0.8, ease: "linear" as const, repeat: Infinity },
      };

  return (
    <div className="flex w-full max-w-md flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {/* 待机：沿用原按钮 */}
        {stage === "idle" && (
          <motion.button
            key="idle"
            type="button"
            onClick={openInput}
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-base font-medium sm:w-auto sm:min-w-88`}
            {...interactive}
            {...enter}
          >
            <span className="relative z-10 whitespace-nowrap">
              创建你的首个 Launch Video
            </span>
            <ActionCircle>
              <span className="flex transition-transform duration-200 group-hover:translate-x-0.5">
                <ArrowRight className="h-5 w-5" />
              </span>
            </ActionCircle>
          </motion.button>
        )}

        {/* 输入：展开 URL 输入框 */}
        {stage === "input" && (
          <motion.form
            key="input"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
            className={`${PILL_BASE} py-2 pr-2 pl-6`}
            {...enter}
          >
            <input
              ref={inputRef}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (message) setMessage("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") reset();
              }}
              type="url"
              inputMode="url"
              placeholder="粘贴产品网址，例如 https://ui.shadcn.com"
              className="no-focus-ring text-foreground placeholder:text-muted-foreground relative z-10 h-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium focus:outline-none"
              aria-label="产品网址"
            />
            <button
              type="submit"
              aria-label="开始生成"
              className="focus-ring rounded-full"
            >
              <ActionCircle>
                <ArrowRight className="h-5 w-5" />
              </ActionCircle>
            </button>
          </motion.form>
        )}

        {/* 运行中：阶段文字 + 旋转 */}
        {stage === "running" && (
          <motion.div
            key="running"
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-base font-medium`}
            {...enter}
            aria-live="polite"
          >
            <span className="relative z-10 whitespace-nowrap">
              {PHASE_LABEL[phase]}
            </span>
            <ActionCircle active>
              <motion.span className="flex" {...spin}>
                <LoaderCircle className="h-5 w-5" />
              </motion.span>
            </ActionCircle>
          </motion.div>
        )}

        {/* 完成：已下载 */}
        {stage === "done" && (
          <motion.button
            key="done"
            type="button"
            onClick={openInput}
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-base font-medium`}
            {...interactive}
            {...enter}
          >
            <span className="relative z-10 whitespace-nowrap">
              {message || "已生成，正在下载"}
            </span>
            <ActionCircle active>
              <Check className="h-5 w-5" />
            </ActionCircle>
          </motion.button>
        )}

        {/* 失败：可重试 */}
        {stage === "error" && (
          <motion.button
            key="error"
            type="button"
            onClick={openInput}
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-sm font-medium`}
            {...interactive}
            {...enter}
          >
            <span className="text-muted-foreground relative z-10 line-clamp-2 pr-3 text-left">
              {message || "生成失败，点此重试"}
            </span>
            <ActionCircle>
              <RotateCcw className="h-5 w-5" />
            </ActionCircle>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 附属区：输入时显示质量/时长；运行时显示进度条 */}
      <AnimatePresence initial={false}>
        {stage === "input" && (
          <motion.div
            key="settings"
            className="overflow-hidden"
            {...accessory}
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 pt-4">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground mr-0.5 text-xs">质量</span>
                {QUALITY_OPTS.map((o) => (
                  <Chip
                    key={o.value}
                    active={quality === o.value}
                    onClick={() => setQuality(o.value)}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground mr-0.5 text-xs">时长</span>
                {DURATION_OPTS.map((d) => (
                  <Chip
                    key={d}
                    active={duration === d}
                    onClick={() => setDuration(d)}
                  >
                    {d}s
                  </Chip>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {stage === "running" && (
          <motion.div
            key="progress"
            className="overflow-hidden"
            {...accessory}
          >
            <div className="px-2 pt-4">
              <div
                className="bg-foreground/10 h-1.5 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: "#352e82" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "easeOut", duration: 0.4 }}
                />
              </div>
              <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                <span>已用 {fmtElapsed(elapsed)} · {Math.round(progress)}%</span>
                <span>通常约 3–7 分钟</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <LoginRequiredDialog open={loginRequired} onClose={closeLoginDialog} />
    </div>
  );
}
