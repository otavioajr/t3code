import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanImplementationPrompt,
  buildPlanFirstPrompt,
  buildPlanSubagentBuildPrompt,
  parseAppComposedPlanMessage,
  stripPlanFirstPrompt,
  isPlanImplementationPrompt,
  proposedPlanSummary,
  resolvePlanFollowUpSubmission,
} from "./proposedPlan";

describe("resolvePlanFollowUpSubmission", () => {
  it.each(["", "Consider this "])(
    "keeps context-bearing feedback in plan mode with prose %j",
    (prose) => {
      const draftText = `${prose}[PR #42](t3-context://v1/review-comment/pr-42)`;
      expect(resolvePlanFollowUpSubmission({ draftText, planMarkdown: "# Plan" })).toEqual({
        text: draftText,
        interactionMode: "plan",
      });
    },
  );
  it("switches to default mode when implementing the ready plan without extra text", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "   ",
        planMarkdown: "## Ship it\n\n- step 1\n",
      }),
    ).toEqual({
      text: "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
      interactionMode: "default",
    });
  });
});

describe("proposedPlanSummary", () => {
  it("takes the first paragraph after the title as plain text on one line", () => {
    expect(
      proposedPlanSummary(
        "# Ship it\n\nAdd the **cache** layer to\n[the API](https://x.dev) with `ttl`.\n\n## Steps\n\n- one",
      ),
    ).toBe("Add the cache layer to the API with ttl.");
  });

  it("skips headings and code fences, and is null when nothing is prose", () => {
    expect(proposedPlanSummary("# T\n\n## Steps\n\n```ts\nconst a = 1;\n```\n\nThen ship.")).toBe(
      "Then ship.",
    );
    expect(proposedPlanSummary("# T\n\n## Only headings")).toBeNull();
  });
});

describe("buildPlanSubagentBuildPrompt", () => {
  const planMarkdown = "# Ship it\n\n- step 1\n";

  it("names the delegate_task target verbatim and ends with the trimmed plan", () => {
    const prompt = buildPlanSubagentBuildPrompt({
      planMarkdown,
      target: {
        providerInstanceId: "codex",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    });
    expect(prompt).toContain('providerInstanceId "codex" and model "gpt-5.4"');
    expect(prompt).toContain('options [{"id":"reasoningEffort","value":"high"}]');
    expect(prompt).toContain('mode "async"');
    expect(prompt.endsWith("Plan:\n# Ship it\n\n- step 1")).toBe(true);
    expect(isPlanImplementationPrompt(prompt)).toBe(true);
  });

  it("omits options when the target has none", () => {
    const prompt = buildPlanSubagentBuildPrompt({
      planMarkdown,
      target: { providerInstanceId: "codex", model: "gpt-5.4" },
    });
    expect(prompt).not.toContain("options");
  });
});

describe("plan-first prompt", () => {
  it("prepends the instruction and strips it back to the user's text", () => {
    const prompt = buildPlanFirstPrompt("Add a cache");
    expect(prompt.startsWith("Plan this first.")).toBe(true);
    expect(prompt).toContain("`create_plan`");
    expect(prompt.endsWith("\n\nAdd a cache")).toBe(true);
    expect(stripPlanFirstPrompt(prompt)).toBe("Add a cache");
    expect(stripPlanFirstPrompt("Add a cache")).toBe("Add a cache");
  });
});

describe("parseAppComposedPlanMessage", () => {
  it("reads back a build message with the plan title", () => {
    expect(
      parseAppComposedPlanMessage(buildPlanImplementationPrompt("# Ship it\n\n- step")),
    ).toEqual({ kind: "build", planTitle: "Ship it" });
  });

  it("reads back the subagent target and plan title", () => {
    const prompt = buildPlanSubagentBuildPrompt({
      planMarkdown: "# Ship it\n\nBody",
      target: { providerInstanceId: "grok", model: "grok-4" },
    });
    expect(parseAppComposedPlanMessage(prompt)).toEqual({
      kind: "subagent",
      planTitle: "Ship it",
      target: { providerInstanceId: "grok", model: "grok-4" },
    });
  });

  it("splits a plan-first message and ignores ordinary text", () => {
    expect(parseAppComposedPlanMessage(buildPlanFirstPrompt("Add a cache"))).toMatchObject({
      kind: "plan-first",
      userText: "Add a cache",
    });
    expect(parseAppComposedPlanMessage("Please implement this")).toBeNull();
  });
});
