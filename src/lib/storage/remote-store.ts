/** 预签名 GET 的响应头覆盖：上传时未存对象 content-type，取回时靠查询参数补。 */
export interface PresignGetOverrides {
  contentType?: string
  contentDisposition?: string
}

/**
 * 远端对象存储的最小接口。S3MirrorStorage 只依赖这几个操作，
 * 具体实现（R2 / Supabase Storage / MinIO 等 S3 兼容端）见 s3-remote-store.ts；
 * 单测注入内存假实现即可，不需要 mock AWS SDK。
 */
export interface RemoteObjectStore {
  /** 上传对象；失败必须抛错（写穿语义要求远端确认落盘）。 */
  putObject(key: string, data: Buffer): Promise<void>
  /** 读取对象；不存在时返回 null，其余错误抛出。 */
  getObject(key: string): Promise<Buffer | null>
  /** 存在性探测（S3 HeadObject），不下载字节。 */
  hasObject(key: string): Promise<boolean>
  /** 删除对象；对不存在的 key 幂等。 */
  deleteObject(key: string): Promise<void>
  /** 生成限时下载 URL（预签名 GET），可选覆盖响应头。 */
  presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignGetOverrides
  ): Promise<string>
}
