import type { CaptureAction } from "./protocol.js";
import { spawn } from "node:child_process";

export class BrowserDisconnectedError extends Error {
  constructor() {
    super("Browser adapter disconnected");
    this.name = "BrowserDisconnectedError";
  }
}

export interface BrowserAdapter {
  start(sessionId: string): Promise<void>;
  execute(action: CaptureAction): Promise<void>;
  checkPostcondition(action: CaptureAction): Promise<boolean>;
  complete(): Promise<void>;
}

type MockOptions = {
  disconnectAfterActionId?: string;
  postconditions?: Record<string, boolean>;
};

export class MockBrowserAdapter implements BrowserAdapter {
  readonly executedActionIds: string[] = [];
  private didDisconnect = false;

  constructor(private readonly options: MockOptions = {}) {}

  async start(): Promise<void> {}

  async execute(action: CaptureAction): Promise<void> {
    this.executedActionIds.push(action.id);
    if (
      !this.didDisconnect &&
      this.options.disconnectAfterActionId === action.id
    ) {
      this.didDisconnect = true;
      throw new BrowserDisconnectedError();
    }
  }

  async checkPostcondition(action: CaptureAction): Promise<boolean> {
    return this.options.postconditions?.[action.id] ?? false;
  }

  async complete(): Promise<void> {}
}

export type EgoCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type EgoCommandRunner = (script: string) => Promise<EgoCommandResult>;

export function runEgoBrowserScript(script: string): Promise<EgoCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ego-browser", ["nodejs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    child.stdin.end(script);
  });
}

function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function locator(action: CaptureAction): string {
  if (!action.target) throw new Error(`Action ${action.id} requires a target`);
  const { by, value, role } = action.target;
  if (by === "css") return quote(value);
  if (by === "href") return quote(`loc=href:${value}`);
  if (by === "role") return quote(`loc=role:${role ?? "button"}:${value}`);
  return quote(`[${by.replace("test_id", "data-testid")}=${JSON.stringify(value)}]`);
}

export class EgoBrowserAdapter implements BrowserAdapter {
  private taskSpaceName?: string;

  constructor(private readonly runCommand: EgoCommandRunner = runEgoBrowserScript) {}

  async start(sessionId: string): Promise<void> {
    this.taskSpaceName = `purpleink-capture-${sessionId}`;
    await this.run(`const task = await useOrCreateTaskSpace(${quote(this.taskSpaceName)})\ncliLog(JSON.stringify({ ok: true, taskSpaceId: task.id }))`);
  }

  async execute(action: CaptureAction): Promise<void> {
    const task = this.requireTaskSpace();
    let operation: string;
    switch (action.kind) {
      case "navigate":
        if (!action.url) throw new Error(`Action ${action.id} requires a URL`);
        operation = `await openOrReuseTab(${quote(action.url)}, { wait: true, timeout: 20 })`;
        break;
      case "click":
        operation = `await click(${locator(action)}, { label: ${quote(`capture ${action.id}`)} })`;
        break;
      case "fill":
        operation = `await fillInput(${locator(action)}, ${quote(action.value ?? "")})`;
        break;
      case "keypress":
        operation = `await pressKey(${quote(action.value ?? "Enter")})`;
        break;
      case "wait_for":
        operation = `await waitForElement(${locator(action)}, { timeout: 20 })`;
        break;
      case "select":
        throw new Error("Select actions require explicit user handoff in the MVP adapter");
    }
    await this.run(`await useOrCreateTaskSpace(${quote(task)})\n${operation}\ncliLog(JSON.stringify({ ok: true }))`);
  }

  async checkPostcondition(): Promise<boolean> {
    return false;
  }

  async complete(): Promise<void> {
    const task = this.requireTaskSpace();
    await this.run(`const result = await completeTaskSpace(${quote(task)}, { keep: false })\ncliLog(JSON.stringify(result))`);
  }

  private requireTaskSpace(): string {
    if (!this.taskSpaceName) throw new Error("Ego adapter has not started");
    return this.taskSpaceName;
  }

  private async run(script: string): Promise<void> {
    const result = await this.runCommand(script);
    if (result.exitCode !== 0) {
      if (/user is controlling|inactive|not assigned/i.test(result.stderr)) {
        throw new BrowserDisconnectedError();
      }
      throw new Error(`ego-browser failed: ${result.stderr.slice(0, 500)}`);
    }
  }
}
