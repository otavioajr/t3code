import { createModelSelection } from "@t3tools/shared/model";
import { T, useGT } from "gt-react";

import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import { useSettingsScope } from "./SettingsScopeContext";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function AdvisorModelRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { environment, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["advisorModelSelection"]);
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const targets = useTextGenerationTargets({
    environmentId: environment?.environmentId ?? null,
    settings,
    providers: providers.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: null,
    selections: [settings.advisorModelSelection, settings.textGenerationModelSelection],
  });
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const dedicated = settings.advisorModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection:
        settings.advisorModelSelection ?? settings.textGenerationModelSelection,
    },
    targets.providers,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    targets.providers,
    selection.instanceId,
    selection.model,
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const setModel = (next: ReturnType<typeof createModelSelection>) => {
    const reason = modelDisabledReason(next.instanceId, next.model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Advisor model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ advisorModelSelection: next });
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={["advisorModelSelection"]}
      mixed={mixed}
      {...searchableSetting("advisor-model")}
      description={gt(
        "Model agents consult for a second opinion. Threads can pick their own. When disabled, use the text generation model.",
      )}
      control={
        connectedEnvironments.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            <T>Connect an environment first.</T>
          </span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {dedicated && !mixed && (!hasProvider || !instanceEntry) ? (
              <span className="text-sm text-muted-foreground">
                <T>No text generation providers available.</T>
              </span>
            ) : null}
            {dedicated && !mixed && hasProvider && instanceEntry ? (
              <>
                <ProviderModelPicker
                  environmentId={environment?.environmentId ?? null}
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  triggerAriaLabel={gt("Advisor model")}
                  getModelDisabledReason={modelDisabledReason}
                  onInstanceModelChange={(instanceId, model) =>
                    setModel(createModelSelection(instanceId, model))
                  }
                />
                <TraitsPicker
                  provider={instanceEntry.driverKind}
                  models={instanceEntry.models}
                  model={selection.model}
                  modelOptions={selection.options ?? []}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={settings.planModeEnabled}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    setModel(createModelSelection(selection.instanceId, selection.model, options))
                  }
                />
              </>
            ) : null}
            <Switch
              mixed={mixed}
              checked={mixed ? false : dedicated}
              disabled={!dedicated && !hasProvider}
              onCheckedChange={(checked) =>
                updateSettings({
                  advisorModelSelection: checked
                    ? createModelSelection(
                        settings.textGenerationModelSelection.instanceId,
                        settings.textGenerationModelSelection.model,
                        settings.textGenerationModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label={gt("Use a separate advisor model")}
            />
          </div>
        )
      }
    />
  );
}

export function AdvisorSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["advisorAutoConsult"]);
  return (
    <SettingsSection id="advisor" title={gt("Advisor")}>
      <AdvisorModelRow />
      <SettingsRow
        serverScoped
        settingKeys={["advisorAutoConsult"]}
        mixed={mixed}
        {...searchableSetting("advisor-auto-consult")}
        description={gt(
          "Agents decide when to consult the advisor, such as before a design decision or after failed attempts. Off, they consult it only when you turn on Advisor for a message.",
        )}
        control={
          <Switch
            mixed={mixed}
            checked={mixed ? false : settings.advisorAutoConsult}
            onCheckedChange={(checked) => updateSettings({ advisorAutoConsult: Boolean(checked) })}
            aria-label={gt("Consult the advisor automatically")}
          />
        }
      />
    </SettingsSection>
  );
}
