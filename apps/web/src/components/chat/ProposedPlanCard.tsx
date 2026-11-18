import { proposedPlanTitle } from "@t3tools/shared/proposedPlanText";
import { msg, T, useGT, Var } from "gt-react";
import { memo, useState, useId } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import {
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
} from "../../proposedPlan";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  workspaceRoot,
  onOpen,
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
  /** Opens the plan in the right panel. */
  onOpen: (() => void) | undefined;
}) {
  const gt = useGT();
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [lastSavePath, setLastSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "plan",
      unavailableMessage: msg("Clipboard API is unavailable while copying plan."),
      failureMessage: msg("Failed to copy plan to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy plan"),
          description:
            error instanceof Error ? error.message : gt("An error occurred while copying."),
        }),
      );
    },
  });
  const title = proposedPlanTitle(planMarkdown) ?? gt("Proposed plan");
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!canWriteFiles) return;
    if (!workspaceRoot) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Workspace path is unavailable"),
          description: gt("This thread does not have a workspace path to save into."),
        }),
      );
      return;
    }
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = (savePath: string) => {
    const relativePath = savePath.trim();
    if (!workspaceRoot || !readEnvironmentScope(environmentId, AuthFilesystemWriteScope)) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: gt("Enter a workspace path"),
      });
      return;
    }

    setLastSavePath(savePath);
    setIsSavingToWorkspace(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath,
          contents: saveContents,
        },
      });
      setIsSavingToWorkspace(false);
      if (result._tag === "Success") {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: gt("Plan saved to workspace"),
          description: result.value.relativePath,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not save plan"),
            description:
              error instanceof Error ? error.message : gt("An error occurred while saving."),
          }),
        );
      }
    })();
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/80 bg-card/70 py-1.5 ps-3 pe-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={gt("Open plan: {title}", { title })}
        disabled={onOpen === undefined}
        onClick={onOpen}
      >
        <span className="shrink-0 text-xs text-muted-foreground">
          <T>Created Plan</T>
        </span>
        {/* Same heading level as the message author headings in the timeline. */}
        <h3 data-thread-find-text="true" className="truncate text-sm font-medium text-foreground">
          {title}
        </h3>
        <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <Menu>
        <MenuTrigger
          render={<Button aria-label={gt("Plan actions")} size="icon-xs" variant="ghost-muted" />}
        >
          <EllipsisIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={handleCopyPlan}>
            {isCopied ? gt("Copied!") : gt("Copy to clipboard")}
          </MenuItem>
          <MenuItem onClick={handleDownload}>
            <T>Download as markdown</T>
          </MenuItem>
          <MenuItem
            onClick={openSaveDialog}
            disabled={!canWriteFiles || !workspaceRoot || isSavingToWorkspace}
          >
            <T>Save to workspace</T>
          </MenuItem>
        </MenuPopup>
      </Menu>

      <Dialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingToWorkspace) {
            setIsSaveDialogOpen(open);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <SavePlanToWorkspaceForm
            initialPath={lastSavePath || downloadFilename}
            placeholder={downloadFilename}
            workspaceRoot={workspaceRoot}
            canWriteFiles={canWriteFiles}
            saving={isSavingToWorkspace}
            onCancel={() => setIsSaveDialogOpen(false)}
            onSave={handleSaveToWorkspace}
          />
        </DialogPopup>
      </Dialog>
    </div>
  );
});

function SavePlanToWorkspaceForm({
  initialPath,
  placeholder,
  workspaceRoot,
  canWriteFiles,
  saving,
  onCancel,
  onSave,
}: {
  initialPath: string;
  placeholder: string;
  workspaceRoot: string | undefined;
  canWriteFiles: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (path: string) => void;
}) {
  const gt = useGT();
  const [savePath, setSavePath] = useState(initialPath);
  const savePathInputId = useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <T>Save plan to workspace</T>
        </DialogTitle>
        <DialogDescription>
          {workspaceRoot !== undefined ? (
            <T>
              Enter a path relative to{" "}
              <code>
                <Var>{workspaceRoot}</Var>
              </code>
              .
            </T>
          ) : (
            <T>
              Enter a path relative to <code>the workspace</code>.
            </T>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <label htmlFor={savePathInputId} className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">
            <T>Workspace path</T>
          </span>
          <Input
            id={savePathInputId}
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            disabled={saving}
          />
        </label>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          <T>Cancel</T>
        </Button>
        <Button size="sm" onClick={() => onSave(savePath)} disabled={!canWriteFiles || saving}>
          {saving ? gt("Saving...") : gt("Save")}
        </Button>
      </DialogFooter>
    </>
  );
}
