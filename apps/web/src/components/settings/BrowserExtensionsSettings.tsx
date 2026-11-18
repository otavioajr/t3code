import {
  BROWSER_EXTENSION_FAILURE_COPY,
  BrowserExtensionFailureReason,
  type BrowserExtension,
  type BrowserImportSource,
  type BrowserInstalledExtension,
  type BrowserInstalledExtensionsInput,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { readLocalApi } from "~/localApi";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const extensionFailureMessage = (cause: unknown): string => {
  const message = String((cause as { message?: unknown } | undefined)?.message ?? "");
  const reason = BrowserExtensionFailureReason.literals.find((candidate) =>
    message.includes(`failed: ${candidate}.`),
  );
  return reason === undefined ? "Something went wrong." : BROWSER_EXTENSION_FAILURE_COPY[reason];
};

interface ImportPicker {
  readonly label: string;
  readonly input: BrowserInstalledExtensionsInput;
  readonly extensions: ReadonlyArray<BrowserInstalledExtension> | null;
}

export function BrowserExtensionsSetting({ disabled }: { readonly disabled: boolean }) {
  const [extensions, setExtensions] = useState<ReadonlyArray<BrowserExtension>>([]);
  const [sources, setSources] = useState<ReadonlyArray<BrowserImportSource>>([]);
  const [picker, setPicker] = useState<ImportPicker | null>(null);
  const [busy, setBusy] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the persisted extension list and installed browsers through the desktop bridge, outside React
  useEffect(() => {
    if (!previewBridge) return;
    let cancelled = false;
    void Promise.all([
      previewBridge.listBrowserExtensions(),
      previewBridge.listBrowserHistorySources(),
    ])
      .then(([listed, listedSources]) => {
        if (cancelled) return;
        setExtensions(listed);
        setSources(listedSources);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (action: () => Promise<ReadonlyArray<BrowserExtension>>) => {
    setBusy(true);
    await action().then(setExtensions, (cause: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not update extensions",
        description: extensionFailureMessage(cause),
      });
    });
    setBusy(false);
  };

  const addFolder = async () => {
    const folder = await readLocalApi()
      ?.dialogs.pickFolder()
      .catch(() => null);
    if (!folder || !previewBridge) return;
    const bridge = previewBridge;
    await change(() => bridge.addBrowserExtension({ _tag: "folder", path: folder }));
  };

  const openPicker = async (label: string, input: BrowserInstalledExtensionsInput) => {
    if (!previewBridge) return;
    setPicker({ label, input, extensions: null });
    try {
      const installed = await previewBridge.listInstalledBrowserExtensions(input);
      setPicker({ label, input, extensions: installed });
    } catch (cause) {
      setPicker(null);
      toastManager.add({
        type: "error",
        title: "Could not read installed extensions",
        description: extensionFailureMessage(cause),
      });
    }
  };

  const importFromPicker = async (extensionId: string) => {
    const bridge = previewBridge;
    if (!bridge || !picker) return;
    const { input } = picker;
    await change(() => bridge.addBrowserExtension({ _tag: "chrome", ...input, extensionId }));
    setPicker(null);
  };

  const profiles = sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      label: `${source.name} – ${profile.name}`,
      input: { sourceId: source.id, sourceProfileDirectory: profile.directory },
    })),
  );

  return (
    <>
      <SettingsRow
        {...searchableSetting("browser-extensions")}
        description="Load unpacked Chromium extensions. Only part of the chrome.* API works, and there is no Web Store, toolbar icon, or popup. Incognito profiles skip them. Reload tabs after changes."
        control={
          <Menu>
            <MenuTrigger
              render={<Button size="sm" variant="outline" disabled={disabled || busy} />}
            >
              <PlusIcon />
              Add extension
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void addFolder()}>Load unpacked folder…</MenuItem>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Import from</MenuGroupLabel>
                {profiles.length === 0 ? (
                  <MenuItem disabled>No Chromium browsers found</MenuItem>
                ) : (
                  profiles.map((profile) => (
                    <MenuItem
                      key={`${profile.input.sourceId}:${profile.input.sourceProfileDirectory}`}
                      onClick={() => void openPicker(profile.label, profile.input)}
                    >
                      {profile.label}
                    </MenuItem>
                  ))
                )}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        }
      />
      {extensions.map((extension) => (
        <SettingsRow
          key={extension.id}
          title={extension.version ? `${extension.name} ${extension.version}` : extension.name}
          description={extension.path}
          status={extension.error}
          control={
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={disabled || busy}
                      aria-label={`Remove ${extension.name}`}
                      onClick={() => {
                        const bridge = previewBridge;
                        if (bridge) void change(() => bridge.removeBrowserExtension(extension.id));
                      }}
                    />
                  }
                >
                  <Trash2Icon />
                </TooltipTrigger>
                <TooltipPopup>Remove</TooltipPopup>
              </Tooltip>
              <Switch
                disabled={disabled || busy}
                checked={extension.enabled}
                onCheckedChange={(checked) => {
                  const bridge = previewBridge;
                  if (bridge) {
                    void change(() => bridge.setBrowserExtensionEnabled(extension.id, checked));
                  }
                }}
                aria-label={`${extension.name} enabled`}
              />
            </div>
          }
        />
      ))}
      <Dialog open={picker !== null} onOpenChange={(open) => !open && setPicker(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Import from {picker?.label}</DialogTitle>
            <DialogDescription>
              The extension is copied, so updating or removing it in the browser does not affect it
              here.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {picker?.extensions === null ? (
              <p className="text-sm text-muted-foreground">Looking for extensions…</p>
            ) : picker?.extensions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extensions found in this profile.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {picker?.extensions.map((installed) => (
                  <li key={installed.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">
                      {installed.name}{" "}
                      <span className="text-muted-foreground">{installed.version}</span>
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={installed.added || busy}
                      onClick={() => void importFromPicker(installed.id)}
                    >
                      {installed.added ? "Added" : "Add"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
