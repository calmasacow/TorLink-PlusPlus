import { afterEach, describe, expect, it, vi } from "vitest";

describe("defaultDownloadDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses TORLINK_DOWNLOAD_DIR when set so native TUI downloads land on the mounted path", async () => {
    vi.resetModules();
    vi.stubEnv("TORLINK_DOWNLOAD_DIR", "/downloads");

    const paths = await import("./paths");

    expect(paths.defaultDownloadDir).toBe("/downloads");
  });
});
