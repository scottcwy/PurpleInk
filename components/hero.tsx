"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { ArrowRight, ArrowDown, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FluidCursor } from "./fluid-cursor";

export function Hero(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showPreparing, setShowPreparing] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const { scrollY, scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const scaleYRaw = useTransform(scrollYProgress, [0.0, 0.5], [1, 0]);
  const scaleY = useSpring(scaleYRaw, { stiffness: 100, damping: 30 });

  const y = useTransform(scrollY, (value) => value * 0.7);

  useEffect(() => {
    if (!isLaunching) return;

    const labelTimer = window.setTimeout(() => setShowPreparing(true), 180);
    const resetTimer = window.setTimeout(() => {
      setIsLaunching(false);
      setShowPreparing(false);
    }, 1600);

    return () => {
      window.clearTimeout(labelTimer);
      window.clearTimeout(resetTimer);
    };
  }, [isLaunching]);

  const handleLaunchClick = () => {
    if (isLaunching) return;
    setIsLaunching(true);
  };

  return (
    <section ref={sectionRef} className="relative min-h-dvh w-full">
      <FluidCursor className="absolute inset-0 -z-5" />

      <motion.div
        className="pointer-events-none absolute inset-0 -z-10 origin-top scale-125 will-change-transform"
        style={{ scaleY, y }}
        aria-hidden="true"
      >
        <Image
          src="/svg/gradient-fade.svg"
          alt=""
          fill
          className="object-cover object-top dark:-scale-y-100"
          priority
        />
        <div className="from-background absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t to-transparent" />
      </motion.div>

      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col items-start justify-center gap-6 px-4 py-20 sm:justify-start sm:gap-0 sm:py-0 sm:pt-40 lg:px-8 lg:pt-68">
        <motion.h1
          className="text-4xl font-medium tracking-tight text-white mix-blend-difference sm:text-5xl md:text-6xl lg:text-7xl"
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <span className="block">Launch your products</span>
          <span className="block">with Purple Ink</span>
        </motion.h1>

        <motion.div
          className="w-full sm:mt-12 lg:mt-16"
          initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: 0.6,
            delay: 0.15,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        >
          <div className="relative w-full max-w-sm sm:w-fit sm:max-w-none">
            <AnimatePresence>
              {isLaunching && !prefersReducedMotion && (
                <motion.span
                  key="launch-border-ring"
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-1 rounded-full"
                  style={{ boxShadow: "var(--shadow-launch-ring)" }}
                  initial={{ scale: 0.985, opacity: 0 }}
                  animate={{
                    scale: [0.985, 1.012, 1.035],
                    opacity: [0, 0.82, 0],
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
            </AnimatePresence>

            <motion.button
              type="button"
              onClick={handleLaunchClick}
              disabled={isLaunching}
              aria-busy={isLaunching}
              className="focus-ring group bg-background text-foreground relative isolate inline-flex h-16 w-full max-w-sm items-center justify-between overflow-hidden rounded-full py-2 pr-2 pl-7 text-base font-medium shadow-[var(--shadow-launch-cta)] sm:w-auto sm:min-w-88"
              whileHover={{ y: isLaunching ? 0 : -2 }}
              whileTap={{ scale: 0.98, y: 1 }}
              transition={{
                type: "spring",
                stiffness: 520,
                damping: 32,
              }}
            >
              <AnimatePresence initial={false}>
                {isLaunching && (
                  <motion.span
                    key="purple-ink"
                    aria-hidden="true"
                    className="bg-brand-launch-ink absolute top-2 right-2 z-0 h-12 w-12 rounded-full"
                    initial={{ opacity: 1, scale: 1 }}
                    animate={
                      prefersReducedMotion
                        ? { opacity: 1, scale: 15 }
                        : { opacity: 1, scale: [1, 1, 15] }
                    }
                    exit={{ opacity: 0 }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : {
                            scale: {
                              duration: 0.68,
                              times: [0, 0.18, 1],
                              ease: [0.4, 0, 0.2, 1],
                            },
                            opacity: { duration: 0.18 },
                          }
                    }
                  />
                )}
              </AnimatePresence>

              <span
                className={`relative z-10 whitespace-nowrap transition-colors duration-200 ${
                  showPreparing ? "text-white" : "text-foreground"
                }`}
              >
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={showPreparing ? "preparing" : "create"}
                    className="block"
                    initial={
                      prefersReducedMotion ? false : { opacity: 0, y: 5 }
                    }
                    animate={{ opacity: 1, y: 0 }}
                    {...(prefersReducedMotion
                      ? {}
                      : { exit: { opacity: 0, y: -5 } })}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
                  >
                    {showPreparing
                      ? "Preparing your Launch..."
                      : "创建你的首个Launch Video"}
                  </motion.span>
                </AnimatePresence>
              </span>

              <motion.span
                className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                animate={{
                  backgroundColor: showPreparing
                    ? "var(--overlay-white-16)"
                    : isLaunching
                      ? "var(--brand-launch-ink)"
                      : "var(--foreground)",
                  color: isLaunching ? "var(--pi-white)" : "var(--background)",
                }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              >
                <AnimatePresence initial={false} mode="wait">
                  {showPreparing ? (
                    <motion.span
                      key="loading"
                      className="flex"
                      initial={
                        prefersReducedMotion
                          ? false
                          : { opacity: 0, scale: 0.8 }
                      }
                      animate={
                        prefersReducedMotion
                          ? { opacity: 1 }
                          : { opacity: 1, scale: 1, rotate: 360 }
                      }
                      {...(prefersReducedMotion
                        ? {}
                        : { exit: { opacity: 0, scale: 0.8 } })}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : {
                              opacity: { duration: 0.16 },
                              scale: { duration: 0.16 },
                              rotate: {
                                duration: 0.8,
                                ease: "linear",
                                repeat: Infinity,
                              },
                            }
                      }
                    >
                      <LoaderCircle className="h-5 w-5" />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="arrow"
                      className="flex transition-transform duration-200 group-hover:translate-x-0.5"
                      initial={
                        prefersReducedMotion ? false : { opacity: 0, x: -3 }
                      }
                      animate={{ opacity: 1, x: 0 }}
                      {...(prefersReducedMotion
                        ? {}
                        : { exit: { opacity: 0, x: 4 } })}
                      transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
                    >
                      <ArrowRight className="h-5 w-5" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.span>
            </motion.button>
          </div>
        </motion.div>
      </div>

      <motion.div
        className="absolute inset-x-0 bottom-24 mx-auto flex max-w-4xl items-center justify-between px-4 sm:px-6 lg:px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.5,
          delay: 0.4,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        <p className="text-foreground/60 dark:text-foreground/50 max-w-sm text-sm">
          PurpleInk turns verified product flows into reviewable, repeatable
          launch videos.
        </p>

        <ArrowDown
          className="text-foreground/60 dark:text-foreground/50 h-12 w-12"
          strokeWidth={1}
        />
      </motion.div>
    </section>
  );
}
