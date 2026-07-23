// 极简 .env 加载（不引依赖）。tsx 不自动读 .env，CLI/后端启动时手动调用。
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"

/** 从指定 .env 文件把键值注入 process.env（已存在的键不覆盖）。 */
export async function loadEnv(envPath: string): Promise<void> {
  if (!existsSync(envPath)) return
  const raw = await readFile(envPath, "utf8")
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    // 去掉可选的成对引号
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}
