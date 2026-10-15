import type { KeybindingShortcut } from "@t3tools/contracts";

// Keybindings store lowercase names (`arrowup`, `escape`). Snapshot chords use
// the same fields with Electron's own spelling (`ArrowUp`). Both must become
// one accelerator token.
const ELECTRON_KEY_NAMES: Readonly<Record<string, string>> = {
  " ": "Space",
  "+": "Plus",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  backspace: "Backspace",
  delete: "Delete",
  end: "End",
  enter: "Enter",
  escape: "Esc",
  home: "Home",
  insert: "Insert",
  pagedown: "PageDown",
  pageup: "PageUp",
  tab: "Tab",
};

/** Electron spelling of a portable shortcut, for display or registration. */
export function toElectronAccelerator(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("CommandOrControl");
  if (shortcut.metaKey) parts.push("Super");
  if (shortcut.ctrlKey) parts.push("Control");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  parts.push(ELECTRON_KEY_NAMES[shortcut.key.toLowerCase()] ?? shortcut.key.toUpperCase());
  return parts.join("+");
}
