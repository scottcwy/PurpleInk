// 临时：只 buildModel + writeProject（不渲染），用于快速跑 hyperframes check。
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "../src/lib/load-env.ts"
import { buildVideoModel } from "../src/compose/model.ts"
import { writeProject } from "../src/compose/project.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")

async function main(): Promise<void> {
  await loadEnv(join(SERVER_ROOT, ".env"))
  const captureDir = process.argv[2]
  const durationSec = Number(process.argv[3] || 30)
  if (!captureDir) {
    console.error("用法：npx tsx scripts/gen-only.ts <captureDir> [duration]")
    process.exit(2)
  }
  const model = await buildVideoModel(captureDir, { durationSec })
  const projectDir = join(captureDir, "..", `${model.id}-genonly`)
  const w = await writeProject(model, projectDir, captureDir)
  console.log("skin:", model.skin.id, "(" + model.skin.motion.transition + ", minShot " + model.skin.minShot + ")")
  console.log("scenes:", model.scenes.map((s) => `${s.kind}@${s.start}(${s.duration}s)`).join("  "))
  console.log("count:", model.scenes.length, "durationSec:", model.durationSec)
  console.log("projectDir:", w.projectDir)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
