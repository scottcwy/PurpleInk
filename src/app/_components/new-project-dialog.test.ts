import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  'src/app/_components/new-project-dialog.tsx',
  'utf8',
)

describe('NewProjectDialog form ownership', () => {
  it('uses a per-instance form id so multiple dialogs cannot submit a hidden sibling', () => {
    expect(source).toContain('useId')
    expect(source).toContain('form={formId}')
    expect(source).toContain('id={formId}')
    expect(source).not.toContain('form="new-project-form"')
    expect(source).not.toContain('id="new-project-form"')
  })
})
