import { stripDisplayedPlanMarkdown, proposedPlanTitle } from "@t3tools/shared/proposedPlanText";

export function buildCollapsedProposedPlanPreviewMarkdown(
  planMarkdown: string,
  options?: {
    maxLines?: number;
  },
): string {
  const maxLines = options?.maxLines ?? 8;
  const lines = stripDisplayedPlanMarkdown(planMarkdown)
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const previewLines: string[] = [];
  let visibleLineCount = 0;
  let hasMoreContent = false;

  for (const line of lines) {
    const isVisibleLine = line.trim().length > 0;
    if (isVisibleLine && visibleLineCount >= maxLines) {
      hasMoreContent = true;
      break;
    }
    previewLines.push(line);
    if (isVisibleLine) {
      visibleLineCount += 1;
    }
  }

  while (previewLines.length > 0 && previewLines.at(-1)?.trim().length === 0) {
    previewLines.pop();
  }

  if (previewLines.length === 0) {
    return proposedPlanTitle(planMarkdown) ?? "Plan preview unavailable.";
  }

  if (hasMoreContent) {
    previewLines.push("", "...");
  }

  return previewLines.join("\n");
}

/**
 * The first paragraph after the plan's title as one line of plain text, or null when the plan
 * has none. Headings are skipped and a fenced code block is never a summary.
 */
export function proposedPlanSummary(planMarkdown: string): string | null {
  const paragraph: string[] = [];
  let inFence = false;
  for (const rawLine of stripDisplayedPlanMarkdown(planMarkdown).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      if (paragraph.length > 0) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.length === 0 || /^#{1,6}\s/.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  const summary = paragraph
    .join(" ")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*`]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return summary.length > 0 ? summary : null;
}

function sanitizePlanFileSegment(input: string): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "plan";
}

/** Prefix of the message the app sends when the user approves a plan. */
export const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

/** Prefix of the message that has the main agent delegate the plan to a subagent and review it. */
export const PLAN_SUBAGENT_BUILD_PROMPT_PREFIX = "BUILD THIS PLAN WITH A T3 SUBAGENT:\n";

/**
 * Prepended to a message sent in plan-first mode, for providers without a native plan mode.
 * The user's own text follows it, so prompt history recalls only that part.
 */
export const PLAN_FIRST_PROMPT_PREFIX =
  "Plan this first. Investigate read-only, do not edit files, and deliver the plan by calling the T3 `create_plan` tool; then stop.\n\n";

export function buildPlanFirstPrompt(userText: string): string {
  return `${PLAN_FIRST_PROMPT_PREFIX}${userText}`;
}

/** The user's text from a plan-first message, or the text itself when it is not one. */
export function stripPlanFirstPrompt(text: string): string {
  return text.startsWith(PLAN_FIRST_PROMPT_PREFIX)
    ? text.slice(PLAN_FIRST_PROMPT_PREFIX.length)
    : text;
}

export type AppComposedPlanMessage =
  | { kind: "build"; planTitle: string | null }
  | {
      kind: "subagent";
      planTitle: string | null;
      /** The subagent's model as written into the prompt, when it can be read back. */
      target: { providerInstanceId: string; model: string } | null;
    }
  | { kind: "plan-first"; userText: string; instruction: string };

/** Reads back which app-composed plan message `text` is, or null for any other message. */
export function parseAppComposedPlanMessage(text: string): AppComposedPlanMessage | null {
  if (text.startsWith(PLAN_IMPLEMENTATION_PROMPT_PREFIX)) {
    return {
      kind: "build",
      planTitle: proposedPlanTitle(text.slice(PLAN_IMPLEMENTATION_PROMPT_PREFIX.length)),
    };
  }
  if (text.startsWith(PLAN_SUBAGENT_BUILD_PROMPT_PREFIX)) {
    const target = /target providerInstanceId "([^"]*)" and model "([^"]*)"/.exec(text);
    const planStart = text.indexOf("\nPlan:\n");
    return {
      kind: "subagent",
      planTitle: planStart === -1 ? null : proposedPlanTitle(text.slice(planStart + 7)),
      target: target ? { providerInstanceId: target[1]!, model: target[2]! } : null,
    };
  }
  if (text.startsWith(PLAN_FIRST_PROMPT_PREFIX)) {
    return {
      kind: "plan-first",
      userText: text.slice(PLAN_FIRST_PROMPT_PREFIX.length),
      instruction: PLAN_FIRST_PROMPT_PREFIX.trim(),
    };
  }
  return null;
}

/** App-composed plan messages, which are not text the user typed. */
export function isPlanImplementationPrompt(text: string): boolean {
  return (
    text.startsWith(PLAN_IMPLEMENTATION_PROMPT_PREFIX) ||
    text.startsWith(PLAN_SUBAGENT_BUILD_PROMPT_PREFIX)
  );
}

/**
 * Asks the main agent to hand the plan to a subagent on `target` through `delegate_task`, then
 * review the result. Target field names are the `OrchestratorMcpTarget` ones.
 */
export function buildPlanSubagentBuildPrompt(input: {
  planMarkdown: string;
  target: {
    providerInstanceId: string;
    model: string;
    options?: ReadonlyArray<{ id: string; value: string | boolean }> | undefined;
  };
}): string {
  const { providerInstanceId, model, options } = input.target;
  const optionsClause =
    options && options.length > 0
      ? `, options ${JSON.stringify(options.map(({ id, value }) => ({ id, value })))}`
      : "";
  return [
    PLAN_SUBAGENT_BUILD_PROMPT_PREFIX +
      "Delegate the implementation of the plan below to a T3 subagent. Call the T3 `delegate_task` tool once with:",
    "- the full plan as the task, self-contained, telling the subagent to implement it fully and not edit the plan;",
    `- target providerInstanceId "${providerInstanceId}" and model "${model}"${optionsClause};`,
    '- mode "async" and the default (shared) isolation.',
    "",
    "Do not implement anything yourself, and end your turn after delegating.",
    "When the subagent's completion notification arrives, review its work against the plan: read the diff and run the relevant focused checks. Do not fix anything.",
    "Then reply to the user that the build is done, with a short summary of what changed and your review verdict: what matches the plan and anything missing or wrong.",
    "",
    "Plan:",
    input.planMarkdown.trim(),
  ].join("\n");
}

export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `${PLAN_IMPLEMENTATION_PROMPT_PREFIX}${planMarkdown.trim()}`;
}

export function resolvePlanFollowUpSubmission(input: { draftText: string; planMarkdown: string }): {
  text: string;
  interactionMode: "default" | "plan";
} {
  const trimmedDraftText = input.draftText.trim();
  if (trimmedDraftText.length > 0) {
    return {
      text: trimmedDraftText,
      interactionMode: "plan",
    };
  }

  return {
    text: buildPlanImplementationPrompt(input.planMarkdown),
    interactionMode: "default",
  };
}

export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown);
  if (!title) {
    return "Implement plan";
  }
  return `Implement ${title}`;
}

export function buildProposedPlanMarkdownFilename(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown);
  return `${sanitizePlanFileSegment(title ?? "plan")}.md`;
}

export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trimEnd()}\n`;
}

export function downloadPlanAsTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
