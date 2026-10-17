import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";
import { moveTerminalToDrawer, moveTerminalToRightPanel } from "./terminalPlacement";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "./terminalUiStateStore";

const THREAD_REF = scopeThreadRef("environment-a" as never, ThreadId.make("thread-1"));

const panelTerminalIds = () =>
  selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    THREAD_REF,
  ).surfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : []));
const drawerState = () =>
  selectThreadTerminalUiState(
    useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
    THREAD_REF,
  );

describe("terminalPlacement", () => {
  beforeEach(() => {
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {},
      suppressedTerminalIdsByThreadKey: {},
    });
    useRightPanelStore.setState({
      byThreadKey: {},
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByThreadKey: {},
      closeRevisionByThreadKey: {},
    });
  });

  it("moves a panel terminal into the open drawer and back", () => {
    useRightPanelStore.getState().openTerminal(THREAD_REF, "term-1");

    moveTerminalToDrawer(THREAD_REF, "term-1");
    expect(panelTerminalIds()).toEqual([]);
    expect(drawerState()).toMatchObject({
      terminalOpen: true,
      terminalIds: ["term-1"],
      activeTerminalId: "term-1",
    });

    moveTerminalToRightPanel(THREAD_REF, "term-1");
    expect(panelTerminalIds()).toEqual(["term-1"]);
    expect(drawerState()).toMatchObject({ terminalOpen: false, terminalIds: [] });

    // A later move back must not be hidden by the drawer's closed-id suppression.
    moveTerminalToDrawer(THREAD_REF, "term-1");
    useTerminalUiStateStore.getState().reconcileTerminalIds(THREAD_REF, ["term-1"]);
    expect(drawerState().terminalIds).toEqual(["term-1"]);
  });

  it("moves only the requested terminal out of a split panel surface", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(THREAD_REF, "term-1");
    store.splitTerminal(THREAD_REF, "terminal:term-1", "term-2");

    moveTerminalToDrawer(THREAD_REF, "term-2");
    expect(panelTerminalIds()).toEqual(["term-1"]);
    expect(drawerState().terminalIds).toEqual(["term-2"]);
  });
});
