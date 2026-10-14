/**
 * "Remove from sidebar" in the legacy sidebar archives a project's threads and
 * hides the project, without deleting anything. The project comes back as soon
 * as the user works in it again: a thread of it is active, or the route is on
 * it (a new draft, or reopening it through "Add existing project").
 */
export type SidebarHiddenProjects = Readonly<Record<string, ReadonlyArray<string>>>;

/** Hidden projects the user is working in again, whose archived threads should be restored. */
export function findHiddenProjectsToRestore(input: {
  readonly hiddenProjects: SidebarHiddenProjects;
  readonly activeThreadCountByProjectKey: ReadonlyMap<string, number>;
  readonly activeRouteProjectKey: string | null;
}): ReadonlyArray<string> {
  return Object.keys(input.hiddenProjects).filter(
    (projectKey) =>
      projectKey === input.activeRouteProjectKey ||
      (input.activeThreadCountByProjectKey.get(projectKey) ?? 0) > 0,
  );
}

export function withHiddenProject(
  hiddenProjects: SidebarHiddenProjects,
  projectKey: string,
  archivedThreadKeys: ReadonlyArray<string>,
): SidebarHiddenProjects {
  const previous = hiddenProjects[projectKey] ?? [];
  return {
    ...hiddenProjects,
    [projectKey]: [...new Set([...previous, ...archivedThreadKeys])],
  };
}

export function withoutHiddenProjects(
  hiddenProjects: SidebarHiddenProjects,
  projectKeys: ReadonlyArray<string>,
): SidebarHiddenProjects {
  const removed = new Set(projectKeys);
  return Object.fromEntries(
    Object.entries(hiddenProjects).filter(([projectKey]) => !removed.has(projectKey)),
  );
}
