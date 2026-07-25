import { existsSync, readFileSync } from "node:fs"

import ts from "typescript"
import { describe, expect, it } from "vitest"

import { CVC_TASK_IDS, type CvcTaskId } from "./task-ids"

interface TaskSpec {
  file: string
  id: CvcTaskId
  service: string
}

interface TaskSource {
  spec: TaskSpec
  text: string
  source: ts.SourceFile
}

const TASK_SPECS: readonly TaskSpec[] = [
  {
    file: "trigger/tasks/pipeline-run.ts",
    id: "cvc.pipeline.run",
    service: "@/features/pipeline/services/pipeline-run-service",
  },
  {
    file: "trigger/tasks/project-plan.ts",
    id: "cvc.project.plan",
    service: "@/features/pipeline/services/project-plan-service",
  },
  {
    file: "trigger/tasks/shot-generate.ts",
    id: "cvc.shot.generate",
    service: "@/features/pipeline/services/shot-generate-service",
  },
  {
    file: "trigger/tasks/shot-media.ts",
    id: "cvc.shot.media",
    service: "@/features/pipeline/services/shot-media-service",
  },
  {
    file: "trigger/tasks/shot-render.ts",
    id: "cvc.shot.render",
    service: "@/features/pipeline/services/shot-render-service",
  },
  {
    file: "trigger/tasks/shot-qa.ts",
    id: "cvc.shot.qa",
    service: "@/features/pipeline/services/shot-qa-service",
  },
  {
    file: "trigger/tasks/project-compose.ts",
    id: "cvc.project.compose",
    service: "@/features/pipeline/services/project-compose-service",
  },
]

const EXECUTION_CONTEXT_MODULE = "@/features/pipeline/execution-context"
const PROHIBITED_SOURCE =
  /drizzle-orm|@\/lib\/db|\bprompt\b|parse5|ffmpeg|StorageAdapter|openai/i

function loadTaskSources(): TaskSource[] {
  return TASK_SPECS.filter(({ file }) => existsSync(file)).map((spec) => {
    const text = readFileSync(spec.file, "utf8")
    return {
      spec,
      text,
      source: ts.createSourceFile(
        spec.file,
        text,
        ts.ScriptTarget.Latest,
        true,
      ),
    }
  })
}

function importSpecifiers(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return []
    }
    return [statement.moduleSpecifier.text]
  })
}

function isAllowedImport(specifier: string, spec: TaskSpec): boolean {
  return (
    specifier === "@trigger.dev/sdk" ||
    specifier.startsWith("@/features/pipeline/contracts/") ||
    specifier === "../queues" ||
    specifier === "../streams" ||
    specifier === EXECUTION_CONTEXT_MODULE ||
    specifier === spec.service
  )
}

function importedValueBindings(
  source: ts.SourceFile,
  moduleSpecifier: string,
): string[] {
  const declaration = source.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleSpecifier,
  )
  const clause = declaration?.importClause
  if (!clause || clause.isTypeOnly) return []

  const bindings = clause.name ? [clause.name.text] : []
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push(clause.namedBindings.name.text)
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    bindings.push(
      ...clause.namedBindings.elements
        .filter((element) => !element.isTypeOnly)
        .map((element) => element.name.text),
    )
  }
  return bindings
}

function taskCall(source: ts.SourceFile): ts.CallExpression | undefined {
  return findNodes(source, ts.isCallExpression).find(
    (call) => ts.isIdentifier(call.expression) && call.expression.text === "task",
  )
}

function taskRunBody(source: ts.SourceFile): ts.Block | undefined {
  const [argument] = taskCall(source)?.arguments ?? []
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined
  const runProperty = argument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(source) === "run",
  )
  const initializer = runProperty?.initializer
  if (
    !initializer ||
    (!ts.isArrowFunction(initializer) &&
      !ts.isFunctionExpression(initializer))
  ) {
    return undefined
  }
  return ts.isBlock(initializer.body) ? initializer.body : undefined
}

function taskIdExpression(source: ts.SourceFile): ts.Expression | undefined {
  const [argument] = taskCall(source)?.arguments ?? []
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined
  const idProperty = argument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(source) === "id",
  )
  return idProperty?.initializer
}

function resolveTaskId(
  expression: ts.Expression | undefined,
  source: ts.SourceFile,
  depth = 0,
): string | undefined {
  if (!expression || depth > 3) return undefined
  if (ts.isStringLiteralLike(expression)) return expression.text
  const indexed = resolveTaskIdIndex(expression)
  if (indexed) return indexed
  if (!ts.isIdentifier(expression)) return undefined

  const declaration = findNodes(source, ts.isVariableDeclaration).find(
    (candidate) =>
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === expression.text,
  )
  return resolveTaskId(declaration?.initializer, source, depth + 1)
}

function resolveTaskIdIndex(expression: ts.Expression): string | undefined {
  if (
    !ts.isElementAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "CVC_TASK_IDS" ||
    !expression.argumentExpression ||
    !ts.isNumericLiteral(expression.argumentExpression)
  ) {
    return undefined
  }
  return CVC_TASK_IDS[Number(expression.argumentExpression.text)]
}

function callUsesBinding(
  call: ts.CallExpression,
  bindings: readonly string[],
): boolean {
  if (ts.isIdentifier(call.expression)) {
    return bindings.includes(call.expression.text)
  }
  if (ts.isPropertyAccessExpression(call.expression)) {
    const root = call.expression.expression
    return ts.isIdentifier(root) && bindings.includes(root.text)
  }
  return false
}

function parseCallPosition(
  body: ts.Block,
  schemaName: RegExp,
  source: ts.SourceFile,
): number {
  const call = findNodes(body, ts.isCallExpression).find((candidate) => {
    if (!ts.isPropertyAccessExpression(candidate.expression)) return false
    return (
      candidate.expression.name.text === "parse" &&
      schemaName.test(candidate.expression.expression.getText(source))
    )
  })
  return call?.getStart(source) ?? -1
}

function bindingCallPositions(
  body: ts.Block,
  bindings: readonly string[],
  source: ts.SourceFile,
): number[] {
  return findNodes(body, ts.isCallExpression)
    .filter((call) => callUsesBinding(call, bindings))
    .map((call) => call.getStart(source))
}

function findNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const matches: T[] = []
  function visit(node: ts.Node): void {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return matches
}

describe("Trigger task source boundary", () => {
  it("requires all seven task source files", () => {
    const missing = TASK_SPECS.filter(({ file }) => !existsSync(file)).map(
      ({ file }) => file,
    )
    expect(missing).toEqual([])
  })

  it("locks the exact task ID set and file mapping", () => {
    const sources = loadTaskSources()
    const records = sources.map(({ spec, source }) => ({
      file: spec.file,
      expected: spec.id,
      actual: resolveTaskId(taskIdExpression(source), source),
    }))
    expect(records.every(({ actual, expected }) => actual === expected)).toBe(
      true,
    )
    expect(records.map(({ actual }) => actual).sort()).toEqual(
      [...CVC_TASK_IDS].sort(),
    )
  })
})

describe("Trigger task import boundary", () => {
  it("allows only adapter imports and the corresponding service", () => {
    for (const { spec, source } of loadTaskSources()) {
      const imports = importSpecifiers(source)
      expect(
        imports.filter((specifier) => !isAllowedImport(specifier, spec)),
        spec.file,
      ).toEqual([])
      expect(imports.filter((specifier) => specifier === spec.service)).toEqual([
        spec.service,
      ])
      expect(imports).toContain(EXECUTION_CONTEXT_MODULE)
    }
  })

  it("rejects infrastructure, model, parser, and storage concerns", () => {
    for (const { spec, text } of loadTaskSources()) {
      expect(text, spec.file).not.toMatch(PROHIBITED_SOURCE)
    }
  })
})

describe("Trigger task run boundary", () => {
  it("orders payload parse, context, one service, then result parse", () => {
    for (const { spec, source } of loadTaskSources()) {
      const body = taskRunBody(source)
      expect(body, `${spec.file} run body`).toBeDefined()
      if (!body) continue
      const contextBindings = importedValueBindings(
        source,
        EXECUTION_CONTEXT_MODULE,
      )
      const serviceBindings = importedValueBindings(source, spec.service)
      const contextCalls = bindingCallPositions(body, contextBindings, source)
      const serviceCalls = bindingCallPositions(body, serviceBindings, source)
      const ordered = [
        parseCallPosition(body, /PayloadV1Schema$/, source),
        contextCalls[0] ?? -1,
        serviceCalls[0] ?? -1,
        parseCallPosition(body, /^TaskResultV1Schema$/, source),
      ]
      expect(contextCalls, `${spec.file} context calls`).toHaveLength(1)
      expect(serviceCalls, `${spec.file} service calls`).toHaveLength(1)
      expect(ordered.every((position) => position >= 0), spec.file).toBe(true)
      expect(ordered).toEqual([...ordered].sort((a, b) => a - b))
    }
  })

  it("keeps every task run body within 50 lines", () => {
    for (const { spec, source } of loadTaskSources()) {
      const body = taskRunBody(source)
      expect(body, `${spec.file} run body`).toBeDefined()
      if (!body) continue
      const start = source.getLineAndCharacterOfPosition(body.getStart()).line
      const end = source.getLineAndCharacterOfPosition(body.end).line
      expect(end - start + 1, spec.file).toBeLessThanOrEqual(50)
    }
  })
})
