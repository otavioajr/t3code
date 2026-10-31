import type { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { getCustomModelOptionsByInstance, selectsPlanAgent } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Switch } from "../ui/switch";
import { useSettingsScope } from "./SettingsScopeContext";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

type PresetKey = "explorerSubagentModelSelection" | "executionSubagentModelSelection";

function SubagentModelRow({
  settingKey,
  kind,
}: {
  settingKey: PresetKey;
  kind: "Explorer" | "Execution";
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed([settingKey]);
  const { environment, target } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment ? providersByEnvironment.get(environment.environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const scopedDisabledReason = useScopedModelDisabledReason(settings, entries);
  const disabledReason = (instanceId: ProviderInstanceId, model: string) => {
    const entry = entries.find((entry) => entry.instanceId === instanceId);
    // Available registry instances own a V2 orchestration adapter. Unavailable
    // shadow entries (such as missing drivers) cannot launch child tasks.
    if (
      !entry?.enabled ||
      !entry.isAvailable ||
      !entry.installed ||
      entry.status === "error" ||
      entry.status === "disabled" ||
      entry.snapshot.auth.status === "unauthenticated"
    ) {
      return "This provider cannot run a child task.";
    }
    return scopedDisabledReason(instanceId, model);
  };
  const optionsByInstance = getCustomModelOptionsByInstance(settings, providers);
  const defaultSelection = settings.defaultModelSelection ?? settings.textGenerationModelSelection;
  const fallback = !disabledReason(defaultSelection.instanceId, defaultSelection.model)
    ? defaultSelection
    : entries.reduce<ReturnType<typeof createModelSelection> | undefined>((found, entry) => {
        if (found) return found;
        const model = optionsByInstance
          .get(entry.instanceId)
          ?.find((model) => !disabledReason(entry.instanceId, model.slug));
        return model ? createModelSelection(entry.instanceId, model.slug) : undefined;
      }, undefined);
  const selection = settings[settingKey] ?? fallback;
  const active = selection ?? settings.textGenerationModelSelection;
  const entry = entries.find((entry) => entry.instanceId === active.instanceId);
  const enabled = settings[settingKey] !== null;
  const pickerOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    active.instanceId,
    active.model,
  );
  return (
    <SettingsRow
      serverScoped
      settingKeys={[settingKey]}
      mixed={mixed}
      {...searchableSetting(
        kind === "Explorer" ? "explorer-subagent-model" : "execution-subagent-model",
      )}
      description={
        kind === "Explorer"
          ? "Model for research subagents. Off inherits the parent thread’s model."
          : "Model for implementation and test subagents. Off inherits the parent thread’s model."
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(enabled || mixed) && environment ? (
            <ProviderModelPicker
              environmentId={environment.environmentId}
              activeInstanceId={active.instanceId}
              model={active.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={pickerOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              triggerAriaLabel={`${kind} model`}
              {...(mixed ? { triggerLabel: "Mixed" } : {})}
              getModelDisabledReason={disabledReason}
              onInstanceModelChange={(instanceId, model) => {
                if (!disabledReason(instanceId, model)) {
                  updateSettings({ [settingKey]: createModelSelection(instanceId, model) });
                }
              }}
            />
          ) : null}
          {enabled && !mixed && entry ? (
            <TraitsPicker
              provider={entry.driverKind}
              models={entry.models}
              model={active.model}
              modelOptions={active.options ?? []}
              allowPromptInjectedEffort={false}
              planModeEnabled={settings.planModeEnabled || selectsPlanAgent(active.options)}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onModelOptionsChange={(options) =>
                updateSettings({
                  [settingKey]: createModelSelection(active.instanceId, active.model, options),
                })
              }
            />
          ) : null}
          <Switch
            mixed={mixed}
            checked={mixed ? false : enabled}
            disabled={!enabled && fallback === undefined}
            onCheckedChange={(checked) => {
              if (!checked) updateSettings({ [settingKey]: null });
              else if (fallback) updateSettings({ [settingKey]: fallback });
            }}
            aria-label={`Use a separate ${kind.toLowerCase()} model`}
          />
        </div>
      }
    />
  );
}

export function SubagentSettings() {
  return (
    <SettingsSection id="subagents" title="Subagents">
      <SubagentModelRow settingKey="explorerSubagentModelSelection" kind="Explorer" />
      <SubagentModelRow settingKey="executionSubagentModelSelection" kind="Execution" />
    </SettingsSection>
  );
}
