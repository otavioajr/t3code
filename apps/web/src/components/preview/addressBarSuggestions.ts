import type { BrowserHistorySuggestion } from "@t3tools/contracts";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";

export const ADDRESS_BAR_MAX_SUGGESTIONS = 8;
export const ADDRESS_BAR_CHROME_DEBOUNCE_MS = 120;

export interface AddressBarSuggestion {
  readonly url: string;
  readonly title?: string;
  readonly source: "project" | "chrome";
}

type Candidate = { readonly url: string; readonly title?: string | undefined };

/** Ignores the fragment, credentials, and a trailing slash so one page is not suggested twice. */
function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : "";
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

export function matchesAddressBarQuery(query: string, candidate: Candidate): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return false;
  return (
    candidate.url.toLowerCase().includes(needle) ||
    (candidate.title?.toLowerCase().includes(needle) ?? false)
  );
}

/** The project's own history leads; Chrome fills the remaining slots. */
export function mergeAddressBarSuggestions(input: {
  readonly query: string;
  readonly projectEntries: ReadonlyArray<BrowserHistoryEntry>;
  readonly chromeSuggestions: ReadonlyArray<BrowserHistorySuggestion>;
  readonly limit?: number;
}): ReadonlyArray<AddressBarSuggestion> {
  const limit = input.limit ?? ADDRESS_BAR_MAX_SUGGESTIONS;
  const seen = new Set<string>();
  const merged: Array<AddressBarSuggestion> = [];
  const add = (source: AddressBarSuggestion["source"], candidate: Candidate) => {
    if (merged.length >= limit || !matchesAddressBarQuery(input.query, candidate)) return;
    const key = dedupeKey(candidate.url);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      url: candidate.url,
      ...(candidate.title ? { title: candidate.title } : {}),
      source,
    });
  };
  for (const entry of input.projectEntries) add("project", entry);
  for (const suggestion of input.chromeSuggestions) add("chrome", suggestion);
  return merged;
}
