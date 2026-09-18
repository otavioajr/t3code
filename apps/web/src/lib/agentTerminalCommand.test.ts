import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_TERMINAL_ID,
  isAgentWorkspaceTerminalId,
  isSidebarWorkspaceSurface,
} from "./agentTerminalCommand";

describe("isAgentWorkspaceTerminalId", () => {
  it("identifies only the PTY reserved for the Chat|Terminal workspace", () => {
    expect(isAgentWorkspaceTerminalId(AGENT_TERMINAL_ID)).toBe(true);
    expect(isAgentWorkspaceTerminalId("term-1")).toBe(false);
    expect(isAgentWorkspaceTerminalId("term-agent-copy")).toBe(false);
  });
});

describe("isSidebarWorkspaceSurface", () => {
  it("accepts only chat and terminal", () => {
    expect(isSidebarWorkspaceSurface("chat")).toBe(true);
    expect(isSidebarWorkspaceSurface("terminal")).toBe(true);
    expect(isSidebarWorkspaceSurface("drawer")).toBe(false);
  });
});
