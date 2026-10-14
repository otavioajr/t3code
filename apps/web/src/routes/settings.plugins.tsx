import { createFileRoute } from "@tanstack/react-router";

import { PluginsSettings } from "../components/settings/PluginsSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

/** Plugins are installed on one machine's Claude, so the page follows the selected environment. */
function SettingsPluginsRoute() {
  const { environment, scope } = useSettingsScope();
  if (!environment) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          {scope.kind === "environment"
            ? `Reconnect ${scope.label} to manage its plugins.`
            : "Connect an environment to manage its plugins."}
        </p>
      </SettingsPageContainer>
    );
  }
  return (
    <PluginsSettings key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

export const Route = createFileRoute("/settings/plugins")({
  component: SettingsPluginsRoute,
});
