import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  closeSplitPane,
  EMPTY_SPLIT_VIEW,
  focusAdjacentSplitPane,
  isSplitActive,
  MAX_SPLIT_PANES,
  moveFocusedSplitPane,
  openSplitPane,
  resolveRoutePaneId,
  sanitizeSplitViewState,
  splitTargetKey,
  survivingSplitTarget,
  syncSplitRoute,
  titleBarPaneId,
  type SplitEdge,
  type SplitViewState,
} from "./splitViewModel";

const thread = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: scopeThreadRef("env" as EnvironmentId, id as ThreadId),
});
const draft = (id: string): ThreadRouteTarget => ({ kind: "draft", draftId: id as DraftId });

let ids = 0;
function open(
  state: SplitViewState,
  current: ThreadRouteTarget | null,
  target: ThreadRouteTarget | null,
  edge: SplitEdge = "right",
  anchorPaneId?: string,
) {
  return openSplitPane(state, {
    current,
    target,
    edge,
    anchorPaneId: anchorPaneId ?? null,
    newPaneIds: [`p${++ids}`, `p${++ids}`],
  });
}

/** Panes as thread ids in order, with the focused pane marked `>`. */
function shape(state: SplitViewState) {
  return state.panes.map((pane) => {
    const key = splitTargetKey(pane.target);
    const label = key === null ? "empty" : key.startsWith("draft:") ? key : key.split(":").at(-1);
    return `${pane.id === state.focusedPaneId ? ">" : ""}${label}`;
  });
}

const twoPanes = open(EMPTY_SPLIT_VIEW, thread("a"), thread("b"));

describe("openSplitPane", () => {
  it.each<{ name: string; edge: SplitEdge; expected: string[]; direction: string }>([
    {
      name: "right of the current thread",
      edge: "right",
      expected: ["a", ">b"],
      direction: "horizontal",
    },
    { name: "left of it", edge: "left", expected: [">b", "a"], direction: "horizontal" },
    { name: "below it", edge: "bottom", expected: ["a", ">b"], direction: "vertical" },
    { name: "above it", edge: "top", expected: [">b", "a"], direction: "vertical" },
  ])("opens a thread $name", ({ edge, expected, direction }) => {
    const state = open(EMPTY_SPLIT_VIEW, thread("a"), thread("b"), edge);
    expect(shape(state)).toEqual(expected);
    expect(state.direction).toBe(direction);
    expect(state.sizes).toEqual([0.5, 0.5]);
    expect(state.routeKey).toBe(splitTargetKey(thread("a")));
  });

  it("opens beside the focused pane, or the anchor pane", () => {
    const three = open(twoPanes, thread("b"), thread("c"));
    expect(shape(three)).toEqual(["a", "b", ">c"]);
    const anchored = open(twoPanes, thread("b"), thread("c"), "left", twoPanes.panes[0]!.id);
    expect(shape(anchored)).toEqual([">c", "a", "b"]);
  });

  it("only focuses a thread some pane already shows", () => {
    const state = open(twoPanes, thread("b"), thread("a"));
    expect(shape(state)).toEqual([">a", "b"]);
  });

  it("does not split a thread beside itself, or without a current thread", () => {
    expect(open(EMPTY_SPLIT_VIEW, thread("a"), thread("a"))).toBe(EMPTY_SPLIT_VIEW);
    expect(open(EMPTY_SPLIT_VIEW, null, thread("a"))).toBe(EMPTY_SPLIT_VIEW);
  });

  it("opens an empty pane for a new thread", () => {
    expect(shape(open(EMPTY_SPLIT_VIEW, thread("a"), null))).toEqual(["a", ">empty"]);
  });

  it(`stops at ${MAX_SPLIT_PANES} panes`, () => {
    let state = twoPanes;
    for (const id of ["c", "d", "e"]) state = open(state, null, thread(id));
    expect(shape(state)).toEqual(["a", "b", "c", ">d"]);
  });

  it("turns the whole layout when splitting along the other axis", () => {
    const state = open(twoPanes, thread("b"), thread("c"), "bottom");
    expect(state.direction).toBe("vertical");
    expect(shape(state)).toEqual(["a", "b", ">c"]);
  });
});

describe("focusAdjacentSplitPane", () => {
  it("cycles through panes in both directions", () => {
    const three = open(twoPanes, thread("b"), thread("c"));
    expect(shape(focusAdjacentSplitPane(three, 1))).toEqual([">a", "b", "c"]);
    expect(shape(focusAdjacentSplitPane(three, -1))).toEqual(["a", ">b", "c"]);
  });

  it("does nothing in the single view", () => {
    expect(focusAdjacentSplitPane(EMPTY_SPLIT_VIEW, 1)).toBe(EMPTY_SPLIT_VIEW);
  });
});

describe("moveFocusedSplitPane", () => {
  const three = open(twoPanes, thread("b"), thread("c"));

  it("swaps along the layout's axis and stops at the end", () => {
    expect(shape(moveFocusedSplitPane(three, "left"))).toEqual(["a", ">c", "b"]);
    expect(moveFocusedSplitPane(three, "right")).toBe(three);
  });

  it("turns the layout and moves the pane to that end on the other axis", () => {
    const up = moveFocusedSplitPane(three, "top");
    expect(up.direction).toBe("vertical");
    expect(shape(up)).toEqual([">c", "a", "b"]);
  });
});

describe("closeSplitPane", () => {
  const three = open(twoPanes, thread("b"), thread("c"));

  it("focuses the neighbour of a closed focused pane", () => {
    const state = closeSplitPane(three, three.panes[2]!.id);
    expect(shape(state)).toEqual(["a", ">b"]);
    expect(state.sizes).toEqual([0.5, 0.5]);
  });

  it("returns to the single view with one pane left, showing the survivor", () => {
    const closing = twoPanes.panes[1]!.id;
    expect(isSplitActive(closeSplitPane(twoPanes, closing))).toBe(false);
    expect(survivingSplitTarget(twoPanes, closing)).toEqual(thread("a"));
    expect(survivingSplitTarget(three, three.panes[2]!.id)).toEqual(thread("b"));
  });
});

describe("syncSplitRoute", () => {
  it("focuses the pane that shows the routed thread", () => {
    const routedToB = syncSplitRoute(twoPanes, thread("b"));
    expect(shape(routedToB)).toEqual(["a", ">b"]);
    expect(shape(syncSplitRoute(routedToB, thread("a")))).toEqual([">a", "b"]);
  });

  it("puts any other thread in the focused pane", () => {
    expect(shape(syncSplitRoute(twoPanes, thread("c")))).toEqual(["a", ">c"]);
    expect(shape(syncSplitRoute(twoPanes, draft("d")))).toEqual(["a", ">draft:d"]);
  });

  it("fills a new empty pane with the thread the route opens next", () => {
    const withEmpty = open(EMPTY_SPLIT_VIEW, thread("a"), null);
    // The route still shows the old thread: nothing moves.
    expect(syncSplitRoute(withEmpty, thread("a"))).toBe(withEmpty);
    expect(shape(syncSplitRoute(withEmpty, draft("new")))).toEqual(["a", ">draft:new"]);
  });

  it("follows each route change once", () => {
    const synced = syncSplitRoute(twoPanes, thread("c"));
    expect(syncSplitRoute(synced, thread("c"))).toBe(synced);
    expect(syncSplitRoute(EMPTY_SPLIT_VIEW, thread("c"))).toBe(EMPTY_SPLIT_VIEW);
  });

  it("shows the route in the pane focus is moving to until the route follows", () => {
    // Focus moved to b before the route left a: a keeps showing the route.
    const focusMoving = { ...twoPanes, focusedPaneId: twoPanes.panes[1]!.id };
    const routeKey = splitTargetKey(thread("a"));
    expect(resolveRoutePaneId(focusMoving, routeKey)).toBe(twoPanes.panes[0]!.id);
    expect(resolveRoutePaneId(focusMoving, splitTargetKey(thread("new")))).toBe(
      twoPanes.panes[1]!.id,
    );
  });
});

describe("titleBarPaneId", () => {
  it("is the last pane side by side and the first pane stacked", () => {
    expect(titleBarPaneId(twoPanes)).toBe(twoPanes.panes[1]!.id);
    expect(titleBarPaneId({ ...twoPanes, direction: "vertical" })).toBe(twoPanes.panes[0]!.id);
  });
});

describe("sanitizeSplitViewState", () => {
  it("keeps a valid layout and forgets the followed route", () => {
    const restored = sanitizeSplitViewState(JSON.parse(JSON.stringify(twoPanes)));
    expect(shape(restored)).toEqual(shape(twoPanes));
    expect(restored.routeKey).toBeNull();
  });

  it("drops malformed state back to the single view", () => {
    expect(sanitizeSplitViewState({ panes: [{ id: "x", target: null }] })).toBe(EMPTY_SPLIT_VIEW);
    expect(sanitizeSplitViewState("nope")).toBe(EMPTY_SPLIT_VIEW);
  });
});
