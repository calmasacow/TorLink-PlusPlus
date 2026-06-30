# Aider / DeepSeek Next Prompt

Use this as the first worker prompt.

```text
You are working in /home/hermes/torlink.

Project goal: convert torlink into a containerized Radarr/Sonarr-compatible Torznab indexer with a manual web UI and optional browser TUI, while preserving the existing terminal TUI.

Important constraints:
- Use Node 22+ and pnpm.
- Do not expose a general shell through any browser terminal feature.
- Do not put secrets in committed files.
- Do not make torlink auto-download Radarr/Sonarr search results; Radarr/Sonarr should still send selected releases to their configured qBittorrent client.
- Manual web UI can send selected magnets to qBittorrent later.
- Keep existing `torlnk` no-argument TUI behavior working.

First task only:
Create a new branch named `feature/container-torznab-webui` and establish a clean baseline. Do not implement feature code yet.

Steps:
1. Check current git status.
2. Create/switch to branch `feature/container-torznab-webui`.
3. Install/verify dependencies using Node 22 and pnpm.
4. Run typecheck, tests, and build.
5. Report exact command summary and any blockers.

Suggested verification command:

npx -y -p node@22 -p pnpm@10.34.4 -c 'pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true && pnpm run typecheck && pnpm test && pnpm run build'

Expected baseline:
- typecheck passes
- tests pass
- build passes

Do not change application code in this first task. This branch has standardized development on pnpm because npm install/ci is unreliable with current transitive dependencies; use `pnpm-lock.yaml` as the lockfile.
```

After this passes, use Phase 1 from:

`docs/plans/torlink-container-torznab-webui-management-plan.md`
