import { EnvironmentId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  MINIMIZE_NEEDS_PAGE_REASON,
  MINIMIZE_UNSUPPORTED_REASON,
  resolvePullRequestTabLink,
  rightPanelDropTarget,
  rightPanelDropZoneAt,
  rightPanelMinimizeBlockedReason,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from "./RightPanelTabs";

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof surfaceShortcutActionForKey>[1]> = {},
): Parameters<typeof surfaceShortcutActionForKey>[1] {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ...overrides,
  };
}

describe("surface shortcuts", () => {
  const actions = [
    { shortcut: "B", available: true, label: "Browser" },
    { shortcut: "D", available: false, label: "Diff" },
    { shortcut: "T", available: true, label: "Terminal" },
    { shortcut: "M", available: true, label: "Device" },
  ] as const;

  it("falls back to the physical key when the layout types a non-Latin letter or mark", () => {
    // Ukrainian layout: the B key types "и".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u0438", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Greek layout: the B key types "β".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u03b2", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Thai layout: the B key types the vowel sign "\u0e34", a combining mark.
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u0e34", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Arabic (101) layout: the B key types lam alef "\u0644\u0627", two code points.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u0644\u0627", { code: "KeyB" })),
    ).toBe(actions[0]);
    // Ukrainian layout: the D key types "\u0432", but the Diff surface is unavailable.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u0432", { code: "KeyD" })),
    ).toBeNull();
  });

  it("follows the typed letter on Latin layouts that move it", () => {
    // Dvorak: the key at QWERTY B types "x", and "b" sits on QWERTY N.
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("x", { code: "KeyB" }))).toBeNull();
    // The same key with Shift or Caps Lock types "X".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("X", { code: "KeyB" }))).toBeNull();
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b", { code: "KeyN" }))).toBe(
      actions[0],
    );
  });

  it("keeps accented Latin letters typed on a letter key", () => {
    // Bépo: the T key types "è".
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u00e8", { code: "KeyT" })),
    ).toBeNull();
  });

  it("keeps punctuation typed on a letter key", () => {
    // French AZERTY: the M key types ",".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent(",", { code: "KeyM" }))).toBeNull();
  });

  it("keeps a dead key on a letter key", () => {
    // A dead key starts an accented letter on a Latin layout.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("Dead", { code: "KeyT" })),
    ).toBeNull();
  });

  it("leaves modified, composing, and already-handled key events alone", () => {
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b", { metaKey: true }))).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { isComposing: true })),
    ).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { defaultPrevented: true })),
    ).toBeNull();
  });

  it("leaves AltGr text alone unless it is a plain letter", () => {
    const getModifierState = (key: string) => key === "AltGraph";
    // German layout: AltGr+M types "\u00b5" and sets only AltGraph on Linux and Windows.
    expect(
      surfaceShortcutActionForKey(
        actions,
        shortcutEvent("\u00b5", { code: "KeyM", getModifierState }),
      ),
    ).toBeNull();
    // Finnish layout: AltGr+B types "b", which still matches, as it does in keybindings.ts.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { code: "KeyB", getModifierState })),
    ).toBe(actions[0]);
  });
});

describe("surface shortcut typing contexts", () => {
  const makeTarget = (matches: string | null) => ({
    closest(selectors: string) {
      if (matches === null || !selectors.includes(matches)) return null;
      return {};
    },
  });

  it("treats form fields and every editable region as typing contexts", () => {
    expect(surfaceShortcutTargetsTypingContext(makeTarget("input"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("textarea"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("select"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("[contenteditable]"))).toBe(true);
  });
});

describe("pull request tab snapshots", () => {
  const environmentId = EnvironmentId.make("local");
  const link: ThreadPullRequestLink = {
    host: "github.com",
    repository: "acme/api",
    number: 7,
    url: "https://github.com/acme/api/pull/7",
    source: "manual",
    linkedAt: "2026-01-01T00:00:00Z",
    stack: null,
    snapshot: null,
  };
  it("keeps unknown linked state authoritative and scopes matches to environment and host", () => {
    const threads = [{ environmentId, pullRequests: [link] }];
    expect(resolvePullRequestTabLink(threads, environmentId, "github.com", link)).toBe(link);
    expect(
      resolvePullRequestTabLink(threads, EnvironmentId.make("remote"), "github.com", link),
    ).toBeUndefined();
    expect(
      resolvePullRequestTabLink(threads, environmentId, "github.enterprise.test", link),
    ).toBeUndefined();
  });
  it("uses the newest snapshot when several threads link the same PR", () => {
    const snapshot = {
      state: "merged" as const,
      title: "API",
      headBranch: "api",
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-02-01T00:00:00Z",
    };
    const newer = { ...link, snapshot };
    expect(
      resolvePullRequestTabLink(
        [{ environmentId, pullRequests: [link, newer] }],
        environmentId,
        "github.com",
        link,
      ),
    ).toBe(newer);
  });
});

describe("group drop targets", () => {
  const rect = { left: 0, top: 0, width: 400, height: 200 };
  it.each([
    { x: 20, y: 100, zone: "left", target: { kind: "column", groupId: "g1", side: "left" } },
    { x: 390, y: 100, zone: "right", target: { kind: "column", groupId: "g1", side: "right" } },
    { x: 200, y: 10, zone: "top", target: { kind: "split", groupId: "g1", side: "above" } },
    { x: 200, y: 190, zone: "bottom", target: { kind: "split", groupId: "g1", side: "below" } },
    { x: 200, y: 100, zone: "center", target: { kind: "join", groupId: "g1" } },
    // A corner goes to the nearer edge.
    { x: 10, y: 45, zone: "left", target: { kind: "column", groupId: "g1", side: "left" } },
  ] as const)("$zone at ($x, $y)", ({ x, y, zone, target }) => {
    expect(rightPanelDropZoneAt(rect, x, y)).toBe(zone);
    expect(rightPanelDropTarget({ groupId: "g1", zone })).toEqual(target);
  });

  it("joins a tab strip at the hovered index", () => {
    expect(rightPanelDropTarget({ groupId: "g2", zone: "tabs", index: 1 })).toEqual({
      kind: "join",
      groupId: "g2",
      index: 1,
    });
  });
});

describe("minimize rules", () => {
  const browser = { id: "browser:tab-1", kind: "preview", resourceId: "tab-1" } as const;
  const snapshot = (tag: "Idle" | "Success") =>
    ({
      "tab-1": {
        navStatus:
          tag === "Idle"
            ? { _tag: "Idle" }
            : { _tag: "Success", url: "https://a.test", title: "A" },
      },
    }) as unknown as Parameters<typeof rightPanelMinimizeBlockedReason>[2];
  it.each([
    {
      name: "files",
      surfaces: [{ id: "files", kind: "files" }],
      reason: MINIMIZE_UNSUPPORTED_REASON,
    },
    { name: "diff", surfaces: [{ id: "diff", kind: "diff" }], reason: MINIMIZE_UNSUPPORTED_REASON },
    {
      name: "an unloaded browser",
      surfaces: [browser],
      sessions: "Idle",
      reason: MINIMIZE_NEEDS_PAGE_REASON,
    },
    { name: "a loaded browser", surfaces: [browser], sessions: "Success", reason: null },
  ] as const)("$name", ({ surfaces, sessions, reason }) => {
    expect(
      rightPanelMinimizeBlockedReason(surfaces, surfaces[0], sessions ? snapshot(sessions) : {}),
    ).toBe(reason);
  });
});
