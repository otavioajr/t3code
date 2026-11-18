import type { SplitViewKeybindingCommand } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Columns2Icon, XIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { dispatchMenuAction } from "../../shortcuts/dispatcher";
import type { ChatPane } from "../../splitView/chatPane";
import type { PanelLayoutControlsProps } from "../chat/PanelLayoutControls";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";

const SPLIT_MENU_ITEMS: ReadonlyArray<readonly [SplitViewKeybindingCommand, string]> = [
  ["splitView.splitRight", "New split right"],
  ["splitView.splitDown", "New split below"],
  ["splitView.focusNext", "Focus next pane"],
  ["splitView.focusPrevious", "Focus previous pane"],
  ["splitView.moveLeft", "Move split left"],
  ["splitView.moveRight", "Move split right"],
  ["splitView.moveUp", "Move split up"],
  ["splitView.moveDown", "Move split down"],
  ["splitView.close", "Close split"],
];

/**
 * A split pane's header controls: the pane menu, which also carries the panel toggles a narrow
 * pane hides, and the close button.
 */
export function SplitPaneHeaderControls(props: {
  readonly pane: ChatPane;
  readonly panels: PanelLayoutControlsProps;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { panels } = props;
  return (
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label="Split view options" />}
        >
          <Columns2Icon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem disabled={!panels.terminalAvailable} onClick={panels.onToggleTerminal}>
            {panels.terminalOpen ? "Hide terminal" : "Show terminal"}
          </MenuItem>
          <MenuItem onClick={panels.onToggleThreadPanel}>
            {panels.threadPanelOpen ? "Hide thread details" : "Show thread details"}
          </MenuItem>
          <MenuItem disabled={!panels.rightPanelAvailable} onClick={panels.onToggleRightPanel}>
            {panels.rightPanelOpen ? "Hide side panel" : "Show side panel"}
          </MenuItem>
          <MenuSeparator />
          {SPLIT_MENU_ITEMS.map(([command, label]) => {
            const shortcut = shortcutLabelForCommand(keybindings, command);
            return (
              <MenuItem key={command} onClick={() => dispatchMenuAction(command)}>
                {label}
                {shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
      <Button variant="ghost" size="icon-xs" aria-label="Close split" onClick={props.pane.close}>
        <XIcon />
      </Button>
    </div>
  );
}
