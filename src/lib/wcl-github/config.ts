export interface WclGithubStaticConfig {
  wcl: {
    tokenUrl: string;
    graphqlUrl: string;
    guild: {
      name: string;
      realmSlug: string;
      region: string;
    };
    scan: {
      /** How many recent reports to request per report page. */
      reportLimit: number;
      /** How many report pages to inspect before stopping. */
      maxReportPages: number;
      /** How many pulls to keep per member snapshot. Hard-clamped to 10. */
      maxPullsPerMember: number;
      /** Average window for the recent performance block. */
      recentAvgWindow: number;
      /** How many roster members are refreshed by one hourly run. */
      memberBatchSize: number;
      /** Preferred freshness window. If everyone is fresh, the oldest snapshots still rotate hourly. */
      minMemberRefreshAgeHours: number;
      /** Hard cap for detailed fight scans in one hourly run. */
      maxFightsPerRun: number;
      /** Hard cap for Warcraft Logs GraphQL queries in one hourly run. Keep this conservative. */
      maxQueriesPerRun: number;
      /** Ignore ultra-short accidental pulls; real wipes/kills still remain in queue through later runs. */
      minFightDurationMs: number;
      /** Stop a run early when every selected member received this many new pulls. */
      targetNewPullsPerMember: number;
      /** Small pause between Warcraft Logs GraphQL requests to avoid bursts. */
      requestDelayMs: number;
    };
  };
  battleNet: {
    region: string;
    locale: string;
    guildRealmSlug: string;
    guildNameSlug: string;
  };
  github: {
    owner: string;
    repo: string;
    branch: string;
    dataPrefix: string;
    committerName: string;
    committerEmail: string;
  };
}

/**
 * Non-sensitive WCL/Battle.net/GitHub settings.
 *
 * Keep real secrets and OAuth client identifiers only in .env / Vercel / GitHub Secrets:
 * - WCL_CLIENT_ID
 * - WCL_CLIENT_SECRET
 * - BATTLENET_CLIENT_ID
 * - BATTLENET_CLIENT_SECRET
 * - WCL_DATA_REPO_TOKEN
 * - WCL_REFRESH_SECRET
 */
export const WCL_GITHUB_CONFIG: WclGithubStaticConfig = {
  wcl: {
    tokenUrl: "https://www.warcraftlogs.com/oauth/token",
    graphqlUrl: "https://www.warcraftlogs.com/api/v2/client",
    guild: {
      name: "Mistblossom Vanguard",
      realmSlug: "terokkar",
      region: "eu",
    },
    scan: {
      reportLimit: 8,
      maxReportPages: 1,
      maxPullsPerMember: 10,
      recentAvgWindow: 3,
      memberBatchSize: 8,
      minMemberRefreshAgeHours: 12,
      maxFightsPerRun: 8,
      maxQueriesPerRun: 28,
      minFightDurationMs: 30_000,
      targetNewPullsPerMember: 1,
      requestDelayMs: 1_200,
    },
  },
  battleNet: {
    region: "eu",
    locale: "en_GB",
    guildRealmSlug: "terokkar",
    guildNameSlug: "mistblossom-vanguard",
  },
  github: {
    owner: "LihvoDruida",
    repo: "mistblossom-wcl-data",
    branch: "main",
    dataPrefix: "data/wcl",
    committerName: "melles1991",
    committerEmail: "melles1991@users.noreply.github.com",
  },
};
