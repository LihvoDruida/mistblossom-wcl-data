# GitHub setup checklist

## 1. Secrets

Repository:

```txt
LihvoDruida/mistblossom-wcl-data
```

Path:

```txt
Settings → Secrets and variables → Actions → Secrets
```

Add:

```env
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
```

Do not add:

```env
GITHUB_TOKEN=
WCL_DATA_REPO_TOKEN=
WCL_REFRESH_SECRET=
WCL_REFRESH_URL=
```

## 2. Actions permissions

Path:

```txt
Settings → Actions → General → Workflow permissions
```

Set:

```txt
Read and write permissions
```

The workflow also contains:

```yaml
permissions:
  contents: write
```

## 3. Enable GitHub Pages

Path:

```txt
Settings → Pages → Build and deployment
```

Set:

```txt
Source: Deploy from a branch
Branch: main
Folder: /root
```

Save.

## 4. Optional local Battle.net check

Перед повним запуском можеш перевірити тільки roster:

```bash
npm ci
BATTLENET_CLIENT_ID=... BATTLENET_CLIENT_SECRET=... npm run bnet:check
```

Якщо буде `Battle.net roster request failed 404`, перевір `battleNet.guildRealmSlug` і `battleNet.guildNameSlug` у `src/lib/wcl-github/config.ts`.

## 5. Run refresh

Path:

```txt
Actions → Refresh WCL GitHub snapshots → Run workflow
```

After success, check these files:

```txt
data/wcl/index.json
data/wcl/jobs/latest.json
api/wcl/index.json
api/wcl/members.json
api/wcl/job/latest.json
```

## 6. API-like URLs

GitHub Pages:

```txt
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/index.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/members.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/member/{slug}.json
https://lihvodruida.github.io/mistblossom-wcl-data/api/wcl/job/latest.json
```

Raw fallback:

```txt
https://raw.githubusercontent.com/LihvoDruida/mistblossom-wcl-data/main/api/wcl/index.json
```

## 7. Optional external refresh through GitHub API

Use GitHub workflow dispatch API. It requires a GitHub token with permission to run Actions.

```bash
curl -X POST \
  "https://api.github.com/repos/LihvoDruida/mistblossom-wcl-data/actions/workflows/wcl-refresh.yml/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_PAT_WITH_ACTIONS_WRITE" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{"ref":"main"}'
```


## NPM registry note

The workflow uses the public npm registry through `.npmrc` and installs dependencies with `npm ci`. Do not commit a lockfile that contains private/internal registry URLs.
