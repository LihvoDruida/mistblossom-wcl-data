export type Region = "us" | "eu" | "kr" | "tw" | "cn" | string;
export type PullStatus = "KILL" | "WIPE";
export type RoleHint = "tank" | "healer" | "dps" | "unknown";

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
}

export interface PullMetric {
  dps: number;
  hps: number;
  primary: number;
  primaryKind: "dps" | "hps" | "unknown";
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
}

export interface NumericWindowSummary {
  avgDps: number;
  avgHps: number;
  avgPrimary: number;
  avgDurationMs: number;
  avgDeaths: number;
}

export interface Last10Summary {
  maxDps: number;
  minDps: number;
  maxHps: number;
  minHps: number;
  maxPrimary: number;
  minPrimary: number;
  maxDurationMs: number;
  minDurationMs: number;
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
}

export interface MemberSnapshot {
  schemaVersion: 1;
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
  deathsPerPull: number;
  stabilityPercent: number;
}

export interface GuildIndexSnapshot {
  schemaVersion: 1;
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
  status: "updated" | "pending" | "fresh" | "missing" | "stale";
}

export interface IncrementalRefreshState {
  schemaVersion: 1;
  updatedAt: string;
  guild: {
    name: string;
    realmSlug: string;
    region: Region;
  };
  strategy: "incremental-member-batches";
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
