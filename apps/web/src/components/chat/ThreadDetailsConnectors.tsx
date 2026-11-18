import type { OrchestrationV2ProviderMcpServer } from "@t3tools/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadDetailsDisclosure } from "./ThreadDetailsUsage";

const STATUS: Record<
  OrchestrationV2ProviderMcpServer["status"],
  { readonly label: string; readonly dot: string }
> = {
  connected: { label: "Connected", dot: "bg-success" },
  pending: { label: "Connecting", dot: "bg-muted-foreground/60" },
  needs_auth: { label: "Needs auth", dot: "bg-warning" },
  failed: { label: "Failed", dot: "bg-error" },
  disabled: { label: "Disabled", dot: "bg-muted-foreground/30" },
};

/** MCP servers the thread's provider session reported. Hidden when it reports none. */
export function ThreadDetailsConnectors({
  servers,
}: {
  readonly servers: ReadonlyArray<OrchestrationV2ProviderMcpServer>;
}) {
  const [open, setOpen] = useState(false);
  if (servers.length === 0) return null;
  const connected = servers.filter((server) => server.status === "connected").length;
  const attention = servers.some(
    (server) => server.status === "failed" || server.status === "needs_auth",
  );
  return (
    <ThreadDetailsSection
      headingId="thread-details-connectors-heading"
      title="Connectors"
      showHeading={false}
    >
      <div>
        <ThreadDetailsDisclosure
          label="Connectors"
          value={`Connected: ${connected}`}
          tone={attention ? "warning" : null}
          open={open}
          onOpenChange={setOpen}
        />
        {open ? (
          <ul className="m-0 list-none p-0 text-xs">
            {servers.map((server) => (
              <li key={server.name} className="flex h-6 min-w-0 items-center gap-2 px-2.5">
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", STATUS[server.status].dot)}
                />
                <span className="min-w-0 flex-1 truncate text-foreground/80">{server.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {STATUS[server.status].label}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
