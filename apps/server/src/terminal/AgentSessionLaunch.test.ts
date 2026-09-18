import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveAgentSessionCommand } from "./AgentSessionLaunch.ts";

describe("resolveAgentSessionCommand", () => {
  it("builds Claude Code's interactive resume command", () => {
    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("claudeAgent"),
        config: { binaryPath: "/opt/claude" },
        resumeCursor: { resume: "550e8400-e29b-41d4-a716-446655440000" },
      }),
    ).toEqual({
      command: "/opt/claude",
      args: ["--resume", "550e8400-e29b-41d4-a716-446655440000"],
    });
  });

  it("builds Codex, OpenCode, and Grok resume commands", () => {
    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("codex"),
        config: {},
        resumeCursor: { threadId: "codex-thread" },
      }),
    ).toEqual({ command: "codex", args: ["resume", "codex-thread"] });

    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("cursor"),
        config: {},
        resumeCursor: { sessionId: "cursor-session" },
      }),
    ).toBeNull();

    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("opencode"),
        config: {},
        resumeCursor: { sessionId: "opencode-session" },
      }),
    ).toEqual({ command: "opencode", args: ["--session", "opencode-session"] });

    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("grok"),
        config: { binaryPath: "/opt/grok" },
        resumeCursor: { sessionId: "grok-session" },
      }),
    ).toEqual({ command: "/opt/grok", args: ["--resume", "grok-session"] });

    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("antigravity"),
        config: { binaryPath: "/opt/agy-acp" },
        resumeCursor: { sessionId: "antigravity-session" },
      }),
    ).toEqual({ command: "agy", args: ["--conversation", "antigravity-session"] });
  });

  it("rejects unsupported providers and missing cursors", () => {
    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("opencode"),
        config: { serverUrl: "https://opencode.example.test" },
        resumeCursor: { sessionId: "remote-session" },
      }),
    ).toBeNull();
    expect(
      resolveAgentSessionCommand({
        provider: ProviderDriverKind.make("claudeAgent"),
        config: {},
        resumeCursor: {},
      }),
    ).toBeNull();
  });
});
