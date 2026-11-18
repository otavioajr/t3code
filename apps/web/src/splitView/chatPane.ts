import { createContext, use } from "react";

export const CHAT_PANE_ATTRIBUTE = "data-chat-pane";

/** A chat pane of the split view. Null in the single view, where the one chat owns the window. */
export interface ChatPane {
  readonly paneId: string;
  readonly focused: boolean;
  readonly ownsTitleBar: boolean;
  readonly close: () => void;
}

export const ChatPaneContext = createContext<ChatPane | null>(null);

export function useChatPane(): ChatPane | null {
  return use(ChatPaneContext);
}

/** The split pane an event target sits in (`data-chat-pane`), or null outside every pane. */
function chatPaneIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${CHAT_PANE_ATTRIBUTE}]`)?.getAttribute(CHAT_PANE_ATTRIBUTE) ?? null;
}

/**
 * Whether a window-level listener of `pane` may act on an event: one that started inside the pane,
 * or, for the focused pane, one that started outside every pane (the sidebar, the body).
 */
export function chatPaneOwnsEvent(pane: ChatPane | null, targetPaneId: string | null): boolean {
  if (pane === null) return true;
  return targetPaneId === null ? pane.focused : targetPaneId === pane.paneId;
}

export function chatPaneOwnsTarget(pane: ChatPane | null, target: EventTarget | null): boolean {
  return chatPaneOwnsEvent(pane, chatPaneIdOf(target));
}

/** Whether an element sits in a split pane that does not have focus; such panes ignore body keys. */
export function isInUnfocusedChatPane(element: Element): boolean {
  return (
    element.closest(`[${CHAT_PANE_ATTRIBUTE}]`)?.getAttribute("data-split-pane-focused") === "false"
  );
}
