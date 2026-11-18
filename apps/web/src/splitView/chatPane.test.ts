import { describe, expect, it } from "vite-plus/test";

import { chatPaneOwnsEvent, type ChatPane } from "./chatPane";
import { resolveSplitDropEdge } from "./splitDrop";

const pane = (paneId: string, focused: boolean): ChatPane => ({
  paneId,
  focused,
  ownsTitleBar: false,
  close: () => {},
});

describe("chatPaneOwnsEvent", () => {
  it.each<{ name: string; pane: ChatPane | null; target: string | null; owns: boolean }>([
    { name: "the single view owns every event", pane: null, target: null, owns: true },
    { name: "a pane owns events inside it", pane: pane("a", false), target: "a", owns: true },
    {
      name: "a pane ignores another pane's events",
      pane: pane("a", true),
      target: "b",
      owns: false,
    },
    {
      name: "the focused pane owns events outside every pane",
      pane: pane("a", true),
      target: null,
      owns: true,
    },
    { name: "an unfocused pane ignores them", pane: pane("a", false), target: null, owns: false },
  ])("$name", ({ pane, target, owns }) => {
    expect(chatPaneOwnsEvent(pane, target)).toBe(owns);
  });
});

describe("resolveSplitDropEdge", () => {
  const rect = { left: 100, top: 0, width: 800, height: 600 };

  it.each([
    { point: { x: 120, y: 300 }, edge: "left" },
    { point: { x: 880, y: 300 }, edge: "right" },
    { point: { x: 500, y: 10 }, edge: "top" },
    { point: { x: 500, y: 590 }, edge: "bottom" },
    { point: { x: 500, y: 300 }, edge: null },
    { point: { x: 50, y: 300 }, edge: null },
  ])("resolves $point to $edge", ({ point, edge }) => {
    expect(resolveSplitDropEdge(rect, point)).toBe(edge);
  });
});
