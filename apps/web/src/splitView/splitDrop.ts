import type { ScopedThreadRef } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { SplitEdge } from "./splitViewModel";

const DROP_AREA_ATTRIBUTE = "data-split-drop-area";
const EDGE_ZONE_FRACTION = 0.25;
const EDGE_ZONE_MAX_PX = 160;

interface DropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The edge of `rect` a point sits near enough to split there, or null in the middle. */
export function resolveSplitDropEdge(
  rect: DropRect,
  point: { readonly x: number; readonly y: number },
): SplitEdge | null {
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const zoneX = Math.min(EDGE_ZONE_MAX_PX, rect.width * EDGE_ZONE_FRACTION);
  const zoneY = Math.min(EDGE_ZONE_MAX_PX, rect.height * EDGE_ZONE_FRACTION);
  const candidates: Array<{ edge: SplitEdge; depth: number }> = [
    { edge: "left", depth: x / zoneX },
    { edge: "right", depth: (rect.width - x) / zoneX },
    { edge: "top", depth: y / zoneY },
    { edge: "bottom", depth: (rect.height - y) / zoneY },
  ];
  const nearest = candidates.reduce((best, entry) => (entry.depth < best.depth ? entry : best));
  return nearest.depth <= 1 ? nearest.edge : null;
}

/** Marks a chat area a sidebar thread can be dropped on; `paneId` anchors the new pane in a split. */
export function splitDropAreaProps(paneId: string | null) {
  return { [DROP_AREA_ATTRIBUTE]: paneId ?? "" } as const;
}

export interface SplitDropHover {
  readonly paneId: string | null;
  readonly edge: SplitEdge;
  readonly rect: DropRect;
}

let hover: SplitDropHover | null = null;
const listeners = new Set<() => void>();

function setHover(next: SplitDropHover | null) {
  if (
    hover === next ||
    (hover !== null &&
      next !== null &&
      hover.edge === next.edge &&
      hover.paneId === next.paneId &&
      hover.rect.left === next.rect.left &&
      hover.rect.top === next.rect.top &&
      hover.rect.width === next.rect.width &&
      hover.rect.height === next.rect.height)
  ) {
    return;
  }
  hover = next;
  for (const listener of listeners) listener();
}

export function useSplitDropHover(): SplitDropHover | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hover,
    () => null,
  );
}

function resolveHover(element: Element | null, point: { x: number; y: number }) {
  const area = element?.closest(`[${DROP_AREA_ATTRIBUTE}]`);
  if (!area) return null;
  const bounds = area.getBoundingClientRect();
  const rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  const edge = resolveSplitDropEdge(rect, point);
  if (edge === null) return null;
  return { paneId: area.getAttribute(DROP_AREA_ATTRIBUTE) || null, edge, rect };
}

/** Tracks a dragged sidebar thread over chat areas; `element` is what the pointer is over. */
export function moveSplitDrop(element: Element | null, point: { x: number; y: number }): void {
  setHover(resolveHover(element, point));
}

export function endSplitDrop(): void {
  setHover(null);
}

type SplitDropHandler = (
  threadRef: ScopedThreadRef,
  edge: SplitEdge,
  anchorPaneId: string | null,
) => void;

let dropHandler: SplitDropHandler | null = null;

export function registerSplitDropHandler(handler: SplitDropHandler): () => void {
  dropHandler = handler;
  return () => {
    if (dropHandler === handler) dropHandler = null;
  };
}

/** Opens a single dropped thread in a split at the hovered edge; false when no edge is hovered. */
export function dropSplit(
  element: Element | null,
  point: { x: number; y: number },
  threads: ReadonlyArray<ScopedThreadRef>,
): boolean {
  const target = resolveHover(element, point);
  setHover(null);
  const threadRef = threads.length === 1 ? threads[0] : undefined;
  if (target === null || threadRef === undefined || dropHandler === null) return false;
  dropHandler(threadRef, target.edge, target.paneId);
  return true;
}
