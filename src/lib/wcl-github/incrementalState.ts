import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  GuildMemberInput,
  IncrementalRefreshState,
  MemberPullSnapshot,
  MemberSnapshot,
  RefreshStateMember,
} from "./types";
import { characterSlug, memberPath, refreshStatePath } from "./slug";
import { buildMemberSnapshot } from "./stats";

export interface BatchSelection {
  selected: GuildMemberInput[];
  selectedSlugs: string[];
  pendingSlugs: string[];
  skippedFreshSlugs: string[];
  missingSnapshotSlugs: string[];
  rotatedFreshSlugs: string[];
}

export async function loadExistingMemberSnapshots(dataPrefix: string): Promise<Map<string, MemberSnapshot>> {
  const root = path.join(dataPrefix, "members");
  const files = await listJsonFilesSafe(root);
  const snapshots = new Map<string, MemberSnapshot>();

  for (const file of files) {
    const snapshot = await readJsonSafe<MemberSnapshot>(file);
    const slug = snapshot?.character?.slug;
    if (!slug) continue;
    snapshots.set(slug, migrateSnapshot(snapshot));
  }

  return snapshots;
}

export async function loadIncrementalRefreshState(dataPrefix: string): Promise<IncrementalRefreshState | undefined> {
  return readJsonSafe<IncrementalRefreshState>(refreshStatePath(dataPrefix));
}


function migrateSnapshot(snapshot: MemberSnapshot): MemberSnapshot {
  const character = snapshot.character;
  const pulls = (snapshot.pulls ?? []).map(normalizeLegacyPull);

  const migrated = buildMemberSnapshot(
    {
      name: character.name,
      realmSlug: character.realmSlug,
      region: character.region,
      rank: character.rank,
      className: character.className,
      roleHint: character.roleHint,
    },
    pulls,
    snapshot.source?.reportsScanned ?? 0,
    snapshot.source?.fightsScanned ?? 0,
    3,
    10,
  );

  return {
    ...migrated,
    // Preserve age for the rolling queue. Rebuilding stats must not make old snapshots look new.
    updatedAt: snapshot.updatedAt || migrated.updatedAt,
  };
}

function normalizeLegacyPull(pull: MemberPullSnapshot): MemberPullSnapshot {
  const primaryKind = pull.metric?.primaryKind ?? "unknown";
  const role = pull.role ?? {
    role: primaryKind === "hps" ? "healer" : primaryKind === "dps" ? "dps" : "unknown",
    source: "unknown" as const,
    confidence: 0,
  };
  const dps = pull.metric?.dps ?? 0;
  const hps = pull.metric?.hps ?? 0;

  return {
    ...pull,
    role,
    metric: {
      dps,
      hps,
      primary: pull.metric?.primary ?? (primaryKind === "hps" ? hps : primaryKind === "dps" ? dps : 0),
      primaryKind,
      fightDps: pull.metric?.fightDps ?? dps,
      fightHps: pull.metric?.fightHps ?? hps,
      activeDps: pull.metric?.activeDps ?? dps,
      activeHps: pull.metric?.activeHps ?? hps,
      damageRateSource: pull.metric?.damageRateSource ?? "none",
      healingRateSource: pull.metric?.healingRateSource ?? "none",
    },
  };
}

export function dedupeGuildMembers(members: GuildMemberInput[]): GuildMemberInput[] {
  const bySlug = new Map<string, GuildMemberInput>();

  for (const member of members) {
    const slug = characterSlug(member.name, member.realmSlug, member.region);
    if (!bySlug.has(slug)) bySlug.set(slug, member);
  }

  return [...bySlug.values()].sort(compareMembers);
}

export function selectMembersForIncrementalRefresh(
  members: GuildMemberInput[],
  existingSnapshots: Map<string, MemberSnapshot>,
  options: {
    batchSize: number;
    minAgeHours: number;
    now?: Date;
  },
): BatchSelection {
  const now = options.now ?? new Date();
  const minAgeMs = Math.max(1, options.minAgeHours) * 60 * 60 * 1000;
  const batchSize = Math.max(1, Math.floor(options.batchSize));
  const normalized = dedupeGuildMembers(members);

  const missing: GuildMemberInput[] = [];
  const stale: GuildMemberInput[] = [];
  const fresh: GuildMemberInput[] = [];

  for (const member of normalized) {
    const slug = characterSlug(member.name, member.realmSlug, member.region);
    const snapshot = existingSnapshots.get(slug);
    if (!snapshot) {
      missing.push(member);
      continue;
    }

    const updatedAtMs = Date.parse(snapshot.updatedAt);
    const ageMs = Number.isFinite(updatedAtMs) ? now.getTime() - updatedAtMs : Number.POSITIVE_INFINITY;
    if (ageMs >= minAgeMs) stale.push(member);
    else fresh.push(member);
  }

  stale.sort((a, b) => snapshotAgeSort(existingSnapshots, a, b));
  fresh.sort((a, b) => snapshotAgeSort(existingSnapshots, a, b));

  const priority = [...missing, ...stale];
  const selected = priority.slice(0, batchSize);
  const selectedSet = new Set(selected.map((member) => characterSlug(member.name, member.realmSlug, member.region)));

  // If every member is still inside the preferred freshness window, keep the hourly queue moving anyway.
  // This prevents empty runs and makes the oldest snapshots rotate forward without increasing WCL query caps.
  const rotatedFresh: GuildMemberInput[] = [];
  for (const member of fresh) {
    if (selected.length >= batchSize) break;
    const slug = characterSlug(member.name, member.realmSlug, member.region);
    if (selectedSet.has(slug)) continue;
    selected.push(member);
    selectedSet.add(slug);
    rotatedFresh.push(member);
  }

  const pending = priority
    .map((member) => characterSlug(member.name, member.realmSlug, member.region))
    .filter((slug) => !selectedSet.has(slug));

  const rotatedFreshSet = new Set(rotatedFresh.map((member) => characterSlug(member.name, member.realmSlug, member.region)));

  return {
    selected,
    selectedSlugs: selected.map((member) => characterSlug(member.name, member.realmSlug, member.region)),
    pendingSlugs: pending,
    skippedFreshSlugs: fresh
      .map((member) => characterSlug(member.name, member.realmSlug, member.region))
      .filter((slug) => !rotatedFreshSet.has(slug)),
    missingSnapshotSlugs: missing.map((member) => characterSlug(member.name, member.realmSlug, member.region)),
    rotatedFreshSlugs: [...rotatedFreshSet],
  };
}

export function buildIncrementalRefreshState(args: {
  updatedAt: string;
  guild: { name: string; realmSlug: string; region: string };
  roster: GuildMemberInput[];
  snapshots: Map<string, MemberSnapshot>;
  selectedSlugs: string[];
  updatedSlugs: string[];
  pendingSlugs: string[];
  skippedFreshSlugs: string[];
  missingSnapshotSlugs: string[];
  rotatedFreshSlugs: string[];
  limits: IncrementalRefreshState["limits"];
}): IncrementalRefreshState {
  const selected = new Set(args.selectedSlugs);
  const pending = new Set(args.pendingSlugs);
  const skippedFresh = new Set(args.skippedFreshSlugs);
  const missing = new Set(args.missingSnapshotSlugs);
  const updated = new Set(args.updatedSlugs);
  const rotatedFresh = new Set(args.rotatedFreshSlugs);

  const members: RefreshStateMember[] = dedupeGuildMembers(args.roster).map((member) => {
    const slug = characterSlug(member.name, member.realmSlug, member.region);
    const snapshot = args.snapshots.get(slug);
    const lastUpdatedAt = snapshot?.updatedAt;
    const nextEligibleAt = lastUpdatedAt
      ? new Date(Date.parse(lastUpdatedAt) + args.limits.minMemberRefreshAgeHours * 60 * 60 * 1000).toISOString()
      : undefined;

    return {
      slug,
      name: member.name,
      realmSlug: member.realmSlug,
      region: member.region,
      rank: member.rank,
      className: member.className,
      lastUpdatedAt,
      nextEligibleAt,
      pullsStored: snapshot?.stats.pullsStored ?? 0,
      kills: snapshot?.stats.kills ?? 0,
      wipes: snapshot?.stats.wipes ?? 0,
      status: updated.has(slug)
        ? "updated"
        : pending.has(slug)
          ? "pending"
          : rotatedFresh.has(slug)
            ? "rotated"
            : skippedFresh.has(slug)
            ? "fresh"
            : missing.has(slug)
              ? "missing"
              : selected.has(slug)
                ? "stale"
                : "fresh",
    };
  });

  return {
    schemaVersion: 2,
    updatedAt: args.updatedAt,
    guild: args.guild,
    strategy: "incremental-hourly-rolling-members",
    limits: args.limits,
    batch: {
      selected: args.selectedSlugs,
      updated: args.updatedSlugs,
      pending: args.pendingSlugs,
      skippedFresh: args.skippedFreshSlugs,
      missingSnapshots: args.missingSnapshotSlugs,
      rotatedFresh: args.rotatedFreshSlugs,
    },
    roster: {
      total: members.length,
      withSnapshots: members.filter((member) => Boolean(member.lastUpdatedAt)).length,
      pending: args.pendingSlugs.length,
      skippedFresh: args.skippedFreshSlugs.length,
    },
    members,
  };
}

export function snapshotListForCurrentRoster(
  roster: GuildMemberInput[],
  snapshots: Map<string, MemberSnapshot>,
): MemberSnapshot[] {
  const slugs = new Set(dedupeGuildMembers(roster).map((member) => characterSlug(member.name, member.realmSlug, member.region)));
  return [...snapshots.values()]
    .filter((snapshot) => slugs.has(snapshot.character.slug))
    .sort((a, b) => {
      const rankA = a.character.rank ?? 999;
      const rankB = b.character.rank ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return a.character.name.localeCompare(b.character.name);
    });
}

async function listJsonFilesSafe(dir: string): Promise<string[]> {
  try {
    return await listJsonFiles(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }

  return result;
}

async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function compareMembers(a: GuildMemberInput, b: GuildMemberInput): number {
  const rankA = a.rank ?? 999;
  const rankB = b.rank ?? 999;
  if (rankA !== rankB) return rankA - rankB;
  return characterSlug(a.name, a.realmSlug, a.region).localeCompare(characterSlug(b.name, b.realmSlug, b.region));
}

function snapshotAgeSort(
  existingSnapshots: Map<string, MemberSnapshot>,
  a: GuildMemberInput,
  b: GuildMemberInput,
): number {
  const slugA = characterSlug(a.name, a.realmSlug, a.region);
  const slugB = characterSlug(b.name, b.realmSlug, b.region);
  const timeA = Date.parse(existingSnapshots.get(slugA)?.updatedAt ?? "1970-01-01T00:00:00.000Z");
  const timeB = Date.parse(existingSnapshots.get(slugB)?.updatedAt ?? "1970-01-01T00:00:00.000Z");
  if (timeA !== timeB) return timeA - timeB;
  return compareMembers(a, b);
}
