import {
  EnvironmentAuthorizationError,
  ProviderPluginsError,
  type ProviderPlugin,
  type ProviderPluginsSnapshot,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** One request the plugins page can send for a row or the add input. */
export type PluginAction =
  | { readonly kind: "add-marketplace"; readonly source: string }
  | { readonly kind: "update-marketplace"; readonly marketplace: string }
  | { readonly kind: "remove-marketplace"; readonly marketplace: string }
  | { readonly kind: "install-plugin"; readonly pluginId: string }
  | { readonly kind: "set-plugin-enabled"; readonly pluginId: string; readonly enabled: boolean }
  | { readonly kind: "uninstall-plugin"; readonly pluginId: string };

/*
 * A pending state and the last error attach to a target, not to an action, so
 * every control on one row is busy together and a failure shows on that row.
 */
export const ADD_MARKETPLACE_TARGET = "add-marketplace";

export function marketplaceTarget(marketplace: string): string {
  return JSON.stringify(["marketplace", marketplace]);
}

export function pluginTarget(pluginId: string): string {
  return JSON.stringify(["plugin", pluginId]);
}

export function pluginActionTarget(action: PluginAction): string {
  switch (action.kind) {
    case "add-marketplace":
      return ADD_MARKETPLACE_TARGET;
    case "update-marketplace":
    case "remove-marketplace":
      return marketplaceTarget(action.marketplace);
    case "install-plugin":
    case "set-plugin-enabled":
    case "uninstall-plugin":
      return pluginTarget(action.pluginId);
  }
}

/**
 * Targets that left the list between two snapshots. A failure on a target that is gone
 * must not reappear when the marketplace is added back and its rows return with it.
 */
export function vanishedPluginTargets(
  previous: ProviderPluginsSnapshot | null,
  next: ProviderPluginsSnapshot,
): ReadonlySet<string> {
  const vanished = new Set<string>();
  if (previous === null) return vanished;
  const marketplaces = new Set(next.marketplaces.map((marketplace) => marketplace.name));
  const plugins = new Set(next.plugins.map((plugin) => plugin.id));
  for (const marketplace of previous.marketplaces) {
    if (!marketplaces.has(marketplace.name)) vanished.add(marketplaceTarget(marketplace.name));
  }
  for (const plugin of previous.plugins) {
    if (!plugins.has(plugin.id)) vanished.add(pluginTarget(plugin.id));
  }
  return vanished;
}

/** Failures are described by the action that failed, or by the initial load. */
type PluginsFailureContext = "load" | PluginAction["kind"];

const FAILURE_HEADINGS: Readonly<Record<PluginsFailureContext, string>> = {
  load: "Could not load plugins",
  "add-marketplace": "Could not add marketplace",
  "update-marketplace": "Could not update marketplace",
  "remove-marketplace": "Could not remove marketplace",
  "install-plugin": "Could not install plugin",
  "set-plugin-enabled": "Could not change plugin",
  "uninstall-plugin": "Could not uninstall plugin",
};

export const PLUGIN_ACCESS_DENIED_MESSAGE =
  "Repository not found or private - check the address or sign in to git";

const NOT_FOUND_MESSAGE =
  "That marketplace or plugin no longer exists. Refresh the list and try again.";

/** Every access failure uses this heading, so it reads apart from a failed command. */
const ACCESS_HEADING = "Access needed";

const isProviderPluginsError = Schema.is(ProviderPluginsError);
const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

export interface PluginsFailureView {
  readonly heading: string;
  readonly message: string;
  readonly tone: "error" | "warning" | "info";
  /** Access problems read as a sign-in or permission task, not as a failed command. */
  readonly needsAccess: boolean;
  /** Retrying helps only when the same request can now succeed. */
  readonly retryable: boolean;
}

export function describePluginsFailure(
  context: PluginsFailureContext,
  error: unknown,
): PluginsFailureView {
  const heading = FAILURE_HEADINGS[context];
  if (isProviderPluginsError(error)) {
    switch (error.reason) {
      case "access_denied":
        return {
          heading: ACCESS_HEADING,
          message: PLUGIN_ACCESS_DENIED_MESSAGE,
          tone: "warning",
          needsAccess: true,
          retryable: true,
        };
      case "not_found":
        // The server's detail names the problem, such as a source it cannot parse.
        return {
          heading,
          message: error.detail.trim().length > 0 ? error.detail : NOT_FOUND_MESSAGE,
          tone: "error",
          needsAccess: false,
          retryable: false,
        };
      case "unsupported_provider":
        return {
          heading,
          message: "This provider has no plugin system T3 Code can manage.",
          tone: "info",
          needsAccess: false,
          retryable: false,
        };
      case "command_failed":
        return {
          heading,
          message: error.detail.length > 0 ? error.detail : "The provider command failed.",
          tone: "error",
          needsAccess: false,
          retryable: true,
        };
    }
  }
  if (isEnvironmentAuthorizationError(error)) {
    // Say what this connection cannot do, not the scope it lacks.
    return {
      heading: ACCESS_HEADING,
      message:
        context === "load"
          ? "This connection cannot view plugins."
          : "This connection cannot change plugins.",
      tone: "warning",
      needsAccess: true,
      retryable: false,
    };
  }
  return {
    heading,
    message:
      error instanceof Error && error.message.length > 0
        ? error.message
        : "The request did not complete. Try again.",
    tone: "error",
    needsAccess: false,
    retryable: true,
  };
}

export interface PluginsReadinessView {
  readonly heading: string;
  readonly message: string;
  readonly tone: "warning" | "info";
  /** A provider that is off or missing cannot run plugin commands, so changes wait for it. */
  readonly blocksChanges: boolean;
}

/** The provider's own name, for copy that tells the user where to look. */
export function pluginsProviderLabel(driver: string): string {
  return driver === "codex" ? "Codex" : "Claude Code";
}

/** Why the provider instance cannot manage plugins right now, or null when it can. */
export function describePluginsReadiness(
  instance: Pick<
    ServerProvider,
    "driver" | "enabled" | "installed" | "status" | "auth" | "message"
  >,
): PluginsReadinessView | null {
  const label = pluginsProviderLabel(instance.driver);
  if (!instance.enabled) {
    return {
      heading: "Plugins unavailable",
      message: `This ${label} instance is turned off. Turn it on in Providers to manage its plugins.`,
      tone: "info",
      blocksChanges: true,
    };
  }
  if (!instance.installed) {
    return {
      heading: "Plugins unavailable",
      message: `${label} is not installed on this environment. Install it in Providers first.`,
      tone: "warning",
      blocksChanges: true,
    };
  }
  if (instance.status === "error") {
    return {
      heading: `Check ${label}`,
      message: instance.message ?? `${label} reported a problem. Check it in Providers.`,
      tone: "warning",
      blocksChanges: false,
    };
  }
  if (instance.auth.status === "unauthenticated") {
    return {
      heading: `Check ${label}`,
      message: `${label} is not signed in. If plugin commands fail, sign in on Providers.`,
      tone: "info",
      blocksChanges: false,
    };
  }
  return null;
}

export interface PluginMarketplaceGroup {
  readonly name: string;
  readonly source: string | null;
  /** False when installed plugins still come from a marketplace the user has removed. */
  readonly added: boolean;
  /** Shipped with the provider: listed for its installed plugins, never updated or removed. */
  readonly builtIn: boolean;
  readonly plugins: ReadonlyArray<ProviderPlugin>;
}

/**
 * Added marketplaces in snapshot order, user-added before built-in, then any plugin origins
 * that are no longer added.
 * Installed plugins lead each marketplace, ahead of the ones that are only available.
 */
export function groupPluginsByMarketplace(
  snapshot: ProviderPluginsSnapshot,
): ReadonlyArray<PluginMarketplaceGroup> {
  const pluginsByMarketplace = new Map<string, Array<ProviderPlugin>>();
  for (const plugin of snapshot.plugins) {
    const plugins = pluginsByMarketplace.get(plugin.marketplace);
    if (plugins === undefined) pluginsByMarketplace.set(plugin.marketplace, [plugin]);
    else plugins.push(plugin);
  }
  const installedFirst = (plugins: ReadonlyArray<ProviderPlugin> | undefined) =>
    (plugins ?? []).toSorted((left, right) => Number(right.installed) - Number(left.installed));
  const addedNames = new Set(snapshot.marketplaces.map((marketplace) => marketplace.name));
  const added = snapshot.marketplaces
    .map((marketplace): PluginMarketplaceGroup => ({
      name: marketplace.name,
      source: marketplace.source ?? null,
      added: true,
      builtIn: marketplace.builtIn === true,
      plugins: installedFirst(pluginsByMarketplace.get(marketplace.name)),
    }))
    .toSorted((left, right) => Number(left.builtIn) - Number(right.builtIn));
  const leftovers = [...pluginsByMarketplace]
    .filter(([name]) => !addedNames.has(name))
    .map(([name, plugins]): PluginMarketplaceGroup => ({
      name,
      source: null,
      added: false,
      builtIn: false,
      plugins: installedFirst(plugins),
    }));
  return [...added, ...leftovers];
}

export function pluginCountLabel(count: number): string {
  return count === 1 ? "1 plugin" : `${count} plugins`;
}
