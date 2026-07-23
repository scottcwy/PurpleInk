// 把 VideoModel 写成一个可渲染的 HyperFrames 项目目录：
// <projectDir>/{index.html, hyperframes.json, meta.json, package.json, assets/*}
// assets 从源 capture/assets 拷入。
import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { renderIndexHtml } from "./template"
import type { VideoModel } from "./model"

const HF_VERSION = "0.7.68"

const HYPERFRAMES_JSON = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  media: { autoProxy: true },
}

function packageJson(name: string): string {
  const pkg = {
    name: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "purpleink-video",
    private: true,
    type: "module",
    scripts: {
      dev: `npx --yes hyperframes@${HF_VERSION} preview`,
      check: `npx --yes hyperframes@${HF_VERSION} check`,
      render: `npx --yes hyperframes@${HF_VERSION} render`,
    },
  }
  return JSON.stringify(pkg, null, 2) + "\n"
}

/** 把 capture/assets 下的图片拷进项目 assets/ */
async function copyAssets(srcAssetsDir: string, destAssetsDir: string): Promise<number> {
  await mkdir(destAssetsDir, { recursive: true })
  let count = 0
  let files: string[] = []
  try {
    files = await readdir(srcAssetsDir)
  } catch {
    return 0
  }
  for (const f of files) {
    if (!/\.(png|jpe?g|webp|mp4)$/i.test(f)) continue
    await copyFile(join(srcAssetsDir, f), join(destAssetsDir, f))
    count++
  }
  return count
}

export interface WriteProjectResult {
  projectDir: string
  indexHtml: string
  assetCount: number
}

/**
 * 写出 HyperFrames 项目目录。
 * @param model    视频模型
 * @param projectDir 目标项目目录（会被创建）
 * @param captureDir 源 capture/ 目录（用于拷 assets）
 */
export async function writeProject(
  model: VideoModel,
  projectDir: string,
  captureDir: string
): Promise<WriteProjectResult> {
  await mkdir(projectDir, { recursive: true })

  const html = renderIndexHtml(model)
  await writeFile(join(projectDir, "index.html"), html, "utf8")
  await writeFile(join(projectDir, "hyperframes.json"), JSON.stringify(HYPERFRAMES_JSON, null, 2) + "\n", "utf8")
  await writeFile(
    join(projectDir, "meta.json"),
    JSON.stringify({ id: model.id, name: model.name, createdAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  )
  await writeFile(join(projectDir, "package.json"), packageJson(model.name), "utf8")

  const assetCount = await copyAssets(join(captureDir, "assets"), join(projectDir, "assets"))

  return { projectDir, indexHtml: html, assetCount }
}
