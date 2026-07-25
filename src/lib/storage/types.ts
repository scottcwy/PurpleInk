/** 二进制产物存储适配器。Demo 用本地 FS；未来可换 S3 / COS / MinIO。 */
export interface StorageAdapter {
  /** 写入内容，返回存储键（相对路径）。 */
  put(key: string, data: Buffer | Uint8Array | string): Promise<string>
  /** 读取内容。 */
  get(key: string): Promise<Buffer>
  /** 是否存在。 */
  exists(key: string): Promise<boolean>
  /** 解析为本机绝对路径（供 ffmpeg / 下载等使用）。 */
  localPath(key: string): string
  /** 删除。 */
  delete(key: string): Promise<void>
  /** 创建隔离临时工作目录，返回本机绝对路径；调用方负责后续 removeTempDir 清理。 */
  tempDir(prefix: string): Promise<string>
  /** 从本机绝对路径读取文件内容（区别于 get()：get() 按 storage key 读，本方法按绝对路径读）。 */
  readLocalFile(absolutePath: string): Promise<Buffer>
  /** 递归删除临时工作目录。 */
  removeTempDir(absolutePath: string): Promise<void>
}
