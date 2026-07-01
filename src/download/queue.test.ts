import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";

function h(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "h1",
    name: "Some Download",
    magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    dir: "/downloads",
    sizeBytes: 100,
    completedAt: 1,
    ...over,
  };
}

describe("DownloadQueue seeding", () => {
  it("refuses to seed an entry with no magnet (the only synchronous guard)", () => {
    const q = new DownloadQueue();
    q.startSeeding(h({ id: "h2", magnet: "" }));
    expect(q.getSeed("h2")?.status).toBe("missing");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("persistSync flushes every state file without touching the engine", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: "h3" })]);
    // No engine work, so this never spins up webtorrent and never throws even
    // with a populated history.
    expect(() => q.persistSync()).not.toThrow();
  });

  it("restores a paused seed as paused and does not auto-start it", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: "h4" })]);
    // A deliberately paused seed must come back paused (visible), not seeding,
    // and without spinning up the engine.
    q.restoreSeeds([{ id: "h4", status: "paused" }]);
    expect(q.getSeed("h4")?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });
});

describe("strayDownload (missing-file safety-net)", () => {
  it("ignores a present file being verified (disk read, no network speed)", () => {
    // Large file mid-verify: progress < 1 but network speed is 0.
    expect(strayDownload({ total: 50e9, progress: 0.4, speed: 0 })).toBe(false);
  });

  it("ignores a complete, healthy seed", () => {
    expect(strayDownload({ total: 8e9, progress: 1, speed: 0 })).toBe(false);
  });

  it("flags a seed that is actually pulling missing data off the network", () => {
    expect(strayDownload({ total: 8e9, progress: 0.2, speed: 2e6 })).toBe(true);
  });

  it("ignores a seed before metadata has arrived (total unknown)", () => {
    expect(strayDownload({ total: 0, progress: 0, speed: 0 })).toBe(false);
  });
});


describe("safeDeleteAssociatedFiles", () => {
  it("deletes only paths associated with a torrent inside its download directory", async () => {
    const { mkdtemp, writeFile, mkdir, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { safeDeleteAssociatedFiles } = await import("./engine");

    const root = await mkdtemp(join(tmpdir(), "torlink-delete-"));
    await mkdir(join(root, "Torrent Name"));
    await writeFile(join(root, "Torrent Name", "file.mkv"), "data");
    const outside = join(root, "..", "outside.txt");
    await writeFile(outside, "keep");

    const deleted = safeDeleteAssociatedFiles(root, "Torrent Name", [
      "Torrent Name/file.mkv",
      "../outside.txt",
    ]);

    expect(deleted).toContain(join(root, "Torrent Name", "file.mkv"));
    await expect(stat(join(root, "Torrent Name", "file.mkv"))).rejects.toThrow();
    await expect(stat(outside)).resolves.toBeTruthy();
  });
});
