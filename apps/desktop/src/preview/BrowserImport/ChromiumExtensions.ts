import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { BrowserImportPathContext, BrowserImportSourceDefinition } from "./Sources.ts";

const ExtensionManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  manifest_version: Schema.optional(Schema.Number),
  default_locale: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.Unknown),
});
const decodeManifest = Schema.decodeEffect(fromLenientJson(ExtensionManifest));
const LocaleMessages = Schema.Record(
  Schema.String,
  Schema.Struct({ message: Schema.optional(Schema.String) }),
);
const decodeLocaleMessages = Schema.decodeEffect(fromLenientJson(LocaleMessages));

export class ExtensionManifestError extends Schema.TaggedError<ExtensionManifestError>()(
  "ExtensionManifestError",
  {
    directory: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `No valid extension manifest.json in ${this.directory}.`;
  }
}

export interface ExtensionManifestSummary {
  readonly name: string;
  readonly version: string | undefined;
  readonly isTheme: boolean;
}

/** Chrome ids are 32 letters from a to p; anything else is not a directory Chrome created. */
export const isChromiumExtensionId = (value: string): boolean => /^[a-p]{32}$/.test(value);

/** Names like `__MSG_appName__` live in the default locale's messages file. */
const resolveLocalizedName = Effect.fnUntraced(function* (
  directory: string,
  name: string,
  defaultLocale: string | undefined,
  join: (...parts: ReadonlyArray<string>) => string,
) {
  const key = /^__MSG_(.+)__$/.exec(name)?.[1];
  if (key === undefined) return name;
  const fileSystem = yield* FileSystem.FileSystem;
  for (const locale of [defaultLocale, "en", "en_US"]) {
    if (locale === undefined || /[\\/]/.test(locale)) continue;
    const messages = yield* fileSystem
      .readFileString(join(directory, "_locales", locale, "messages.json"))
      .pipe(Effect.flatMap(decodeLocaleMessages), Effect.option);
    if (Option.isNone(messages)) continue;
    // Message keys are case-insensitive in Chrome's extension format.
    const found = Object.entries(messages.value).find(
      ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
    )?.[1].message;
    if (found !== undefined && found.trim() !== "") return found.trim();
  }
  return name;
});

/** Fails when the directory has no readable manifest.json with a name, so it cannot be an extension. */
export const readExtensionManifest = Effect.fn("ChromiumExtensions.readExtensionManifest")(
  function* (
    directory: string,
    join: (...parts: ReadonlyArray<string>) => string,
  ): Effect.fn.Return<ExtensionManifestSummary, ExtensionManifestError, FileSystem.FileSystem> {
    const fileSystem = yield* FileSystem.FileSystem;
    const manifest = yield* fileSystem.readFileString(join(directory, "manifest.json")).pipe(
      // A UTF-8 byte order mark would defeat JSON parsing; Chrome writes none, hand-edited files may.
      Effect.map((raw) => raw.replace(/^\uFEFF/, "")),
      Effect.flatMap(decodeManifest),
      Effect.mapError((cause) => new ExtensionManifestError({ directory, cause })),
    );
    const rawName = manifest.name?.trim();
    if (rawName === undefined || rawName === "") {
      return yield* new ExtensionManifestError({ directory });
    }
    return {
      name: yield* resolveLocalizedName(directory, rawName, manifest.default_locale, join),
      version: manifest.version,
      isTheme: manifest.theme !== undefined,
    };
  },
);

export interface InstalledChromiumExtension {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The extension's newest version directory inside the browser profile. */
  readonly directory: string;
}

/** Reads `<profile>/Extensions/<id>/<version>`; themes are skipped because they cannot run here. */
export const listInstalledChromiumExtensions = Effect.fn(
  "ChromiumExtensions.listInstalledChromiumExtensions",
)(function* (
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
): Effect.fn.Return<ReadonlyArray<InstalledChromiumExtension>, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = definition.userDataDirectory(context);
  if (definition.engine !== "chromium" || root === undefined) return [];
  const { join } = context.path;
  const extensionsDirectory = join(root, profileDirectory, "Extensions");
  const ids = yield* fileSystem
    .readDirectory(extensionsDirectory)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  const found = yield* Effect.forEach(ids.filter(isChromiumExtensionId), (id) =>
    Effect.gen(function* () {
      const versions = yield* fileSystem
        .readDirectory(join(extensionsDirectory, id))
        .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
      const newestFirst = versions.toSorted((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      );
      for (const version of newestFirst) {
        const directory = join(extensionsDirectory, id, version);
        const manifest = yield* readExtensionManifest(directory, join).pipe(Effect.option);
        if (Option.isNone(manifest)) continue;
        if (manifest.value.isTheme) return undefined;
        return {
          id,
          name: manifest.value.name,
          version: manifest.value.version ?? version,
          directory,
        } satisfies InstalledChromiumExtension;
      }
      return undefined;
    }),
  );
  return found
    .filter((extension) => extension !== undefined)
    .toSorted((left, right) => left.name.localeCompare(right.name));
});
