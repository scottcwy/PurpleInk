import path from 'node:path'

/**
 * 本地持久产物根目录。
 * 可用环境变量 DATA_DIR 覆盖；默认 <cwd>/.data。
 * 说明：模块加载只解析路径，不访问文件系统。
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), '.data')

/** 二进制产物目录（mp4 / 抽帧 / 音频 / html 等）。 */
export const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts')
