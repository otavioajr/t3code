import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectableChoices } from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  // regression: #21406 bring model controls in line with web
  it("leaves out prompt-injected choices and keeps declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("prompt-controlled reasoning", () => {
  it("removes the prefix when choosing a regular effort and keeps Ultracode as a separate option", () => {
    const ultracodeDescriptor: ProviderOptionDescriptor = {
      id: "ultracode",
      type: "boolean",
      label: "Ultracode",
      currentValue: true,
    };
    const descriptors = [effortDescriptor, ultracodeDescriptor];
    const prompt = "Ultrathink:\nsolve it";
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "high",
      ),
    ).toEqual({
      prompt: "solve it",
      modelOptions: [
        { id: "effort", value: "high" },
        { id: "ultracode", value: true },
      ],
    });
  });

  it("keeps body-controlled Ultrathink locked", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
  });
});
