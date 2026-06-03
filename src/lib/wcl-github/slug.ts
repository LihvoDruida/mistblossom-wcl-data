import type { Region } from "./types";

export function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function slugifyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9а-яіїєґ_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function characterSlug(name: string, realmSlug: string, region: Region): string {
  return `${slugifyPart(name)}-${slugifyPart(realmSlug)}-${slugifyPart(region)}`;
}

export function memberKey(name: string, realmSlug: string, region: Region): string {
  return `${normalizeName(name)}:${slugifyPart(realmSlug)}:${slugifyPart(region)}`;
}

export function memberPath(prefix: string, region: Region, realmSlug: string, name: string): string {
  return `${prefix}/members/${slugifyPart(region)}/${slugifyPart(realmSlug)}/${slugifyPart(name)}.json`;
}

export function indexPath(prefix: string): string {
  return `${prefix}/index.json`;
}

export function latestJobPath(prefix: string): string {
  return `${prefix}/jobs/latest.json`;
}

export function refreshStatePath(prefix: string): string {
  return `${prefix}/jobs/refresh-state.json`;
}
