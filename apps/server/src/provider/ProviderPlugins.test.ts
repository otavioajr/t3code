import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { it as effectIt } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import { describe, expect, it } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";
import {
  buildPluginsSnapshot,
  classifyPluginCommandFailure,
  makeProviderPlugins,
  normalizeMarketplaceSource,
  fromCodexPlugins,
  fromGrokPlugins,
  isClaudeSharedPluginPath,
  representativeInstalls,
} from "./ProviderPlugins.ts";

describe("normalizeMarketplaceSource", () => {
  it("collapses GitHub URLs to owner/repo", () => {
    expect(normalizeMarketplaceSource("https://github.com/mattpocock/skills")).toBe(
      "mattpocock/skills",
    );
    expect(normalizeMarketplaceSource("github.com/mattpocock/skills.git/")).toBe(
      "mattpocock/skills",
    );
    expect(normalizeMarketplaceSource("  mattpocock/skills  ")).toBe("mattpocock/skills");
  });

  it("keeps other git URLs and paths, and rejects flag-shaped input", () => {
    expect(normalizeMarketplaceSource("https://gitlab.com/team/plugins.git")).toBe(
      "https://gitlab.com/team/plugins.git",
    );
    expect(normalizeMarketplaceSource("/Users/me/plugins")).toBe("/Users/me/plugins");
    expect(normalizeMarketplaceSource("--help")).toBeUndefined();
    expect(normalizeMarketplaceSource("   ")).toBeUndefined();
  });
});

describe("classifyPluginCommandFailure", () => {
  it("reports a missing or private repository as access_denied", () => {
    const stderr = [
      "✘ Failed to add marketplace: Fetching the marketplace from GitHub failed on both attempts.",
      "remote: Repository not found.",
      "git@github.com: Permission denied (publickey).",
    ].join("\n");
    expect(classifyPluginCommandFailure("Adding marketplace…", stderr, 1).reason).toBe(
      "access_denied",
    );
  });

  it("keeps a local permission error out of the access message", () => {
    expect(
      classifyPluginCommandFailure(
        "",
        "EACCES: permission denied, open '/Users/me/.claude/settings.json'\n✘ Failed to save plugin settings",
        1,
      ),
    ).toEqual({ reason: "command_failed", detail: "Failed to save plugin settings" });
  });

  it("surfaces the CLI summary line for an unknown plugin", () => {
    const failure = classifyPluginCommandFailure(
      'Installing plugin "nope@mattpocock"...',
      '✘ Failed to install plugin "nope@mattpocock": Plugin "nope" not found in marketplace "mattpocock"',
      1,
    );
    expect(failure).toEqual({
      reason: "not_found",
      detail:
        'Failed to install plugin "nope@mattpocock": Plugin "nope" not found in marketplace "mattpocock"',
    });
  });

  it("falls back to the exit code when the CLI prints no summary", () => {
    expect(classifyPluginCommandFailure("", "", 2)).toEqual({
      reason: "command_failed",
      detail: "The plugin command failed with exit code 2.",
    });
  });
});

describe("buildPluginsSnapshot", () => {
  it("lists installed plugins and only the added marketplaces' uninstalled ones", () => {
    const snapshot = buildPluginsSnapshot({
      marketplaces: [{ name: "mattpocock", source: "mattpocock/skills" }],
      installed: [
        {
          id: "mattpocock-skills@mattpocock",
          version: "1.3.1",
          enabled: false,
          description: "Engineering skills",
        },
      ],
      available: [
        { pluginId: "extra@mattpocock", name: "extra", marketplaceName: "mattpocock" },
        {
          pluginId: "mattpocock-skills@mattpocock",
          name: "mattpocock-skills",
          marketplaceName: "mattpocock",
        },
        {
          pluginId: "figma@anthropic-plugin-directory",
          name: "figma",
          marketplaceName: "anthropic-plugin-directory",
        },
      ],
    });

    expect(snapshot.plugins).toEqual([
      {
        id: "extra@mattpocock",
        name: "extra",
        marketplace: "mattpocock",
        installed: false,
        enabled: false,
      },
      {
        id: "mattpocock-skills@mattpocock",
        name: "mattpocock-skills",
        marketplace: "mattpocock",
        installed: true,
        enabled: false,
        description: "Engineering skills",
        version: "1.3.1",
      },
    ]);
  });

  it("shows a plugin installed in several scopes once, from its user-scope install", () => {
    const snapshot = buildPluginsSnapshot({
      marketplaces: [{ name: "team" }],
      installed: [
        { id: "lint@team", scope: "project", enabled: false, version: "2.0.0" },
        { id: "lint@team", scope: "user", enabled: true, version: "1.0.0" },
      ],
      available: [],
    });

    expect(snapshot.plugins).toEqual([
      {
        id: "lint@team",
        name: "lint",
        marketplace: "team",
        installed: true,
        enabled: true,
        version: "1.0.0",
      },
    ]);
  });

  it("browses only the marketplaces the user added, and shows Claude's own only with installed plugins", () => {
    const snapshot = buildPluginsSnapshot({
      marketplaces: [{ name: "claude-plugins-official" }, { name: "team", source: "acme/plugins" }],
      installed: [],
      available: [
        {
          pluginId: "figma@claude-plugins-official",
          name: "figma",
          marketplaceName: "claude-plugins-official",
        },
        { pluginId: "lint@team", name: "lint", marketplaceName: "team" },
      ],
    });
    expect(snapshot.marketplaces).toEqual([{ name: "team", source: "acme/plugins" }]);
    expect(snapshot.plugins.map((plugin) => plugin.id)).toEqual(["lint@team"]);

    const withInstalled = buildPluginsSnapshot({
      marketplaces: [{ name: "claude-plugins-official" }],
      installed: [{ id: "figma@claude-plugins-official", scope: "user", enabled: true }],
      available: [
        {
          pluginId: "figma@claude-plugins-official",
          name: "figma",
          marketplaceName: "claude-plugins-official",
        },
        {
          pluginId: "slack@claude-plugins-official",
          name: "slack",
          marketplaceName: "claude-plugins-official",
        },
      ],
    });
    expect(withInstalled.marketplaces).toEqual([
      { name: "claude-plugins-official", builtIn: true },
    ]);
    expect(withInstalled.plugins.map((plugin) => plugin.id)).toEqual([
      "figma@claude-plugins-official",
    ]);
  });
});

describe("Codex plugin data", () => {
  it("reads Codex's `Error:` summary line", () => {
    expect(
      classifyPluginCommandFailure(
        "",
        "Error: plugin `nope` was not found in marketplace `team`",
        1,
      ),
    ).toEqual({ reason: "not_found", detail: "plugin `nope` was not found in marketplace `team`" });
  });

  it("lists built-in sources Codex installs from but does not report as marketplaces", () => {
    const snapshot = buildPluginsSnapshot({
      marketplaces: [{ name: "openai-curated" }, { name: "team", source: "https://x/team.git" }],
      ...fromCodexPlugins({
        installed: [
          {
            pluginId: "github@openai-curated-remote",
            name: "github",
            marketplaceName: "openai-curated-remote",
            enabled: true,
          },
        ],
        available: [
          { pluginId: "figma@openai-curated", name: "figma", marketplaceName: "openai-curated" },
          { pluginId: "lint@team", name: "lint", marketplaceName: "team", version: null },
        ],
      }),
      isBuiltInMarketplace: (name) => name.startsWith("openai-"),
    });
    expect(snapshot.marketplaces).toEqual([
      { name: "team", source: "https://x/team.git" },
      { name: "openai-curated-remote", builtIn: true },
    ]);
    expect(snapshot.plugins.map((plugin) => [plugin.id, plugin.installed])).toEqual([
      ["github@openai-curated-remote", true],
      ["lint@team", false],
    ]);
  });
});

describe("Grok plugin data", () => {
  it("treats git's missing-repository message as an access problem", () => {
    expect(
      classifyPluginCommandFailure(
        "",
        "Error: git ls-remote failed: fatal: repository 'https://github.com/x/y.git/' not found",
        1,
      ).reason,
    ).toBe("access_denied");
  });

  it("reads on and off from loaded skills, and places Claude-installed plugins by marketplace", () => {
    const state = fromGrokPlugins({
      inspection: {
        plugins: [
          {
            name: "mattpocock-skills",
            path: "/Users/me/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1",
            enabled: true,
            provides: { skills: 27 },
          },
          {
            name: "lint",
            path: "/Users/me/.grok/installed-plugins/lint-1",
            enabled: true,
            provides: { skills: 2 },
          },
          { name: "hooks-only", enabled: true, provides: { skills: 0 } },
        ],
        skills: [{ source: { type: "plugin", plugin_name: "mattpocock-skills" } }],
      },
      listed: [
        { status: "installed", name: "lint", version: "2.0.0", marketplace: "team" },
        { status: "available", name: "format", marketplace: "team", description: "Formats" },
        { status: "available", name: "lint", marketplace: "team" },
      ],
    });
    expect(state.installed).toEqual([
      {
        id: "mattpocock-skills@mattpocock",
        enabled: true,
        version: "1.3.1",
        installPath: "/Users/me/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1",
      },
      {
        id: "lint@team",
        enabled: false,
        version: "2.0.0",
        installPath: "/Users/me/.grok/installed-plugins/lint-1",
      },
      { id: "hooks-only@local", enabled: true },
    ]);
    expect(state.available).toEqual([
      { pluginId: "format@team", name: "format", marketplaceName: "team", description: "Formats" },
    ]);
  });

  it("recognizes a plugin Grok loads from Claude's install", () => {
    expect(isClaudeSharedPluginPath("/Users/me/.claude/plugins/cache/team/lint/1.0.0")).toBe(true);
    expect(isClaudeSharedPluginPath("/Users/me/.grok/installed-plugins/lint-1")).toBe(false);
  });
});

describe("representativeInstalls", () => {
  it("keeps the first install of each plugin unless a user-scope install follows", () => {
    expect(
      representativeInstalls([
        { id: "a@m", scope: "project" },
        { id: "b@m", scope: "local" },
        { id: "a@m", scope: "user" },
        { id: "b@m", scope: "project" },
      ]),
    ).toEqual([
      { id: "a@m", scope: "user" },
      { id: "b@m", scope: "local" },
    ]);
  });
});

// A fake of the `claude plugin` subcommands that keeps installed state between calls.
interface FakeInstall {
  readonly id: string;
  readonly scope: string;
  readonly projectPath?: string;
  readonly enabled: boolean;
}

interface RecordedCommand {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
  readonly gitPromptDisabled: boolean;
}

interface FakeCliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly installs: ReadonlyArray<FakeInstall>;
}

const claudeInstanceId = ProviderInstanceId.make("claude");
const claudeInstance = {
  instanceId: claudeInstanceId,
  driverKind: ProviderDriverKind.make("claudeAgent"),
} as ProviderInstance;

const MARKETPLACES = [{ name: "team", repo: "acme/plugins" }];
const AVAILABLE = [
  { pluginId: "lint@team", name: "lint", marketplaceName: "team" },
  { pluginId: "format@team", name: "format", marketplaceName: "team" },
];

const scopeOf = (args: ReadonlyArray<string>) => {
  const index = args.indexOf("--scope");
  return index === -1 ? "user" : (args[index + 1] ?? "user");
};

/** `args` starts with `plugin`, as the service passes them. */
function runFakeCli(
  args: ReadonlyArray<string>,
  installs: ReadonlyArray<FakeInstall>,
): FakeCliResult {
  const [verb = "", subject = ""] = args.slice(1);
  const ok = (stdout = "", next = installs): FakeCliResult => ({
    code: 0,
    stdout,
    stderr: "",
    installs: next,
  });
  const failed = (summary: string): FakeCliResult => ({
    code: 1,
    stdout: "",
    stderr: `✘ ${summary}`,
    installs,
  });
  if (args[1] === "marketplace" && args[2] === "list") return ok(JSON.stringify(MARKETPLACES));
  if (args[1] === "marketplace") return ok();
  if (verb === "list") {
    const entries = installs.map((entry) => ({
      id: entry.id,
      scope: entry.scope,
      enabled: entry.enabled,
      ...(entry.projectPath === undefined ? {} : { projectPath: entry.projectPath }),
    }));
    return ok(
      JSON.stringify(
        args.includes("--available") ? { installed: entries, available: AVAILABLE } : entries,
      ),
    );
  }
  if (verb === "install") {
    if (!AVAILABLE.some((entry) => entry.pluginId === subject)) {
      return failed(
        `Failed to install plugin "${subject}": Plugin not found in marketplace "team"`,
      );
    }
    return ok("", [...installs, { id: subject, scope: "user", enabled: true }]);
  }
  const scope = scopeOf(args);
  const target = installs.find((entry) => entry.id === subject && entry.scope === scope);
  if (target === undefined) {
    return failed(`Failed to ${verb} plugin "${subject}": not installed at scope ${scope}`);
  }
  if (verb === "uninstall") {
    return ok(
      "",
      installs.filter((entry) => entry !== target),
    );
  }
  if (verb === "enable" || verb === "disable") {
    return ok(
      "",
      installs.map((entry) =>
        entry === target ? { ...entry, enabled: verb === "enable" } : entry,
      ),
    );
  }
  return failed(`Unknown command ${verb}`);
}

const makeFakeCli = (initial: ReadonlyArray<FakeInstall>) =>
  Effect.gen(function* () {
    return {
      installs: yield* Ref.make(initial),
      commands: yield* Ref.make<ReadonlyArray<RecordedCommand>>([]),
      installsInFlight: yield* Ref.make(0),
      peakInstalls: yield* Ref.make(0),
    };
  });

type FakeCli = Effect.Success<ReturnType<typeof makeFakeCli>>;

/**
 * Installs yield twice while in flight, so two installs running at once would interleave
 * and show up in `peakInstalls`. Only installs are counted: a list reads two commands at once.
 */
const spawnerFor = (cli: FakeCli) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const standard = command._tag === "StandardCommand" ? command : undefined;
      const args = standard?.args ?? [];
      const cwd = typeof standard?.options.cwd === "string" ? standard.options.cwd : undefined;
      const gitPromptDisabled = standard?.options.env?.GIT_TERMINAL_PROMPT === "0";
      const isInstall = args[1] === "install";
      if (isInstall) {
        const inFlight = yield* Ref.updateAndGet(cli.installsInFlight, (count) => count + 1);
        yield* Ref.update(cli.peakInstalls, (peak) => Math.max(peak, inFlight));
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
      }
      const result = runFakeCli(args, yield* Ref.get(cli.installs));
      yield* Ref.set(cli.installs, result.installs);
      yield* Ref.update(cli.commands, (recorded) => [
        ...recorded,
        { args, cwd, gitPromptDisabled },
      ]);
      if (isInstall) yield* Ref.update(cli.installsInFlight, (count) => count - 1);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(result.stdout)),
        stderr: Stream.encodeText(Stream.make(result.stderr)),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const layerFor = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  Layer.mergeAll(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () => Effect.succeed(claudeInstance),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      refreshInstance: () => Effect.succeed([]),
    }),
    ServerSettings.layerTest(),
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

type PluginsService = Effect.Success<ReturnType<typeof makeProviderPlugins>>;

/** What a plugins method needs at call time: the CLI spawner and the path module. */
type PluginsRequirements = ChildProcessSpawner.ChildProcessSpawner | Path.Path;

/** Runs `use` against a plugins service backed by a fake CLI that starts with `installs`. */
const withFakeCli = <A, E>(
  installs: ReadonlyArray<FakeInstall>,
  use: (plugins: PluginsService) => Effect.Effect<A, E, PluginsRequirements>,
) =>
  Effect.gen(function* () {
    const cli = yield* makeFakeCli(installs);
    const value = yield* Effect.gen(function* () {
      const plugins = yield* makeProviderPlugins(yield* Semaphore.make(1));
      return yield* use(plugins);
    }).pipe(Effect.provide(layerFor(spawnerFor(cli))));
    return {
      value,
      writes: writesOf(yield* Ref.get(cli.commands)),
      commands: yield* Ref.get(cli.commands),
      peakInstalls: yield* Ref.get(cli.peakInstalls),
    };
  });

/** The commands that change state, without the reads that surround every change. */
const writesOf = (commands: ReadonlyArray<RecordedCommand>) =>
  commands.filter(
    (command) =>
      command.args[1] !== "list" &&
      !(command.args[1] === "marketplace" && command.args[2] === "list"),
  );

describe("ProviderPlugins service", () => {
  effectIt.effect("installs by id with no scope and no project directory", () =>
    Effect.gen(function* () {
      const result = yield* withFakeCli([], (plugins) =>
        plugins.install({ instanceId: claudeInstanceId, pluginId: "lint@team" }),
      );
      expect(result.writes).toEqual([
        { args: ["plugin", "install", "lint@team"], cwd: undefined, gitPromptDisabled: true },
      ]);
      expect(result.value.plugins).toEqual([
        {
          id: "format@team",
          name: "format",
          marketplace: "team",
          installed: false,
          enabled: false,
        },
        { id: "lint@team", name: "lint", marketplace: "team", installed: true, enabled: true },
      ]);
    }),
  );

  effectIt.effect(
    "uninstalls a project-scoped plugin with its scope, from its project directory",
    () =>
      Effect.gen(function* () {
        const result = yield* withFakeCli(
          [{ id: "lint@team", scope: "project", projectPath: "/work/app", enabled: true }],
          (plugins) => plugins.uninstall({ instanceId: claudeInstanceId, pluginId: "lint@team" }),
        );
        expect(result.writes).toEqual([
          {
            args: ["plugin", "uninstall", "lint@team", "--scope", "project"],
            cwd: "/work/app",
            gitPromptDisabled: true,
          },
        ]);
        expect(result.value.plugins.find((plugin) => plugin.id === "lint@team")?.installed).toBe(
          false,
        );
      }),
  );

  effectIt.effect("toggles the user-scope install of a plugin that a project also installs", () =>
    Effect.gen(function* () {
      const result = yield* withFakeCli(
        [
          { id: "lint@team", scope: "project", projectPath: "/work/app", enabled: true },
          { id: "lint@team", scope: "user", enabled: true },
        ],
        (plugins) =>
          plugins.setEnabled({
            instanceId: claudeInstanceId,
            pluginId: "lint@team",
            enabled: false,
          }),
      );
      expect(result.writes).toEqual([
        {
          args: ["plugin", "disable", "lint@team", "--scope", "user"],
          cwd: undefined,
          gitPromptDisabled: true,
        },
      ]);
      expect(result.value.plugins.filter((plugin) => plugin.id === "lint@team")).toEqual([
        { id: "lint@team", name: "lint", marketplace: "team", installed: true, enabled: false },
      ]);
    }),
  );

  effectIt.effect(
    "refuses to uninstall a plugin that is not installed, without changing anything",
    () =>
      Effect.gen(function* () {
        const result = yield* withFakeCli([], (plugins) =>
          plugins
            .uninstall({ instanceId: claudeInstanceId, pluginId: "lint@team" })
            .pipe(Effect.flip),
        );
        expect(result.value).toMatchObject({
          reason: "not_found",
          detail: "That plugin is not installed.",
        });
        expect(result.writes).toEqual([]);
      }),
  );

  effectIt.effect("rejects a flag-shaped plugin id before any CLI call", () =>
    Effect.gen(function* () {
      const result = yield* withFakeCli([], (plugins) =>
        plugins.uninstall({ instanceId: claudeInstanceId, pluginId: "--all" }).pipe(Effect.flip),
      );
      expect(result.value).toMatchObject({
        reason: "not_found",
        detail: "That is not a valid plugin id.",
      });
      expect(result.commands).toEqual([]);
    }),
  );

  effectIt.effect("answers a failed install with the CLI's own summary", () =>
    Effect.gen(function* () {
      const result = yield* withFakeCli([], (plugins) =>
        plugins.install({ instanceId: claudeInstanceId, pluginId: "nope@team" }).pipe(Effect.flip),
      );
      expect(result.value).toMatchObject({
        reason: "not_found",
        detail: 'Failed to install plugin "nope@team": Plugin not found in marketplace "team"',
      });
    }),
  );

  effectIt.effect("does not let two connections' plugin writes overlap", () =>
    Effect.gen(function* () {
      const cli = yield* makeFakeCli([]);
      // Two services built as two WebSocket connections build them, sharing one lock.
      const sharedLock = yield* Semaphore.make(1);
      yield* Effect.gen(function* () {
        const first = yield* makeProviderPlugins(sharedLock);
        const second = yield* makeProviderPlugins(sharedLock);
        const a = yield* Effect.forkChild(
          first.install({ instanceId: claudeInstanceId, pluginId: "lint@team" }),
        );
        const b = yield* Effect.forkChild(
          second.install({ instanceId: claudeInstanceId, pluginId: "format@team" }),
        );
        yield* Fiber.join(a);
        yield* Fiber.join(b);
      }).pipe(Effect.provide(layerFor(spawnerFor(cli))));
      expect(yield* Ref.get(cli.peakInstalls)).toBe(1);
      expect((yield* Ref.get(cli.installs)).map((entry) => entry.id).sort()).toEqual([
        "format@team",
        "lint@team",
      ]);
    }),
  );

  effectIt.effect("gives up on a plugin command that never finishes", () =>
    Effect.gen(function* () {
      const hung = ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.never,
            isRunning: Effect.succeed(true),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.never,
            stderr: Stream.never,
            all: Stream.never,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          }),
        ),
      );
      const failure = yield* Effect.gen(function* () {
        const plugins = yield* makeProviderPlugins(yield* Semaphore.make(1));
        const fiber = yield* Effect.forkChild(
          plugins
            .install({ instanceId: claudeInstanceId, pluginId: "lint@team" })
            .pipe(Effect.flip),
        );
        yield* TestClock.adjust("121 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layerFor(hung)));
      expect(failure).toMatchObject({
        reason: "command_failed",
        detail: "The plugin command did not finish in time. Check your connection, then try again.",
      });
    }),
  );
});

const codexInstanceId = ProviderInstanceId.make("codex");
const codexInstance = {
  instanceId: codexInstanceId,
  driverKind: ProviderDriverKind.make("codex"),
} as ProviderInstance;

/** A fake `codex plugin` that answers lists and records every command with its CODEX_HOME. */
const codexSpawner = (
  recorded: Ref.Ref<ReadonlyArray<{ args: ReadonlyArray<string>; home: string | undefined }>>,
) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const standard = command._tag === "StandardCommand" ? command : undefined;
      const args = standard?.args ?? [];
      yield* Ref.update(recorded, (all) => [
        ...all,
        { args, home: standard?.options.env?.CODEX_HOME },
      ]);
      const stdout =
        args[1] === "marketplace" && args[2] === "list"
          ? JSON.stringify({
              marketplaces: [{ name: "team", marketplaceSource: { source: "acme/plugins" } }],
            })
          : args[1] === "list"
            ? JSON.stringify({
                installed: [
                  { pluginId: "lint@team", name: "lint", marketplaceName: "team", enabled: true },
                ],
                available: [],
              })
            : "";
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

describe("ProviderPlugins service for Codex", () => {
  effectIt.effect("maps panel actions to Codex's verbs in its shared home", () =>
    Effect.gen(function* () {
      const recorded = yield* Ref.make<
        ReadonlyArray<{ args: ReadonlyArray<string>; home: string | undefined }>
      >([]);
      const layer = Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: () => Effect.succeed(codexInstance),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          refreshInstance: () => Effect.succeed([]),
        }),
        ServerSettings.layerTest(),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, codexSpawner(recorded)),
      ).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

      const snapshot = yield* Effect.gen(function* () {
        const plugins = yield* makeProviderPlugins(yield* Semaphore.make(1));
        yield* plugins.install({ instanceId: codexInstanceId, pluginId: "format@team" });
        yield* plugins.uninstall({ instanceId: codexInstanceId, pluginId: "lint@team" });
        yield* plugins.updateMarketplace({ instanceId: codexInstanceId, marketplace: "team" });
        return yield* plugins.list({ instanceId: codexInstanceId });
      }).pipe(Effect.provide(layer));

      const commands = yield* Ref.get(recorded);
      const writes = commands
        .map((command) => command.args.slice(1))
        .filter((args) => args[0] !== "list" && !(args[0] === "marketplace" && args[1] === "list"));
      expect(writes).toEqual([
        ["add", "format@team"],
        ["remove", "lint@team"],
        ["marketplace", "upgrade", "team"],
      ]);
      expect(commands.every((command) => command.home?.endsWith(".codex") === true)).toBe(true);
      expect(snapshot.marketplaces).toEqual([{ name: "team", source: "acme/plugins" }]);
      expect(snapshot.plugins.map((plugin) => [plugin.id, plugin.enabled])).toEqual([
        ["lint@team", true],
      ]);
    }),
  );
});
