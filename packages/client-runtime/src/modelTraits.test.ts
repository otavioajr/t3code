import { ProviderDriverKind, type ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildTraitsTriggerDisplay, getDisplayedProviderOptionDescriptors } from "./modelTraits.ts";

const descriptors = (ultracode: boolean): ReadonlyArray<ProviderOptionDescriptor> => [
  {
    id: "effort",
    label: "Effort",
    type: "select",
    options: [{ id: "high", label: "High", isDefault: true }],
    currentValue: "high",
  },
  { id: "ultracode", label: "Ultracode", type: "boolean", currentValue: ultracode },
  {
    id: "workflowSize",
    label: "Workflow size",
    type: "select",
    options: [
      { id: "auto", label: "Automatic", isDefault: true },
      { id: "small", label: "Small" },
    ],
    currentValue: "small",
  },
];

describe("workflow options", () => {
  it("are displayed only while Ultracode is on", () => {
    const ids = (on: boolean) =>
      getDisplayedProviderOptionDescriptors(descriptors(on)).map((descriptor) => descriptor.id);
    expect(ids(false)).toEqual(["effort", "ultracode"]);
    expect(ids(true)).toEqual(["effort", "ultracode", "workflowSize"]);
  });

  it("stay out of the trigger label", () => {
    const display = buildTraitsTriggerDisplay({
      provider: ProviderDriverKind.make("claudeAgent"),
      descriptors: descriptors(true),
      primarySelectDescriptorId: "effort",
      ultrathinkPromptControlled: false,
    });
    expect(display.label).toBe("High · Ultracode");
  });
});
