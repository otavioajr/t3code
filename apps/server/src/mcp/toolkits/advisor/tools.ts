import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ADVICE_CONTEXT_MAX_CHARS,
  ADVICE_QUESTION_MAX_CHARS,
} from "@t3tools/provider-core/server/textGenerationPrompts";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as TextGeneration from "../../../textGeneration/TextGeneration.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CONSULT_ADVISOR_TOOL_NAME = "consult_advisor";

const ConsultAdvisorTool = Tool.make(CONSULT_ADVISOR_TOOL_NAME, {
  description:
    "Ask the advisor, a separate model the user chose, for a second opinion. Call it only when T3 Code's instructions or the user's message ask you to. The advisor sees nothing but what you send and cannot use tools, so include the goal, what you found, the options you weigh, and relevant code or errors. Weigh its advice; it does not replace your judgment.",
  parameters: Schema.Struct({
    question: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(ADVICE_QUESTION_MAX_CHARS),
    ).annotate({ description: "What you want the advisor's judgment on." }),
    context: Schema.optional(
      Schema.String.check(Schema.isMaxLength(ADVICE_CONTEXT_MAX_CHARS)).annotate({
        description: "Goal, findings, options, and relevant code or errors.",
      }),
    ),
  }),
  success: Schema.Struct({ advice: Schema.String, model: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerSettings.ServerSettingsService,
    TextGeneration.TextGeneration,
    FileSystem.FileSystem,
  ],
})
  .annotate(Tool.Title, "Consult advisor")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const AdvisorToolkit = Toolkit.make(ConsultAdvisorTool);
