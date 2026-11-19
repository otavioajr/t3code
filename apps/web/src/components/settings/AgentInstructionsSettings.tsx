import { useGT } from "gt-react";
import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection, SettingResetButton } from "./settingsLayout";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** The Providers panel can render without a settings scope, as its tests do; this section needs one. */
export function AgentInstructionsSection() {
  const gt = useGT();
  return useOptionalSettingsScope() === null ? null : (
    <SettingsSection title={gt("Agent rules")}>
      <ScopedAgentInstructionsSettings />
    </SettingsSection>
  );
}

function ScopedAgentInstructionsSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["agentInstructions"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["agentInstructions"]}
      {...searchableSetting("agent-instructions")}
      description={gt(
        "Added to the instructions of every agent on this environment, for all providers. Applies from the agent's next turn or session.",
      )}
      resetAction={
        mixed || settings.agentInstructions !== "" ? (
          <SettingResetButton
            ariaLabel={gt("Clear agent rules")}
            onClick={() => updateSettings({ agentInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.agentInstructions}`}
          aria-label={gt("Agent rules")}
          onChange={() => {
            edited.current = true;
          }}
          rows={10}
          defaultValue={mixed ? "" : settings.agentInstructions}
          placeholder={
            mixed
              ? gt("Mixed. Enter rules to apply to all selected targets.")
              : gt("Answer in Portuguese. Ask before running commands that change anything.")
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.agentInstructions))
              updateSettings({ agentInstructions: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
