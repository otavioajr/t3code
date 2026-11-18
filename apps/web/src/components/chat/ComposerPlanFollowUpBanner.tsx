import { T, useGT } from "gt-react";
import { ClipboardListIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";

/** Review Plan: the plan awaiting a decision, with Build and a dismiss that leaves the plan alone. */
export const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
  planTitle,
  planSummary,
  buildDisabled,
  onOpenPlan,
  onBuild,
  onDismiss,
}: {
  planTitle: string | null;
  planSummary: string | null;
  buildDisabled: boolean;
  onOpenPlan: () => void;
  onBuild: () => void;
  onDismiss: () => void;
}) {
  const gt = useGT();
  return (
    <ComposerBanner.Row>
      <ComposerBanner.Icon>
        <ClipboardListIcon />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="shrink-0 font-medium text-muted-foreground">
          <T>Review Plan</T>
        </span>
        <button
          type="button"
          className="min-w-0 max-w-[45%] cursor-pointer truncate rounded-sm text-start text-foreground/85 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onOpenPlan}
        >
          {planTitle ?? gt("Plan")}
        </button>
        {planSummary ? (
          <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:inline">
            {planSummary}
          </span>
        ) : null}
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        <Button size="xs" disabled={buildDisabled} onClick={onBuild}>
          <T>Build</T>
        </Button>
        <ComposerBanner.Dismiss aria-label={gt("Dismiss plan review")} onClick={onDismiss} />
      </ComposerBanner.Actions>
    </ComposerBanner.Row>
  );
});
