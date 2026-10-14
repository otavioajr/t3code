import type {
  EnvironmentId,
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import type { ComposerThreadTarget } from "../../composerDraftStore";
import { useEffectiveComposerModelState } from "../../composerDraftStore";
import { getAppModelOptionsForInstance, type AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Group } from "../ui/group";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ScrollArea } from "../ui/scroll-area";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { TraitsPicker } from "./TraitsPicker";
import { useComposerDraftStore } from "../../composerDraftStore";

const PLAN_BUILD_TARGETS = ["thread", "subagent", "new-thread"] as const;
type PlanBuildTarget = (typeof PLAN_BUILD_TARGETS)[number];
const PlanBuildTargetSchema = Schema.Literals(PLAN_BUILD_TARGETS);
const PLAN_BUILD_TARGET_LABELS: Record<PlanBuildTarget, string> = {
  thread: "Build",
  subagent: "Build with subagent",
  "new-thread": "Build in new thread",
};
// Per device, shared by every plan and kept across reloads.
const PLAN_BUILD_TARGET_STORAGE_KEY = "t3code:plan-build-target:v1";

/** The model the panel builds with, chosen in its own picker. */
export interface PlanBuildChoice {
  instanceId: ProviderInstanceId;
  model: string;
  /** Undefined means the model's defaults. */
  options?: ModelSelection["options"];
}

/**
 * Picker wiring for the panel header. The picker starts from the composer's current model and
 * then keeps its own choice, which the composer never sees.
 */
export interface PlanPanelModelPickerInput {
  environmentId: EnvironmentId;
  composerDraftTarget: ComposerThreadTarget;
  providers: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  selectedInstanceId: ProviderInstanceId | null;
  selectedProvider: ProviderDriverKind;
  threadModelSelection: Parameters<
    typeof useEffectiveComposerModelState
  >[0]["threadModelSelection"];
  projectModelSelection: Parameters<
    typeof useEffectiveComposerModelState
  >[0]["projectModelSelection"];
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey: string | null;
  keybindings: ResolvedKeybindingsConfig;
  disabled: boolean;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
}

const PlanModelPicker = memo(function PlanModelPicker(
  props: PlanPanelModelPickerInput & {
    choice: PlanBuildChoice | null;
    onChoose: (choice: PlanBuildChoice) => void;
  },
) {
  const { selectedModel, modelOptions: composerModelOptions } = useEffectiveComposerModelState({
    threadRef: props.composerDraftTarget,
    providers: props.providers,
    selectedProvider: props.selectedProvider,
    selectedInstanceId: props.selectedInstanceId,
    threadModelSelection: props.threadModelSelection,
    projectModelSelection: props.projectModelSelection,
    settings: props.settings,
  });
  const activeInstanceId = props.choice?.instanceId ?? props.selectedInstanceId;
  const activeModel = props.choice?.model ?? selectedModel;
  const activeProvider =
    props.instanceEntries.find((entry) => entry.instanceId === activeInstanceId)?.driverKind ??
    props.selectedProvider;
  const activeEntry = props.instanceEntries.find((entry) => entry.instanceId === activeInstanceId);
  // The composer's options while the panel shows the composer's model, the panel's own after.
  const activeTraitOptions = props.choice
    ? props.choice.options
    : activeInstanceId === null
      ? undefined
      : composerModelOptions?.[activeInstanceId];
  const modelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of props.instanceEntries) {
      out.set(
        entry.instanceId,
        getAppModelOptionsForInstance(
          props.settings,
          entry,
          entry.instanceId === activeInstanceId ? activeModel : null,
        ),
      );
    }
    return out;
  }, [props.instanceEntries, activeInstanceId, props.settings, activeModel]);

  if (activeInstanceId === null) return null;
  const currentOptions = modelOptionsByInstance.get(activeInstanceId) ?? [];
  const model = currentOptions.some((option) => option.slug === activeModel)
    ? activeModel
    : (normalizeModelSlug(activeModel, activeProvider) ?? activeModel);

  return (
    <>
      <ProviderModelPicker
        environmentId={props.environmentId}
        activeInstanceId={activeInstanceId}
        model={model}
        lockedProvider={props.lockedProvider}
        lockedContinuationGroupKey={props.lockedContinuationGroupKey}
        instanceEntries={props.instanceEntries}
        keybindings={props.keybindings}
        modelOptionsByInstance={modelOptionsByInstance}
        size="xs"
        disabled={props.disabled}
        getModelDisabledReason={props.getModelDisabledReason}
        onInstanceModelChange={(instanceId, nextModel) => {
          // A newly picked model starts from the options last used for it, like the composer's.
          const remembered =
            useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[
              nextModel
            ];
          props.onChoose({
            instanceId,
            model: nextModel,
            ...(remembered !== undefined && remembered.length > 0
              ? { options: [...remembered] }
              : {}),
          });
        }}
        onOpenProviderSetup={props.onOpenProviderSetup}
      />
      {activeEntry ? (
        <TraitsPicker
          provider={activeEntry.driverKind}
          instanceId={activeEntry.instanceId}
          models={activeEntry.models}
          model={model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={activeTraitOptions}
          allowPromptInjectedEffort={false}
          planModeEnabled={props.settings.planModeEnabled}
          size="xs"
          disabled={props.disabled}
          onModelOptionsChange={(options) =>
            props.onChoose({
              instanceId: activeEntry.instanceId,
              model,
              ...(options ? { options } : {}),
            })
          }
        />
      ) : null}
    </>
  );
});

/**
 * One proposed plan in the right panel: Build starts the implementation, in this thread or a
 * new one, on the model chosen in the header.
 */
export const PlanPanel = memo(function PlanPanel({
  planMarkdown,
  environmentId,
  threadRef,
  cwd,
  buildDisabled,
  onBuild,
  onBuildInNewThread,
  onBuildWithSubagent,
  modelPicker,
}: {
  /** Null when the plan is not in the thread projection (yet or anymore). */
  planMarkdown: string | null;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | undefined;
  cwd: string | undefined;
  /** False only for the thread's current, actionable plan while no turn is running. */
  buildDisabled: boolean;
  onBuild: (choice: PlanBuildChoice | undefined) => void;
  onBuildInNewThread: (choice: PlanBuildChoice | undefined) => void;
  /** Same-thread turn on the composer's model that delegates the build to a subagent on the choice. */
  onBuildWithSubagent: (choice: PlanBuildChoice | undefined) => void;
  modelPicker: PlanPanelModelPickerInput;
}) {
  // Null until the user picks: Build then runs on the composer's model, as the banner does.
  const [choice, setChoice] = useState<PlanBuildChoice | null>(null);
  const [buildTarget, setBuildTarget] = useLocalStorage<PlanBuildTarget, PlanBuildTarget>(
    PLAN_BUILD_TARGET_STORAGE_KEY,
    "thread",
    PlanBuildTargetSchema,
  );
  const runBuild = (target: PlanBuildTarget) => {
    const picked = choice ?? undefined;
    if (target === "subagent") onBuildWithSubagent(picked);
    else if (target === "new-thread") onBuildInNewThread(picked);
    else onBuild(picked);
  };
  const title = planMarkdown === null ? null : (proposedPlanTitle(planMarkdown) ?? null);
  const displayedMarkdown = useMemo(
    () => (planMarkdown === null ? "" : stripDisplayedPlanMarkdown(planMarkdown)),
    [planMarkdown],
  );

  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col" data-plan-panel="true">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <nav
          aria-label="Plan breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground"
        >
          <span className="shrink-0">Plans</span>
          <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate font-medium text-foreground">{title ?? "Plan"}</span>
        </nav>
        {planMarkdown === null ? null : (
          <>
            <PlanModelPicker {...modelPicker} choice={choice} onChoose={setChoice} />
            <Group>
              <Button size="xs" disabled={buildDisabled} onClick={() => runBuild(buildTarget)}>
                {PLAN_BUILD_TARGET_LABELS[buildTarget]}
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <Button size="icon-xs" aria-label="Build options" disabled={buildDisabled} />
                  }
                >
                  <ChevronDownIcon aria-hidden="true" className="size-3.5" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={buildTarget}
                    onValueChange={(value) => setBuildTarget(value as PlanBuildTarget)}
                  >
                    {PLAN_BUILD_TARGETS.map((target) => (
                      <MenuRadioItem key={target} value={target}>
                        <span className="flex items-center justify-between gap-4">
                          {PLAN_BUILD_TARGET_LABELS[target]}
                          <MenuRadioItemIndicator />
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            </Group>
          </>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 py-4 sm:px-6">
          {planMarkdown === null ? (
            <p className="text-sm text-muted-foreground">This plan is no longer available.</p>
          ) : (
            <ChatMarkdown
              text={displayedMarkdown}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
              isStreaming={false}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
