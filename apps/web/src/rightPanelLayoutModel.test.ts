import { describe, expect, it } from "vite-plus/test";

import {
  defaultRightPanelLayout,
  minimizeRightPanelGroup,
  moveRightPanelSurface,
  reconcileRightPanelLayout,
  resizeRightPanelColumns,
  resizeRightPanelGroups,
  restoreRightPanelGroup,
  type RightPanelDropTarget,
  type RightPanelLayout,
} from "./rightPanelLayoutModel";

/** Columns as group tab lists, with the active tab starred and the focused group marked `>`. */
function shape(layout: RightPanelLayout) {
  return layout.columns.map((column) =>
    column.groups.map(
      (group) =>
        `${group.id === layout.focusedGroupId ? ">" : ""}${group.surfaceIds
          .map((id) => (id === group.activeSurfaceId ? `${id}*` : id))
          .join(",")}`,
    ),
  );
}

const twoTabs = defaultRightPanelLayout(["a", "b"], "b");
const threeTabs = defaultRightPanelLayout(["a", "b", "c"], "a");

describe("moveRightPanelSurface", () => {
  it.each<{
    name: string;
    layout: RightPanelLayout;
    surface: string;
    target: (layout: RightPanelLayout) => RightPanelDropTarget;
    expected: string[][];
  }>([
    {
      name: "moves a tab to a new column on the right",
      layout: twoTabs,
      surface: "b",
      target: () => ({ kind: "column", groupId: "g1", side: "right" }),
      expected: [["a*"], [">b*"]],
    },
    {
      name: "moves a tab to a new column on the left",
      layout: twoTabs,
      surface: "a",
      target: () => ({ kind: "column", groupId: "g1", side: "left" }),
      expected: [[">a*"], ["b*"]],
    },
    {
      name: "splits a tab down into its column",
      layout: threeTabs,
      surface: "c",
      target: () => ({ kind: "split", groupId: "g1", side: "below" }),
      expected: [["a*,b", ">c*"]],
    },
    {
      name: "splits a tab up into its column",
      layout: threeTabs,
      surface: "a",
      target: () => ({ kind: "split", groupId: "g1", side: "above" }),
      expected: [[">a*", "b*,c"]],
    },
    {
      name: "joins another group and drops the emptied one",
      layout: moveRightPanelSurface(twoTabs, "b", { kind: "column", groupId: "g1", side: "right" }),
      surface: "b",
      target: () => ({ kind: "join", groupId: "g1" }),
      expected: [[">a,b*"]],
    },
    {
      name: "joins at an index",
      layout: moveRightPanelSurface(threeTabs, "c", {
        kind: "column",
        groupId: "g1",
        side: "right",
      }),
      surface: "c",
      target: () => ({ kind: "join", groupId: "g1", index: 0 }),
      expected: [[">c*,a,b"]],
    },
    {
      name: "reorders inside its own group",
      layout: threeTabs,
      surface: "c",
      target: () => ({ kind: "join", groupId: "g1", index: 0 }),
      expected: [[">c,a*,b"]],
    },
    {
      name: "ignores splitting a lone tab off from itself",
      layout: defaultRightPanelLayout(["a"], "a"),
      surface: "a",
      target: () => ({ kind: "split", groupId: "g1", side: "below" }),
      expected: [[">a*"]],
    },
  ])("$name", ({ layout, surface, target, expected }) => {
    expect(shape(moveRightPanelSurface(layout, surface, target(layout)))).toEqual(expected);
  });

  it("halves the anchor's size for the new column", () => {
    const next = moveRightPanelSurface(twoTabs, "b", {
      kind: "column",
      groupId: "g1",
      side: "right",
    });
    expect(next.columns.map((column) => column.size)).toEqual([0.5, 0.5]);
  });
});

describe("reconcileRightPanelLayout", () => {
  const split = moveRightPanelSurface(threeTabs, "c", {
    kind: "column",
    groupId: "g1",
    side: "right",
  });

  it.each<{
    name: string;
    layout: RightPanelLayout;
    previous: [string[], string | null];
    next: [string[], string | null];
    expected: string[][];
    active: string | null;
  }>([
    {
      name: "opens a new surface as a tab in the focused group",
      layout: split,
      previous: [["a", "b", "c"], "c"],
      next: [["a", "b", "c", "d"], "d"],
      expected: [["a*,b"], [">c,d*"]],
      active: "d",
    },
    {
      name: "activates an existing surface in another group and focuses it",
      layout: split,
      previous: [["a", "b", "c"], "c"],
      next: [["a", "b", "c"], "b"],
      expected: [[">a,b*"], ["c*"]],
      active: "b",
    },
    {
      name: "closing the last tab of a group removes its column and refocuses",
      layout: split,
      previous: [["a", "b", "c"], "c"],
      next: [["a", "b"], "a"],
      expected: [[">a*,b"]],
      active: "a",
    },
    {
      name: "closing the active tab falls back within its group, not the registry",
      layout: moveRightPanelSurface(threeTabs, "a", {
        kind: "column",
        groupId: "g1",
        side: "right",
      }),
      previous: [["a", "b", "c"], "a"],
      // The flat reducer picked a registry neighbour from the other group.
      next: [["b", "c"], "b"],
      expected: [[">b*,c"]],
      active: "b",
    },
    {
      name: "a one-for-one swap keeps the replacement in place",
      layout: split,
      previous: [["a", "b", "c"], "c"],
      next: [["a", "x", "c"], "x"],
      expected: [[">a,x*"], ["c*"]],
      active: "x",
    },
    {
      name: "places tabs in a new column when every group is minimized",
      layout: minimizeRightPanelGroup(defaultRightPanelLayout(["a"], "a"), "g1", 1),
      previous: [["a"], null],
      next: [["a", "b"], "b"],
      expected: [[">b*"]],
      active: "b",
    },
  ])("$name", ({ layout, previous, next, expected, active }) => {
    const result = reconcileRightPanelLayout(layout, {
      previousIds: previous[0],
      previousActiveSurfaceId: previous[1],
      nextIds: next[0],
      nextActiveSurfaceId: next[1],
    });
    expect(shape(result.layout)).toEqual(expected);
    expect(result.activeSurfaceId).toBe(active);
  });

  it("returns the same layout when nothing changed", () => {
    const result = reconcileRightPanelLayout(split, {
      previousIds: ["a", "b", "c"],
      previousActiveSurfaceId: "c",
      nextIds: ["a", "b", "c"],
      nextActiveSurfaceId: "c",
    });
    expect(result.layout).toBe(split);
  });

  it("restores a minimized group when one of its tabs is activated", () => {
    const minimized = minimizeRightPanelGroup(split, "g2", 1);
    const result = reconcileRightPanelLayout(minimized, {
      previousIds: ["a", "b", "c"],
      previousActiveSurfaceId: "a",
      nextIds: ["a", "b", "c"],
      nextActiveSurfaceId: "c",
    });
    expect(result.restored).toBe(true);
    expect(shape(result.layout)).toEqual([["a*,b"], [">c*"]]);
  });
});

describe("resize", () => {
  const split = moveRightPanelSurface(threeTabs, "c", {
    kind: "column",
    groupId: "g1",
    side: "right",
  });
  it.each<{ name: string; sizes: number[]; expected: number[] }>([
    { name: "normalizes weights", sizes: [3, 1], expected: [0.75, 0.25] },
    { name: "ignores a wrong count", sizes: [1, 1, 1], expected: [0.5, 0.5] },
    { name: "ignores non-positive sizes", sizes: [1, 0], expected: [0.5, 0.5] },
  ])("columns: $name", ({ sizes, expected }) => {
    expect(resizeRightPanelColumns(split, sizes).columns.map((column) => column.size)).toEqual(
      expected,
    );
  });

  it("resizes groups within one column", () => {
    const stacked = moveRightPanelSurface(threeTabs, "c", {
      kind: "split",
      groupId: "g1",
      side: "below",
    });
    const resized = resizeRightPanelGroups(stacked, "c1", [1, 3]);
    expect(resized.columns[0]!.groups.map((group) => group.size)).toEqual([0.25, 0.75]);
  });
});

describe("minimize and restore", () => {
  it.each<{
    name: string;
    layout: () => RightPanelLayout;
    minimize: string;
    between?: (layout: RightPanelLayout) => RightPanelLayout;
    expected: string[][];
  }>([
    {
      name: "restores a stacked group to its index",
      layout: () =>
        moveRightPanelSurface(threeTabs, "c", { kind: "split", groupId: "g1", side: "above" }),
      minimize: "g2",
      expected: [[">c*", "a*,b"]],
    },
    {
      name: "recreates a column the group owned, at its index",
      layout: () =>
        moveRightPanelSurface(threeTabs, "a", { kind: "column", groupId: "g1", side: "left" }),
      minimize: "g2",
      expected: [[">a*"], ["b*,c"]],
    },
    {
      name: "falls back to the end of the last column when its column is gone",
      layout: () => {
        const columns = moveRightPanelSurface(threeTabs, "c", {
          kind: "column",
          groupId: "g1",
          side: "right",
        });
        // c2 holds a stacked pair so the minimized group does not own it.
        return moveRightPanelSurface(columns, "b", { kind: "split", groupId: "g2", side: "below" });
      },
      minimize: "g3",
      between: (layout) =>
        // Moving c out of c2 empties and removes that column.
        moveRightPanelSurface(layout, "c", { kind: "join", groupId: "g1" }),
      expected: [["a,c*", ">b*"]],
    },
  ])("$name", ({ layout, minimize, between, expected }) => {
    const minimized = minimizeRightPanelGroup(layout(), minimize, 1);
    expect(minimized.minimized.map((entry) => entry.group.id)).toEqual([minimize]);
    const changed = between ? between(minimized) : minimized;
    expect(shape(restoreRightPanelGroup(changed, minimize))).toEqual(expected);
  });

  it("minimizes only the shown tab and restores it into its group", () => {
    const layout = defaultRightPanelLayout(["a", "b", "c"], "b");
    const minimized = minimizeRightPanelGroup(layout, "g1", 1);
    expect(shape(minimized)).toEqual([[">a,c*"]]);
    expect(minimized.minimized.map((entry) => entry.group.surfaceIds)).toEqual([["b"]]);
    const cardId = minimized.minimized[0]!.group.id;
    expect(shape(restoreRightPanelGroup(minimized, cardId))).toEqual([[">a,b*,c"]]);
  });

  it("queues cards in minimize order and refocuses a visible group", () => {
    const columns = moveRightPanelSurface(twoTabs, "b", {
      kind: "column",
      groupId: "g1",
      side: "right",
    });
    const first = minimizeRightPanelGroup(columns, "g2", 1);
    expect(first.focusedGroupId).toBe("g1");
    const second = minimizeRightPanelGroup(first, "g1", 2);
    expect(second.minimized.map((entry) => entry.group.id)).toEqual(["g2", "g1"]);
    expect(second.columns).toEqual([]);
    expect(second.focusedGroupId).toBeNull();
  });

  it("clears maximize when the maximized group is minimized", () => {
    const layout: RightPanelLayout = {
      ...defaultRightPanelLayout(["a"], "a"),
      maximizedGroupId: "g1",
    };
    expect(minimizeRightPanelGroup(layout, "g1", 1)).not.toHaveProperty("maximizedGroupId");
  });
});
