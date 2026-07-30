import type {
  CreateProjectInput,
  ProjectVisualTheme,
} from "@/features/projects/project-create-client";
import type { ProjectVisualStyle } from "@/features/projects/project-visual-style";
import type { ProjectWorkflowKind } from "@/lib/workflow/project-workflow-registry";

export interface NewProjectFormValues {
  kind: ProjectWorkflowKind;
  title: string;
  script: string;
  audioFile?: File;
  websiteUrl: string;
  visualTheme: ProjectVisualTheme;
  visualStyle: ProjectVisualStyle;
  customVisualStyle: string;
}

export function validateNewProjectInput(
  values: NewProjectFormValues
): string | undefined {
  if (!values.title.trim()) return "项目名称不能为空";
  if (values.kind === "script" && !values.script.trim()) return "请粘贴文字稿";
  if (values.kind === "audio") {
    if (!values.audioFile) return "请选择 MP3 或 WAV 录音文件";
    if (values.audioFile.size <= 0) return "录音文件不能为空";
    if (values.audioFile.size > 100 * 1024 * 1024) {
      return "录音文件不能超过 100 MB";
    }
  }
  if (values.kind === "website" && !isPublicHttpUrl(values.websiteUrl)) {
    return "请输入以 http(s):// 开头的公开网站 URL";
  }
  if (values.visualStyle === "custom" && !values.customVisualStyle.trim()) {
    return "请输入自定义风格要求";
  }
  if (values.customVisualStyle.trim().length > 500) {
    return "自定义风格要求不能超过 500 个字符";
  }
  return undefined;
}

export function buildNewProjectInput(
  values: NewProjectFormValues
): CreateProjectInput {
  if (values.kind === "script") {
    return {
      kind: "script",
      title: values.title,
      script: values.script,
      visualTheme: values.visualTheme,
      ...buildVisualStyleInput(values),
    };
  }
  if (values.kind === "audio") {
    if (!values.audioFile) throw new Error("请选择 MP3 或 WAV 录音文件");
    return {
      kind: "audio",
      title: values.title,
      file: values.audioFile,
      visualTheme: values.visualTheme,
      ...buildVisualStyleInput(values),
    };
  }
  return {
    kind: "website",
    title: values.title,
    url: values.websiteUrl,
    durationSec: 24,
    quality: "standard",
    visualTheme: values.visualTheme,
    ...buildVisualStyleInput(values),
  };
}

function buildVisualStyleInput(
  values: NewProjectFormValues
): Pick<CreateProjectInput, "visualStyle" | "customVisualStyle"> {
  return values.visualStyle === "custom"
    ? {
        visualStyle: "custom",
        customVisualStyle: values.customVisualStyle.trim(),
      }
    : { visualStyle: values.visualStyle };
}

export function isProjectKind(value: string): value is ProjectWorkflowKind {
  return value === "script" || value === "audio" || value === "website";
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
