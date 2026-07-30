import { describe, expect, it } from "vitest";
import {
  buildNewProjectInput,
  validateNewProjectInput,
} from "./new-project-form";

describe("new project form contract", () => {
  it("keeps audio on the original-recording path", () => {
    const file = new File(["audio"], "voice.wav", { type: "audio/wav" });
    expect(
      buildNewProjectInput({
        kind: "audio",
        title: "采访",
        script: "",
        audioFile: file,
        websiteUrl: "",
        visualTheme: "dark",
        visualStyle: "dimensional",
        customVisualStyle: "",
      })
    ).toEqual({
      kind: "audio",
      title: "采访",
      file,
      visualTheme: "dark",
      visualStyle: "dimensional",
    });
  });

  it("requires and trims a custom visual style without changing the source text", () => {
    const values = {
      kind: "script" as const,
      title: "产品介绍",
      script: "保持原始产品事实。",
      websiteUrl: "",
      visualTheme: "light" as const,
      visualStyle: "custom" as const,
      customVisualStyle: "  使用杂志拼贴与粗线条插画  ",
    };

    expect(validateNewProjectInput(values)).toBeUndefined();
    expect(buildNewProjectInput(values)).toEqual({
      kind: "script",
      title: "产品介绍",
      script: "保持原始产品事实。",
      visualTheme: "light",
      visualStyle: "custom",
      customVisualStyle: "使用杂志拼贴与粗线条插画",
    });
    expect(
      validateNewProjectInput({ ...values, customVisualStyle: "   " })
    ).toBe("请输入自定义风格要求");
  });

  it("rejects missing, empty, oversized, and invalid source inputs", () => {
    const base = {
      title: "项目",
      script: "",
      websiteUrl: "",
      visualTheme: "dark" as const,
      visualStyle: "default" as const,
      customVisualStyle: "",
    };
    expect(validateNewProjectInput({ ...base, kind: "script" })).toBe(
      "请粘贴文字稿"
    );
    expect(validateNewProjectInput({ ...base, kind: "audio" })).toBe(
      "请选择 MP3 或 WAV 录音文件"
    );
    expect(
      validateNewProjectInput({
        ...base,
        kind: "audio",
        audioFile: new File([], "empty.mp3"),
      })
    ).toBe("录音文件不能为空");
    expect(
      validateNewProjectInput({
        ...base,
        kind: "website",
        websiteUrl: "file:///private",
      })
    ).toBe("请输入以 http(s):// 开头的公开网站 URL");
  });
});
