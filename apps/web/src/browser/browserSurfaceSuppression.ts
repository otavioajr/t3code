import { create } from "zustand";

/**
 * Native browser views sit above the DOM and swallow pointer events, so a panel tab drag hides
 * them until it ends; otherwise drop targets over a browser group never see the pointer.
 */
export const useBrowserSurfaceSuppression = create<{ readonly suppressed: boolean }>(() => ({
  suppressed: false,
}));

export function setBrowserSurfacesSuppressed(suppressed: boolean) {
  if (useBrowserSurfaceSuppression.getState().suppressed === suppressed) return;
  useBrowserSurfaceSuppression.setState({ suppressed });
}
