import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { refreshWclGithubSnapshots } from "../src/lib/wcl-github/collector";
import { getWclGithubEnv } from "../src/lib/wcl-github/env";
import { indexPath, latestJobPath, memberPath } from "../src/lib/wcl-github/slug";
import { buildGuildIndex } from "../src/lib/wcl-github/stats";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const normalized = filePath.replace(/^\/+/, "");
  await mkdir(path.dirname(normalized), { recursive: true });
  await writeFile(normalized, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resetGeneratedFolders(prefix: string): Promise<void> {
  await rm(prefix, { recursive: true, force: true });
  await rm("api/wcl", { recursive: true, force: true });
  await mkdir(prefix, { recursive: true });
  await mkdir("api/wcl/member", { recursive: true });
  await mkdir("api/wcl/job", { recursive: true });
}

async function main(): Promise<void> {
  const env = getWclGithubEnv();
  await resetGeneratedFolders(env.githubDataPrefix);

  const { snapshots, reportsScanned, fightsScanned, warnings } = await refreshWclGithubSnapshots();
  const updatedAt = new Date().toISOString();

  const index = buildGuildIndex(
    {
      name: env.wclGuildName,
      realmSlug: env.wclGuildRealmSlug,
      region: env.wclGuildRegion,
    },
    snapshots,
    reportsScanned,
    fightsScanned,
  );

  const latestJob = {
    ok: true,
    updatedAt,
    generatedInside: "github-actions",
    members: snapshots.length,
    reportsScanned,
    fightsScanned,
    writtenFiles: snapshots.length * 2 + 5,
    warnings,
    api: {
      index: "api/wcl/index.json",
      members: "api/wcl/members.json",
      memberPattern: "api/wcl/member/{character-slug}.json",
      latestJob: "api/wcl/job/latest.json",
    },
  };

  for (const snapshot of snapshots) {
    await writeJson(
      memberPath(env.githubDataPrefix, snapshot.character.region, snapshot.character.realmSlug, snapshot.character.name),
      snapshot,
    );
    await writeJson(`api/wcl/member/${snapshot.character.slug}.json`, snapshot);
  }

  await writeJson(indexPath(env.githubDataPrefix), index);
  await writeJson(latestJobPath(env.githubDataPrefix), latestJob);

  await writeJson("api/wcl/index.json", index);
  await writeJson("api/wcl/members.json", index.members);
  await writeJson("api/wcl/job/latest.json", latestJob);
  await writeJson("api/wcl/health.json", { ok: true, updatedAt, members: snapshots.length, warnings });

  console.log(
    JSON.stringify(
      {
        ok: true,
        updatedAt,
        members: snapshots.length,
        reportsScanned,
        fightsScanned,
        warnings,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
