import { View } from "react-native";

import { Notice } from "../../components/ui/Notice";
import { setAdvisorRequested, useComposerDraftSettings } from "../../state/use-composer-drafts";

/** Shown while Advisor is on for the next message; dismissing it turns Advisor off. */
export function AdvisorRequestNotice(props: { readonly threadKey: string }) {
  if (useComposerDraftSettings(props.threadKey).consultAdvisor !== true) return null;
  return (
    <View className="px-4 pb-3">
      <Notice
        message="The agent will consult the advisor before it answers your next message."
        icon="questionmark.bubble"
        floating
        onDismiss={() => setAdvisorRequested(props.threadKey, false)}
        dismissLabel="Turn off the advisor"
      />
    </View>
  );
}
