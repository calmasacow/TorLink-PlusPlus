import WebTorrent, { type Torrent } from "webtorrent";
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface TorrentProgress {
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
  timeRemaining: number;
  name: string;
}

export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function insideDir(baseDir: string, candidate: string): boolean {
  const base = resolve(baseDir);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
}

export function safeDeleteAssociatedFiles(dir: string, name: string, files: string[] = []): string[] {
  const deleted: string[] = [];
  const candidates = files.length > 0 ? files : [name];
  for (const rel of candidates) {
    if (!rel) continue;
    const target = resolve(dir, rel);
    if (!insideDir(dir, target)) continue;
    try {
      rmSync(target, { force: true, recursive: true });
      deleted.push(target);
    } catch {}
  }
  return deleted;
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private torrents = new Map<string, Torrent>();

  private ensureClient(): WebTorrent {
    if (!this.client) {
      this.client = new WebTorrent();
      this.client.on("error", () => {});
    }
    return this.client;
  }

  // `source` is a magnet URI, an infoHash, or a path to a .torrent file. Seeding
  // an existing file passes the stored .torrent path so webtorrent can verify it
  // locally instead of re-fetching metadata from the swarm.
  add(id: string, source: string, dir: string, handlers: AddHandlers): void {
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.destroy();
      } catch {}
    }

    let torrent: Torrent;
    try {
      torrent = client.add(source, { path: dir });
    } catch (e) {
      handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, torrent);

    torrent.on("metadata", () => {
      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        torrentFile: torrent.torrentFile,
      });
    });
    torrent.on("done", () => {
      // A finished torrent is a complete, verified torrent: keep it alive so it
      // can seed. The queue owns its lifetime from here (remove/destroy).
      handlers.onDone?.();
    });
    torrent.on("error", (err: unknown) => {
      handlers.onError?.(message(err));
      this.torrents.delete(id);
      try {
        torrent.destroy();
      } catch {}
    });
  }

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    return this.client?.torrentPort ?? null;
  }

  stats(id: string): TorrentProgress | null {
    const t = this.torrents.get(id);
    if (!t) return null;
    return {
      progress: t.progress,
      downloaded: t.downloaded,
      total: t.length,
      speed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      uploaded: t.uploaded,
      peers: t.numPeers,
      timeRemaining: t.timeRemaining,
      name: t.name,
    };
  }

  remove(id: string, opts: { deleteFiles?: boolean; dir?: string; name?: string } = {}): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    const files = t?.files?.map((file) => file.path).filter(Boolean) ?? [];
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
    if (opts.deleteFiles && opts.dir) {
      safeDeleteAssociatedFiles(opts.dir, opts.name ?? "", files);
    }
  }

  destroy(): void {
    this.torrents.clear();
    // Never block shutdown on webtorrent's async teardown: hand off the client
    // destroy to a later tick and let the OS reclaim sockets if we exit first.
    const client = this.client;
    this.client = null;
    if (client) {
      setImmediate(() => {
        try {
          client.destroy();
        } catch {}
      });
    }
  }
}
