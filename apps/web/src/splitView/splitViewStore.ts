import type { AnyRouter } from "@tanstack/react-router";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  closeSplitPane,
  EMPTY_SPLIT_VIEW,
  focusAdjacentSplitPane,
  focusSplitPane,
  isSplitActive,
  moveFocusedSplitPane,
  openSplitPane,
  sanitizeSplitViewState,
  setSplitPaneWeights,
  splitTargetKey,
  survivingSplitTarget,
  type SplitEdge,
  type SplitViewState,
} from "./splitViewModel";

const SPLIT_VIEW_STORAGE_KEY = "t3code:split-view:v1";

export const useSplitViewStore = create<SplitViewState>()(
  persist(() => EMPTY_SPLIT_VIEW, {
    name: SPLIT_VIEW_STORAGE_KEY,
    version: 1,
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    partialize: ({ panes, direction, sizes, focusedPaneId }) => ({
      panes,
      direction,
      sizes,
      focusedPaneId,
    }),
    merge: (persisted) => sanitizeSplitViewState(persisted),
  }),
);

export function updateSplitView(update: (state: SplitViewState) => SplitViewState): SplitViewState {
  const previous = useSplitViewStore.getState();
  const next = update(previous);
  if (next !== previous) useSplitViewStore.setState(next, true);
  return next;
}

// Ids only need to be unique among the persisted panes.
let paneSequence = 0;
function nextPaneId(): string {
  paneSequence += 1;
  return `pane-${Date.now().toString(36)}-${paneSequence}`;
}

function readRouteTarget(router: AnyRouter): ThreadRouteTarget | null {
  return resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
}

function navigateToTarget(router: AnyRouter, target: ThreadRouteTarget | null): void {
  if (target === null || splitTargetKey(target) === splitTargetKey(readRouteTarget(router))) return;
  void (target.kind === "server"
    ? router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
      })
    : router.navigate({ to: "/draft/$draftId", params: { draftId: target.draftId } }));
}

function focusedTarget(state: SplitViewState): ThreadRouteTarget | null {
  return state.panes.find((pane) => pane.id === state.focusedPaneId)?.target ?? null;
}

/**
 * Opens `target` in a new pane at `edge` of the focused pane and routes to it. A null target opens
 * an empty pane; returns whether a pane opened (or got focus), so the caller can start a thread.
 */
export function openThreadInSplit(
  router: AnyRouter,
  target: ThreadRouteTarget | null,
  edge: SplitEdge,
  anchorPaneId: string | null = null,
): boolean {
  const previous = useSplitViewStore.getState();
  const next = updateSplitView((state) =>
    openSplitPane(state, {
      current: readRouteTarget(router),
      target,
      edge,
      anchorPaneId,
      newPaneIds: [nextPaneId(), nextPaneId()],
    }),
  );
  if (next === previous) return false;
  navigateToTarget(router, focusedTarget(next));
  return true;
}

export function focusPane(router: AnyRouter, paneId: string): void {
  navigateToTarget(
    router,
    focusedTarget(updateSplitView((state) => focusSplitPane(state, paneId))),
  );
}

export function focusAdjacentPane(router: AnyRouter, step: 1 | -1): void {
  navigateToTarget(
    router,
    focusedTarget(updateSplitView((state) => focusAdjacentSplitPane(state, step))),
  );
}

export function moveFocusedPane(edge: SplitEdge): void {
  updateSplitView((state) => moveFocusedSplitPane(state, edge));
}

export function closePane(router: AnyRouter, paneId: string): void {
  const surviving = survivingSplitTarget(useSplitViewStore.getState(), paneId);
  updateSplitView((state) => closeSplitPane(state, paneId));
  navigateToTarget(router, surviving);
}

/** Back to the single view, showing the focused pane's thread (the route's). */
export function closeSplit(): void {
  updateSplitView((state) =>
    isSplitActive(state) ? { ...EMPTY_SPLIT_VIEW, direction: state.direction } : state,
  );
}

export function setPaneWeights(index: number, weights: readonly [number, number]): void {
  updateSplitView((state) => setSplitPaneWeights(state, index, weights));
}
