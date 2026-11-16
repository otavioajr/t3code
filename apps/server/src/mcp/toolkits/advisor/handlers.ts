import { type ModelSelection, OrchestratorMcpFailure } from "@t3tools/contracts";
import type { ServerSettings as ServerSettingsValue } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ServerSettings from "../../../serverSettings.ts";
import * as TextGeneration from "../../../textGeneration/TextGeneration.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { AdvisorToolkit } from "./tools.ts";

const resolveAdvisorModelSelection = (
  thread: { readonly advisorModelSelection?: ModelSelection | null | undefined } | undefined,
  settings: Pick<ServerSettingsValue, "advisorModelSelection" | "textGenerationModelSelection">,
): ModelSelection =>
  thread?.advisorModelSelection ??
  settings.advisorModelSelection ??
  settings.textGenerationModelSelection;

const unavailable = (message: string) =>
  new OrchestratorMcpFailure({ code: "provider_unavailable", message });

const handlers = {
  consult_advisor: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      const settings = yield* ServerSettings.ServerSettingsService.pipe(
        Effect.flatMap((service) => service.getSettings),
        Effect.mapError(() => unavailable("Could not read the advisor settings.")),
      );
      const modelSelection = resolveAdvisorModelSelection(caller, settings);
      // The advisor reasons over what the agent sent; it must not read a checkout.
      const cwd = yield* FileSystem.FileSystem.pipe(
        Effect.flatMap((fileSystem) =>
          fileSystem.makeTempDirectoryScoped({ prefix: "t3-advisor-" }),
        ),
        Effect.mapError(() => unavailable("Could not prepare the advisor.")),
      );
      const textGeneration = yield* TextGeneration.TextGeneration;
      const { advice } = yield* textGeneration
        .generateAdvice({
          cwd,
          projectId: caller?.projectId ?? null,
          question: input.question,
          context: input.context,
          modelSelection,
        })
        .pipe(Effect.mapError((error) => unavailable(`The advisor failed: ${error.message}`)));
      return { advice, model: modelSelection.model };
    }).pipe(Effect.scoped),
  ),
} satisfies McpToolAccess.Handlers<typeof AdvisorToolkit.tools>;

export const layer = McpToolAccess.toLayer(AdvisorToolkit, handlers);
