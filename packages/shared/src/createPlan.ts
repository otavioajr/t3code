import * as Schema from "effect/Schema";

/**
 * `create_plan` is the T3 MCP tool an agent calls to show a plan for review
 * instead of editing files. A completed call becomes a proposed plan in the
 * thread, so the tool's arguments are shared by the MCP toolkit that declares
 * it and the provider event ingestor that turns the call into the plan.
 */

export const CREATE_PLAN_TOOL_NAME = "create_plan";
export const CREATE_PLAN_MAX_TITLE_LENGTH = 200;
export const CREATE_PLAN_MAX_MARKDOWN_LENGTH = 200_000;

export const CreatePlanInput = Schema.Struct({
  title: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CREATE_PLAN_MAX_TITLE_LENGTH),
  ).annotate({ description: "Short name for the plan." }),
  markdown: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CREATE_PLAN_MAX_MARKDOWN_LENGTH),
  ).annotate({
    description: "The full plan as markdown, starting with a `# Title` heading.",
  }),
});
export type CreatePlanInput = typeof CreatePlanInput.Type;
