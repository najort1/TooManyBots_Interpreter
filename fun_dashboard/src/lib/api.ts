import type {
  BolsaBoard,
  BolsaEvent,
  BolsaHistory,
  BolsaRange,
  CasinoPayload,
  ChangelogBroadcastResult,
  ChangelogPayload,
  DailyChallengeLaunchResult,
  DailyChallengeType,
  Faction,
  FunConfig,
  FunGroup,
  GroupSettings,
  Overview,
  RankEntry,
  HouseView,
  HouseShopItem,
  AvatarApplyError,
  AvatarApplyResult,
  AvatarPurchaseQuote,
  AvatarSlots,
  AvatarState,
  NeighborhoodHouse,
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
    const error = new Error(
      (data as { error?: string }).error || res.statusText || "request-failed"
    ) as AvatarApplyError;
    const details = data as {
      reason?: string;
      quote?: AvatarPurchaseQuote;
      current?: AvatarState;
      coins?: number;
      need?: number;
    };
    error.code = details.reason || (data as { error?: string }).error;
    error.quote = details.quote;
    error.current = details.current;
    error.coins = details.coins;
    error.need = details.need;
    throw error;
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

  triggerChaosEvent: (scope: string) =>
    request<{ ok: boolean; eventType?: string }>("/api/fun/chaos/trigger", {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),

  outbound: () =>
    request<{
      globalLastMinute: number;
      globalLastHour: number;
      dropped: number;
      config?: Record<string, unknown>;
    }>("/api/fun/outbound"),

  selfHealConfig: () => request<{ enabled: boolean; dryRun: boolean; intervalMs: number; evidenceRetentionDays: number; maxItemsPerRun: number; maxCallsPerRun: number }>("/api/fun/selfheal/config"),
  saveSelfHealConfig: (body: Record<string, unknown>) => request<{ ok: boolean; config: { enabled: boolean; dryRun: boolean; intervalMs: number; evidenceRetentionDays: number; maxItemsPerRun: number; maxCallsPerRun: number } }>("/api/fun/selfheal/config", { method: "POST", body: JSON.stringify(body) }),
  selfHealRuns: () => request<{ runs: Array<{ runId: string; domain: string; status: string; itemsAudited: number; applied: number; pendingReview: number; simulated: number }> }>("/api/fun/selfheal/runs"),
  selfHealAudit: () => request<{ entries: Array<{ id: number; domain: string; action: string; status: string; reason: string; mode: string; created_at: number }> }>("/api/fun/selfheal/audit"),
  selfHealSummary: () => request<{ totals: Record<string, number>; byDomain: Record<string, Record<string, number>>; evidence: { rows: number; retentionDays: number } }>("/api/fun/selfheal/summary"),
  runSelfHeal: (body: { domain: string; scopeKey?: string; dryRun: boolean }) => request<{ ok: boolean; runId?: string; mode?: string; results?: Array<{ ok: boolean; reason?: string }> }>("/api/fun/selfheal/run", { method: "POST", body: JSON.stringify(body) }),
  reviewSelfHeal: (findingId: number, decision: "apply" | "reject") => request<{ ok: boolean }>("/api/fun/selfheal/review", { method: "POST", body: JSON.stringify({ findingId, decision }) }),

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

  launchDailyChallengeForWhitelist: (type: DailyChallengeType) =>
    request<DailyChallengeLaunchResult>("/api/fun/daily-challenge/launch-all", {
      method: "POST",
      body: JSON.stringify({ type }),
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

  houses: {
    get: (token: string) => request<HouseView>(`/api/fun/houses/${encodeURIComponent(token)}`),
    collect: (token: string) => request<{ ok: boolean; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/collect`, { method: "POST", headers: { "x-house-token": token } }),
    place: (token: string, body: { itemId: string; x: number; y: number }) => request<{ ok: boolean; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/items/place`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify(body) }),
    move: (token: string, body: { itemId: string; x: number; y: number; rotation?: number; rotated?: boolean }) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/items/move`, { method: "PUT", headers: { "x-house-token": token }, body: JSON.stringify(body) }),
    applyStyle: (token: string, itemId: string) => request<{ ok: boolean; coins: number; purchased: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/styles/apply`, { method: "PUT", headers: { "x-house-token": token }, body: JSON.stringify({ itemId }) }),
    sell: (token: string, itemId: string) => request<{ ok: boolean; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/items/sell`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ itemId }) }),
    neighborhood: (token: string) => request<{ houses: NeighborhoodHouse[] }>('/api/fun/houses/' + encodeURIComponent(token) + '/neighborhood'),
    neighbor: (token: string, houseId: string) => request<HouseView>(`/api/fun/houses/${encodeURIComponent(token)}/neighbors/${encodeURIComponent(houseId)}`),
    shop: (token: string) => request<{ shop: HouseShopItem[]; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/shop`),
    avatar: (token: string) => request<AvatarState>(`/api/fun/houses/${encodeURIComponent(token)}/avatar`),
    applyAvatar: (token: string, body: {
      slots: AvatarSlots;
      expectedRevision: number;
      catalogRevision: number;
      idempotencyKey: string;
      confirmedPurchase?: AvatarPurchaseQuote;
    }) => request<AvatarApplyResult>(`/api/fun/houses/${encodeURIComponent(token)}/avatar`, {
      method: "PUT",
      headers: { "x-house-token": token },
      body: JSON.stringify(body),
    }),
    equipAvatar: (token: string, itemId: string) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/avatar`, { method: "PUT", headers: { "x-house-token": token }, body: JSON.stringify({ itemId }) }),
    buyAvatar: (token: string, itemId: string) => request<{ ok: boolean; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/avatar/shop`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ itemId }) }),
    visit: (token: string, note: string) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/visit`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ note }) }),
    giftCoins: (token: string, coins: number) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/gifts`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ coins }) }),
    rob: (token: string) => request<{ ok: boolean; result: string; fine?: number }>(`/api/fun/houses/${encodeURIComponent(token)}/rob`, { method: "POST", headers: { "x-house-token": token } }),
    visitNeighbor: (token: string, houseId: string, note: string) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/neighbors/${encodeURIComponent(houseId)}/visit`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ note }) }),
    giftNeighbor: (token: string, houseId: string, coins: number) => request<{ ok: boolean }>(`/api/fun/houses/${encodeURIComponent(token)}/neighbors/${encodeURIComponent(houseId)}/gifts`, { method: "POST", headers: { "x-house-token": token }, body: JSON.stringify({ coins }) }),
    robNeighbor: (token: string, houseId: string) => request<{ ok: boolean; result: string; fine?: number }>(`/api/fun/houses/${encodeURIComponent(token)}/neighbors/${encodeURIComponent(houseId)}/rob`, { method: "POST", headers: { "x-house-token": token } }),
    upgradeSecurity: (token: string) => request<{ ok: boolean; coins: number }>(`/api/fun/houses/${encodeURIComponent(token)}/security`, { method: "POST", headers: { "x-house-token": token } }),
  }
};
