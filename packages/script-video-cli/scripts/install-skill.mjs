import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(packageRoot, 'skills', 'generating-purpleink-script-videos')
const skillsRoot = resolve(process.env.USERPROFILE?.trim() || homedir(), '.agents', 'skills')
const destination = join(skillsRoot, 'generating-purpleink-script-videos')
const temporary = `${destination}.installing-${process.pid}`
const backup = `${destination}.backup-${process.pid}`

await mkdir(skillsRoot, { recursive: true })
await rm(temporary, { recursive: true, force: true })
await cp(source, temporary, { recursive: true, force: false })
let backedUp = false
try {
  await rename(destination, backup)
  backedUp = true
} catch (error) {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
}
try {
  await rename(temporary, destination)
  if (backedUp) await rm(backup, { recursive: true, force: true })
} catch (error) {
  await rm(temporary, { recursive: true, force: true })
  if (backedUp) await rename(backup, destination).catch(() => undefined)
  throw error
}
console.log(destination)
