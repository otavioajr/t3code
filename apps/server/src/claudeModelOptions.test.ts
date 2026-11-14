import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  scopeClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

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

  it("runs Ultracode at the chosen effort and reads the old Ultracode effort as xhigh", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-5-5", [
          { id: "effort", value: "high" },
          { id: "ultracode", value: true },
        ]),
      ),
    ).toMatchObject({ effort: "high", settings: { ultracode: true } });
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-5-5", [{ id: "effort", value: "ultracode" }]),
      ),
    ).toMatchObject({ effort: "xhigh", settings: { ultracode: true } });
    const legacyTurnedOff = compileClaudeModelSelection(
      selection("claude-opus-5-5", [
        { id: "effort", value: "ultracode" },
        { id: "ultracode", value: false },
      ]),
    );
    expect(legacyTurnedOff.effort).toBe("xhigh");
    expect(legacyTurnedOff.settings.ultracode).toBe(false);
    expect(
      compileClaudeModelSelection(selection("claude-opus-5-5", [{ id: "effort", value: "high" }]))
        .settings,
    ).not.toHaveProperty("ultracode");
  });

  it("keeps old Ultracode defaults and selections at Extra High on custom models", () => {
    const customModel = (slug: string, choices: ReadonlyArray<string>) => ({
      slug,
      name: slug,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select" as const,
            currentValue: "ultracode",
            options: choices.map((id) => ({ id, label: id, isDefault: id === "ultracode" })),
          },
        ],
      },
    });
    const catalog = scopeClaudeModelCatalog(BUNDLED_CLAUDE_MODEL_CATALOG, [
      customModel("claude-custom-tuned", ["high", "xhigh", "ultracode"]),
      customModel("claude-custom-no-xhigh", ["high", "ultracode"]),
    ]);

    for (const model of ["claude-custom-tuned", "claude-custom-no-xhigh"]) {
      expect(compileClaudeModelSelection(selection(model, []), catalog)).toMatchObject({
        effort: "xhigh",
        settings: { ultracode: true },
      });
      expect(
        compileClaudeModelSelection(
          selection(model, [{ id: "effort", value: "ultracode" }]),
          catalog,
        ),
      ).toMatchObject({ effort: "xhigh", settings: { ultracode: true } });
    }
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
      { fastMode: false, ultracode: false },
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

  it("ignores thinking for catalog models without a thinking option", () => {
    expect(
      compileClaudeModelSelection(selection("claude-opus-5-5", [{ id: "thinking", value: false }]))
        .settings,
    ).not.toHaveProperty("alwaysThinkingEnabled");
  });

  it.each(["gateway-route", "gateway-route[1m]"])(
    "keeps explicit effort and thinking for %s outside the local catalog",
    (model) => {
      for (const thinking of [true, false]) {
        expect(
          compileClaudeModelSelection(
            selection(model, [
              { id: "effort", value: "max" },
              { id: "thinking", value: thinking },
            ]),
          ),
        ).toMatchObject({
          apiModelId: model,
          effort: "max",
          settings: { alwaysThinkingEnabled: thinking },
        });
      }
      const unconfigured = compileClaudeModelSelection(selection(model, []));
      expect(unconfigured.effort).toBeUndefined();
      expect(unconfigured.settings).toEqual({});
    },
  );
});
