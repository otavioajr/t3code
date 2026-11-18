import { describe, expect, it } from "vite-plus/test";

import { ADDRESS_BAR_MAX_SUGGESTIONS, mergeAddressBarSuggestions } from "./addressBarSuggestions";

const project = (url: string, title?: string) => ({
  url,
  lastVisitedAt: 1,
  ...(title ? { title } : {}),
});
const chrome = (url: string, title?: string) => ({
  url,
  lastVisitedAt: 1,
  visitCount: 1,
  ...(title ? { title } : {}),
});

describe("mergeAddressBarSuggestions", () => {
  it("lists project history first, matches url or title case-insensitively, and drops blanks", () => {
    const merged = mergeAddressBarSuggestions({
      query: "  DOCS ",
      projectEntries: [
        project("http://localhost:3000/"),
        project("http://localhost:3000/docs"),
        project("http://localhost:3000/other", "Project Docs"),
      ],
      chromeSuggestions: [chrome("https://example.test/guide", "Docs guide")],
    });
    expect(merged).toEqual([
      { url: "http://localhost:3000/docs", source: "project" },
      { url: "http://localhost:3000/other", title: "Project Docs", source: "project" },
      { url: "https://example.test/guide", title: "Docs guide", source: "chrome" },
    ]);
    expect(
      mergeAddressBarSuggestions({
        query: "   ",
        projectEntries: [project("http://localhost:3000/")],
        chromeSuggestions: [],
      }),
    ).toEqual([]);
  });

  it("keeps the project entry when Chrome knows the same page", () => {
    const merged = mergeAddressBarSuggestions({
      query: "example",
      projectEntries: [project("https://example.test/path/", "Mine")],
      chromeSuggestions: [
        chrome("https://example.test/path#section", "Theirs"),
        chrome("https://example.test/path?q=1"),
      ],
    });
    expect(merged).toEqual([
      { url: "https://example.test/path/", title: "Mine", source: "project" },
      { url: "https://example.test/path?q=1", source: "chrome" },
    ]);
  });

  it("caps the list", () => {
    const merged = mergeAddressBarSuggestions({
      query: "page",
      projectEntries: Array.from({ length: 6 }, (_, i) => project(`https://a.test/page${i}`)),
      chromeSuggestions: Array.from({ length: 6 }, (_, i) => chrome(`https://b.test/page${i}`)),
    });
    expect(merged).toHaveLength(ADDRESS_BAR_MAX_SUGGESTIONS);
    expect(merged.filter((item) => item.source === "chrome")).toHaveLength(2);
  });
});
