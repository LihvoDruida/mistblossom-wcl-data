import { getWclGithubEnv } from "./env";
import { GithubJsonStore } from "./githubJsonStore";
import { indexPath, memberPath } from "./slug";
import type { GuildIndexSnapshot, MemberSnapshot } from "./types";

export function createStoreFromEnv(): GithubJsonStore {
  const env = getWclGithubEnv();

  return new GithubJsonStore({
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubRepo,
    branch: env.githubBranch,
    committerName: env.githubCommitterName,
    committerEmail: env.githubCommitterEmail,
  });
}

export async function readGuildIndex(): Promise<GuildIndexSnapshot | null> {
  const env = getWclGithubEnv();
  const store = createStoreFromEnv();
  return store.readJson<GuildIndexSnapshot>(indexPath(env.githubDataPrefix));
}

export async function readMemberSnapshotBySlug(slug: string): Promise<MemberSnapshot | null> {
  const env = getWclGithubEnv();
  const index = await readGuildIndex();
  const entry = index?.members.find((member) => member.slug === slug);
  if (!entry) return null;

  const store = createStoreFromEnv();
  return store.readJson<MemberSnapshot>(memberPath(env.githubDataPrefix, entry.region, entry.realmSlug, entry.name));
}
