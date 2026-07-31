import { describe, expect, it } from 'vitest'
import {
  backupObjectKey,
  selectExpiredKeys,
} from '../scripts/backup/rotation'

describe('backupObjectKey', () => {
  it('生成按字典序可排序的时间戳 key，库名做字符净化', () => {
    const key = backupObjectKey({
      prefix: 'backups/postgres/',
      database: 'purple ink/店',
      timestamp: new Date('2026-07-31T08:30:05.123Z'),
    })
    // 冒号与点替换成连字符：R2 key 安全，且 ISO 前缀保证新旧可按字符串排序。
    expect(key).toBe('backups/postgres/2026-07-31T08-30-05-123Z-purple-ink-.dump')
  })

  it('库名净化后为空时回退 postgres', () => {
    const key = backupObjectKey({
      prefix: 'backups/postgres',
      database: '///',
      timestamp: new Date('2026-07-31T00:00:00.000Z'),
    })
    expect(key).toBe('backups/postgres/2026-07-31T00-00-00-000Z-postgres.dump')
  })
})

describe('selectExpiredKeys', () => {
  const keys = [
    'backups/postgres/2026-07-29T00-00-00-000Z-cvc.dump',
    'backups/postgres/2026-07-31T00-00-00-000Z-cvc.dump',
    'backups/postgres/2026-07-28T00-00-00-000Z-cvc.dump',
    'backups/postgres/2026-07-30T00-00-00-000Z-cvc.dump',
  ]

  it('保留最新 retain 份，返回应删除的旧 key（输入顺序无关）', () => {
    expect(selectExpiredKeys(keys, 2)).toEqual([
      'backups/postgres/2026-07-29T00-00-00-000Z-cvc.dump',
      'backups/postgres/2026-07-28T00-00-00-000Z-cvc.dump',
    ])
  })

  it('数量未超出 retain 时不删任何东西', () => {
    expect(selectExpiredKeys(keys, 4)).toEqual([])
    expect(selectExpiredKeys([], 3)).toEqual([])
  })

  it('retain 必须是正整数，否则拒绝执行（防止误删全部备份）', () => {
    expect(() => selectExpiredKeys(keys, 0)).toThrow()
    expect(() => selectExpiredKeys(keys, -1)).toThrow()
    expect(() => selectExpiredKeys(keys, 1.5)).toThrow()
  })
})
