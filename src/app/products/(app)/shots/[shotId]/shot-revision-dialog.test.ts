import { describe, expect, it } from 'vitest'
import { SHOT_REVISION_BRIEF_MAX_LENGTH } from '@/features/canvas/contracts'
import { isValidShotRevisionBrief } from './shot-revision-dialog'

describe('isValidShotRevisionBrief', () => {
  it('accepts a trimmed brief inside the shared 1-200 character contract', () => {
    expect(isValidShotRevisionBrief('主视觉改成俯视构图')).toBe(true)
    expect(isValidShotRevisionBrief(` ${'改'.repeat(SHOT_REVISION_BRIEF_MAX_LENGTH)} `)).toBe(true)
  })

  it('rejects blank or oversized briefs', () => {
    expect(isValidShotRevisionBrief('   ')).toBe(false)
    expect(isValidShotRevisionBrief('改'.repeat(SHOT_REVISION_BRIEF_MAX_LENGTH + 1))).toBe(false)
  })
})
