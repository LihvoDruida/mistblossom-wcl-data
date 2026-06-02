# Integration notes

## Path alias

Код використовує alias `@/lib/...`. Якщо у тебе вже Next.js, це зазвичай є в `tsconfig.json`.

Якщо alias нема, додай:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```


## Конфіг без зайвих секретів

У `.env` більше не треба тримати назву гільдії, realm, region, GitHub repo, branch, data prefix і ліміти сканування. Це не секрети. Вони лежать тут:

```txt
src/lib/wcl-github/config.ts
```

Конфіг уже заповнений під:

```txt
GitHub repo: LihvoDruida/mistblossom-wcl-data
Guild: Mistblossom Vanguard, EU-Terokkar
Battle.net guild slug: mistblossom-vanguard
Data prefix: data/wcl
```

У secrets залиш:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
WCL_DATA_REPO_TOKEN=
WCL_REFRESH_SECRET=
```

`WCL_CLIENT_ID` і `BATTLENET_CLIENT_ID` залишені в secrets за вимогою.

## Роль персонажа

Battle.net roster сам по собі не гарантує коректний role/spec для конкретного пулу. У коді:
- якщо `roleHint = healer`, primary metric = HPS;
- якщо `roleHint = dps/tank`, primary metric = DPS;
- якщо `unknown`, primary вибирається автоматично за більшим значенням.

Для твого dashboard краще додати roleHint із профілю користувача/персонажа.

## Частота запуску

Не запускай refresh паралельно. Для GitHub Contents API записи мають бути серійними.

## Оптимізація запитів WCL

Механізм робить table запити на fight:
- DamageDone;
- Healing;
- Deaths events.

Це спеціально краще, ніж робити запит на кожного члена гільдії окремо.
