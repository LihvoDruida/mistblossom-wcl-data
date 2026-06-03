import type {
  DeathEntry,
  GuildMemberInput,
  MemberPullSnapshot,
  MemberSnapshot,
  WclActor,
  WclFightSummary,
  WclReportSummary,
  WclTableEntry,
} from "./types";
import { getWclGithubEnv } from "./env";
import { memberKey, memberPath, indexPath, latestJobPath } from "./slug";
import { buildGuildIndex, buildMemberSnapshot, calculatePerSecond, choosePrimaryMetric, difficultyName } from "./stats";
import {
  GUILD_REPORTS_QUERY,
  REPORT_DEATH_EVENTS_QUERY,
  REPORT_FIGHTS_QUERY,
  REPORT_TABLE_QUERY,
  WclClient,
} from "./wclClient";
import { GithubJsonStore } from "./githubJsonStore";
import { loadGuildMembersFromBattleNet } from "./battleNetRoster";

interface GuildReportsResponse {
  reportData: {
    reports: {
      current_page: number;
      last_page: number;
      data: WclReportSummary[];
    };
  };
}

interface ReportFightsResponse {
  reportData: {
    report: {
      code: string;
      title?: string;
      startTime: number;
      endTime?: number;
      masterData?: {
        actors?: WclActor[];
      };
      fights?: WclFightSummary[];
    } | null;
  };
}

interface ReportTableResponse {
  reportData: {
    report: {
      table?: {
        entries?: WclTableEntry[];
        data?: WclTableEntry[];
        totalTime?: number;
        [key: string]: unknown;
      } | null;
    } | null;
  };
}

interface DeathEventsResponse {
  reportData: {
    report: {
      events?: {
        data?: DeathEntry[];
        nextPageTimestamp?: number | null;
      } | null;
    } | null;
  };
}

export async function refreshWclGithubSnapshots(): Promise<{
  snapshots: MemberSnapshot[];
  reportsScanned: number;
  fightsScanned: number;
  warnings: string[];
}> {
  const env = getWclGithubEnv();
  const warnings: string[] = [];

  const members = await loadGuildMembersFromBattleNet({
    clientId: env.battleNetClientId,
    clientSecret: env.battleNetClientSecret,
    region: env.battleNetRegion,
    locale: env.battleNetLocale,
    realmSlug: env.battleNetGuildRealmSlug,
    guildNameSlug: env.battleNetGuildNameSlug,
  });

  const uniqueMembers = dedupeMembers(members);
  const memberMap = new Map(uniqueMembers.map((member) => [memberKey(member.name, member.realmSlug, member.region), member]));
  const pullsByMemberKey = new Map<string, MemberPullSnapshot[]>();
  for (const member of uniqueMembers) pullsByMemberKey.set(memberKey(member.name, member.realmSlug, member.region), []);

  const wcl = new WclClient({
    clientId: env.wclClientId,
    clientSecret: env.wclClientSecret,
    tokenUrl: env.wclTokenUrl,
    graphqlUrl: env.wclGraphqlUrl,
  });

  const reports = await loadGuildReports(wcl, {
    guildName: env.wclGuildName,
    guildServerSlug: env.wclGuildRealmSlug,
    guildServerRegion: env.wclGuildRegion,
    limit: env.wclReportLimit,
    maxPages: env.wclMaxReportPages,
  });

  let fightsScanned = 0;

  for (const report of reports) {
    const reportDetails = await wcl.query<ReportFightsResponse>(REPORT_FIGHTS_QUERY, { code: report.code });
    const fullReport = reportDetails.reportData.report;
    if (!fullReport) {
      warnings.push(`WCL report not found: ${report.code}`);
      continue;
    }

    const actorsByName = buildActorsByName(fullReport.masterData?.actors ?? [], env.wclGuildRegion);
    const fights = (fullReport.fights ?? [])
      .filter((fight) => fight.startTime < fight.endTime)
      .sort((a, b) => b.startTime - a.startTime);

    for (const fight of fights) {
      fightsScanned += 1;

      const [damageTable, healingTable, deaths] = await Promise.all([
        loadTableSafe(wcl, report.code, "DamageDone", fight.startTime, fight.endTime, warnings),
        loadTableSafe(wcl, report.code, "Healing", fight.startTime, fight.endTime, warnings),
        loadDeathsSafe(wcl, report.code, fight.startTime, fight.endTime, warnings),
      ]);

      const damageByName = buildTableByName(damageTable, env.wclGuildRegion);
      const healingByName = buildTableByName(healingTable, env.wclGuildRegion);
      const deathsByName = buildDeathsByName(deaths, env.wclGuildRegion);
      const raidDeaths = deaths.length;

      for (const [key, member] of memberMap) {
        const actor = actorsByName.get(normalizedActorName(member.name, member.realmSlug, member.region));
        const damage = damageByName.get(normalizedActorName(member.name, member.realmSlug, member.region));
        const healing = healingByName.get(normalizedActorName(member.name, member.realmSlug, member.region));

        if (!actor && !damage && !healing) {
          continue;
        }

        const durationMs = Math.max(0, fight.endTime - fight.startTime);
        const damageTotal = numeric(damage?.total);
        const healingTotal = numeric(healing?.total);
        const dps = calculatePerSecond(damageTotal, durationMs);
        const hps = calculatePerSecond(healingTotal, durationMs);
        const primary = choosePrimaryMetric(member.roleHint, dps, hps);
        const characterDeaths = deathsByName.get(normalizedActorName(member.name, member.realmSlug, member.region)) ?? 0;

        const pull: MemberPullSnapshot = {
          key: `${report.code}:${fight.id}:${member.name}:${member.realmSlug}:${member.region}`,
          reportCode: report.code,
          fightId: fight.id,
          url: `https://www.warcraftlogs.com/reports/${report.code}#fight=${fight.id}`,
          status: fight.kill ? "KILL" : "WIPE",
          bossName: fight.name,
          encounterId: fight.encounterID ?? null,
          difficulty: fight.difficulty ?? null,
          difficultyName: difficultyName(fight.difficulty),
          startedAt: new Date(fullReport.startTime + fight.startTime).toISOString(),
          durationMs,
          bossPercentage: fight.bossPercentage ?? null,
          fightPercentage: fight.fightPercentage ?? null,
          averageItemLevel: fight.averageItemLevel ?? null,
          metric: {
            dps,
            hps,
            primary: primary.primary,
            primaryKind: primary.primaryKind,
          },
          deaths: {
            character: characterDeaths,
            raid: raidDeaths,
          },
          source: {
            damageTotal,
            healingTotal,
            damageActiveTimeMs: numericOptional(damage?.activeTime),
            healingActiveTimeMs: numericOptional(healing?.activeTime),
          },
        };

        pullsByMemberKey.get(key)?.push(pull);
      }
    }
  }

  const snapshots = uniqueMembers.map((member) =>
    buildMemberSnapshot(
      member,
      dedupePulls(pullsByMemberKey.get(memberKey(member.name, member.realmSlug, member.region)) ?? []),
      reports.length,
      fightsScanned,
      env.recentAvgWindow,
      env.maxPullsPerMember,
    ),
  );

  return {
    snapshots,
    reportsScanned: reports.length,
    fightsScanned,
    warnings,
  };
}

export async function refreshAndWriteWclGithubSnapshots() {
  const env = getWclGithubEnv();
  const { snapshots, reportsScanned, fightsScanned, warnings } = await refreshWclGithubSnapshots();

  if (!env.githubToken) {
    throw new Error("Missing required secret environment variable: WCL_DATA_REPO_TOKEN");
  }

  const store = new GithubJsonStore({
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubRepo,
    branch: env.githubBranch,
    committerName: env.githubCommitterName,
    committerEmail: env.githubCommitterEmail,
  });

  let writtenFiles = 0;

  for (const snapshot of snapshots) {
    await store.writeJsonSerial(
      memberPath(env.githubDataPrefix, snapshot.character.region, snapshot.character.realmSlug, snapshot.character.name),
      snapshot,
      `chore(wcl): refresh ${snapshot.character.slug}`,
    );
    writtenFiles += 1;
  }

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

  await store.writeJsonSerial(indexPath(env.githubDataPrefix), index, "chore(wcl): refresh guild index");
  writtenFiles += 1;

  await store.writeJsonSerial(
    latestJobPath(env.githubDataPrefix),
    {
      ok: true,
      updatedAt: new Date().toISOString(),
      members: snapshots.length,
      reportsScanned,
      fightsScanned,
      writtenFiles,
      warnings,
    },
    "chore(wcl): refresh latest job status",
  );
  writtenFiles += 1;

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    members: snapshots.length,
    reportsScanned,
    fightsScanned,
    writtenFiles,
    warnings,
  };
}

async function loadGuildReports(
  wcl: WclClient,
  options: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    limit: number;
    maxPages: number;
  },
): Promise<WclReportSummary[]> {
  const reports: WclReportSummary[] = [];

  for (let page = 1; page <= options.maxPages; page += 1) {
    const response = await wcl.query<GuildReportsResponse>(GUILD_REPORTS_QUERY, {
      guildName: options.guildName,
      guildServerSlug: options.guildServerSlug,
      guildServerRegion: options.guildServerRegion,
      limit: options.limit,
      page,
    });

    const pageReports = response.reportData.reports.data ?? [];
    reports.push(...pageReports);

    if (page >= response.reportData.reports.last_page) break;
  }

  return reports
    .filter((report) => report.code && report.startTime)
    .sort((a, b) => b.startTime - a.startTime);
}

async function loadTableSafe(
  wcl: WclClient,
  code: string,
  dataType: "DamageDone" | "Healing",
  startTime: number,
  endTime: number,
  warnings: string[],
): Promise<WclTableEntry[]> {
  try {
    const response = await wcl.query<ReportTableResponse>(REPORT_TABLE_QUERY, {
      code,
      dataType,
      startTime,
      endTime,
    });

    const table = response.reportData.report?.table;
    if (!table) return [];
    if (Array.isArray(table.entries)) return table.entries;
    if (Array.isArray(table.data)) return table.data;
    return [];
  } catch (error) {
    warnings.push(`WCL ${dataType} table failed for ${code} ${startTime}-${endTime}: ${errorMessage(error)}`);
    return [];
  }
}

async function loadDeathsSafe(
  wcl: WclClient,
  code: string,
  startTime: number,
  endTime: number,
  warnings: string[],
): Promise<DeathEntry[]> {
  try {
    const response = await wcl.query<DeathEventsResponse>(REPORT_DEATH_EVENTS_QUERY, {
      code,
      startTime,
      endTime,
    });

    return response.reportData.report?.events?.data ?? [];
  } catch (error) {
    warnings.push(`WCL deaths failed for ${code} ${startTime}-${endTime}: ${errorMessage(error)}`);
    return [];
  }
}

function buildActorsByName(actors: WclActor[], fallbackRegion: string): Map<string, WclActor> {
  const map = new Map<string, WclActor>();

  for (const actor of actors) {
    if (!actor.name) continue;
    const server = actor.server || "";
    map.set(normalizedActorName(actor.name, server, fallbackRegion), actor);
    map.set(normalizedActorName(actor.name, "", fallbackRegion), actor);
  }

  return map;
}

function buildTableByName(entries: WclTableEntry[], fallbackRegion: string): Map<string, WclTableEntry> {
  const map = new Map<string, WclTableEntry>();

  for (const entry of entries) {
    if (!entry.name) continue;
    const parts = entry.name.split("-");
    const name = parts[0] || entry.name;
    const server = parts[1] || "";
    map.set(normalizedActorName(name, server, fallbackRegion), entry);
    map.set(normalizedActorName(name, "", fallbackRegion), entry);
  }

  return map;
}

function buildDeathsByName(entries: DeathEntry[], fallbackRegion: string): Map<string, number> {
  const map = new Map<string, number>();

  for (const entry of entries) {
    const rawName = entry.targetName;
    if (!rawName) continue;

    const parts = rawName.split("-");
    const name = parts[0] || rawName;
    const server = parts[1] || "";
    const keyWithServer = normalizedActorName(name, server, fallbackRegion);
    const keyWithoutServer = normalizedActorName(name, "", fallbackRegion);

    map.set(keyWithServer, (map.get(keyWithServer) ?? 0) + 1);
    map.set(keyWithoutServer, (map.get(keyWithoutServer) ?? 0) + 1);
  }

  return map;
}

function normalizedActorName(name: string, realmSlug: string, region: string): string {
  const normalizedName = name.trim().toLowerCase();
  const normalizedRealm = realmSlug.trim().toLowerCase().replace(/\s+/g, "-");

  if (!normalizedRealm) return `${normalizedName}::${region.toLowerCase()}`;
  return `${normalizedName}:${normalizedRealm}:${region.toLowerCase()}`;
}

function dedupeMembers(members: GuildMemberInput[]): GuildMemberInput[] {
  const map = new Map<string, GuildMemberInput>();

  for (const member of members) {
    const key = memberKey(member.name, member.realmSlug, member.region);
    if (!map.has(key)) map.set(key, member);
  }

  return [...map.values()];
}

function dedupePulls(pulls: MemberPullSnapshot[]): MemberPullSnapshot[] {
  const map = new Map<string, MemberPullSnapshot>();

  for (const pull of pulls) {
    map.set(`${pull.reportCode}:${pull.fightId}:${pull.bossName}:${pull.startedAt}`, pull);
  }

  return [...map.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numericOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
