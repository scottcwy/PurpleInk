/**
 * PostgreSQL 备份对象的命名与轮转（纯函数，被 run-backup.ts 消费）。
 *
 * key 以 ISO 时间戳开头（冒号/点替换为连字符），字典序即时间序，
 * 轮转不需要读对象元数据，按 key 排序即可判定新旧。
 */

export interface BackupKeyInput {
  /** 对象前缀，如 backups/postgres/；结尾斜杠可省略。 */
  prefix: string;
  /** 数据库名，只用于人眼辨识；净化到 [a-z0-9-]。 */
  database: string;
  timestamp: Date;
}

export function backupObjectKey(input: BackupKeyInput): string {
  const prefix = input.prefix.endsWith("/") ? input.prefix : `${input.prefix}/`;
  const stamp = input.timestamp.toISOString().replaceAll(/[:.]/gu, "-");
  const database =
    input.database
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+/u, "") || "postgres";
  return `${prefix}${stamp}-${database}.dump`;
}

/**
 * 返回超出保留份数的旧备份 key（待删除），最新的 retain 份保留。
 * retain 必须是正整数——0 或非法值直接拒绝，防止一次配置错误清空全部备份。
 */
export function selectExpiredKeys(keys: string[], retain: number): string[] {
  if (!Number.isInteger(retain) || retain < 1) {
    throw new Error(`retain 必须是正整数，收到: ${retain}`);
  }
  return [...keys].sort().reverse().slice(retain);
}
