"use client";

import {
  approveFlow,
  deleteFlowNode,
  moveFlowNode,
  renameFlowNode,
  rerunFlowNode,
} from "@/lib/product-flow/domain";
import type { FlowCommandResult, ProductFlow } from "@/lib/product-flow/types";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Film,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { StatusBadge } from "./status-badge";

type FlowWorkbenchProps = { initialFlow: ProductFlow };

export function FlowWorkbench({ initialFlow }: FlowWorkbenchProps): ReactNode {
  const [flow, setFlow] = useState(initialFlow);
  const [selectedId, setSelectedId] = useState(initialFlow.nodes[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(
    initialFlow.nodes[0]?.title ?? ""
  );
  const [notice, setNotice] = useState("");
  const selected =
    flow.nodes.find((node) => node.id === selectedId) ?? flow.nodes[0];

  function apply(result: FlowCommandResult, success: string): void {
    setFlow(result.flow);
    setNotice(
      result.ok ? success : `${result.error?.code}: ${result.error?.message}`
    );
  }

  function selectNode(nodeId: string): void {
    const node = flow.nodes.find((item) => item.id === nodeId);
    setSelectedId(nodeId);
    setDraftTitle(node?.title ?? "");
    setEditing(false);
  }

  function handleNodeKeys(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nextIndex = Math.max(
      0,
      Math.min(
        flow.nodes.length - 1,
        index + (event.key === "ArrowDown" ? 1 : -1)
      )
    );
    const next = flow.nodes[nextIndex];
    if (next) {
      selectNode(next.id);
      document.getElementById(`flow-node-${next.id}`)?.focus();
    }
  }

  if (!selected) return null;

  return (
    <div className="flow-workbench bg-ink-panel text-ink-panel-text grid min-h-[42rem] overflow-hidden rounded-[14px] xl:grid-cols-[minmax(0,1fr)_23rem]">
      <section
        aria-label="Semantic flow canvas"
        className="min-w-0 border-b border-white/10 xl:border-r xl:border-b-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold">Semantic flow</h2>
              <StatusBadge status={flow.status} />
            </div>
            <p className="text-ink-panel-muted mt-1 font-mono text-[10px]">
              v{flow.version} · {flow.nodes.length} nodes · clean replay
            </p>
          </div>
          <button
            type="button"
            onClick={() => apply(approveFlow(flow), "Flow version approved.")}
            className="focus-ring bg-accent text-accent-foreground hover:bg-brand-spectrum-end inline-flex h-10 items-center gap-2 rounded-[8px] px-3.5 text-sm font-bold"
          >
            <ShieldCheck size={16} />
            Approve version
          </button>
        </div>

        <div className="relative overflow-x-auto p-4 sm:p-6">
          <div
            className="mx-auto flex max-w-3xl min-w-0 flex-col gap-3 sm:min-w-[36rem]"
            role="list"
            aria-label="Flow nodes"
          >
            {flow.nodes.map((node, index) => (
              <div
                key={node.id}
                role="listitem"
                className="group relative flex items-stretch gap-3"
              >
                <div
                  className="flex w-7 shrink-0 flex-col items-center"
                  aria-hidden="true"
                >
                  <span
                    className={`flex size-7 items-center justify-center rounded-full font-mono text-[11px] font-bold ${node.id === selected.id ? "bg-accent text-ink-panel" : "bg-ink-panel-soft text-ink-panel-muted"}`}
                  >
                    {node.order}
                  </span>
                  {index < flow.nodes.length - 1 ? (
                    <span className="mt-1 min-h-10 w-px flex-1 bg-white/15" />
                  ) : null}
                </div>
                <button
                  id={`flow-node-${node.id}`}
                  type="button"
                  onClick={() => selectNode(node.id)}
                  onKeyDown={(event) => handleNodeKeys(event, index)}
                  aria-pressed={node.id === selected.id}
                  className={`focus-ring mb-1 flex min-h-24 min-w-0 flex-1 items-center gap-4 rounded-[10px] p-4 text-left transition-colors ${node.id === selected.id ? "bg-background text-foreground" : "bg-ink-panel-soft text-ink-panel-text hover:bg-ink-panel"}`}
                >
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-[8px] ${node.id === selected.id ? "bg-accent-light text-accent-strong" : "text-ink-panel-muted bg-white/7"}`}
                  >
                    <FileCheck2 size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm">{node.title}</strong>
                      <StatusBadge status={node.execution.status} />
                    </span>
                    <span
                      className={`mt-1.5 block text-xs leading-5 ${node.id === selected.id ? "text-muted-foreground" : "text-ink-panel-muted"}`}
                    >
                      {node.capabilityIds.join(" · ")}
                    </span>
                  </span>
                  <ChevronRight size={17} className="shrink-0 opacity-55" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {notice}
        </p>
      </section>

      <aside
        aria-label={`${selected.title} inspector`}
        className="bg-ink-panel min-w-0"
      >
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-accent-light font-mono text-[10px] font-semibold uppercase">
                Node {selected.order} inspector
              </p>
              {editing ? (
                <div className="mt-2 flex gap-2">
                  <label className="sr-only" htmlFor="node-title">
                    Node title
                  </label>
                  <input
                    id="node-title"
                    autoFocus
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    className="bg-ink-panel min-w-0 flex-1 rounded-[8px] border border-white/15 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    aria-label="Save node title"
                    onClick={() => {
                      apply(
                        renameFlowNode(flow, selected.id, draftTitle),
                        "Node renamed."
                      );
                      setEditing(false);
                    }}
                    className="focus-ring bg-accent text-ink-panel flex size-10 items-center justify-center rounded-[8px]"
                  >
                    <Save size={16} />
                  </button>
                </div>
              ) : (
                <h2 className="mt-1 text-lg font-bold">{selected.title}</h2>
              )}
            </div>
            {!editing ? (
              <button
                type="button"
                aria-label="Rename node"
                onClick={() => setEditing(true)}
                className="focus-ring text-ink-panel-muted flex size-9 shrink-0 items-center justify-center rounded-[8px] hover:bg-white/7 hover:text-white"
              >
                <Pencil size={15} />
              </button>
            ) : null}
          </div>
          <p className="text-ink-panel-muted mt-2 text-xs leading-5">
            {selected.intent}
          </p>
          {notice ? (
            <div
              className={`mt-3 flex gap-2 rounded-[8px] px-3 py-2 text-xs leading-5 ${notice.includes(":") ? "bg-signal/15 text-signal" : "bg-proof/12 text-proof"}`}
              role="status"
            >
              <CircleAlert size={15} className="mt-0.5 shrink-0" />
              {notice}
            </div>
          ) : null}
        </div>

        <div className="max-h-[35rem] space-y-6 overflow-y-auto px-5 py-5">
          <InspectorSection title="Capabilities" icon={<Check size={14} />}>
            <div className="flex flex-wrap gap-2">
              {selected.capabilityIds.map((id) => (
                <span
                  key={id}
                  className="bg-accent-light text-accent-strong rounded-full px-2.5 py-1 text-[11px] font-bold"
                >
                  {id}
                </span>
              ))}
            </div>
          </InspectorSection>
          <InspectorSection
            title={`Actions · ${selected.actions.length}`}
            icon={<MousePointerClick size={14} />}
          >
            <ol className="space-y-2">
              {selected.actions.map((action, index) => (
                <li
                  key={action.id}
                  className="flex gap-3 rounded-[8px] bg-white/5 px-3 py-2.5"
                >
                  <span className="text-ink-panel-muted font-mono text-[10px]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      {action.label}
                    </span>
                    <span className="text-ink-panel-muted mt-1 block font-mono text-[9px]">
                      {action.kind} · {action.effect}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </InspectorSection>
          <InspectorSection title="Assertions" icon={<ShieldCheck size={14} />}>
            <ul className="space-y-2">
              {selected.checkpoints.map((checkpoint) => (
                <li
                  key={checkpoint.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span>{checkpoint.label}</span>
                  <StatusBadge status={checkpoint.status} />
                </li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Evidence" icon={<Film size={14} />}>
            <ul className="space-y-2">
              {selected.evidence.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-[8px] bg-white/5 px-3 py-2.5"
                >
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-semibold">
                      {item.label}
                    </span>
                    <span className="text-ink-panel-muted font-mono text-[9px]">
                      {item.kind.replaceAll("_", " ")}
                    </span>
                  </span>
                  <StatusBadge
                    status={item.status === "approved" ? "approved" : "pending"}
                  />
                </li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Errors" icon={<CircleAlert size={14} />}>
            {selected.execution.error ? (
              <div className="bg-signal/12 text-signal rounded-[8px] p-3 text-xs">
                <p className="font-mono text-[10px] font-semibold">
                  {selected.execution.error.code}
                </p>
                <p className="mt-1.5 leading-5">
                  {selected.execution.error.message}
                </p>
              </div>
            ) : (
              <p className="text-ink-panel-muted flex items-center gap-2 text-xs">
                <Check size={14} className="text-proof" />
                No errors in the latest execution.
              </p>
            )}
          </InspectorSection>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <div className="flex gap-1">
            <ToolButton
              label="Move up"
              onClick={() =>
                apply(moveFlowNode(flow, selected.id, -1), "Node moved up.")
              }
            >
              <ArrowUp size={15} />
            </ToolButton>
            <ToolButton
              label="Move down"
              onClick={() =>
                apply(moveFlowNode(flow, selected.id, 1), "Node moved down.")
              }
            >
              <ArrowDown size={15} />
            </ToolButton>
            <ToolButton
              label="Delete node"
              onClick={() => {
                const result = deleteFlowNode(flow, selected.id);
                apply(result, "Node deleted.");
                if (result.ok) setSelectedId(result.flow.nodes[0]?.id ?? "");
              }}
            >
              <Trash2 size={15} />
            </ToolButton>
          </div>
          <button
            type="button"
            onClick={() =>
              apply(
                rerunFlowNode(flow, selected.id),
                "A new node execution started."
              )
            }
            className="focus-ring text-ink-panel hover:bg-accent-light inline-flex h-9 items-center gap-2 rounded-[8px] bg-white px-3 text-xs font-bold"
          >
            <RotateCcw size={14} />
            Rerun
          </button>
        </div>
      </aside>
    </div>
  );
}

function InspectorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section>
      <h3 className="text-ink-panel-muted mb-3 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="focus-ring text-ink-panel-muted flex size-9 items-center justify-center rounded-[8px] hover:bg-white/7 hover:text-white"
    >
      {children}
    </button>
  );
}
