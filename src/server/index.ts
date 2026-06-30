import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { runConcurrentSearch } from "../search/concurrent";
import type { ConcurrentSearchOptions, ConcurrentSearchState } from "../search/concurrent";
import { CAPS_XML, decodeId, encodeId, resultsToXml } from "./torznab";
import { createQbitClient } from "../qbit/client";
import type { QbitOptions } from "../qbit/types";

export interface ServerOptions {
  port?: number;
  host?: string;
  apiKey?: string;
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
  const apiKey = options.apiKey ?? process.env.TORLINK_API_KEY;
  const search = options.search ?? runConcurrentSearch;
  const qbitFromEnv = !options.qbit ? getQbitOptionsFromEnv(options.qbitFetch) : null;
  const qbit = options.qbit ?? (qbitFromEnv ? createQbitClient(qbitFromEnv) : undefined);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "GET" && (url.pathname === "/api" || url.pathname === "/api/search")) {
        if (apiKey && authKey(req, url) !== apiKey) {
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
        
        // Handle Torznab API requests
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

        // Handle JSON API requests
        sendJson(res, 200, {
          query,
          count: state.results.length,
          results: state.results,
          sources: state.perSource,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/qbit/test") {
        if (apiKey && authKey(req, url) !== apiKey) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        if (!qbit) {
          sendJson(res, 501, { error: "qBittorrent not configured" });
          return;
        }

        try {
          const result = await qbit.test();
          sendJson(res, result.ok ? 200 : 400, result);
        } catch {
          sendJson(res, 500, { error: "Internal server error" });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/qbit/add") {
        if (apiKey && authKey(req, url) !== apiKey) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }
          const { magnet, category, savePath } = JSON.parse(body) as {
            magnet?: string;
            category?: string;
            savePath?: string;
          };

          if (!magnet || typeof magnet !== "string" || !magnet.startsWith("magnet:?")) {
            sendJson(res, 400, { error: "Invalid magnet URI" });
            return;
          }

          if (!qbit) {
            sendJson(res, 501, { error: "qBittorrent not configured" });
            return;
          }

          const result = await qbit.add({ magnet, category, savePath });
          sendJson(res, result.ok ? 200 : 400, result);
        } catch (err) {
          sendJson(res, 400, { 
            error: "Invalid request body" 
          });
        }
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch {
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
