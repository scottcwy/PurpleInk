import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HYPERFRAMES_VERSION,
  getHyperframesCliPath,
} from "../server/src/compose/render";

describe("HyperFrames 本地执行约束", () => {
  it("固定 0.7.70 并从 workspace node_modules/.bin 调用", () => {
    const cliPath = getHyperframesCliPath();

    expect(HYPERFRAMES_VERSION).toBe("0.7.70");
    expect(basename(dirname(cliPath))).toBe(".bin");
    expect(basename(cliPath)).toMatch(/^hyperframes(?:\.cmd)?$/);
    expect(cliPath.toLowerCase()).not.toContain("npx");
  });
});
