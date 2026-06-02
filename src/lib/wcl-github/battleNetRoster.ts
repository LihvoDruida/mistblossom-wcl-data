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
  const url =
    `https://${region}.api.blizzard.com/profile/wow/guild/` +
    `${encodeURIComponent(options.realmSlug.toLowerCase())}/` +
    `${encodeURIComponent(options.guildNameSlug.toLowerCase())}/roster` +
    `?namespace=${encodeURIComponent(namespace)}&locale=${encodeURIComponent(options.locale)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Battlenet-Namespace": namespace,
      "User-Agent": "wcl-github-api-mechanism",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Battle.net roster request failed ${response.status}: ${await response.text()}`);
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

  return (json.members ?? [])
    .map((member) => {
      const character = member.character;
      if (!character?.name) return null;

      return {
        name: character.name,
        realmSlug: character.realm?.slug || options.realmSlug,
        region,
        rank: member.rank,
        className: character.playable_class?.name,
        level: character.level,
        roleHint: "unknown" as const,
        source: "battle-net" as const,
      };
    })
    .filter((member): member is GuildMemberInput => Boolean(member));
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
      "User-Agent": "wcl-github-api-mechanism",
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
