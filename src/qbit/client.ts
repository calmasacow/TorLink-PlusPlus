import type { QbitOptions, QbitClient } from "./types";

function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function createQbitClient(opts: QbitOptions): QbitClient {
  const baseUrl = normalizeUrl(opts.baseUrl);
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  async function login(): Promise<{ ok: boolean; cookie?: string; status?: number }> {
    const url = `${baseUrl}/api/v2/auth/login`;
    const body = new URLSearchParams({
      username: opts.username,
      password: opts.password,
    });

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
