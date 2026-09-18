import {
  TerminalAgentSessionUnavailableError,
  ThreadId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type TerminalOpenAgentSessionInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import type { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import type { ServerSettingsService } from "../serverSettings.ts";

export interface AgentSessionLaunch {
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;
}

function binaryPath(config: unknown, fallback: string): string {
  return stringField(config, "binaryPath") ?? fallback;
}

/** Converts the persisted adapter cursor into the public CLI's interactive resume command. */
export function resolveAgentSessionCommand(input: {
  readonly provider: ProviderDriverKind;
  readonly config: unknown;
  readonly resumeCursor: unknown;
}): { readonly command: string; readonly args: ReadonlyArray<string> } | null {
  switch (input.provider) {
    case "claudeAgent": {
      const sessionId =
        stringField(input.resumeCursor, "resume") ?? stringField(input.resumeCursor, "sessionId");
      return sessionId
        ? { command: binaryPath(input.config, "claude"), args: ["--resume", sessionId] }
        : null;
    }
    case "codex": {
      const sessionId = stringField(input.resumeCursor, "threadId");
      return sessionId
        ? { command: binaryPath(input.config, "codex"), args: ["resume", sessionId] }
        : null;
    }
    case "opencode": {
      const sessionId = stringField(input.resumeCursor, "sessionId");
      // A local TUI cannot see sessions owned by a separately configured
      // OpenCode server. Supporting that needs the external server password
      // to stay server-side and an attach-specific launch path.
      if (stringField(input.config, "serverUrl")) return null;
      return sessionId
        ? { command: binaryPath(input.config, "opencode"), args: ["--session", sessionId] }
        : null;
    }
    case "grok": {
      const sessionId = stringField(input.resumeCursor, "sessionId");
      return sessionId
        ? { command: binaryPath(input.config, "grok"), args: ["--resume", sessionId] }
        : null;
    }
    case "antigravity": {
      const sessionId = stringField(input.resumeCursor, "sessionId");
      // The interactive CLI is `agy`; binaryPath configures the ACP harness,
      // so it must not replace the TUI executable here.
      return sessionId ? { command: "agy", args: ["--conversation", sessionId] } : null;
    }
    // Cursor's persisted value is an ACP session id. cursor-agent --resume
    // expects a chatId from a different store, so passing it would open the
    // wrong conversation or fail.
    default:
      return null;
  }
}

export const resolveAgentSessionLaunch = Effect.fn("terminal.resolveAgentSessionLaunch")(
  function* (
    input: TerminalOpenAgentSessionInput,
    directory: ProviderSessionDirectory["Service"],
    settingsService: ServerSettingsService["Service"],
  ) {
    const bindingOption = yield* directory.getBinding(ThreadId.make(input.threadId)).pipe(
      Effect.mapError(
        () =>
          new TerminalAgentSessionUnavailableError({
            threadId: input.threadId,
            reason: "binding-not-found",
          }),
      ),
    );
    if (Option.isNone(bindingOption)) {
      return yield* new TerminalAgentSessionUnavailableError({
        threadId: input.threadId,
        reason: "binding-not-found",
      });
    }

    const binding = bindingOption.value;
    const providerInstanceId = binding.providerInstanceId;
    if (providerInstanceId === undefined) {
      return yield* new TerminalAgentSessionUnavailableError({
        threadId: input.threadId,
        provider: binding.provider,
        reason: "provider-config-invalid",
      });
    }
    if (binding.resumeCursor === null || binding.resumeCursor === undefined) {
      return yield* new TerminalAgentSessionUnavailableError({
        threadId: input.threadId,
        provider: binding.provider,
        reason: "resume-cursor-missing",
      });
    }

    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        () =>
          new TerminalAgentSessionUnavailableError({
            threadId: input.threadId,
            provider: binding.provider,
            reason: "provider-config-invalid",
          }),
      ),
    );
    const instance = deriveProviderInstanceConfigMap(settings)[providerInstanceId];
    if (instance === undefined || instance.driver !== binding.provider) {
      return yield* new TerminalAgentSessionUnavailableError({
        threadId: input.threadId,
        provider: binding.provider,
        reason: "provider-config-invalid",
      });
    }

    const command = resolveAgentSessionCommand({
      provider: binding.provider,
      config: instance.config,
      resumeCursor: binding.resumeCursor,
    });
    if (command === null) {
      return yield* new TerminalAgentSessionUnavailableError({
        threadId: input.threadId,
        provider: binding.provider,
        reason:
          binding.provider === "cursor" ||
          (binding.provider === "opencode" && stringField(instance.config, "serverUrl"))
            ? "resume-not-supported"
            : "resume-cursor-missing",
      });
    }

    return { providerInstanceId, provider: binding.provider, ...command } satisfies AgentSessionLaunch;
  },
);
