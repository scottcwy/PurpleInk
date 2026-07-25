import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

import ts from "typescript"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sideEffects = vi.hoisted(() => ({
  database: {
    drizzle: vi.fn(),
    postgres: vi.fn(),
    sqlite: vi.fn(),
  },
  fileSystem: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("postgres", () => ({ default: sideEffects.database.postgres }))
vi.mock("better-sqlite3", () => ({ default: sideEffects.database.sqlite }))
vi.mock("drizzle-orm/postgres-js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  drizzle: sideEffects.database.drizzle,
}))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return createTrackedFileSystem(actual, false)
})
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return createTrackedFileSystem(actual, true)
})

const LEGACY_MIGRATION_FILES = [
  "src/lib/db/migrations/0000_gray_captain_cross.sql",
  "src/lib/db/migrations/0001_friendly_calypso.sql",
  "src/lib/db/migrations/0002_solid_prism.sql",
  "src/lib/db/migrations/0003_wild_black_tarantula.sql",
  "src/lib/db/migrations/meta/_journal.json",
  "src/lib/db/migrations/meta/0000_snapshot.json",
  "src/lib/db/migrations/meta/0001_snapshot.json",
  "src/lib/db/migrations/meta/0002_snapshot.json",
  "src/lib/db/migrations/meta/0003_snapshot.json",
] as const

const IMPORT_SAFE_ENTRIES = [
  "@/instrumentation",
  "@/lib/db/client",
  "@/lib/queue/init",
  "@/lib/storage",
] as const

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface ModuleReference {
  file: string
  specifier: string
}

function trackedFiles(...roots: string[]): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...roots], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  return output
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .filter((file) => existsSync(file))
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}

function readRepoFile(file: string): string {
  return readFileSync(file, "utf8")
}

function isTypeScript(file: string): boolean {
  return /\.(?:ts|tsx)$/.test(file)
}

function isRuntimeSource(file: string): boolean {
  return (
    isTypeScript(file) &&
    !file.startsWith("src/lib/migration/") &&
    !/\.(?:test|spec|demo)\.(?:ts|tsx)$/.test(file)
  )
}

function moduleSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readRepoFile(file),
    ts.ScriptTarget.Latest,
    true,
  )
  const specifiers: string[] = []

  function visit(node: ts.Node): void {
    const direct = directModuleSpecifier(node)
    if (direct) specifiers.push(direct)
    const called = calledModuleSpecifier(node)
    if (called) specifiers.push(called)
    ts.forEachChild(node, visit)
  }

  visit(source)
  return specifiers
}

function directModuleSpecifier(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text
  }
  return undefined
}

function calledModuleSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined
  const [argument] = node.arguments
  if (!argument || !ts.isStringLiteral(argument)) return undefined
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
  const isRequire =
    ts.isIdentifier(node.expression) && node.expression.text === "require"
  return isDynamicImport || isRequire ? argument.text : undefined
}

function collectModuleReferences(files: string[]): ModuleReference[] {
  return files.flatMap((file) =>
    moduleSpecifiers(file).map((specifier) => ({ file, specifier })),
  )
}

const MUTATING_FILE_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "mkdir",
  "mkdirSync",
  "open",
  "openSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "writeFile",
  "writeFileSync",
])

function createTrackedFileSystem(
  actual: Record<string, unknown>,
  asynchronousNoop: boolean,
) {
  const wrapped = wrapFileSystemMethods(actual, asynchronousNoop)
  const defaultExport = actual.default
  if (typeof defaultExport === "object" && defaultExport !== null) {
    wrapped.default = wrapFileSystemMethods(
      defaultExport as Record<string, unknown>,
      asynchronousNoop,
    )
  }
  return wrapped
}

function wrapFileSystemMethods(
  actual: Record<string, unknown>,
  asynchronousNoop: boolean,
) {
  const wrapped = { ...actual }
  for (const name of Object.keys(actual)) {
    const original = actual[name]
    if (typeof original !== "function") continue
    wrapped[name] = (...args: unknown[]) => {
      sideEffects.fileSystem(name)
      if (MUTATING_FILE_METHODS.has(name)) {
        return asynchronousNoop ? Promise.resolve(undefined) : undefined
      }
      return Reflect.apply(original, actual, args)
    }
  }
  return wrapped
}

const sourceFiles = trackedFiles("src").filter(isTypeScript)
const references = collectModuleReferences(sourceFiles)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe("SQLite runtime boundary", () => {
  it("keeps better-sqlite3 imports inside migration tooling", () => {
    const offenders = references.filter(
      ({ file, specifier }) =>
        specifier === "better-sqlite3" &&
        !file.startsWith("src/lib/migration/"),
    )
    expect(offenders).toEqual([])
  })

  it("has no sqlite-core imports in tracked source", () => {
    const offenders = references.filter(
      ({ specifier }) => specifier.startsWith("drizzle-orm/sqlite-core"),
    )
    expect(offenders).toEqual([])
  })

  it("removes runtime SQLite path and legacy migration references", () => {
    const forbidden = /\bDB_PATH\b|\.data[\\/]app\.db|\bapp\.db\b/
    const offenders = sourceFiles
      .filter(isRuntimeSource)
      .filter((file) => forbidden.test(readRepoFile(file)))
    const tracked = new Set(trackedFiles("src"))
    const legacyFiles = LEGACY_MIGRATION_FILES.filter((file) =>
      tracked.has(file),
    )
    expect(offenders).toEqual([])
    expect(legacyFiles).toEqual([])
  })
})

describe("runtime dependency and startup boundary", () => {
  it("keeps SQLite driver and types migration-only with ordinary openai", () => {
    const manifest = JSON.parse(readRepoFile("package.json")) as PackageManifest
    const lockfile = readRepoFile("pnpm-lock.yaml")
    const allImports = collectModuleReferences(
      trackedFiles("src", "trigger").filter(isTypeScript),
    )

    expect(manifest.dependencies?.["better-sqlite3"]).toBeUndefined()
    expect(manifest.devDependencies?.["better-sqlite3"]).toBe("12.1.0")
    expect(manifest.dependencies?.["@types/better-sqlite3"]).toBeUndefined()
    expect(manifest.devDependencies?.["@types/better-sqlite3"]).toBe("7.6.13")
    expect(manifest.dependencies?.openai).toBeTruthy()
    expect(lockfile).not.toMatch(/@openai\/agents(?:[-/@]|(?=['":\s]))/)
    expect(
      allImports.filter(({ specifier }) =>
        specifier.startsWith("@openai/agents"),
      ),
    ).toEqual([])
  })

  it("does not touch filesystem or databases on app and worker import", async () => {
    sideEffects.fileSystem.mockClear()
    for (const entry of IMPORT_SAFE_ENTRIES) {
      await import(entry)
    }

    expect(sideEffects.fileSystem).not.toHaveBeenCalled()
    expect(sideEffects.database.postgres).not.toHaveBeenCalled()
    expect(sideEffects.database.drizzle).not.toHaveBeenCalled()
    expect(sideEffects.database.sqlite).not.toHaveBeenCalled()
  })
})
