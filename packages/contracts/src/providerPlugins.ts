import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const PluginText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));

export const ProviderPluginsInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderPluginsInput = typeof ProviderPluginsInput.Type;

/** A GitHub `owner/repo`, a git URL, or a local path, as the provider CLI accepts it. */
const ProviderPluginMarketplaceSource = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));

export const ProviderPluginMarketplace = Schema.Struct({
  name: PluginText,
  /** Where the marketplace comes from, for display: `owner/repo`, a URL, or a path. */
  source: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
});
export type ProviderPluginMarketplace = typeof ProviderPluginMarketplace.Type;

export const ProviderPlugin = Schema.Struct({
  /** `plugin@marketplace`, the id the provider CLI addresses a plugin by. */
  id: PluginText,
  name: PluginText,
  marketplace: PluginText,
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
  version: Schema.optional(PluginText),
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type ProviderPlugin = typeof ProviderPlugin.Type;

export const ProviderPluginsSnapshot = Schema.Struct({
  marketplaces: Schema.Array(ProviderPluginMarketplace).check(Schema.isMaxLength(256)),
  plugins: Schema.Array(ProviderPlugin).check(Schema.isMaxLength(4_096)),
});
export type ProviderPluginsSnapshot = typeof ProviderPluginsSnapshot.Type;

export const ProviderPluginsAddMarketplaceInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  source: ProviderPluginMarketplaceSource,
});
export type ProviderPluginsAddMarketplaceInput = typeof ProviderPluginsAddMarketplaceInput.Type;

export const ProviderPluginsMarketplaceInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  marketplace: PluginText,
});
export type ProviderPluginsMarketplaceInput = typeof ProviderPluginsMarketplaceInput.Type;

export const ProviderPluginInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  pluginId: PluginText,
});
export type ProviderPluginInput = typeof ProviderPluginInput.Type;

export const ProviderPluginSetEnabledInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  pluginId: PluginText,
  enabled: Schema.Boolean,
});
export type ProviderPluginSetEnabledInput = typeof ProviderPluginSetEnabledInput.Type;

export const ProviderPluginsErrorReason = Schema.Literals([
  /** The instance's provider has no plugin system T3 Code can drive. */
  "unsupported_provider",
  /** The repository is private, missing, or needs credentials this machine lacks. */
  "access_denied",
  /** The source or plugin id does not name a marketplace or plugin. */
  "not_found",
  "command_failed",
]);
export type ProviderPluginsErrorReason = typeof ProviderPluginsErrorReason.Type;

export class ProviderPluginsError extends Schema.TaggedError<ProviderPluginsError>()(
  "ProviderPluginsError",
  {
    instanceId: ProviderInstanceId,
    operation: Schema.String,
    reason: ProviderPluginsErrorReason,
    /** The provider CLI's own one-line failure summary, shown to the user. */
    detail: Schema.String.check(Schema.isMaxLength(1_024)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
