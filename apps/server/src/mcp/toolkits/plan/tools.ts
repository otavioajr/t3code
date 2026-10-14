import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { CREATE_PLAN_TOOL_NAME, CreatePlanInput } from "@t3tools/shared/createPlan";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Read-only in the MCP sense: it shows a plan in the caller's own thread and
// touches no workspace, so plan mode and read-only sandboxes can use it.
const CreatePlanTool = Tool.make(CREATE_PLAN_TOOL_NAME, {
  description:
    "Use this whenever the user wants to plan before implementing (plan, design, or think through an approach, in any language) or asks for a plan; never write a plan as a chat message instead. Investigate read-only and do not edit files, then call this once with a concise plan: goal, files involved, steps, risks, and how to verify. It shows the plan to the user for review. After calling it, stop and reply in a sentence or two; the user reviews the plan and starts the build.",
  parameters: CreatePlanInput,
  success: Schema.Struct({ message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Create plan")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const PlanToolkit = Toolkit.make(CreatePlanTool);
