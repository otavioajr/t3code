/**
 * ProviderPlugins — install, toggle, and remove a provider's plugins and the
 * marketplaces they come from, for the Plugins settings panel.
 *
 * Claude Code and Codex each own a plugin system: marketplaces are git
 * repositories the CLI clones and caches, and the enabled state lives in the
 * provider's own config. This service drives each CLI (`claude plugin ...`,
 * `codex plugin ...`) with the instance's executable and home instead of
 * reimplementing it, so the agent, the CLI, and T3 Code always agree on what is
 * installed. Codex has no CLI verb for enabling a plugin, so that one change
 * goes through its app-server's config write, which is what the CLI reads.
 * Other providers report `unsupported_provider`.
 *
 * @module provider/ProviderPlugins
 */
import {
  ClaudeSettings,
  CodexSettings,
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
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSettings from "../serverSettings.ts";
import { withCodexAppServerClient } from "./CodexProvider.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");

const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);

/** One install. Claude lists a plugin once per scope it is installed in; Codex has no scopes. */
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

const AvailablePluginEntry = Schema.Struct({
  pluginId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  marketplaceName: Schema.String,
  version: Schema.optional(Schema.String),
});
type AvailablePluginEntry = typeof AvailablePluginEntry.Type;

interface PluginState {
  readonly installed: ReadonlyArray<InstalledPluginEntry>;
  readonly available: ReadonlyArray<AvailablePluginEntry>;
}

const ClaudePluginsJson = Schema.fromJsonString(
  Schema.Struct({
    installed: Schema.Array(InstalledPluginEntry),
    available: Schema.Array(AvailablePluginEntry),
  }),
);
const decodeClaudePlugins = Schema.decodeUnknownEffect(ClaudePluginsJson);

/** `claude plugin list --json` on its own prints just the installed entries. */
const ClaudeInstalledOnlyJson = Schema.fromJsonString(Schema.Array(InstalledPluginEntry));
const decodeClaudeInstalledOnly = Schema.decodeUnknownEffect(ClaudeInstalledOnlyJson);

const ClaudeMarketplacesJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      repo: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      path: Schema.optional(Schema.String),
    }),
  ),
);
const decodeClaudeMarketplaces = Schema.decodeUnknownEffect(ClaudeMarketplacesJson);

/** Codex prints installed and available plugins in one shape, with or without `--available`. */
const CodexPluginEntry = Schema.Struct({
  pluginId: Schema.String,
  name: Schema.String,
  marketplaceName: Schema.String,
  version: Schema.optional(Schema.NullOr(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});
type CodexPluginEntry = typeof CodexPluginEntry.Type;

const CodexPluginsJson = Schema.fromJsonString(
  Schema.Struct({
    installed: Schema.Array(CodexPluginEntry),
    available: Schema.Array(CodexPluginEntry),
  }),
);
const decodeCodexPlugins = Schema.decodeUnknownEffect(CodexPluginsJson);

const CodexMarketplacesJson = Schema.fromJsonString(
  Schema.Struct({
    marketplaces: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        marketplaceSource: Schema.optional(
          Schema.NullOr(Schema.Struct({ source: Schema.optional(Schema.String) })),
        ),
      }),
    ),
  }),
);
const decodeCodexMarketplaces = Schema.decodeUnknownEffect(CodexMarketplacesJson);

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

/** Codex ships its own marketplaces (bundled, runtime, and the curated directory). */
const isCodexBuiltInMarketplace = (name: string) => name.startsWith("openai-");

const isClaudeBuiltInMarketplace = (name: string) => name === CLAUDE_OFFICIAL_MARKETPLACE;

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

const MAX_DETAIL_LENGTH = 300;

const invalidOutputDetail = (label: string) =>
  `${label} returned plugin data T3 Code could not read. Update ${label} and try again.`;

/**
 * Accept what people paste: `owner/repo`, a GitHub URL with or without the
 * scheme or `.git`, any other git URL, or a local path. GitHub URLs collapse to
 * `owner/repo`, which both CLIs clone over HTTPS or SSH as available.
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
  // Claude prefixes its one-line summary with `✘`, Codex with `Error:`.
  const summary =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("✘") || line.startsWith("Error:"))
      ?.replace(/^(?:✘|Error:)\s*/, "") ?? "";
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

/** Codex entries in the shape the snapshot is built from. */
export function fromCodexPlugins(input: {
  readonly installed: ReadonlyArray<CodexPluginEntry>;
  readonly available: ReadonlyArray<CodexPluginEntry>;
}): PluginState {
  const optional = (value: string | null | undefined) => value ?? undefined;
  return {
    installed: input.installed.map((entry) => ({
      id: entry.pluginId,
      ...(entry.version ? { version: entry.version } : {}),
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
    })),
    available: input.available.map((entry) => ({
      pluginId: entry.pluginId,
      name: entry.name,
      marketplaceName: entry.marketplaceName,
      ...(optional(entry.description) ? { description: optional(entry.description) } : {}),
      ...(optional(entry.version) ? { version: optional(entry.version) } : {}),
    })),
  };
}

/**
 * Merge the CLI's installed and available lists. Available plugins are kept
 * only for marketplaces the user added: both CLIs also list the provider's own
 * directories, thousands of entries nobody asked to browse here. A built-in
 * marketplace is listed only while one of its plugins is installed, and is
 * marked so the panel offers no update or remove for it.
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
  readonly isBuiltInMarketplace?: (name: string) => boolean;
}): ProviderPluginsSnapshot {
  const isBuiltIn = input.isBuiltInMarketplace ?? isClaudeBuiltInMarketplace;
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
    input.marketplaces.map((marketplace) => marketplace.name).filter((name) => !isBuiltIn(name)),
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
  const listedNames = new Set(input.marketplaces.map((marketplace) => marketplace.name));
  // Codex installs from built-in sources its marketplace list does not report.
  const unlistedBuiltIns = [...installedMarketplaces]
    .filter((name) => !listedNames.has(name) && isBuiltIn(name))
    .toSorted()
    .map((name) => ({ name, builtIn: true }));
  return {
    marketplaces: [
      ...input.marketplaces.flatMap((marketplace) => {
        if (!isBuiltIn(marketplace.name)) return [marketplace];
        return installedMarketplaces.has(marketplace.name)
          ? [{ ...marketplace, builtIn: true }]
          : [];
      }),
      ...unlistedBuiltIns,
    ],
    plugins,
  };
}

/** What each provider does for one panel action; the service adds locking and refresh. */
interface PluginBackend {
  readonly isBuiltInMarketplace: (name: string) => boolean;
  readonly listMarketplaces: Effect.Effect<
    ReadonlyArray<ProviderPluginMarketplace>,
    ProviderPluginsError
  >;
  /** Installed plugins, plus the marketplaces' uninstalled ones when `withAvailable`. */
  readonly readState: (withAvailable: boolean) => Effect.Effect<PluginState, ProviderPluginsError>;
  readonly describe: (entry: InstalledPluginEntry) => Effect.Effect<string | undefined>;
  readonly addMarketplace: (source: string) => Effect.Effect<void, ProviderPluginsError>;
  readonly removeMarketplace: (name: string) => Effect.Effect<void, ProviderPluginsError>;
  readonly updateMarketplace: (name: string) => Effect.Effect<void, ProviderPluginsError>;
  readonly install: (pluginId: string) => Effect.Effect<void, ProviderPluginsError>;
  readonly uninstall: (install: InstalledPluginEntry) => Effect.Effect<void, ProviderPluginsError>;
  readonly setEnabled: (
    install: InstalledPluginEntry,
    enabled: boolean,
  ) => Effect.Effect<void, ProviderPluginsError>;
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
  // Backends are plain values the methods share, so they carry the services they run with.
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();

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

  const readInstanceEntry = Effect.fn("ProviderPlugins.readInstanceEntry")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) =>
        fail(instanceId, operation, "command_failed", "Could not read provider settings.", cause),
      ),
    );
    return deriveProviderInstanceConfigMap(current)[instanceId];
  });

  const invalidConfig = (instanceId: ProviderInstanceId, operation: string) => (cause: unknown) =>
    fail(
      instanceId,
      operation,
      "command_failed",
      "The provider instance configuration is invalid.",
      cause,
    );

  /** Run `<binary> plugin <args>` without a terminal, under the command deadline. */
  const makeRunner =
    (input: {
      readonly instanceId: ProviderInstanceId;
      readonly operation: string;
      readonly label: string;
      readonly binaryPath: string;
      readonly environment: NodeJS.ProcessEnv;
    }) =>
    (args: ReadonlyArray<string>, directory?: string | undefined) =>
      Effect.gen(function* () {
        const { instanceId, operation, label, binaryPath, environment } = input;
        const spawnCommand = yield* resolveSpawnCommand(binaryPath, ["plugin", ...args], {
          env: environment,
        });
        const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: { ...environment, ...NON_INTERACTIVE_ENVIRONMENT },
          shell: spawnCommand.shell,
          stdin: "ignore",
          ...(directory === undefined ? {} : { cwd: directory }),
        });
        // Interrupting the deadline ends the child: spawnAndCollect runs in a scope that kills it.
        const result = yield* spawnAndCollect(binaryPath, command).pipe(
          Effect.mapError((cause) =>
            fail(
              instanceId,
              operation,
              "command_failed",
              `Could not run the ${label} executable. Check the binary path in provider settings.`,
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
      }).pipe(Effect.provide(services));

  const readManifestDescription = (directory: string) =>
    Effect.firstSuccessOf(
      [".codex-plugin", ".claude-plugin"].map((folder) =>
        fileSystem
          .readFileString(path.join(directory, folder, "plugin.json"))
          .pipe(Effect.flatMap(decodePluginManifest)),
      ),
    ).pipe(
      Effect.map((manifest) => manifest.description),
      Effect.orElseSucceed(() => undefined),
    );

  const makeClaudeBackend = Effect.fn("ProviderPlugins.makeClaudeBackend")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const entry = yield* readInstanceEntry(instanceId, operation);
    const claudeSettings = yield* decodeClaudeSettings(entry?.config ?? {}).pipe(
      Effect.mapError(invalidConfig(instanceId, operation)),
    );
    const baseEnvironment = yield* mergeProviderInstanceEnvironment(entry?.environment);
    const environment = yield* makeClaudeEnvironment(claudeSettings, baseEnvironment);
    const run = makeRunner({
      instanceId,
      operation,
      label: "Claude",
      binaryPath: claudeSettings.binaryPath,
      environment,
    });
    const invalidOutput = (cause: unknown) =>
      fail(instanceId, operation, "command_failed", invalidOutputDetail("Claude Code"), cause);

    /**
     * Run a command against one install. The scope is always passed, because uninstall
     * defaults to user scope and enable/disable guess; a project or local install runs from
     * its own project directory.
     */
    const runForInstall = (args: ReadonlyArray<string>, install: InstalledPluginEntry) => {
      const scope = install.scope;
      const projectScoped = scope !== undefined && scope !== "user";
      return run(
        [...args, ...(scope === undefined ? [] : ["--scope", scope])],
        projectScoped ? install.projectPath : undefined,
      ).pipe(Effect.asVoid);
    };

    return {
      isBuiltInMarketplace: isClaudeBuiltInMarketplace,
      listMarketplaces: run(["marketplace", "list", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeClaudeMarketplaces(output).pipe(Effect.mapError(invalidOutput)),
        ),
        Effect.map((marketplaces) =>
          marketplaces.map((marketplace) => {
            const source = marketplace.repo ?? marketplace.url ?? marketplace.path;
            return { name: marketplace.name, ...(source ? { source } : {}) };
          }),
        ),
      ),
      readState: (withAvailable) =>
        withAvailable
          ? run(["list", "--json", "--available"]).pipe(
              Effect.flatMap((output) =>
                decodeClaudePlugins(output).pipe(Effect.mapError(invalidOutput)),
              ),
            )
          : run(["list", "--json"]).pipe(
              Effect.flatMap((output) =>
                decodeClaudeInstalledOnly(output).pipe(Effect.mapError(invalidOutput)),
              ),
              Effect.map((installed) => ({ installed, available: [] })),
            ),
      describe: (install) =>
        install.installPath === undefined
          ? Effect.succeed(undefined)
          : readManifestDescription(install.installPath),
      addMarketplace: (source) => run(["marketplace", "add", source]).pipe(Effect.asVoid),
      removeMarketplace: (name) => run(["marketplace", "remove", name]).pipe(Effect.asVoid),
      updateMarketplace: (name) => run(["marketplace", "update", name]).pipe(Effect.asVoid),
      install: (pluginId) => run(["install", pluginId]).pipe(Effect.asVoid),
      uninstall: (install) => runForInstall(["uninstall", install.id], install),
      setEnabled: (install, enabled) =>
        runForInstall([enabled ? "enable" : "disable", install.id], install),
    } satisfies PluginBackend;
  });

  const makeCodexBackend = Effect.fn("ProviderPlugins.makeCodexBackend")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const entry = yield* readInstanceEntry(instanceId, operation);
    const codexSettings = yield* decodeCodexSettings(entry?.config ?? {}).pipe(
      Effect.mapError(invalidConfig(instanceId, operation)),
    );
    if (codexSettings.setupMode === "managed") {
      return yield* fail(
        instanceId,
        operation,
        "unsupported_provider",
        "Plugins are not available yet for Codex instances T3 Code manages. Use an instance with your own Codex installation.",
      );
    }
    // Plugins and config.toml live in the shared home; a shadow home only overlays auth.
    const { sharedHomePath } = yield* resolveCodexHomeLayout(codexSettings);
    const binaryPath = expandHomePath(codexSettings.binaryPath, yield* HostProcess.HomeDirectory);
    const baseEnvironment = yield* mergeProviderInstanceEnvironment(entry?.environment);
    const environment = { ...baseEnvironment, CODEX_HOME: sharedHomePath };
    const run = makeRunner({ instanceId, operation, label: "Codex", binaryPath, environment });
    const invalidOutput = (cause: unknown) =>
      fail(instanceId, operation, "command_failed", invalidOutputDetail("Codex"), cause);

    return {
      isBuiltInMarketplace: isCodexBuiltInMarketplace,
      listMarketplaces: run(["marketplace", "list", "--json"]).pipe(
        Effect.flatMap((output) =>
          decodeCodexMarketplaces(output).pipe(Effect.mapError(invalidOutput)),
        ),
        Effect.map(({ marketplaces }) =>
          marketplaces.map((marketplace) => {
            const source = marketplace.marketplaceSource?.source;
            return { name: marketplace.name, ...(source ? { source } : {}) };
          }),
        ),
      ),
      readState: (withAvailable) =>
        run(["list", "--json", ...(withAvailable ? ["--available"] : [])]).pipe(
          Effect.flatMap((output) =>
            decodeCodexPlugins(output).pipe(Effect.mapError(invalidOutput)),
          ),
          Effect.map(fromCodexPlugins),
        ),
      describe: (install) => {
        const at = install.id.lastIndexOf("@");
        if (at <= 0 || install.version === undefined) return Effect.succeed(undefined);
        return readManifestDescription(
          path.join(
            sharedHomePath,
            "plugins",
            "cache",
            install.id.slice(at + 1),
            install.id.slice(0, at),
            install.version,
          ),
        );
      },
      addMarketplace: (source) => run(["marketplace", "add", source]).pipe(Effect.asVoid),
      removeMarketplace: (name) => run(["marketplace", "remove", name]).pipe(Effect.asVoid),
      updateMarketplace: (name) => run(["marketplace", "upgrade", name]).pipe(Effect.asVoid),
      install: (pluginId) => run(["add", pluginId]).pipe(Effect.asVoid),
      uninstall: (install) => run(["remove", install.id]).pipe(Effect.asVoid),
      // `codex plugin` has no enable verb; `[plugins."<id>"].enabled` in config.toml is the switch.
      setEnabled: (install, enabled) =>
        Effect.gen(function* () {
          const { client } = yield* withCodexAppServerClient({
            binaryPath,
            homePath: sharedHomePath,
            cwd: sharedHomePath,
            environment,
          });
          yield* client.request("config/value/write", {
            keyPath: `plugins."${install.id}".enabled`,
            mergeStrategy: "replace",
            value: enabled,
          });
        }).pipe(
          Effect.scoped,
          Effect.provide(services),
          Effect.mapError((cause) =>
            fail(
              instanceId,
              operation,
              "command_failed",
              "Codex could not save the plugin setting. Check the binary path in provider settings.",
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
                  "Codex did not save the plugin setting in time. Try again.",
                ),
              ),
          }),
        ),
    } satisfies PluginBackend;
  });

  const resolveBackend = Effect.fn("ProviderPlugins.resolveBackend")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ): Effect.fn.Return<PluginBackend, ProviderPluginsError, Path.Path> {
    const instance = yield* instances.getInstance(instanceId);
    if (instance?.driverKind === CLAUDE_DRIVER_KIND) {
      return yield* makeClaudeBackend(instanceId, operation);
    }
    if (instance?.driverKind === CODEX_DRIVER_KIND) {
      return yield* makeCodexBackend(instanceId, operation);
    }
    return yield* fail(
      instanceId,
      operation,
      "unsupported_provider",
      "Plugins are available for Claude and Codex instances.",
    );
  });

  const listWith = Effect.fn("ProviderPlugins.listWith")(function* (backend: PluginBackend) {
    const [marketplaces, state] = yield* Effect.all(
      [backend.listMarketplaces, backend.readState(true)],
      { concurrency: 2 },
    );
    const installed = yield* Effect.forEach(
      representativeInstalls(state.installed),
      (entry) =>
        backend.describe(entry).pipe(Effect.map((description) => ({ ...entry, description }))),
      { concurrency: 8 },
    );
    return buildPluginsSnapshot({
      marketplaces,
      installed,
      available: state.available,
      isBuiltInMarketplace: backend.isBuiltInMarketplace,
    });
  });

  const list = Effect.fn("ProviderPlugins.list")(function* (input: ProviderPluginsInput) {
    const backend = yield* resolveBackend(input.instanceId, "list");
    return yield* listWith(backend);
  });

  /**
   * Apply one change under the write lock, refresh the instance, and return the list
   * read after it. The lock covers that read too, so two quick changes answer with
   * snapshots in the order they were applied, and the older one cannot land last.
   */
  const mutate = (
    instanceId: ProviderInstanceId,
    operation: string,
    change: (backend: PluginBackend) => Effect.Effect<void, ProviderPluginsError>,
  ) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const backend = yield* resolveBackend(instanceId, operation);
        yield* change(backend);
        yield* providers.refreshInstance(instanceId);
        return yield* listWith(backend);
      }),
    );

  const findInstall = (
    backend: PluginBackend,
    instanceId: ProviderInstanceId,
    operation: string,
    pluginId: string,
  ) =>
    backend.readState(false).pipe(
      Effect.flatMap(({ installed }) => {
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
    return yield* mutate(input.instanceId, "add-marketplace", (backend) =>
      backend.addMarketplace(source),
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
    return yield* mutate(input.instanceId, "remove-marketplace", (backend) =>
      backend.removeMarketplace(name),
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
    return yield* mutate(input.instanceId, "update-marketplace", (backend) =>
      backend.updateMarketplace(name),
    );
  });

  const install = Effect.fn("ProviderPlugins.install")(function* (input: ProviderPluginInput) {
    const pluginId = yield* requirePluginId(input.instanceId, "install", input.pluginId);
    return yield* mutate(input.instanceId, "install", (backend) => backend.install(pluginId));
  });

  const uninstall = Effect.fn("ProviderPlugins.uninstall")(function* (input: ProviderPluginInput) {
    const pluginId = yield* requirePluginId(input.instanceId, "uninstall", input.pluginId);
    return yield* mutate(input.instanceId, "uninstall", (backend) =>
      findInstall(backend, input.instanceId, "uninstall", pluginId).pipe(
        Effect.flatMap((target) => backend.uninstall(target)),
      ),
    );
  });

  const setEnabled = Effect.fn("ProviderPlugins.setEnabled")(function* (
    input: ProviderPluginSetEnabledInput,
  ) {
    const operation = input.enabled ? "enable" : "disable";
    const pluginId = yield* requirePluginId(input.instanceId, operation, input.pluginId);
    return yield* mutate(input.instanceId, operation, (backend) =>
      findInstall(backend, input.instanceId, operation, pluginId).pipe(
        Effect.flatMap((target) => backend.setEnabled(target, input.enabled)),
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
