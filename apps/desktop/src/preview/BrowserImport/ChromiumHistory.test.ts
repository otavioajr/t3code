import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import { escapeLikePattern, makeChromiumHistorySearcher } from "./ChromiumHistory.ts";

interface HistoryFixtureRow {
  readonly url: string;
  readonly title?: string;
  readonly visitCount: number;
  /** Unix milliseconds; stored as Chromium's microseconds since 1601. */
  readonly visitedAt: number;
  readonly hidden?: number;
}

const insertRows = Effect.fnUntraced(function* (rows: ReadonlyArray<HistoryFixtureRow>) {
  const sql = yield* SqlClient.SqlClient;
  for (const row of rows) {
    yield* sql`insert into urls (url, title, visit_count, last_visit_time, hidden)
      values (${row.url}, ${row.title ?? ""}, ${row.visitCount},
        (${row.visitedAt} + 11644473600000) * 1000, ${row.hidden ?? 0})`;
  }
});

const makeHistoryDatabase = Effect.fnUntraced(function* (rows: ReadonlyArray<HistoryFixtureRow>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-history-source-" });
  const source = path.join(directory, "History");
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`create table urls (id integer primary key autoincrement, url longvarchar,
      title longvarchar, visit_count integer default 0 not null,
      last_visit_time integer not null, hidden integer default 0 not null)`;
    yield* insertRows(rows);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
  return source;
});

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) => effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLikePattern("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});

describe("ChromiumHistory search", () => {
  it.effect("converts Chromium's 1601-epoch microseconds to Unix milliseconds", () =>
    runNode(
      Effect.gen(function* () {
        const visitedAt = Date.UTC(2026, 0, 2, 3, 4, 5);
        const source = yield* makeHistoryDatabase([
          { url: "https://example.test/docs", title: "Docs", visitCount: 3, visitedAt },
        ]);
        const searcher = yield* makeChromiumHistorySearcher;
        const results = yield* searcher.search(source, "example");
        expect(results).toEqual([
          {
            url: "https://example.test/docs",
            title: "Docs",
            lastVisitedAt: visitedAt,
            visitCount: 3,
          },
        ]);
      }),
    ),
  );

  it.effect("matches % and _ literally, and ranks by visit count then recency", () =>
    runNode(
      Effect.gen(function* () {
        const source = yield* makeHistoryDatabase([
          { url: "https://a.test/a_b", visitCount: 1, visitedAt: 1_000 },
          { url: "https://a.test/axb", visitCount: 9, visitedAt: 2_000 },
          { url: "https://b.test/one", title: "50% off", visitCount: 2, visitedAt: 3_000 },
          { url: "https://b.test/two", title: "50% off", visitCount: 2, visitedAt: 4_000 },
          { url: "https://c.test/other", title: "50 off", visitCount: 5, visitedAt: 5_000 },
        ]);
        const searcher = yield* makeChromiumHistorySearcher;
        expect((yield* searcher.search(source, "a_b")).map((row) => row.url)).toEqual([
          "https://a.test/a_b",
        ]);
        expect((yield* searcher.search(source, "50%")).map((row) => row.url)).toEqual([
          "https://b.test/two",
          "https://b.test/one",
        ]);
      }),
    ),
  );

  it.effect("skips hidden rows and non-web URLs", () =>
    runNode(
      Effect.gen(function* () {
        const source = yield* makeHistoryDatabase([
          { url: "https://ok.test/", title: "match", visitCount: 1, visitedAt: 1_000 },
          {
            url: "https://ok.test/frame",
            title: "match",
            visitCount: 1,
            visitedAt: 1_000,
            hidden: 1,
          },
          { url: "chrome://match/", title: "match", visitCount: 1, visitedAt: 1_000 },
          { url: "file:///match.html", title: "match", visitCount: 1, visitedAt: 1_000 },
        ]);
        const searcher = yield* makeChromiumHistorySearcher;
        expect((yield* searcher.search(source, "match")).map((row) => row.url)).toEqual([
          "https://ok.test/",
        ]);
      }),
    ),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "reads a history file the running browser holds under an exclusive lock",
    () =>
      runNode(
        Effect.gen(function* () {
          const source = yield* makeHistoryDatabase([
            { url: "https://locked.test/", title: "Locked", visitCount: 1, visitedAt: 1_000 },
          ]);
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`pragma locking_mode = exclusive`;
            yield* sql`begin immediate`;
            const searcher = yield* makeChromiumHistorySearcher;
            const results = yield* searcher.search(source, "locked");
            expect(results.map((row) => row.url)).toEqual(["https://locked.test/"]);
            yield* sql`rollback`;
          }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
        }),
      ),
  );

  it.effect("reuses the copy until it expires, then picks up new visits", () =>
    runNode(
      Effect.gen(function* () {
        const source = yield* makeHistoryDatabase([
          { url: "https://first.test/", title: "", visitCount: 1, visitedAt: 1_000 },
        ]);
        const searcher = yield* makeChromiumHistorySearcher;
        expect(yield* searcher.search(source, "test")).toHaveLength(1);

        yield* insertRows([
          { url: "https://second.test/", title: "", visitCount: 1, visitedAt: 2_000 },
        ]).pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
        expect(yield* searcher.search(source, "test")).toHaveLength(1);

        yield* TestClock.adjust("6 seconds");
        expect(yield* searcher.search(source, "test")).toHaveLength(2);
      }),
    ),
  );

  it.effect("returns nothing for a blank query and fails for a missing history file", () =>
    runNode(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-history-" });
        const missing = path.join(directory, "History");
        const searcher = yield* makeChromiumHistorySearcher;
        expect(yield* searcher.search(missing, "   ")).toEqual([]);
        const error = yield* searcher.search(missing, "x").pipe(Effect.flip);
        expect(error._tag).toBe("ChromiumHistoryReadError");
      }),
    ),
  );
});
