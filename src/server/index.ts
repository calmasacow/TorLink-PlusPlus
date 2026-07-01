import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { runConcurrentSearch } from "../search/concurrent";
import type { ConcurrentSearchOptions, ConcurrentSearchState } from "../search/concurrent";
import { CAPS_XML, decodeId, encodeId, resultsToXml } from "./torznab";
import { createQbitClient } from "../qbit/client";
import type { QbitOptions } from "../qbit/types";
import { resolve, extname, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { QueueItem } from "../download/types";
import type { SourceId } from "../sources/types";

export interface ServerOptions {
  port?: number;
  host?: string;
  apiKey?: string;
  webUiTrusted?: boolean;
  search?: (query: string, options?: ConcurrentSearchOptions) => Promise<ConcurrentSearchState>;
  qbitFetch?: typeof fetch;
  qbit?: {
    test(): Promise<{ ok: boolean; error?: string; status?: number }>;
    add(opts: { 
      magnet: string; 
      category?: string;
      savePath?: string;
    }): Promise<{ ok: boolean; error?: string; status?: number }>;
  };
  downloadDir?: string;
  downloadQueue?: {
    add(input: { id: string; name: string; magnet: string; source?: SourceId; sizeBytes?: number }, dir: string): void;
    getItems(): QueueItem[];
    pause(id: string): void;
    resume(id: string): void;
    cancel(id: string, opts?: { deleteFiles?: boolean }): void;
  };
}

export interface ApiServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
  readonly host: string;
  readonly nodeServer: HttpServer;
}

function authKey(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers["x-api-key"];
  if (Array.isArray(header)) return header[0];
  return header ?? url.searchParams.get("apikey") ?? undefined;
}

function envFlag(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function isTrustedWebUiRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  const referer = req.headers.referer;
  if (!host || !referer || Array.isArray(referer)) return false;

  try {
    const refererUrl = new URL(referer);
    return refererUrl.host === host;
  } catch {
    return false;
  }
}

function isAuthorized(req: IncomingMessage, url: URL, apiKey: string | undefined, webUiTrusted: boolean): boolean {
  if (!apiKey) return true;
  if (authKey(req, url) === apiKey) return true;
  return webUiTrusted && isTrustedWebUiRequest(req);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function getQbitOptionsFromEnv(fetchImpl?: typeof fetch): QbitOptions | null {
  const url = process.env.TORLINK_QBIT_URL;
  const username = process.env.TORLINK_QBIT_USERNAME;
  const password = process.env.TORLINK_QBIT_PASSWORD;
  
  if (!url || !username || !password) return null;

  return {
    baseUrl: url,
    username,
    password,
    category: process.env.TORLINK_QBIT_CATEGORY,
    savePath: process.env.TORLINK_QBIT_SAVE_PATH,
    fetch: fetchImpl,
  };
}

export function createApiServer(options: ServerOptions = {}): ApiServer {
  const host = options.host ?? "0.0.0.0";
  let currentPort = options.port ?? (Number(process.env.TORLINK_PORT) || 9117);
  let apiKey = options.apiKey ?? process.env.TORLINK_API_KEY;
  const webUiTrusted = options.webUiTrusted ?? envFlag("TORLINK_WEBUI_TRUSTED");
  const search = options.search ?? runConcurrentSearch;
  const qbitFromEnv = !options.qbit ? getQbitOptionsFromEnv(options.qbitFetch) : null;
  const qbit = options.qbit ?? (qbitFromEnv ? createQbitClient(qbitFromEnv) : undefined);
  const downloadDir = options.downloadDir ?? process.env.TORLINK_DOWNLOAD_DIR ?? "/downloads";
  const downloadQueue = options.downloadQueue;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Static Web UI serving (only if web/ dir exists at request time)
    if (req.method === "GET" &&
        !url.pathname.startsWith("/api") &&
        url.pathname !== "/health") {

      try {
        const webRoot = resolve(process.cwd(), "web");
        const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/u, ""));
        let filePath = resolve(webRoot, requestedPath);

        if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }

        const fileStat = await stat(filePath).catch(() => null as any);
        if (fileStat) {
          if (fileStat.isDirectory()) {
            filePath = resolve(filePath, "index.html");
          }
          const content = await readFile(filePath);
          const ext = extname(filePath);
          const contentType =
            ext === ".html" ? "text/html; charset=utf-8" :
            ext === ".js"  ? "application/javascript" :
            ext === ".css" ? "text/css" : "application/octet-stream";

          res.statusCode = 200;
          res.setHeader("Content-Type", contentType);
          res.end(content);
          return;
        }
      } catch {
        // fall through to API
      }
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/config/api-key") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }
          const input = JSON.parse(body) as { apiKey?: string };
          if (!input.apiKey || typeof input.apiKey !== "string" || input.apiKey.length < 16) {
            sendJson(res, 400, { error: "Invalid API key" });
            return;
          }
          apiKey = input.apiKey;
          sendJson(res, 200, { ok: true, hasApiKey: true });
        } catch {
          sendJson(res, 400, { error: "Invalid request body" });
        }
        return;
      }

      if (req.method === "GET" && (url.pathname === "/api" || url.pathname === "/api/search")) {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const t = url.searchParams.get("t");
        if (t === "caps") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.end(CAPS_XML);
          return;
        }

        if (t === "download") {
          const id = url.searchParams.get("id");
          if (!id) {
            sendJson(res, 400, { error: "Missing id parameter" });
            return;
          }
          
          const decoded = decodeId(id);
          if (!decoded) {
            sendJson(res, 404, { error: "Invalid download id" });
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(decoded.magnet);
          return;
        }

        const torznabType = url.pathname === "/api" && (t === "search" || t === "movie" || t === "tvsearch")
          ? (t === "tvsearch" ? "tvsearch" : t === "movie" ? "movie" : "search")
          : null;

        let query = url.searchParams.get("q")?.trim();
        if (!query) {
          if (torznabType) {
            query = process.env.TORLINK_TORZNAB_EMPTY_QUERY?.trim() || "avatar";
          } else {
            sendJson(res, 400, { error: "Missing search query" });
            return;
          }
        }

        const season = url.searchParams.get("season");
        const episode = url.searchParams.get("ep");
        if (t === "tvsearch" && (season || episode)) {
          query = `${query} ${season ? `S${season.padStart(2, '0')}` : ''}${episode ? `E${episode.padStart(2, '0')}` : ''}`;
        }

        const state = await search(query);
        
        if (url.pathname === "/api" && (t === "caps" || t === "search" || t === "movie" || t === "tvsearch")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          const baseUrl = `http://${req.headers.host ?? "localhost:9117"}`;
          res.end(resultsToXml(
            query, 
            state.results, 
            t === "tvsearch" ? "tvsearch" : t === "movie" ? "movie" : "search",
            baseUrl
          ));
          return;
        }

        sendJson(res, 200, {
          query,
          count: state.results.length,
          results: state.results,
          sources: state.perSource,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/qbit/config") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        sendJson(res, 200, {
          configured: Boolean(qbitFromEnv),
          url: process.env.TORLINK_QBIT_URL || "",
          hasApiKey: Boolean(process.env.TORLINK_QBIT_PASSWORD),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/qbit/test") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }
          const input = body ? JSON.parse(body) as { qbitUrl?: string; qbitApiKey?: string } : {};
          const requestQbit = input.qbitUrl && input.qbitApiKey
            ? createQbitClient({
                baseUrl: input.qbitUrl,
                apiKey: input.qbitApiKey,
                fetch: options.qbitFetch,
              })
            : qbit;

          if (!requestQbit) {
            sendJson(res, 501, { error: "qBittorrent not configured" });
            return;
          }

          const result = await requestQbit.test();
          sendJson(res, result.ok ? 200 : 400, result);
        } catch {
          sendJson(res, 500, { error: "Internal server error" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/downloads") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        sendJson(res, 200, {
          downloadDir,
          items: downloadQueue ? downloadQueue.getItems() : [],
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/downloads/add") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        if (!downloadQueue) {
          sendJson(res, 501, { error: "Built-in downloader not configured" });
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }
          const input = JSON.parse(body) as {
            id?: string;
            name?: string;
            magnet?: string;
            source?: SourceId;
            sizeBytes?: number;
          };

          if (!input.id || typeof input.id !== "string") {
            sendJson(res, 400, { error: "Missing torrent id" });
            return;
          }
          if (!input.name || typeof input.name !== "string") {
            sendJson(res, 400, { error: "Missing torrent name" });
            return;
          }
          if (!input.magnet || typeof input.magnet !== "string" || !input.magnet.startsWith("magnet:?")) {
            sendJson(res, 400, { error: "Invalid magnet URI" });
            return;
          }

          downloadQueue.add({
            id: input.id,
            name: input.name,
            magnet: input.magnet,
            source: input.source,
            sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : undefined,
          }, downloadDir);
          sendJson(res, 200, { ok: true });
        } catch {
          sendJson(res, 400, { error: "Invalid request body" });
        }
        return;
      }

      const downloadAction = url.pathname.match(/^\/api\/downloads\/([^/]+)\/(pause|resume|cancel)$/u);
      if (req.method === "POST" && downloadAction) {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        if (!downloadQueue) {
          sendJson(res, 501, { error: "Built-in downloader not configured" });
          return;
        }

        const id = decodeURIComponent(downloadAction[1] ?? "");
        const action = downloadAction[2];
        if (action === "pause") downloadQueue.pause(id);
        else if (action === "resume") downloadQueue.resume(id);
        else downloadQueue.cancel(id, { deleteFiles: url.searchParams.get("deleteFiles") === "true" });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/qbit/add") {
        if (!isAuthorized(req, url, apiKey, webUiTrusted)) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }
          const { magnet, category, savePath, qbitUrl, qbitApiKey } = JSON.parse(body) as {
            magnet?: string;
            category?: string;
            savePath?: string;
            qbitUrl?: string;
            qbitApiKey?: string;
          };

          if (!magnet || typeof magnet !== "string" || !magnet.startsWith("magnet:?")) {
            sendJson(res, 400, { error: "Invalid magnet URI" });
            return;
          }

          const requestQbit = !qbit && qbitUrl && qbitApiKey
            ? createQbitClient({
                baseUrl: qbitUrl,
                apiKey: qbitApiKey,
                category,
                savePath,
                fetch: options.qbitFetch,
              })
            : qbit;

          if (!requestQbit) {
            sendJson(res, 501, { error: "qBittorrent not configured" });
            return;
          }

          const result = await requestQbit.add({ magnet, category, savePath });
          sendJson(res, result.ok ? 200 : 400, result);
        } catch {
          sendJson(res, 400, {
            error: "Invalid request body"
          });
        }
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err: any) {
      console.error(err);
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  return {
    nodeServer: server,
    get host() {
      return host;
    },
    get port() {
      return currentPort;
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(currentPort, host, () => {
          server.off("error", reject);
          const address = server.address();
          if (address && typeof address === "object") currentPort = address.port;
          resolve();
        });
      });
    },
    async stop() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
