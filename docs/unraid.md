# Torlink on Unraid / Docker Compose

This guide deploys Torlink as a small HTTP service for Radarr/Sonarr Torznab access and optional manual qBittorrent adds.

## What runs in the container

The container runs server mode by default:

```bash
node dist/index.js serve
```

It listens on port `9117` and exposes:

- `GET /` browser Web UI
- `GET /health`
- `GET /api?t=caps`
- `GET /api?t=search&q=...`
- `GET /api?t=movie&q=...`
- `GET /api?t=tvsearch&q=...`
- `POST /api/qbit/test`
- `POST /api/qbit/add`

## Radarr / Sonarr indexer settings

Add Torlink as a Torznab indexer.

Use:

```text
URL:     http://HOST:9117/api
API Key: value of TORLINK_API_KEY
```

Replace `HOST` with the Unraid host name or IP address that Radarr/Sonarr can reach.

Important: qBittorrent settings in Torlink are only for Torlink's manual add endpoints. Radarr and Sonarr should keep using their own download-client configuration.

## Environment variables

```text
TORLINK_API_KEY          Required for protected API access.
TORLINK_TORZNAB_EMPTY_QUERY Optional. Fallback search term for Radarr/Sonarr validation requests without q=.
TORLINK_QBIT_URL         Optional. qBittorrent Web UI URL for manual adds.
TORLINK_QBIT_USERNAME    Optional. qBittorrent username for manual adds.
TORLINK_QBIT_PASSWORD    Optional. qBittorrent password for manual adds.
TORLINK_QBIT_CATEGORY    Optional. Category sent to qBittorrent.
TORLINK_QBIT_SAVE_PATH   Optional. Save path sent to qBittorrent.
```

Do not commit real secrets to git. Use placeholders in tracked examples and keep real values in your deployment override or secret manager.

## Compose Manager note for Unraid

Unraid's Compose Manager UI may show an `.env` editor, but values shown there are not always injected into recreated containers. The more reliable pattern is to place real runtime variables in `docker-compose.override.yml` under the service `environment:` section.

Example `docker-compose.override.yml`:

```yaml
services:
  torlink:
    environment:
      TORLINK_API_KEY: "replace-with-your-real-long-random-key"
      TORLINK_TORZNAB_EMPTY_QUERY: "avatar"
      TORLINK_QBIT_URL: "http://qbittorrent:8080"
      TORLINK_QBIT_USERNAME: "replace-with-qbit-user"
      TORLINK_QBIT_PASSWORD: "replace-with-qbit-password"
      TORLINK_QBIT_CATEGORY: "torlink"
      TORLINK_QBIT_SAVE_PATH: ""
```

After changing environment variables, recreate/redeploy the container. Environment variables are applied when the container is created, not dynamically while it is running.

## Basic deployment

From the Torlink repo or a copied deployment directory:

```bash
docker compose -f docker-compose.example.yml up -d --build
```

For Unraid Compose Manager, create a stack using the compose example, then add your real values in `docker-compose.override.yml` as shown above.

## Web UI

Open the Torlink browser UI at:

```text
http://HOST:9117/
```

The UI can search Torlink, copy magnet links, and send a result to Torlink's optional qBittorrent endpoint. If `TORLINK_API_KEY` is configured, click `Set API Key` in the UI and paste the same key used by Radarr/Sonarr.

## Verification

Health check:

```bash
curl -fsS http://HOST:9117/health
```

Expected:

```json
{"status":"ok"}
```

Torznab capabilities:

```bash
curl -fsS "http://HOST:9117/api?t=caps&apikey=YOUR_TORLINK_API_KEY"
```

qBittorrent connection test, only if qBittorrent env vars are configured:

```bash
curl -fsS -X POST \
  -H "X-Api-Key: YOUR_TORLINK_API_KEY" \
  http://HOST:9117/api/qbit/test
```

If qBittorrent is not configured, this endpoint should return a clear `qBittorrent not configured` JSON response.

## Troubleshooting

Check the container environment after redeploying:

```bash
docker inspect torlink --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^TORLINK_'
```

Check logs:

```bash
docker logs torlink
```

If Radarr/Sonarr can reach `/health` but not Torznab caps, confirm the Torznab URL is exactly:

```text
http://HOST:9117/api
```

and that the API key matches `TORLINK_API_KEY`.
