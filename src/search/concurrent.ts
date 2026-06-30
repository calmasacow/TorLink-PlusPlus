import { SOURCES } from "../sources/registry";
import { cachedSearch } from "../sources/cache";
import { HttpError } from "../util/net";
import type { SearchOptions, Source, SourceId, TorrentResult } from "../sources/types";

export interface SourceState {
  loading: boolean;
  error: string | null;
  code: string | null;
  count: number;
}

export interface ConcurrentSearchState {
  results: TorrentResult[];
  perSource: Record<SourceId, SourceState>;
  loading: boolean;
  done: number;
  total: number;
}

export interface ConcurrentSearchOptions {
  sources?: readonly Source[];
  search?: (source: Source, query: string, opts?: SearchOptions) => Promise<TorrentResult[]>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (state: ConcurrentSearchState) => void;
}

export const PER_SOURCE_TIMEOUT_MS = 25000;

export function errorCode(e: unknown, timedOut: boolean): string {
  if (timedOut) return "timed out";
  if (e instanceof HttpError && e.status > 0) return `HTTP ${e.status}`;
  return "no response";
}

export function blankPerSource(
  sources: readonly Source[] = SOURCES,
  loading: boolean,
): Record<SourceId, SourceState> {
  const out = {} as Record<SourceId, SourceState>;
  for (const s of sources) out[s.id] = { loading, error: null, code: null, count: 0 };
  return out;
}

export function dedupeResults(list: readonly TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const r of list) {
    const existing = byHash.get(r.infoHash);
    if (!existing || r.seeders > existing.seeders) byHash.set(r.infoHash, r);
  }
  return [...byHash.values()];
}

// torlink's default ordering: healthiest first. The results view can re-sort
// on demand (the `s` key), and its "none"/default state preserves this order.
export function defaultOrder(list: readonly TorrentResult[]): TorrentResult[] {
  return [...list].sort((a, b) => {
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return (b.added ?? 0) - (a.added ?? 0);
  });
}

export function idleSearchState(sources: readonly Source[] = SOURCES): ConcurrentSearchState {
  return {
    results: [],
    perSource: blankPerSource(sources, false),
    loading: false,
    done: 0,
    total: sources.length,
  };
}

export function initialSearchState(sources: readonly Source[] = SOURCES): ConcurrentSearchState {
  return {
    results: [],
    perSource: blankPerSource(sources, true),
    loading: sources.length > 0,
    done: 0,
    total: sources.length,
  };
}

export async function runConcurrentSearch(
  query: string,
  options: ConcurrentSearchOptions = {},
): Promise<ConcurrentSearchState> {
  const sources = options.sources ?? SOURCES;
  const search = options.search ?? cachedSearch;
  const timeoutMs = options.timeoutMs ?? PER_SOURCE_TIMEOUT_MS;
  const collected: TorrentResult[] = [];
  const per = blankPerSource(sources, true);
  let done = 0;
  let finalState = initialSearchState(sources);

  const publish = (): void => {
    finalState = {
      results: defaultOrder(dedupeResults(collected)),
      perSource: { ...per },
      loading: done < sources.length,
      done,
      total: sources.length,
    };
    options.onUpdate?.(finalState);
  };

  options.onUpdate?.(finalState);

  await Promise.all(
    sources.map(async (source) => {
      const sc = new AbortController();
      const onAbort = (): void => sc.abort();
      if (options.signal?.aborted) sc.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => sc.abort(), timeoutMs);

      try {
        const res = await search(source, query, { signal: sc.signal });
        if (options.signal?.aborted) return;
        collected.push(...res);
        per[source.id] = { loading: false, error: null, code: null, count: res.length };
      } catch (e: unknown) {
        if (options.signal?.aborted) return;
        const timedOut = sc.signal.aborted;
        per[source.id] = {
          loading: false,
          error: timedOut ? "timed out" : e instanceof Error ? e.message : String(e),
          code: errorCode(e, timedOut),
          count: 0,
        };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (options.signal?.aborted) return;
        done += 1;
        publish();
      }
    }),
  );

  return finalState;
}
