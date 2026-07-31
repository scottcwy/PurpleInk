import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface MigrationJournal {
  entries: Array<{
    idx: number
    when: number
    tag: string
  }>
}

const migrationDirectory = new URL('./migrations/pg/', import.meta.url)
const journal = JSON.parse(
  readFileSync(new URL('meta/_journal.json', migrationDirectory), 'utf8')
) as MigrationJournal

describe('Postgres migration journal', () => {
  it('keeps indexes and timestamps strictly increasing', () => {
    for (const [index, entry] of journal.entries.entries()) {
      expect(entry.idx).toBe(index)
      if (index > 0) {
        expect(entry.when).toBeGreaterThan(journal.entries[index - 1]!.when)
      }
    }
  })

  it('registers every numbered SQL migration exactly once', () => {
    const files = readdirSync(migrationDirectory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort()
    const tags = journal.entries.map((entry) => entry.tag).sort()

    expect(tags).toEqual(files)
    expect(new Set(tags).size).toBe(tags.length)
  })
})
