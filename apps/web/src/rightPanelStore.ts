import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  RunId,
  ThreadId,
  type PlanId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useClosedViewStore } from "./closedViewStore";
import { resolveStorage } from "./lib/storage";
import type { ThreadPanelPresentation } from "./rightPanelLayout";
import {
  defaultRightPanelLayout,
  EMPTY_RIGHT_PANEL_LAYOUT,
  findRightPanelGroup,
  focusRightPanelGroup,
  minimizeRightPanelGroup,
  moveRightPanelSurface,
  parsePersistedRightPanelLayout,
  reconcileRightPanelLayout,
  reorderRightPanelSurface,
  resizeRightPanelColumns,
  resizeRightPanelGroups,
  restoreRightPanelGroup,
  rightPanelGroupSurfaceIds,
  setRightPanelGroupActive,
  type RightPanelDropTarget,
  type RightPanelLayout,
} from "./rightPanelLayoutModel";
import type { ChatFileAttachment } from "./types";

const RIGHT_PANEL_KINDS = [
  "diff",
  "files",
  "file",
  "preview",
  "device",
  "terminal",
  "pull-request",
  "pull-requests",
  "plan",
  "side-chat",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type PullRequestDetailTab = "summary" | "guide" | "timeline" | "code";

export interface DeviceTabTarget {
  hostId: string;
  deviceId: string;
  platform: "ios" | "android";
  name: string;
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | { id: "device" | `device:${string}`; kind: "device"; target?: DeviceTabTarget; title?: string }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      title?: string;
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | {
      id: "files";
      kind: "files";
      /** Set when breadcrumbs moved a folder browser up to the workspace root. */
      folderTrail?: string;
    }
  | {
      id: `file:${string}` | `attachment:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
      attachment?: ChatFileAttachment;
      /** Deepest workspace path retained for navigating back down after moving up. */
      folderTrail?: string;
    }
  | {
      id: `pull-request:${string}`;
      kind: "pull-request";
      /** Cross-environment lists can repeat project ids; thread panels inherit their ref's environment. */
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
      /** A clicked link waiting for the panel to show where it points; cleared once shown. */
      revealUrl?: string;
      detailTab?: PullRequestDetailTab;
    }
  | { id: "pull-requests"; kind: "pull-requests" }
  /** A proposed plan of this thread, read from the thread projection by id. */
  | { id: `plan:${string}`; kind: "plan"; planId: PlanId }
  | { id: `side-chat:${string}`; kind: "side-chat"; threadId: ThreadId };

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 16;

export const PULL_REQUESTS_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("pull-requests-panel"),
  ThreadId.make("pull-requests-panel"),
);

const isPullRequestsPanelKey = (threadKey: string) => threadKey.endsWith(":pull-requests-panel");

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  dismissedDeviceSurfaceIds?: string[];
  maximized?: true;
  proactiveDiffTurnId?: RunId;
}

export interface ThreadPanelVisibility {
  inlineOpen: boolean;
  popoverOpen: boolean;
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  /** Absent for a thread whose tabs still sit in the default single group. */
  layoutByThreadKey: Record<string, RightPanelLayout>;
  pendingMaximizeThreadKey: string | null;
  requestMaximize: (ref: ScopedThreadRef) => void;
  consumeMaximizeRequest: (ref: ScopedThreadRef) => boolean;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
  userActionRevisionByThreadKey: Record<string, number>;
  closeRevisionByThreadKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  markUserAction: (ref: ScopedThreadRef) => number;
  /** Refused if the user chose a panel after expectedUserActionRevision was read. */
  openProactive: (
    ref: ScopedThreadRef,
    request:
      | Extract<RightPanelSurface, { kind: "pull-request" | "pull-requests" | "plan" }>
      | { kind: "diff"; turnId: RunId },
    expectedUserActionRevision: number,
    activateExisting?: boolean,
  ) => boolean;
  open: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request" | "plan" | "side-chat">,
  ) => void;
  openSideChat: (ref: ScopedThreadRef, threadId: ThreadId) => void;
  openDevice: (ref: ScopedThreadRef, target: DeviceTabTarget, automatic?: boolean) => void;
  renameSurface: (ref: ScopedThreadRef, surfaceId: string, title: string) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  /** Moves in place; "" opens the root explorer. folderTrail keeps the return path; keepSource opens beside the source. */
  navigateFolder: (
    ref: ScopedThreadRef,
    surfaceId: string,
    relativePath: string,
    folderTrail: string,
    keepSource?: boolean,
  ) => void;
  openAttachment: (ref: ScopedThreadRef, attachment: ChatFileAttachment) => void;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: {
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
      /** A clicked link to reveal; reopening a surface passes only its `url`. */
      revealUrl?: string;
      detailTab?: PullRequestDetailTab;
    },
  ) => void;
  openPlan: (ref: ScopedThreadRef, planId: PlanId) => void;
  setPullRequestDetailTab: (
    ref: ScopedThreadRef,
    surfaceId: string,
    detailTab: PullRequestDetailTab,
  ) => void;
  /** Clears the surface's pending link only while it is still `revealUrl`. */
  settlePullRequestReveal: (ref: ScopedThreadRef, surfaceId: string, revealUrl: string) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  /** Agent-driven activation. Not a user action, so it does not move keyboard focus. */
  revealSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  /** With a group, closes only that group's tabs. */
  closeAllSurfaces: (ref: ScopedThreadRef, groupId?: string) => void;
  /** Reorders within the surface's own group. */
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, toIndex: number) => void;
  moveSurfaceTo: (ref: ScopedThreadRef, surfaceId: string, target: RightPanelDropTarget) => void;
  focusGroup: (ref: ScopedThreadRef, groupId: string) => void;
  resizeColumns: (ref: ScopedThreadRef, sizes: readonly number[]) => void;
  resizeGroups: (ref: ScopedThreadRef, columnId: string, sizes: readonly number[]) => void;
  toggleGroupMaximized: (ref: ScopedThreadRef, groupId: string) => void;
  minimizeGroup: (ref: ScopedThreadRef, groupId: string) => void;
  restoreGroup: (ref: ScopedThreadRef, groupId: string) => void;
  /** Picks a minimized group's shown tab without restoring it. */
  selectGroupSurface: (ref: ScopedThreadRef, groupId: string, surfaceId: string) => void;
  closeGroup: (ref: ScopedThreadRef, groupId: string) => void;
  reconcileBrowserSurfaces: (
    ref: ScopedThreadRef,
    tabIds: readonly string[],
    hiddenTabIds?: ReadonlySet<string>,
  ) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  setMaximized: (ref: ScopedThreadRef, maximized: boolean) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request" | "plan" | "side-chat">,
  ) => void;
  setThreadPanelOpen: (
    ref: ScopedThreadRef,
    presentation: ThreadPanelPresentation,
    open: boolean,
  ) => void;
  toggleThreadPanel: (ref: ScopedThreadRef, presentation: ThreadPanelPresentation) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

const DEFAULT_THREAD_PANEL_VISIBILITY: ThreadPanelVisibility = {
  inlineOpen: true,
  popoverOpen: false,
};

const singletonSurface = (
  kind: Exclude<
    RightPanelKind,
    "file" | "preview" | "terminal" | "pull-request" | "plan" | "side-chat"
  >,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "pull-requests":
      return { id: "pull-requests", kind };
    case "device":
      return { id: "device", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

const attachmentSurface = (attachment: ChatFileAttachment): RightPanelSurface => ({
  id: `attachment:${attachment.id}`,
  kind: "file",
  relativePath: attachment.name,
  revealLine: null,
  revealRequestId: 0,
  attachment,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

export const planSurface = (planId: PlanId): Extract<RightPanelSurface, { kind: "plan" }> => ({
  id: `plan:${planId}`,
  kind: "plan",
  planId,
});

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  detailTab?: PullRequestDetailTab;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
    ...(target.detailTab === undefined ? {} : { detailTab: target.detailTab }),
  };
}

/** A pending link belongs to the click that made it, not to a reload or a reopen. */
const withoutReveal = (surface: RightPanelSurface): RightPanelSurface => {
  if (surface.kind !== "pull-request" || surface.revealUrl === undefined) return surface;
  const { revealUrl: _pending, ...rest } = surface;
  return rest;
};

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThreadStateMap = (
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const next = updater(current);
  if (
    !next.isOpen &&
    next.activeSurfaceId === null &&
    next.surfaces.length === 0 &&
    !next.dismissedDeviceSurfaceIds?.length &&
    next.proactiveDiffTurnId === undefined
  ) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

const updateThreadPanelVisibilityMap = (
  byThreadKey: Record<string, ThreadPanelVisibility>,
  threadKey: string,
  updater: (current: ThreadPanelVisibility) => ThreadPanelVisibility,
): Record<string, ThreadPanelVisibility> => {
  const current = byThreadKey[threadKey] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
  const next = updater(current);
  if (next.inlineOpen && !next.popoverOpen) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

type RightPanelStoreData = Pick<
  RightPanelStoreState,
  "byThreadKey" | "threadPanelVisibilityByThreadKey" | "layoutByThreadKey"
>;

type LayoutUpdater = (
  current: ThreadRightPanelState,
  layout: RightPanelLayout,
) => { thread: ThreadRightPanelState; layout: RightPanelLayout };

const defaultLayoutCache = new WeakMap<ThreadRightPanelState, RightPanelLayout>();

function layoutOf(
  layoutByThreadKey: Record<string, RightPanelLayout>,
  threadKey: string,
  thread: ThreadRightPanelState,
): RightPanelLayout {
  const stored = layoutByThreadKey[threadKey];
  if (stored) return stored;
  if (thread.surfaces.length === 0) return EMPTY_RIGHT_PANEL_LAYOUT;
  let layout = defaultLayoutCache.get(thread);
  if (!layout) {
    layout = defaultRightPanelLayout(
      thread.surfaces.map((surface) => surface.id),
      thread.activeSurfaceId,
    );
    defaultLayoutCache.set(thread, layout);
  }
  return layout;
}

/** Applies a registry edit and brings the thread's layout along with it. */
function settleThread(
  current: ThreadRightPanelState,
  layout: RightPanelLayout,
  next: ThreadRightPanelState,
  nextLayout: RightPanelLayout,
): { thread: ThreadRightPanelState; layout: RightPanelLayout } {
  const reconciled = reconcileRightPanelLayout(nextLayout, {
    previousIds: current.surfaces.map((surface) => surface.id),
    previousActiveSurfaceId: current.activeSurfaceId,
    nextIds: next.surfaces.map((surface) => surface.id),
    nextActiveSurfaceId: next.activeSurfaceId,
  });
  let thread = next;
  if (thread.activeSurfaceId !== reconciled.activeSurfaceId) {
    thread = { ...thread, activeSurfaceId: reconciled.activeSurfaceId };
  }
  if (reconciled.restored && !thread.isOpen) thread = { ...thread, isOpen: true };
  // A panel whose last shown group just went to a card closes; reopening it shows it empty.
  if (
    thread.isOpen &&
    layout.columns.length > 0 &&
    reconciled.layout.columns.length === 0 &&
    reconciled.layout.minimized.length > 0
  ) {
    thread = { ...thread, isOpen: false };
  }
  if (thread.maximized && reconciled.layout.columns.length === 0) {
    const { maximized: _maximized, ...rest } = thread;
    thread = rest;
  }
  if (thread === next && reconciled.layout === layout && next === current) {
    return { thread: current, layout };
  }
  return { thread, layout: reconciled.layout };
}

const updateThreadAndLayout = (
  state: RightPanelStoreData,
  threadKey: string,
  updater: LayoutUpdater,
): RightPanelStoreData => {
  const current = state.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const layout = layoutOf(state.layoutByThreadKey, threadKey, current);
  const proposed = updater(current, layout);
  if (proposed.thread === current && proposed.layout === layout) return state;
  const settled = settleThread(current, layout, proposed.thread, proposed.layout);
  const byThreadKey = updateThreadStateMap(state.byThreadKey, threadKey, () => settled.thread);
  const next = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  let layoutByThreadKey = state.layoutByThreadKey;
  if (!(threadKey in byThreadKey) || settled.layout === EMPTY_RIGHT_PANEL_LAYOUT) {
    if (threadKey in layoutByThreadKey) {
      const { [threadKey]: _removed, ...rest } = layoutByThreadKey;
      layoutByThreadKey = rest;
    }
  } else if (settled.layout !== layoutByThreadKey[threadKey]) {
    layoutByThreadKey = { ...layoutByThreadKey, [threadKey]: settled.layout };
  }
  let threadPanelVisibilityByThreadKey = state.threadPanelVisibilityByThreadKey;

  if (!current.isOpen && next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) => (visibility.popoverOpen ? { ...visibility, popoverOpen: false } : visibility),
    );
  } else if (current.isOpen && !next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) =>
        visibility.popoverOpen && !visibility.inlineOpen
          ? { ...visibility, inlineOpen: true }
          : visibility,
    );
  }

  return { byThreadKey, threadPanelVisibilityByThreadKey, layoutByThreadKey };
};

const updateThread = (
  state: RightPanelStoreData,
  threadKey: string,
  updater: (current: ThreadRightPanelState, layout: RightPanelLayout) => ThreadRightPanelState,
): RightPanelStoreData =>
  updateThreadAndLayout(state, threadKey, (current, layout) => ({
    thread: updater(current, layout),
    layout,
  }));

const automaticUpdate = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: ThreadUpdater,
): Partial<RightPanelStoreState> => ({
  ...updateThread(state, threadKey, updater),
});

// A side chat pane has no panel of its own, so its panel actions open in its parent's panel.
const panelHosts = new Map<string, ScopedThreadRef>();

/** Routes `guest`'s panel actions to `host`'s panel until the returned cleanup runs. */
export function hostRightPanel(guest: ScopedThreadRef, host: ScopedThreadRef): () => void {
  const guestKey = scopedThreadKey(guest);
  panelHosts.set(guestKey, host);
  return () => {
    if (panelHosts.get(guestKey) === host) panelHosts.delete(guestKey);
  };
}

/** The thread whose panel shows `ref`'s panel actions, so it also owns their browser tabs. */
export function rightPanelHostRef(ref: ScopedThreadRef): ScopedThreadRef {
  return panelHosts.get(scopedThreadKey(ref)) ?? ref;
}

type ThreadUpdater = (
  current: ThreadRightPanelState,
  layout: RightPanelLayout,
) => ThreadRightPanelState;

const withFocusMirror = (thread: ThreadRightPanelState, layout: RightPanelLayout) => ({
  thread,
  layout,
});

/** A user's layout change on the panel that hosts `ref`. */
const layoutAction = (
  state: RightPanelStoreState,
  ref: ScopedThreadRef,
  updater: LayoutUpdater,
): Partial<RightPanelStoreState> => {
  const threadKey = scopedThreadKey(rightPanelHostRef(ref));
  return {
    ...updateThreadAndLayout(state, threadKey, updater),
    userActionRevisionByThreadKey: {
      ...state.userActionRevisionByThreadKey,
      [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
    },
  };
};

const userAction = (
  state: RightPanelStoreState,
  guestKey: string,
  updater: ThreadUpdater,
  closesView = false,
): Partial<RightPanelStoreState> => {
  const host = panelHosts.get(guestKey);
  const threadKey = host === undefined ? guestKey : scopedThreadKey(host);
  return userActionOnThread(state, threadKey, updater, closesView);
};

const userActionOnThread = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: ThreadUpdater,
  closesView: boolean,
): Partial<RightPanelStoreState> => ({
  ...updateThread(state, threadKey, (current, layout) => {
    const next = updater(current, layout);
    if (next === current) return current;
    const removedDevices = current.surfaces.filter(
      (surface) =>
        surface.kind === "device" && !next.surfaces.some((entry) => entry.id === surface.id),
    );
    if (removedDevices.length === 0) return next;
    return {
      ...next,
      dismissedDeviceSurfaceIds: [
        ...new Set([
          ...(next.dismissedDeviceSurfaceIds ?? []),
          ...removedDevices.map((surface) => surface.id),
        ]),
      ],
    };
  }),
  userActionRevisionByThreadKey: {
    ...state.userActionRevisionByThreadKey,
    [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
  },
  ...(closesView
    ? {
        closeRevisionByThreadKey: {
          ...state.closeRevisionByThreadKey,
          [threadKey]: (state.closeRevisionByThreadKey[threadKey] ?? 0) + 1,
        },
      }
    : {}),
});

const activated = (current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState =>
  current.surfaces.some((surface) => surface.id === surfaceId)
    ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
    : current;

const closeAction = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: ThreadUpdater,
): Partial<RightPanelStoreState> => userAction(state, threadKey, updater, true);

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

/**
 * v15 and older kept one tab strip; their threads get no stored layout, which reads as one
 * column holding one group of every tab with the same active tab.
 */
export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
  layoutByThreadKey?: Record<string, RightPanelLayout>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {}, threadPanelVisibilityByThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>)
            .filter(([threadKey]) => !isPullRequestsPanelKey(threadKey))
            .map(([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const surfaces = Array.isArray(validThreadState?.surfaces)
                ? validThreadState.surfaces.flatMap<RightPanelSurface>((surface) => {
                    const kind = (surface as { kind?: string }).kind;
                    if (kind === "agents" || kind === "aside") return [];
                    // The pre-v9 plan surface had a different shape, so only `plan:<planId>` survives.
                    if (surface.kind === "plan") {
                      return typeof surface.planId === "string" &&
                        surface.id === `plan:${surface.planId}`
                        ? [planSurface(surface.planId)]
                        : [];
                    }
                    if (
                      (surface.kind === "file" || surface.kind === "files") &&
                      "folderTrail" in surface &&
                      typeof surface.folderTrail !== "string"
                    ) {
                      const { folderTrail: _invalid, ...rest } = surface;
                      surface = rest;
                    }
                    if (surface.kind === "file") {
                      const revealLine =
                        typeof surface.revealLine === "number" &&
                        Number.isFinite(surface.revealLine)
                          ? Math.max(1, Math.trunc(surface.revealLine))
                          : null;
                      const revealRequestId =
                        typeof surface.revealRequestId === "number" &&
                        Number.isSafeInteger(surface.revealRequestId) &&
                        surface.revealRequestId >= 0
                          ? surface.revealRequestId
                          : 0;
                      return [{ ...surface, revealLine, revealRequestId }];
                    }
                    if (surface.kind === "pull-request") {
                      if (
                        typeof surface.projectId !== "string" ||
                        typeof surface.repository !== "string" ||
                        typeof surface.number !== "number" ||
                        !Number.isSafeInteger(surface.number) ||
                        surface.number < 1
                      ) {
                        return [];
                      }
                      const { environmentId, ...rest } = surface;
                      return [
                        pullRequestSurface({
                          ...rest,
                          ...(typeof environmentId === "string" ? { environmentId } : {}),
                        }),
                      ];
                    }
                    if (surface.kind !== "terminal") return [surface];
                    if (
                      !("resourceId" in surface) ||
                      typeof surface.resourceId !== "string" ||
                      surface.id !== `terminal:${surface.resourceId}`
                    ) {
                      return [];
                    }
                    const terminalIds =
                      "terminalIds" in surface && Array.isArray(surface.terminalIds)
                        ? [
                            ...new Set(
                              surface.terminalIds.filter(
                                (terminalId): terminalId is string =>
                                  typeof terminalId === "string",
                              ),
                            ),
                          ]
                        : [surface.resourceId];
                    const activeTerminalId =
                      "activeTerminalId" in surface &&
                      typeof surface.activeTerminalId === "string" &&
                      terminalIds.includes(surface.activeTerminalId)
                        ? surface.activeTerminalId
                        : (terminalIds[0] ?? surface.resourceId);
                    return [
                      {
                        ...surface,
                        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
                        activeTerminalId,
                      },
                    ];
                  })
                : [];
              const rawActiveSurfaceId = validThreadState?.activeSurfaceId;
              const persistedActiveSurfaceId = surfaces.some(
                (surface) => surface.id === rawActiveSurfaceId,
              )
                ? (rawActiveSurfaceId ?? null)
                : rawActiveSurfaceId === "pull-request"
                  ? (surfaces.find((surface) => surface.kind === "pull-request")?.id ?? null)
                  : null;
              const isOpen =
                surfaces.length > 0 &&
                (typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : persistedActiveSurfaceId !== null);
              const activeSurfaceId =
                persistedActiveSurfaceId ??
                (isOpen || rawActiveSurfaceId === "agents" ? (surfaces[0]?.id ?? null) : null);
              return [
                threadKey,
                {
                  isOpen,
                  surfaces,
                  activeSurfaceId,
                  ...(typeof validThreadState?.proactiveDiffTurnId === "string"
                    ? { proactiveDiffTurnId: RunId.make(validThreadState.proactiveDiffTurnId) }
                    : {}),
                  ...(Array.isArray(validThreadState?.dismissedDeviceSurfaceIds)
                    ? {
                        dismissedDeviceSurfaceIds:
                          validThreadState.dismissedDeviceSurfaceIds.filter(
                            (id): id is string => typeof id === "string",
                          ),
                      }
                    : {}),
                  ...(validThreadState?.maximized === true ? { maximized: true as const } : {}),
                },
              ];
            }),
        )
      : {};
  const threadPanelVisibilityByThreadKey =
    "threadPanelVisibilityByThreadKey" in persistedState &&
    persistedState.threadPanelVisibilityByThreadKey &&
    typeof persistedState.threadPanelVisibilityByThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(
            persistedState.threadPanelVisibilityByThreadKey as Record<string, unknown>,
          ).flatMap(([threadKey, value]) => {
            if (!value || typeof value !== "object" || !("inlineOpen" in value)) return [];
            return value.inlineOpen === false
              ? [[threadKey, { inlineOpen: false, popoverOpen: false }]]
              : [];
          }),
        )
      : {};
  if (
    !("layoutByThreadKey" in persistedState) ||
    !persistedState.layoutByThreadKey ||
    typeof persistedState.layoutByThreadKey !== "object"
  ) {
    return { byThreadKey, threadPanelVisibilityByThreadKey };
  }
  const layoutByThreadKey = Object.fromEntries(
    Object.entries(persistedState.layoutByThreadKey as Record<string, unknown>).flatMap(
      ([threadKey, value]) => {
        const thread = byThreadKey[threadKey];
        const layout = thread ? parsePersistedRightPanelLayout(value) : null;
        if (!thread || !layout) return [];
        const ids = thread.surfaces.map((surface) => surface.id);
        const reconciled = reconcileRightPanelLayout(layout, {
          previousIds: ids,
          previousActiveSurfaceId: thread.activeSurfaceId,
          nextIds: ids,
          nextActiveSurfaceId: thread.activeSurfaceId,
        });
        return reconciled.layout.columns.length + reconciled.layout.minimized.length === 0
          ? []
          : [[threadKey, reconciled.layout]];
      },
    ),
  );
  return { byThreadKey, threadPanelVisibilityByThreadKey, layoutByThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      layoutByThreadKey: {},
      pendingMaximizeThreadKey: null,
      requestMaximize: (ref) => set({ pendingMaximizeThreadKey: scopedThreadKey(ref) }),
      consumeMaximizeRequest: (ref) => {
        if (get().pendingMaximizeThreadKey !== scopedThreadKey(ref)) return false;
        set({ pendingMaximizeThreadKey: null });
        return true;
      },
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByThreadKey: {},
      closeRevisionByThreadKey: {},
      getUserActionRevision: (ref) =>
        get().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0,
      markUserAction: (ref) => {
        const revision = get().getUserActionRevision(ref) + 1;
        set((state) => ({
          userActionRevisionByThreadKey: {
            ...state.userActionRevisionByThreadKey,
            [scopedThreadKey(ref)]: revision,
          },
        }));
        return revision;
      },
      openProactive: (ref, request, expectedUserActionRevision, activateExisting = false) => {
        let opened = false;
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (request.kind === "diff") {
            const current = selectThreadRightPanelState(state.byThreadKey, ref);
            if (current.proactiveDiffTurnId === request.turnId) return state;
            const activePanel = selectActiveRightPanel(state.byThreadKey, ref);
            const pullRequestActive =
              activePanel === "pull-request" || activePanel === "pull-requests";
            opened =
              (state.userActionRevisionByThreadKey[threadKey] ?? 0) ===
                expectedUserActionRevision &&
              activePanel !== "diff" &&
              !pullRequestActive;
            // Record the offer even when refused, so a revisit does not retry this turn.
            return automaticUpdate(state, threadKey, (thread) => ({
              ...(opened ? upsertSurface(thread, singletonSurface("diff")) : thread),
              proactiveDiffTurnId: request.turnId,
            }));
          }
          if (
            (state.userActionRevisionByThreadKey[threadKey] ?? 0) !== expectedUserActionRevision
          ) {
            return state;
          }
          // Keep an existing PR tab where the user left it when revisiting a thread.
          if (
            !activateExisting &&
            selectThreadRightPanelState(state.byThreadKey, ref).surfaces.some(
              (entry) => entry.id === request.id,
            )
          ) {
            return state;
          }
          opened = true;
          return automaticUpdate(state, threadKey, (current) => upsertSurface(current, request));
        });
        return opened;
      },
      open: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      openDevice: (ref, target, automatic = false) =>
        set((state) =>
          (automatic ? automaticUpdate : userAction)(state, scopedThreadKey(ref), (current) => {
            const id =
              `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
            if (automatic && current.dismissedDeviceSurfaceIds?.includes(id)) return current;
            const surface: RightPanelSurface = { id, kind: "device", target };
            const existing = current.surfaces.find((entry) => entry.id === id);
            const surfaces = existing
              ? current.surfaces.filter((entry) => entry.id !== "device")
              : current.surfaces.map((entry) => (entry.id === "device" ? surface : entry));
            return upsertSurface(
              {
                ...current,
                surfaces,
                dismissedDeviceSurfaceIds: (current.dismissedDeviceSurfaceIds ?? []).filter(
                  (entry) => entry !== id,
                ),
              },
              existing ?? surface,
            );
          }),
        ),
      openSideChat: (ref, threadId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, { id: `side-chat:${threadId}`, kind: "side-chat", threadId }),
          ),
        ),
      renameSurface: (ref, surfaceId, title) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) => {
              if (
                surface.id !== surfaceId ||
                (surface.kind !== "device" && surface.kind !== "terminal")
              )
                return surface;
              if (surface.kind === "device")
                return { ...surface, title: title.trim() || surface.target?.name || "Device" };
              const { title: _title, ...rest } = surface;
              return title.trim() ? { ...rest, title: title.trim() } : rest;
            }),
          })),
        ),
      openBrowser: (ref, tabId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        ),
      openPullRequest: (ref, target) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = pullRequestSurface(target);
            const next = upsertSurface(current, surface);
            const { url, revealUrl } = target;
            if (!url && !revealUrl) return next;
            return {
              ...next,
              surfaces: next.surfaces.map((entry) => {
                if (entry.id !== surface.id || entry.kind !== "pull-request") return entry;
                // A later link replaces one not yet shown.
                const { revealUrl: _previous, ...rest } = entry;
                return { ...rest, ...surface, ...(revealUrl ? { revealUrl } : {}) };
              }),
            };
          }),
        ),
      setPullRequestDetailTab: (ref, surfaceId, detailTab) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface) => surface.id === surfaceId,
          );
          if (existing?.kind !== "pull-request" || (existing.detailTab ?? "summary") === detailTab)
            return state;
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "pull-request"
                ? { ...surface, detailTab }
                : surface,
            ),
          }));
        }),
      settlePullRequestReveal: (ref, surfaceId, revealUrl) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const existing = state.byThreadKey[threadKey]?.surfaces.find(
            (surface) => surface.id === surfaceId,
          );
          if (existing?.kind !== "pull-request" || existing.revealUrl !== revealUrl) return state;
          return automaticUpdate(state, threadKey, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId ? withoutReveal(surface) : surface,
            ),
          }));
        }),
      openFile: (ref, requestedPath, line) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            if (requestedPath === ".") {
              return upsertSurface(current, singletonSurface("files"));
            }
            // Workspace entry paths use '/', including on Windows.
            const relativePath = /^[A-Za-z]:\/+$/.test(requestedPath)
              ? requestedPath
              : requestedPath.replace(/\/+$/, "") || requestedPath;
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            const surfaceId = `file:${relativePath}` as const;
            const existing = withoutStandaloneExplorer.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === surfaceId && surface.kind === "file",
            );
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? withoutStandaloneExplorer.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  )
                : [...withoutStandaloneExplorer, surface],
            };
          }),
        ),
      navigateFolder: (ref, surfaceId, relativePath, folderTrail, keepSource = false) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const trail = folderTrail === relativePath ? {} : { folderTrail };
            const target: RightPanelSurface =
              relativePath === ""
                ? { ...singletonSurface("files"), ...trail }
                : { ...fileSurface(relativePath, null, 1), ...trail };
            const source = current.surfaces[index]!;
            const existing = current.surfaces.some(
              (surface, i) => i !== index && surface.id === target.id,
            );
            const surfaces = current.surfaces.flatMap((surface, i) => {
              if (i === index) {
                const kept = keepSource ? [source] : [];
                return existing ? kept : [...kept, target];
              }
              return !existing && target.kind === "file" && surface.kind === "files"
                ? []
                : [surface];
            });
            return { ...current, isOpen: true, activeSurfaceId: target.id, surfaces };
          }),
        ),
      openAttachment: (ref, attachment) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const withoutStandaloneExplorer = current.surfaces.filter(
              (surface) => surface.kind !== "files",
            );
            return upsertSurface(
              { ...current, surfaces: withoutStandaloneExplorer },
              attachmentSurface(attachment),
            );
          }),
        ),
      openPlan: (ref, planId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, planSurface(planId)),
          ),
        ),
      openTerminal: (ref, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId)),
          ),
        ),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: true,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        ),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        ),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
              };
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        ),
      activateSurface: (ref, surfaceId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => activated(current, surfaceId)),
        ),
      revealSurface: (ref, surfaceId) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => activated(current, surfaceId)),
        ),
      closeSurface: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            const next = {
              ...current,
              isOpen: surfaces.length > 0 && current.isOpen,
              surfaces,
            };
            if (current.activeSurfaceId !== surfaceId) {
              return next;
            }
            const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
            return {
              ...next,
              activeSurfaceId: fallback?.id ?? null,
            };
          }),
        ),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current, layout) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            const groupIds = new Set(rightPanelGroupSurfaceIds(layout, surfaceId));
            if (!surface || groupIds.size <= 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: current.surfaces.filter(
                (entry) => entry.id === surfaceId || !groupIds.has(entry.id),
              ),
              activeSurfaceId: surface.id,
            };
          }),
        ),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current, layout) => {
            const groupIds = rightPanelGroupSurfaceIds(layout, surfaceId);
            const index = groupIds.indexOf(surfaceId);
            if (index < 0 || index === groupIds.length - 1) return current;
            const closing = new Set(groupIds.slice(index + 1));
            const surfaces = current.surfaces.filter((surface) => !closing.has(surface.id));
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        ),
      closeAllSurfaces: (ref, groupId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current, layout) => {
            if (current.surfaces.length === 0) return current;
            const group = groupId === undefined ? null : findRightPanelGroup(layout, groupId);
            if (group && layout.columns.flatMap((column) => column.groups).length > 1) {
              const closing = new Set(group.surfaceIds);
              return {
                ...current,
                surfaces: current.surfaces.filter((surface) => !closing.has(surface.id)),
              };
            }
            return { ...current, isOpen: false, surfaces: [], activeSurfaceId: null };
          }),
        ),
      moveSurface: (ref, surfaceId, toIndex) =>
        set((state) =>
          updateThreadAndLayout(state, scopedThreadKey(ref), (current, layout) => {
            const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (fromIndex < 0) return { thread: current, layout };
            const groupIds = rightPanelGroupSurfaceIds(layout, surfaceId);
            const target = groupIds[Math.max(0, Math.min(toIndex, groupIds.length - 1))];
            const targetIndex = current.surfaces.findIndex((surface) => surface.id === target);
            const surfaces = [...current.surfaces];
            if (targetIndex >= 0 && targetIndex !== fromIndex) {
              surfaces.splice(targetIndex, 0, ...surfaces.splice(fromIndex, 1));
            }
            return {
              thread: targetIndex === fromIndex ? current : { ...current, surfaces },
              layout: reorderRightPanelSurface(layout, surfaceId, toIndex),
            };
          }),
        ),
      moveSurfaceTo: (ref, surfaceId, target) =>
        set((state) =>
          layoutAction(state, ref, (current, layout) => ({
            thread: current,
            layout: moveRightPanelSurface(layout, surfaceId, target),
          })),
        ),
      focusGroup: (ref, groupId) =>
        set((state) =>
          updateThreadAndLayout(state, scopedThreadKey(rightPanelHostRef(ref)), (current, layout) =>
            withFocusMirror(current, focusRightPanelGroup(layout, groupId)),
          ),
        ),
      resizeColumns: (ref, sizes) =>
        set((state) =>
          updateThreadAndLayout(
            state,
            scopedThreadKey(rightPanelHostRef(ref)),
            (current, layout) => ({
              thread: current,
              layout: resizeRightPanelColumns(layout, sizes),
            }),
          ),
        ),
      resizeGroups: (ref, columnId, sizes) =>
        set((state) =>
          updateThreadAndLayout(
            state,
            scopedThreadKey(rightPanelHostRef(ref)),
            (current, layout) => ({
              thread: current,
              layout: resizeRightPanelGroups(layout, columnId, sizes),
            }),
          ),
        ),
      toggleGroupMaximized: (ref, groupId) =>
        set((state) =>
          updateThreadAndLayout(
            state,
            scopedThreadKey(rightPanelHostRef(ref)),
            (current, layout) => {
              if (!findRightPanelGroup(layout, groupId)) return { thread: current, layout };
              const maximizedGroup = current.maximized
                ? (layout.maximizedGroupId ?? layout.focusedGroupId)
                : null;
              if (maximizedGroup === groupId) {
                const { maximized: _maximized, ...thread } = current;
                const { maximizedGroupId: _group, ...rest } = layout;
                return { thread, layout: rest };
              }
              return withFocusMirror(
                { ...current, maximized: true },
                { ...focusRightPanelGroup(layout, groupId), maximizedGroupId: groupId },
              );
            },
          ),
        ),
      minimizeGroup: (ref, groupId) =>
        set((state) =>
          layoutAction(state, ref, (current, layout) =>
            withFocusMirror(current, minimizeRightPanelGroup(layout, groupId, Date.now())),
          ),
        ),
      restoreGroup: (ref, groupId) =>
        set((state) =>
          layoutAction(state, ref, (current, layout) => {
            const restored = restoreRightPanelGroup(layout, groupId);
            if (restored === layout) return { thread: current, layout };
            return withFocusMirror({ ...current, isOpen: true }, restored);
          }),
        ),
      selectGroupSurface: (ref, groupId, surfaceId) =>
        set((state) =>
          layoutAction(state, ref, (current, layout) =>
            withFocusMirror(current, setRightPanelGroupActive(layout, groupId, surfaceId)),
          ),
        ),
      closeGroup: (ref, groupId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current, layout) => {
            const closing = new Set(
              findRightPanelGroup(layout, groupId)?.surfaceIds ??
                layout.minimized.find((entry) => entry.group.id === groupId)?.group.surfaceIds ??
                [],
            );
            if (closing.size === 0) return current;
            const surfaces = current.surfaces.filter((surface) => !closing.has(surface.id));
            return { ...current, surfaces, isOpen: surfaces.length > 0 && current.isOpen };
          }),
        ),
      reconcileBrowserSurfaces: (ref, tabIds, hiddenTabIds) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            const kept = current.surfaces.filter(
              (surface) =>
                surface.kind !== "preview" ||
                (surface.id !== "browser:new" && validIds.has(surface.id)),
            );
            const knownIds = new Set(kept.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`) && !hiddenTabIds?.has(tabId))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...kept, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            // A closed session tab was the last surface: hide the panel rather than leave it on
            // the empty picker, as a user close would. A dropped `browser:new` placeholder does not count.
            const closedLastSessionTab =
              surfaces.length === 0 &&
              current.surfaces.some((surface) => surface.kind === "preview" && surface.resourceId);
            return {
              ...current,
              isOpen: closedLastSessionTab ? false : current.isOpen,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
            };
          }),
        ),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) =>
                surface.kind !== "files" &&
                (surface.kind !== "file" || surface.attachment !== undefined),
            );
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        ),
      show: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        ),
      close: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        ),
      setMaximized: (ref, maximized) =>
        set((state) =>
          updateThreadAndLayout(state, scopedThreadKey(ref), (current, layout) => {
            if ((current.maximized ?? false) === maximized) return { thread: current, layout };
            const { maximized: _maximized, ...rest } = current;
            const { maximizedGroupId: _group, ...unmaximized } = layout;
            if (!maximized) return { thread: rest, layout: unmaximized };
            return {
              thread: { ...rest, maximized: true },
              layout:
                layout.focusedGroupId === null
                  ? unmaximized
                  : { ...layout, maximizedGroupId: layout.focusedGroupId },
            };
          }),
        ),
      toggleVisibility: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        ),
      toggle: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      setThreadPanelOpen: (ref, presentation, open) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) => {
              const key = presentation === "inline" ? "inlineOpen" : "popoverOpen";
              return visibility[key] === open ? visibility : { ...visibility, [key]: open };
            },
          ),
        })),
      toggleThreadPanel: (ref, presentation) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) =>
              presentation === "inline"
                ? { ...visibility, inlineOpen: !visibility.inlineOpen }
                : { ...visibility, popoverOpen: !visibility.popoverOpen },
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.layoutByThreadKey) &&
            !(threadKey in state.threadPanelVisibilityByThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey) &&
            !(threadKey in state.closeRevisionByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _layout, ...layoutByThreadKey } = state.layoutByThreadKey;
          const { [threadKey]: _visibility, ...threadPanelVisibilityByThreadKey } =
            state.threadPanelVisibilityByThreadKey;
          const { [threadKey]: _revision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          const { [threadKey]: _closeRevision, ...closeRevisionByThreadKey } =
            state.closeRevisionByThreadKey;
          return {
            byThreadKey,
            layoutByThreadKey,
            threadPanelVisibilityByThreadKey,
            userActionRevisionByThreadKey,
            closeRevisionByThreadKey,
          };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: Object.fromEntries(
          Object.entries(state.byThreadKey).flatMap(([threadKey, threadState]) =>
            isPullRequestsPanelKey(threadKey)
              ? []
              : [
                  [
                    threadKey,
                    { ...threadState, surfaces: threadState.surfaces.map(withoutReveal) },
                  ],
                ],
          ),
        ),
        layoutByThreadKey: Object.fromEntries(
          Object.entries(state.layoutByThreadKey).filter(
            ([threadKey]) => !isPullRequestsPanelKey(threadKey) && threadKey in state.byThreadKey,
          ),
        ),
        threadPanelVisibilityByThreadKey: Object.fromEntries(
          Object.entries(state.threadPanelVisibilityByThreadKey).flatMap(
            ([threadKey, visibility]) =>
              visibility.inlineOpen ? [] : [[threadKey, { inlineOpen: false, popoverOpen: false }]],
          ),
        ),
      }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

useRightPanelStore.subscribe((next, previous) => {
  if (next.closeRevisionByThreadKey === previous.closeRevisionByThreadKey) return;
  for (const [threadKey, revision] of Object.entries(next.closeRevisionByThreadKey)) {
    if (revision === previous.closeRevisionByThreadKey[threadKey]) continue;
    const threadRef = parseScopedThreadKey(threadKey);
    if (!threadRef) continue;
    const before = previous.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const after = next.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const removed = before.surfaces.filter(
      (surface) => !after.surfaces.some((entry) => entry.id === surface.id),
    );
    const closedInOrder = [
      ...removed.filter((surface) => surface.id !== before.activeSurfaceId),
      ...removed.filter((surface) => surface.id === before.activeSurfaceId),
    ];
    for (const surface of closedInOrder.map(withoutReveal)) {
      if (surface.kind === "preview" && surface.resourceId !== null) continue;
      useClosedViewStore.getState().remember({ kind: "panel-tab", threadRef, surface });
    }
  }
});

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectThreadRightPanelLayout(
  state: Pick<RightPanelStoreState, "byThreadKey" | "layoutByThreadKey">,
  ref: ScopedThreadRef | null | undefined,
): RightPanelLayout {
  if (!ref) return EMPTY_RIGHT_PANEL_LAYOUT;
  const threadKey = scopedThreadKey(ref);
  return layoutOf(
    state.layoutByThreadKey,
    threadKey,
    state.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE,
  );
}

export function selectThreadPanelVisibility(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
): ThreadPanelVisibility {
  if (!ref) return DEFAULT_THREAD_PANEL_VISIBILITY;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
}

export function selectThreadPanelOpen(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
  presentation: ThreadPanelPresentation,
): boolean {
  const visibility = selectThreadPanelVisibility(byThreadKey, ref);
  return presentation === "inline" ? visibility.inlineOpen : visibility.popoverOpen;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byThreadKey, ref);
}

export function selectSelectedRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
