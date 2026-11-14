import type { ModelSelection } from "@t3tools/contracts";
import {
  CLAUDE_WORKFLOW_OPTION_IDS,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeCatalogModel,
  resolveClaudeModelSlug,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

export interface ClaudeCompiledSettings {
  readonly alwaysThinkingEnabled?: boolean;
  readonly fastMode?: boolean;
  readonly ultracode?: boolean;
  readonly workflowSizeGuideline?: "unrestricted" | "small" | "medium" | "large";
  readonly env?: Readonly<Record<string, string>>;
}

const CLAUDE_CODE_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  readonly effort: string | undefined;
  readonly promptEffort: string | undefined;
  readonly settings: ClaudeCompiledSettings;
  /** The alias of a custom model named like one, which Claude Code would otherwise expand. */
  readonly pinnedAlias: string | undefined;
  readonly queryIdentity: string;
}

export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
): CompiledClaudeModelSelection {
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({
    caps: capabilities,
    selections: selection.options,
  });
  const supportsBoolean = (id: string) =>
    descriptors.some((descriptor) => descriptor.type === "boolean" && descriptor.id === id);
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const resolvedEffort = resolveClaudeCatalogEffort(catalog, selection.model, rawEffort);
  const effort = normalizeClaudeCatalogEffort(catalog, resolvedEffort, selection.model);
  const fastMode = supportsBoolean("fastMode")
    ? (getModelSelectionBooleanOptionValue(selection, "fastMode") ?? false)
    : undefined;
  const inCatalog = resolveClaudeCatalogModel(catalog, selection.model) !== undefined;
  const thinking =
    !inCatalog || supportsBoolean("thinking")
      ? getModelSelectionBooleanOptionValue(selection, "thinking")
      : undefined;
  const ultracode = descriptors.find((descriptor) => descriptor.id === "ultracode")?.currentValue;
  const [workflowSizeId, workflowModelId, workflowEffortId] = CLAUDE_WORKFLOW_OPTION_IDS;
  const workflowValue = (id: string) => {
    if (ultracode !== true) return undefined;
    const descriptor = descriptors.find((entry) => entry.type === "select" && entry.id === id);
    const value = getModelSelectionStringOptionValue(selection, id);
    return descriptor?.type === "select" &&
      value !== undefined &&
      value !== "auto" &&
      descriptor.options.some((option) => option.id === value)
      ? value
      : undefined;
  };
  const workflowSize = workflowValue(workflowSizeId) as
    | ClaudeCompiledSettings["workflowSizeGuideline"]
    | undefined;
  const workflowModel = workflowValue(workflowModelId);
  const workflowEffort = workflowValue(workflowEffortId);
  const env = {
    ...(workflowModel ? { CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: workflowModel } : {}),
    ...(workflowEffort ? { CLAUDE_CODE_SUBAGENT_EFFORT: workflowEffort } : {}),
  };
  const settings: ClaudeCompiledSettings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    ...(typeof fastMode === "boolean" ? { fastMode } : {}),
    ...(typeof ultracode === "boolean" ? { ultracode } : {}),
    ...(workflowSize ? { workflowSizeGuideline: workflowSize } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  const promptEffort = resolvePromptInjectedEffort(capabilities, rawEffort) ?? undefined;
  // An alias the catalog routes a built-in model to is Claude Code's own and is not pinned.
  const pinnedAlias =
    CLAUDE_CODE_MODEL_ALIASES.has(apiModelId) &&
    resolveClaudeModelSlug(catalog, selection.model) === apiModelId
      ? apiModelId
      : undefined;
  return {
    apiModelId,
    effort,
    promptEffort,
    settings,
    pinnedAlias,
    queryIdentity: JSON.stringify({
      apiModelId,
      effort: effort ?? null,
      settings,
      pinnedAlias: pinnedAlias ?? null,
    }),
  };
}
