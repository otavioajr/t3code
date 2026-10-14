import { describe, expect, it } from "vite-plus/test";

import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  buildPlanFirstPrompt,
  buildPlanSubagentBuildPrompt,
  parseAppComposedPlanMessage,
  stripPlanFirstPrompt,
  buildProposedPlanMarkdownFilename,
  isPlanImplementationPrompt,
  proposedPlanSummary,
  resolvePlanFollowUpSubmission,
} from "./proposedPlan";

describe("buildPlanImplementationPrompt", () => {
  it("formats the plan exactly like the Codex follow-up handoff prompt", () => {
    expect(buildPlanImplementationPrompt("## Ship it\n\n- step 1\n")).toBe(
      "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
    );
  });
});

describe("buildCollapsedProposedPlanPreviewMarkdown", () => {
  it("drops the redundant title heading and preserves the following markdown lines", () => {
    expect(
      buildCollapsedProposedPlanPreviewMarkdown(
        "# Integrate RPC\n\n## Summary\n\n- step 1\n- step 2",
        {
          maxLines: 4,
        },
      ),
    ).toBe("- step 1\n- step 2");
  });

  it("appends an overflow marker when the preview truncates remaining content", () => {
    expect(
      buildCollapsedProposedPlanPreviewMarkdown("# Integrate RPC\n\n- step 1\n- step 2\n- step 3", {
        maxLines: 2,
      }),
    ).toBe("- step 1\n- step 2\n\n...");
  });
});

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

  it("stays in plan mode when the user adds a follow-up prompt", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "Refine step 2 first",
        planMarkdown: "## Ship it\n\n- step 1\n",
      }),
    ).toEqual({
      text: "Refine step 2 first",
      interactionMode: "plan",
    });
  });
});

describe("buildPlanImplementationThreadTitle", () => {
  it("uses the plan heading when building the implementation thread title", () => {
    expect(buildPlanImplementationThreadTitle("# Integrate RPC\n\nBody")).toBe(
      "Implement Integrate RPC",
    );
  });

  it("falls back when the plan has no markdown heading", () => {
    expect(buildPlanImplementationThreadTitle("- step 1")).toBe("Implement plan");
  });
});

describe("buildProposedPlanMarkdownFilename", () => {
  it("derives a stable markdown filename from the plan heading", () => {
    expect(buildProposedPlanMarkdownFilename("# Integrate Effect RPC Into Server App")).toBe(
      "integrate-effect-rpc-into-server-app.md",
    );
  });

  it("falls back to a generic filename when the plan has no heading", () => {
    expect(buildProposedPlanMarkdownFilename("- step 1")).toBe("plan.md");
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
