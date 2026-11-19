import { useGT } from "gt-react-native";
import type { ServerSettingsPatch } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";

export function AgentRulesSettings(props: {
  /** null when the selected targets differ. */
  rules: string | null;
  disabled: boolean;
  footer?: string | undefined;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const gt = useGT();
  // Save on exit too: Android Back hides the keyboard without ending editing.
  const draft = useRef<{ text: string; over: string | null } | null>(null);
  const save = () => {
    const current = draft.current;
    draft.current = null;
    // Drop a draft typed over an older saved value: the updated value has already remounted the input.
    if (current === null || current.over !== props.rules) return;
    const value = current.text.trim();
    if (props.rules === null || value !== props.rules) props.onChange({ agentInstructions: value });
  };
  const saveDraft = useEffectEvent(save);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves an unsent agent rules draft to server settings when the section unmounts
  useEffect(() => () => saveDraft(), []);
  return (
    <SettingsSection title={gt("Agent rules")} footer={props.footer}>
      <View className="gap-2 px-4 py-3">
        <Text className="text-sm text-foreground-muted">
          {gt(
            "Added to the instructions of every agent on this environment, for all providers. Applies from the agent's next turn or session.",
          )}
        </Text>
        <AppTextInput
          key={props.rules}
          accessibilityLabel={gt("Agent rules")}
          onChangeText={(text) => {
            draft.current = { text, over: props.rules };
          }}
          defaultValue={props.rules ?? ""}
          placeholder={
            props.rules === null
              ? gt("Mixed. Enter rules to apply to all selected targets.")
              : gt("Answer in Portuguese. Ask before running commands that change anything.")
          }
          editable={!props.disabled}
          multiline
          autoCapitalize="sentences"
          className="min-h-40 rounded-xl px-3 py-2 text-base text-foreground"
          onEndEditing={save}
        />
      </View>
    </SettingsSection>
  );
}
