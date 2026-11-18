import { createFileRoute } from "@tanstack/react-router";
import { useGT } from "gt-react";

import { PluginsSettings } from "../components/settings/PluginsSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

/** Plugins are installed on one machine's Claude, so the page follows the selected environment. */
function SettingsPluginsRoute() {
  const gt = useGT();
  const { environment, scope } = useSettingsScope();
  if (!environment) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          {scope.kind === "environment"
            ? gt("Reconnect {label} to manage its plugins.", { label: scope.label })
            : gt("Connect an environment to manage its plugins.")}
        </p>
      </SettingsPageContainer>
    );
  }
  return (
    <PluginsSettings key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

export const Route = createFileRoute("/_chat/settings/plugins")({
  component: SettingsPluginsRoute,
});
