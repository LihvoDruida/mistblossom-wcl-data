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
      table?: unknown;
    } | null;
  };
}

interface NormalizedReportTable {
  entries: WclTableEntry[];
  totalTimeMs?: number;
  rawEntryCount: number;
}

interface TableIndex {
  byId: Map<number, WclTableEntry>;
  byName: Map<string, WclTableEntry>;
}

interface TableLookupResult {
  entry?: WclTableEntry;
  matchedBy?: string;
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

      const damageIndex = buildTableIndex(damageTable.entries, env.wclGuildRegion);
      const healingIndex = buildTableIndex(healingTable.entries, env.wclGuildRegion);
      const deathsByName = buildDeathsByName(deaths, env.wclGuildRegion);
      const raidDeaths = deaths.length;

      if (!damageTable.entries.length && !healingTable.entries.length) {
        warnings.push(
          `WCL tables returned no usable entries for ${report.code} fight ${fight.id} (${fight.name}). Raw counts: damage=${damageTable.rawEntryCount}, healing=${healingTable.rawEntryCount}`,
        );
      }

      for (const [key, member] of memberMap) {
        const actor = lookupActor(actorsByName, member);
        const damageLookup = lookupTableEntry(damageIndex, member, actor, env.wclGuildRegion);
        const healingLookup = lookupTableEntry(healingIndex, member, actor, env.wclGuildRegion);
        const damage = damageLookup.entry;
        const healing = healingLookup.entry;
        const characterDeaths = countCharacterDeaths(deathsByName, member, actor, env.wclGuildRegion);

        if (!damage && !healing && characterDeaths === 0) {
          continue;
        }

        const durationMs = Math.max(0, fight.endTime - fight.startTime);
        const damageTotal = tableTotal(damage);
        const healingTotal = tableTotal(healing);
        const damageTotalTimeMs = numericOptional(damage?.totalTime) ?? damageTable.totalTimeMs ?? durationMs;
        const healingTotalTimeMs = numericOptional(healing?.totalTime) ?? healingTable.totalTimeMs ?? durationMs;
        const dps = calculatePerSecond(damageTotal, damageTotalTimeMs);
        const hps = calculatePerSecond(healingTotal, healingTotalTimeMs);
        const primary = choosePrimaryMetric(member.roleHint, dps, hps);

        const pull: MemberPullSnapshot = {
          key: `${report.code}:${fight.id}:${member.name}:${member.realmSlug}:${member.region}`,
          reportCode: report.code,
          reportTitle: report.title ?? fullReport.title,
          reportStartedAt: new Date(fullReport.startTime).toISOString(),
          reportEndedAt: fullReport.endTime ? new Date(fullReport.endTime).toISOString() : null,
          zone: report.zone,
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
          averageItemLevel: fight.averageItemLevel ?? numericOptional(damage?.itemLevel) ?? numericOptional(healing?.itemLevel) ?? null,
          actor: actor
            ? {
                id: actor.id,
                name: actor.name,
                server: actor.server,
                type: actor.type,
                subType: actor.subType,
              }
            : undefined,
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
            damageTotalTimeMs,
            healingTotalTimeMs,
            damageEntryId: numericOptional(damage?.id),
            healingEntryId: numericOptional(healing?.id),
            damageItemLevel: numericOptional(damage?.itemLevel),
            healingItemLevel: numericOptional(healing?.itemLevel),
            matchedBy: [damageLookup.matchedBy && `damage:${damageLookup.matchedBy}`, healingLookup.matchedBy && `healing:${healingLookup.matchedBy}`]
              .filter(Boolean)
              .join(",") || undefined,
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
): Promise<NormalizedReportTable> {
  try {
    const response = await wcl.query<ReportTableResponse>(REPORT_TABLE_QUERY, {
      code,
      dataType,
      startTime,
      endTime,
    });

    return normalizeReportTable(response.reportData.report?.table);
  } catch (error) {
    warnings.push(`WCL ${dataType} table failed for ${code} ${startTime}-${endTime}: ${errorMessage(error)}`);
    return { entries: [], rawEntryCount: 0 };
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
    for (const key of actorLookupKeys(actor.name, actor.server, fallbackRegion)) {
      map.set(key, actor);
    }
  }

  return map;
}

function buildTableIndex(entries: WclTableEntry[], fallbackRegion: string): TableIndex {
  const byId = new Map<number, WclTableEntry>();
  const byName = new Map<string, WclTableEntry>();

  for (const entry of entries) {
    const id = numericOptional(entry.id);
    if (id !== undefined) byId.set(id, entry);

    for (const key of tableEntryLookupKeys(entry, fallbackRegion)) {
      byName.set(key, entry);
    }
  }

  return { byId, byName };
}

function normalizeReportTable(table: unknown): NormalizedReportTable {
  const root = asRecord(table);
  if (!root) return { entries: [], rawEntryCount: 0 };

  const directEntries = arrayOfRecords(root.entries);
  const data = root.data;
  const dataRecord = asRecord(data);
  const entriesFromData = Array.isArray(data) ? arrayOfRecords(data) : arrayOfRecords(dataRecord?.entries);
  const recursiveEntries = directEntries.length || entriesFromData.length ? [] : findEntriesArray(root, 0);
  const entries = [...directEntries, ...entriesFromData, ...recursiveEntries];

  return {
    entries,
    totalTimeMs: numericOptional(root.totalTime) ?? numericOptional(dataRecord?.totalTime),
    rawEntryCount: entries.length,
  };
}

function findEntriesArray(value: unknown, depth: number): WclTableEntry[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return [];

  const record = asRecord(value);
  if (!record) return [];

  const entries = arrayOfRecords(record.entries);
  if (entries.length) return entries;

  for (const child of Object.values(record)) {
    const found = findEntriesArray(child, depth + 1);
    if (found.length) return found;
  }

  return [];
}

function lookupActor(actorsByName: Map<string, WclActor>, member: GuildMemberInput): WclActor | undefined {
  for (const key of memberLookupKeys(member.name, member.realmSlug, member.region)) {
    const actor = actorsByName.get(key);
    if (actor) return actor;
  }

  return undefined;
}

function lookupTableEntry(
  index: TableIndex,
  member: GuildMemberInput,
  actor: WclActor | undefined,
  fallbackRegion: string,
): TableLookupResult {
  if (actor?.id !== undefined) {
    const byActorId = index.byId.get(actor.id);
    if (byActorId) return { entry: byActorId, matchedBy: `actor-id:${actor.id}` };
  }

  for (const key of memberLookupKeys(member.name, member.realmSlug, member.region)) {
    const byMemberName = index.byName.get(key);
    if (byMemberName) return { entry: byMemberName, matchedBy: `member-name:${key}` };
  }

  if (actor?.name) {
    for (const key of actorLookupKeys(actor.name, actor.server, fallbackRegion)) {
      const byActorName = index.byName.get(key);
      if (byActorName) return { entry: byActorName, matchedBy: `actor-name:${key}` };
    }
  }

  return {};
}

function countCharacterDeaths(
  deathsByName: Map<string, number>,
  member: GuildMemberInput,
  actor: WclActor | undefined,
  fallbackRegion: string,
): number {
  for (const key of memberLookupKeys(member.name, member.realmSlug, member.region)) {
    const deaths = deathsByName.get(key);
    if (deaths !== undefined) return deaths;
  }

  if (actor?.name) {
    for (const key of actorLookupKeys(actor.name, actor.server, fallbackRegion)) {
      const deaths = deathsByName.get(key);
      if (deaths !== undefined) return deaths;
    }
  }

  return 0;
}

function buildDeathsByName(entries: DeathEntry[], fallbackRegion: string): Map<string, number> {
  const map = new Map<string, number>();

  for (const entry of entries) {
    const rawName = entry.targetName;
    if (!rawName) continue;

    const parsed = splitActorNameAndRealm(rawName);

    for (const key of actorLookupKeys(parsed.name, parsed.realm, fallbackRegion)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  return map;
}

function memberLookupKeys(name: string, realmSlug: string, region: string): string[] {
  return actorLookupKeys(name, realmSlug, region);
}

function actorLookupKeys(name: string, realmOrServer: string | undefined, region: string): string[] {
  const normalizedName = normalizeName(name);
  const normalizedRealm = normalizeRealm(realmOrServer ?? "");
  const normalizedRegion = region.toLowerCase();
  const keys = new Set<string>();

  if (normalizedName) {
    if (normalizedRealm) keys.add(`${normalizedName}:${normalizedRealm}:${normalizedRegion}`);
    keys.add(`${normalizedName}::${normalizedRegion}`);
  }

  return [...keys];
}

function tableEntryLookupKeys(entry: WclTableEntry, fallbackRegion: string): string[] {
  const rawName = typeof entry.name === "string" ? entry.name : "";
  if (!rawName.trim()) return [];

  const explicitServer = typeof entry.server === "string" ? entry.server : "";
  const parsed = splitActorNameAndRealm(rawName);
  return actorLookupKeys(parsed.name, explicitServer || parsed.realm, fallbackRegion);
}

function splitActorNameAndRealm(value: string): { name: string; realm: string } {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf("-");

  if (separator <= 0 || separator >= trimmed.length - 1) {
    return { name: trimmed, realm: "" };
  }

  return {
    name: trimmed.slice(0, separator),
    realm: trimmed.slice(separator + 1),
  };
}

function normalizedActorName(name: string, realmSlug: string, region: string): string {
  const normalizedName = normalizeName(name);
  const normalizedRealm = normalizeRealm(realmSlug);

  if (!normalizedRealm) return `${normalizedName}::${region.toLowerCase()}`;
  return `${normalizedName}:${normalizedRealm}:${region.toLowerCase()}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRealm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function tableTotal(entry: WclTableEntry | undefined): number {
  if (!entry) return 0;
  return firstNumeric(entry.total, entry.amount, entry.damage, entry.healing, entry.totalHealing);
}

function firstNumeric(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function arrayOfRecords(value: unknown): WclTableEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is WclTableEntry => Boolean(asRecord(item)));
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
