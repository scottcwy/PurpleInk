// 把 VideoModel 写成一个可渲染的 HyperFrames 项目目录：
// <projectDir>/{index.html, hyperframes.json, meta.json, package.json, assets/*}
// assets 从源 capture/assets 拷入。
import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import { renderIndexHtml } from "./template"
import type { VideoModel } from "./model"
import type { ChapterHtml } from "./chapters/types"

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

/**
 * ② 去白边：把一张截图智能裁到「内容包围盒」再写入项目 assets/。
 *   用 sharp.trim() 去掉四周与角色像素同色的留白，随后配合模板 object-fit:cover
 *   即可焦点填满 16:9，避免 pan 进空白。任何失败(格式/无内容)都优雅回退到原图拷贝。
 *   注：只处理位图；mp4 不能 trim，直接拷贝。
 */
async function trimOrCopy(srcPath: string, destPath: string): Promise<void> {
  if (/\.mp4$/i.test(srcPath)) {
    await copyFile(srcPath, destPath)
    return
  }
  try {
    // threshold 越大越激进；用 sharp 探测边缘同色并裁掉。保留 alpha，输出保持原扩展名。
    const out = await sharp(srcPath)
      .trim({ threshold: 18 })
      .toBuffer()
    // 裁完若几乎为空(sharp 会返回极小图)则视作无效，回退原图
    const meta = await sharp(out).metadata()
    if ((meta.width ?? 0) >= 64 && (meta.height ?? 0) >= 64) {
      await writeFile(destPath, out)
      return
    }
  } catch {
    // sharp 不可用 / 无可裁边界 / 解码失败 —— 回退到原图
  }
  await copyFile(srcPath, destPath)
}

/** 把 capture/assets 下的图片拷进项目 assets/（位图先去白边裁到内容包围盒） */
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
    await trimOrCopy(join(srcAssetsDir, f), join(destAssetsDir, f))
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

/**
 * Write a multi-file chapter-based HyperFrames project directory.
 *
 * Layout:
 *   <dir>/
 *     index.html              (root composition referencing chapters)
 *     hyperframes.json
 *     meta.json
 *     package.json
 *     compositions/
 *       ch1-opening.html
 *       ch2-hero.html
 *       ch3-showcase.html
 *       ch4-proof.html
 *       ch5-cta.html
 *     assets/                 (screenshots copied from captureDir)
 *
 * @param dir         Target project directory (will be created)
 * @param rootHtml    The root index.html content
 * @param chapters    Array of rendered chapter HTML objects
 * @param captureDir  Source capture/ directory for copying assets
 */
export async function writeProjectDirect(
  dir: string,
  rootHtml: string,
  chapters: ChapterHtml[],
  captureDir: string,
): Promise<{ projectDir: string; assetCount: number }> {
  await mkdir(dir, { recursive: true })

  // Write root index.html
  await writeFile(join(dir, "index.html"), rootHtml, "utf8")

  // Write hyperframes.json, meta.json, package.json
  await writeFile(join(dir, "hyperframes.json"), JSON.stringify(HYPERFRAMES_JSON, null, 2) + "\n", "utf8")
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), chapters: chapters.map((c) => ({ id: c.id, source: c.source })) }, null, 2) + "\n",
    "utf8"
  )
  await writeFile(join(dir, "package.json"), packageJson("purpleink-chapters"), "utf8")

  // Write chapter HTML files to compositions/
  const compositionsDir = join(dir, "compositions")
  await mkdir(compositionsDir, { recursive: true })
  for (const ch of chapters) {
    await writeFile(join(compositionsDir, `${ch.id}.html`), ch.html, "utf8")
  }

  // Copy assets from capture directory
  const assetCount = await copyAssets(join(captureDir, "assets"), join(dir, "assets"))

  return { projectDir: dir, assetCount }
}
