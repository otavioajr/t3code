import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { registerSplitDropHandler, useSplitDropHover } from "../../splitView/splitDrop";
import { openThreadInSplit } from "../../splitView/splitViewStore";

/** Opens sidebar threads dropped on a chat edge in a split, and shows where one would land. */
export function SplitDropIndicator() {
  const router = useRouter();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the router-bound handler the sidebar drag calls on drop
  useEffect(
    () =>
      registerSplitDropHandler((threadRef, edge, anchorPaneId) => {
        openThreadInSplit(router, { kind: "server", threadRef }, edge, anchorPaneId);
      }),
    [router],
  );
  const hover = useSplitDropHover();
  if (hover === null) return null;
  const { rect, edge } = hover;
  const horizontal = edge === "left" || edge === "right";
  const width = horizontal ? rect.width / 2 : rect.width;
  const height = horizontal ? rect.height : rect.height / 2;
  return (
    <div
      aria-hidden
      data-split-drop-indicator={edge}
      className="pointer-events-none fixed z-40 rounded-lg border-2 border-primary/60 bg-primary/10"
      style={{
        left: edge === "right" ? rect.left + rect.width / 2 : rect.left,
        top: edge === "bottom" ? rect.top + rect.height / 2 : rect.top,
        width,
        height,
      }}
    />
  );
}
