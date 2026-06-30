# torlink Container + Torznab + Web UI Management Plan

> Hermes role: project manager / reviewer / test runner. Do not code directly unless the user explicitly asks. Use Aider + DeepSeek as the coding worker.

## Goal

Turn torlink from a terminal-only torrent finder into a containerized indexer/manual-search appliance that can:

1. Serve Radarr/Sonarr-compatible Torznab search results.
2. Let Radarr/Sonarr use their existing qBittorrent download-client flow.
3. Let a user manually search from a browser and send selected magnets to qBittorrent.
4. Optionally expose the existing torlink TUI in a browser via a locked-down terminal bridge.

## Non-goals for the first version

- Do not make torlink replace Radarr/Sonarr import logic.
- Do not make torlink auto-download everything Radarr/Sonarr searches.
- Do not expose a general shell through the browser terminal.
- Do not require public cloud services.
- Do not add uncontrolled public dependencies beyond normal npm packages and optional ttyd/wetty container tooling.

## High-level architecture

Existing torlink code remains the search/source engine.

New pieces:

- API server process: `torlnk serve`
- JSON manual search endpoint for the web UI
- Torznab-compatible XML endpoint for Radarr/Sonarr
- qBittorrent Web API client for manual downloads
- Dockerfile and Compose example
- Optional browser terminal service for the TUI, probably ttyd first

Preferred flow:

Radarr/Sonarr:

```text
Radarr/Sonarr -> torlink Torznab API -> torlink search engine -> XML results with magnets
Radarr/Sonarr -> qBittorrent using existing download-client config
```

Manual browser use:

```text
Browser web UI -> torlink JSON search API -> results table -> send selected magnet -> qBittorrent Web API
```

Optional browser TUI:

```text
Browser -> ttyd/xterm -> torlnk TUI inside container
```

## Proposed ports

- `9117`: Torznab/API service, Jackett-like convention.
- `3000`: Web UI, if separated from API.
- `7681`: Optional browser TUI via ttyd/wetty.

It is acceptable to combine API + web UI on one port later.

## Configuration

Environment variables for container deployment:

```text
TORLINK_API_KEY=change-me
TORLINK_PORT=9117
TORLINK_PUBLIC_BASE_URL=http://unraid-ip:9117
TORLINK_QBIT_URL=http://qbittorrent:8080
TORLINK_QBIT_USERNAME=admin
TORLINK_QBIT_PASSWORD=...
TORLINK_QBIT_CATEGORY=manual
TORLINK_QBIT_SAVE_PATH=
TORLINK_ENABLE_WEB_UI=true
TORLINK_ENABLE_WEB_TUI=false
```

Secrets belong in environment variables or Docker secrets, not committed config.

## Phase 0: Baseline and branch

Objective: Make sure the worker starts from a clean verified repo.

Hermes checks:

```bash
git status --short
npx -y -p node@22 -p pnpm@10.34.4 -c 'pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true && pnpm run typecheck && pnpm test && pnpm run build'
```

Expected:

- Working tree clean before changes.
- Typecheck passes.
- Tests pass.
- Build passes.

Worker prompt:

```text
You are working in /home/hermes/torlink. Create a new branch named feature/container-torznab-webui. Do not implement features yet. Verify the existing test/build baseline using Node 22 and pnpm. Report exact command output summary and any blockers.
```

Acceptance:

- Branch exists.
- Baseline is recorded in commit or notes.
- No app code changed.

## Phase 1: Refactor search into a reusable service

Objective: Extract the search logic currently embedded in the React hook into a plain TypeScript service usable by both the TUI and future API.

Files likely involved:

- `src/ui/hooks/useConcurrentSearch.ts`
- Create `src/search/concurrent.ts`
- Add `src/search/concurrent.test.ts`

Required behavior:

- Preserve existing source list from `src/sources/registry.ts`.
- Preserve per-source timeout behavior.
- Preserve dedupe by infoHash, preferring highest seeders.
- Preserve default ordering: highest seeders first, then newest `added`.
- Preserve per-source status/errors.
- TUI hook should become a thin React wrapper around the service.

Worker prompt:

```text
Refactor torlink search into a reusable non-React service. Create `src/search/concurrent.ts` with a function that performs concurrent searches across SOURCES and returns merged results plus per-source status. Keep current behavior from `src/ui/hooks/useConcurrentSearch.ts`: 25s per-source timeout, error code mapping, dedupe by infoHash preferring higher seeders, default sorting by seeders then added. Update the React hook to call this service without changing UI behavior. Add focused tests for dedupe, ordering, per-source errors, and timeout/abort behavior. Do not add API server code yet.
```

Hermes acceptance checks:

```bash
npx -y -p node@22 -p pnpm@10 -c 'pnpm run typecheck && pnpm test && pnpm run build'
```

Manual review points:

- No search behavior regression.
- No React imports in the reusable search service.
- Tests mock sources rather than hitting live torrent sites.

## Phase 2: Add basic HTTP server mode

Objective: Add `torlnk serve` with health and JSON search endpoints.

Possible dependency:

- Prefer `hono` or `fastify`; pick one lightweight server package.

Endpoints:

```text
GET /health
GET /api/search?q=<query>&group=<optional>
```

Response shape for `/api/search`:

```json
{
  "query": "matrix",
  "count": 12,
  "results": [
    {
      "infoHash": "...",
      "name": "...",
      "sizeBytes": 123,
      "seeders": 50,
      "leechers": 2,
      "source": "yts",
      "magnet": "magnet:?xt=...",
      "added": 1234567890
    }
  ],
  "sources": {
    "yts": { "loading": false, "error": null, "code": null, "count": 3 }
  }
}
```

Authentication:

- If `TORLINK_API_KEY` is set, require it using either:
  - `X-Api-Key: <key>`
  - `apikey=<key>` query param for Torznab compatibility later.

Worker prompt:

```text
Add a server mode to torlink. Extend CLI parsing so `torlnk serve` starts an HTTP server. Implement `GET /health` and `GET /api/search?q=...`. Reuse the Phase 1 search service. Add API-key auth when `TORLINK_API_KEY` is set, accepting `X-Api-Key` or `apikey` query param. Keep existing TUI launch behavior unchanged for `torlnk` with no args. Add tests for CLI parsing, auth middleware, health, and search endpoint with mocked search service.
```

Acceptance:

```bash
npx -y -p node@22 -p pnpm@10 -c 'pnpm run typecheck && pnpm test && pnpm run build'
TORLINK_API_KEY=test npx -y -p node@22 -p pnpm@10 -c 'pnpm start -- serve'
# Then verify from another shell:
curl -i http://127.0.0.1:9117/health
curl -i 'http://127.0.0.1:9117/api/search?q=ubuntu&apikey=test'
```

Expected:

- Unauthorized search without key returns 401.
- Authorized search returns JSON.
- Server shuts down cleanly on SIGTERM/SIGINT.

## Phase 3: Add Torznab API

Objective: Make Radarr/Sonarr able to add torlink as a Torznab indexer.

Endpoint:

```text
GET /api?t=caps&apikey=...
GET /api?t=search&q=...
GET /api?t=movie&q=...
GET /api?t=tvsearch&q=...&season=...&ep=...
GET /api?t=download&id=<encoded-result-id>&apikey=...
```

Output:

- `t=caps`: Torznab capabilities XML.
- Search endpoints: RSS XML with Torznab attributes.
- `t=download`: redirect to magnet or return magnet text in a way Radarr/Sonarr accepts.

Categories:

Movies:

- 2000 Movies
- 2010 Movies/Foreign
- 2020 Movies/Other
- 2030 Movies/SD
- 2040 Movies/HD
- 2045 Movies/UHD
- 2050 Movies/BluRay
- 2060 Movies/3D

TV:

- 5000 TV
- 5030 TV/SD
- 5040 TV/HD
- 5045 TV/UHD

Anime:

- 5070 TV/Anime, or keep anime manual-only initially if Sonarr mapping gets messy.

Worker prompt:

```text
Implement a Torznab-compatible API on the existing `/api` path. Support `t=caps`, `t=search`, `t=movie`, `t=tvsearch`, and `t=download`. Use the search service and return RSS XML compatible with Radarr/Sonarr. Include torznab attributes for seeders, peers, size, magneturl, infohash where applicable. Implement stable result IDs that allow `/api?t=download&id=...` to return or redirect to the magnet. Add tests for caps XML, search XML escaping, category mapping, auth, and download by id. Do not add qBittorrent integration in this phase.
```

Hermes acceptance:

- Validate XML with a parser.
- Add in Radarr/Sonarr test instance if available, or at least verify Jackett-like URL shape.
- Confirm no raw unescaped XML-breaking characters in titles/magnets.

## Phase 4: Add qBittorrent client for manual downloads

Objective: Browser/manual users can send a result to qBittorrent.

Do not use this path for Radarr/Sonarr automation by default.

Endpoints:

```text
POST /api/qbit/test
POST /api/qbit/add
```

`POST /api/qbit/add` body:

```json
{
  "magnet": "magnet:?xt=...",
  "category": "manual",
  "savePath": ""
}
```

qBittorrent API calls:

```text
POST /api/v2/auth/login
POST /api/v2/torrents/add
```

Worker prompt:

```text
Add a small qBittorrent Web API client for manual use. Read URL/username/password/category/savePath from env. Add `POST /api/qbit/test` to verify auth and `POST /api/qbit/add` to add a magnet. Do not automatically add torrents during Torznab searches. Add tests using a mocked HTTP qBittorrent server. Ensure credentials are never logged.
```

Acceptance:

- Mock tests pass.
- Manual test against real qBittorrent only after user confirms target host/container.
- Failed login returns useful error without exposing password.

## Phase 5: Container and Unraid deployment

Objective: Provide a reliable container build and Compose example.

Files:

- `Dockerfile`
- `.dockerignore`
- `docker-compose.example.yml`
- `docs/unraid.md`

Container requirements:

- Node 22 runtime.
- Non-root user if practical.
- Healthcheck against `/health`.
- Config via env.
- Optional `ttyd` sidecar for browser TUI, not necessarily inside same image.

Worker prompt:

```text
Add container support for torlink server mode. Create a Dockerfile using Node 22, install dependencies with pnpm, build the app, and run `torlnk serve` by default. Add `.dockerignore`, `docker-compose.example.yml`, and `docs/unraid.md`. Include optional ttyd sidecar service that runs only `torlnk`, not a shell. Add healthcheck. Do not hardcode secrets.
```

Hermes acceptance:

```bash
docker build -t torlink:test .
docker run --rm -p 9117:9117 -e TORLINK_API_KEY=test torlink:test
curl -i http://127.0.0.1:9117/health
curl -i 'http://127.0.0.1:9117/api?t=caps&apikey=test'
```

Unraid-specific review:

- Compose Manager env vars should be in `docker-compose.override.yml` or the Compose file, not trusted only from UI editor.
- Restart policy should be `unless-stopped`.
- Confirm network name and qBittorrent service hostname before deployment.

## Phase 6: Basic web UI

Objective: Make manual browser search useful without needing the TUI.

UI features:

- Search box.
- Source/status summary.
- Results sorted by seeders by default.
- Copy magnet button.
- Send to qBittorrent button.
- Basic error display.

Worker prompt:

```text
Add a simple web UI for manual torlink searches. It should call `/api/search`, show results in a sortable table, display source errors/status, provide copy-magnet and send-to-qBittorrent actions. Keep it simple and server-rendered or static frontend; avoid a large framework unless necessary. Reuse existing auth. Add tests for API endpoints and any pure UI helpers.
```

Acceptance:

- Browser can search.
- Clicking send adds to qBittorrent in a confirmed test environment.
- No secrets exposed to the browser except whether qBittorrent is configured.

## Phase 7: Browser TUI

Objective: Provide web access to the original torlink TUI.

Initial implementation:

- Use ttyd or wetty as an optional sidecar.
- Lock command to `torlnk`, not `/bin/sh`.
- Put behind auth/reverse proxy.

Later optional implementation:

- Integrated xterm.js + PTY WebSocket bridge, similar to Hermes dashboard.

Worker prompt for ttyd sidecar:

```text
Add optional browser TUI support using a sidecar terminal service. The sidecar must launch `torlnk` directly and must not expose a general shell. Document security warnings and reverse-proxy/auth expectations. Keep this optional and disabled by default in docs/examples.
```

Acceptance:

- Opening browser TUI launches torlink TUI.
- Exiting TUI does not drop to shell.
- Terminal service is disabled unless explicitly enabled.

## Hermes management workflow

Hermes manages the project by:

1. Keeping this plan updated.
2. Producing one Aider/DeepSeek prompt per phase/task.
3. Running verification after worker changes.
4. Reviewing diffs for scope creep, security, and Radarr/Sonarr compatibility.
5. Asking the user before any real qBittorrent/Unraid deployment action.
6. Maintaining a punch list of blockers and decisions.

Hermes should not directly code unless explicitly asked.

## Standing review checklist

For every worker change:

- `git diff --stat` is reasonable for the phase.
- No secrets committed.
- Existing `torlnk` TUI behavior still works.
- Tests added for new logic.
- Typecheck passes.
- Tests pass.
- Build passes.
- Public API is documented.
- Container behavior is verified before deployment claims.

## Open decisions for the user

1. What qBittorrent host/container URL should be used in Unraid?
2. Should anime sources be exposed to Sonarr as TV anime or manual-only first?
3. Should FitGirl/games be manual-only, or exposed through a custom category?
4. Should browser TUI be ttyd sidecar first, or skip until real web UI exists?
5. What LAN hostname/port should Radarr/Sonarr use for torlink?
