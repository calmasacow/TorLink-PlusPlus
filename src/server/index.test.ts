import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiServer, type ApiServer } from "./index";
import { idleSearchState } from "../search/concurrent";
import type { ConcurrentSearchState } from "../search/concurrent";
import type { SourceId, TorrentResult } from "../sources/types";
import { encodeId } from "./torznab";

function verifyXml(xml: string): void {
  if (!xml.startsWith("<?xml")) {
    throw new Error("Missing XML declaration");
  }

  if (xml.includes(" & ") || xml.includes(" && ")) {
    throw new Error("Found unescaped ampersand(s)");
  }
}

function verifyRssXml(xml: string): void {
  verifyXml(xml);

  const requiredNs = [
    'xmlns:atom="http://www.w3.org/2005/Atom"',
    'xmlns:torznab="http://torznab.com/schemas/2015/feed"',
    'xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"',
  ];
  for (const ns of requiredNs) {
    if (!xml.includes(ns)) {
      throw new Error(`Missing namespace: ${ns}`);
    }
  }

  const tags = ["rss", "channel", "title", "description", "link"];
  for (const tag of tags) {
    const opening = xml.indexOf(`<${tag}`);
    const closing = xml.indexOf(`</${tag}`);
    if (opening === -1 || closing === -1 || closing < opening) {
      throw new Error(`Unbalanced ${tag} tags`);
    }
  }
}


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

function result(source: SourceId = "fitgirl", sizeBytes = 123): TorrentResult {
  return {
    infoHash: "abc123",
    name: "Test Torrent",
    sizeBytes,
    seeders: 50,
    leechers: 2,
    source,
    magnet: "magnet:?xt=urn:btih:abc123&dn=Test+Torrent",
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

describe("Torznab API", () => {
  it("returns capabilities XML for t=caps", async () => {
    await startTestServer();

    const res = await fetch(`${baseUrl()}/api?t=caps`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    verifyXml(text);
    expect(text).toContain('<caps>');
    expect(text).toContain('<movie-search');
    expect(text).toContain('<category id="2000"');
  });

  it("returns RSS/XML for t=search", async () => {
    const search = vi.fn().mockResolvedValue(searchState());
    await startTestServer({ search });

    const res = await fetch(`${baseUrl()}/api?t=search&q=test`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    verifyRssXml(text);
    expect(text).toContain('<rss');
    expect(text).toContain('<channel>');
    expect(text).toContain('torlink search results');
    expect(text).toContain('torznab:attr name="magneturl"');
    expect(text).toContain('magnet:?xt=urn:btih:abc123');
    expect(text).toContain('newznab:response');
  });

  it("properly escapes XML special characters", async () => {
    const search = vi.fn().mockResolvedValue({
      ...searchState(),
      results: [{
        ...result(),
        name: 'Movie & TV Show "Special" <Characters>',
        magnet: 'magnet:?xt=urn:btih:def&dn=Test&torrent'
      }]
    });
    await startTestServer({ search });

    const res = await fetch(`${baseUrl()}/api?t=search&q=test`);
    const text = await res.text();

    expect(text).toContain("Movie &amp; TV Show &quot;Special&quot; &lt;Characters&gt;");
    expect(text).toContain("magnet:?xt=urn:btih:def&amp;dn=Test&amp;torrent");
  });

  it("returns empty movie RSS instead of 400 when Radarr validates without q", async () => {
    const search = vi.fn().mockResolvedValue({ ...idleSearchState(), loading: false });
    await startTestServer({ search, apiKey: "test-key" });

    const res = await fetch(`${baseUrl()}/api?t=movie&cat=2000,2010,2020,2030,2040,2045,2050,2060&extended=1&apikey=test-key&offset=0&limit=100`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    verifyRssXml(text);
    expect(text).toContain('<newznab:response offset="0" total="0"/>');
    expect(search).not.toHaveBeenCalled();
  });

  it("maps movie categories based on size", async () => {
    const small = result("yts", 1_000_000_000); // <3GB = SD
    const medium = result("yts", 4_000_000_000); // >3GB = HD
    const large = result("yts", 9_000_000_000); // >8GB = UHD
    const search = vi.fn().mockResolvedValue({
      ...searchState(),
      results: [small, medium, large]
    });
    await startTestServer({ search });

    const res = await fetch(`${baseUrl()}/api?t=movie&q=test`);
    const text = await res.text();

    expect(text).toContain('<category>2030</category>');
    expect(text).toContain('<category>2040</category>');
    expect(text).toContain('<category>2045</category>');
  });

  it("maps anime to category 5070", async () => {
    const anime = result("nyaa");
    const search = vi.fn().mockResolvedValue({
      ...searchState(),
      results: [anime] 
    });
    await startTestServer({ search });

    const res = await fetch(`${baseUrl()}/api?t=tvsearch&q=anime`);
    const text = await res.text();

    expect(text).toContain('<category>5070</category>');
  });

  it("supports season/episode in tvsearch", async () => {
    const search = vi.fn().mockResolvedValue(searchState());
    await startTestServer({ search });

    await fetch(`${baseUrl()}/api?t=tvsearch&q=show&season=2&ep=5`);
    expect(search).toHaveBeenCalledWith("show S02E05");
  });

  it("supports stable download IDs without searching", async () => {
    const torrent = result("yts");
    const search = vi.fn();
    await startTestServer({ search });

    const id = encodeId(torrent);
    const res = await fetch(`${baseUrl()}/api?t=download&id=${id}`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe(torrent.magnet);
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects invalid download IDs", async () => {
    await startTestServer();

    const res = await fetch(`${baseUrl()}/api?t=download&id=invalid`);
    
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Invalid download id" });
  });
});

describe("qBittorrent API", () => {
  const mockQbit = {
    test: vi.fn().mockResolvedValue({ ok: true }),
    add: vi.fn().mockResolvedValue({ ok: true }),
  };

  beforeEach(() => {
    mockQbit.test.mockResolvedValue({ ok: true });
    mockQbit.add.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("environment configuration", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {...originalEnv};
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("requires API key when configured", async () => {
      await startTestServer({ apiKey: "secret" });
      
      const res = await fetch(`${baseUrl()}/api/qbit/test`, {
        method: "POST",
      });

      expect(res.status).toBe(401);
    });

    it("creates qBittorrent client from env vars when available", async () => {
      process.env.TORLINK_QBIT_URL = "http://localhost:8080";
      process.env.TORLINK_QBIT_USERNAME = "admin";
      process.env.TORLINK_QBIT_PASSWORD = "password";
      process.env.TORLINK_QBIT_CATEGORY = "torlink";

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/login")) {
          return Promise.resolve(new Response("Ok.", {
            status: 200,
            headers: new Headers({ "Set-Cookie": "SID=abc123" }),
          }));
        }
        return Promise.resolve(new Response("Ok.", { status: 200 }));
      });

      await startTestServer({ qbitFetch: mockFetch });

      const res = await fetch(`${baseUrl()}/api/qbit/test`, { method: "POST" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/v2/auth/login",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns not configured when missing required env vars", async () => {
      process.env.TORLINK_QBIT_URL = "http://localhost:8080";
      process.env.TORLINK_QBIT_USERNAME = "admin";
      // Missing password

      await startTestServer();

      const res = await fetch(`${baseUrl()}/api/qbit/test`, {
        method: "POST",
      });

      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ 
        error: "qBittorrent not configured" 
      });
    });
  });

  it("tests qBittorrent connection", async () => {
    mockQbit.test.mockResolvedValueOnce({ ok: true });
    await startTestServer({ 
      apiKey: "secret", 
      qbit: {
        test: mockQbit.test,
        add: mockQbit.add,
      } 
    });

    const res = await fetch(`${baseUrl()}/api/qbit/test`, {
      method: "POST",
      headers: { "X-Api-Key": "secret" },
    });

    expect(res.status).toBe(200);
    expect(mockQbit.test).toHaveBeenCalledOnce();
  });

  it("adds torrent to qBittorrent", async () => {
    const magnet = "magnet:?xt=urn:btih:abc123";
    await startTestServer({ apiKey: "secret", qbit: mockQbit });

    const res = await fetch(`${baseUrl()}/api/qbit/add`, {
      method: "POST",
      headers: { 
        "X-Api-Key": "secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ magnet }),
    });

    expect(res.status).toBe(200);
    expect(mockQbit.add).toHaveBeenCalledWith({ 
      magnet,
    });
  });

  it("rejects invalid magnets", async () => {
    await startTestServer({ apiKey: "secret" });

    const res = await fetch(`${baseUrl()}/api/qbit/add`, {
      method: "POST",
      headers: { 
        "X-Api-Key": "secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ magnet: "invalid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid magnet URI",
    });
  });
});

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
