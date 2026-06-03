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

## Роль персонажа і DPS/HPS

Battle.net roster не дає надійний role/spec для конкретного пулу, тому роль визначається поетапно:

1. `roleHint` з dashboard/manual config, якщо він є.
2. WCL spec/icon у matched damage/healing entry.
3. Metric inference тільки як fallback.

Primary metric:

- healer → HPS;
- dps/tank → DPS;
- unknown → не змішується з healer/damage summary.

Окремо зберігаються `metric.dps`, `metric.hps`, `metric.activeDps`, `metric.activeHps`, але середні значення у `stats.byRole` не змішують DPS і HPS між різними ролями.

## Частота запуску

Поточний cron:

```txt
7 * * * *
```

Запуск щогодини безпечний, бо кожен run оновлює лише `memberBatchSize` персонажів, має `maxFightsPerRun`, `maxQueriesPerRun` і послідовні WCL-запити з `requestDelayMs`. Якщо всі персонажі ще fresh, система все одно бере найстаріші snapshot-и й позначає їх як `rotatedFresh`, щоб черга не стояла на місці.


## Сирі WCL-дані

У кожному `pull` є `wclRaw`:

```txt
wclRaw.report
wclRaw.fight
wclRaw.tables.damage.matchedEntry
wclRaw.tables.healing.matchedEntry
wclRaw.deaths.matchedEvents
wclRaw.processing
```

Це не повний dump усього report table, бо він буде занадто важкий для GitHub Pages. Зберігається саме matched оригінальна WCL-відповідь для конкретного персонажа + дані обробки. Цього достатньо, щоб дебажити неправильний DPS/HPS, роль, смерть або зіставлення персонажа.
