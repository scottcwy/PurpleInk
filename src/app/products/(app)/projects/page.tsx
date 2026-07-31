import { NewProjectDialog } from "@/app/_components/new-project-dialog";
import { withPageSession } from "@/features/auth/page-session";
import { getCanvasGraph } from "@/features/canvas";
import { PublishNavContext } from "@/features/navigation/nav-context";
import {
  listInitialProjectCards,
  PROJECT_CARD_FIRST_PAGE_SIZE,
  type ProjectCardItem,
} from "@/features/projects";
import { ProjectList } from "@/features/projects/project-list";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  return withPageSession("/products/projects", renderProjects);
}

async function renderProjects() {
  // 首屏只做分页投影（每板块前 N 条 + 分类计数），不再逐项目取整张画布图。
  const initial = await listInitialProjectCards();
  const total =
    initial.kindCounts.script +
    initial.kindCounts.audio +
    initial.kindCounts.website;
  const firstProject = mostRecentProject(initial.pages);
  // 侧栏深链上下文只需要最近一个项目的镜头节点，单独取这一张图。
  const firstGraph = firstProject
    ? await getCanvasGraph(firstProject.id)
    : undefined;
  const firstShot = firstGraph?.nodes.find(
    (node) => node.type === "shot-codegen"
  );

  return (
    <>
      <PublishNavContext
        projectId={firstProject?.id}
        rendererNodeId={firstShot?.id}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <ProjectList
          total={total}
          initialPages={initial.pages}
          initialCounts={initial.kindCounts}
          pageSize={PROJECT_CARD_FIRST_PAGE_SIZE}
          newProjectAction={
            <NewProjectDialog key="top-bar-new-project" triggerSize="sm" />
          }
          emptyActions={{
            script: <NewProjectDialog key="script" initialKind="script" />,
            audio: <NewProjectDialog key="audio" initialKind="audio" />,
            website: <NewProjectDialog key="website" initialKind="website" />,
          }}
        />
      </main>
    </>
  );
}

function mostRecentProject(
  pages: Record<"script" | "audio" | "website", ProjectCardItem[]>
): ProjectCardItem | undefined {
  return [...pages.script, ...pages.audio, ...pages.website].sort((a, b) =>
    b.updatedAtIso.localeCompare(a.updatedAtIso)
  )[0];
}
