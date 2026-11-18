import { msg, T, useGT, useMessages } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  useProjects,
  useQuietThreadShell,
  useServerConfigs,
  useThreadShells,
} from "~/state/entities";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";
import type {
  ContextMenuItem,
  EnvironmentId,
  IssueTrackerKind,
  PreviewSessionSnapshot,
  ProjectId,
  PullRequestState,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabelsCopy";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CircleDotIcon,
  Smartphone,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Ellipsis,
  FileDiff,
  Files,
  Globe2,
  ListChecks,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Minus,
  Plus,
  Rows2,
  TerminalSquare,
  Volume2Icon,
  VolumeOffIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import type { RightPanelDropTarget, RightPanelLayout } from "~/rightPanelLayoutModel";
import { setBrowserSurfacesSuppressed } from "~/browser/browserSurfaceSuppression";
import { cn } from "~/lib/utils";
import { issueStatePresentation } from "~/components/issue/issuePresentation";
import { issueEnvironment } from "~/state/issues";
import { resolveShortcutCommand, type ShortcutMatchContext } from "~/keybindings";
import { readLocalApi } from "~/localApi";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import { AndroidIcon, AppleIcon } from "~/components/Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useBrowserDefaults } from "~/browser/browserDefaults";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { useTheme } from "~/hooks/useTheme";
import { useDeviceState } from "~/state/device";
import type { PreviewPanelInlineSize } from "~/hooks/usePreviewPanelInlineSize";
import {
  newestPullRequestSummary,
  pullRequestEnvironment,
  useSharedPullRequestSummary,
} from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { previewBridge } from "./preview/previewBridge";
import { dispatchPreviewAction } from "./preview/previewActionBus";
import { chatPaneOwnsTarget, useChatPane } from "../splitView/chatPane";
import { preventThumbButtonFocus, takeThumbButtonNavigation } from "./preview/thumbButtons";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";
import { surfaceShortcutKey } from "~/lib/surfaceShortcutKey";
import { RightPanelLayoutDivider } from "./RightPanelLayoutDivider";

export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  keybindings: ResolvedKeybindingsConfig;
  getShortcutContext: () => ShortcutMatchContext;
  widthStorageKey?: string;
  defaultWidth?: number;
  inlineSize?: PreviewPanelInlineSize;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  /** Maps server-local session ids to desktop runtime ids; session ids cannot address desktop operations. */
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
  terminalLabelsById: ReadonlyMap<string, string>;
  /** Plan titles by plan id for `plan` tabs; a tab without an entry reads "Plan". */
  planTitlesById?: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onRenameSurface?: (surfaceId: string, title: string) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  /** With a group id, closes only that group's tabs. */
  onCloseAllSurfaces: (groupId?: string) => void;
  /** Reorders within the tab's group. */
  onMoveSurface?: (surfaceId: string, toIndex: number) => void;
  /** Arranges tabs in columns and stacked groups; absent renders one tab strip. */
  groups?: RightPanelGroupsProps;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  /** Keep separate from the DOM click handler so a MouseEvent cannot become a profile id. */
  onAddBrowserInProfile: (profileId: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddPullRequests: () => void;
  onAddDevice: () => void;
  /** Absent where side chats are not offered. */
  onAddSideChat?: (() => void) | undefined;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  pullRequestsAvailable: boolean;
  deviceAvailable: boolean;
  sideChatAvailable?: boolean;
  /** Overrides the default reason while side chats are available but cannot start. */
  sideChatDisabledReason?: string | null;
  pullRequestStatusSeeds?: Readonly<Record<string, PullRequestTabStatusSeed>>;
  children: ReactNode;
}

export interface RightPanelGroupsProps {
  layout: RightPanelLayout;
  maximizedGroupId: string | null;
  renderSurface: (surface: RightPanelSurface) => ReactNode;
  onFocusGroup: (groupId: string) => void;
  onMoveSurfaceTo: (surfaceId: string, target: RightPanelDropTarget) => void;
  onResizeColumns: (sizes: readonly number[]) => void;
  onResizeGroups: (columnId: string, sizes: readonly number[]) => void;
  onToggleGroupMaximized: (groupId: string) => void;
  onMinimizeGroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export type PullRequestTabStatusSeed = Pick<PullRequestTabStatus, "state" | "isDraft">;

function shouldOpenDefaultBrowserProfileFromMenuClick(pointerType: string | undefined): boolean {
  return pointerType !== "touch";
}

const SURFACE_DISABLED_REASONS = {
  browser: msg("Browser previews are only available in the T3 Code desktop app."),
  terminal: msg("Terminal surfaces are only available from a project thread."),
  files: msg("Files are only available when a project is open."),
  diff: msg("Diff is only available for server threads in Git repositories."),
  pullRequest: msg("This thread's branch has no pull request yet."),
  pullRequests: msg("No linked pull requests are available for this thread."),
  device: msg("Devices are only available from a thread."),
  sideChat: msg("Side chats start after the first message."),
} as const;

// Closed keepMounted popups must stop blocking shortcuts once their exit transition ends.
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

const SURFACE_UNAVAILABLE_HINTS = {
  browser: msg("Only available in the desktop app."),
  terminal: msg("Available when a project is open."),
  files: msg("Available when a project is open."),
  diff: msg("Available for Git repositories."),
  pullRequest: msg("No pull request on this branch yet."),
  pullRequests: msg("No linked pull requests available."),
  device: msg("Available from a thread."),
  sideChat: msg("Available after the first message."),
} as const;

type TabContextMenuAction =
  | "move-new-column"
  | "split-down"
  | "move-to-group"
  | `move-to-group:${string}`
  | "rename"
  | "copy-path"
  | "toggle-mute"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

const TAB_SCROLL_EDGE_TOLERANCE = 1;
const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];
const NO_DRAG_MODIFIERS: typeof TAB_DRAG_MODIFIERS = [];

function tabScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

function previewTabIdOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (surface.kind !== "preview" || !surface.resourceId) return null;
  return sessions[surface.resourceId]?.tabId ?? null;
}

/**
 * Stays disabled until desktop overlay state arrives: a server session id can
 * resolve while the preview manager's createTab is still in flight, and muting
 * then fails with a PreviewTabNotFoundError nothing surfaces to the user.
 */
function tabMuteMenuItem(
  input: {
    overlay: DesktopPreviewOverlay | null;
    canResolveRuntimeTabId: boolean;
  },
  resolve: MessageResolver = m,
): { label: string; disabled: boolean } {
  const muted = input.overlay?.audioMuted ?? false;
  return {
    label: muted ? resolve(msg("Unmute tab")) : resolve(msg("Mute tab")),
    disabled: input.overlay === null || !input.canResolveRuntimeTabId,
  };
}

type TabAudioState = "none" | "audible" | "muted";

function tabAudioState(overlay: DesktopPreviewOverlay | null): TabAudioState {
  if (!overlay?.audible) return "none";
  return overlay.audioMuted ? "muted" : "audible";
}

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "getModifierState">>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = surfaceShortcutKey(event);
  return (
    actions.find((action) => action.available && action.shortcut.toLowerCase() === key) ?? null
  );
}

/** Skip contenteditable=false islands to find their editable host, matching the composer typing guard. */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddBrowserInProfile: (profileId: string) => void;
  browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddPullRequests: () => void;
  onAddDevice: () => void;
  /** Absent where side chats are not offered. */
  onAddSideChat?: (() => void) | undefined;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  pullRequestsAvailable: boolean;
  deviceAvailable: boolean;
  sideChatAvailable: boolean;
  sideChatDisabledReason: string | null;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [highlight, setHighlight] = useState(-1);

  const actions = [
    {
      label: msg("Browser"),
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.browser),
      onClick: props.onAddBrowser,
    },
    {
      label: msg("Terminal"),
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.terminal),
      onClick: props.onAddTerminal,
    },
    {
      label: msg("Files"),
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.files),
      onClick: props.onAddFiles,
    },
    {
      label: msg("Diff"),
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.diff),
      onClick: props.onAddDiff,
    },
    {
      label: msg("Pull request"),
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.pullRequest),
      onClick: props.onAddPullRequest,
    },
    {
      label: msg("Linked pull requests"),
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: props.pullRequestsAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.pullRequests),
      onClick: props.onAddPullRequests,
    },
    {
      label: msg("Device"),
      description: msg("Watch an iOS Simulator or Android Emulator."),
      icon: Smartphone,
      shortcut: "M",
      available: props.deviceAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.device),
      onClick: props.onAddDevice,
    },
    ...(props.onAddSideChat
      ? [
          {
            label: msg("Side chat"),
            description: msg("Ask a side question while this thread keeps working."),
            icon: MessagesSquare,
            shortcut: "S",
            available: props.sideChatAvailable && !props.sideChatDisabledReason,
            disabledReason:
              props.sideChatDisabledReason ?? messages(SURFACE_UNAVAILABLE_HINTS.sideChat),
            onClick: props.onAddSideChat,
          },
        ]
      : []),
  ] as const;

  type SurfaceAction = (typeof actions)[number];

  const availableActions = actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = surfaceShortcutActionForKey(availableActions, event);
    if (!action) return;
    if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
    event.preventDefault();
    event.stopPropagation();
    action.onClick();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for surface shortcuts while the menu is mounted
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      if (event.target !== event.currentTarget) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  const isHighlighted = (action: SurfaceAction) =>
    highlightIndex !== -1 && availableActions[highlightIndex] === action;

  const actionIcon = (action: SurfaceAction, iconClassName = "size-4") => {
    const Icon = action.icon;
    return (
      <span className="relative inline-flex shrink-0">
        <Icon className={iconClassName} />
      </span>
    );
  };

  return (
    <div
      data-workspace-focus-default
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={gt("Open a surface")}
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className={cn(
        "scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 outline-none",
        "pb-(--workspace-topbar-height)",
      )}
    >
      <div className="w-full max-w-xs py-6">
        <h3 className="mb-3 text-center font-medium text-foreground text-sm">
          <T>Open a surface</T>
        </h3>
        <div className="flex flex-col gap-0.5">
          {actions.map((action) =>
            action.available ? (
              <div
                key={action.label}
                className="group relative"
                onMouseEnter={() => setHighlight(availableActions.indexOf(action))}
                onMouseLeave={() =>
                  setHighlight((current) =>
                    current === availableActions.indexOf(action) ? -1 : current,
                  )
                }
              >
                <button
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors group-hover:bg-accent/60",
                    isHighlighted(action) && "bg-accent/60",
                  )}
                >
                  {actionIcon(action, "size-4")}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      action.label === "Browser" && props.browserProfiles.length > 1 && "pr-7",
                    )}
                  >
                    {messages(action.label)}
                  </span>
                  <Kbd>{action.shortcut}</Kbd>
                </button>
                {action.label === "Browser" && props.browserProfiles.length > 1 ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          aria-label={gt("Open browser in a profile")}
                          className="absolute top-1/2 right-8 -translate-y-1/2"
                          size="icon-xs"
                          variant="ghost-muted"
                        />
                      }
                    >
                      <ChevronDown className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup align="end" side="bottom" sideOffset={6} className="max-w-56">
                      {props.browserProfiles.map((profile) => (
                        <MenuItem
                          key={profile.id}
                          onClick={() => props.onAddBrowserInProfile(profile.id)}
                        >
                          <span className="min-w-0 truncate">{profile.name}</span>
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            ) : (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={
                  <div
                    tabIndex={0}
                    aria-disabled="true"
                    className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm opacity-50"
                  >
                    {actionIcon(action, "size-4")}
                    <span className="min-w-0 flex-1 truncate">{messages(action.label)}</span>
                    <Kbd>{action.shortcut}</Kbd>
                  </div>
                }
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
  planTitlesById: ReadonlyMap<string, string> | undefined,
  resolve: MessageResolver = m,
): string {
  switch (surface.kind) {
    case "diff":
      return resolve(msg("Diff"));
    case "files":
      return resolve(msg("Files"));
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal":
      return (
        surface.title ??
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId, resolve)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "pull-requests":
      return resolve(msg("Pull requests"));
    case "plan":
      return planTitlesById?.get(surface.planId) ?? resolve(msg("Plan"));
    case "issue":
      // A git host numbers its issues; a tracker with keys of its own, such as Linear, names them.
      return /^\d+$/.test(surface.key) ? `#${surface.key}` : surface.key;
    case "device":
      return surface.title ?? surface.target?.name ?? resolve(msg("Device"));
    case "side-chat":
      return resolve(msg("Side chat"));
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return resolve(msg("Browser"));
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || resolve(msg("Browser"));
      } catch {
        return resolve(msg("Browser"));
      }
    }
  }
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function previewFaviconOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>,
): { url: string | null; capturedUrl: string | null } {
  const snapshot =
    surface.kind === "preview" && surface.resourceId ? sessions[surface.resourceId] : null;
  const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
  const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
  const capturedUrl = favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
  return { url, capturedUrl };
}

function SurfaceIcon({
  surface,
  previewUrl,
  previewCapturedUrl,
  theme,
  environmentId,
  pullRequestStatusSeed,
}: {
  surface: RightPanelSurface;
  previewUrl: string | null;
  previewCapturedUrl: string | null;
  theme: "light" | "dark";
  environmentId: EnvironmentId | null;
  pullRequestStatusSeed: PullRequestTabStatusSeed | undefined;
}) {
  switch (surface.kind) {
    case "preview":
      return <PreviewFavicon capturedUrl={previewCapturedUrl} url={previewUrl} />;
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request":
      return (
        <PullRequestSurfaceIcon
          surface={surface}
          environmentId={environmentId}
          seed={pullRequestStatusSeed}
        />
      );
    case "pull-requests":
      return <PullRequestGlyph.link className="size-3 shrink-0" />;
    case "plan":
      return <ListChecks className="size-3 shrink-0" />;
    case "issue":
      return <IssueSurfaceIcon surface={surface} environmentId={environmentId} />;
    case "side-chat":
      return <SideChatTabIcon environmentId={environmentId} threadId={surface.threadId} />;
    case "device":
      return surface.target?.platform === "ios" ? (
        <AppleIcon className="size-3 shrink-0" />
      ) : surface.target?.platform === "android" ? (
        <AndroidIcon className="size-3 shrink-0" />
      ) : (
        <Smartphone className="size-3 shrink-0" />
      );
  }
}

const SIDE_CHAT_STATE_LABELS = {
  "needs approval": msg("needs approval"),
  "needs input": msg("needs input"),
  running: msg("running", { $context: "side chat status" }),
} as const;

/** What a side chat tab's dot shows and its title's accessible name says. */
function sideChatTabState(shell: EnvironmentThreadShell | null) {
  if (shell === null) return null;
  if (shell.hasPendingApprovals || shell.pendingSubagentRequest === "approval") {
    return "needs approval";
  }
  if (shell.hasPendingUserInput || shell.pendingSubagentRequest === "user_input") {
    return "needs input";
  }
  return threadRuntimeIsActive(shell.runtime) ? "running" : null;
}

// Static dots: a side chat tab can stay open for a whole run.
function SideChatTabIcon(props: { environmentId: EnvironmentId | null; threadId: ThreadId }) {
  const state = sideChatTabState(
    useQuietThreadShell(
      props.environmentId === null ? null : scopeThreadRef(props.environmentId, props.threadId),
    ),
  );
  return (
    <>
      <MessagesSquare className="size-3 shrink-0" />
      {state === null ? null : (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
            state === "running" ? "bg-muted-foreground" : "bg-info",
          )}
          aria-hidden
        />
      )}
    </>
  );
}

export function resolvePullRequestTabLink(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "pullRequests">[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
) {
  if (environmentId === null || host === null) return undefined;
  // Keys are cached per object, so one target normalizes once instead of once per link.
  const target = { host, repository: reference.repository, number: reference.number };
  let newest: EnvironmentThreadShell["pullRequests"][number] | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (!threadPullRequestKeysEqual(link, target)) continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}

/** The issue's own state mark, from the detail its panel already reads; a plain dot until then. */
function IssueSurfaceIcon({
  surface,
  environmentId,
}: {
  surface: Extract<RightPanelSurface, { kind: "issue" }>;
  environmentId: EnvironmentId | null;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null
      ? null
      : issueEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            tracker: surface.tracker as IssueTrackerKind,
            ...(surface.host ? { host: surface.host } : {}),
            scope: surface.scope,
            key: surface.key,
          },
        }),
  ).data;
  if (detail === null) return <CircleDotIcon className="size-3 shrink-0" />;
  const presentation = issueStatePresentation(detail.state);
  return (
    <presentation.Icon
      role="img"
      aria-label={presentation.label}
      className={cn("size-3 shrink-0", presentation.toneClassName)}
    />
  );
}

function PullRequestSurfaceIcon({
  surface,
  environmentId,
  seed,
}: {
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
  environmentId: EnvironmentId | null;
  seed: PullRequestTabStatusSeed | undefined;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const projects = useProjects();
  const threads = useThreadShells();
  const project = projects.find(
    (entry) => entry.environmentId === resolvedEnvironmentId && entry.id === surface.projectId,
  );
  const identity = project?.repositoryIdentity;
  const host =
    surface.host ??
    (identity?.provider
      ? sourceControlClients.changeRequestHost(identity, identity.provider)
      : null);
  const configs = useServerConfigs();
  const capabilities =
    resolvedEnvironmentId === null
      ? undefined
      : configs.get(resolvedEnvironmentId)?.environment.capabilities;
  const linkedSnapshot =
    capabilities !== undefined
      ? (resolvePullRequestTabLink(threads, resolvedEnvironmentId, host, surface)?.snapshot ?? null)
      : null;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null || capabilities === undefined || linkedSnapshot !== null
      ? null
      : pullRequestEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            ...(capabilities !== undefined && surface.host !== undefined
              ? { host: surface.host }
              : {}),
            repository: surface.repository,
            number: surface.number,
            allowStale: false,
          },
        }),
  ).data;
  const reference = {
    projectId: surface.projectId as ProjectId,
    repository: surface.repository,
    number: surface.number,
  };
  const sharedSummary = useSharedPullRequestSummary(resolvedEnvironmentId, reference);
  const status = linkedSnapshot ?? newestPullRequestSummary(detail, sharedSummary) ?? seed ?? null;
  if (status === null) {
    return <PullRequestGlyph.pullRequest className="size-3 shrink-0 text-muted-foreground" />;
  }
  const presentation = resolvePullRequestState({
    state: status.state,
    isDraft: status.isDraft ?? detail?.isDraft ?? seed?.isDraft ?? false,
  });
  return <presentation.Icon className={cn("size-3 shrink-0", presentation.toneClassName)} />;
}

function SortableTabList(props: { surfaceIds: readonly string[]; children: ReactNode }) {
  return (
    <SortableContext items={[...props.surfaceIds]} strategy={horizontalListSortingStrategy}>
      {props.children}
    </SortableContext>
  );
}

export type RightPanelDropZone = "left" | "right" | "top" | "bottom" | "center" | "tabs";

export interface RightPanelDropIndicator {
  readonly groupId: string;
  readonly zone: RightPanelDropZone;
  /** For "tabs": where in the strip the tab lands. */
  readonly index?: number;
}

const DROP_EDGE_FRACTION = 0.25;

/** Nearest edge within a quarter of the group's size, else its center. */
export function rightPanelDropZoneAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): Exclude<RightPanelDropZone, "tabs"> {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const left = (x - rect.left) / rect.width;
  const top = (y - rect.top) / rect.height;
  const edges = [
    ["left", left],
    ["right", 1 - left],
    ["top", top],
    ["bottom", 1 - top],
  ] as const;
  const [zone, distance] = edges.reduce((nearest, edge) => (edge[1] < nearest[1] ? edge : nearest));
  return distance < DROP_EDGE_FRACTION ? zone : "center";
}

export function rightPanelDropTarget(indicator: RightPanelDropIndicator): RightPanelDropTarget {
  switch (indicator.zone) {
    case "left":
    case "right":
      return { kind: "column", groupId: indicator.groupId, side: indicator.zone };
    case "top":
      return { kind: "split", groupId: indicator.groupId, side: "above" };
    case "bottom":
      return { kind: "split", groupId: indicator.groupId, side: "below" };
    case "center":
      return { kind: "join", groupId: indicator.groupId };
    case "tabs":
      return {
        kind: "join",
        groupId: indicator.groupId,
        ...(indicator.index === undefined ? {} : { index: indicator.index }),
      };
  }
}

export const MINIMIZE_NEEDS_PAGE_REASON = "Minimize works after a page has loaded";
export const MINIMIZE_UNSUPPORTED_REASON = "Files and diff panels can't be minimized";

/** Why a group cannot become a card, or null when it can. */
export function rightPanelMinimizeBlockedReason(
  surfaces: readonly RightPanelSurface[],
  activeSurface: RightPanelSurface | null,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (
    surfaces.some(
      (surface) => surface.kind === "files" || surface.kind === "file" || surface.kind === "diff",
    )
  ) {
    return MINIMIZE_UNSUPPORTED_REASON;
  }
  if (activeSurface?.kind === "preview") {
    const snapshot = activeSurface.resourceId ? sessions[activeSurface.resourceId] : undefined;
    if (!snapshot || snapshot.navStatus._tag === "Idle") return MINIMIZE_NEEDS_PAGE_REASON;
  }
  return null;
}

interface RightPanelTabHandlers {
  onActivate: (surface: RightPanelSurface) => void;
  onClose: (surface: RightPanelSurface) => void;
  onAuxClick: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onContextMenu: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onStartRename: (surfaceId: string) => void;
  onFinishRename: (surfaceId: string, title: string) => void;
}

// Chromium on Linux only suppresses primary-selection paste when mouseup is cancelled.
function preventTabMiddleButtonDefault(event: ReactMouseEvent) {
  if (event.button !== 1) return;
  event.preventDefault();
}

// Stable handlers and per-tab values let the compiler reuse tabs across parent renders.
function RightPanelTab(
  props: RightPanelTabHandlers & {
    surface: RightPanelSurface;
    dragDisabled: boolean;
    active: boolean;
    pending: boolean;
    title: string;
    audio: TabAudioState;
    audioRuntimeTabId: string | null;
    previewUrl: string | null;
    previewCapturedUrl: string | null;
    theme: "light" | "dark";
    environmentId: EnvironmentId | null;
    pullRequestStatusSeed: PullRequestTabStatusSeed | undefined;
    renaming: boolean;
    canRename: boolean;
    ownsDesktopTitleBar: boolean;
  },
) {
  const gt = useGT();
  const messages = useMessages();
  const {
    surface,
    audio,
    audioRuntimeTabId,
    onActivate,
    onClose,
    onAuxClick,
    onContextMenu,
    onStartRename,
    onFinishRename,
  } = props;
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: surface.id,
    disabled: props.dragDisabled,
  });
  const sideChatShell = useQuietThreadShell(
    surface.kind === "side-chat" && props.environmentId !== null
      ? scopeThreadRef(props.environmentId, surface.threadId)
      : null,
  );
  const title = sideChatShell?.title ?? props.title;
  const sideChatState = sideChatTabState(sideChatShell);
  const content = (
    <>
      <PanelTabCloseButton label={gt("Close {title}", { title })} onClick={() => onClose(surface)}>
        <SurfaceIcon
          surface={surface}
          previewUrl={props.previewUrl}
          previewCapturedUrl={props.previewCapturedUrl}
          theme={props.theme}
          environmentId={props.environmentId}
          pullRequestStatusSeed={props.pullRequestStatusSeed}
        />
        {props.pending ? (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
            aria-hidden
          />
        ) : null}
      </PanelTabCloseButton>
      {audio === "none" || !audioRuntimeTabId ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="cursor-pointer flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                aria-label={
                  audio === "muted"
                    ? gt("Unmute {title}", { title })
                    : gt("Mute {title}", { title })
                }
                onClick={(event) => {
                  event.stopPropagation();
                  void previewBridge
                    ?.setAudioMuted(audioRuntimeTabId, audio !== "muted")
                    .catch(() => undefined);
                }}
              >
                {audio === "muted" ? (
                  <VolumeOffIcon className="size-3" />
                ) : (
                  <Volume2Icon className="size-3" />
                )}
              </button>
            }
          />
          <TooltipPopup>{audio === "muted" ? gt("Unmute tab") : gt("Mute tab")}</TooltipPopup>
        </Tooltip>
      )}
      {props.renaming ? (
        <input
          aria-label={surface.kind === "terminal" ? gt("Terminal tab name") : gt("Device tab name")}
          className="w-24 min-w-0 rounded-sm bg-background px-1 outline-none ring-1 ring-inset ring-ring"
          defaultValue={title}
          ref={(element) => {
            element?.focus();
            element?.select();
          }}
          onBlur={(event) => onFinishRename(surface.id, event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = title;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onDoubleClick={() => {
                  if ((surface.kind === "device" || surface.kind === "terminal") && props.canRename)
                    onStartRename(surface.id);
                }}
                className="cursor-pointer flex min-w-0 items-center"
                aria-label={
                  sideChatState === null
                    ? undefined
                    : gt("{title}, {state}", {
                        title,
                        state: messages(SIDE_CHAT_STATE_LABELS[sideChatState]),
                      })
                }
                onClick={() => onActivate(surface)}
              >
                <span className="truncate">{title}</span>
              </button>
            }
          />
          <TooltipPopup>
            {surface.kind === "device" ? (
              <DeviceTabTooltip
                surface={surface}
                environmentId={props.environmentId}
                title={title}
              />
            ) : (
              title
            )}
          </TooltipPopup>
        </Tooltip>
      )}
    </>
  );
  return (
    <div
      data-active-tab={props.active}
      onMouseDown={preventTabMiddleButtonDefault}
      onMouseUp={preventTabMiddleButtonDefault}
      onAuxClick={(event) => onAuxClick(event, surface)}
      onContextMenu={(event) => onContextMenu(event, surface)}
      {...listeners}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
        props.ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "relative z-10",
      )}
    >
      {content}
    </div>
  );
}

interface RightPanelGroupEntry {
  readonly id: string | null;
  readonly columnId: string | null;
  readonly surfaces: readonly RightPanelSurface[];
  readonly activeSurfaceId: string | null;
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const gt = useGT();
  const messages = useMessages();
  const focusedSurface = props.surfaces.find((surface) => surface.id === props.activeSurfaceId);
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const browserProfiles = useBrowserDefaults().profiles;
  const { resolvedTheme } = useTheme();
  const [renamingSurface, setRenamingSurface] = useState<string | null>(null);
  // The group whose add menu is open; "single" outside the group layout.
  const [addMenuGroup, setAddMenuGroup] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<RightPanelDropIndicator | null>(null);
  const groups = props.groups;
  const layout = groups?.layout ?? null;
  const surfacesById = new Map<string, RightPanelSurface>(
    props.surfaces.map((surface) => [surface.id, surface]),
  );
  const minimizedSurfaceIds = new Set(
    layout?.minimized.flatMap((entry) => entry.group.surfaceIds) ?? [],
  );
  const looseSurfaces = props.surfaces.filter((surface) => !minimizedSurfaceIds.has(surface.id));
  const groupEntries: RightPanelGroupEntry[] =
    layout && layout.columns.length > 0
      ? layout.columns.flatMap((column) =>
          column.groups.map((group) => ({
            id: group.id,
            columnId: column.id,
            surfaces: group.surfaceIds.flatMap((id) => surfacesById.get(id) ?? []),
            activeSurfaceId: group.activeSurfaceId,
          })),
        )
      : [
          {
            id: null,
            columnId: null,
            surfaces: looseSurfaces,
            activeSurfaceId: looseSurfaces.some((surface) => surface.id === props.activeSurfaceId)
              ? props.activeSurfaceId
              : null,
          },
        ];
  const focusedGroupKey = layout?.focusedGroupId ?? groupEntries[0]?.id ?? null;

  if (props.open === false && addMenuGroup !== null) setAddMenuGroup(null);

  const chatPane = useChatPane();
  const onNewSurfaceKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (!chatPaneOwnsTarget(chatPane, event.target)) return;
    if (
      resolveShortcutCommand(event, props.keybindings, {
        context: { ...props.getShortcutContext(), rightPanelOpen: true },
      }) !== "rightPanel.new"
    )
      return;
    if (addMenuGroup === null && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) setAddMenuGroup(focusedGroupKey ?? "single");
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a document keydown listener for the new surface shortcut while the panel is open
  useEffect(() => {
    if (props.open === false) return;
    document.addEventListener("keydown", onNewSurfaceKeyDown, true);
    return () => document.removeEventListener("keydown", onNewSurfaceKeyDown, true);
  }, [props.open]);

  const groupOfSurface = (surfaceId: string) =>
    groupEntries.find((entry) => entry.surfaces.some((surface) => surface.id === surfaceId)) ??
    null;

  const handleTabContextMenu = async (event: ReactMouseEvent, surface: RightPanelSurface) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) return;

    const group = groupOfSurface(surface.id);
    const groupSurfaces = group?.surfaces ?? props.surfaces;
    const surfaceIndex = groupSurfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;

    const items: ContextMenuItem<TabContextMenuAction>[] = [];
    if ((surface.kind === "device" || surface.kind === "terminal") && props.onRenameSurface)
      items.push({ id: "rename", label: gt("Rename") });
    if (surface.kind === "file" && surface.attachment === undefined) {
      items.push({ id: "copy-path", label: gt("Copy path") });
    }
    const menuPreviewTabId = previewTabIdOf(surface, props.previewSessions);
    const menuOverlay = menuPreviewTabId ? (props.desktopByTabId[menuPreviewTabId] ?? null) : null;
    const menuMuted = menuOverlay?.audioMuted ?? false;
    if (surface.kind === "preview") {
      items.push({
        id: "toggle-mute",
        ...tabMuteMenuItem(
          {
            overlay: menuOverlay,
            canResolveRuntimeTabId: props.previewRuntimeTabId !== undefined,
          },
          messages,
        ),
      });
    }
    if (groups && group?.id) {
      const lone = groupSurfaces.length === 1;
      const otherGroups = groupEntries.filter(
        (entry) => entry.id !== null && entry.id !== group.id,
      );
      items.push(
        {
          id: "move-new-column",
          label: gt("Move to new column"),
          disabled:
            lone &&
            (layout?.columns.find((column) => column.id === group.columnId)?.groups.length ?? 0) <=
              1,
          separatorBefore: items.length > 0,
        },
        { id: "split-down", label: gt("Split down"), disabled: lone },
        {
          id: "move-to-group",
          label: gt("Move to group"),
          disabled: otherGroups.length === 0,
          children: otherGroups.map((entry) => ({
            id: `move-to-group:${entry.id}` as const,
            label: gt("Group {number}: {title}", {
              number: groupEntries.indexOf(entry) + 1,
              title: groupLabel(entry, props, messages),
            }),
          })),
        },
      );
    }
    items.push(
      { id: "close", label: gt("Close"), separatorBefore: items.length > 0 },
      {
        id: "close-others",
        label: gt("Close others"),
        disabled: groupSurfaces.length <= 1,
      },
      {
        id: "close-to-right",
        label: gt("Close to the right"),
        disabled: surfaceIndex >= groupSurfaces.length - 1,
      },
      {
        id: "close-all",
        label: gt("Close all"),
        disabled: groupSurfaces.length === 0,
      },
    );

    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (action !== null && action.startsWith("move-to-group:")) {
      groups?.onMoveSurfaceTo(surface.id, {
        kind: "join",
        groupId: action.slice("move-to-group:".length),
      });
      return;
    }
    switch (action) {
      case "rename":
        setRenamingSurface(surface.id);
        break;
      case "copy-path":
        if (surface.kind === "file" && surface.attachment === undefined) {
          props.onCopyFilePath(surface.relativePath);
        }
        break;
      case "toggle-mute": {
        const runtimeTabId =
          menuPreviewTabId && menuOverlay
            ? (props.previewRuntimeTabId?.(menuPreviewTabId) ?? null)
            : null;
        if (runtimeTabId) {
          void previewBridge?.setAudioMuted(runtimeTabId, !menuMuted).catch(() => undefined);
        }
        break;
      }
      case "move-new-column":
        if (group?.id) {
          groups?.onMoveSurfaceTo(surface.id, { kind: "column", groupId: group.id, side: "right" });
        }
        break;
      case "split-down":
        if (group?.id) {
          groups?.onMoveSurfaceTo(surface.id, { kind: "split", groupId: group.id, side: "below" });
        }
        break;
      case "close":
        props.onCloseSurface(surface);
        break;
      case "close-others":
        props.onCloseOtherSurfaces(surface);
        break;
      case "close-to-right":
        props.onCloseSurfacesToRight(surface);
        break;
      case "close-all":
        props.onCloseAllSurfaces(group?.id ?? undefined);
        break;
      default:
        break;
    }
  };
  const handleTabAuxClick = (event: ReactMouseEvent, surface: RightPanelSurface) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCloseSurface(surface);
  };
  const tabHandlers: RightPanelTabHandlers = {
    onActivate: useStableCallback(props.onActivate),
    onClose: useStableCallback(props.onCloseSurface),
    onAuxClick: useStableCallback(handleTabAuxClick),
    onContextMenu: useStableCallback((event: ReactMouseEvent, surface: RightPanelSurface) => {
      void handleTabContextMenu(event, surface);
    }),
    onStartRename: useStableCallback((surfaceId: string) => setRenamingSurface(surfaceId)),
    onFinishRename: useStableCallback((surfaceId: string, title: string) => {
      props.onRenameSurface?.(surfaceId, title);
      setRenamingSurface(null);
    }),
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pointerOf = (event: DragMoveEvent | DragEndEvent) => {
    const activator = event.activatorEvent;
    if (!(activator instanceof PointerEvent || activator instanceof MouseEvent)) return null;
    return { x: activator.clientX + event.delta.x, y: activator.clientY + event.delta.y };
  };
  const indicatorAt = (
    surfaceId: string,
    point: { x: number; y: number },
    overId: string | null,
  ): RightPanelDropIndicator | null => {
    const element = document
      .elementsFromPoint(point.x, point.y)
      .find((candidate) => candidate instanceof HTMLElement && candidate.dataset.rightPanelGroup);
    if (!(element instanceof HTMLElement)) return null;
    const groupId = element.dataset.rightPanelGroup!;
    const entry = groupEntries.find((candidate) => candidate.id === groupId);
    if (!entry) return null;
    const tabbar = element.querySelector<HTMLElement>("[data-right-panel-tabbar]");
    const tabRect = tabbar?.getBoundingClientRect();
    if (tabRect && point.y <= tabRect.bottom) {
      const overIndex =
        overId === null ? -1 : entry.surfaces.findIndex((surface) => surface.id === overId);
      return {
        groupId,
        zone: "tabs",
        ...(overIndex >= 0 ? { index: overIndex } : {}),
      };
    }
    const content = element.querySelector<HTMLElement>("[data-right-panel-surface-content]");
    const rect = (content ?? element).getBoundingClientRect();
    const zone = rightPanelDropZoneAt(rect, point.x, point.y);
    // A group's only tab dropped on itself goes nowhere.
    const source = groupOfSurface(surfaceId);
    if (
      source?.id === groupId &&
      source.surfaces.length === 1 &&
      zone !== "left" &&
      zone !== "right"
    )
      return null;
    return { groupId, zone };
  };
  const endDrag = () => {
    setDragging(null);
    setDropIndicator(null);
    setBrowserSurfacesSuppressed(false);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an unmount mid-drag must give native browser views back
  useEffect(() => () => setBrowserSurfacesSuppressed(false), []);
  const handleDragStart = (event: DragStartEvent) => {
    setDragging(String(event.active.id));
    if (groups) setBrowserSurfacesSuppressed(true);
  };
  const handleDragMove = (event: DragMoveEvent) => {
    if (!groups) return;
    const point = pointerOf(event);
    const next = point
      ? indicatorAt(String(event.active.id), point, event.over ? String(event.over.id) : null)
      : null;
    setDropIndicator((current) =>
      current?.groupId === next?.groupId &&
      current?.zone === next?.zone &&
      current?.index === next?.index
        ? current
        : next,
    );
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const surfaceId = String(event.active.id);
    const indicator = dropIndicator;
    endDrag();
    const source = groupOfSurface(surfaceId);
    if (!groups || !indicator) {
      const over = event.over;
      if (!over || over.id === surfaceId || !source) return;
      const toIndex = source.surfaces.findIndex((surface) => surface.id === over.id);
      if (toIndex >= 0) props.onMoveSurface?.(surfaceId, toIndex);
      return;
    }
    if (indicator.zone === "tabs" && indicator.groupId === source?.id) {
      if (indicator.index !== undefined) props.onMoveSurface?.(surfaceId, indicator.index);
      return;
    }
    groups.onMoveSurfaceTo(surfaceId, rightPanelDropTarget(indicator));
  };

  const draggedSurface = dragging === null ? null : (surfacesById.get(dragging) ?? null);
  const columns = layout?.columns ?? [];
  const maximizedGroupId = props.maximized ? (groups?.maximizedGroupId ?? null) : null;
  const multiGroup =
    groups !== undefined && groupEntries.length > 0 && groupEntries[0]!.id !== null;
  const topRightGroupId = columns.at(-1)?.groups[0]?.id ?? null;

  const renderGroup = (entry: RightPanelGroupEntry, topRow: boolean, topRight: boolean) => {
    const groupKey = entry.id ?? "single";
    const activeSurface =
      entry.surfaces.find((surface) => surface.id === entry.activeSurfaceId) ?? null;
    const minimizeReason = rightPanelMinimizeBlockedReason(
      entry.surfaces,
      activeSurface,
      props.previewSessions,
    );
    const groupId = entry.id;
    const groupMaximized = groupId !== null && maximizedGroupId === groupId;
    const controls =
      groups && groupId !== null ? (
        <RightPanelGroupControls
          maximized={groupMaximized}
          minimizeBlockedReason={minimizeReason}
          canSplit={entry.surfaces.length > 1}
          onMinimize={() => groups.onMinimizeGroup(groupId)}
          onToggleMaximized={() => groups.onToggleGroupMaximized(groupId)}
          onClose={() => groups.onCloseGroup(groupId)}
          onMoveToNewColumn={() =>
            activeSurface &&
            groups.onMoveSurfaceTo(activeSurface.id, { kind: "column", groupId, side: "right" })
          }
          onSplitDown={() =>
            activeSurface &&
            groups.onMoveSurfaceTo(activeSurface.id, { kind: "split", groupId, side: "below" })
          }
        />
      ) : null;
    return (
      <RightPanelGroupView
        key={groupKey}
        panel={props}
        groupId={groupId}
        surfaces={entry.surfaces}
        activeSurfaceId={entry.activeSurfaceId}
        ownsDesktopTitleBar={ownsDesktopTitleBar && topRow}
        topRight={topRight}
        maximized={props.maximized === true}
        groupControls={controls}
        layoutControls={topRight ? props.layoutControls : null}
        addMenuOpen={addMenuGroup === groupKey}
        onAddMenuOpenChange={(open) => setAddMenuGroup(open ? groupKey : null)}
        renamingSurface={renamingSurface}
        tabHandlers={tabHandlers}
        theme={resolvedTheme}
        browserProfiles={browserProfiles}
        dropIndicator={dropIndicator?.groupId === groupId ? dropIndicator : null}
        dragActive={dragging !== null}
        focused={multiGroup && groupId === focusedGroupKey}
        onFocus={
          groups && groupId !== null && groupId !== focusedGroupKey
            ? () => groups.onFocusGroup(groupId)
            : undefined
        }
      >
        {groups && groupId !== null
          ? activeSurface
            ? groups.renderSurface(activeSurface)
            : null
          : entry.activeSurfaceId === null
            ? null
            : props.children}
      </RightPanelGroupView>
    );
  };

  const emptyState = (
    <RightPanelEmptyState
      onAddBrowser={props.onAddBrowser}
      onAddBrowserInProfile={props.onAddBrowserInProfile}
      browserProfiles={browserProfiles}
      onAddTerminal={props.onAddTerminal}
      onAddDiff={props.onAddDiff}
      onAddFiles={props.onAddFiles}
      onAddPullRequest={props.onAddPullRequest}
      onAddPullRequests={props.onAddPullRequests}
      onAddDevice={props.onAddDevice}
      onAddSideChat={props.onAddSideChat}
      browserAvailable={props.browserAvailable}
      terminalAvailable={props.terminalAvailable}
      diffAvailable={props.diffAvailable}
      filesAvailable={props.filesAvailable}
      pullRequestAvailable={props.pullRequestAvailable}
      pullRequestsAvailable={props.pullRequestsAvailable}
      deviceAvailable={props.deviceAvailable}
      sideChatAvailable={props.sideChatAvailable === true}
      sideChatDisabledReason={props.sideChatDisabledReason ?? null}
    />
  );

  let body: ReactNode;
  if (!multiGroup) {
    const entry = groupEntries[0]!;
    body = renderGroup(entry, true, true);
    if (entry.activeSurfaceId === null) {
      body = (
        <RightPanelGroupView
          key="single"
          panel={props}
          groupId={null}
          surfaces={entry.surfaces}
          activeSurfaceId={null}
          ownsDesktopTitleBar={ownsDesktopTitleBar}
          topRight
          maximized={props.maximized === true}
          groupControls={null}
          layoutControls={props.layoutControls}
          addMenuOpen={addMenuGroup === "single"}
          onAddMenuOpenChange={(open) => setAddMenuGroup(open ? "single" : null)}
          renamingSurface={renamingSurface}
          tabHandlers={tabHandlers}
          theme={resolvedTheme}
          browserProfiles={browserProfiles}
          dropIndicator={null}
          dragActive={false}
          focused={false}
          onFocus={undefined}
        >
          {emptyState}
        </RightPanelGroupView>
      );
    }
  } else {
    body = (
      <div className="flex min-h-0 flex-1" data-right-panel-columns>
        {columns.map((column, columnIndex) => {
          const columnHidden =
            maximizedGroupId !== null &&
            !column.groups.some((group) => group.id === maximizedGroupId);
          const nextColumn = columns[columnIndex + 1];
          return (
            <Fragment key={column.id}>
              <div
                className={cn("flex min-h-0 min-w-0 flex-col", columnHidden && "hidden")}
                style={{ flex: `${maximizedGroupId === null ? column.size : 1} 1 0px` }}
                data-right-panel-column={column.id}
              >
                {column.groups.map((group, groupIndex) => {
                  const entry = groupEntries.find((candidate) => candidate.id === group.id)!;
                  const groupHidden = maximizedGroupId !== null && group.id !== maximizedGroupId;
                  const nextGroup = column.groups[groupIndex + 1];
                  return (
                    <Fragment key={group.id}>
                      <div
                        className={cn("flex min-h-0 min-w-0 flex-col", groupHidden && "hidden")}
                        style={{ flex: `${maximizedGroupId === null ? group.size : 1} 1 0px` }}
                      >
                        {renderGroup(
                          entry,
                          maximizedGroupId !== null || groupIndex === 0,
                          maximizedGroupId !== null || group.id === topRightGroupId,
                        )}
                      </div>
                      {nextGroup && maximizedGroupId === null ? (
                        <RightPanelLayoutDivider
                          orientation="horizontal"
                          label={gt("Resize stacked panels")}
                          weights={[group.size, nextGroup.size]}
                          onCommit={([before, after]) =>
                            groups?.onResizeGroups(
                              column.id,
                              column.groups.map((candidate, index) =>
                                index === groupIndex
                                  ? before
                                  : index === groupIndex + 1
                                    ? after
                                    : candidate.size,
                              ),
                            )
                          }
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
              {nextColumn && maximizedGroupId === null ? (
                <RightPanelLayoutDivider
                  orientation="vertical"
                  label={gt("Resize panel columns")}
                  weights={[column.size, nextColumn.size]}
                  onCommit={([before, after]) =>
                    groups?.onResizeColumns(
                      columns.map((candidate, index) =>
                        index === columnIndex
                          ? before
                          : index === columnIndex + 1
                            ? after
                            : candidate.size,
                      ),
                    )
                  }
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <PreviewPanelShell
      workspaceArea
      workspaceFocusKey={`panel:${props.environmentId}:${props.activeSurfaceId ?? "empty"}`}
      workspaceLabel={
        focusedSurface
          ? gt("Workspace panel: {title}", {
              title: surfaceTitle(
                focusedSurface,
                props.previewSessions,
                props.terminalLabelsById,
                props.planTitlesById,
                messages,
              ),
            })
          : gt("Workspace panel")
      }
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
      {...(props.inlineSize ? { inlineSize: props.inlineSize } : {})}
      onMouseDown={preventThumbButtonFocus}
      onMouseUp={(event) =>
        takeThumbButtonNavigation(
          event,
          focusedSurface?.kind === "preview" ? dispatchPreviewAction : undefined,
        )
      }
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={groups ? NO_DRAG_MODIFIERS : TAB_DRAG_MODIFIERS}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={endDrag}
      >
        {body}
        {groups ? (
          <DragOverlay dropAnimation={null}>
            {draggedSurface ? (
              <div className="flex h-6 max-w-40 items-center gap-1 rounded-md bg-accent px-2 text-xs text-foreground shadow-lg/20">
                <span className="truncate">
                  {surfaceTitle(
                    draggedSurface,
                    props.previewSessions,
                    props.terminalLabelsById,
                    props.planTitlesById,
                    messages,
                  )}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        ) : null}
      </DndContext>
    </PreviewPanelShell>
  );
}

function groupLabel(
  entry: RightPanelGroupEntry,
  props: RightPanelTabsProps,
  resolve: MessageResolver = m,
): string {
  const active = entry.surfaces.find((surface) => surface.id === entry.activeSurfaceId);
  return active
    ? surfaceTitle(
        active,
        props.previewSessions,
        props.terminalLabelsById,
        props.planTitlesById,
        resolve,
      )
    : resolve(msg("Empty", { $context: "a right panel group with no tabs" }));
}

function GroupControlButton(props: {
  label: string;
  disabledReason?: string | null;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const disabled = Boolean(props.disabledReason);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex [-webkit-app-region:no-drag]">
            <Button
              aria-label={props.label}
              {...(props.pressed === undefined ? {} : { "aria-pressed": props.pressed })}
              disabled={disabled}
              onClick={props.onClick}
              size="icon-xs"
              variant="ghost-muted"
            >
              {props.children}
            </Button>
          </span>
        }
      />
      <TooltipPopup side="bottom">{props.disabledReason || props.label}</TooltipPopup>
    </Tooltip>
  );
}

function RightPanelGroupControls(props: {
  maximized: boolean;
  minimizeBlockedReason: string | null;
  canSplit: boolean;
  onMinimize: () => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  onMoveToNewColumn: () => void;
  onSplitDown: () => void;
}) {
  const gt = useGT();
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-right-panel-group-controls>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={gt("Panel options")}
              className="[-webkit-app-region:no-drag]"
              size="icon-xs"
              variant="ghost-muted"
            />
          }
        >
          <Ellipsis className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom" sideOffset={6}>
          <MenuItem onClick={props.onMoveToNewColumn}>
            <Columns2 />
            <T>Move tab to new column</T>
          </MenuItem>
          <MenuItem disabled={!props.canSplit} onClick={props.onSplitDown}>
            <Rows2 />
            <T>Split tab down</T>
          </MenuItem>
          <MenuItem onClick={props.onClose}>
            <XIcon />
            <T>Close panel</T>
          </MenuItem>
        </MenuPopup>
      </Menu>
      {props.maximized ? null : (
        <GroupControlButton
          label={gt("Minimize panel")}
          disabledReason={props.minimizeBlockedReason}
          onClick={props.onMinimize}
        >
          <Minus className="size-3.5" />
        </GroupControlButton>
      )}
      <GroupControlButton
        label={props.maximized ? gt("Restore panel") : gt("Maximize panel")}
        pressed={props.maximized}
        onClick={props.onToggleMaximized}
      >
        {props.maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </GroupControlButton>
      <GroupControlButton label={gt("Close panel")} onClick={props.onClose}>
        <XIcon className="size-3.5" />
      </GroupControlButton>
    </div>
  );
}

const DROP_INDICATOR_CLASS: Record<RightPanelDropZone, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-0",
  tabs: "inset-0",
};

function RightPanelGroupView(props: {
  panel: RightPanelTabsProps;
  groupId: string | null;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  ownsDesktopTitleBar: boolean;
  topRight: boolean;
  maximized: boolean;
  groupControls: ReactNode;
  layoutControls: ReactNode;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
  renamingSurface: string | null;
  tabHandlers: RightPanelTabHandlers;
  theme: "light" | "dark";
  browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  dropIndicator: RightPanelDropIndicator | null;
  dragActive: boolean;
  focused: boolean;
  onFocus: (() => void) | undefined;
  children: ReactNode;
}) {
  const { panel } = props;
  const gt = useGT();
  const messages = useMessages();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [tabScrollState, setTabScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateTabScrollState = (viewport: HTMLDivElement) => {
    const hasOverflow = viewport.scrollWidth - viewport.clientWidth > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollLeft = hasOverflow && viewport.scrollLeft > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollRight =
      hasOverflow &&
      viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - TAB_SCROLL_EDGE_TOLERANCE;
    setTabScrollState((current) => {
      if (
        current.hasOverflow === hasOverflow &&
        current.canScrollLeft === canScrollLeft &&
        current.canScrollRight === canScrollRight
      ) {
        return current;
      }
      return { hasOverflow, canScrollLeft, canScrollRight };
    });
  };

  const scrollTabs = (direction: -1 | 1) => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  // A newly active tab, or tabs that start overflowing, can sit outside the scrolled strip.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the active tab DOM node into view after it changes or the tab strip starts overflowing
  useEffect(() => {
    if (!props.activeSurfaceId || !tabScrollState.hasOverflow) return;
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId, tabScrollState.hasOverflow]);

  const attachTabList = (root: HTMLDivElement | null) => {
    tabListRef.current = root;
    const viewport = tabScrollViewport(root);
    if (!viewport) return;

    const update = () => updateTabScrollState(viewport);
    // Only a vertical mouse wheel is translated. Horizontal input scrolls natively, since
    // consuming it keeps Chromium from starting the gesture scroll that swipe navigation tracks.
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= viewport.clientWidth;

      const previousScrollLeft = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === previousScrollLeft) return;
      event.preventDefault();
      update();
    };

    const content = viewport.firstElementChild;
    const stopObserving = observeResize(content ? [viewport, content] : viewport, update);
    viewport.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    update();

    return () => {
      tabListRef.current = null;
      stopObserving();
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", handleWheel);
    };
  };

  const indicator = props.dropIndicator;
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-right-panel-group={props.groupId ?? undefined}
      data-right-panel-group-focused={props.focused ? "true" : undefined}
      onPointerDownCapture={props.onFocus}
      onFocusCapture={props.onFocus}
    >
      <div
        className={cn(
          "relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          props.topRight && panel.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          props.ownsDesktopTitleBar && "drag-region",
          props.ownsDesktopTitleBar &&
            props.topRight &&
            "wco:pr-(--workspace-native-controls-inset)",
          panel.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          radius="none"
          ref={attachTabList}
          hideScrollbars
          scrollFade
          className={cn(
            "min-w-0 flex-1",
            props.ownsDesktopTitleBar &&
              tabScrollState.hasOverflow &&
              "[-webkit-app-region:no-drag]",
          )}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            <SortableTabList surfaceIds={props.surfaces.map((surface) => surface.id)}>
              {props.surfaces.map((surface) => {
                const previewTabId = previewTabIdOf(surface, panel.previewSessions);
                const favicon = previewFaviconOf(
                  surface,
                  panel.previewSessions,
                  panel.desktopByTabId,
                );
                return (
                  <RightPanelTab
                    key={surface.id}
                    surface={surface}
                    dragDisabled={!panel.onMoveSurface || props.renamingSurface === surface.id}
                    active={surface.id === props.activeSurfaceId}
                    pending={panel.pendingSurfaceIds.has(surface.id)}
                    title={surfaceTitle(
                      surface,
                      panel.previewSessions,
                      panel.terminalLabelsById,
                      panel.planTitlesById,
                      messages,
                    )}
                    audio={tabAudioState(
                      previewTabId ? (panel.desktopByTabId[previewTabId] ?? null) : null,
                    )}
                    audioRuntimeTabId={
                      previewTabId ? (panel.previewRuntimeTabId?.(previewTabId) ?? null) : null
                    }
                    previewUrl={favicon.url}
                    previewCapturedUrl={favicon.capturedUrl}
                    theme={props.theme}
                    environmentId={panel.environmentId}
                    pullRequestStatusSeed={panel.pullRequestStatusSeeds?.[surface.id]}
                    renaming={props.renamingSurface === surface.id}
                    canRename={panel.onRenameSurface !== undefined}
                    ownsDesktopTitleBar={props.ownsDesktopTitleBar}
                    {...props.tabHandlers}
                  />
                );
              })}
            </SortableTabList>
            {panel.open !== false ? (
              <AddSurfaceMenu
                panel={panel}
                open={props.addMenuOpen}
                onOpenChange={props.onAddMenuOpenChange}
                browserProfiles={props.browserProfiles}
              />
            ) : null}
          </div>
        </ScrollArea>
        {tabScrollState.hasOverflow ? (
          <div
            className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
            role="group"
            aria-label={gt("Scroll panel tabs")}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label={gt("Scroll tabs left")}
                      disabled={!tabScrollState.canScrollLeft}
                      onClick={() => scrollTabs(-1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronLeft />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>
                <T>Scroll tabs left</T>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label={gt("Scroll tabs right")}
                      disabled={!tabScrollState.canScrollRight}
                      onClick={() => scrollTabs(1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronRight />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>
                <T>Scroll tabs right</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        {props.groupControls}
        {props.layoutControls}
        {props.ownsDesktopTitleBar && props.topRight && !props.layoutControls ? (
          <span aria-hidden className="hidden w-24 shrink-0 wco:block" />
        ) : null}
        {props.ownsDesktopTitleBar && props.topRight ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
        {indicator?.zone === "tabs" ? (
          <span
            aria-hidden
            data-right-panel-drop-indicator="tabs"
            className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset ring-primary/60"
          />
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.children}
        {props.dragActive && props.groupId !== null ? (
          // Covers the content during a drag so iframes and canvases cannot eat the pointer.
          <div aria-hidden className="absolute inset-0 z-40" />
        ) : null}
        {indicator && indicator.zone !== "tabs" ? (
          <div
            aria-hidden
            data-right-panel-drop-indicator={indicator.zone}
            className={cn(
              "pointer-events-none absolute z-50 rounded-md border-2 border-primary/70 bg-primary/10",
              DROP_INDICATOR_CLASS[indicator.zone],
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

function AddSurfaceMenu(props: {
  panel: RightPanelTabsProps;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const { panel } = props;
  const gt = useGT();
  const messages = useMessages();
  const addSurfaceActions = [
    {
      label: msg("Browser"),
      icon: Globe2,
      shortcut: "B",
      available: panel.browserAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.browser),
      onClick: panel.onAddBrowser,
    },
    {
      label: msg("Terminal"),
      icon: TerminalSquare,
      shortcut: "T",
      available: panel.terminalAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.terminal),
      onClick: panel.onAddTerminal,
    },
    {
      label: msg("Files"),
      icon: Files,
      shortcut: "F",
      available: panel.filesAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.files),
      onClick: panel.onAddFiles,
    },
    {
      label: msg("Diff"),
      icon: FileDiff,
      shortcut: "D",
      available: panel.diffAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.diff),
      onClick: panel.onAddDiff,
    },
    {
      label: msg("Pull request"),
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: panel.pullRequestAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.pullRequest),
      onClick: panel.onAddPullRequest,
    },
    {
      label: msg("Linked pull requests"),
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: panel.pullRequestsAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.pullRequests),
      onClick: panel.onAddPullRequests,
    },
    {
      label: msg("Device"),
      icon: Smartphone,
      shortcut: "M",
      available: panel.deviceAvailable,
      disabledReason: messages(SURFACE_DISABLED_REASONS.device),
      onClick: panel.onAddDevice,
    },
    ...(panel.onAddSideChat
      ? [
          {
            label: msg("Side chat"),
            icon: MessagesSquare,
            shortcut: "S",
            available: panel.sideChatAvailable === true && !panel.sideChatDisabledReason,
            disabledReason:
              panel.sideChatDisabledReason ?? messages(SURFACE_DISABLED_REASONS.sideChat),
            onClick: panel.onAddSideChat,
          },
        ]
      : []),
  ] as const;

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    props.onOpenChange(false);
    action.onClick();
  };

  return (
    <Menu open={props.open} onOpenChange={props.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            aria-label={gt("Add panel surface")}
            className="shrink-0"
            size="icon-xs"
            variant="ghost-muted"
          />
        }
      >
        <Plus className="size-3.5" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="bottom"
        sideOffset={6}
        onKeyDownCapture={handleAddSurfaceMenuKeyDown}
      >
        {addSurfaceActions.map((action) => {
          const Icon = action.icon;
          if (action.label === "Browser" && action.available) {
            return (
              <MenuSub key={action.label}>
                <MenuSubTrigger
                  className="[&>svg:last-child]:ms-0"
                  aria-keyshortcuts={action.shortcut}
                  onClick={(event) => {
                    const pointerType =
                      "pointerType" in event.nativeEvent &&
                      typeof event.nativeEvent.pointerType === "string"
                        ? event.nativeEvent.pointerType
                        : undefined;
                    if (!shouldOpenDefaultBrowserProfileFromMenuClick(pointerType)) return;
                    props.onOpenChange(false);
                    action.onClick();
                  }}
                >
                  <Icon />
                  {messages(action.label)}
                  <MenuShortcut>{action.shortcut}</MenuShortcut>
                </MenuSubTrigger>
                <MenuSubPopup className="max-w-56">
                  {props.browserProfiles.map((profile) => (
                    <MenuItem
                      key={profile.id}
                      onClick={() => panel.onAddBrowserInProfile(profile.id)}
                    >
                      <span className="min-w-0 truncate">{profile.name}</span>
                    </MenuItem>
                  ))}
                </MenuSubPopup>
              </MenuSub>
            );
          }
          return (
            <SurfaceMenuItem
              key={action.label}
              available={action.available}
              disabledReason={action.disabledReason}
              shortcut={action.shortcut}
              onClick={action.onClick}
            >
              <Icon />
              {messages(action.label)}
            </SurfaceMenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

function DeviceTabTooltip(props: {
  surface: Extract<RightPanelSurface, { kind: "device" }>;
  environmentId: EnvironmentId | null;
  title: string;
}) {
  const gt = useGT();
  const target = props.surface.target;
  const { state } = useDeviceState(target ? props.environmentId : null);
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  const host = target ? state.hosts.find((entry) => entry.id === target.hostId) : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      <span>{props.title}</span>
      {target ? (
        <span className="text-muted-foreground">
          {host?.label ?? gt("Device host")} ·{" "}
          {device?.version ?? (target.platform === "ios" ? "iOS" : "Android")}
        </span>
      ) : null}
    </div>
  );
}
