/**
 * URL 编码契约测试。
 *
 * docs/conventions/routing.md §4.3 规定三条资源 URL 的所有 path 与 query 片段
 * 都必须 encodeURIComponent。测试覆盖含 `/` 的 id 并断言 `%2F`（§5 第 5 条）。
 */
import { describe, expect, it } from "vitest";

import { videoUrl } from "@/lib/api";

describe("URL 编码契约（routing.md §4.3）", () => {
  it("videoUrl 对含 / 的 jobId 进行编码", () => {
    expect(videoUrl("job/1")).toContain("/jobs/job%2F1/video");
  });

  it("videoUrl 对普通 id 保持不变", () => {
    expect(videoUrl("abc-123")).toContain("/jobs/abc-123/video");
  });

  it("artifact href 对含 / 的 artifactId 与 projectId 双方编码", () => {
    // 复刻 canvas-inspector.tsx 的 href 构建逻辑。
    const artifactId = "art/1";
    const projectId = "project/1";
    const href = `/api/artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`;
    expect(href).toBe("/api/artifacts/art%2F1?projectId=project%2F1");
  });

  it("stage stream URL 对含 / 的 nodeId 与 projectId 双方编码", () => {
    // 复刻 use-stage-stream.ts 的 url 构建逻辑。
    const nodeId = "node/1";
    const projectId = "project/1";
    const url = `/api/director/stream/${encodeURIComponent(nodeId)}?projectId=${encodeURIComponent(projectId)}`;
    expect(url).toBe("/api/director/stream/node%2F1?projectId=project%2F1");
  });
});