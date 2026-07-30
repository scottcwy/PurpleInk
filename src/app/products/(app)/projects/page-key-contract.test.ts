import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(
  'src/app/products/(app)/projects/page.tsx',
  'utf8',
)

describe('ProjectsPage action identity', () => {
  it('keys the server-created top-bar action before client composition', () => {
    expect(pageSource).toMatch(
      /newProjectAction=\{[\s\S]*?<NewProjectDialog(?=[^>]*\bkey=["']top-bar-new-project["'])(?=[^>]*\btriggerSize=["']sm["'])[^>]*\/>\s*\}/,
    )
  })
})
