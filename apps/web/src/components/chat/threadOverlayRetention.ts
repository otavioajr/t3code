/**
 * Chat overlays (dialogs, media previews) are opened for one thread and must not
 * outlive its route. Overlay modules register here when they load, so the route
 * listener can drop them without importing the overlays themselves.
 */
const retainers: Array<(shownThreadKeys: ReadonlySet<string>) => void> = [];

export function registerThreadOverlay(
  retain: (shownThreadKeys: ReadonlySet<string>) => void,
): void {
  retainers.push(retain);
}

/** Drops every overlay opened for a thread no chat view shows (the route's, or a split pane's). */
export function retainThreadOverlaysForThreads(shownThreadKeys: ReadonlySet<string>): void {
  for (const retain of retainers) retain(shownThreadKeys);
}
