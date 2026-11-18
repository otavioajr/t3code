import type { BrowserHistorySuggestion } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import { useClientSettings } from "~/hooks/useSettings";

import {
  ADDRESS_BAR_CHROME_DEBOUNCE_MS,
  matchesAddressBarQuery,
  mergeAddressBarSuggestions,
} from "./addressBarSuggestions";
import { previewBridge } from "./previewBridge";

const NO_SUGGESTIONS: ReadonlyArray<BrowserHistorySuggestion> = [];

/**
 * Project history answers instantly. Chrome history is only asked for on desktop, when the
 * user picked a profile in Settings, and only while the address bar is being edited.
 */
export function useAddressBarSuggestions(input: {
  readonly query: string;
  readonly active: boolean;
  readonly projectEntries: ReadonlyArray<BrowserHistoryEntry>;
}) {
  const source = useClientSettings((settings) => settings.browserHistorySuggestionSource);
  const query = input.query.trim();
  const [chrome, setChrome] = useState(NO_SUGGESTIONS);
  const chromeEnabled =
    input.active && query.length > 0 && source !== null && previewBridge !== null;
  const sourceId = source?.sourceId;
  const sourceProfileDirectory = source?.sourceProfileDirectory;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- queries the desktop bridge, outside React, with debounce and stale-response cancellation
  useEffect(() => {
    const bridge = previewBridge;
    if (!chromeEnabled || !bridge || !sourceId || !sourceProfileDirectory) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      bridge
        .searchBrowserHistory({ sourceId, sourceProfileDirectory, query })
        .then(
          (results) => results,
          () => NO_SUGGESTIONS,
        )
        .then((results) => {
          if (!cancelled) setChrome(results);
        });
    }, ADDRESS_BAR_CHROME_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chromeEnabled, query, sourceId, sourceProfileDirectory]);

  return mergeAddressBarSuggestions({
    query,
    projectEntries: input.projectEntries,
    // Results for the previous keystroke stay until the next arrive, minus what no longer matches.
    chromeSuggestions: chromeEnabled
      ? chrome.filter((suggestion) => matchesAddressBarQuery(query, suggestion))
      : NO_SUGGESTIONS,
  });
}
