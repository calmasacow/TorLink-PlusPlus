import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiServer, type ApiServer } from "./index";
import { idleSearchState } from "../search/concurrent";
import type { ConcurrentSearchState } from "../search/concurrent";
import type { SourceId, TorrentResult } from "../sources/types";

let server: ApiServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function baseUrl(): string {
  if (!server) throw new Error("server was not started");
  return `http://127.0.0.1:${server.port}`;
}

function startTestServer(options: Parameters<typeof createApiServer>[0] = {}): Promise<void> {
  server = createApiServer({ host: "127.0.0.1", port: 0, ...options });
  return server.start();
}

function result(source: SourceId = "fitgirl"): TorrentResult {
  return {
    infoHash: "abc",
    name: "Ubuntu ISO",
    sizeBytes: 123,
    seeders: 50,
    leechers: 2,
    source,
    magnet: "magnet:?xt=urn:btih:abc",
    added: 1700000000,
  };
}

function searchState(): ConcurrentSearchState {
  return {
    ...idleSearchState(),
    results: [result()],
    perSource: {
      ...idleSearchState().perSource,
      fitgirl: { loading: false, error: null, code: null, count: 1 },
    },
    loading: false,
    done: idleSearchState().total,
  };
}

describe("API server", () => {
  it("returns JSON ok for /health", async () => {
    await startTestServer();

    const res = await fetch(`${baseUrl()}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects unauthorized search requests when an API key is set", async () => {
    await startTestServer({ apiKey: "secret" });

    const res = await fetch(`${baseUrl()}/api/search?q=ubuntu`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("accepts X-Api-Key auth", async () => {
    const search = vi.fn().mockResolvedValue(searchState());
    await startTestServer({ apiKey: "secret", search });

    const res = await fetch(`${baseUrl()}/api/search?q=ubuntu`, {
      headers: { "X-Api-Key": "secret" },
    });

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith("ubuntu");
  });

  it("accepts apikey query auth", async () => {
    const search = vi.fn().mockResolvedValue(searchState());
    await startTestServer({ apiKey: "secret", search });

    const res = await fetch(`${baseUrl()}/api/search?q=ubuntu&apikey=secret`);

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith("ubuntu");
  });

  it("returns JSON search results from a mocked search service", async () => {
    const search = vi.fn().mockResolvedValue(searchState());
    await startTestServer({ search });

    const res = await fetch(`${baseUrl()}/api/search?q=ubuntu`);
    const data = await res.json() as {
      query: string;
      count: number;
      results: TorrentResult[];
      sources: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith("ubuntu");
    expect(data).toMatchObject({
      query: "ubuntu",
      count: 1,
      results: [result()],
      sources: {
        fitgirl: { loading: false, error: null, code: null, count: 1 },
      },
    });
  });
});
