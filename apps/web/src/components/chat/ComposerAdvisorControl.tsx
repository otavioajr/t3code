import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useGT } from "gt-react";
import { LightbulbIcon } from "lucide-react";
import { memo } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ModelEsque } from "./providerIconUtils";
import { ProviderModelPicker } from "./ProviderModelPicker";

/**
 * Turns on the advisor for the next message. While on, a server thread also shows its advisor
 * model; picking the Settings advisor again returns the thread to following Settings.
 */
export const ComposerAdvisorControl = memo(function ComposerAdvisorControl(props: {
  environmentId: EnvironmentId;
  requested: boolean;
  disabled?: boolean;
  onRequestedChange: (requested: boolean) => void;
  /** Absent for drafts: they follow Settings until the thread exists. */
  thread: { readonly id: ThreadId; readonly advisorModelSelection: ModelSelection | null } | null;
  settingsAdvisor: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
}) {
  const gt = useGT();
  const setAdvisorSelection = useOrchestrationCommand(threadEnvironment.setAdvisorSelection, {
    reportFailure: false,
  });
  const label = props.requested
    ? gt("Advisor is on for this message. Click to turn it off")
    : gt("Ask the advisor before the agent answers this message");
  const advisor = props.thread?.advisorModelSelection ?? props.settingsAdvisor;
  const pickAdvisor = async (instanceId: ProviderInstanceId, model: string) => {
    if (!props.thread) return;
    // The picker sets no options, so the Settings advisor matches by model alone.
    const followsSettings =
      instanceId === props.settingsAdvisor.instanceId && model === props.settingsAdvisor.model;
    const result = await setAdvisorSelection({
      environmentId: props.environmentId,
      input: {
        threadId: props.thread.id,
        advisorModelSelection: followsSettings ? null : createModelSelection(instanceId, model),
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: gt("Advisor model not saved") });
    }
  };
  return (
    <>
      {props.requested && props.thread ? (
        // Narrow composers have no room beside the model picker; the thread keeps its advisor.
        <div className="hidden min-w-0 shrink sm:flex">
          <ProviderModelPicker
            environmentId={props.environmentId}
            activeInstanceId={advisor.instanceId}
            model={advisor.model}
            lockedProvider={null}
            instanceEntries={props.instanceEntries}
            modelOptionsByInstance={props.modelOptionsByInstance}
            size="xs"
            compact
            triggerAriaLabel={gt("Advisor model for this thread")}
            {...(props.getModelDisabledReason
              ? { getModelDisabledReason: props.getModelDisabledReason }
              : {})}
            onInstanceModelChange={(instanceId, model) => void pickAdvisor(instanceId, model)}
          />
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label}
              aria-pressed={props.requested}
              data-pressed={props.requested || undefined}
              disabled={props.disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => props.onRequestedChange(!props.requested)}
              className="relative shrink-0"
            >
              <LightbulbIcon />
            </Button>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </>
  );
});
