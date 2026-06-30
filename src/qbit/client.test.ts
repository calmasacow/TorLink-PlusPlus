import { afterEach, describe, expect, it, vi } from "vitest";
import { createQbitClient } from "./client";
import type { QbitAddOptions } from "./types";

describe("qBittorrent client", () => {
  const mockFetch = vi.fn();
  const baseUrl = "http://qbittorrent:8080";
  const username = "admin";
  const password = "pass123";

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes base URL by trimming trailing slash", () => {
    const client = createQbitClient({
      baseUrl: `${baseUrl}/`,
      username,
      password,
      fetch: mockFetch,
    });
    expect(baseUrl.endsWith("/")).toBe(false);
  });

  it("rejects login with bad credentials", async () => {
    mockFetch.mockResolvedValue(new Response("Fails.", { status: 403 }));
    const client = createQbitClient({ baseUrl, username, password, fetch: mockFetch });
    
    await expect(client.test()).resolves.toEqual({
      ok: false,
      error: "qBittorrent login failed",
      status: 403,
    });

    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
  });

  it("successfully logs in with valid credentials", async () => {
    mockFetch.mockResolvedValue(new Response("Ok.", { 
      status: 200,
      headers: new Headers({"Set-Cookie": "SID=12345"}),
    }));
    const client = createQbitClient({ baseUrl, username, password, fetch: mockFetch });
    
    await expect(client.test()).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects invalid magnet URI", async () => {
    const client = createQbitClient({ baseUrl, username, password, fetch: mockFetch });
    
    await expect(client.add({ magnet: "invalid" })).resolves.toEqual({
      ok: false,
      error: "Invalid magnet URI",
      status: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("adds torrent with default category and save path", async () => {
    const cookie = "SID=12345";
    const mockCookieFetch = vi.fn()
      .mockResolvedValueOnce(new Response("Ok.", { 
        status: 200,
        headers: new Headers({"Set-Cookie": cookie}),
      }))
      .mockResolvedValueOnce(new Response("Ok.", { status: 200 }));

    const magnet = "magnet:?xt=urn:btih:abc123";
    const client = createQbitClient({ 
      baseUrl, 
      username, 
      password, 
      fetch: mockCookieFetch,
    });

    await expect(client.add({ magnet })).resolves.toEqual({
      ok: true,
    });

    expect(mockCookieFetch).toHaveBeenNthCalledWith(1, `${baseUrl}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });

    expect(mockCookieFetch).toHaveBeenNthCalledWith(2, `${baseUrl}/api/v2/torrents/add`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie,
      },
      body: `urls=${encodeURIComponent(magnet)}`,
    });
  });

  it("adds torrent with custom category and path", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Ok.", { 
      status: 200,
      headers: new Headers({"Set-Cookie": "SID=12345"}),
    }))
    .mockResolvedValueOnce(new Response("Ok.", { status: 200 }));

    const opts: QbitAddOptions = {
      magnet: "magnet:?xt=urn:btih:abc123",
      category: "tv",
      savePath: "/downloads/tv",
    };
    const client = createQbitClient({ baseUrl, username, password, fetch: mockFetch });

    await expect(client.add(opts)).resolves.toEqual({ ok: true });

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const call2 = mockFetch.mock.calls[1]!;
    const body = call2[1].body as string;
    expect(body).toContain(`urls=${encodeURIComponent(opts.magnet)}`);
    expect(body).toContain(`category=${opts.category}`);
    expect(body).toContain(`savepath=${encodeURIComponent(opts.savePath!)}`);
  });
});
