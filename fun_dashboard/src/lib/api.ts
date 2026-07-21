import type {
  BolsaBoard,
  BolsaEvent,
  BolsaHistory,
  BolsaRange,
  CasinoPayload,
  ChangelogBroadcastResult,
  ChangelogPayload,
  Faction,
  FunConfig,
  FunGroup,
  GroupSettings,
  Overview,
  RankEntry,
} from "./types";

/**
 * Fetch do painel — NUNCA manda API key no JS do browser.
 * Auth: cookie httpOnly `fun_dash_key` (setado pelo middleware após login).
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        (data as { error?: string }).error || "unauthorized — faça login com a API key"
      );
    }
    if (res.status === 429) {
      throw new Error("rate-limit — muitas requisições, aguarde um minuto");
    }
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

  changelog: (limit = 20) =>
    request<ChangelogPayload>(`/api/fun/changelog?limit=${limit}`),

  publishChangelog: (body: {
    title?: string;
    version?: string;
    body: string;
    groupJids?: string[];
    dryRun?: boolean;
  }) =>
    request<ChangelogBroadcastResult>("/api/fun/changelog", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Corretora read-only (público por grupo). */
  bolsa: (scope: string) =>
    request<BolsaBoard>(`/api/fun/bolsa?scope=${encodeURIComponent(scope)}`),

  bolsaHistory: (
    scope: string,
    company: string,
    opts: { range?: BolsaRange; from?: number; to?: number; limit?: number } = {}
  ) => {
    const q = new URLSearchParams({
      scope,
      company,
    });
    if (opts.range) q.set("range", opts.range);
    if (opts.from) q.set("from", String(opts.from));
    if (opts.to) q.set("to", String(opts.to));
    if (opts.limit) q.set("limit", String(opts.limit));
    return request<BolsaHistory>(`/api/fun/bolsa/history?${q.toString()}`);
  },

  bolsaEvents: (
    scope: string,
    opts: { page?: number; limit?: number } | number = {}
  ) => {
    // aceita limit numérico legado: bolsaEvents(scope, 10)
    const page = typeof opts === "number" ? 1 : opts.page || 1;
    const limit = typeof opts === "number" ? opts : opts.limit || 14;
    const q = new URLSearchParams({
      scope,
      page: String(page),
      limit: String(limit),
    });
    return request<{
      events: BolsaEvent[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      readOnly?: boolean;
    }>(`/api/fun/bolsa/events?${q.toString()}`);
  },
};
