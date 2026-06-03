import type { GuildMemberInput } from "./types";

let battleNetTokenCache: { accessToken: string; expiresAt: number } | null = null;

export async function loadGuildMembersFromBattleNet(options: {
  clientId: string;
  clientSecret: string;
  region: string;
  locale: string;
  realmSlug: string;
  guildNameSlug: string;
}): Promise<GuildMemberInput[]> {
  const token = await getBattleNetToken(options.clientId, options.clientSecret, options.region);
  const region = options.region.toLowerCase();
  const namespace = `profile-${region}`;
  const realmSlug = normalizeSlug(options.realmSlug);
  const guildNameSlug = normalizeSlug(options.guildNameSlug);

  /**
   * Battle.net guild roster is a Profile API resource, but Blizzard exposes it under /data.
   * Correct retail endpoint:
   *   /data/wow/guild/{realmSlug}/{guildNameSlug}/roster?namespace=profile-{region}
   *
   * The older /profile/wow/guild/... shape returns 404 for valid retail guilds.
   */
  const url =
    `https://${region}.api.blizzard.com/data/wow/guild/` +
    `${encodeURIComponent(realmSlug)}/` +
    `${encodeURIComponent(guildNameSlug)}/roster` +
    `?namespace=${encodeURIComponent(namespace)}&locale=${encodeURIComponent(options.locale)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Region: region,
      "Battlenet-Namespace": namespace,
      "User-Agent": "mistblossom-wcl-data/1.0 (+https://github.com/LihvoDruida/mistblossom-wcl-data)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(
      [
        `Battle.net roster request failed ${response.status}.`,
        `Endpoint: ${url}`,
        `Configured guild: ${options.guildNameSlug} @ ${options.realmSlug} (${region})`,
        `Check battleNet.guildRealmSlug and battleNet.guildNameSlug in src/lib/wcl-github/config.ts.`,
        body ? `Response: ${body}` : "Response body is empty.",
      ].join("\n"),
    );
  }

  const json = (await response.json()) as {
    members?: Array<{
      rank?: number;
      character?: {
        name?: string;
        realm?: { slug?: string };
        playable_class?: { name?: string };
        level?: number;
      };
    }>;
  };

  const members: GuildMemberInput[] = [];

  for (const member of json.members ?? []) {
    const character = member.character;
    if (!character?.name) continue;

    members.push({
      name: character.name,
      realmSlug: character.realm?.slug || realmSlug,
      region,
      rank: member.rank,
      className: character.playable_class?.name,
      level: character.level,
      roleHint: "unknown",
      source: "battle-net",
    });
  }

  return members;
}

async function getBattleNetToken(clientId: string, clientSecret: string, region: string): Promise<string> {
  const now = Date.now();
  if (battleNetTokenCache && battleNetTokenCache.expiresAt > now + 60_000) {
    return battleNetTokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const tokenUrl = `https://${region.toLowerCase()}.battle.net/oauth/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "mistblossom-wcl-data/1.0 (+https://github.com/LihvoDruida/mistblossom-wcl-data)",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Battle.net token request failed ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as { access_token: string; expires_in?: number };
  if (!json.access_token) throw new Error("Battle.net token response has no access_token");

  battleNetTokenCache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };

  return battleNetTokenCache.accessToken;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
