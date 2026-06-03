# GitHub-only integration notes

## Архітектура

Тепер основний режим не використовує dashboard endpoint:

```txt
GitHub Actions
  → npm run wcl:refresh
  → Battle.net roster
  → Warcraft Logs guild reports/fights/tables/deaths
  → data/wcl/*.json
  → api/wcl/*.json
  → git commit + git push
```

Це прибирає проблему `401` від Cloudflare Access / admin-домену, бо GitHub більше не викликає `https://admin.lihvodruida.pp.ua/api/wcl-github/refresh`.

## Secrets у GitHub

Потрібні тільки:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
```

Не додавай `GITHUB_TOKEN` вручну. У GitHub Actions він існує автоматично. Для запису JSON у repo workflow має:

```yaml
permissions:
  contents: write
```

## API-like читання

Після workflow dashboard/сайт може читати JSON як звичайний API:

```txt
GET https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/index.json
GET https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/members.json
GET https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/member/khayen-terokkar-eu.json
GET https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/job/latest.json
```

Fallback без GitHub Pages:

```txt
GET https://raw.githubusercontent.com/LihvoDruida/mistblossom-wcl-data/main/api/wcl/index.json
```

## Refresh як API

Публічний `WCL_REFRESH_URL` більше не потрібен.

Якщо треба запускати refresh з іншої системи, правильно викликати GitHub REST workflow dispatch endpoint:

```txt
POST /repos/LihvoDruida/mistblossom-wcl-data/actions/workflows/wcl-refresh.yml/dispatches
```

Для цього потрібен окремий GitHub PAT з мінімальним доступом до Actions. Не використовуй WCL/Battle.net secrets у зовнішніх клієнтах.

## Роль персонажа

Battle.net roster не дає надійний role/spec для конкретного пулу. Зараз:

- `roleHint = healer` → primary metric = HPS;
- `roleHint = dps/tank` → primary metric = DPS;
- `unknown` → primary вибирається автоматично за більшим значенням.

Для максимально точної статистики краще пізніше підключити roleHint із dashboard-профілю персонажа або окремого `data/config/roles.json`.

## Частота запуску

Поточний cron:

```txt
*/45 * * * *
```

Для WCL цього достатньо. Частіше запускати без сенсу: Warcraft Logs може оновлювати дані із затримкою, а зайві запити тільки збільшують шанс rate limit.
