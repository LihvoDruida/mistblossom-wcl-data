import type {
  GuildIndexEntry,
  GuildIndexSnapshot,
  GuildMemberInput,
  Last10Summary,
  MemberPullSnapshot,
  MemberSnapshot,
  MemberStats,
  MetricRateSource,
  NumericWindowSummary,
  PrimaryMetricKind,
  PullRole,
  RoleMetricSummary,
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
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? Math.max(...clean) : 0;
}

function min(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? Math.min(...clean) : 0;
}

function primaryPulls(pulls: MemberPullSnapshot[]): MemberPullSnapshot[] {
  return pulls.filter((pull) => pull.metric.primaryKind !== "unknown" && pull.metric.primary > 0);
}

function dpsPulls(pulls: MemberPullSnapshot[]): MemberPullSnapshot[] {
  return pulls.filter((pull) => pull.metric.primaryKind === "dps" && pull.metric.dps > 0);
}

function hpsPulls(pulls: MemberPullSnapshot[]): MemberPullSnapshot[] {
  return pulls.filter((pull) => pull.metric.primaryKind === "hps" && pull.metric.hps > 0);
}

function summarizeWindow(pulls: MemberPullSnapshot[]): NumericWindowSummary {
  const dps = dpsPulls(pulls);
  const hps = hpsPulls(pulls);
  const primary = primaryPulls(pulls);

  return {
    sampleSize: pulls.length,
    avgDps: round(avg(dps.map((pull) => pull.metric.dps))),
    avgHps: round(avg(hps.map((pull) => pull.metric.hps))),
    avgPrimary: round(avg(primary.map((pull) => pull.metric.primary))),
    avgDurationMs: round(avg(pulls.map((pull) => pull.durationMs)), 0),
    avgDeaths: round(avg(pulls.map((pull) => pull.deaths.character))),
  };
}

function summarizeLast10(pulls: MemberPullSnapshot[]): Last10Summary {
  const dps = dpsPulls(pulls);
  const hps = hpsPulls(pulls);
  const primary = primaryPulls(pulls);

  return {
    sampleSize: pulls.length,
    maxDps: round(max(dps.map((pull) => pull.metric.dps))),
    minDps: round(min(dps.map((pull) => pull.metric.dps))),
    maxHps: round(max(hps.map((pull) => pull.metric.hps))),
    minHps: round(min(hps.map((pull) => pull.metric.hps))),
    maxPrimary: round(max(primary.map((pull) => pull.metric.primary))),
    minPrimary: round(min(primary.map((pull) => pull.metric.primary))),
    maxDurationMs: round(max(pulls.map((pull) => pull.durationMs)), 0),
    minDurationMs: round(min(pulls.map((pull) => pull.durationMs)), 0),
  };
}

function roleMetricSummary(pulls: MemberPullSnapshot[], kind: "damage" | "healer" | "unknown", recentAvgWindow: number): RoleMetricSummary {
  const rolePulls = pulls.filter((pull) => {
    if (kind === "damage") return pull.metric.primaryKind === "dps";
    if (kind === "healer") return pull.metric.primaryKind === "hps";
    return pull.metric.primaryKind === "unknown";
  });
  const recent = rolePulls.slice(0, recentAvgWindow);
  const sortedByPrimary = [...rolePulls].filter((pull) => pull.metric.primary > 0).sort((a, b) => a.metric.primary - b.metric.primary);
  const best = sortedByPrimary.at(-1);
  const worst = sortedByPrimary[0];

  return {
    pulls: rolePulls.length,
    kills: rolePulls.filter((pull) => pull.status === "KILL").length,
    wipes: rolePulls.filter((pull) => pull.status === "WIPE").length,
    avgRecent: round(avg(recent.map((pull) => pull.metric.primary))),
    maxLast10: round(max(rolePulls.map((pull) => pull.metric.primary))),
    minLast10: round(min(rolePulls.map((pull) => pull.metric.primary))),
    deathsPerPull: rolePulls.length ? round(rolePulls.reduce((sum, pull) => sum + pull.deaths.character, 0) / rolePulls.length) : 0,
    bestPullKey: best?.key,
    worstPullKey: worst?.key,
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
  const primaryKindCounts: Record<PrimaryMetricKind, number> = {
    dps: last10.filter((pull) => pull.metric.primaryKind === "dps").length,
    hps: last10.filter((pull) => pull.metric.primaryKind === "hps").length,
    unknown: last10.filter((pull) => pull.metric.primaryKind === "unknown").length,
  };

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
    byRole: {
      healer: roleMetricSummary(last10, "healer", recentAvgWindow),
      damage: roleMetricSummary(last10, "damage", recentAvgWindow),
      unknown: roleMetricSummary(last10, "unknown", recentAvgWindow),
    },
    dataQuality: {
      pullsWithMatchedDamage: last10.filter((pull) => pull.source.damageTotal > 0 || Boolean(pull.source.damageEntryId)).length,
      pullsWithMatchedHealing: last10.filter((pull) => pull.source.healingTotal > 0 || Boolean(pull.source.healingEntryId)).length,
      pullsWithRoleInferred: last10.filter((pull) => pull.role.source !== "unknown").length,
      pullsWithDeaths: last10.filter((pull) => pull.deaths.character > 0).length,
      primaryKindCounts,
    },
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
    schemaVersion: 2,
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
      avgDpsRecent3: snapshot.stats.recent3.avgDps,
      maxDpsLast10: snapshot.stats.last10.maxDps,
      avgHpsRecent3: snapshot.stats.recent3.avgHps,
      maxHpsLast10: snapshot.stats.last10.maxHps,
      deathsPerPull: snapshot.stats.deathsPerPull,
      stabilityPercent: snapshot.stats.stabilityPercent,
      primaryKindCounts: snapshot.stats.dataQuality.primaryKindCounts,
    }))
    .sort((a, b) => {
      if ((a.rank ?? 999) !== (b.rank ?? 999)) return (a.rank ?? 999) - (b.rank ?? 999);
      return a.name.localeCompare(b.name);
    });

  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    guild,
    totals: {
      members: members.length,
      reportsScanned,
      fightsScanned,
      healerPulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.healer.pulls, 0),
      damagePulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.damage.pulls, 0),
      unknownPulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.unknown.pulls, 0),
    },
    members,
  };
}

export function calculatePerSecond(total: number, durationMs: number): number {
  if (!Number.isFinite(total) || total <= 0 || durationMs <= 0) return 0;
  return round(total / (durationMs / 1000));
}

export function choosePrimaryMetric(
  role: PullRole | string | undefined,
  dps: number,
  hps: number,
): { primary: number; primaryKind: PrimaryMetricKind } {
  if (role === "healer") return { primary: hps, primaryKind: "hps" };
  if (role === "dps" || role === "tank") return { primary: dps, primaryKind: "dps" };
  if (hps > dps && hps > 0) return { primary: hps, primaryKind: "hps" };
  if (dps > 0) return { primary: dps, primaryKind: "dps" };
  return { primary: 0, primaryKind: "unknown" };
}

export function rateFromWclEntry(args: {
  total: number;
  entryPerSecond?: number;
  entryTotalTimeMs?: number;
  tableTotalTimeMs?: number;
  fightDurationMs: number;
}): { value: number; source: MetricRateSource } {
  if (Number.isFinite(args.entryPerSecond) && (args.entryPerSecond ?? 0) > 0) {
    return { value: round(args.entryPerSecond ?? 0), source: "wcl-persecond" };
  }
  if (Number.isFinite(args.entryTotalTimeMs) && (args.entryTotalTimeMs ?? 0) > 0) {
    return { value: calculatePerSecond(args.total, args.entryTotalTimeMs ?? 0), source: "entry-total-time" };
  }
  if (Number.isFinite(args.tableTotalTimeMs) && (args.tableTotalTimeMs ?? 0) > 0) {
    return { value: calculatePerSecond(args.total, args.tableTotalTimeMs ?? 0), source: "table-total-time" };
  }
  if (args.fightDurationMs > 0) {
    return { value: calculatePerSecond(args.total, args.fightDurationMs), source: "fight-duration" };
  }
  return { value: 0, source: "none" };
}

export function activeRate(total: number, activeTimeMs: number | undefined, fallbackMs: number): number {
  if (activeTimeMs && activeTimeMs > 0) return calculatePerSecond(total, activeTimeMs);
  return calculatePerSecond(total, fallbackMs);
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
