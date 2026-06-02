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
      reportLimit: number;
      maxReportPages: number;
      maxPullsPerMember: number;
      recentAvgWindow: number;
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
      reportLimit: 12,
      maxReportPages: 2,
      maxPullsPerMember: 10,
      recentAvgWindow: 3,
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
