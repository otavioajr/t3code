/**
 * The right panel's arrangement: columns of stacked tab groups, plus groups minimized to cards.
 * Surfaces themselves live in the thread's registry (`ThreadRightPanelState.surfaces`); groups only
 * hold their ids. Sizes are relative weights, normalized when rendered, so removing a sibling
 * needs no renormalization.
 */
export interface RightPanelGroup {
  readonly id: string;
  readonly surfaceIds: readonly string[];
  readonly activeSurfaceId: string;
  readonly size: number;
}

export interface RightPanelColumn {
  readonly id: string;
  readonly groups: readonly RightPanelGroup[];
  readonly size: number;
}

export interface RightPanelGroupOrigin {
  readonly columnId: string;
  readonly columnIndex: number;
  readonly columnSize: number;
  readonly groupIndex: number;
  /** The group was its column's only group, so restoring recreates the column. */
  readonly ownColumn: boolean;
  /** Columns known to sit left and right of an owned column, nearest first. */
  readonly leftColumnIds?: readonly string[];
  readonly rightColumnIds?: readonly string[];
}

export interface MinimizedRightPanelGroup {
  readonly group: RightPanelGroup;
  readonly origin: RightPanelGroupOrigin;
  readonly minimizedAt: number;
}

export interface RightPanelLayout {
  readonly columns: readonly RightPanelColumn[];
  readonly focusedGroupId: string | null;
  /** Oldest first. */
  readonly minimized: readonly MinimizedRightPanelGroup[];
  readonly maximizedGroupId?: string;
}

export type RightPanelDropTarget =
  | { readonly kind: "join"; readonly groupId: string; readonly index?: number }
  | { readonly kind: "column"; readonly groupId: string; readonly side: "left" | "right" }
  | { readonly kind: "split"; readonly groupId: string; readonly side: "above" | "below" };

export const EMPTY_RIGHT_PANEL_LAYOUT: RightPanelLayout = {
  columns: [],
  focusedGroupId: null,
  minimized: [],
};

const MIN_WEIGHT = 0.05;

export function defaultRightPanelLayout(
  surfaceIds: readonly string[],
  activeSurfaceId: string | null,
): RightPanelLayout {
  if (surfaceIds.length === 0) return EMPTY_RIGHT_PANEL_LAYOUT;
  return {
    columns: [
      {
        id: "c1",
        size: 1,
        groups: [
          {
            id: "g1",
            surfaceIds: [...surfaceIds],
            activeSurfaceId:
              activeSurfaceId !== null && surfaceIds.includes(activeSurfaceId)
                ? activeSurfaceId
                : surfaceIds[0]!,
            size: 1,
          },
        ],
      },
    ],
    focusedGroupId: "g1",
    minimized: [],
  };
}

function visibleRightPanelGroups(layout: RightPanelLayout): RightPanelGroup[] {
  return layout.columns.flatMap((column) => column.groups);
}

export function findRightPanelGroup(
  layout: RightPanelLayout,
  groupId: string | null,
): RightPanelGroup | null {
  if (groupId === null) return null;
  for (const column of layout.columns) {
    const group = column.groups.find((entry) => entry.id === groupId);
    if (group) return group;
  }
  return null;
}

function rightPanelGroupOfSurface(
  layout: RightPanelLayout,
  surfaceId: string,
): RightPanelGroup | null {
  for (const column of layout.columns) {
    const group = column.groups.find((entry) => entry.surfaceIds.includes(surfaceId));
    if (group) return group;
  }
  return null;
}

function focusedRightPanelGroup(layout: RightPanelLayout): RightPanelGroup | null {
  return findRightPanelGroup(layout, layout.focusedGroupId);
}

function nextId(layout: RightPanelLayout, prefix: "c" | "g", taken: readonly string[] = []) {
  const ids = [
    ...layout.columns.map((column) => column.id),
    ...layout.columns.flatMap((column) => column.groups.map((group) => group.id)),
    ...layout.minimized.flatMap((entry) => [entry.group.id, entry.origin.columnId]),
    ...taken,
  ];
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const value = Number(id.slice(prefix.length));
    if (Number.isSafeInteger(value) && value > max) max = value;
  }
  return `${prefix}${max + 1}`;
}

function locateGroup(layout: RightPanelLayout, groupId: string) {
  for (const [columnIndex, column] of layout.columns.entries()) {
    const groupIndex = column.groups.findIndex((group) => group.id === groupId);
    if (groupIndex >= 0) return { columnIndex, groupIndex, column };
  }
  return null;
}

function withoutEmpty(layout: RightPanelLayout): RightPanelLayout {
  const columns = layout.columns.flatMap((column) => {
    const groups = column.groups.filter((group) => group.surfaceIds.length > 0);
    if (groups.length === 0) return [];
    return [groups.length === column.groups.length ? column : { ...column, groups }];
  });
  const minimized = layout.minimized.filter((entry) => entry.group.surfaceIds.length > 0);
  return { ...layout, columns, minimized };
}

/** Focus survives its group leaving: a neighbour in the same column, then the nearest column. */
function refocus(
  layout: RightPanelLayout,
  previous: RightPanelLayout,
  preferred: string | null = layout.focusedGroupId,
): RightPanelLayout {
  const visible = visibleRightPanelGroups(layout);
  if (preferred !== null && visible.some((group) => group.id === preferred)) {
    return layout.focusedGroupId === preferred ? layout : { ...layout, focusedGroupId: preferred };
  }
  let focusedGroupId: string | null = visible[0]?.id ?? null;
  const before = preferred === null ? null : locateGroup(previous, preferred);
  if (before) {
    const sameColumn = layout.columns.find((column) => column.id === before.column.id);
    if (sameColumn && sameColumn.groups.length > 0) {
      focusedGroupId =
        sameColumn.groups[Math.min(before.groupIndex, sameColumn.groups.length - 1)]!.id;
    } else if (layout.columns.length > 0) {
      const column = layout.columns[Math.min(before.columnIndex, layout.columns.length - 1)]!;
      focusedGroupId = column.groups[0]?.id ?? focusedGroupId;
    }
  }
  return { ...layout, focusedGroupId };
}

function clearStaleMaximize(layout: RightPanelLayout): RightPanelLayout {
  if (layout.maximizedGroupId === undefined) return layout;
  if (findRightPanelGroup(layout, layout.maximizedGroupId)) return layout;
  const { maximizedGroupId: _stale, ...rest } = layout;
  return rest;
}

function mapGroups(
  layout: RightPanelLayout,
  update: (group: RightPanelGroup) => RightPanelGroup,
): RightPanelLayout {
  return {
    ...layout,
    columns: layout.columns.map((column) => ({ ...column, groups: column.groups.map(update) })),
    minimized: layout.minimized.map((entry) => ({ ...entry, group: update(entry.group) })),
  };
}

function prunedGroup(group: RightPanelGroup, keep: (id: string) => boolean): RightPanelGroup {
  const surfaceIds = group.surfaceIds.filter(keep);
  if (surfaceIds.length === group.surfaceIds.length) return group;
  if (surfaceIds.includes(group.activeSurfaceId)) return { ...group, surfaceIds };
  const index = group.surfaceIds.indexOf(group.activeSurfaceId);
  const activeSurfaceId = surfaceIds[Math.min(Math.max(index, 0), surfaceIds.length - 1)] ?? "";
  return { ...group, surfaceIds, activeSurfaceId };
}

function containsSurface(layout: RightPanelLayout, surfaceId: string): boolean {
  return (
    rightPanelGroupOfSurface(layout, surfaceId) !== null ||
    layout.minimized.some((entry) => entry.group.surfaceIds.includes(surfaceId))
  );
}

function appendNewColumn(layout: RightPanelLayout, surfaceIds: readonly string[]) {
  const columnId = nextId(layout, "c");
  const groupId = nextId(layout, "g");
  const size =
    layout.columns.length === 0
      ? 1
      : layout.columns.reduce((sum, column) => sum + column.size, 0) / layout.columns.length;
  return {
    ...layout,
    columns: [
      ...layout.columns,
      {
        id: columnId,
        size,
        groups: [{ id: groupId, surfaceIds, activeSurfaceId: surfaceIds[0]!, size: 1 }],
      },
    ],
    focusedGroupId: groupId,
  };
}

function setActive(layout: RightPanelLayout, groupId: string, surfaceId: string) {
  return {
    ...layout,
    focusedGroupId: groupId,
    columns: layout.columns.map((column) =>
      column.groups.some((group) => group.id === groupId)
        ? {
            ...column,
            groups: column.groups.map((group) =>
              group.id === groupId && group.activeSurfaceId !== surfaceId
                ? { ...group, activeSurfaceId: surfaceId }
                : group,
            ),
          }
        : column,
    ),
  };
}

export interface RightPanelRegistryChange {
  readonly previousIds: readonly string[];
  readonly previousActiveSurfaceId: string | null;
  readonly nextIds: readonly string[];
  readonly nextActiveSurfaceId: string | null;
}

/**
 * Keeps the layout in step with registry edits made by reducers that only know the flat
 * surface list: drops closed ids, places new ones in the focused group, and follows activation.
 * Returns the focused group's active surface, which the flat `activeSurfaceId` mirrors.
 */
export function reconcileRightPanelLayout(
  layout: RightPanelLayout,
  change: RightPanelRegistryChange,
): { layout: RightPanelLayout; activeSurfaceId: string | null; restored: boolean } {
  const nextSet = new Set(change.nextIds);
  const previousSet = new Set(change.previousIds);
  const removed = change.previousIds.filter((id) => !nextSet.has(id));
  let added = change.nextIds.filter((id) => !containsSurface(layout, id));
  let next = layout;

  // A reducer that swaps one surface for another (a folder walk, a placeholder that got its tab)
  // keeps the replacement where the original sat.
  if (removed.length === 1 && added.length === 1) {
    const [from] = removed as [string];
    const [to] = added as [string];
    if (containsSurface(next, from)) {
      next = mapGroups(next, (group) =>
        group.surfaceIds.includes(from)
          ? {
              ...group,
              surfaceIds: group.surfaceIds.map((id) => (id === from ? to : id)),
              activeSurfaceId: group.activeSurfaceId === from ? to : group.activeSurfaceId,
            }
          : group,
      );
      added = [];
    }
  }

  const beforePrune = next;
  next = withoutEmpty(mapGroups(next, (group) => prunedGroup(group, (id) => nextSet.has(id))));
  next = refocus(next, beforePrune);

  if (added.length > 0) {
    const focused = focusedRightPanelGroup(next);
    next = focused
      ? mapGroups(next, (group) =>
          group.id === focused.id
            ? { ...group, surfaceIds: [...group.surfaceIds, ...added] }
            : group,
        )
      : appendNewColumn(next, added);
  }

  let restored = false;
  const target = change.nextActiveSurfaceId;
  const previousActive = change.previousActiveSurfaceId;
  const activation =
    target !== null &&
    nextSet.has(target) &&
    target !== previousActive &&
    (!previousSet.has(target) || previousActive === null || nextSet.has(previousActive));
  if (activation) {
    const minimized = next.minimized.find((entry) => entry.group.surfaceIds.includes(target));
    if (minimized) {
      next = restoreRightPanelGroup(next, minimized.group.id);
      restored = true;
    }
    const group = rightPanelGroupOfSurface(next, target);
    if (group) next = setActive(next, group.id, target);
  }

  next = clearStaleMaximize(next);
  const settled = sameLayout(layout, next) ? layout : next;
  return {
    layout: settled,
    activeSurfaceId: focusedRightPanelGroup(settled)?.activeSurfaceId ?? null,
    restored,
  };
}

function sameLayout(left: RightPanelLayout, right: RightPanelLayout): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function focusRightPanelGroup(layout: RightPanelLayout, groupId: string): RightPanelLayout {
  if (layout.focusedGroupId === groupId || !findRightPanelGroup(layout, groupId)) return layout;
  return { ...layout, focusedGroupId: groupId };
}

export function reorderRightPanelSurface(
  layout: RightPanelLayout,
  surfaceId: string,
  toIndex: number,
): RightPanelLayout {
  const group = rightPanelGroupOfSurface(layout, surfaceId);
  if (!group) return layout;
  const fromIndex = group.surfaceIds.indexOf(surfaceId);
  const clamped = Math.max(0, Math.min(toIndex, group.surfaceIds.length - 1));
  if (fromIndex === clamped) return layout;
  const surfaceIds = [...group.surfaceIds];
  surfaceIds.splice(clamped, 0, ...surfaceIds.splice(fromIndex, 1));
  return mapGroups(layout, (entry) => (entry.id === group.id ? { ...entry, surfaceIds } : entry));
}

/** Moves a tab into another group, a new column beside a group's column, or a new stacked group. */
export function moveRightPanelSurface(
  layout: RightPanelLayout,
  surfaceId: string,
  target: RightPanelDropTarget,
): RightPanelLayout {
  const source = rightPanelGroupOfSurface(layout, surfaceId);
  const targetGroup = findRightPanelGroup(layout, target.groupId);
  if (!source || !targetGroup) return layout;
  if (target.kind === "join" && targetGroup.id === source.id) {
    return target.index === undefined
      ? layout
      : reorderRightPanelSurface(layout, surfaceId, target.index);
  }
  // Splitting a group off from itself would leave it empty and move nothing.
  if (target.kind !== "join" && source.id === targetGroup.id && source.surfaceIds.length === 1) {
    if (target.kind === "split") return layout;
    const location = locateGroup(layout, source.id)!;
    if (location.column.groups.length === 1) return layout;
  }

  const detached = mapGroups(layout, (group) =>
    group.id === source.id ? prunedGroup(group, (id) => id !== surfaceId) : group,
  );
  let placedGroupId = target.groupId;
  let next: RightPanelLayout;
  if (target.kind === "join") {
    next = mapGroups(detached, (group) => {
      if (group.id !== target.groupId) return group;
      const surfaceIds = [...group.surfaceIds];
      const index = target.index ?? surfaceIds.length;
      surfaceIds.splice(Math.max(0, Math.min(index, surfaceIds.length)), 0, surfaceId);
      return { ...group, surfaceIds, activeSurfaceId: surfaceId };
    });
  } else {
    const location = locateGroup(detached, target.groupId)!;
    placedGroupId = nextId(detached, "g");
    if (target.kind === "column") {
      const newColumnSize = location.column.size / 2;
      const column: RightPanelColumn = {
        id: nextId(detached, "c"),
        size: newColumnSize,
        groups: [
          { id: placedGroupId, surfaceIds: [surfaceId], activeSurfaceId: surfaceId, size: 1 },
        ],
      };
      const columns = detached.columns.map((entry, index) =>
        index === location.columnIndex ? { ...entry, size: newColumnSize } : entry,
      );
      columns.splice(location.columnIndex + (target.side === "right" ? 1 : 0), 0, column);
      next = { ...detached, columns };
    } else {
      const anchor = location.column.groups[location.groupIndex]!;
      const newSize = anchor.size / 2;
      const groups = location.column.groups.map((group) =>
        group.id === anchor.id ? { ...group, size: newSize } : group,
      );
      groups.splice(location.groupIndex + (target.side === "below" ? 1 : 0), 0, {
        id: placedGroupId,
        surfaceIds: [surfaceId],
        activeSurfaceId: surfaceId,
        size: newSize,
      });
      next = {
        ...detached,
        columns: detached.columns.map((column, index) =>
          index === location.columnIndex ? { ...column, groups } : column,
        ),
      };
    }
  }
  next = clearStaleMaximize(withoutEmpty(next));
  return setActive(next, placedGroupId, surfaceId);
}

function validWeights(sizes: readonly number[], expected: number): number[] | null {
  if (sizes.length !== expected) return null;
  if (!sizes.every((size) => Number.isFinite(size) && size > 0)) return null;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => Math.max(MIN_WEIGHT, size / total));
}

export function resizeRightPanelColumns(
  layout: RightPanelLayout,
  sizes: readonly number[],
): RightPanelLayout {
  const weights = validWeights(sizes, layout.columns.length);
  if (!weights) return layout;
  return {
    ...layout,
    columns: layout.columns.map((column, index) => ({ ...column, size: weights[index]! })),
  };
}

export function resizeRightPanelGroups(
  layout: RightPanelLayout,
  columnId: string,
  sizes: readonly number[],
): RightPanelLayout {
  const column = layout.columns.find((entry) => entry.id === columnId);
  const weights = column ? validWeights(sizes, column.groups.length) : null;
  if (!column || !weights) return layout;
  return {
    ...layout,
    columns: layout.columns.map((entry) =>
      entry.id === columnId
        ? {
            ...entry,
            groups: entry.groups.map((group, index) => ({ ...group, size: weights[index]! })),
          }
        : entry,
    ),
  };
}

export function minimizeRightPanelGroup(
  layout: RightPanelLayout,
  groupId: string,
  now: number,
): RightPanelLayout {
  const location = locateGroup(layout, groupId);
  if (!location) return layout;
  const group = location.column.groups[location.groupIndex]!;
  const ownColumn = location.column.groups.length === 1;
  const columnId = location.column.id;
  // Columns already minimized beside this one are only known from their own origins.
  const knownBeside = (side: "left" | "right") =>
    layout.minimized.flatMap((entry) =>
      (side === "left" ? entry.origin.rightColumnIds : entry.origin.leftColumnIds)?.includes(
        columnId,
      )
        ? [entry.origin.columnId]
        : [],
    );
  const neighbours = ownColumn
    ? {
        leftColumnIds: [
          ...layout.columns
            .slice(0, location.columnIndex)
            .map((column) => column.id)
            .toReversed(),
          ...knownBeside("left"),
        ],
        rightColumnIds: [
          ...layout.columns.slice(location.columnIndex + 1).map((column) => column.id),
          ...knownBeside("right"),
        ],
      }
    : {};
  const columns = layout.columns.flatMap((column, index) => {
    if (index !== location.columnIndex) return [column];
    const groups = column.groups.filter((entry) => entry.id !== groupId);
    return groups.length === 0 ? [] : [{ ...column, groups }];
  });
  const next: RightPanelLayout = {
    ...layout,
    columns,
    minimized: [
      ...layout.minimized,
      {
        group,
        origin: {
          columnId: location.column.id,
          columnIndex: location.columnIndex,
          columnSize: location.column.size,
          groupIndex: location.groupIndex,
          ownColumn,
          ...neighbours,
        },
        minimizedAt: now,
      },
    ],
  };
  return clearStaleMaximize(refocus(next, layout));
}

/** Puts a minimized group back where it was; a vanished slot falls back to the last column. */
export function restoreRightPanelGroup(
  layout: RightPanelLayout,
  groupId: string,
): RightPanelLayout {
  const entry = layout.minimized.find((candidate) => candidate.group.id === groupId);
  if (!entry) return layout;
  const minimized = layout.minimized.filter((candidate) => candidate !== entry);
  const { group, origin } = entry;
  const columnIndex = layout.columns.findIndex((column) => column.id === origin.columnId);
  let columns: RightPanelColumn[];
  if (columnIndex >= 0) {
    columns = layout.columns.map((column, index) => {
      if (index !== columnIndex) return column;
      const groups = [...column.groups];
      groups.splice(Math.min(origin.groupIndex, groups.length), 0, group);
      return { ...column, groups };
    });
  } else if (origin.ownColumn || layout.columns.length === 0) {
    columns = [...layout.columns];
    const liveIndex = (ids: readonly string[] | undefined) => {
      for (const id of ids ?? []) {
        const index = columns.findIndex((column) => column.id === id);
        if (index >= 0) return index;
      }
      return -1;
    };
    const left = liveIndex(origin.leftColumnIds);
    const right = liveIndex(origin.rightColumnIds);
    const at =
      left >= 0 ? left + 1 : right >= 0 ? right : Math.min(origin.columnIndex, columns.length);
    columns.splice(at, 0, {
      id: origin.columnId,
      size: origin.columnSize,
      groups: [{ ...group, size: 1 }],
    });
  } else {
    columns = layout.columns.map((column, index) =>
      index === layout.columns.length - 1
        ? { ...column, groups: [...column.groups, group] }
        : column,
    );
  }
  return { ...layout, columns, minimized, focusedGroupId: group.id };
}

export function setRightPanelGroupActive(
  layout: RightPanelLayout,
  groupId: string,
  surfaceId: string,
): RightPanelLayout {
  const minimized = layout.minimized.find((entry) => entry.group.id === groupId);
  if (minimized) {
    if (!minimized.group.surfaceIds.includes(surfaceId)) return layout;
    return {
      ...layout,
      minimized: layout.minimized.map((entry) =>
        entry === minimized
          ? { ...entry, group: { ...entry.group, activeSurfaceId: surfaceId } }
          : entry,
      ),
    };
  }
  const group = findRightPanelGroup(layout, groupId);
  if (!group?.surfaceIds.includes(surfaceId)) return layout;
  return setActive(layout, groupId, surfaceId);
}

/** Tab ids in the group holding `surfaceId`, visible or minimized. */
export function rightPanelGroupSurfaceIds(
  layout: RightPanelLayout,
  surfaceId: string,
): readonly string[] {
  return (
    rightPanelGroupOfSurface(layout, surfaceId)?.surfaceIds ??
    layout.minimized.find((entry) => entry.group.surfaceIds.includes(surfaceId))?.group
      .surfaceIds ??
    []
  );
}

/** Validates persisted layout data; anything malformed falls back to the default layout. */
export function parsePersistedRightPanelLayout(value: unknown): RightPanelLayout | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const parseGroup = (input: unknown): RightPanelGroup | null => {
    if (!input || typeof input !== "object") return null;
    const group = input as Record<string, unknown>;
    if (typeof group.id !== "string" || !Array.isArray(group.surfaceIds)) return null;
    const surfaceIds = group.surfaceIds.filter((id): id is string => typeof id === "string");
    if (surfaceIds.length === 0) return null;
    return {
      id: group.id,
      surfaceIds,
      activeSurfaceId:
        typeof group.activeSurfaceId === "string" && surfaceIds.includes(group.activeSurfaceId)
          ? group.activeSurfaceId
          : surfaceIds[0]!,
      size: typeof group.size === "number" && group.size > 0 ? group.size : 1,
    };
  };
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.minimized)) return null;
  const columns = raw.columns.flatMap((input): RightPanelColumn[] => {
    if (!input || typeof input !== "object") return [];
    const column = input as Record<string, unknown>;
    if (typeof column.id !== "string" || !Array.isArray(column.groups)) return [];
    const groups = column.groups.flatMap((group) => parseGroup(group) ?? []);
    if (groups.length === 0) return [];
    return [
      {
        id: column.id,
        size: typeof column.size === "number" && column.size > 0 ? column.size : 1,
        groups,
      },
    ];
  });
  const minimized = raw.minimized.flatMap((input): MinimizedRightPanelGroup[] => {
    if (!input || typeof input !== "object") return [];
    const entry = input as Record<string, unknown>;
    const group = parseGroup(entry.group);
    const origin = entry.origin as Record<string, unknown> | undefined;
    if (!group || !origin || typeof origin.columnId !== "string") return [];
    const number = (key: string, fallback: number) =>
      typeof origin[key] === "number" && Number.isFinite(origin[key]) ? origin[key] : fallback;
    return [
      {
        group,
        origin: {
          columnId: origin.columnId,
          columnIndex: number("columnIndex", 0),
          columnSize: number("columnSize", 1),
          groupIndex: number("groupIndex", 0),
          ownColumn: origin.ownColumn === true,
          ...(Array.isArray(origin.leftColumnIds)
            ? {
                leftColumnIds: origin.leftColumnIds.filter(
                  (id): id is string => typeof id === "string",
                ),
              }
            : {}),
          ...(Array.isArray(origin.rightColumnIds)
            ? {
                rightColumnIds: origin.rightColumnIds.filter(
                  (id): id is string => typeof id === "string",
                ),
              }
            : {}),
        },
        minimizedAt: typeof entry.minimizedAt === "number" ? entry.minimizedAt : 0,
      },
    ];
  });
  const groups = columns.flatMap((column) => column.groups);
  const focusedGroupId =
    typeof raw.focusedGroupId === "string" &&
    groups.some((group) => group.id === raw.focusedGroupId)
      ? raw.focusedGroupId
      : (groups[0]?.id ?? null);
  return {
    columns,
    focusedGroupId,
    minimized,
    ...(typeof raw.maximizedGroupId === "string" &&
    groups.some((group) => group.id === raw.maximizedGroupId)
      ? { maximizedGroupId: raw.maximizedGroupId }
      : {}),
  };
}
