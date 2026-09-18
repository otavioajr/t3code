/** Dedicated PTY for the native agent TUI; regular thread shells keep `term-N`. */
export const AGENT_TERMINAL_ID = "term-agent";

/** Keeps the workspace-only agent PTY out of Mod+J and right-panel terminal collections. */
export function isAgentWorkspaceTerminalId(terminalId: string): boolean {
  return terminalId === AGENT_TERMINAL_ID;
}

/** Sidebar switch: same thread, chat bubbles vs its resumable native agent TUI. */
export type SidebarWorkspaceSurface = "chat" | "terminal";

export function isSidebarWorkspaceSurface(value: unknown): value is SidebarWorkspaceSurface {
  return value === "chat" || value === "terminal";
}
