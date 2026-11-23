import { useAtomValue } from "@effect/atom-react";
import { terminalOutputText } from "@t3tools/client-runtime/state/terminal";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabelsCopy";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import { msg, T, useGT, useMessages } from "gt-react";
import { PanelRightIcon, XIcon } from "lucide-react";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { rendersServerTabNatively } from "~/browser/previewRuntime";
import { ServerBrowserSurface } from "~/browser/ServerBrowserSurface";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { linkedThreadTitle } from "~/linkedThreadSurface";
import { cn } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";
import type { MinimizedRightPanelGroup } from "~/rightPanelLayoutModel";
import {
  type RightPanelSurface,
  selectThreadRightPanelLayout,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { observedTerminalOutputAtom } from "~/state/terminalSessions";

import { m, type MessageResolver } from "../../i18n/messages";
import { DeviceStreamView } from "../device/DeviceStreamView";
import { previewBridge } from "../preview/previewBridge";
import SideThreadPane from "./SideThreadPane";

const CARD_CORNER_RADIUS = 12;
// Above panel browser views (30), below the floating mini player.
const CARD_WEBVIEW_Z_INDEX = 40;
const TERMINAL_TAIL_LINES = 40;
// Terminal output keeps its control sequences; a card shows plain text.
const ANSI_SEQUENCE =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

function cardTitle(surface: RightPanelSurface, resolve: MessageResolver = m): string {
  switch (surface.kind) {
    case "preview":
      return resolve(msg("Browser"));
    case "terminal":
      return surface.title ?? getTerminalLabel(surface.activeTerminalId, resolve);
    case "device":
      return surface.title ?? surface.target?.name ?? resolve(msg("Device"));
    case "pull-request":
      return `#${surface.number}`;
    case "pull-requests":
      return resolve(msg("Linked items"));
    case "plan":
      return resolve(msg("Plan"));
    case "issue":
      return /^\d+$/.test(surface.key) ? `#${surface.key}` : surface.key;
    case "thread":
      return resolve(msg("Thread"));
    case "linked-thread":
      return linkedThreadTitle(
        surface,
        resolve(msg("Thread on {label}", { label: surface.label })),
      );
    case "diff":
      return resolve(msg("Diff"));
    case "files":
      return resolve(msg("Files"));
    case "file":
      return surface.relativePath.split("/").at(-1) ?? surface.relativePath;
  }
}

/**
 * Groups minimized out of the right panel, oldest first. Each card shows its group's active tab
 * live; restoring puts the group back where it was.
 */
export function MinimizedPanelCards(props: {
  readonly threadRef: ScopedThreadRef;
  readonly placement: "details" | "floating";
  readonly bottomInset?: number;
  readonly sideChatParentPanel: SideChatParentPanel;
}) {
  const gt = useGT();
  const minimized = useRightPanelStore(
    (state) => selectThreadRightPanelLayout(state, props.threadRef).minimized,
  );
  if (minimized.length === 0) return null;
  const cards = minimized.map((entry) => (
    <MinimizedPanelCard
      key={entry.group.id}
      threadRef={props.threadRef}
      entry={entry}
      sideChatParentPanel={props.sideChatParentPanel}
    />
  ));
  if (props.placement === "details") {
    return (
      <section
        aria-label={gt("Minimized panels")}
        className="flex flex-col gap-2 p-2"
        data-thread-details-minimized-cards
      >
        {cards}
      </section>
    );
  }
  return (
    <section
      aria-label={gt("Minimized panels")}
      className="pointer-events-none absolute right-3 z-30 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-2"
      style={{ bottom: (props.bottomInset ?? 0) + 12 }}
      data-floating-minimized-cards
    >
      {cards}
    </section>
  );
}

function MinimizedPanelCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly entry: MinimizedRightPanelGroup;
  readonly sideChatParentPanel: SideChatParentPanel;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { threadRef, entry } = props;
  const groupId = entry.group.id;
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const tabs = entry.group.surfaceIds.flatMap(
    (id) => surfaces.find((surface) => surface.id === id) ?? [],
  );
  const previewSessions = useThreadPreviewState(threadRef).sessions;
  const titleOf = (surface: RightPanelSurface) => {
    if (surface.kind !== "preview" || !surface.resourceId) return cardTitle(surface, messages);
    const status = previewSessions[surface.resourceId]?.navStatus;
    if (!status || status._tag === "Idle") return messages(msg("Browser"));
    return status.title.trim() || status.url;
  };
  const active = tabs.find((surface) => surface.id === entry.group.activeSurfaceId) ?? tabs[0];
  if (!active) return null;
  const title = titleOf(active);
  const store = useRightPanelStore.getState;
  const sideChat = active.kind === "thread";
  // A desktop browser view is native and covers the DOM, so its controls cannot sit over it or
  // wait for a hover the page swallows; they stay pinned above the preview. A side chat keeps its
  // own header, so its card controls stay out of the way of it.
  const pinnedControls = (active.kind === "preview" && previewBridge !== null) || sideChat;
  const restoreButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={gt("Restore {title}", { title })}
            size="icon-xs"
            variant="ghost"
            onClick={() => store().restoreGroup(threadRef, groupId)}
          />
        }
      >
        <PanelRightIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>Restore</T>
      </TooltipPopup>
    </Tooltip>
  );
  const cardClassName = cn(
    "group/card pointer-events-auto relative w-full overflow-hidden rounded-xl border border-border shadow-lg/20",
    sideChat ? "h-96 bg-background" : "aspect-[16/10] bg-muted",
  );

  if (sideChat && tabs.length === 1) {
    return (
      <article
        aria-label={gt("Minimized {title}", { title })}
        data-minimized-panel-card={groupId}
        className={cardClassName}
      >
        <SideThreadPane
          key={`${scopedThreadKey(threadRef)}:${active.id}`}
          parentRef={threadRef}
          surface={active}
          parentPanel={props.sideChatParentPanel}
          onClose={() => store().closeGroup(threadRef, groupId)}
          actions={restoreButton}
        />
      </article>
    );
  }

  return (
    <article
      aria-label={gt("Minimized {title}", { title })}
      data-minimized-panel-card={groupId}
      className={cardClassName}
    >
      <div className={cn("absolute inset-x-0 bottom-0", pinnedControls ? "top-8" : "top-0")}>
        <CardPreview
          key={`${scopedThreadKey(threadRef)}:${active.id}`}
          threadRef={threadRef}
          surface={active}
          sideChatParentPanel={props.sideChatParentPanel}
        />
      </div>
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-[60] flex h-8 items-center gap-1 bg-popover/92 p-1",
          !pinnedControls &&
            "opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100",
        )}
      >
        {tabs.length > 1 ? (
          <div className="min-w-0 flex-1">
            <Select
              value={active.id}
              onValueChange={(value) => {
                if (typeof value === "string")
                  store().selectGroupSurface(threadRef, groupId, value);
              }}
            >
              <SelectTrigger size="xs" aria-label={gt("Shown tab")}>
                <SelectValue>{title}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {tabs.map((surface) => (
                  <SelectItem key={surface.id} value={surface.id}>
                    {titleOf(surface)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">{title}</span>
        )}
        {restoreButton}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={gt("Close {title}", { title })}
                size="icon-xs"
                variant="ghost"
                onClick={() => store().closeGroup(threadRef, groupId)}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <T>Close</T>
          </TooltipPopup>
        </Tooltip>
      </div>
    </article>
  );
}

function CardPreview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surface: RightPanelSurface;
  readonly sideChatParentPanel: SideChatParentPanel;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { surface } = props;
  switch (surface.kind) {
    case "preview":
      return surface.resourceId ? (
        <BrowserCardPreview threadRef={props.threadRef} tabId={surface.resourceId} />
      ) : (
        <StaticCardPreview label={gt("Browser")} />
      );
    case "device":
      return surface.target ? (
        <DeviceCardPreview threadRef={props.threadRef} target={surface.target} />
      ) : (
        <StaticCardPreview label={gt("Device")} />
      );
    case "terminal":
      return (
        <TerminalCardPreview threadRef={props.threadRef} terminalId={surface.activeTerminalId} />
      );
    case "thread":
      return (
        <SideThreadPane
          parentRef={props.threadRef}
          surface={surface}
          parentPanel={props.sideChatParentPanel}
          onClose={() => useRightPanelStore.getState().closeSurface(props.threadRef, surface.id)}
        />
      );
    default:
      return <StaticCardPreview label={cardTitle(surface, messages)} />;
  }
}

function StaticCardPreview(props: { readonly label: string }) {
  return (
    <div className="flex size-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
      {props.label}
    </div>
  );
}

function BrowserCardPreview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
}) {
  const gt = useGT();
  const { threadRef, tabId } = props;
  const previewState = useThreadPreviewState(threadRef);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const snapshot = previewState.sessions[tabId] ?? null;
  if (!snapshot) return <StaticCardPreview label={gt("Browser")} />;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const serverTab =
    snapshot.runtime === "server" &&
    !rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot);
  if (serverTab) {
    const pdfUrl =
      snapshot.navStatus._tag === "Success"
        ? previewPdfAssetUrl(snapshot.navStatus.url, httpBaseUrl)
        : null;
    return (
      <ServerBrowserSurface
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        tabId={tabId}
        pdfUrl={pdfUrl}
        visible
        followSize={false}
        className="pointer-events-none size-full"
      />
    );
  }
  if (!previewBridge) return <StaticCardPreview label={gt("Open in the desktop app")} />;
  return (
    <BrowserSurfaceSlot
      tabId={runtimeTabId}
      visible={Boolean(desktopOverlay?.hasWebContents)}
      cornerRadius={CARD_CORNER_RADIUS}
      zIndex={CARD_WEBVIEW_Z_INDEX}
      fitSourceContent
      className="absolute inset-0"
    />
  );
}

function DeviceCardPreview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly target: NonNullable<Extract<RightPanelSurface, { kind: "device" }>["target"]>;
}) {
  const gt = useGT();
  const { threadRef, target } = props;
  const { state } = useDeviceState(threadRef.environmentId);
  const device = state.devices.find(
    (entry) => entry.hostId === target.hostId && entry.id === target.deviceId,
  );
  const host = state.hosts.find((entry) => entry.id === target.hostId);
  return (
    <div className="pointer-events-none size-full">
      <DeviceStreamView
        environmentId={threadRef.environmentId}
        platform={target.platform}
        deviceId={target.deviceId}
        hostId={target.hostId}
        deviceName={device?.name ?? target.name}
        deviceDescription={`${host?.label ?? gt("Device host")} · ${device?.version ?? target.platform}`}
        visible
        viewId={`minimized-card\u0000${scopedThreadKey(threadRef)}\u0000${target.hostId}\u0000${target.deviceId}`}
        serveSimOnly={host?.kind === "simlock"}
      />
    </div>
  );
}

/** The session's tail as text; it re-renders only when output arrives. */
function TerminalCardPreview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
}) {
  const gt = useGT();
  const output = useAtomValue(
    observedTerminalOutputAtom(
      props.threadRef.environmentId,
      props.threadRef.threadId,
      props.terminalId,
    ),
  );
  const text = output ? terminalOutputText(output).replace(ANSI_SEQUENCE, "") : "";
  const tail = text.split(/\r?\n/).slice(-TERMINAL_TAIL_LINES).join("\n");
  return (
    <pre
      aria-label={gt("Terminal output")}
      className="flex size-full flex-col justify-end overflow-hidden whitespace-pre-wrap break-all bg-background p-2 font-mono text-3xs leading-tight text-foreground/80"
    >
      {tail}
    </pre>
  );
}
