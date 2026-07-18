const KEY = "fun-bolsa-favorites";

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(String).filter(Boolean).slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 24)));
  } catch {
    /* ignore */
  }
}

export function toggleFavorite(ids: string[], id: string): string[] {
  const set = new Set(ids);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return Array.from(set);
}
