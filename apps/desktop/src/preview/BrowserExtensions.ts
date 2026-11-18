import {
  BROWSER_EXTENSION_MAX_COUNT,
  BrowserExtensionFailureReason,
  BrowserExtensionSource,
  type BrowserExtension,
  type BrowserExtensionAddInput,
  type BrowserExtensionRemoveInput,
  type BrowserExtensionSetEnabledInput,
  type BrowserInstalledExtension,
  type BrowserInstalledExtensionsInput,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as BrowserSession from "./BrowserSession.ts";
import {
  isChromiumExtensionId,
  listInstalledChromiumExtensions,
  readExtensionManifest,
} from "./BrowserImport/ChromiumExtensions.ts";
import {
  BROWSER_IMPORT_SOURCES,
  listSourceProfiles,
  sourcePathContext,
  type BrowserImportSourceDefinition,
} from "./BrowserImport/Sources.ts";

export class BrowserExtensionError extends Schema.TaggedError<BrowserExtensionError>()(
  "BrowserExtensionError",
  {
    reason: BrowserExtensionFailureReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // IPC preserves only the message; the renderer needs its reason token for user-facing copy.
  override get message(): string {
    return `Browser extension change failed: ${this.reason}.`;
  }
}

const StoredExtension = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.optional(Schema.String),
  path: Schema.String,
  source: BrowserExtensionSource,
  enabled: Schema.Boolean,
  /** Set when copied from a Chromium profile, so importing it again is a no-op. */
  chromeExtensionId: Schema.optional(Schema.String),
});
type StoredExtension = typeof StoredExtension.Type;
const StoreJson = fromLenientJson(Schema.Struct({ extensions: Schema.Array(StoredExtension) }));
const decodeStore = Schema.decodeEffect(StoreJson);
const encodeStore = Schema.encodeEffect(StoreJson);

export class BrowserExtensions extends Context.Service<
  BrowserExtensions,
  {
    readonly list: Effect.Effect<ReadonlyArray<BrowserExtension>>;
    readonly listInstalled: (
      input: BrowserInstalledExtensionsInput,
    ) => Effect.Effect<ReadonlyArray<BrowserInstalledExtension>, BrowserExtensionError>;
    readonly add: (
      input: BrowserExtensionAddInput,
    ) => Effect.Effect<ReadonlyArray<BrowserExtension>, BrowserExtensionError>;
    readonly setEnabled: (
      input: BrowserExtensionSetEnabledInput,
    ) => Effect.Effect<ReadonlyArray<BrowserExtension>, BrowserExtensionError>;
    readonly remove: (
      input: BrowserExtensionRemoveInput,
    ) => Effect.Effect<ReadonlyArray<BrowserExtension>, BrowserExtensionError>;
  }
>()("@t3tools/desktop/preview/BrowserExtensions") {}

/** @public */
export const make = Effect.gen(function* BrowserExtensionsMake() {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const browserSession = yield* BrowserSession.BrowserSession;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const platformServices = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const pathContext = yield* sourcePathContext;

  const readManifest = (directory: string) =>
    readExtensionManifest(directory, path.join).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

  const storePath = path.join(environment.stateDir, "browser-extensions.json");
  // Extensions imported from Chrome are copied here so a Chrome update cannot delete them.
  const managedDirectory = path.join(environment.stateDir, "browser-extensions");

  const readStore = fileSystem.readFileString(storePath).pipe(
    Effect.flatMap(decodeStore),
    Effect.map((document) => document.extensions),
    Effect.catch((cause) =>
      cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
        ? Effect.succeed([] as ReadonlyArray<StoredExtension>)
        : Effect.logWarning("Could not read the browser extension list.", {
            storePath,
            cause,
          }).pipe(Effect.as([] as ReadonlyArray<StoredExtension>)),
    ),
  );

  const writeStore = Effect.fn("BrowserExtensions.writeStore")(function* (
    extensions: ReadonlyArray<StoredExtension>,
  ) {
    const suffix = (yield* random.uuidV4()).replace(/-/g, "");
    const tempPath = `${storePath}.${suffix}.tmp`;
    yield* Effect.gen(function* () {
      const encoded = yield* encodeStore({ extensions });
      yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
      yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
      yield* fileSystem.rename(tempPath, storePath);
    }).pipe(Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)));
  });

  const stored = yield* SynchronizedRef.make(yield* readStore);
  const loadErrors = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

  const apply = Effect.fn("BrowserExtensions.apply")(function* (
    extensions: ReadonlyArray<StoredExtension>,
  ) {
    const enabled = extensions.filter((extension) => extension.enabled);
    const errors = yield* browserSession.setExtensions(enabled.map((extension) => extension.path));
    yield* Ref.set(
      loadErrors,
      new Map(
        enabled.flatMap((extension) => {
          const error = errors.get(extension.path);
          return error === undefined ? [] : [[extension.id, error] as const];
        }),
      ),
    );
  });
  yield* apply(yield* SynchronizedRef.get(stored));

  const describe = Effect.fnUntraced(function* (extensions: ReadonlyArray<StoredExtension>) {
    const errors = yield* Ref.get(loadErrors);
    return yield* Effect.forEach(
      extensions,
      Effect.fnUntraced(function* (extension): Effect.fn.Return<BrowserExtension> {
        const unreadable = yield* readManifest(extension.path).pipe(
          Effect.as(undefined),
          Effect.orElseSucceed(
            () => "The extension's folder is missing or has no valid manifest.json.",
          ),
        );
        const error = unreadable ?? errors.get(extension.id);
        return {
          id: extension.id,
          name: extension.name,
          ...(extension.version === undefined ? {} : { version: extension.version }),
          path: extension.path,
          source: extension.source,
          enabled: extension.enabled,
          ...(error === undefined ? {} : { error }),
        };
      }),
    );
  });

  /** Saves before applying: a list that failed to save must not leave the extension loaded. */
  const change = Effect.fnUntraced(function* (
    transform: (
      current: ReadonlyArray<StoredExtension>,
    ) => Effect.Effect<ReadonlyArray<StoredExtension>, BrowserExtensionError>,
  ) {
    const next = yield* SynchronizedRef.modifyEffect(stored, (current) =>
      transform(current).pipe(
        Effect.flatMap((updated) =>
          updated === current
            ? Effect.succeed([updated, updated] as const)
            : writeStore(updated).pipe(
                Effect.mapError(
                  (cause) => new BrowserExtensionError({ reason: "saveFailed", cause }),
                ),
                Effect.andThen(apply(updated)),
                Effect.as([updated, updated] as const),
              ),
        ),
      ),
    );
    return yield* describe(next);
  });

  const resolveProfile = Effect.fnUntraced(function* (input: BrowserInstalledExtensionsInput) {
    const definition: BrowserImportSourceDefinition | undefined = BROWSER_IMPORT_SOURCES.find(
      (candidate) => candidate.id === input.sourceId,
    );
    if (definition?.engine !== "chromium") {
      return yield* new BrowserExtensionError({ reason: "unknownSource" });
    }
    // IPC profile paths must match the source's listing to prevent traversal outside browser user-data.
    const profiles = yield* listSourceProfiles(definition, pathContext).pipe(
      Effect.provide(platformServices),
    );
    if (!profiles.some((profile) => profile.directory === input.sourceProfileDirectory)) {
      return yield* new BrowserExtensionError({ reason: "unknownSourceProfile" });
    }
    return yield* listInstalledChromiumExtensions(
      definition,
      pathContext,
      input.sourceProfileDirectory,
    ).pipe(Effect.provide(platformServices));
  });

  const addFolder = Effect.fnUntraced(function* (folder: string) {
    const directory = path.resolve(folder);
    const manifest = yield* readManifest(directory).pipe(
      Effect.mapError((cause) => new BrowserExtensionError({ reason: "invalidFolder", cause })),
    );
    if (manifest.isTheme) return yield* new BrowserExtensionError({ reason: "invalidFolder" });
    const id = yield* random.uuidV4();
    return {
      id,
      name: manifest.name,
      ...(manifest.version === undefined ? {} : { version: manifest.version }),
      path: directory,
      source: "folder",
      enabled: true,
    } satisfies StoredExtension;
  });

  const addFromChrome = Effect.fnUntraced(function* (
    input: Extract<BrowserExtensionAddInput, { readonly _tag: "chrome" }>,
  ) {
    if (!isChromiumExtensionId(input.extensionId)) {
      return yield* new BrowserExtensionError({ reason: "extensionNotFound" });
    }
    const installed = (yield* resolveProfile(input)).find(
      (extension) => extension.id === input.extensionId,
    );
    if (installed === undefined) {
      return yield* new BrowserExtensionError({ reason: "extensionNotFound" });
    }
    const id = yield* random.uuidV4();
    const target = path.join(managedDirectory, id);
    yield* fileSystem
      .copy(installed.directory, target)
      .pipe(Effect.mapError((cause) => new BrowserExtensionError({ reason: "copyFailed", cause })));
    return {
      id,
      name: installed.name,
      version: installed.version,
      path: target,
      source: "chrome",
      enabled: true,
      chromeExtensionId: installed.id,
    } satisfies StoredExtension;
  });

  const removeManagedCopy = (extension: StoredExtension) =>
    extension.source === "chrome" && path.dirname(extension.path) === managedDirectory
      ? fileSystem.remove(extension.path, { recursive: true, force: true }).pipe(Effect.ignore)
      : Effect.void;

  const add = Effect.fn("BrowserExtensions.add")(function* (input: BrowserExtensionAddInput) {
    return yield* change(
      Effect.fnUntraced(function* (current) {
        const existing = current.find((extension) =>
          input._tag === "folder"
            ? extension.source === "folder" && extension.path === path.resolve(input.path)
            : extension.chromeExtensionId === input.extensionId,
        );
        if (existing !== undefined) return current;
        if (current.length >= BROWSER_EXTENSION_MAX_COUNT) {
          return yield* new BrowserExtensionError({ reason: "limitReached" });
        }
        const created = yield* input._tag === "folder"
          ? addFolder(input.path)
          : addFromChrome(input);
        return [...current, created];
      }),
    );
  });

  const setEnabled = Effect.fn("BrowserExtensions.setEnabled")(function* (
    input: BrowserExtensionSetEnabledInput,
  ) {
    return yield* change(
      Effect.fnUntraced(function* (current) {
        const target = current.find((extension) => extension.id === input.id);
        if (target === undefined)
          return yield* new BrowserExtensionError({ reason: "unknownExtension" });
        if (target.enabled === input.enabled) return current;
        return current.map((extension) =>
          extension.id === input.id ? { ...extension, enabled: input.enabled } : extension,
        );
      }),
    );
  });

  const remove = Effect.fn("BrowserExtensions.remove")(function* (
    input: BrowserExtensionRemoveInput,
  ) {
    const removed = yield* Ref.make<StoredExtension | undefined>(undefined);
    const list = yield* change(
      Effect.fnUntraced(function* (current) {
        const target = current.find((extension) => extension.id === input.id);
        if (target === undefined)
          return yield* new BrowserExtensionError({ reason: "unknownExtension" });
        yield* Ref.set(removed, target);
        return current.filter((extension) => extension.id !== input.id);
      }),
    );
    const target = yield* Ref.get(removed);
    if (target !== undefined) yield* removeManagedCopy(target);
    return list;
  });

  return BrowserExtensions.of({
    list: SynchronizedRef.get(stored).pipe(Effect.flatMap(describe)),
    listInstalled: Effect.fn("BrowserExtensions.listInstalled")(function* (input) {
      const installed = yield* resolveProfile(input);
      const known = yield* SynchronizedRef.get(stored);
      return installed.map(({ id, name, version }): BrowserInstalledExtension => ({
        id,
        name,
        version,
        added: known.some((extension) => extension.chromeExtensionId === id),
      }));
    }),
    add,
    setEnabled,
    remove,
  });
});

export const layer = Layer.effect(BrowserExtensions, make);
