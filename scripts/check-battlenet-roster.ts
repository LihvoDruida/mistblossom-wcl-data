import { WCL_GITHUB_CONFIG } from "../src/lib/wcl-github/config";
import { loadGuildMembersFromBattleNet } from "../src/lib/wcl-github/battleNetRoster";

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required secret environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const cfg = WCL_GITHUB_CONFIG;

  const members = await loadGuildMembersFromBattleNet({
    clientId: requiredSecret("BATTLENET_CLIENT_ID"),
    clientSecret: requiredSecret("BATTLENET_CLIENT_SECRET"),
    region: process.env.BATTLENET_REGION?.trim() || cfg.battleNet.region,
    locale: process.env.BATTLENET_LOCALE?.trim() || cfg.battleNet.locale,
    realmSlug: process.env.BATTLENET_GUILD_REALM_SLUG?.trim() || cfg.battleNet.guildRealmSlug,
    guildNameSlug: process.env.BATTLENET_GUILD_NAME_SLUG?.trim() || cfg.battleNet.guildNameSlug,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        members: members.length,
        sample: members.slice(0, 10).map((member) => ({
          name: member.name,
          realmSlug: member.realmSlug,
          region: member.region,
          rank: member.rank,
          className: member.className,
          level: member.level,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
