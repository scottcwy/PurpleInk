"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { Button, type ButtonSize } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { TextArea } from "@/components/ui/text-area";
import { Toast } from "@/components/ui/toast";
import {
  LoginRequiredDialog,
  useRequireLogin,
} from "@/features/auth/login-required-dialog";
import { productCanvasHref } from "@/features/navigation/products-routes";
import {
  createProject,
  createProjectCreationKey,
  startProject,
  type ProjectVisualTheme,
} from "@/features/projects/project-create-client";
import type { ProjectVisualStyle } from "@/features/projects/project-visual-style";
import type { ProjectWorkflowKind } from "@/lib/workflow/project-workflow-registry";
import {
  buildNewProjectInput,
  isProjectKind,
  validateNewProjectInput,
} from "./new-project-form";
import { NewProjectSourceCard } from "./new-project-source-card";

const SOURCE_OPTIONS = [
  { value: "script", label: "文稿视频" },
  { value: "audio", label: "录音转视频" },
  { value: "website", label: "网站介绍" },
] as const;

const VISUAL_THEME_OPTIONS = [
  { value: "dark", label: "深色系" },
  { value: "light", label: "浅色系" },
] as const;

const VISUAL_STYLE_OPTIONS = [
  { value: "default", label: "默认" },
  { value: "flat", label: "平面" },
  { value: "dimensional", label: "立体" },
  { value: "custom", label: "自定义" },
] as const;

export interface NewProjectDialogProps {
  featured?: boolean;
  initialKind?: ProjectWorkflowKind;
  /** 非 featured 触发按钮的尺寸；顶栏入口用 sm，空态入口保持默认。 */
  triggerSize?: ButtonSize;
}

export function NewProjectDialog({
  featured = false,
  initialKind = "script",
  triggerSize = "md",
}: NewProjectDialogProps) {
  const router = useRouter();
  const formId = `new-project-form-${useId()}`;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ProjectWorkflowKind>(initialKind);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [audioFile, setAudioFile] = useState<File>();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [visualTheme, setVisualTheme] = useState<ProjectVisualTheme>("dark");
  const [visualStyle, setVisualStyle] = useState<ProjectVisualStyle>("default");
  const [customVisualStyle, setCustomVisualStyle] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const creationKeyRef = useRef<string | undefined>(undefined);
  const { loginRequired, closeLoginDialog, handleAuthError } =
    useRequireLogin();

  function invalidateCreatedProject() {
    setCreatedProjectId(undefined);
    creationKeyRef.current = undefined;
    setError(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = {
      kind,
      title,
      script,
      audioFile,
      websiteUrl,
      visualTheme,
      visualStyle,
      customVisualStyle,
    };
    const validationError = validateNewProjectInput(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const projectInput = buildNewProjectInput(values);
      if (projectInput.kind === "website" && !creationKeyRef.current) {
        creationKeyRef.current = createProjectCreationKey();
      }
      const projectId =
        createdProjectId ??
        (await createProject(
          projectInput,
          fetch,
          creationKeyRef.current,
        ));
      if (!createdProjectId) setCreatedProjectId(projectId);
      await startProject(projectId);
      router.push(productCanvasHref(projectId));
    } catch (cause) {
      if (!handleAuthError(cause)) {
        setError(cause instanceof Error ? cause.message : "请稍后重试");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      {featured ? (
        <Button
          variant="gray"
          className="h-24 w-full flex-col gap-2 rounded-lg"
          onClick={() => setOpen(true)}
        >
          <Plus className="text-ds-blue size-7" />
          <span className="text-ds-text text-[17px]">
            选择一种来源，开始创作
          </span>
          <span className="text-ds-text-muted text-xs font-normal">
            文稿、原录音与网站 URL 共用项目工作流
          </span>
        </Button>
      ) : (
        <Button icon={Plus} size={triggerSize} onClick={() => setOpen(true)}>
          新建项目
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title="创建项目"
        description="来源会先保存为版本化项目，再由服务端选择并启动对应工作流。"
        actions={
          <>
            <Button
              variant="gray"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              form={formId}
              type="submit"
              icon={Sparkles}
              disabled={submitting}
            >
              {submitting
                ? "正在启动"
                : createdProjectId
                  ? "重试启动"
                  : "创建并开始"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-3.5"
          onSubmit={handleSubmit}
        >
          <SegmentedControl
            options={[...SOURCE_OPTIONS]}
            value={kind}
            onChange={(value) => {
              if (isProjectKind(value) && value !== kind) {
                invalidateCreatedProject();
                setKind(value);
              }
            }}
            className="w-full justify-stretch [&>button]:flex-1"
          />
          <TextField
            label="项目名称"
            placeholder="例如：新品发布介绍"
            value={title}
            maxLength={200}
            onChange={(event) => {
              invalidateCreatedProject();
              setTitle(event.target.value);
            }}
            className="w-full"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-ds-text text-[13px] font-medium">
              视频色调
            </span>
            <SegmentedControl
              options={[...VISUAL_THEME_OPTIONS]}
              value={visualTheme}
              onChange={(value) => {
                if (
                  (value === "dark" || value === "light") &&
                  value !== visualTheme
                ) {
                  invalidateCreatedProject();
                  setVisualTheme(value);
                }
              }}
              className="w-full justify-stretch [&>button]:flex-1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-ds-text text-[13px] font-medium">
              视频风格
            </span>
            <SegmentedControl
              options={[...VISUAL_STYLE_OPTIONS]}
              value={visualStyle}
              onChange={(value) => {
                if (
                  (value === "default" ||
                    value === "flat" ||
                    value === "dimensional" ||
                    value === "custom") &&
                  value !== visualStyle
                ) {
                  invalidateCreatedProject();
                  setVisualStyle(value);
                }
              }}
              className="w-full justify-stretch [&>button]:flex-1"
            />
          </div>
          {visualStyle === "custom" && (
            <TextArea
              label="自定义风格要求"
              placeholder="例如：使用杂志拼贴、粗线条插画与高密度排版"
              value={customVisualStyle}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                invalidateCreatedProject();
                setCustomVisualStyle(event.target.value);
              }}
              className="w-full [&>textarea]:min-h-20"
            />
          )}
          <NewProjectSourceCard
            kind={kind}
            script={script}
            audioFile={audioFile}
            websiteUrl={websiteUrl}
            onScriptChange={(value) => {
              invalidateCreatedProject();
              setScript(value);
            }}
            onAudioFileChange={(file) => {
              invalidateCreatedProject();
              setAudioFile(file);
            }}
            onWebsiteUrlChange={(value) => {
              invalidateCreatedProject();
              setWebsiteUrl(value);
            }}
          />
          {error && (
            <Toast
              variant="error"
              title="创建失败"
              body={error}
              className="w-full"
            />
          )}
        </form>
      </Dialog>
      <LoginRequiredDialog open={loginRequired} onClose={closeLoginDialog} />
    </>
  );
}
