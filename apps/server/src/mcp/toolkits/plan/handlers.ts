import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { PlanToolkit } from "./tools.ts";

const handlers = {
  // The plan itself becomes a proposed plan when the provider event ingestor
  // sees this tool call complete; the handler only checks the call is a thread's
  // own and tells the agent to stop. It reads nothing and changes nothing
  // (readsAsCaller), so it works while the thread's run is read-only.
  create_plan: McpToolAccess.readsAsCaller(() =>
    Effect.succeed({
      message: "Plan shown to the user for review. Stop here; do not start implementing.",
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PlanToolkit.tools>;

export const layer = McpToolAccess.toLayer(PlanToolkit, handlers);
