export class WclClient {
  private token: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
      graphqlUrl: string;
    },
  ) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const accessToken = await this.getAccessToken();

    const response = await fetch(this.options.graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "wcl-github-api-mechanism",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`Warcraft Logs rate limit reached. Retry-After: ${retryAfter ?? "unknown"}`);
    }

    if (!response.ok) {
      throw new Error(`Warcraft Logs request failed ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      throw new Error(`Warcraft Logs GraphQL error: ${json.errors.map((error) => error.message).join("; ")}`);
    }

    if (!json.data) {
      throw new Error("Warcraft Logs GraphQL response has no data");
    }

    return json.data;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.accessToken;
    }

    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`, "utf8").toString("base64");

    const response = await fetch(this.options.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "wcl-github-api-mechanism",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Warcraft Logs token request failed ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { access_token: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error("Warcraft Logs token response has no access_token");
    }

    this.token = {
      accessToken: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };

    return this.token.accessToken;
  }
}

export const GUILD_REPORTS_QUERY = `
query GuildReports(
  $guildName: String!
  $guildServerSlug: String!
  $guildServerRegion: String!
  $limit: Int!
  $page: Int!
) {
  reportData {
    reports(
      guildName: $guildName
      guildServerSlug: $guildServerSlug
      guildServerRegion: $guildServerRegion
      limit: $limit
      page: $page
    ) {
      current_page
      last_page
      data {
        code
        title
        startTime
        endTime
        zone {
          id
          name
        }
      }
    }
  }
}
`;

export const REPORT_FIGHTS_QUERY = `
query ReportFights($code: String!) {
  reportData {
    report(code: $code) {
      code
      title
      startTime
      endTime
      masterData {
        actors {
          id
          name
          type
          subType
          server
        }
      }
      fights(killType: Encounters) {
        id
        name
        encounterID
        difficulty
        kill
        startTime
        endTime
        bossPercentage
        fightPercentage
        averageItemLevel
      }
    }
  }
}
`;

export const REPORT_TABLE_QUERY = `
query ReportTable(
  $code: String!
  $dataType: TableDataType!
  $startTime: Float!
  $endTime: Float!
) {
  reportData {
    report(code: $code) {
      table(
        dataType: $dataType
        killType: Encounters
        startTime: $startTime
        endTime: $endTime
        viewBy: Source
      )
    }
  }
}
`;

export const REPORT_DEATH_EVENTS_QUERY = `
query ReportDeaths(
  $code: String!
  $startTime: Float!
  $endTime: Float!
) {
  reportData {
    report(code: $code) {
      events(
        dataType: Deaths
        startTime: $startTime
        endTime: $endTime
        limit: 10000
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}
`;
