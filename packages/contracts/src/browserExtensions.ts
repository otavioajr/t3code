import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserImportSourceId } from "./browserImport.ts";

export const BROWSER_EXTENSION_MAX_COUNT = 20;

export const BrowserExtensionSource = Schema.Literals(["folder", "chrome"]);
export type BrowserExtensionSource = typeof BrowserExtensionSource.Type;

export const BrowserExtension = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: Schema.optional(Schema.String),
  path: TrimmedNonEmptyString,
  source: BrowserExtensionSource,
  enabled: Schema.Boolean,
  /** Why the extension could not be read or loaded; absent when it is fine. */
  error: Schema.optional(Schema.String),
});
export type BrowserExtension = typeof BrowserExtension.Type;

export const BrowserInstalledExtensionsInput = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
});
export type BrowserInstalledExtensionsInput = typeof BrowserInstalledExtensionsInput.Type;

/** An extension installed in a Chromium profile, offered for import. */
export const BrowserInstalledExtension = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: Schema.String,
  added: Schema.Boolean,
});
export type BrowserInstalledExtension = typeof BrowserInstalledExtension.Type;

export const BrowserExtensionAddInput = Schema.Union([
  Schema.TaggedStruct("folder", { path: TrimmedNonEmptyString }),
  Schema.TaggedStruct("chrome", {
    ...BrowserInstalledExtensionsInput.fields,
    extensionId: TrimmedNonEmptyString,
  }),
]);
export type BrowserExtensionAddInput = typeof BrowserExtensionAddInput.Type;

export const BrowserExtensionSetEnabledInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type BrowserExtensionSetEnabledInput = typeof BrowserExtensionSetEnabledInput.Type;

export const BrowserExtensionRemoveInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type BrowserExtensionRemoveInput = typeof BrowserExtensionRemoveInput.Type;

export const BrowserExtensionFailureReason = Schema.Literals([
  "invalidFolder",
  "limitReached",
  "unknownSource",
  "unknownSourceProfile",
  "extensionNotFound",
  "unknownExtension",
  "copyFailed",
  "saveFailed",
]);
export type BrowserExtensionFailureReason = typeof BrowserExtensionFailureReason.Type;

export const BROWSER_EXTENSION_FAILURE_COPY: Readonly<
  Record<BrowserExtensionFailureReason, string>
> = {
  invalidFolder:
    "That folder is not an unpacked extension. Choose the folder that contains manifest.json.",
  limitReached: "You've reached the extension limit. Remove one to add another.",
  unknownSource: "That browser is no longer available.",
  unknownSourceProfile: "That browser profile no longer exists.",
  extensionNotFound: "That extension is no longer installed in the browser profile.",
  unknownExtension: "That extension was already removed.",
  copyFailed: "The extension's files could not be copied.",
  saveFailed: "The extension list could not be saved. Try again.",
};
