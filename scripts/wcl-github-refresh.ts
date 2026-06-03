import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadGuildMembersFromBattleNet } from "../src/lib/wcl-github/battleNetRoster";
import { refreshWclGithubSnapshotsForMembers } from "../src/lib/wcl-github/collector";
import { isWclBudgetError } from "../src/lib/wcl-github/wclClient";
import { getWclGithubEnv } from "../src/lib/wcl-github/env";
import {
  buildIncrementalRefreshState,
  dedupeGuildMembers,
  loadExistingMemberSnapshots,
  selectMembersForIncrementalRefresh,
  snapshotListForCurrentRoster,
} from "../src/lib/wcl-github/incrementalState";
import { indexPath, latestJobPath, memberPath, refreshStatePath } from "../src/lib/wcl-github/slug";
import { buildGuildIndex } from "../src/lib/wcl-github/stats";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const normalized = filePath.replace(/^\/+/, "");
  await mkdir(path.dirname(normalized), { recursive: true });
  await writeFile(normalized, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareGeneratedFolders(prefix: string): Promise<void> {
  await mkdir(path.join(prefix, "members"), { recursive: true });
  await mkdir(path.join(prefix, "jobs"), { recursive: true });
  await rm("api/wcl", { recursive: true, force: true });
  await mkdir("api/wcl/member", { recursive: true });
  await mkdir("api/wcl/job", { recursive: true });
}

async function main(): Promise<void> {
  const env = getWclGithubEnv();
  const updatedAt = new Date().toISOString();
  await prepareGeneratedFolders(env.githubDataPrefix);

  const roster = dedupeGuildMembers(
    await loadGuildMembersFromBattleNet({
      clientId: env.battleNetClientId,
      clientSecret: env.battleNetClientSecret,
      region: env.battleNetRegion,
      locale: env.battleNetLocale,
      realmSlug: env.battleNetGuildRealmSlug,
      guildNameSlug: env.battleNetGuildNameSlug,
    }),
  );

  const existingSnapshots = await loadExistingMemberSnapshots(env.githubDataPrefix);
  const selection = selectMembersForIncrementalRefresh(roster, existingSnapshots, {
    batchSize: env.memberBatchSize,
    minAgeHours: env.minMemberRefreshAgeHours,
    now: new Date(updatedAt),
  });

  const warnings: string[] = [];
  let reportsScanned = 0;
  let fightsScanned = 0;
  let wclQueriesUsed = 0;
  let updatedSnapshots = 0;
  const updatedSlugs: string[] = [];

  if (selection.selected.length > 0) {
    try {
      const result = await refreshWclGithubSnapshotsForMembers(selection.selected, {
        existingSnapshots,
        maxFightsPerRun: env.maxFightsPerRun,
        maxQueriesPerRun: env.maxWclQueriesPerRun,
        requestDelayMs: env.wclRequestDelayMs,
      });

      reportsScanned = result.reportsScanned;
      fightsScanned = result.fightsScanned;
      wclQueriesUsed = result.wclQueriesUsed;
      warnings.push(...result.warnings);

      for (const snapshot of result.snapshots) {
        existingSnapshots.set(snapshot.character.slug, snapshot);
        await writeJson(
          memberPath(env.githubDataPrefix, snapshot.character.region, snapshot.character.realmSlug, snapshot.character.name),
          snapshot,
        );
        updatedSnapshots += 1;
        updatedSlugs.push(snapshot.character.slug);
      }
    } catch (error) {
      if (!isWclBudgetError(error)) throw error;
      warnings.push(`WCL refresh skipped because the query budget was reached before usable data could be collected: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push(
      `No members were eligible for refresh. Lower WCL_MIN_MEMBER_REFRESH_AGE_HOURS or run after the next eligibility window if you need a forced scan.`,
    );
  }

  const allCurrentSnapshots = snapshotListForCurrentRoster(roster, existingSnapshots);
  const index = buildGuildIndex(
    {
      name: env.wclGuildName,
      realmSlug: env.wclGuildRealmSlug,
      region: env.wclGuildRegion,
    },
    allCurrentSnapshots,
    reportsScanned,
    fightsScanned,
  );

  const state = buildIncrementalRefreshState({
    updatedAt,
    guild: {
      name: env.wclGuildName,
      realmSlug: env.wclGuildRealmSlug,
      region: env.wclGuildRegion,
    },
    roster,
    snapshots: existingSnapshots,
    selectedSlugs: selection.selectedSlugs,
    updatedSlugs,
    pendingSlugs: selection.pendingSlugs,
    skippedFreshSlugs: selection.skippedFreshSlugs,
    missingSnapshotSlugs: selection.missingSnapshotSlugs,
    rotatedFreshSlugs: selection.rotatedFreshSlugs,
    limits: {
      memberBatchSize: env.memberBatchSize,
      minMemberRefreshAgeHours: env.minMemberRefreshAgeHours,
      maxFightsPerRun: env.maxFightsPerRun,
      maxQueriesPerRun: env.maxWclQueriesPerRun,
      requestDelayMs: env.wclRequestDelayMs,
      maxPullsPerMember: env.maxPullsPerMember,
      recentAvgWindow: env.recentAvgWindow,
    },
  });

  const latestJob = {
    ok: true,
    updatedAt,
    generatedInside: "github-actions",
    mode: "incremental-hourly-rolling-members",
    rosterMembers: roster.length,
    selectedMembers: selection.selectedSlugs.length,
    updatedMembers: updatedSnapshots,
    existingSnapshots: allCurrentSnapshots.length,
    reportsScanned,
    fightsScanned,
    wclQueriesUsed,
    wclQueriesRemaining: Math.max(0, env.maxWclQueriesPerRun - wclQueriesUsed),
    limits: state.limits,
    batch: state.batch,
    warnings,
    api: {
      index: "api/wcl/index.json",
      members: "api/wcl/members.json",
      rosterStatus: "api/wcl/roster-status.json",
      memberPattern: "api/wcl/member/{character-slug}.json",
      latestJob: "api/wcl/job/latest.json",
      refreshState: "api/wcl/job/state.json",
    },
  };

  for (const snapshot of allCurrentSnapshots) {
    await writeJson(`api/wcl/member/${snapshot.character.slug}.json`, snapshot);
  }

  await writeJson(indexPath(env.githubDataPrefix), index);
  await writeJson(latestJobPath(env.githubDataPrefix), latestJob);
  await writeJson(refreshStatePath(env.githubDataPrefix), state);

  await writeJson("api/wcl/index.json", index);
  await writeJson("api/wcl/members.json", index.members);
  await writeJson("api/wcl/roster-status.json", state.members);
  await writeJson("api/wcl/job/latest.json", latestJob);
  await writeJson("api/wcl/job/state.json", state);
  await writeJson("api/wcl/health.json", {
    ok: true,
    updatedAt,
    mode: "incremental-hourly-rolling-members",
    rosterMembers: roster.length,
    selectedMembers: selection.selectedSlugs.length,
    updatedMembers: updatedSnapshots,
    existingSnapshots: allCurrentSnapshots.length,
    reportsScanned,
    fightsScanned,
    wclQueriesUsed,
    wclQueriesRemaining: Math.max(0, env.maxWclQueriesPerRun - wclQueriesUsed),
    warnings,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        updatedAt,
        mode: "incremental-hourly-rolling-members",
        rosterMembers: roster.length,
        selectedMembers: selection.selectedSlugs.length,
        updatedMembers: updatedSnapshots,
        existingSnapshots: allCurrentSnapshots.length,
        reportsScanned,
        fightsScanned,
        wclQueriesUsed,
        wclQueriesRemaining: Math.max(0, env.maxWclQueriesPerRun - wclQueriesUsed),
        rotatedFreshMembers: selection.rotatedFreshSlugs.length,
        pendingMembers: selection.pendingSlugs.length,
        skippedFreshMembers: selection.skippedFreshSlugs.length,
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
