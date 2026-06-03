# GitHub-only WCL data store setup

This repository refreshes Warcraft Logs snapshots inside GitHub Actions and publishes static JSON files that can be consumed like an API through GitHub Pages.

## Required GitHub Actions secrets

Repository → Settings → Secrets and variables → Actions → Secrets:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
```

Do not add `GITHUB_TOKEN`. The workflow uses GitHub Actions built-in token with `permissions: contents: write`.

## GitHub Pages

Repository → Settings → Pages:

```txt
Source: Deploy from a branch
Branch: main
Folder: /root
```

API-like URLs:

```txt
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/index.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/members.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/roster-status.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/member/{character-slug}.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/job/latest.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/job/state.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/health.json
```

## Incremental refresh strategy

The workflow does not refresh the full roster every run. Every hour it selects a small batch of members:

1. Members without snapshots first.
2. Then members whose snapshots are older than `minMemberRefreshAgeHours`.
3. If no one is missing/stale, the oldest fresh snapshots are rotated anyway, so the hourly job never stands still.
4. Existing JSON snapshots are merged with newly found pulls, so every member keeps the latest 10 pulls.

Default limits are in `src/lib/wcl-github/config.ts`:

```ts
memberBatchSize: 8,
minMemberRefreshAgeHours: 12,
maxFightsPerRun: 10,
maxQueriesPerRun: 45,
requestDelayMs: 650,
reportLimit: 8,
maxReportPages: 1,
maxPullsPerMember: 10,
recentAvgWindow: 3,
```

These defaults are intentionally conservative for a 3,600 points/hour Warcraft Logs limit. The real protection is the combination of `maxQueriesPerRun`, `maxFightsPerRun`, sequential requests, and hourly rolling member batches.

## Manual run overrides

Actions → Refresh WCL GitHub snapshots → Run workflow:

```txt
batch_size = 12
max_fights = 15
max_queries = 60
```

Leave fields empty to use config defaults.

## Generated state files

Persistent data:

```txt
data/wcl/index.json
data/wcl/jobs/latest.json
data/wcl/jobs/refresh-state.json
data/wcl/members/eu/terokkar/{character}.json
```

Public API copy:

```txt
api/wcl/index.json
api/wcl/members.json
api/wcl/roster-status.json
api/wcl/job/latest.json
api/wcl/job/state.json
api/wcl/member/{character-slug}.json
```

`roster-status.json` and `job/state.json` show which members were updated, pending, skipped as fresh, rotated as fresh, or still missing snapshots.

Each member pull also includes `wclRaw`, which stores the matched original Warcraft Logs damage/healing rows, matched death events, and the processing decision used for DPS/HPS and role detection.
