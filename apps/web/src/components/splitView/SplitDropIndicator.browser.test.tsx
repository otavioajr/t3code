import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag,
  threadContextDropTargetProps,
} from "../chat/threadContextDrag";
import { registerSplitDropHandler, splitDropAreaProps } from "../../splitView/splitDrop";
import { SplitDropIndicator } from "./SplitDropIndicator";

const dragged: ScopedThreadRef = {
  environmentId: "environment-local" as EnvironmentId,
  threadId: "thread-dragged" as ThreadId,
};
const label = { title: "Dragged", count: 1 };

function ChatArea() {
  return (
    <>
      <div
        {...splitDropAreaProps(null)}
        style={{ position: "fixed", left: 0, top: 0, width: 400, height: 300 }}
      >
        <div
          {...threadContextDropTargetProps()}
          data-testid="composer"
          style={{ position: "absolute", left: 150, top: 120, width: 100, height: 60 }}
        />
      </div>
      <SplitDropIndicator />
    </>
  );
}

it("shows where a sidebar thread dragged to a chat edge would split, and opens it there", async () => {
  await using _screen = await render(<ChatArea />);
  const opened: Array<[ThreadId, string]> = [];
  using _handler = {
    [Symbol.dispose]: registerSplitDropHandler((threadRef, edge) => {
      opened.push([threadRef.threadId, edge]);
    }),
  };

  await act(() => moveThreadContextDrag({ x: 390, y: 150 }, label));
  expect(
    document
      .querySelector("[data-split-drop-indicator]")
      ?.getAttribute("data-split-drop-indicator"),
  ).toBe("right");

  // Over the composer the thread joins the chat as context instead.
  await act(() => moveThreadContextDrag({ x: 200, y: 150 }, label));
  expect(document.querySelector("[data-split-drop-indicator]")).toBeNull();

  await act(() => moveThreadContextDrag({ x: 200, y: 10 }, label));
  expect(document.querySelector("[data-split-drop-indicator='top']")).not.toBeNull();
  await act(() => {
    dropThreadContext({ x: 200, y: 10 }, [dragged]);
    endThreadContextDrag();
  });

  expect(opened).toEqual([["thread-dragged", "top"]]);
  expect(document.querySelector("[data-split-drop-indicator]")).toBeNull();
});
