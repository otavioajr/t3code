import {
  AuthProvidersManageScope,
  EnvironmentAuthorizationError,
  ProviderInstanceId,
  ProviderPluginsError,
  type ProviderPluginsSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describePluginsFailure,
  describePluginsReadiness,
  groupPluginsByMarketplace,
  PLUGIN_ACCESS_DENIED_MESSAGE,
  pluginActionTarget,
  vanishedPluginTargets,
} from "./pluginsSettings.logic";

const instanceId = ProviderInstanceId.make("claude");

function pluginsError(reason: ProviderPluginsError["reason"], detail = "Something failed.") {
  return new ProviderPluginsError({ instanceId, operation: "install", reason, detail });
}

describe("describePluginsFailure", () => {
  it("asks for access or sign-in when a marketplace repository is private", () => {
    expect(describePluginsFailure("add-marketplace", pluginsError("access_denied"))).toEqual({
      heading: "Access needed",
      message: PLUGIN_ACCESS_DENIED_MESSAGE,
      tone: "warning",
      needsAccess: true,
      retryable: true,
    });
  });

  it("shows the CLI's own summary for a failed command", () => {
    const view = describePluginsFailure(
      "install-plugin",
      pluginsError("command_failed", "Plugin manifest is invalid."),
    );
    expect(view).toMatchObject({
      heading: "Could not install plugin",
      message: "Plugin manifest is invalid.",
      tone: "error",
      needsAccess: false,
      retryable: true,
    });
  });

  it("shows the server's explanation for a not found, such as a source it cannot parse", () => {
    expect(
      describePluginsFailure(
        "add-marketplace",
        pluginsError(
          "not_found",
          "Enter a GitHub repository such as owner/repo, a git URL, or a local path.",
        ),
      ),
    ).toMatchObject({
      heading: "Could not add marketplace",
      message: "Enter a GitHub repository such as owner/repo, a git URL, or a local path.",
      retryable: false,
    });
  });

  it("falls back to the refresh hint when a not found has no detail", () => {
    expect(describePluginsFailure("install-plugin", pluginsError("not_found", ""))).toMatchObject({
      message: "That marketplace or plugin no longer exists. Refresh the list and try again.",
    });
  });

  it("says what the connection cannot do when it lacks the providers grant", () => {
    const error = new EnvironmentAuthorizationError({
      message: "This connection requires providers:manage.",
      requiredScope: AuthProvidersManageScope,
    });
    expect(describePluginsFailure("uninstall-plugin", error)).toEqual({
      heading: "Access needed",
      message: "This connection cannot change plugins.",
      tone: "warning",
      needsAccess: true,
      retryable: false,
    });
    expect(describePluginsFailure("load", error).message).toBe(
      "This connection cannot view plugins.",
    );
  });
});

describe("describePluginsReadiness", () => {
  const ready = {
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
  } as const;

  it("returns nothing for a Claude instance that can manage plugins", () => {
    expect(describePluginsReadiness(ready)).toBeNull();
  });

  it("blocks changes while the instance is off or Claude is not installed", () => {
    expect(describePluginsReadiness({ ...ready, enabled: false })).toMatchObject({
      heading: "Plugins unavailable",
      blocksChanges: true,
    });
    expect(describePluginsReadiness({ ...ready, installed: false })).toMatchObject({
      heading: "Plugins unavailable",
      blocksChanges: true,
    });
  });

  it("notes a signed-out or failing Claude without blocking its plugin commands", () => {
    expect(
      describePluginsReadiness({ ...ready, auth: { status: "unauthenticated" } }),
    ).toMatchObject({ heading: "Check Claude", blocksChanges: false });
    expect(
      describePluginsReadiness({ ...ready, status: "error", message: "Claude 1.0 is too old." }),
    ).toMatchObject({ message: "Claude 1.0 is too old.", blocksChanges: false });
  });
});

describe("pluginActionTarget", () => {
  it("shares one target across a plugin row's controls and its marketplace's actions", () => {
    expect(pluginActionTarget({ kind: "install-plugin", pluginId: "lint@team" })).toBe(
      pluginActionTarget({ kind: "set-plugin-enabled", pluginId: "lint@team", enabled: true }),
    );
    expect(pluginActionTarget({ kind: "update-marketplace", marketplace: "team" })).toBe(
      pluginActionTarget({ kind: "remove-marketplace", marketplace: "team" }),
    );
    expect(pluginActionTarget({ kind: "install-plugin", pluginId: "lint@team" })).not.toBe(
      pluginActionTarget({ kind: "install-plugin", pluginId: "lint@other" }),
    );
  });
});

describe("groupPluginsByMarketplace", () => {
  it("keeps added marketplaces in order, installed plugins first, and sets apart removed ones", () => {
    const snapshot: ProviderPluginsSnapshot = {
      marketplaces: [{ name: "team", source: "acme/plugins" }, { name: "empty" }],
      plugins: [
        {
          id: "format@team",
          name: "format",
          marketplace: "team",
          installed: false,
          enabled: false,
        },
        { id: "lint@team", name: "lint", marketplace: "team", installed: true, enabled: true },
        { id: "old@gone", name: "old", marketplace: "gone", installed: true, enabled: true },
      ],
    };
    expect(
      groupPluginsByMarketplace(snapshot).map((group) => [
        group.name,
        group.source,
        group.added,
        group.plugins.map((plugin) => plugin.id),
      ]),
    ).toEqual([
      ["team", "acme/plugins", true, ["lint@team", "format@team"]],
      ["empty", null, true, []],
      ["gone", null, false, ["old@gone"]],
    ]);
  });
});

describe("vanishedPluginTargets", () => {
  const lint = {
    id: "lint@team",
    name: "lint",
    marketplace: "team",
    installed: true,
    enabled: true,
  };
  const fmt = {
    id: "fmt@other",
    name: "fmt",
    marketplace: "other",
    installed: false,
    enabled: false,
  };
  const before: ProviderPluginsSnapshot = {
    marketplaces: [{ name: "team" }, { name: "other" }],
    plugins: [lint, fmt],
  };

  it("reports the marketplace and plugin targets that left the list", () => {
    const after: ProviderPluginsSnapshot = { marketplaces: [{ name: "other" }], plugins: [fmt] };
    expect([...vanishedPluginTargets(before, after)]).toEqual([
      pluginActionTarget({ kind: "remove-marketplace", marketplace: "team" }),
      pluginActionTarget({ kind: "install-plugin", pluginId: "lint@team" }),
    ]);
  });

  it("reports nothing before the first snapshot or when every row is still listed", () => {
    expect(vanishedPluginTargets(null, before).size).toBe(0);
    expect(vanishedPluginTargets(before, before).size).toBe(0);
  });
});
