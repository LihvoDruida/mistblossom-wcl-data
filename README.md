# Mistblossom WCL GitHub API Store

This repository runs a conservative incremental Warcraft Logs refresh inside GitHub Actions and exposes the generated JSON as a static API through GitHub Pages.

## What changed in v1.2.0

The refresh is now incremental and hourly:

- only a configured batch of roster members is refreshed per run;
- members with no snapshot are handled first;
- fresh members no longer cause empty runs: if everyone is fresh, the oldest snapshots are rotated hourly;
- WCL GraphQL calls are capped per run;
- detailed fight scans are capped per run;
- WCL requests are sequential with a stronger delay to avoid bursts;
- `api/wcl/roster-status.json` and `api/wcl/job/state.json` show updated / pending / fresh / missing members.

Default safe limits live in `src/lib/wcl-github/config.ts`:

```ts
memberBatchSize: 8,
minMemberRefreshAgeHours: 12,
maxFightsPerRun: 8,
maxQueriesPerRun: 28,
minFightDurationMs: 30_000,
targetNewPullsPerMember: 1,
requestDelayMs: 1_200,
```


## v1.2.0: розумніше оновлення + точніша DPS/HPS логіка

- Порожній run більше не відбувається, коли всі 159 персонажів "fresh". Якщо немає missing/stale, workflow бере найстаріші fresh snapshot-и і рухає чергу далі.
- `api/wcl/job/state.json` тепер показує `rotatedFresh`, тобто кого оновили не тому, що він протермінований, а щоб черга рухалась щогодини.
- DPS/HPS більше не змішуються: healer-пули рахуються через HPS, dps/tank-пули через DPS. У `stats.byRole` є окремі блоки `healer`, `damage`, `unknown`.
- Для кожного pull зберігається `role` з джерелом визначення: `member-role-hint`, `wcl-spec`, `metric-inference` або `unknown`.
- У `wclRaw` зберігаються matched оригінальні рядки Warcraft Logs table для damage/healing, matched death events і блок `processing`, щоб можна було перевірити, як саме сирі WCL-дані перетворились у snapshot.
- `metric.dps/hps` беруть WCL `persecond`, якщо він є. Якщо WCL його не віддав, fallback іде через `entry.totalTime`, `table.totalTime`, а потім `fight.duration`. Active-time DPS/HPS винесені окремо в `metric.activeDps/activeHps` і не змішуються з основними середніми.
- Workflow переведений на Node.js 24 (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `node-version: 24`).

Public JSON endpoints after GitHub Pages is enabled:

```txt
/api/wcl/index.json
/api/wcl/members.json
/api/wcl/roster-status.json
/api/wcl/member/{slug}.json
/api/wcl/job/latest.json
/api/wcl/job/state.json
/api/wcl/health.json
```

---

# Mistblossom WCL Data API

GitHub-only механізм збору Warcraft Logs статистики для гільдії. Він працює без `admin.lihvodruida.pp.ua/api/wcl-github/refresh`:

```txt
GitHub Actions → Battle.net roster + Warcraft Logs → JSON у цьому repo → API-like static JSON endpoints
```

## Що робить

- Бере roster гільдії з Battle.net через endpoint `/data/wow/guild/{realmSlug}/{guildNameSlug}/roster?namespace=profile-{region}`.
- Бере останні guild reports з Warcraft Logs GraphQL API.
- Інспектує encounter pulls: `KILL` / `WIPE`.
- Для кожного члена гільдії зберігає до 10 останніх пулів.
- Рахує:
  - середнє за останні 3 пули;
  - максимум за останні 10;
  - мінімум за останні 10;
  - kill/wipe rate;
  - deaths персонажа;
  - raid deaths у пулі;
  - deaths per pull;
  - stability / consistency.
- Записує нормалізовані JSON-снапшоти у repo.
- Дублює зручні файли в `api/wcl/*`, щоб до них можна було звертатися як до API.


## Виправлення DPS/HPS

У версії `1.0.2` збір WCL-таблиць став стійкішим:

- підтримується реальна форма відповіді `table.data.entries`, а не тільки верхній рівень `table.entries`;
- персонаж зіставляється не лише за `name-realm`, а й за `actor.id` з `masterData.actors`;
- якщо Warcraft Logs повертає імʼя без realm, використовується fallback `name + region`;
- порожні actor-only пули без damage/healing/death більше не записуються як `0 DPS / 0 HPS`;
- у кожному pull додано `actor`, `reportTitle`, `reportStartedAt`, `zone`, `source.damageTotalTimeMs`, `source.healingTotalTimeMs`, `source.matchedBy`.

## GitHub Secrets

У repo `LihvoDruida/mistblossom-wcl-data` додай тільки ці secrets:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
```

`WCL_DATA_REPO_TOKEN` більше не потрібен для GitHub-only режиму. Запис у repo робить вбудований `GITHUB_TOKEN` всередині GitHub Actions, через permission `contents: write`.

`WCL_REFRESH_SECRET` теж не потрібен, бо refresh більше не відкритий як публічний endpoint.


## Швидка перевірка Battle.net roster

Перед повним WCL refresh можна окремо перевірити, чи Battle.net бачить гільдію:

```bash
BATTLENET_CLIENT_ID=... \
BATTLENET_CLIENT_SECRET=... \
npm run bnet:check
```

Якщо тут `404`, проблема не у WCL. Перевір у `src/lib/wcl-github/config.ts`:

```txt
battleNet.guildRealmSlug
battleNet.guildNameSlug
```

Для Retail правильний шлях Battle.net roster іде через `/data/wow/guild/.../roster`, а не через `/profile/wow/guild/.../roster`.

## GitHub Actions

Workflow лежить тут:

```txt
.github/workflows/wcl-refresh.yml
```

Він запускається:

```txt
Actions → Refresh WCL GitHub snapshots → Run workflow
```

Також є cron:

```txt
7 * * * *
```

Тобто інкрементальне оновлення щогодини, але не всієї гільдії одразу, а тільки частини roster за batch-чергою.

## GitHub permissions

У repo перевір:

```txt
Settings → Actions → General → Workflow permissions
```

Має бути дозволено писати в repo. У workflow також уже задано:

```yaml
permissions:
  contents: write
```

## GitHub Pages для API-like доступу

Щоб отримати красиві URL, увімкни GitHub Pages:

```txt
Settings → Pages → Build and deployment
Source: Deploy from a branch
Branch: main
Folder: /root
Save
```

Після першого успішного workflow будуть доступні endpoint-и:

```txt
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/index.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/members.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/member/{character-slug}.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/job/latest.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/health.json
```

Якщо Pages ще не увімкнений, можна читати raw JSON напряму:

```txt
https://raw.githubusercontent.com/LihvoDruida/mistblossom-wcl-data/main/api/wcl/index.json
https://raw.githubusercontent.com/LihvoDruida/mistblossom-wcl-data/main/api/wcl/members.json
https://raw.githubusercontent.com/LihvoDruida/mistblossom-wcl-data/main/api/wcl/member/{character-slug}.json
```

## Формат збереження

Канонічне сховище:

```txt
data/wcl/index.json
data/wcl/jobs/latest.json
data/wcl/members/eu/terokkar/{character}.json
```

API-like дзеркало:

```txt
api/wcl/index.json
api/wcl/members.json
api/wcl/member/{character-slug}.json
api/wcl/job/latest.json
api/wcl/health.json
```

## Приклад member snapshot

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-03T00:00:00.000Z",
  "character": {
    "name": "Khayen",
    "realmSlug": "terokkar",
    "region": "eu",
    "slug": "khayen-terokkar-eu"
  },
  "stats": {
    "pullsStored": 10,
    "kills": 4,
    "wipes": 6,
    "killRate": 0.4,
    "recent3": {
      "avgDps": 0,
      "avgHps": 95000,
      "avgPrimary": 95000,
      "avgDurationMs": 245000,
      "avgDeaths": 0.33
    },
    "last10": {
      "maxDps": 0,
      "minDps": 0,
      "maxHps": 123000,
      "minHps": 75000,
      "maxPrimary": 123000,
      "minPrimary": 75000
    }
  },
  "pulls": []
}
```

## Ручний запуск через GitHub API

Якщо треба запускати refresh не з UI GitHub, а як API-запит, використовуй GitHub workflow dispatch API:

```bash
curl -X POST \
  "https://api.github.com/repos/LihvoDruida/mistblossom-wcl-data/actions/workflows/wcl-refresh.yml/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_PAT_WITH_ACTIONS_WRITE" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{"ref":"main"}'
```

Це не публічний refresh endpoint. Це правильно: WCL/Battle.net secrets не мають бути доступні через відкритий URL.

## Конфіг

Нечутливі параметри лежать тут:

```txt
src/lib/wcl-github/config.ts
```

Вже заповнено під:

```txt
GitHub repo: LihvoDruida/mistblossom-wcl-data
Guild: Mistblossom Vanguard, EU-Terokkar
Battle.net guild slug: mistblossom-vanguard
Data prefix: data/wcl
```

## Локальний запуск

```bash
npm install
WCL_CLIENT_ID=... \
WCL_CLIENT_SECRET=... \
BATTLENET_CLIENT_ID=... \
BATTLENET_CLIENT_SECRET=... \
npm run wcl:refresh
```

Окремий smoke-test Battle.net roster:

```bash
BATTLENET_CLIENT_ID=... \
BATTLENET_CLIENT_SECRET=... \
npm run bnet:check
```

Після запуску зʼявляться/оновляться папки:

```txt
data/wcl
api/wcl
```


## NPM registry note

The workflow uses the public npm registry through `.npmrc` and installs dependencies with `npm ci`. Do not commit a lockfile that contains private/internal registry URLs.

## v1.3.0 — budget-aware hourly refresh and guild analytics

This version is designed for safe hourly GitHub Actions runs:

- scans only a rotating batch of roster members every hour;
- keeps a strict local WCL query budget per run;
- stops early when every selected member has received the configured number of new pulls;
- skips accidental micro-pulls shorter than `minFightDurationMs`;
- stores `lastScannedAt`, `lastChangedAt`, `lastPullAt`, and `newPullsInLastScan` per character;
- separates `scannedMembers` from `changedMembers`, so the queue can move even when no new logs exist;
- keeps WCL raw matched rows for DPS/HPS audit without dumping huge full tables.

Default conservative limits live in `src/lib/wcl-github/config.ts`:

```ts
memberBatchSize: 8,
minMemberRefreshAgeHours: 12,
maxFightsPerRun: 8,
maxQueriesPerRun: 28,
minFightDurationMs: 30_000,
targetNewPullsPerMember: 1,
requestDelayMs: 1_200,
```

New API-like JSON outputs:

```txt
api/wcl/analytics.json
api/wcl/bosses.json
api/wcl/classes.json
api/wcl/top/damage.json
api/wcl/top/healing.json
api/wcl/top/attention.json
api/wcl/job/state.json
api/wcl/job/latest.json
api/wcl/health.json
```

`api/wcl/analytics.json` includes guild-level calculations:

- distinct fight count, kill/wipe rate, average raid deaths;
- average team DPS/HPS by unique fight;
- role analytics for damage/healers/unknown;
- top recent DPS/HPS performers;
- high death-risk and zero-death recent lists;
- stability, consistency, reliability scores;
- boss summaries by encounter/difficulty;
- class summaries;
- freshness coverage for the rolling queue.

For manual Actions runs you can override:

```txt
batch_size
max_fights
max_queries
min_fight_duration_ms
target_new_pulls
```

Use low manual values when WCL points are already high, for example:

```txt
batch_size = 5
max_fights = 5
max_queries = 18
min_fight_duration_ms = 30000
target_new_pulls = 1
```
