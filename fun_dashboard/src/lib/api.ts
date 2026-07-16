import type {
  CasinoPayload,
  Faction,
  FunConfig,
  FunGroup,
  GroupSettings,
  Overview,
  RankEntry,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || res.statusText || "request-failed"
    );
  }
  return data as T;
}

export const funApi = {
  health: () => request<{ ok: boolean }>("/api/fun/health"),

  config: () => request<FunConfig>("/api/fun/config"),

  groups: () => request<{ groups: FunGroup[] }>("/api/fun/groups"),

  overview: (scope?: string) => {
    const q = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return request<Overview>(`/api/fun/overview${q}`);
  },

  leaderboard: (scope: string, kind: "xp" | "coins" | "messages" = "xp", limit = 15) =>
    request<{ scope: string; kind: string; entries: RankEntry[]; total: number }>(
      `/api/fun/leaderboard?scope=${encodeURIComponent(scope)}&kind=${kind}&limit=${limit}`
    ),

  casino: (scope: string, limit = 15) =>
    request<CasinoPayload>(
      `/api/fun/casino?scope=${encodeURIComponent(scope)}&limit=${limit}`
    ),

  factions: (scope: string) =>
    request<{ scope: string; factions: Faction[] }>(
      `/api/fun/factions?scope=${encodeURIComponent(scope)}`
    ),

  groupSettings: (groupJid: string) =>
    request<{
      groupJid: string;
      settings: GroupSettings | null;
      defaults: GroupSettings;
    }>(`/api/fun/groups/${encodeURIComponent(groupJid)}/settings`),

  saveGroupSettings: (groupJid: string, body: GroupSettings) =>
    request<{ ok: boolean; settings: GroupSettings }>(
      `/api/fun/groups/${encodeURIComponent(groupJid)}/settings`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    ),

  outbound: () =>
    request<{
      globalLastMinute: number;
      globalLastHour: number;
      dropped: number;
      config?: Record<string, unknown>;
    }>("/api/fun/outbound"),
};
