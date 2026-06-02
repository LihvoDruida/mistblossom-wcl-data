import type {
  GuildIndexEntry,
  GuildIndexSnapshot,
  GuildMemberInput,
  Last10Summary,
  MemberPullSnapshot,
  MemberSnapshot,
  MemberStats,
  NumericWindowSummary,
} from "./types";
import { characterSlug } from "./slug";

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function avg(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function max(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? Math.max(...clean) : 0;
}

function min(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? Math.min(...clean) : 0;
}

function summarizeWindow(pulls: MemberPullSnapshot[]): NumericWindowSummary {
  return {
    avgDps: round(avg(pulls.map((pull) => pull.metric.dps))),
    avgHps: round(avg(pulls.map((pull) => pull.metric.hps))),
    avgPrimary: round(avg(pulls.map((pull) => pull.metric.primary))),
    avgDurationMs: round(avg(pulls.map((pull) => pull.durationMs)), 0),
    avgDeaths: round(avg(pulls.map((pull) => pull.deaths.character))),
  };
}

function summarizeLast10(pulls: MemberPullSnapshot[]): Last10Summary {
  return {
    maxDps: round(max(pulls.map((pull) => pull.metric.dps))),
    minDps: round(min(pulls.map((pull) => pull.metric.dps))),
    maxHps: round(max(pulls.map((pull) => pull.metric.hps))),
    minHps: round(min(pulls.map((pull) => pull.metric.hps))),
    maxPrimary: round(max(pulls.map((pull) => pull.metric.primary))),
    minPrimary: round(min(pulls.map((pull) => pull.metric.primary))),
    maxDurationMs: round(max(pulls.map((pull) => pull.durationMs)), 0),
    minDurationMs: round(min(pulls.map((pull) => pull.durationMs)), 0),
  };
}

export function calculateMemberStats(
  pulls: MemberPullSnapshot[],
  recentAvgWindow = 3,
  maxPullsPerMember = 10,
): MemberStats {
  const pullLimit = Math.max(1, Math.min(10, Math.floor(maxPullsPerMember)));
  const last10 = pulls.slice(0, pullLimit);
  const recent = pulls.slice(0, recentAvgWindow);
  const kills = last10.filter((pull) => pull.status === "KILL").length;
  const wipes = last10.filter((pull) => pull.status === "WIPE").length;
  const pullsStored = last10.length;
  const totalCharacterDeaths = last10.reduce((sum, pull) => sum + pull.deaths.character, 0);
  const totalRaidDeaths = last10.reduce((sum, pull) => sum + pull.deaths.raid, 0);
  const last10Summary = summarizeLast10(last10);
  const recent3 = summarizeWindow(recent);
  const stabilityPercent =
    last10Summary.maxPrimary > 0 ? round((recent3.avgPrimary / last10Summary.maxPrimary) * 100) : 0;
  const consistencyPercent =
    last10Summary.maxPrimary > 0 && last10Summary.minPrimary > 0
      ? round((last10Summary.minPrimary / last10Summary.maxPrimary) * 100)
      : 0;

  return {
    pullsStored,
    kills,
    wipes,
    killRate: pullsStored ? round(kills / pullsStored, 4) : 0,
    wipeRate: pullsStored ? round(wipes / pullsStored, 4) : 0,
    totalCharacterDeaths,
    totalRaidDeaths,
    deathsPerPull: pullsStored ? round(totalCharacterDeaths / pullsStored) : 0,
    stabilityPercent,
    consistencyPercent,
    recent3,
    last10: last10Summary,
  };
}

export function buildMemberSnapshot(
  member: GuildMemberInput,
  pulls: MemberPullSnapshot[],
  reportsScanned: number,
  fightsScanned: number,
  recentAvgWindow = 3,
  maxPullsPerMember = 10,
): MemberSnapshot {
  const pullLimit = Math.max(1, Math.min(10, Math.floor(maxPullsPerMember)));
  const sorted = [...pulls]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, pullLimit);

  const slug = characterSlug(member.name, member.realmSlug, member.region);

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    character: {
      name: member.name,
      realmSlug: member.realmSlug,
      region: member.region,
      slug,
      rank: member.rank,
      className: member.className,
      roleHint: member.roleHint,
    },
    stats: calculateMemberStats(sorted, recentAvgWindow, pullLimit),
    pulls: sorted,
    source: {
      reportsScanned,
      fightsScanned,
      generatedBy: "wcl-github-api",
    },
  };
}

export function buildGuildIndex(
  guild: { name: string; realmSlug: string; region: string },
  snapshots: MemberSnapshot[],
  reportsScanned: number,
  fightsScanned: number,
): GuildIndexSnapshot {
  const members: GuildIndexEntry[] = snapshots
    .map((snapshot) => ({
      slug: snapshot.character.slug,
      name: snapshot.character.name,
      realmSlug: snapshot.character.realmSlug,
      region: snapshot.character.region,
      className: snapshot.character.className,
      rank: snapshot.character.rank,
      updatedAt: snapshot.updatedAt,
      pullsStored: snapshot.stats.pullsStored,
      kills: snapshot.stats.kills,
      wipes: snapshot.stats.wipes,
      avgPrimaryRecent3: snapshot.stats.recent3.avgPrimary,
      maxPrimaryLast10: snapshot.stats.last10.maxPrimary,
      deathsPerPull: snapshot.stats.deathsPerPull,
      stabilityPercent: snapshot.stats.stabilityPercent,
    }))
    .sort((a, b) => {
      if ((a.rank ?? 999) !== (b.rank ?? 999)) return (a.rank ?? 999) - (b.rank ?? 999);
      return a.name.localeCompare(b.name);
    });

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    guild,
    totals: {
      members: members.length,
      reportsScanned,
      fightsScanned,
    },
    members,
  };
}

export function calculatePerSecond(total: number, durationMs: number): number {
  if (!Number.isFinite(total) || total <= 0 || durationMs <= 0) return 0;
  return round(total / (durationMs / 1000));
}

export function choosePrimaryMetric(
  roleHint: string | undefined,
  dps: number,
  hps: number,
): { primary: number; primaryKind: "dps" | "hps" | "unknown" } {
  if (roleHint === "healer") return { primary: hps, primaryKind: "hps" };
  if (roleHint === "dps" || roleHint === "tank") return { primary: dps, primaryKind: "dps" };
  if (hps > dps && hps > 0) return { primary: hps, primaryKind: "hps" };
  if (dps > 0) return { primary: dps, primaryKind: "dps" };
  return { primary: 0, primaryKind: "unknown" };
}

export function difficultyName(difficulty?: number | null): string {
  switch (difficulty) {
    case 1:
      return "LFR";
    case 2:
      return "Flexible";
    case 3:
      return "Normal";
    case 4:
      return "Heroic";
    case 5:
      return "Mythic";
    default:
      return "Unknown";
  }
}
