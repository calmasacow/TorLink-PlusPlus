import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../util/net";
import type { SearchOptions, Source, SourceId, TorrentResult } from "../sources/types";
import {
  defaultOrder,
  dedupeResults,
  runConcurrentSearch,
  type ConcurrentSearchState,
} from "./concurrent";

function result(
  infoHash: string,
  seeders: number,
  added: number,
  source: SourceId = "fitgirl",
): TorrentResult {
  return {
    infoHash,
    name: `${source}-${infoHash}`,
    sizeBytes: 1,
    seeders,
    leechers: 0,
    source,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
    added,
  };
}

function source(id: SourceId): Source {
  return {
    id,
    label: id,
    group: "Movies",
    homepage: `https://example.test/${id}`,
    search: async () => [],
  };
}

describe("concurrent search service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes by infoHash and keeps the result with the most seeders", () => {
    expect(dedupeResults([
      result("abc", 1, 100, "fitgirl"),
      result("abc", 9, 50, "yts"),
      result("def", 2, 75, "eztv"),
    ])).toEqual([
      result("abc", 9, 50, "yts"),
      result("def", 2, 75, "eztv"),
    ]);
  });

  it("orders by seeders first, then newest added timestamp", () => {
    expect(defaultOrder([
      result("old", 10, 100),
      result("low", 1, 999),
      result("new", 10, 200),
    ]).map((r) => r.infoHash)).toEqual(["new", "old", "low"]);
  });

  it("returns merged ordered results and per-source counts", async () => {
    const sources = [source("fitgirl"), source("yts")];
    const updates: ConcurrentSearchState[] = [];

    const state = await runConcurrentSearch("matrix", {
      sources,
      onUpdate: (update) => updates.push(update),
      search: async (s) => s.id === "fitgirl"
        ? [result("shared", 2, 100, s.id), result("fitgirl-only", 4, 100, s.id)]
        : [result("shared", 8, 50, s.id), result("yts-only", 1, 300, s.id)],
    });

    expect(state.loading).toBe(false);
    expect(state.done).toBe(2);
    expect(state.results.map((r) => r.infoHash)).toEqual(["shared", "fitgirl-only", "yts-only"]);
    expect(state.results[0]?.source).toBe("yts");
    expect(state.perSource.fitgirl).toEqual({ loading: false, error: null, code: null, count: 2 });
    expect(state.perSource.yts).toEqual({ loading: false, error: null, code: null, count: 2 });
    expect(updates[0]).toMatchObject({ loading: true, done: 0, total: 2 });
  });

  it("records per-source errors without failing the whole search", async () => {
    const state = await runConcurrentSearch("matrix", {
      sources: [source("fitgirl"), source("yts")],
      search: async (s) => {
        if (s.id === "fitgirl") throw new HttpError(503, "blocked");
        return [result("ok", 5, 100, s.id)];
      },
    });

    expect(state.results.map((r) => r.infoHash)).toEqual(["ok"]);
    expect(state.perSource.fitgirl).toEqual({
      loading: false,
      error: "blocked",
      code: "HTTP 503",
      count: 0,
    });
    expect(state.perSource.yts).toEqual({ loading: false, error: null, code: null, count: 1 });
  });

  it("aborts a slow source after the per-source timeout", async () => {
    vi.useFakeTimers();

    const promise = runConcurrentSearch("matrix", {
      sources: [source("fitgirl")],
      timeoutMs: 10,
      search: async (_s, _query, opts?: SearchOptions) => new Promise<TorrentResult[]>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });

    await vi.advanceTimersByTimeAsync(10);
    const state = await promise;

    expect(state.loading).toBe(false);
    expect(state.done).toBe(1);
    expect(state.perSource.fitgirl).toEqual({
      loading: false,
      error: "timed out",
      code: "timed out",
      count: 0,
    });
  });
});
