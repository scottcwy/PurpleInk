import {
  BrowserDisconnectedError,
  type BrowserAdapter,
} from "./adapters.js";
import {
  assertNavigationAllowed,
  type AddressResolver,
} from "./security.js";
import type { CaptureAction, CaptureEvent, CapturePlan } from "./protocol.js";

export type RunnerState =
  | "idle"
  | "running"
  | "disconnected"
  | "awaiting_user"
  | "completed";

export class CaptureRunner {
  private plan?: CapturePlan;
  private index = 0;
  private seq = 0;
  private state: RunnerState = "idle";
  private disconnectedAction: CaptureAction | undefined;

  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly emit: (event: CaptureEvent) => void,
    private readonly resolveAddresses?: AddressResolver,
  ) {}

  async run(plan: CapturePlan): Promise<{ state: RunnerState }> {
    if (this.state !== "idle") throw new Error("CaptureRunner can only run once");
    this.plan = plan;
    this.state = "running";
    await this.adapter.start(plan.sessionId);
    this.send("session_started");
    return this.continueRun();
  }

  async resume(): Promise<{ state: RunnerState }> {
    if (this.state !== "disconnected" || !this.disconnectedAction) {
      throw new Error("CaptureRunner is not disconnected");
    }
    const action = this.disconnectedAction;
    if (action.effect === "non_idempotent_write") {
      if (!(await this.adapter.checkPostcondition(action))) {
        this.state = "awaiting_user";
        this.send("user_action_required", action.id);
        return { state: this.state };
      }
      this.index += 1;
      this.send("action_completed", action.id);
    }
    this.disconnectedAction = undefined;
    this.state = "running";
    return this.continueRun();
  }

  private async continueRun(): Promise<{ state: RunnerState }> {
    const plan = this.plan;
    if (!plan) throw new Error("Capture plan is missing");
    while (this.index < plan.actions.length) {
      const action = plan.actions[this.index];
      if (!action) throw new Error("Capture action is missing");
      if (action.kind === "navigate" && action.url) {
        await assertNavigationAllowed(
          action.url,
          plan.allowedOrigins,
          this.resolveAddresses,
        );
      }
      try {
        await this.adapter.execute(action);
      } catch (error) {
        if (error instanceof BrowserDisconnectedError) {
          this.disconnectedAction = action;
          this.state = "disconnected";
          return { state: this.state };
        }
        throw error;
      }
      this.index += 1;
      this.send("action_completed", action.id);
    }
    await this.adapter.complete();
    this.state = "completed";
    this.send("session_completed");
    return { state: this.state };
  }

  private send(type: CaptureEvent["type"], actionId?: string): void {
    this.seq += 1;
    this.emit({ seq: this.seq, type, ...(actionId ? { actionId } : {}) });
  }
}
