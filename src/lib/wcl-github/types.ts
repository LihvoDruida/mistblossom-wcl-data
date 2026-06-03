export type Region = "us" | "eu" | "kr" | "tw" | "cn" | string;
export type PullStatus = "KILL" | "WIPE";
export type RoleHint = "tank" | "healer" | "dps" | "unknown";
export type PullRole = "tank" | "healer" | "dps" | "unknown";
export type PrimaryMetricKind = "dps" | "hps" | "unknown";
export type MetricRateSource = "wcl-persecond" | "entry-total-time" | "table-total-time" | "fight-duration" | "active-time" | "none";

export interface GuildMemberInput {
  name: string;
  realmSlug: string;
  region: Region;
  rank?: number;
  className?: string;
  level?: number;
  roleHint?: RoleHint;
  source?: "battle-net" | "dashboard" | "manual";
}

export interface WclReportSummary {
  code: string;
  title?: string;
  startTime: number;
  endTime?: number;
  zone?: {
    id?: number;
    name?: string;
  };
}

export interface WclFightSummary {
  id: number;
  name: string;
  encounterID?: number | null;
  difficulty?: number | null;
  kill?: boolean | null;
  startTime: number;
  endTime: number;
  bossPercentage?: number | null;
  fightPercentage?: number | null;
  averageItemLevel?: number | null;
}

export interface WclActor {
  id: number;
  name: string;
  type?: string;
  subType?: string;
  server?: string;
}

export interface WclTableEntry {
  id?: number;
  name?: string;
  server?: string;
  total?: number;
  totalTime?: number;
  activeTime?: number;
  itemLevel?: number;
  guid?: number;
  type?: string;
  icon?: string;
  spec?: string;
  rank?: number;
  deaths?: number;
  persecond?: number;
  perSecond?: number;
  dps?: number;
  hps?: number;
  DPS?: number;
  HPS?: number;
  [key: string]: unknown;
}

export interface DeathEntry {
  targetID?: number;
  targetName?: string;
  timestamp?: number;
  abilityGameID?: number;
  abilityName?: string;
  sourceID?: number;
  sourceName?: string;
  [key: string]: unknown;
}

export interface PullMetric {
  /** Main WCL-style damage-per-second. Prefer WCL persecond, then total/fight time. */
  dps: number;
  /** Main WCL-style healing-per-second. Prefer WCL persecond, then total/fight time. */
  hps: number;
  /** Primary role metric for this exact pull: HPS for healers, DPS for DPS/tanks. */
  primary: number;
  primaryKind: PrimaryMetricKind;
  /** Same as dps/hps, kept explicit for dashboard code that wants encounter-time values. */
  fightDps: number;
  fightHps: number;
  /** Active-time rates are kept separately and must not be mixed with normal DPS/HPS averages. */
  activeDps: number;
  activeHps: number;
  damageRateSource: MetricRateSource;
  healingRateSource: MetricRateSource;
}

export interface PullRoleInfo {
  role: PullRole;
  source: "member-role-hint" | "wcl-spec" | "metric-inference" | "unknown";
  spec?: string;
  className?: string;
  confidence: number;
}

export interface RawWclEntrySnapshot {
  id?: number;
  name?: string;
  server?: string;
  type?: string;
  icon?: string;
  spec?: string;
  total?: number;
  persecond?: number;
  activeTime?: number;
  totalTime?: number;
  itemLevel?: number;
  rank?: number;
  deaths?: number;
  guid?: number;
}

export interface RawWclPullSnapshot {
  report: {
    code: string;
    title?: string;
    startTime: number;
    endTime?: number | null;
  };
  fight: WclFightSummary;
  tables: {
    damage: {
      dataType: "DamageDone";
      rawEntryCount: number;
      totalTimeMs?: number;
      matchedBy?: string;
      matchedEntry?: RawWclEntrySnapshot;
    };
    healing: {
      dataType: "Healing";
      rawEntryCount: number;
      totalTimeMs?: number;
      matchedBy?: string;
      matchedEntry?: RawWclEntrySnapshot;
    };
  };
  deaths: {
    rawEventCount: number;
    matchedEvents: Array<Pick<DeathEntry, "timestamp" | "targetID" | "targetName" | "abilityGameID" | "abilityName" | "sourceID" | "sourceName">>;
  };
  processing: {
    matchedActorId?: number;
    matchedActorName?: string;
    normalizedKeys: string[];
    role: PullRoleInfo;
    primaryKind: PrimaryMetricKind;
  };
}

export interface MemberPullSnapshot {
  key: string;
  reportCode: string;
  reportTitle?: string;
  reportStartedAt?: string;
  reportEndedAt?: string | null;
  zone?: {
    id?: number;
    name?: string;
  };
  fightId: number;
  url: string;
  status: PullStatus;
  bossName: string;
  encounterId?: number | null;
  difficulty?: number | null;
  difficultyName: string;
  startedAt: string;
  durationMs: number;
  bossPercentage?: number | null;
  fightPercentage?: number | null;
  averageItemLevel?: number | null;
  actor?: {
    id?: number;
    name?: string;
    server?: string;
    type?: string;
    subType?: string;
  };
  role: PullRoleInfo;
  metric: PullMetric;
  deaths: {
    character: number;
    raid: number;
  };
  source: {
    damageTotal: number;
    healingTotal: number;
    damageActiveTimeMs?: number;
    healingActiveTimeMs?: number;
    damageTotalTimeMs?: number;
    healingTotalTimeMs?: number;
    damageEntryId?: number;
    healingEntryId?: number;
    damageItemLevel?: number;
    healingItemLevel?: number;
    matchedBy?: string;
  };
  /** Matched original WCL rows + exact processing decisions. Small enough to keep in JSON snapshots. */
  wclRaw?: RawWclPullSnapshot;
}

export interface NumericWindowSummary {
  sampleSize: number;
  avgDps: number;
  avgHps: number;
  avgPrimary: number;
  avgDurationMs: number;
  avgDeaths: number;
}

export interface Last10Summary {
  sampleSize: number;
  maxDps: number;
  minDps: number;
  maxHps: number;
  minHps: number;
  maxPrimary: number;
  minPrimary: number;
  maxDurationMs: number;
  minDurationMs: number;
}

export interface RoleMetricSummary {
  pulls: number;
  kills: number;
  wipes: number;
  avgRecent: number;
  maxLast10: number;
  minLast10: number;
  deathsPerPull: number;
  bestPullKey?: string;
  worstPullKey?: string;
}

export interface MemberStats {
  pullsStored: number;
  kills: number;
  wipes: number;
  killRate: number;
  wipeRate: number;
  totalCharacterDeaths: number;
  totalRaidDeaths: number;
  deathsPerPull: number;
  stabilityPercent: number;
  consistencyPercent: number;
  recent3: NumericWindowSummary;
  last10: Last10Summary;
  byRole: {
    healer: RoleMetricSummary;
    damage: RoleMetricSummary;
    unknown: RoleMetricSummary;
  };
  dataQuality: {
    pullsWithMatchedDamage: number;
    pullsWithMatchedHealing: number;
    pullsWithRoleInferred: number;
    pullsWithDeaths: number;
    primaryKindCounts: Record<PrimaryMetricKind, number>;
  };
}

export interface MemberSnapshot {
  schemaVersion: 1 | 2;
  updatedAt: string;
  character: {
    name: string;
    realmSlug: string;
    region: Region;
    slug: string;
    rank?: number;
    className?: string;
    roleHint?: RoleHint;
  };
  stats: MemberStats;
  pulls: MemberPullSnapshot[];
  source: {
    reportsScanned: number;
    fightsScanned: number;
    generatedBy: "wcl-github-api";
  };
}

export interface GuildIndexEntry {
  slug: string;
  name: string;
  realmSlug: string;
  region: Region;
  className?: string;
  rank?: number;
  updatedAt: string;
  pullsStored: number;
  kills: number;
  wipes: number;
  avgPrimaryRecent3: number;
  maxPrimaryLast10: number;
  avgDpsRecent3: number;
  maxDpsLast10: number;
  avgHpsRecent3: number;
  maxHpsLast10: number;
  deathsPerPull: number;
  stabilityPercent: number;
  primaryKindCounts: Record<PrimaryMetricKind, number>;
}

export interface GuildIndexSnapshot {
  schemaVersion: 1 | 2;
  updatedAt: string;
  guild: {
    name: string;
    realmSlug: string;
    region: Region;
  };
  totals: {
    members: number;
    reportsScanned: number;
    fightsScanned: number;
    healerPulls: number;
    damagePulls: number;
    unknownPulls: number;
  };
  members: GuildIndexEntry[];
}

export interface RefreshStateMember {
  slug: string;
  name: string;
  realmSlug: string;
  region: Region;
  rank?: number;
  className?: string;
  lastUpdatedAt?: string;
  nextEligibleAt?: string;
  pullsStored: number;
  kills: number;
  wipes: number;
  status: "updated" | "pending" | "fresh" | "missing" | "stale" | "rotated";
}

export interface IncrementalRefreshState {
  schemaVersion: 1 | 2;
  updatedAt: string;
  guild: {
    name: string;
    realmSlug: string;
    region: Region;
  };
  strategy: "incremental-member-batches" | "incremental-hourly-rolling-members";
  limits: {
    memberBatchSize: number;
    minMemberRefreshAgeHours: number;
    maxFightsPerRun: number;
    maxQueriesPerRun: number;
    requestDelayMs: number;
    maxPullsPerMember: number;
    recentAvgWindow: number;
  };
  batch: {
    selected: string[];
    updated: string[];
    pending: string[];
    skippedFresh: string[];
    missingSnapshots: string[];
    rotatedFresh: string[];
  };
  roster: {
    total: number;
    withSnapshots: number;
    pending: number;
    skippedFresh: number;
  };
  members: RefreshStateMember[];
}

export interface RefreshResult {
  ok: boolean;
  updatedAt: string;
  members: number;
  reportsScanned: number;
  fightsScanned: number;
  writtenFiles: number;
  warnings: string[];
}
