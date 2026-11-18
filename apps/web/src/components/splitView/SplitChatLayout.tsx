import { useRouter } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { Fragment, useEffectEvent, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { ComposerHandleContext, useComposerHandleContext } from "../../composerHandleContext";
import { cn } from "../../lib/utils";
import { CHAT_PANE_ATTRIBUTE, ChatPaneContext, type ChatPane } from "../../splitView/chatPane";
import { splitDropAreaProps } from "../../splitView/splitDrop";
import {
  resolveRoutePaneId,
  splitTargetKey,
  syncSplitRoute,
  titleBarPaneId,
  type SplitPane,
} from "../../splitView/splitViewModel";
import {
  closePane,
  focusPane,
  setPaneWeights,
  updateSplitView,
  useSplitViewStore,
} from "../../splitView/splitViewStore";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { RightPanelLayoutDivider } from "../RightPanelLayoutDivider";
import { ThreadRouteContent } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";

/**
 * Two to four threads side by side or stacked. The route shows the focused pane's thread: routing
 * to a thread another pane shows focuses it, and any other thread replaces the focused pane's.
 */
export function SplitChatLayout({
  routeTarget,
  background,
}: {
  routeTarget: ThreadRouteTarget;
  background: boolean;
}) {
  const { panes, direction, sizes, focusedPaneId } = useSplitViewStore(
    useShallow(({ panes, direction, sizes, focusedPaneId }) => ({
      panes,
      direction,
      sizes,
      focusedPaneId,
    })),
  );
  const routeKey = splitTargetKey(routeTarget);
  const syncRoute = useEffectEvent((key: string | null) => {
    if (key === splitTargetKey(routeTarget)) {
      updateSplitView((state) => syncSplitRoute(state, routeTarget));
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the route is the source of the focused pane's thread; the split store follows each route change
  useLayoutEffect(() => syncRoute(routeKey), [routeKey]);
  const routePaneId = resolveRoutePaneId({ panes, focusedPaneId }, routeKey);
  const titleBarPane = titleBarPaneId({ panes, direction });
  const horizontal = direction === "horizontal";

  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={background}
    >
      <div
        className={cn("flex min-h-0 min-w-0 flex-1", horizontal ? "flex-row" : "flex-col")}
        data-split-view={direction}
      >
        {panes.map((pane, index) => {
          const isRoutePane = pane.id === routePaneId;
          const focused = pane.id === focusedPaneId;
          return (
            <Fragment key={pane.id}>
              {index > 0 ? (
                <RightPanelLayoutDivider
                  orientation={horizontal ? "vertical" : "horizontal"}
                  weights={[sizes[index - 1] ?? 1, sizes[index] ?? 1]}
                  label="Resize split"
                  onCommit={(weights) => setPaneWeights(index - 1, weights)}
                />
              ) : null}
              <SplitPaneView
                pane={pane}
                target={isRoutePane ? routeTarget : pane.target}
                detached={!isRoutePane}
                focused={focused}
                ownsTitleBar={pane.id === titleBarPane}
                touchesTop={horizontal || index === 0}
                touchesLeft={!horizontal || index === 0}
                weight={sizes[index] ?? 1}
                background={background}
              />
            </Fragment>
          );
        })}
      </div>
    </SidebarInset>
  );
}

function SplitPaneView(props: {
  pane: SplitPane;
  target: ThreadRouteTarget | null;
  detached: boolean;
  focused: boolean;
  ownsTitleBar: boolean;
  touchesTop: boolean;
  touchesLeft: boolean;
  weight: number;
  background: boolean;
}) {
  const router = useRouter();
  const composerHandle = useComposerHandleContext();
  const { pane, focused } = props;
  const close = () => closePane(router, pane.id);
  const context: ChatPane = {
    paneId: pane.id,
    focused,
    ownsTitleBar: props.ownsTitleBar,
    close,
  };
  const claimFocus = () => {
    if (!focused) focusPane(router, pane.id);
  };
  const empty = <EmptySplitPane onClose={close} />;
  return (
    <div
      {...{ [CHAT_PANE_ATTRIBUTE]: pane.id }}
      {...splitDropAreaProps(pane.id)}
      data-split-pane-focused={focused ? "true" : "false"}
      data-split-pane-top={props.touchesTop ? "true" : "false"}
      data-split-pane-left={props.touchesLeft ? "true" : "false"}
      data-split-pane-titlebar={props.ownsTitleBar ? "true" : "false"}
      className="relative flex min-h-0 min-w-0 basis-0 flex-col overflow-hidden [contain:layout] @container/split-pane"
      style={{ flexGrow: props.weight }}
      onPointerDownCapture={claimFocus}
      onFocusCapture={claimFocus}
    >
      <ChatPaneContext value={context}>
        <ComposerHandleContext value={focused ? composerHandle : null}>
          {props.target === null ? (
            empty
          ) : (
            <ThreadRouteContent
              target={props.target}
              background={props.background}
              detached={props.detached}
              fallback={empty}
            />
          )}
        </ComposerHandleContext>
      </ChatPaneContext>
    </div>
  );
}

function EmptySplitPane({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      <div className="absolute top-2 right-2">
        <Button variant="ghost" size="icon-sm" aria-label="Close split" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No thread in this split</EmptyTitle>
          <EmptyDescription>Pick a thread in the sidebar or start a new one.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
