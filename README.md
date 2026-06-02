# WCL GitHub API Mechanism

Окремий механізм збору Warcraft Logs статистики для гільдії з Battle.net roster та збереженням snapshot-даних у GitHub repository JSON.

## Що робить

- Бере roster гільдії з Battle.net Profile API.
- Бере останні звіти гільдії з Warcraft Logs GraphQL API.
- Інспектує encounter pulls: `KILL` / `WIPE`.
- Для кожного члена гільдії зберігає до 10 останніх пулів.
- Рахує:
  - середнє за останні 3 пули;
  - максимум за останні 10;
  - мінімум за останні 10;
  - kill/wipe rate;
  - середню тривалість;
  - смерті персонажа;
  - смерті рейду;
  - стабільність/консистентність.
- Записує дані в GitHub як JSON:
  - `data/wcl/members/{region}/{realm}/{character}.json`
  - `data/wcl/index.json`
  - `data/wcl/jobs/latest.json`

## Важливо

GitHub — це не база реального часу. Цей механізм зроблений як snapshot/cache storage. Не запускай refresh одночасно з кількох місць, бо GitHub Contents API може повернути `409 Conflict`.

## Мінімальна інтеграція в Next.js App Router

Скопіюй:

```txt
src/lib/wcl-github/*
src/app/api/wcl-github/*
```

Після цього доступні API:

```txt
POST /api/wcl-github/refresh
GET  /api/wcl-github/index
GET  /api/wcl-github/member/{slug}
```

Refresh захищений секретом:

```bash
curl -X POST "https://your-domain/api/wcl-github/refresh" \
  -H "x-refresh-secret: $WCL_REFRESH_SECRET"
```

## Конфіг і секрети

Нечутливі параметри винесені в окремий файл:

```txt
src/lib/wcl-github/config.ts
```

Там зберігаються:

```txt
BATTLENET_REGION=eu
BATTLENET_LOCALE=en_GB
BATTLENET_GUILD_REALM_SLUG=terokkar
BATTLENET_GUILD_NAME_SLUG=mistblossom-vanguard
WCL_DATA_REPO_OWNER=LihvoDruida
WCL_DATA_REPO_NAME=mistblossom-wcl-data
WCL_DATA_REPO_BRANCH=main
WCL_DATA_PREFIX=data/wcl
WCL_GUILD_NAME=Mistblossom Vanguard
WCL_GUILD_REALM_SLUG=terokkar
WCL_GUILD_REGION=eu
WCL_REPORT_LIMIT=12
WCL_MAX_REPORT_PAGES=2
WCL_MAX_PULLS_PER_MEMBER=10
WCL_RECENT_AVG_WINDOW=3
```

У `.env` / Vercel Secrets залишаються:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
WCL_DATA_REPO_TOKEN=
WCL_REFRESH_SECRET=
```

`WCL_CLIENT_ID` і `BATTLENET_CLIENT_ID` залишені в secrets за твоєю вимогою.

`WCL_MAX_PULLS_PER_MEMBER` у конфігу за замовчуванням = `10`. Не став `1`, бо тоді ламається сенс механіки: максимум/мінімум за останні 10 пулів рахуватися не буде.

Дивись `.env.example` і `src/lib/wcl-github/config.ts`.

## Рекомендований cron

- Для Vercel Cron або GitHub Actions: кожні 30-60 хвилин.
- Для ручного запуску після рейду: кнопка в адмін-панелі.
- Для live raid — обережно, WCL може оновлювати логи із затримкою.
- Для GitHub Actions URL refresh-endpoint краще тримати в GitHub Variables, а `WCL_REFRESH_SECRET` — у GitHub Secrets.

## Формат member snapshot

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
