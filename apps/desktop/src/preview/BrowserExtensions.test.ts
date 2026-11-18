import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as BrowserExtensions from "./BrowserExtensions.ts";
import * as BrowserSession from "./BrowserSession.ts";

const CHROME_ID = "abcdefghijklmnopabcdefghijklmnop";

const makeHarness = Effect.fnUntraced(function* (options?: { readonly stateDir?: string }) {
  const fileSystem = yield* FileSystem.FileSystem;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-extensions-" });
  const stateDir = options?.stateDir ?? `${home}/state`;
  const sessionCalls: Array<ReadonlyArray<string>> = [];
  const layer = BrowserExtensions.layer.pipe(
    Layer.provide(
      Layer.succeed(
        BrowserSession.BrowserSession,
        BrowserSession.BrowserSession.of({
          getPartition: () => Effect.die("unused"),
          isPartition: () => false,
          getSession: () => Effect.die("unused"),
          setExtensions: (paths) =>
            Effect.sync(() => {
              sessionCalls.push(paths);
              return new Map(
                paths.filter((path) => path.endsWith("rejected")).map((path) => [path, "Nope"]),
              );
            }),
          clearCookies: () => Effect.die("unused"),
          clearCache: () => Effect.die("unused"),
          cookiesCleared: () => Effect.die("unused"),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        stateDir,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.provide(Layer.succeed(HostProcess.Environment, { HOME: home })),
    Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(NodeServices.layer),
  );
  const build = () =>
    Layer.build(layer).pipe(
      Effect.map((services) => Context.get(services, BrowserExtensions.BrowserExtensions)),
    );
  const writeExtension = Effect.fnUntraced(function* (directory: string, manifest: object) {
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(`${directory}/manifest.json`, JSON.stringify(manifest));
    return directory;
  });
  return { build, fileSystem, home, stateDir, sessionCalls, writeExtension };
});

describe("BrowserExtensions", () => {
  it.effect("persists an unpacked folder, loads it, and reloads it on the next start", () =>
    Effect.gen(function* () {
      const { build, home, sessionCalls, writeExtension } = yield* makeHarness();
      const folder = yield* writeExtension(`${home}/my-ext`, {
        name: "My extension",
        version: "1.2.3",
        manifest_version: 3,
      });
      const extensions = yield* build();

      const added = yield* extensions.add({ _tag: "folder", path: folder });
      assert.deepEqual(
        added.map(({ name, version, source, enabled }) => ({ name, version, source, enabled })),
        [{ name: "My extension", version: "1.2.3", source: "folder", enabled: true }],
      );
      assert.deepEqual(sessionCalls.at(-1), [folder]);
      assert.lengthOf(yield* extensions.add({ _tag: "folder", path: folder }), 1);

      const disabled = yield* extensions.setEnabled({ id: added[0]!.id, enabled: false });
      assert.isFalse(disabled[0]?.enabled);
      assert.deepEqual(sessionCalls.at(-1), []);

      sessionCalls.length = 0;
      yield* extensions.setEnabled({ id: added[0]!.id, enabled: true });
      const restarted = yield* build();
      assert.deepEqual(sessionCalls.at(-1), [folder]);
      assert.deepEqual(
        (yield* restarted.list).map((extension) => extension.id),
        [added[0]!.id],
      );

      assert.lengthOf(yield* restarted.remove({ id: added[0]!.id }), 0);
      assert.deepEqual(sessionCalls.at(-1), []);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "rejects folders that are not extensions and reports load and missing-folder errors",
    () =>
      Effect.gen(function* () {
        const { build, fileSystem, home, writeExtension } = yield* makeHarness();
        const extensions = yield* build();
        yield* fileSystem.makeDirectory(`${home}/empty`, { recursive: true });
        const theme = yield* writeExtension(`${home}/theme`, { name: "A theme", theme: {} });

        for (const path of [`${home}/empty`, `${home}/missing`, theme]) {
          const error = yield* extensions.add({ _tag: "folder", path }).pipe(Effect.flip);
          assert.equal(error.reason, "invalidFolder");
        }

        const rejected = yield* writeExtension(`${home}/rejected`, {
          name: "Rejected",
          version: "1",
        });
        const [listed] = yield* extensions.add({ _tag: "folder", path: rejected });
        assert.equal(listed?.error, "Nope");

        yield* fileSystem.remove(rejected, { recursive: true });
        assert.include((yield* extensions.list)[0]?.error, "missing");
        const unknown = yield* extensions
          .setEnabled({ id: "nope", enabled: false })
          .pipe(Effect.flip);
        assert.equal(unknown.reason, "unknownExtension");
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("imports a Chrome extension as a private copy and deletes the copy on removal", () =>
    Effect.gen(function* () {
      const { build, fileSystem, home, sessionCalls, stateDir, writeExtension } =
        yield* makeHarness();
      const chrome = `${home}/Library/Application Support/Google/Chrome`;
      yield* fileSystem.makeDirectory(`${chrome}/Default`, { recursive: true });
      yield* fileSystem.writeFileString(`${chrome}/Default/Cookies`, "db");
      const versions = `${chrome}/Default/Extensions/${CHROME_ID}`;
      yield* writeExtension(`${versions}/1.9.0_0`, { name: "Old", version: "1.9.0" });
      const installed = yield* writeExtension(`${versions}/1.10.0_0`, {
        name: "__MSG_appName__",
        version: "1.10.0",
        default_locale: "en",
      });
      yield* fileSystem.makeDirectory(`${installed}/_locales/en`, { recursive: true });
      yield* fileSystem.writeFileString(
        `${installed}/_locales/en/messages.json`,
        JSON.stringify({ appName: { message: "Reader" } }),
      );
      yield* writeExtension(`${chrome}/Default/Extensions/${"b".repeat(32)}/1_0`, {
        name: "Dark theme",
        theme: {},
      });
      const extensions = yield* build();
      const source = { sourceId: "chrome", sourceProfileDirectory: "Default" } as const;

      assert.deepEqual(yield* extensions.listInstalled(source), [
        { id: CHROME_ID, name: "Reader", version: "1.10.0", added: false },
      ]);
      const [added] = yield* extensions.add({ _tag: "chrome", ...source, extensionId: CHROME_ID });
      assert.equal(added?.name, "Reader");
      assert.isTrue(added?.path.startsWith(stateDir));
      assert.deepEqual(sessionCalls.at(-1), [added?.path]);
      assert.isTrue(yield* fileSystem.exists(`${added?.path}/manifest.json`));
      assert.isTrue((yield* extensions.listInstalled(source))[0]?.added);
      assert.lengthOf(
        yield* extensions.add({ _tag: "chrome", ...source, extensionId: CHROME_ID }),
        1,
      );

      yield* extensions.remove({ id: added!.id });
      assert.isFalse(yield* fileSystem.exists(added!.path));
      assert.isTrue(yield* fileSystem.exists(installed));

      const traversal = yield* extensions
        .listInstalled({ sourceId: "chrome", sourceProfileDirectory: "../../.." })
        .pipe(Effect.flip);
      assert.equal(traversal.reason, "unknownSourceProfile");
      const firefox = yield* extensions
        .listInstalled({ sourceId: "firefox", sourceProfileDirectory: "Default" })
        .pipe(Effect.flip);
      assert.equal(firefox.reason, "unknownSource");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("does not load an extension whose list could not be saved", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const blocker = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-extensions-blocked-",
      });
      yield* fileSystem.writeFileString(`${blocker}/file`, "not a directory");
      const { build, home, sessionCalls, writeExtension } = yield* makeHarness({
        stateDir: `${blocker}/file/state`,
      });
      const folder = yield* writeExtension(`${home}/ext`, { name: "Ext" });
      const extensions = yield* build();
      sessionCalls.length = 0;

      const error = yield* extensions.add({ _tag: "folder", path: folder }).pipe(Effect.flip);
      assert.equal(error.reason, "saveFailed");
      assert.deepEqual(sessionCalls, []);
      assert.lengthOf(yield* extensions.list, 0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
