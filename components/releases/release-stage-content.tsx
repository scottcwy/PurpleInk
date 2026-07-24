import type { ReactNode } from "react";

export type ReleaseStageModel =
  | {
      kind: "brief";
      audience: string;
      goal: string;
      claims: ReadonlyArray<string>;
      channel: string;
      callToAction: string;
      version: string;
    }
  | {
      kind: "flow";
      name: string;
      version: string;
      lastVerified: string;
      nodes: ReadonlyArray<string>;
    }
  | {
      kind: "evidence";
      runId: string;
      status: string;
      nodes: ReadonlyArray<{
        title: string;
        checkpoint: string;
        evidence: string;
        redaction: string;
      }>;
    }
  | {
      kind: "storyboard";
      version: string;
      scenes: ReadonlyArray<{
        order: number;
        headline: string;
        body: string;
        evidence: string;
      }>;
    }
  | {
      kind: "review";
      previewStatus: string;
      duration: string;
      qualityChecks: ReadonlyArray<string>;
      unresolvedFeedback: number;
    }
  | {
      kind: "artifacts";
      renderStatus: string;
      progress: number;
      bundleHash: string;
      files: ReadonlyArray<{ name: string; detail: string; status: string }>;
    };

export function ReleaseStageContent({
  model,
}: {
  model: ReleaseStageModel;
}): ReactNode {
  switch (model.kind) {
    case "brief":
      return (
        <div className="brief-layout">
          <dl className="form-sheet flex flex-col gap-5">
            <BriefValue label="Audience" value={model.audience} />
            <BriefValue label="Release goal" value={model.goal} />
            <div>
              <dt className="text-xs font-semibold">Approved claims</dt>
              <dd className="mt-2 flex flex-col gap-2">
                {model.claims.map((claim, index) => (
                  <span key={claim} className="value-point">
                    <span>{index + 1}</span>
                    <strong className="text-sm">{claim}</strong>
                  </span>
                ))}
              </dd>
            </div>
            <BriefValue label="Channel" value={model.channel} />
            <BriefValue label="Call to action" value={model.callToAction} />
          </dl>
          <aside className="brief-summary" aria-label="Brief version">
            <h3>Current version</h3>
            <p className="mt-2 font-mono text-sm">{model.version}</p>
            <p className="text-muted-foreground mt-4 text-xs leading-5">
              Claims remain separate from evidence until later workflow stages.
            </p>
          </aside>
        </div>
      );
    case "flow":
      return (
        <section
          className="selection-sheet"
          aria-label="Selected ProductFlow version"
        >
          <div className="selection-main">
            <Badge variant="outline">{model.version}</Badge>
            <h3>{model.name}</h3>
            <p>
              A reusable semantic path pinned to this release without modifying
              its approved version.
            </p>
            <dl className="fact-row">
              <div>
                <dt>Nodes</dt>
                <dd>{model.nodes.length}</dd>
              </div>
              <div>
                <dt>Last verified</dt>
                <dd>{model.lastVerified}</dd>
              </div>
            </dl>
          </div>
          <ol className="compact-flow" aria-label="Flow nodes">
            {model.nodes.map((node, index) => (
              <li key={node}>
                <span>{index + 1}</span>
                <strong>{node}</strong>
                <Check aria-label="Verified" />
              </li>
            ))}
          </ol>
        </section>
      );
    case "evidence":
      return (
        <section
          className="evidence-table-wrap"
          aria-labelledby="evidence-caption"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p
              id="evidence-caption"
              className="text-muted-foreground font-mono text-xs"
            >
              Capture run {model.runId}
            </p>
            <Badge variant="outline">{model.status}</Badge>
          </div>
          <table className="evidence-table">
            <caption>
              Evidence decisions remain traceable to their node execution.
            </caption>
            <thead>
              <tr>
                <th>Flow node</th>
                <th>Checkpoint</th>
                <th>Evidence</th>
                <th>Redaction</th>
              </tr>
            </thead>
            <tbody>
              {model.nodes.map((node) => (
                <tr key={node.title}>
                  <th scope="row">
                    <FileCheck2 aria-hidden="true" size={16} />
                    <span>{node.title}</span>
                  </th>
                  <td>{node.checkpoint}</td>
                  <td>{node.evidence}</td>
                  <td>{node.redaction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    case "storyboard":
      return (
        <section aria-label="Storyboard scenes">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Scene sequence</h2>
            <Badge variant="outline">{model.version}</Badge>
          </div>
          <ol className="storyboard-strip">
            {model.scenes.map((scene) => (
              <li key={scene.order}>
                <div className="scene-frame">
                  <span>Scene {scene.order}</span>
                  <Film aria-hidden="true" />
                  <strong>Evidence-led scene</strong>
                </div>
                <div className="scene-copy">
                  <h3>{scene.headline}</h3>
                  <p>{scene.body}</p>
                  <span>
                    <ShieldCheck aria-hidden="true" size={14} />
                    {scene.evidence}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      );
    case "review":
      return (
        <div className="review-layout">
          <section className="preview-stage" aria-label="Preview player">
            <div className="preview-screen">
              <Video aria-hidden="true" />
              <span>{model.duration}</span>
            </div>
            <div className="quality-gates">
              {model.qualityChecks.map((check) => (
                <span key={check}>
                  <Check aria-hidden="true" />
                  {check}
                </span>
              ))}
            </div>
          </section>
          <aside className="review-notes">
            <h3>
              <ShieldCheck aria-hidden="true" size={16} />
              Review status
            </h3>
            <Badge variant="outline">{model.previewStatus}</Badge>
            <p className="text-muted-foreground mt-5 text-sm">
              {model.unresolvedFeedback} unresolved feedback items
            </p>
          </aside>
        </div>
      );
    case "artifacts":
      return (
        <div className="artifact-layout">
          <section className="render-progress" aria-label="Render status">
            <header>
              <span>{model.renderStatus}</span>
              <span>{model.progress}%</span>
            </header>
            <Progress value={model.progress} className="mt-4" />
          </section>
          <ul className="artifact-list" aria-label="Artifacts">
            {model.files.map((file) => (
              <li key={file.name}>
                <span className="artifact-icon">
                  <Film aria-hidden="true" />
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.detail}</small>
                </span>
                <Badge variant="outline">{file.status}</Badge>
              </li>
            ))}
          </ul>
          <div className="bundle-record">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Bundle provenance</strong>
              <small>{model.bundleHash}</small>
            </span>
          </div>
        </div>
      );
  }
}

function BriefValue({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div>
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="border-border mt-2 border-b pb-3 text-sm leading-6">
        {value}
      </dd>
    </div>
  );
}
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, FileCheck2, Film, ShieldCheck, Video } from "lucide-react";
