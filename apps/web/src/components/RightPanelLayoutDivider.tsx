import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import { cn } from "~/lib/utils";

const RIGHT_PANEL_MIN_COLUMN_WIDTH = 240;
const RIGHT_PANEL_MIN_GROUP_HEIGHT = 140;
const KEYBOARD_STEP = 24;

interface Drag {
  pointerId: number;
  start: number;
  before: HTMLElement;
  after: HTMLElement;
  beforeSize: number;
  afterSize: number;
  weights: readonly [number, number];
  next: readonly [number, number];
}

/**
 * Splits the space between its two neighbouring panes. A drag writes flex weights straight to the
 * DOM each frame and commits them once on release, so moving it never rerenders the panel.
 */
export function RightPanelLayoutDivider(props: {
  readonly orientation: "vertical" | "horizontal";
  readonly weights: readonly [number, number];
  readonly label: string;
  readonly onCommit: (weights: readonly [number, number]) => void;
}) {
  const vertical = props.orientation === "vertical";
  const minimum = vertical ? RIGHT_PANEL_MIN_COLUMN_WIDTH : RIGHT_PANEL_MIN_GROUP_HEIGHT;
  const dragRef = useRef<Drag | null>(null);

  const neighbours = (handle: HTMLElement) => {
    const before = handle.previousElementSibling;
    const after = handle.nextElementSibling;
    if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) return null;
    const size = (element: HTMLElement) => (vertical ? element.offsetWidth : element.offsetHeight);
    return { before, after, beforeSize: size(before), afterSize: size(after) };
  };

  const split = (
    beforeSize: number,
    afterSize: number,
    delta: number,
  ): readonly [number, number] => {
    const total = beforeSize + afterSize;
    const sum = props.weights[0] + props.weights[1];
    if (total <= 0) return props.weights;
    const low = Math.min(minimum, total / 2);
    const nextBefore = Math.max(low, Math.min(total - low, beforeSize + delta));
    return [(nextBefore / total) * sum, ((total - nextBefore) / total) * sum];
  };

  const apply = (drag: Drag, next: readonly [number, number]) => {
    drag.before.style.flexGrow = String(next[0]);
    drag.after.style.flexGrow = String(next[1]);
    drag.next = next;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const found = neighbours(event.currentTarget);
    if (!found) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: vertical ? event.clientX : event.clientY,
      ...found,
      weights: props.weights,
      next: props.weights,
    };
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = (vertical ? event.clientX : event.clientY) - drag.start;
    apply(drag, split(drag.beforeSize, drag.afterSize, delta));
  };

  const finish = (commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    if (!commit) {
      apply(drag, drag.weights);
      return;
    }
    if (drag.next[0] !== drag.weights[0] || drag.next[1] !== drag.weights[1]) {
      props.onCommit(drag.next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = vertical ? "ArrowLeft" : "ArrowUp";
    const increase = vertical ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrease && event.key !== increase) return;
    const found = neighbours(event.currentTarget);
    if (!found) return;
    event.preventDefault();
    props.onCommit(
      split(
        found.beforeSize,
        found.afterSize,
        event.key === increase ? KEYBOARD_STEP : -KEYBOARD_STEP,
      ),
    );
  };

  const percent = Math.round((props.weights[0] / (props.weights[0] + props.weights[1])) * 100);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation={props.orientation}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-right-panel-divider={props.orientation}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(true)}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative z-30 shrink-0 touch-none select-none outline-none",
        vertical ? "w-px cursor-col-resize bg-border" : "h-px cursor-row-resize bg-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-auto absolute",
          vertical ? "inset-y-0 -left-1 w-2" : "inset-x-0 -top-1 h-2",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-transparent transition-colors duration-150 group-hover:bg-primary/60 group-focus-visible:bg-primary/60 group-active:bg-primary/60",
          vertical ? "inset-y-0 -left-px w-[3px]" : "inset-x-0 -top-px h-[3px]",
        )}
      />
    </div>
  );
}
