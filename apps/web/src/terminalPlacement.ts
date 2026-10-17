import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";
import { useTerminalUiStateStore } from "./terminalUiStateStore";

/**
 * Moves a running terminal session between the right panel and the bottom
 * drawer. Only the client placement changes; the PTY session keeps running.
 */
export function moveTerminalToDrawer(threadRef: ScopedThreadRef, terminalId: string): void {
  const panelState = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  const surface = panelState.surfaces.find(
    (entry) => entry.kind === "terminal" && entry.terminalIds.includes(terminalId),
  );
  if (!surface) return;
  useRightPanelStore.getState().closeTerminal(threadRef, surface.id, terminalId);
  useTerminalUiStateStore.getState().ensureTerminal(threadRef, terminalId, { open: true });
}

export function moveTerminalToRightPanel(threadRef: ScopedThreadRef, terminalId: string): void {
  useTerminalUiStateStore.getState().closeTerminal(threadRef, terminalId);
  useRightPanelStore.getState().openTerminal(threadRef, terminalId);
}
