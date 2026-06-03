import type {
  GuildAnalyticsSnapshot,
  GuildBossAnalytics,
  GuildClassAnalytics,
  GuildIndexEntry,
  GuildIndexSnapshot,
  GuildMemberInput,
  GuildRoleAnalytics,
  GuildTopMemberEntry,
  Last10Summary,
  MemberPullSnapshot,
  MemberSnapshot,
  MemberStats,
  MemberTrendSummary,
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

function median(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle] ?? 0;
  return ((clean[middle - 1] ?? 0) + (clean[middle] ?? 0)) / 2;
}

function max(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? Math.max(...clean) : 0;
}

function min(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? Math.min(...clean) : 0;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return minValue;
  return Math.max(minValue, Math.min(maxValue, value));
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

function trendSummary(recent: NumericWindowSummary, previous: NumericWindowSummary): MemberTrendSummary {
  const delta = round(recent.avgPrimary - previous.avgPrimary);
  const deltaPercent = previous.avgPrimary > 0 ? round((delta / previous.avgPrimary) * 100) : 0;
  let direction: MemberTrendSummary["direction"] = "unknown";

  if (recent.sampleSize > 0 && previous.sampleSize > 0) {
    if (Math.abs(deltaPercent) < 5) direction = "flat";
    else direction = delta > 0 ? "up" : "down";
  }

  return {
    direction,
    recentAvg: recent.avgPrimary,
    previousAvg: previous.avgPrimary,
    delta,
    deltaPercent,
  };
}

export function calculateMemberStats(
  pulls: MemberPullSnapshot[],
  recentAvgWindow = 3,
  maxPullsPerMember = 10,
): MemberStats {
  const pullLimit = Math.max(1, Math.min(10, Math.floor(maxPullsPerMember)));
  const last10 = pulls.slice(0, pullLimit);
  const recent = last10.slice(0, recentAvgWindow);
  const previous = last10.slice(recentAvgWindow, recentAvgWindow * 2);
  const kills = last10.filter((pull) => pull.status === "KILL").length;
  const wipes = last10.filter((pull) => pull.status === "WIPE").length;
  const pullsStored = last10.length;
  const totalCharacterDeaths = last10.reduce((sum, pull) => sum + pull.deaths.character, 0);
  const totalRaidDeaths = last10.reduce((sum, pull) => sum + pull.deaths.raid, 0);
  const last10Summary = summarizeLast10(last10);
  const recent3 = summarizeWindow(recent);
  const previous3 = summarizeWindow(previous);
  const stabilityPercent = last10Summary.maxPrimary > 0 ? round((recent3.avgPrimary / last10Summary.maxPrimary) * 100) : 0;
  const consistencyPercent = last10Summary.maxPrimary > 0 && last10Summary.minPrimary > 0
    ? round((last10Summary.minPrimary / last10Summary.maxPrimary) * 100)
    : 0;
  const primaryKindCounts: Record<PrimaryMetricKind, number> = {
    dps: last10.filter((pull) => pull.metric.primaryKind === "dps").length,
    hps: last10.filter((pull) => pull.metric.primaryKind === "hps").length,
    unknown: last10.filter((pull) => pull.metric.primaryKind === "unknown").length,
  };
  const matchedPulls = last10.filter((pull) => pull.source.damageTotal > 0 || pull.source.healingTotal > 0 || Boolean(pull.source.damageEntryId) || Boolean(pull.source.healingEntryId)).length;
  const confidenceAvg = round(avg(last10.map((pull) => pull.role.confidence)));
  const deathsPerPull = pullsStored ? round(totalCharacterDeaths / pullsStored) : 0;
  const killRate = pullsStored ? round(kills / pullsStored, 4) : 0;
  const survivalScore = round(clamp(100 - deathsPerPull * 30, 0, 100));
  const performanceScore = round(clamp(stabilityPercent * 0.55 + consistencyPercent * 0.25 + killRate * 100 * 0.2, 0, 100));
  const reliabilityScore = round(clamp(performanceScore * 0.55 + survivalScore * 0.3 + confidenceAvg * 100 * 0.15, 0, 100));

  return {
    pullsStored,
    kills,
    wipes,
    killRate,
    wipeRate: pullsStored ? round(wipes / pullsStored, 4) : 0,
    totalCharacterDeaths,
    totalRaidDeaths,
    deathsPerPull,
    stabilityPercent,
    consistencyPercent,
    performanceScore,
    survivalScore,
    reliabilityScore,
    recent3,
    previous3,
    last10: last10Summary,
    trend: trendSummary(recent3, previous3),
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
      confidenceAvg,
      matchedPullPercent: pullsStored ? round((matchedPulls / pullsStored) * 100) : 0,
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
  options: {
    previous?: MemberSnapshot;
    scannedAt?: string;
    newPullsInLastScan?: number;
    scanReason?: MemberSnapshot["source"]["scanReason"];
  } = {},
): MemberSnapshot {
  const pullLimit = Math.max(1, Math.min(10, Math.floor(maxPullsPerMember)));
  const sorted = [...pulls]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, pullLimit);

  const slug = characterSlug(member.name, member.realmSlug, member.region);
  const scannedAt = options.scannedAt ?? new Date().toISOString();
  const previousKeys = new Set(options.previous?.pulls?.map((pull) => pull.key) ?? []);
  const changedByPulls = sorted.some((pull) => !previousKeys.has(pull.key));
  const lastPullAt = sorted[0]?.startedAt ?? options.previous?.source?.lastPullAt;
  const newPulls = options.newPullsInLastScan ?? sorted.filter((pull) => !previousKeys.has(pull.key)).length;

  return {
    schemaVersion: 3,
    updatedAt: scannedAt,
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
      lastScannedAt: scannedAt,
      lastChangedAt: changedByPulls ? scannedAt : options.previous?.source?.lastChangedAt,
      lastPullAt,
      newPullsInLastScan: newPulls,
      scanReason: options.scanReason ?? (sorted.length ? "scheduled" : "no-data"),
    },
  };
}

export function buildGuildIndex(
  guild: { name: string; realmSlug: string; region: string },
  snapshots: MemberSnapshot[],
  reportsScanned: number,
  fightsScanned: number,
): GuildIndexSnapshot {
  const analytics = buildGuildAnalytics(snapshots);
  const members: GuildIndexEntry[] = snapshots
    .map((snapshot) => ({
      slug: snapshot.character.slug,
      name: snapshot.character.name,
      realmSlug: snapshot.character.realmSlug,
      region: snapshot.character.region,
      className: snapshot.character.className,
      rank: snapshot.character.rank,
      updatedAt: snapshot.updatedAt,
      lastScannedAt: snapshot.source.lastScannedAt,
      lastPullAt: snapshot.source.lastPullAt,
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
      consistencyPercent: snapshot.stats.consistencyPercent,
      performanceScore: snapshot.stats.performanceScore,
      survivalScore: snapshot.stats.survivalScore,
      reliabilityScore: snapshot.stats.reliabilityScore,
      trendDirection: snapshot.stats.trend.direction,
      trendDeltaPercent: snapshot.stats.trend.deltaPercent,
      primaryKindCounts: snapshot.stats.dataQuality.primaryKindCounts,
    }))
    .sort((a, b) => {
      if ((a.rank ?? 999) !== (b.rank ?? 999)) return (a.rank ?? 999) - (b.rank ?? 999);
      return a.name.localeCompare(b.name);
    });

  return {
    schemaVersion: 3,
    updatedAt: new Date().toISOString(),
    guild,
    totals: {
      members: members.length,
      reportsScanned,
      fightsScanned,
      healerPulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.healer.pulls, 0),
      damagePulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.damage.pulls, 0),
      unknownPulls: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.byRole.unknown.pulls, 0),
      distinctFights: analytics.overview.distinctFights,
      membersWithData: analytics.overview.membersWithData,
    },
    analytics,
    members,
  };
}

function buildGuildAnalytics(snapshots: MemberSnapshot[]): GuildAnalyticsSnapshot {
  const now = Date.now();
  const membersWithData = snapshots.filter((snapshot) => snapshot.stats.pullsStored > 0);
  const allPulls = snapshots.flatMap((snapshot) => snapshot.pulls.map((pull) => ({ pull, snapshot })));
  const fightGroups = groupGuildFights(allPulls.map(({ pull }) => pull));
  const fightValues = [...fightGroups.values()];
  const totalCharacterDeaths = snapshots.reduce((sum, snapshot) => sum + snapshot.stats.totalCharacterDeaths, 0);
  const pullCount = snapshots.reduce((sum, snapshot) => sum + snapshot.stats.pullsStored, 0);
  const scannedTimes = snapshots
    .map((snapshot) => Date.parse(snapshot.source.lastScannedAt ?? snapshot.updatedAt))
    .filter((time) => Number.isFinite(time));

  return {
    overview: {
      members: snapshots.length,
      membersWithData: membersWithData.length,
      pullsStored: pullCount,
      distinctFights: fightValues.length,
      kills: fightValues.filter((fight) => fight.status === "KILL").length,
      wipes: fightValues.filter((fight) => fight.status === "WIPE").length,
      killRate: fightValues.length ? round(fightValues.filter((fight) => fight.status === "KILL").length / fightValues.length, 4) : 0,
      avgFightDurationMs: round(avg(fightValues.map((fight) => fight.durationMs)), 0),
      avgRaidDeaths: round(avg(fightValues.map((fight) => fight.raidDeaths))),
      avgTeamDps: round(avg(fightValues.map((fight) => fight.teamDps))),
      avgTeamHps: round(avg(fightValues.map((fight) => fight.teamHps))),
      avgPerformanceScore: round(avg(snapshots.map((snapshot) => snapshot.stats.performanceScore))),
      avgSurvivalScore: round(avg(snapshots.map((snapshot) => snapshot.stats.survivalScore))),
      avgReliabilityScore: round(avg(snapshots.map((snapshot) => snapshot.stats.reliabilityScore))),
    },
    roles: {
      damage: guildRoleAnalytics(snapshots, "damage"),
      healer: guildRoleAnalytics(snapshots, "healer"),
      unknown: guildRoleAnalytics(snapshots, "unknown"),
    },
    deaths: {
      totalCharacterDeaths,
      deathsPerPull: pullCount ? round(totalCharacterDeaths / pullCount) : 0,
      highDeathRisk: snapshots
        .filter((snapshot) => snapshot.stats.pullsStored > 0)
        .map((snapshot) => topEntry(snapshot, snapshot.stats.deathsPerPull, snapshot.stats.survivalScore))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
      zeroDeathRecent: snapshots
        .filter((snapshot) => snapshot.stats.pullsStored >= 3 && snapshot.stats.recent3.avgDeaths === 0)
        .map((snapshot) => topEntry(snapshot, snapshot.stats.reliabilityScore, snapshot.stats.recent3.avgPrimary))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    },
    consistency: {
      avgStabilityPercent: round(avg(membersWithData.map((snapshot) => snapshot.stats.stabilityPercent))),
      avgConsistencyPercent: round(avg(membersWithData.map((snapshot) => snapshot.stats.consistencyPercent))),
      mostStable: membersWithData
        .map((snapshot) => topEntry(snapshot, snapshot.stats.reliabilityScore, snapshot.stats.stabilityPercent))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
      needsAttention: membersWithData
        .filter((snapshot) => snapshot.stats.reliabilityScore < 55 || snapshot.stats.deathsPerPull >= 1 || snapshot.stats.trend.direction === "down")
        .map((snapshot) => topEntry(snapshot, 100 - snapshot.stats.reliabilityScore, snapshot.stats.deathsPerPull))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    },
    freshness: {
      updatedWithin1h: countFresh(scannedTimes, now, 1),
      updatedWithin6h: countFresh(scannedTimes, now, 6),
      updatedWithin12h: countFresh(scannedTimes, now, 12),
      updatedWithin24h: countFresh(scannedTimes, now, 24),
      oldestScannedAt: scannedTimes.length ? new Date(Math.min(...scannedTimes)).toISOString() : undefined,
      newestScannedAt: scannedTimes.length ? new Date(Math.max(...scannedTimes)).toISOString() : undefined,
      staleMembers: snapshots
        .map((snapshot) => {
          const time = Date.parse(snapshot.source.lastScannedAt ?? snapshot.updatedAt);
          const hours = Number.isFinite(time) ? (now - time) / 3_600_000 : Number.POSITIVE_INFINITY;
          return topEntry(snapshot, round(hours), snapshot.stats.pullsStored);
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    },
    bosses: bossAnalytics(fightValues),
    classes: classAnalytics(snapshots),
  };
}

type FightGroup = {
  key: string;
  bossName: string;
  encounterId?: number | null;
  difficulty?: number | null;
  difficultyName: string;
  status: "KILL" | "WIPE";
  startedAt: string;
  durationMs: number;
  raidDeaths: number;
  memberDeaths: number;
  teamDps: number;
  teamHps: number;
};

function groupGuildFights(pulls: MemberPullSnapshot[]): Map<string, FightGroup> {
  const groups = new Map<string, FightGroup>();

  for (const pull of pulls) {
    const key = `${pull.reportCode}:${pull.fightId}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        bossName: pull.bossName,
        encounterId: pull.encounterId,
        difficulty: pull.difficulty,
        difficultyName: pull.difficultyName,
        status: pull.status,
        startedAt: pull.startedAt,
        durationMs: pull.durationMs,
        raidDeaths: pull.deaths.raid,
        memberDeaths: pull.deaths.character,
        teamDps: pull.metric.primaryKind === "dps" ? pull.metric.dps : 0,
        teamHps: pull.metric.primaryKind === "hps" ? pull.metric.hps : 0,
      });
      continue;
    }

    current.raidDeaths = Math.max(current.raidDeaths, pull.deaths.raid);
    current.memberDeaths += pull.deaths.character;
    current.teamDps += pull.metric.primaryKind === "dps" ? pull.metric.dps : 0;
    current.teamHps += pull.metric.primaryKind === "hps" ? pull.metric.hps : 0;
  }

  return groups;
}

function guildRoleAnalytics(snapshots: MemberSnapshot[], role: "damage" | "healer" | "unknown"): GuildRoleAnalytics {
  const rows = snapshots
    .map((snapshot) => {
      const summary = snapshot.stats.byRole[role];
      return { snapshot, summary };
    })
    .filter(({ summary }) => summary.pulls > 0);

  return {
    members: rows.length,
    pulls: rows.reduce((sum, row) => sum + row.summary.pulls, 0),
    avgRecent: round(avg(rows.map((row) => row.summary.avgRecent))),
    medianRecent: round(median(rows.map((row) => row.summary.avgRecent))),
    bestRecent: round(max(rows.map((row) => row.summary.avgRecent))),
    maxLast10: round(max(rows.map((row) => row.summary.maxLast10))),
    deathsPerPull: round(avg(rows.map((row) => row.summary.deathsPerPull))),
    topRecent: rows
      .map(({ snapshot, summary }) => topEntry(snapshot, summary.avgRecent, summary.deathsPerPull))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  };
}

function bossAnalytics(fights: FightGroup[]): GuildBossAnalytics[] {
  const byBoss = new Map<string, FightGroup[]>();

  for (const fight of fights) {
    const key = `${fight.encounterId ?? fight.bossName}:${fight.difficultyName}`;
    const list = byBoss.get(key) ?? [];
    list.push(fight);
    byBoss.set(key, list);
  }

  return [...byBoss.entries()]
    .map(([key, values]) => {
      const latest = values.reduce((latestFight, fight) => (Date.parse(fight.startedAt) > Date.parse(latestFight.startedAt) ? fight : latestFight), values[0]!);
      const kills = values.filter((fight) => fight.status === "KILL").length;
      return {
        key,
        bossName: latest.bossName,
        encounterId: latest.encounterId,
        difficulty: latest.difficulty,
        difficultyName: latest.difficultyName,
        pulls: values.length,
        kills,
        wipes: values.length - kills,
        killRate: values.length ? round(kills / values.length, 4) : 0,
        avgDurationMs: round(avg(values.map((fight) => fight.durationMs)), 0),
        avgRaidDeaths: round(avg(values.map((fight) => fight.raidDeaths))),
        avgTeamDps: round(avg(values.map((fight) => fight.teamDps))),
        avgTeamHps: round(avg(values.map((fight) => fight.teamHps))),
        bestTeamDps: round(max(values.map((fight) => fight.teamDps))),
        bestTeamHps: round(max(values.map((fight) => fight.teamHps))),
        lastPullAt: latest.startedAt,
      } satisfies GuildBossAnalytics;
    })
    .sort((a, b) => Date.parse(b.lastPullAt ?? "0") - Date.parse(a.lastPullAt ?? "0"))
    .slice(0, 30);
}

function classAnalytics(snapshots: MemberSnapshot[]): GuildClassAnalytics[] {
  const byClass = new Map<string, MemberSnapshot[]>();

  for (const snapshot of snapshots) {
    const className = snapshot.character.className || "Unknown";
    const list = byClass.get(className) ?? [];
    list.push(snapshot);
    byClass.set(className, list);
  }

  return [...byClass.entries()]
    .map(([className, rows]) => ({
      className,
      members: rows.length,
      withData: rows.filter((snapshot) => snapshot.stats.pullsStored > 0).length,
      avgPrimaryRecent3: round(avg(rows.map((snapshot) => snapshot.stats.recent3.avgPrimary))),
      avgDpsRecent3: round(avg(rows.map((snapshot) => snapshot.stats.recent3.avgDps))),
      avgHpsRecent3: round(avg(rows.map((snapshot) => snapshot.stats.recent3.avgHps))),
      deathsPerPull: round(avg(rows.map((snapshot) => snapshot.stats.deathsPerPull))),
      avgReliabilityScore: round(avg(rows.map((snapshot) => snapshot.stats.reliabilityScore))),
    }))
    .sort((a, b) => b.withData - a.withData || a.className.localeCompare(b.className));
}

function countFresh(times: number[], now: number, hours: number): number {
  const ageMs = hours * 3_600_000;
  return times.filter((time) => now - time <= ageMs).length;
}

function topEntry(snapshot: MemberSnapshot, value: number, secondary?: number): GuildTopMemberEntry {
  return {
    slug: snapshot.character.slug,
    name: snapshot.character.name,
    className: snapshot.character.className,
    rank: snapshot.character.rank,
    value: round(value),
    secondary: secondary === undefined ? undefined : round(secondary),
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
