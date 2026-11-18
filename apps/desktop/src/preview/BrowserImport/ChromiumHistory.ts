import type { BrowserHistorySuggestion } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

const MAX_SUGGESTIONS = 8;
/** One burst of typing reuses a copy instead of recopying a history file that can be hundreds of MB. */
const SNAPSHOT_TTL_MS = 5_000;

export class ChromiumHistoryReadError extends Schema.TaggedError<ChromiumHistoryReadError>()(
  "ChromiumHistoryReadError",
  {
    historyDatabasePath: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not read Chromium history at ${this.historyDatabasePath}.`;
  }
}

const HistoryRow = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  last_visit_ms: Schema.Number,
  visit_count: Schema.Number,
});
const decodeHistoryRows = Schema.decodeUnknownEffect(Schema.Array(HistoryRow));

export const escapeLikePattern = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

const searchChromiumHistoryDatabase = Effect.fn("ChromiumHistory.searchDatabase")(function* (
  snapshotPath: string,
  query: string,
) {
  const pattern = `%${escapeLikePattern(query)}%`;
  const rows = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // last_visit_time is microseconds since 1601, beyond node:sqlite's safe integer range, so
    // convert to Unix milliseconds in SQL (11644473600000 ms between the two epochs).
    return yield* decodeHistoryRows(
      yield* sql`select url, title, last_visit_time / 1000 - 11644473600000 as last_visit_ms, visit_count
        from urls
        where hidden = 0
          and (url like 'http://%' or url like 'https://%')
          and (url like ${pattern} escape '\\' or title like ${pattern} escape '\\')
        order by visit_count desc, last_visit_time desc
        limit 8`,
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: snapshotPath, readonly: true })));
  return rows.slice(0, MAX_SUGGESTIONS).map((row): BrowserHistorySuggestion => ({
    url: row.url,
    ...(row.title ? { title: row.title } : {}),
    lastVisitedAt: Math.round(row.last_visit_ms),
    visitCount: row.visit_count,
  }));
});

/**
 * Chromium holds `History` under an exclusive lock while it runs, so a second connection cannot
 * open it. Copy the file and query the copy; the copy lives until the scope closes.
 */
export const makeChromiumHistorySearcher = Effect.gen(function* ChromiumHistorySearcherMake() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-history-" });
  const gate = yield* Semaphore.make(1);
  const snapshots = yield* Ref.make<
    ReadonlyMap<string, { readonly target: string; readonly copiedAt: number }>
  >(new Map());

  const snapshot = Effect.fn("ChromiumHistory.snapshot")(function* (historyDatabasePath: string) {
    const now = yield* Clock.currentTimeMillis;
    const known = yield* Ref.get(snapshots);
    const cached = known.get(historyDatabasePath);
    if (cached !== undefined && now - cached.copiedAt < SNAPSHOT_TTL_MS) return cached.target;
    const target = cached?.target ?? path.join(directory, `history-${known.size}`);
    // The OS may purge idle temp directories during a long session.
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.copyFile(historyDatabasePath, target);
    yield* Ref.update(snapshots, (current) =>
      new Map(current).set(historyDatabasePath, { target, copiedAt: now }),
    );
    return target;
  });

  const search = Effect.fn("ChromiumHistory.search")(function* (
    historyDatabasePath: string,
    query: string,
  ): Effect.fn.Return<ReadonlyArray<BrowserHistorySuggestion>, ChromiumHistoryReadError> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    return yield* gate
      .withPermits(1)(
        snapshot(historyDatabasePath).pipe(
          Effect.flatMap((target) => searchChromiumHistoryDatabase(target, trimmed)),
          // A copy taken mid-write can be unreadable; recopy on the next keystroke.
          Effect.tapError(() =>
            Ref.update(snapshots, (current) => {
              const entry = current.get(historyDatabasePath);
              return entry === undefined
                ? current
                : new Map(current).set(historyDatabasePath, {
                    ...entry,
                    copiedAt: Number.NEGATIVE_INFINITY,
                  });
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError((cause) => new ChromiumHistoryReadError({ historyDatabasePath, cause })),
      );
  });

  return { search } as const;
});

export type ChromiumHistorySearcher = Effect.Success<typeof makeChromiumHistorySearcher>;
