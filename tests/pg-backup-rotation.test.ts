import { describe, expect, it } from "vitest";

import {
  backupObjectKey,
  selectExpiredKeys,
} from "../scripts/backup/rotation";

describe("backupObjectKey", () => {
  it("generates a deterministic ISO-sortable key at a fixed time", () => {
    const key = backupObjectKey({
      prefix: "backups/postgres/",
      database: "purple ink/店",
      timestamp: new Date("2026-07-31T08:30:05.123Z"),
    });
    // 冒号/点替换为连字符：R2 key 安全，且 ISO 前缀保证新旧可按字符串排序。
    expect(key).toBe(
      "backups/postgres/2026-07-31T08-30-05-123Z-purple-ink-.dump"
    );
  });

  it("normalizes a missing trailing slash on the prefix", () => {
    const key = backupObjectKey({
      prefix: "backups/postgres",
      database: "cvc",
      timestamp: new Date("2026-07-31T00:00:00.000Z"),
    });
    expect(key).toBe("backups/postgres/2026-07-31T00-00-00-000Z-cvc.dump");
  });

  it("sanitizes the database name and falls back to postgres when empty", () => {
    const key = backupObjectKey({
      prefix: "backups/postgres/",
      database: "///",
      timestamp: new Date("2026-07-31T00:00:00.000Z"),
    });
    expect(key).toBe("backups/postgres/2026-07-31T00-00-00-000Z-postgres.dump");
  });
});

describe("selectExpiredKeys", () => {
  const keys = [
    "backups/postgres/2026-07-29T00-00-00-000Z-cvc.dump",
    "backups/postgres/2026-07-31T00-00-00-000Z-cvc.dump",
    "backups/postgres/2026-07-28T00-00-00-000Z-cvc.dump",
    "backups/postgres/2026-07-30T00-00-00-000Z-cvc.dump",
  ];

  it("keeps the newest retain keys and returns the stale ones regardless of input order", () => {
    expect(selectExpiredKeys(keys, 2)).toEqual([
      "backups/postgres/2026-07-29T00-00-00-000Z-cvc.dump",
      "backups/postgres/2026-07-28T00-00-00-000Z-cvc.dump",
    ]);
  });

  it("deletes nothing when the count does not exceed retain", () => {
    expect(selectExpiredKeys(keys, 4)).toEqual([]);
    expect(selectExpiredKeys([], 3)).toEqual([]);
  });

  it("rejects non-positive, NaN, and non-integer retain values", () => {
    expect(() => selectExpiredKeys(keys, 0)).toThrow();
    expect(() => selectExpiredKeys(keys, -1)).toThrow();
    expect(() => selectExpiredKeys(keys, Number.NaN)).toThrow();
    expect(() => selectExpiredKeys(keys, 1.5)).toThrow();
  });
});
