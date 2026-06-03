import { WCL_GITHUB_CONFIG } from "./config";

export interface WclGithubEnv {
  wclClientId: string;
  wclClientSecret: string;
  wclTokenUrl: string;
  wclGraphqlUrl: string;

  battleNetClientId: string;
  battleNetClientSecret: string;
  battleNetRegion: string;
  battleNetLocale: string;
  battleNetGuildRealmSlug: string;
  battleNetGuildNameSlug: string;

  githubToken?: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubDataPrefix: string;
  githubCommitterName: string;
  githubCommitterEmail: string;

  refreshSecret?: string;

  wclGuildName: string;
  wclGuildRealmSlug: string;
  wclGuildRegion: string;
  wclReportLimit: number;
  wclMaxReportPages: number;
  maxPullsPerMember: number;
  recentAvgWindow: number;
  memberBatchSize: number;
  minMemberRefreshAgeHours: number;
  maxFightsPerRun: number;
  maxWclQueriesPerRun: number;
  minFightDurationMs: number;
  targetNewPullsPerMember: number;
  wclRequestDelayMs: number;
}

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required secret environment variable: ${name}`);
  }
  return value;
}

function optionalSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function configValue(value: string, path: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("paste_")) {
    throw new Error(`Missing non-secret WCL GitHub config value: ${path}`);
  }
  return trimmed;
}

function envOverride(name: string, fallback: string, path: string): string {
  return process.env[name]?.trim() || configValue(fallback, path);
}

function numberValue(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function envNumberOverride(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return numberValue(fallback, fallback);

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clampPullLimit(value: number): number {
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function getWclGithubEnv(): WclGithubEnv {
  const cfg = WCL_GITHUB_CONFIG;

  return {
    wclClientId: requiredSecret("WCL_CLIENT_ID"),
    wclClientSecret: requiredSecret("WCL_CLIENT_SECRET"),
    wclTokenUrl: envOverride("WCL_TOKEN_URL", cfg.wcl.tokenUrl, "wcl.tokenUrl"),
    wclGraphqlUrl: envOverride("WCL_GRAPHQL_URL", cfg.wcl.graphqlUrl, "wcl.graphqlUrl"),

    battleNetClientId: requiredSecret("BATTLENET_CLIENT_ID"),
    battleNetClientSecret: requiredSecret("BATTLENET_CLIENT_SECRET"),
    battleNetRegion: envOverride("BATTLENET_REGION", cfg.battleNet.region, "battleNet.region").toLowerCase(),
    battleNetLocale: envOverride("BATTLENET_LOCALE", cfg.battleNet.locale, "battleNet.locale"),
    battleNetGuildRealmSlug: envOverride(
      "BATTLENET_GUILD_REALM_SLUG",
      cfg.battleNet.guildRealmSlug,
      "battleNet.guildRealmSlug",
    ).toLowerCase(),
    battleNetGuildNameSlug: envOverride(
      "BATTLENET_GUILD_NAME_SLUG",
      cfg.battleNet.guildNameSlug,
      "battleNet.guildNameSlug",
    ).toLowerCase(),

    githubToken: optionalSecret("WCL_DATA_REPO_TOKEN"),
    githubOwner: envOverride("WCL_DATA_REPO_OWNER", cfg.github.owner, "github.owner"),
    githubRepo: envOverride("WCL_DATA_REPO_NAME", cfg.github.repo, "github.repo"),
    githubBranch: envOverride("WCL_DATA_REPO_BRANCH", cfg.github.branch, "github.branch"),
    githubDataPrefix: envOverride("WCL_DATA_PREFIX", cfg.github.dataPrefix, "github.dataPrefix").replace(/^\/|\/$/g, ""),
    githubCommitterName: envOverride("WCL_DATA_COMMITTER_NAME", cfg.github.committerName, "github.committerName"),
    githubCommitterEmail: envOverride("WCL_DATA_COMMITTER_EMAIL", cfg.github.committerEmail, "github.committerEmail"),

    refreshSecret: optionalSecret("WCL_REFRESH_SECRET"),

    wclGuildName: envOverride("WCL_GUILD_NAME", cfg.wcl.guild.name, "wcl.guild.name"),
    wclGuildRealmSlug: envOverride("WCL_GUILD_REALM_SLUG", cfg.wcl.guild.realmSlug, "wcl.guild.realmSlug").toLowerCase(),
    wclGuildRegion: envOverride("WCL_GUILD_REGION", cfg.wcl.guild.region, "wcl.guild.region").toLowerCase(),
    wclReportLimit: clampInt(envNumberOverride("WCL_REPORT_LIMIT", cfg.wcl.scan.reportLimit), 1, 25),
    wclMaxReportPages: clampInt(envNumberOverride("WCL_MAX_REPORT_PAGES", cfg.wcl.scan.maxReportPages), 1, 5),
    maxPullsPerMember: clampPullLimit(envNumberOverride("WCL_MAX_PULLS_PER_MEMBER", cfg.wcl.scan.maxPullsPerMember)),
    recentAvgWindow: clampInt(envNumberOverride("WCL_RECENT_AVG_WINDOW", cfg.wcl.scan.recentAvgWindow), 1, 10),
    memberBatchSize: clampInt(envNumberOverride("WCL_MEMBER_BATCH_SIZE", cfg.wcl.scan.memberBatchSize), 1, 50),
    minMemberRefreshAgeHours: clampInt(
      envNumberOverride("WCL_MIN_MEMBER_REFRESH_AGE_HOURS", cfg.wcl.scan.minMemberRefreshAgeHours),
      1,
      168,
    ),
    maxFightsPerRun: clampInt(envNumberOverride("WCL_MAX_FIGHTS_PER_RUN", cfg.wcl.scan.maxFightsPerRun), 1, 60),
    maxWclQueriesPerRun: clampInt(envNumberOverride("WCL_MAX_QUERIES_PER_RUN", cfg.wcl.scan.maxQueriesPerRun), 5, 120),
    minFightDurationMs: clampInt(envNumberOverride("WCL_MIN_FIGHT_DURATION_MS", cfg.wcl.scan.minFightDurationMs), 0, 180_000),
    targetNewPullsPerMember: clampInt(envNumberOverride("WCL_TARGET_NEW_PULLS_PER_MEMBER", cfg.wcl.scan.targetNewPullsPerMember), 1, 10),
    wclRequestDelayMs: clampInt(envNumberOverride("WCL_REQUEST_DELAY_MS", cfg.wcl.scan.requestDelayMs), 0, 10000),
  };
}
