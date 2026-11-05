import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";

const selection = (
  model: string,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("compiles context, effort, and settings together", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-4-6", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-opus-4-6[1m]",
      effort: "max",
      settings: { fastMode: true },
    });
  });

  it.each([
    [
      "explicit boolean",
      [
        { id: "effort", value: "high" },
        { id: "ultracode", value: true },
      ],
      "high",
      true,
    ],
    ["legacy effort", [{ id: "effort", value: "ultracode" }], "xhigh", true],
    [
      "boolean wins over legacy",
      [
        { id: "effort", value: "ultracode" },
        { id: "ultracode", value: false },
      ],
      "xhigh",
      false,
    ],
    [
      "off",
      [
        { id: "effort", value: "high" },
        { id: "ultracode", value: false },
      ],
      "high",
      false,
    ],
    ["absent", [{ id: "effort", value: "high" }], "high", false],
  ])("compiles ultracode (%s)", (_name, options, effort, on) => {
    const compiled = compileClaudeModelSelection(selection("claude-opus-4-8", options));
    expect(compiled.effort).toBe(effort);
    expect(compiled.settings.ultracode).toBe(on || undefined);
  });

  it.each([
    [
      "on with values",
      [
        { id: "ultracode", value: true },
        { id: "workflowSize", value: "small" },
        { id: "workflowModel", value: "sonnet" },
        { id: "workflowEffort", value: "high" },
      ],
      {
        fastMode: false,
        ultracode: true,
        workflowSizeGuideline: "small",
        env: { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_EFFORT: "high" },
      },
    ],
    [
      "off with values",
      [
        { id: "ultracode", value: false },
        { id: "workflowSize", value: "small" },
        { id: "workflowModel", value: "sonnet" },
      ],
      { fastMode: false },
    ],
    [
      "auto",
      [
        { id: "ultracode", value: true },
        { id: "workflowSize", value: "auto" },
        { id: "workflowModel", value: "auto" },
        { id: "workflowEffort", value: "auto" },
      ],
      { fastMode: false, ultracode: true },
    ],
    [
      "invalid",
      [
        { id: "ultracode", value: true },
        { id: "workflowSize", value: "huge" },
        { id: "workflowModel", value: "gpt" },
      ],
      { fastMode: false, ultracode: true },
    ],
  ])("compiles workflow options (%s)", (_name, options, settings) => {
    const compiled = compileClaudeModelSelection(selection("claude-opus-4-8", options));
    expect(compiled.settings).toEqual(settings);
    const baseline = compileClaudeModelSelection(
      selection("claude-opus-4-8", [{ id: "ultracode", value: true }]),
    ).queryIdentity;
    if (compiled.settings.env || compiled.settings.workflowSizeGuideline) {
      expect(compiled.queryIdentity).not.toBe(baseline);
    } else if (compiled.settings.ultracode) {
      expect(compiled.queryIdentity).toBe(baseline);
    }
  });

  it("uses the model default SDK effort alongside prompt-injected effort", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-sonnet-4-6", [{ id: "effort", value: "ultrathink" }]),
      ),
    ).toMatchObject({ effort: "high", promptEffort: "ultrathink" });
  });

  it("keeps explicit effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "max" }]),
      ).effort,
    ).toBe("max");
    expect(
      compileClaudeModelSelection(selection("claude-pool-model-not-in-catalog", [])).effort,
    ).toBeUndefined();
  });
});
