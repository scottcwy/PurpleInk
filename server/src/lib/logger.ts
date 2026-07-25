// 从 Firenze frameproof/src/lib/utils/logger.ts 原样拷贝
export const logger = {
  info: (event: string, data?: Record<string, unknown>) => {
    console.log(`[INFO] ${event}`, data ? JSON.stringify(data) : "")
  },
  error: (event: string, data?: Record<string, unknown>) => {
    console.error(`[ERROR] ${event}`, data ? JSON.stringify(data) : "")
  },
  warn: (event: string, data?: Record<string, unknown>) => {
    console.warn(`[WARN] ${event}`, data ? JSON.stringify(data) : "")
  },
}
