import { describe, expect, it } from "vite-plus/test";

import {
  findHiddenProjectsToRestore,
  withHiddenProject,
  withoutHiddenProjects,
} from "./sidebarHiddenProjects.logic";

describe("sidebar hidden projects", () => {
  const hiddenProjects = { alpha: ["env:t1", "env:t2"], beta: ["env:t3"] };

  it("keeps a hidden project hidden while nothing in it is active", () => {
    expect(
      findHiddenProjectsToRestore({
        hiddenProjects,
        activeThreadCountByProjectKey: new Map([["gamma", 2]]),
        activeRouteProjectKey: "gamma",
      }),
    ).toEqual([]);
  });

  it("restores a hidden project once one of its threads is active again", () => {
    expect(
      findHiddenProjectsToRestore({
        hiddenProjects,
        activeThreadCountByProjectKey: new Map([["beta", 1]]),
        activeRouteProjectKey: null,
      }),
    ).toEqual(["beta"]);
  });

  it("restores a hidden project when the route opens it, even before it has a thread", () => {
    expect(
      findHiddenProjectsToRestore({
        hiddenProjects,
        activeThreadCountByProjectKey: new Map(),
        activeRouteProjectKey: "alpha",
      }),
    ).toEqual(["alpha"]);
  });

  it("merges archived threads when a project is removed twice, and forgets restored ones", () => {
    const hiddenAgain = withHiddenProject(hiddenProjects, "alpha", ["env:t2", "env:t4"]);
    expect(hiddenAgain.alpha).toEqual(["env:t1", "env:t2", "env:t4"]);
    expect(withoutHiddenProjects(hiddenAgain, ["alpha"])).toEqual({ beta: ["env:t3"] });
  });
});
