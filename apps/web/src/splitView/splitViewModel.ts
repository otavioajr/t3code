import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import type { ThreadRouteTarget } from "../threadRoutes";

export const MAX_SPLIT_PANES = 4;

export type SplitDirection = "horizontal" | "vertical";
export type SplitEdge = "left" | "right" | "top" | "bottom";

export interface SplitPane {
  readonly id: string;
  /** Null until the pane's first thread arrives through the route (a new thread in a new pane). */
  readonly target: ThreadRouteTarget | null;
}

/**
 * A window-level layout of 2–4 chat panes, or none for the single view. The route always shows the
 * focused pane's thread; `routeKey` is the route this state last followed.
 */
export interface SplitViewState {
  readonly panes: ReadonlyArray<SplitPane>;
  readonly direction: SplitDirection;
  readonly sizes: ReadonlyArray<number>;
  readonly focusedPaneId: string | null;
  readonly routeKey: string | null;
}

export const EMPTY_SPLIT_VIEW: SplitViewState = {
  panes: [],
  direction: "horizontal",
  sizes: [],
  focusedPaneId: null,
  routeKey: null,
};

export function splitTargetKey(target: ThreadRouteTarget | null): string | null {
  if (target === null) return null;
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

export function isSplitActive(state: SplitViewState): boolean {
  return state.panes.length >= 2;
}

function equalSizes(count: number): ReadonlyArray<number> {
  return Array.from({ length: count }, () => 1 / count);
}

function findPaneIndex(state: SplitViewState, paneId: string | null): number {
  return paneId === null ? -1 : state.panes.findIndex((pane) => pane.id === paneId);
}

function findTargetPane(
  state: Pick<SplitViewState, "panes">,
  key: string | null,
): SplitPane | undefined {
  return key === null ? undefined : state.panes.find((pane) => splitTargetKey(pane.target) === key);
}

/** The pane that shows the route: the one holding the route's thread, else the focused pane. */
export function resolveRoutePaneId(
  state: Pick<SplitViewState, "panes" | "focusedPaneId">,
  routeKey: string | null,
): string | null {
  return findTargetPane(state, routeKey)?.id ?? state.focusedPaneId;
}

function edgeDirection(edge: SplitEdge): SplitDirection {
  return edge === "left" || edge === "right" ? "horizontal" : "vertical";
}

/**
 * Opens `target` in a new pane beside the anchor pane (or `current`, when nothing is split yet).
 * A target already shown just gets focus; a full layout is left as is. One axis at a time: a
 * split along the other axis turns the whole layout.
 */
export function openSplitPane(
  state: SplitViewState,
  input: {
    readonly current: ThreadRouteTarget | null;
    readonly target: ThreadRouteTarget | null;
    readonly edge: SplitEdge;
    readonly newPaneIds: readonly [string, string];
    /** The pane the new one opens beside; the focused pane by default. */
    readonly anchorPaneId?: string | null;
  },
): SplitViewState {
  const targetKey = splitTargetKey(input.target);
  const existing = findTargetPane(state, targetKey);
  if (existing) return { ...state, focusedPaneId: existing.id };
  let panes = state.panes;
  let anchorIndex = findPaneIndex(state, input.anchorPaneId ?? state.focusedPaneId);
  let routeKey = state.routeKey;
  if (!isSplitActive(state)) {
    if (input.current === null || splitTargetKey(input.current) === targetKey) return state;
    panes = [{ id: input.newPaneIds[0], target: input.current }];
    anchorIndex = 0;
    routeKey = splitTargetKey(input.current);
  }
  if (panes.length >= MAX_SPLIT_PANES) return state;
  const pane: SplitPane = { id: input.newPaneIds[1], target: input.target };
  const before = input.edge === "left" || input.edge === "top";
  const insertAt = Math.max(0, anchorIndex) + (before ? 0 : 1);
  const nextPanes = [...panes.slice(0, insertAt), pane, ...panes.slice(insertAt)];
  return {
    panes: nextPanes,
    direction: edgeDirection(input.edge),
    sizes: equalSizes(nextPanes.length),
    focusedPaneId: pane.id,
    routeKey,
  };
}

export function focusSplitPane(state: SplitViewState, paneId: string): SplitViewState {
  if (findPaneIndex(state, paneId) === -1 || state.focusedPaneId === paneId) return state;
  return { ...state, focusedPaneId: paneId };
}

export function focusAdjacentSplitPane(state: SplitViewState, step: 1 | -1): SplitViewState {
  if (!isSplitActive(state)) return state;
  const index = Math.max(0, findPaneIndex(state, state.focusedPaneId));
  const next = state.panes[(index + step + state.panes.length) % state.panes.length];
  return next ? focusSplitPane(state, next.id) : state;
}

/** Moves the focused pane one step along the layout's axis, or turns the layout to the other axis. */
export function moveFocusedSplitPane(state: SplitViewState, edge: SplitEdge): SplitViewState {
  const index = findPaneIndex(state, state.focusedPaneId);
  const pane = state.panes[index];
  if (!isSplitActive(state) || !pane) return state;
  const toStart = edge === "left" || edge === "top";
  const direction = edgeDirection(edge);
  if (direction !== state.direction) {
    const rest = state.panes.filter((entry) => entry.id !== pane.id);
    return {
      ...state,
      direction,
      panes: toStart ? [pane, ...rest] : [...rest, pane],
      sizes: equalSizes(state.panes.length),
    };
  }
  const swapWith = index + (toStart ? -1 : 1);
  const other = state.panes[swapWith];
  if (!other) return state;
  const panes = [...state.panes];
  panes[index] = other;
  panes[swapWith] = pane;
  return { ...state, panes };
}

/** Closes a pane; with one pane left the layout returns to the single view, focused on it. */
export function closeSplitPane(state: SplitViewState, paneId: string): SplitViewState {
  const index = findPaneIndex(state, paneId);
  if (index === -1) return state;
  const panes = state.panes.filter((pane) => pane.id !== paneId);
  const focusedPaneId =
    state.focusedPaneId === paneId
      ? (panes[Math.min(index, panes.length - 1)]?.id ?? null)
      : state.focusedPaneId;
  if (panes.length < 2) {
    return { ...EMPTY_SPLIT_VIEW, direction: state.direction };
  }
  return { ...state, panes, focusedPaneId, sizes: equalSizes(panes.length) };
}

/** The thread the single view should show after closing `paneId`. */
export function survivingSplitTarget(
  state: SplitViewState,
  paneId: string,
): ThreadRouteTarget | null {
  const next = closeSplitPane(state, paneId);
  if (isSplitActive(next)) {
    return next.panes.find((pane) => pane.id === next.focusedPaneId)?.target ?? null;
  }
  return state.panes.find((pane) => pane.id !== paneId)?.target ?? null;
}

/**
 * Follows a route change: a route to a thread some pane shows focuses that pane; any other thread
 * replaces the focused pane's. Repeated calls for the same route change nothing.
 */
export function syncSplitRoute(
  state: SplitViewState,
  target: ThreadRouteTarget | null,
): SplitViewState {
  const routeKey = splitTargetKey(target);
  if (!isSplitActive(state) || routeKey === null || routeKey === state.routeKey) return state;
  const existing = findTargetPane(state, routeKey);
  if (existing) return { ...state, focusedPaneId: existing.id, routeKey };
  const focusedIndex = Math.max(0, findPaneIndex(state, state.focusedPaneId));
  const panes = state.panes.map((pane, index) =>
    index === focusedIndex ? { ...pane, target } : pane,
  );
  return { ...state, panes, focusedPaneId: panes[focusedIndex]?.id ?? null, routeKey };
}

/** Sets the flex weights of the two panes beside the divider after pane `index`. */
export function setSplitPaneWeights(
  state: SplitViewState,
  index: number,
  weights: readonly [number, number],
): SplitViewState {
  if (state.sizes[index] === undefined || state.sizes[index + 1] === undefined) return state;
  const sizes = [...state.sizes];
  sizes[index] = weights[0];
  sizes[index + 1] = weights[1];
  return { ...state, sizes };
}

/** The pane touching the window's top-right corner, which hosts the desktop title bar controls. */
export function titleBarPaneId(state: Pick<SplitViewState, "panes" | "direction">): string | null {
  const pane = state.direction === "horizontal" ? state.panes.at(-1) : state.panes[0];
  return pane?.id ?? null;
}

/** Restores persisted state, dropping anything malformed back to the single view. */
export function sanitizeSplitViewState(value: unknown): SplitViewState {
  if (!value || typeof value !== "object") return EMPTY_SPLIT_VIEW;
  const candidate = value as Partial<SplitViewState>;
  const panes = Array.isArray(candidate.panes)
    ? candidate.panes.filter(
        (pane): pane is SplitPane =>
          !!pane &&
          typeof pane.id === "string" &&
          (pane.target === null ||
            (typeof pane.target === "object" &&
              (pane.target.kind === "server" || pane.target.kind === "draft"))),
      )
    : [];
  if (panes.length < 2 || panes.length > MAX_SPLIT_PANES) return EMPTY_SPLIT_VIEW;
  const sizes =
    Array.isArray(candidate.sizes) &&
    candidate.sizes.length === panes.length &&
    candidate.sizes.every((size) => typeof size === "number" && size > 0)
      ? candidate.sizes
      : equalSizes(panes.length);
  return {
    panes,
    direction: candidate.direction === "vertical" ? "vertical" : "horizontal",
    sizes,
    focusedPaneId:
      panes.find((pane) => pane.id === candidate.focusedPaneId)?.id ?? panes[0]?.id ?? null,
    routeKey: null,
  };
}
