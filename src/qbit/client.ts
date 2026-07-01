import type { QbitOptions, QbitClient } from "./types";

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\/api\/v2$/iu, "");
}

export function createQbitClient(opts: QbitOptions): QbitClient {
  const baseUrl = normalizeUrl(opts.baseUrl);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const apiKeyHeaders = opts.apiKey
    ? {
        "X-Api-Key": opts.apiKey,
        "Authorization": `Bearer ${opts.apiKey}`,
      }
    : undefined;

  async function testApiKeyMode(): Promise<{ ok: boolean; status?: number }> {
    const res = await fetchImpl(`${baseUrl}/api/v2/app/version`, {
      method: "GET",
      headers: apiKeyHeaders,
    });
    return { ok: res.ok, status: res.status };
  }

  async function login(): Promise<{ ok: boolean; cookie?: string; status?: number }> {
    if (!opts.username || !opts.password) return { ok: false, status: 403 };
    const url = `${baseUrl}/api/v2/auth/login`;
    const username = opts.username;
    const password = opts.password;
    if (!username || !password) return { ok: false, status: 403 };
    const body = new URLSearchParams({ username, password });

    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) return { ok: false, status: res.status };
    
    const cookie = res.headers.get("Set-Cookie") ?? null;
    return { 
      ok: true,
      cookie: cookie?.replace(/;\s*HttpOnly/i, "") 
    };
  }

  return {
    async test() {
      try {
        if (opts.apiKey) {
          const { ok, status } = await testApiKeyMode();
          if (!ok) {
            return {
              ok: false,
              error: "qBittorrent connection test failed",
              status: status ?? 403,
            };
          }
          return { ok: true };
        }

        const { ok, status } = await login();
        if (!ok) {
          return { 
            ok: false, 
            error: "qBittorrent login failed",
            status: status ?? 403,
          };
        }
        return { ok: true };
      } catch (err) {
        return { 
          ok: false, 
          error: err instanceof Error ? err.message : "qBittorrent connection failed",
        };
      }
    },

    async add({ 
      magnet, 
      category = opts.category, 
      savePath = opts.savePath 
    }) {
      if (!magnet.startsWith("magnet:?")) {
        return { ok: false, error: "Invalid magnet URI", status: 400 };
      }

      try {
        if (opts.apiKey) {
          const url = `${baseUrl}/api/v2/torrents/add`;
          const params = new URLSearchParams({ urls: magnet });
          if (category) params.set("category", category);
          if (savePath) params.set("savepath", savePath);
          const res = await fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...apiKeyHeaders,
            },
            body: params.toString(),
          });
          if (!res.ok) {
            return {
              ok: false,
              error: "Failed to add torrent",
              status: res.status,
            };
          }
          return { ok: true };
        }

        const { ok, cookie } = await login();
        if (!ok) {
          return { ok: false, error: "qBittorrent login failed", status: 403 };
        }

        const url = `${baseUrl}/api/v2/torrents/add`;
        const params = new URLSearchParams({ urls: magnet });
        if (category) params.set("category", category);
        if (savePath) params.set("savepath", savePath);

        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
        };
        if (cookie) {
          headers["Cookie"] = cookie;
        }

        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: params.toString(),
        });

        if (!res.ok) {
          return { 
            ok: false, 
            error: "Failed to add torrent",
            status: res.status,
          };
        }
        return { ok: true };
      } catch (err) {
        return { 
          ok: false,
          error: err instanceof Error ? err.message : "qBittorrent request failed",
        };
      }
    },
  };
}
