import { MessageSquareIcon, TerminalSquareIcon } from "lucide-react";

import type { SidebarWorkspaceSurface } from "~/lib/agentTerminalCommand";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

/** Same thread: Chat bubbles or this thread's Ghostty PTY. */
export function SidebarSurfaceToggle({
  surface,
  onSurfaceChange,
}: {
  readonly surface: SidebarWorkspaceSurface;
  readonly onSurfaceChange: (surface: SidebarWorkspaceSurface) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Workspace surface"
      variant="segmented"
      className="mt-1 w-full *:min-w-0 *:flex-1"
      value={[surface]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "chat" || value === "terminal") onSurfaceChange(value);
      }}
    >
      <Toggle value="chat" aria-label="Chat">
        <MessageSquareIcon className="size-3.5" />
        Chat
      </Toggle>
      <Toggle value="terminal" aria-label="Terminal">
        <TerminalSquareIcon className="size-3.5" />
        Terminal
      </Toggle>
    </ToggleGroup>
  );
}
