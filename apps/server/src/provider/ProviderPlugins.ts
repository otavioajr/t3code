/**
 * ProviderPlugins — install, toggle, and remove a provider's plugins and the
 * marketplaces they come from, for the Plugins settings panel.
 *
 * Claude Code owns its plugin system (`claude plugin ...`): marketplaces are
 * git repositories it clones and caches, and `enabledPlugins` lives in its own
 * settings. This service drives that CLI with the instance's executable and
 * config dir instead of reimplementing it, so the agent, the CLI, and T3 Code
 * always agree on what is installed. Other providers report
 * `unsupported_provider`.
 *
 * @module provider/ProviderPlugins
 */
import {
  ClaudeSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderPlugin,
  type ProviderPluginInput,
  type ProviderPluginMarketplace,
  type ProviderPluginsAddMarketplaceInput,
  ProviderPluginsError,
  type ProviderPluginsErrorReason,
  type ProviderPluginsInput,
  type ProviderPluginsMarketplaceInput,
  type ProviderPluginSetEnabledInput,
  type ProviderPluginsSnapshot,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess } from "effect/process";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSettings from "../serverSettings.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");

const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);

/** One install. The CLI lists a plugin once per scope it is installed in. */
const InstalledPluginEntry = Schema.Struct({
  id: Schema.String,
  version: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  installPath: Schema.optional(Schema.String),
  /** `user`, `project`, or `local`. */
  scope: Schema.optional(Schema.String),
  /** The project directory a project or local install belongs to. */
  projectPath: Schema.optional(Schema.String),
});
type InstalledPluginEntry = typeof InstalledPluginEntry.Type;

const InstalledPluginsJson = Schema.fromJsonString(
  Schema.Struct({
    installed: Schema.Array(InstalledPluginEntry),
    available: Schema.Array(
      Schema.Struct({
        pluginId: Schema.String,
        name: Schema.String,
        description: Schema.optional(Schema.String),
        marketplaceName: Schema.String,
        version: Schema.optional(Schema.String),
      }),
    ),
  }),
);
const decodeInstalledPlugins = Schema.decodeUnknownEffect(InstalledPluginsJson);

/** `plugin list --json` on its own prints just the installed entries. */
const InstalledOnlyJson = Schema.fromJsonString(Schema.Array(InstalledPluginEntry));
const decodeInstalledOnly = Schema.decodeUnknownEffect(InstalledOnlyJson);

const MarketplacesJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      repo: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      path: Schema.optional(Schema.String),
    }),
  ),
);
const decodeMarketplaces = Schema.decodeUnknownEffect(MarketplacesJson);

const PluginManifestJson = Schema.fromJsonString(
  Schema.Struct({ description: Schema.optional(Schema.String) }),
);
const decodePluginManifest = Schema.decodeUnknownEffect(PluginManifestJson);

// Ids reach the CLI as argv, so they must never look like a flag.
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MARKETPLACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Claude Code installs this marketplace on its own, so it is not one the user added.
 * Its uninstalled plugins are not browsable; it is listed only for installed plugins.
 */
const CLAUDE_OFFICIAL_MARKETPLACE = "claude-plugins-official";

// Plugin commands run without a terminal. A git or ssh credential prompt would wait
// forever, so each one fails instead.
const NON_INTERACTIVE_ENVIRONMENT = {
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_TERMINAL_PROMPT: "0",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
} satisfies NodeJS.ProcessEnv;

// A marketplace add clones a repository, so it gets the same budget as a repository clone.
const PLUGIN_COMMAND_TIMEOUT_MS = 120_000;

const INVALID_CLI_OUTPUT_DETAIL =
  "Claude returned plugin data T3 Code could not read. Update Claude Code and try again.";

const MAX_DETAIL_LENGTH = 300;

/**
 * Accept what people paste: `owner/repo`, a GitHub URL with or without the
 * scheme or `.git`, any other git URL, or a local path. GitHub URLs collapse to
 * `owner/repo`, which the CLI clones over HTTPS or SSH as available.
 */
export function normalizeMarketplaceSource(raw: string): string | undefined {
  const source = raw.trim();
  if (source.length === 0 || source.startsWith("-")) return undefined;
  const github =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(source);
  if (github) return `${github[1]}/${github[2]}`;
  return source;
}

/** Turn a failed CLI run into a reason the UI can act on plus a short summary. */
export function classifyPluginCommandFailure(
  stdout: string,
  stderr: string,
  exitCode: number,
): { readonly reason: ProviderPluginsErrorReason; readonly detail: string } {
  const output = `${stderr}\n${stdout}`;
  // Only git and ssh authentication failures mean "private or missing repository". A
  // local permission error, such as an unwritable config dir, falls through to its summary.
  if (
    /repository not found|could not read username|authentication failed|access rights|terminal prompts disabled|permission denied \((?:publickey|password|keyboard-interactive)/i.test(
      output,
    )
  ) {
    return {
      reason: "access_denied",
      detail:
        "Could not access this repository. Check the address, or sign in to git for private repositories.",
    };
  }
  const summary =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("✘"))
      ?.replace(/^✘\s*/, "") ?? "";
  const detail =
    summary.length > 0
      ? summary.slice(0, MAX_DETAIL_LENGTH)
      : `The plugin command failed with exit code ${exitCode}.`;
  return { reason: /not found/i.test(summary) ? "not_found" : "command_failed", detail };
}

/**
 * One install per plugin id: the user-scope install when there is one. The CLI lists an
 * entry per scope, but a row stands for the plugin, and its actions act on this install.
 */
export function representativeInstalls<
  T extends { readonly id: string; readonly scope?: string | undefined },
>(entries: ReadonlyArray<T>): ReadonlyArray<T> {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    const current = byId.get(entry.id);
    if (current === undefined || (current.scope !== "user" && entry.scope === "user")) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

/**
 * Merge the CLI's installed and available lists. Available plugins are kept
 * only for marketplaces the user added: the CLI also lists Anthropic's
 * built-in directory, thousands of entries nobody asked to browse here.
 */
export function buildPluginsSnapshot(input: {
  readonly marketplaces: ReadonlyArray<ProviderPluginMarketplace>;
  readonly installed: ReadonlyArray<{
    readonly id: string;
    readonly version?: string | undefined;
    readonly enabled?: boolean | undefined;
    readonly description?: string | undefined;
    readonly scope?: string | undefined;
  }>;
  readonly available: ReadonlyArray<{
    readonly pluginId: string;
    readonly name: string;
    readonly description?: string | undefined;
    readonly marketplaceName: string;
    readonly version?: string | undefined;
  }>;
}): ProviderPluginsSnapshot {
  const plugins: ProviderPlugin[] = [];
  for (const entry of representativeInstalls(input.installed)) {
    const at = entry.id.lastIndexOf("@");
    if (at <= 0) continue;
    plugins.push({
      id: entry.id,
      name: entry.id.slice(0, at),
      marketplace: entry.id.slice(at + 1),
      installed: true,
      enabled: entry.enabled ?? true,
      ...(entry.description ? { description: entry.description.slice(0, 2_048) } : {}),
      ...(entry.version ? { version: entry.version } : {}),
    });
  }
  const installedIds = new Set(plugins.map((plugin) => plugin.id));
  const browsable = new Set(
    input.marketplaces
      .map((marketplace) => marketplace.name)
      .filter((name) => name !== CLAUDE_OFFICIAL_MARKETPLACE),
  );
  for (const entry of input.available) {
    if (!browsable.has(entry.marketplaceName) || installedIds.has(entry.pluginId)) continue;
    plugins.push({
      id: entry.pluginId,
      name: entry.name,
      marketplace: entry.marketplaceName,
      installed: false,
      enabled: false,
      ...(entry.description ? { description: entry.description.slice(0, 2_048) } : {}),
      ...(entry.version ? { version: entry.version } : {}),
    });
  }
  const installedMarketplaces = new Set(
    plugins.filter((plugin) => plugin.installed).map((plugin) => plugin.marketplace),
  );
  plugins.sort(
    (left, right) =>
      left.marketplace.localeCompare(right.marketplace) || left.name.localeCompare(right.name),
  );
  return {
    marketplaces: input.marketplaces.filter(
      (marketplace) =>
        marketplace.name !== CLAUDE_OFFICIAL_MARKETPLACE ||
        installedMarketplaces.has(marketplace.name),
    ),
    plugins,
  };
}

export const makeProviderPlugins = Effect.fn("makeProviderPlugins")(function* (
  // Server-lifetime: every client connection shares the one CLI config dir, so the lock must too.
  writeLock: Semaphore.Semaphore,
) {
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const fail = (
    instanceId: ProviderInstanceId,
    operation: string,
    reason: ProviderPluginsErrorReason,
    detail: string,
    cause?: unknown,
  ) =>
    new ProviderPluginsError({
      instanceId,
      operation,
      reason,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const resolveClaude = Effect.fn("ProviderPlugins.resolveClaude")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const instance = yield* instances.getInstance(instanceId);
    if (instance?.driverKind !== CLAUDE_DRIVER_KIND) {
      return yield* fail(
        instanceId,
        operation,
        "unsupported_provider",
        "Plugins are only available for Claude instances.",
      );
    }
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) =>
        fail(instanceId, operation, "command_failed", "Could not read provider settings.", cause),
      ),
    );
    const entry = deriveProviderInstanceConfigMap(current)[instanceId];
    const claudeSettings = yield* decodeClaudeSettings(entry?.config ?? {}).pipe(
      Effect.mapError((cause) =>
        fail(
          instanceId,
          operation,
          "command_failed",
          "The provider instance configuration is invalid.",
          cause,
        ),
      ),
    );
    const baseEnvironment = yield* mergeProviderInstanceEnvironment(entry?.environment);
    const environment = yield* makeClaudeEnvironment(claudeSettings, baseEnvironment);
    return { claudeSettings, environment };
  });

  /** `directory` is the working directory: a project-scoped install resolves its settings from there. */
  const runPluginCommand = Effect.fn("ProviderPlugins.runPluginCommand")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
    args: ReadonlyArray<string>,
    directory?: string | undefined,
  ) {
    const { claudeSettings, environment } = yield* resolveClaude(instanceId, operation);
    const spawnCommand = yield* resolveSpawnCommand(
      claudeSettings.binaryPath,
      ["plugin", ...args],
      { env: environment },
    );
    const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: { ...environment, ...NON_INTERACTIVE_ENVIRONMENT },
      shell: spawnCommand.shell,
      stdin: "ignore",
      ...(directory === undefined ? {} : { cwd: directory }),
    });
    // Interrupting the deadline ends the child: spawnAndCollect runs in a scope that kills it.
    const result = yield* spawnAndCollect(claudeSettings.binaryPath, command).pipe(
      Effect.mapError((cause) =>
        fail(
          instanceId,
          operation,
          "command_failed",
          "Could not run the Claude executable. Check the binary path in provider settings.",
          cause,
        ),
      ),
      Effect.timeoutOrElse({
        duration: PLUGIN_COMMAND_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            fail(
              instanceId,
              operation,
              "command_failed",
              "The plugin command did not finish in time. Check your connection, then try again.",
            ),
          ),
      }),
    );
    if (result.code !== 0) {
      const { reason, detail } = classifyPluginCommandFailure(
        result.stdout,
        result.stderr,
        result.code,
      );
      return yield* fail(instanceId, operation, reason, detail);
    }
    return result.stdout;
  });

  const readDescription = (installPath: string | undefined) =>
    installPath === undefined
      ? Effect.succeed(undefined)
      : fileSystem.readFileString(path.join(installPath, ".claude-plugin", "plugin.json")).pipe(
          Effect.flatMap(decodePluginManifest),
          Effect.map((manifest) => manifest.description),
          Effect.orElseSucceed(() => undefined),
        );

  /** The CLI's installed and available plugins, read in one command. */
  const readPluginState = Effect.fn("ProviderPlugins.readPluginState")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const output = yield* runPluginCommand(instanceId, operation, [
      "list",
      "--json",
      "--available",
    ]);
    return yield* decodeInstalledPlugins(output).pipe(
      Effect.mapError((cause) =>
        fail(instanceId, operation, "command_failed", INVALID_CLI_OUTPUT_DETAIL, cause),
      ),
    );
  });

  /** Installed plugins only. A write reads this, which skips the much larger available list. */
  const readInstalledPlugins = Effect.fn("ProviderPlugins.readInstalledPlugins")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const output = yield* runPluginCommand(instanceId, operation, ["list", "--json"]);
    return yield* decodeInstalledOnly(output).pipe(
      Effect.mapError((cause) =>
        fail(instanceId, operation, "command_failed", INVALID_CLI_OUTPUT_DETAIL, cause),
      ),
    );
  });

  const list = Effect.fn("ProviderPlugins.list")(function* (input: ProviderPluginsInput) {
    const [marketplacesOutput, state] = yield* Effect.all(
      [
        runPluginCommand(input.instanceId, "list", ["marketplace", "list", "--json"]),
        readPluginState(input.instanceId, "list"),
      ],
      { concurrency: 2 },
    );
    const marketplaces = yield* decodeMarketplaces(marketplacesOutput).pipe(
      Effect.mapError((cause) =>
        fail(input.instanceId, "list", "command_failed", INVALID_CLI_OUTPUT_DETAIL, cause),
      ),
    );
    const installed = yield* Effect.forEach(
      representativeInstalls(state.installed),
      (entry) =>
        readDescription(entry.installPath).pipe(
          Effect.map((description) => ({ ...entry, description })),
        ),
      { concurrency: 8 },
    );
    return buildPluginsSnapshot({
      marketplaces: marketplaces.map((marketplace) => {
        const source = marketplace.repo ?? marketplace.url ?? marketplace.path;
        return { name: marketplace.name, ...(source ? { source } : {}) };
      }),
      installed,
      available: state.available,
    });
  });

  /**
   * Apply one change under the write lock, refresh the instance, and return the list
   * read after it. The lock covers that read too, so two quick changes answer with
   * snapshots in the order they were applied, and the older one cannot land last.
   */
  const mutate = <R>(
    instanceId: ProviderInstanceId,
    change: Effect.Effect<void, ProviderPluginsError, R>,
  ) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        yield* change;
        yield* providers.refreshInstance(instanceId);
        return yield* list({ instanceId });
      }),
    );

  /**
   * Run a command against one install. The scope is always passed, because uninstall
   * defaults to user scope and enable/disable guess; a project or local install runs from
   * its own project directory.
   */
  const runInstallCommand = (
    instanceId: ProviderInstanceId,
    operation: string,
    args: ReadonlyArray<string>,
    install: InstalledPluginEntry,
  ) => {
    const scope = install.scope;
    const projectScoped = scope !== undefined && scope !== "user";
    return runPluginCommand(
      instanceId,
      operation,
      [...args, ...(scope === undefined ? [] : ["--scope", scope])],
      projectScoped ? install.projectPath : undefined,
    ).pipe(Effect.asVoid);
  };

  const findInstall = (instanceId: ProviderInstanceId, operation: string, pluginId: string) =>
    readInstalledPlugins(instanceId, operation).pipe(
      Effect.flatMap((installed) => {
        const install = representativeInstalls(installed).find((entry) => entry.id === pluginId);
        return install === undefined
          ? Effect.fail(fail(instanceId, operation, "not_found", "That plugin is not installed."))
          : Effect.succeed(install);
      }),
    );

  const requirePluginId = (instanceId: ProviderInstanceId, operation: string, pluginId: string) =>
    PLUGIN_ID_PATTERN.test(pluginId)
      ? Effect.succeed(pluginId)
      : Effect.fail(fail(instanceId, operation, "not_found", "That is not a valid plugin id."));

  const requireMarketplace = (instanceId: ProviderInstanceId, operation: string, name: string) =>
    MARKETPLACE_NAME_PATTERN.test(name)
      ? Effect.succeed(name)
      : Effect.fail(
          fail(instanceId, operation, "not_found", "That is not a valid marketplace name."),
        );

  const addMarketplace = Effect.fn("ProviderPlugins.addMarketplace")(function* (
    input: ProviderPluginsAddMarketplaceInput,
  ) {
    const source = normalizeMarketplaceSource(input.source);
    if (source === undefined) {
      return yield* fail(
        input.instanceId,
        "add-marketplace",
        "not_found",
        "Enter a GitHub repository such as owner/repo, a git URL, or a local path.",
      );
    }
    return yield* mutate(
      input.instanceId,
      runPluginCommand(input.instanceId, "add-marketplace", ["marketplace", "add", source]).pipe(
        Effect.asVoid,
      ),
    );
  });

  const removeMarketplace = Effect.fn("ProviderPlugins.removeMarketplace")(function* (
    input: ProviderPluginsMarketplaceInput,
  ) {
    const name = yield* requireMarketplace(
      input.instanceId,
      "remove-marketplace",
      input.marketplace,
    );
    return yield* mutate(
      input.instanceId,
      runPluginCommand(input.instanceId, "remove-marketplace", [
        "marketplace",
        "remove",
        name,
      ]).pipe(Effect.asVoid),
    );
  });

  const updateMarketplace = Effect.fn("ProviderPlugins.updateMarketplace")(function* (
    input: ProviderPluginsMarketplaceInput,
  ) {
    const name = yield* requireMarketplace(
      input.instanceId,
      "update-marketplace",
      input.marketplace,
    );
    return yield* mutate(
      input.instanceId,
      runPluginCommand(input.instanceId, "update-marketplace", [
        "marketplace",
        "update",
        name,
      ]).pipe(Effect.asVoid),
    );
  });

  const install = Effect.fn("ProviderPlugins.install")(function* (input: ProviderPluginInput) {
    const pluginId = yield* requirePluginId(input.instanceId, "install", input.pluginId);
    return yield* mutate(
      input.instanceId,
      runPluginCommand(input.instanceId, "install", ["install", pluginId]).pipe(Effect.asVoid),
    );
  });

  const uninstall = Effect.fn("ProviderPlugins.uninstall")(function* (input: ProviderPluginInput) {
    const pluginId = yield* requirePluginId(input.instanceId, "uninstall", input.pluginId);
    return yield* mutate(
      input.instanceId,
      findInstall(input.instanceId, "uninstall", pluginId).pipe(
        Effect.flatMap((target) =>
          runInstallCommand(input.instanceId, "uninstall", ["uninstall", pluginId], target),
        ),
      ),
    );
  });

  const setEnabled = Effect.fn("ProviderPlugins.setEnabled")(function* (
    input: ProviderPluginSetEnabledInput,
  ) {
    const operation = input.enabled ? "enable" : "disable";
    const pluginId = yield* requirePluginId(input.instanceId, operation, input.pluginId);
    return yield* mutate(
      input.instanceId,
      findInstall(input.instanceId, operation, pluginId).pipe(
        Effect.flatMap((target) =>
          runInstallCommand(input.instanceId, operation, [operation, pluginId], target),
        ),
      ),
    );
  });

  return {
    list,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    install,
    uninstall,
    setEnabled,
  };
});
