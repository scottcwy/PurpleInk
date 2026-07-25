import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  entriesByCategory,
  PENCIL_COMPONENT_FAMILY_COUNT,
  PENCIL_REUSABLE_SYMBOL_COUNT,
  UI_COMPONENT_FAMILY_COUNT,
} from "./registry";

const EXPECTED_PENCIL_FAMILIES = [
  "account-menu",
  "artifact-chip",
  "audio-node",
  "button",
  "collapsible-card",
  "contact-sheet-thumb",
  "dialog",
  "empty-state",
  "export-node",
  "icon-button",
  "nav-item",
  "pipeline-node",
  "progress-bar",
  "project-card",
  "project-statistics-panel",
  "queue-status-bar",
  "recent-projects-panel",
  "search-field",
  "segmented-control",
  "settings-group",
  "settings-row",
  "shot-node",
  "sidebar",
  "sidebar-account",
  "sidebar-toggle",
  "stage-node",
  "status-pill",
  "text-area",
  "text-field",
  "timeline-track",
  "toast",
  "toggle",
  "tooltip",
  "top-bar",
  "purple-ink-logo",
] as const;

const EXPECTED_UI_FAMILIES = [
  ...EXPECTED_PENCIL_FAMILIES,
  "resize-handle",
  "settings-panel",
  "skeleton",
] as const;

describe("Track P playbook registry", () => {
  it("tracks the latest Pencil inventory and every translated application family", () => {
    expect(PENCIL_REUSABLE_SYMBOL_COUNT).toBe(113);
    expect(PENCIL_COMPONENT_FAMILY_COUNT).toBe(35);
    expect(UI_COMPONENT_FAMILY_COUNT).toBe(38);
    expect(
      entriesByCategory("ui")
        .map(({ id }) => id)
        .sort()
    ).toEqual([...EXPECTED_UI_FAMILIES].sort());
  });

  it("keeps the icon whitelist as a catalog rather than a visual primitive", () => {
    expect(entriesByCategory("icons").map(({ id }) => id)).toEqual([
      "lucide-catalog",
    ]);
  });

  it("keeps icon-bearing SettingsPanel demos on the client boundary", () => {
    const source = readFileSync(
      "src/components/ui/settings-panel.demo.tsx",
      "utf8",
    );

    expect(source.startsWith("'use client'")).toBe(true);
  });
});
