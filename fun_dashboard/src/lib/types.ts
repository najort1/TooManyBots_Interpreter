export type FunGroup = {
  jid: string;
  name: string;
  players: number;
  jackpot: number;
  eventType: string;
  eventEndsAt: number;
  settings: Record<string, unknown> | null;
};

export type RankEntry = {
  rank: number;
  userJid: string;
  displayName?: string;
  xp?: number;
  level?: number;
  coins?: number;
  messageCount?: number;
  wagered?: number;
  won?: number;
  lost?: number;
  games?: number;
  profit?: number;
};

export type Overview = {
  scope: string;
  groups: number;
  players: number;
  jackpot: number;
  factions: number;
  event: {
    eventType: string;
    multiplier: number;
    endsAt: number;
    active: boolean;
  } | null;
  topXp: RankEntry[];
  topCoins: RankEntry[];
  outbound: {
    globalLastMinute: number;
    globalLastHour: number;
    dropped: number;
    maxPerMinute?: number;
    maxPerHour?: number;
  } | null;
  features: {
    zen: boolean;
    ollama: boolean;
    tarot: boolean;
    privateReplies: boolean;
  };
};

export type ChangelogGroup = {
  jid: string;
  name: string;
};

export type ChangelogResultRow = {
  jid: string;
  name?: string;
  ok: boolean;
  dryRun?: boolean;
  reason?: string;
};

export type ChangelogHistoryItem = {
  id: string;
  title: string;
  version: string;
  body: string;
  messageText: string;
  targetCount: number;
  okCount: number;
  failCount: number;
  dryRun: boolean;
  results: ChangelogResultRow[];
  createdAt: number;
};

export type ChangelogPayload = {
  whatsappReady: boolean;
  groups: ChangelogGroup[];
  history: ChangelogHistoryItem[];
};

export type DailyChallengeType = "guess_game" | "riddle" | "pokemon";

export type DailyChallengeLaunchRow = {
  jid: string;
  ok: boolean;
  replacedChallengeId?: number;
  challenge?: {
    id: number;
    type: DailyChallengeType;
    challengeType: DailyChallengeType;
  };
  reason?: string;
};

export type DailyChallengeLaunchResult = {
  ok: boolean;
  type?: DailyChallengeType;
  targetCount?: number;
  okCount?: number;
  failCount?: number;
  results?: DailyChallengeLaunchRow[];
  reason?: string;
  error?: string;
};

export type ChangelogBroadcastResult = {
  ok: boolean;
  id?: string;
  dryRun?: boolean;
  text?: string;
  title?: string;
  version?: string;
  targetCount?: number;
  okCount?: number;
  failCount?: number;
  results?: ChangelogResultRow[];
  createdAt?: number;
  reason?: string;
  error?: string;
  message?: string;
  targets?: string[];
  preview?: ChangelogGroup[];
};

export type FunConfig = {
  prefix: string;
  groupWhitelistJids: string[];
  xpMin: number;
  xpMax: number;
  cooldownMs: number;
  dailyXp: number;
  dailyCoins: number;
  rankLimit: number;
  allowDm: boolean;
  replyCommandsInPrivate: boolean;
  /** Bot @marca usuários no chat (default true). */
  mentionUsers?: boolean;
  /** Respostas citam (reply) a mensagem do usuário (default true). */
  replyQuoted?: boolean;
  zenEnabled: boolean;
  zenBaseUrl: string;
  zenModel: string;
  ollamaEnabled: boolean;
  ollamaModel: string;
  tarotEnabled: boolean;
  tarotCooldownMs: number;
  bingoMin: number;
  bingoMax: number;
  casinoMin: number;
  casinoMax: number;
};

export type GroupSettings = {
  enabled?: boolean;
  xpMin?: number;
  xpMax?: number;
  cooldownMs?: number;
  rankLimit?: number;
  dailyXp?: number;
  dailyCoins?: number;
  levelUpAnnounce?: boolean;
  /** Persona (membro vivo) por grupo. Default true. */
  personaEnabled?: boolean;
  /** Eventos aleatórios do mundo (mercado auto + trégua). Happy hour segue anunciando. Default true. */
  worldEventsEnabled?: boolean;
  /** Jornal diário automático (~23:59). Default true. */
  journalAutoEnabled?: boolean;
  /** Mercado de rua automático. Default true. */
  marketAutoEnabled?: boolean;
  /** Happy hour automático do cassino. Default true. */
  happyHourAutoEnabled?: boolean;
  /** PURGA / evento de caos automático. Default true. */
  chaosAutoEnabled?: boolean;
  /** Reposição semanal de estoque. Default true. */
  weeklyRestockAutoEnabled?: boolean;
};

export type CasinoPayload = {
  scope: string;
  jackpot: number;
  jackpotUpdatedAt: number;
  board: RankEntry[];
  tournament: {
    entryFee: number;
    pot: number;
    players: string[];
    status: string;
  } | null;
};

export type Faction = {
  id: string;
  name: string;
  emoji: string;
  leaderJid: string;
  leaderName?: string;
  vaultCoins: number;
  motto?: string;
};

/** Cotação pública (read-only) da corretora Fun. */
export type BolsaQuote = {
  id: string;
  name: string;
  emoji: string;
  ticker: string;
  blurb: string;
  price: number;
  previousPrice: number;
  highPrice: number;
  atHigh: boolean;
  trend: string;
  delta: number;
  deltaPct: number;
  fromAthPct: number;
  dividendYield: number;
  dividendRare: boolean;
  risk: number;
  volatility: number;
  volumeBuy: number;
  volumeSell: number;
  eventShock: number;
  updatedAt: number;
};

export type BolsaBoard = {
  /** Nome amigável do grupo (sem JID). */
  groupName?: string;
  enabled: boolean;
  readOnly?: boolean;
  ts: number;
  quotes: BolsaQuote[];
  summary: {
    count: number;
    advancing: number;
    declining: number;
    unchanged: number;
    avgDeltaPct: number;
    atHighCount: number;
  };
  movers: {
    topGainers: BolsaQuote[];
    topLosers: BolsaQuote[];
    nearAth: BolsaQuote[];
  };
  tradeHint: {
    channel: string;
    buy: string;
    sell: string;
    portfolio: string;
  };
};

export type BolsaHistoryPoint = {
  price: number;
  previousPrice: number;
  highPrice: number;
  createdAt: number;
};

export type BolsaHistory = {
  ok: boolean;
  companyId: string;
  name: string;
  emoji: string;
  range: string;
  from: number;
  to: number;
  points: BolsaHistoryPoint[];
  stats: {
    high: number;
    low: number;
    open: number;
    close: number;
    changePct: number;
    samples: number;
  };
  quote: {
    price: number;
    previousPrice: number;
    highPrice: number;
    atHigh: boolean;
    trend: string;
    deltaPct: number;
    dividendYield: number;
  } | null;
  readOnly?: boolean;
};

export type BolsaEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  impactPct: number;
  companyId: string;
  archetype: string;
  createdAt: number;
};

export type BolsaRange = "1d" | "7d" | "30d" | "90d" | "all";


export type HouseItem = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  rotation: number;
  rotated: boolean;
  placed: boolean;
  stolen: boolean;
};

export type HouseShopItem = {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  kind: "furniture" | "wallpaper" | "floor" | "window";
  category: string;
  description: string;
  owned: boolean;
  applied: boolean;
  width?: number;
  depth?: number;
  isSurface?: boolean;
};

export type NeighborhoodHouse = {
  id: string;
  nickname: string;
  cleanliness: number;
  securityLevel: number;
};

export const AVATAR_SLOTS = [
  "body", "skinTone", "face", "hair", "top", "bottom", "shoes",
  "headAccessory", "faceAccessory", "neckAccessory", "backAccessory", "waistAccessory",
] as const;

export type AvatarSlot = (typeof AVATAR_SLOTS)[number];
export type AvatarSlots = Record<AvatarSlot, string>;

export type PublicAvatar = {
  schemaVersion?: number;
  revision?: number;
  catalogRevision?: number;
  slots: AvatarSlots;
  legacySlots?: Record<string, string>;
  level: number;
};

export type AvatarCatalogItem = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  slot: AvatarSlot;
  rendererKey: string;
  socket: string;
  preview: string;
  sourceProductId: string;
  unlockLevel: number;
  cost: number;
  category: "free" | "level" | "premium";
  owned: boolean;
};

export type AvatarPurchaseQuote = {
  catalogRevision: number;
  itemIds: string[];
  total: number;
};

export type HouseView = {
  owns: boolean;
  house: { cleanliness: number; securityLevel: number; houseType: string; wallStyle: string; floorStyle: string; windowStyle: string };
  items: HouseItem[];
  avatar: PublicAvatar;
  cleanliness?: number;
  security?: number;
  coins?: number;
  host?: { nickname: string };
  mural: Array<{ id?: string; note: string; createdAt: number; nickname?: string }>;
};

export type HousePlayer = {
  id: string;
  nickname: string;
  avatar: PublicAvatar;
  x: number;
  y: number;
  moving?: boolean;
  online?: boolean;
};

export type SoundSystemTrack = {
  id: string;
  provider: "youtube";
  videoId: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  requestedBy: string;
  durationSeconds: number;
  addedAt: number;
  startedAt: number;
};

export type SoundSystemState = {
  ok: true;
  serverNow: number;
  revision: number;
  current: SoundSystemTrack | null;
  queue: SoundSystemTrack[];
  searchEnabled: boolean;
};

export type YouTubeSearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  url: string;
};

export type AvatarState = Omit<PublicAvatar, "schemaVersion" | "revision" | "catalogRevision"> & {
  schemaVersion: number;
  revision: number;
  catalogRevision: number;
  unlocked: string[];
  coins: number;
  catalog: AvatarCatalogItem[];
  diagnostics?: Array<{ code: string; slot?: string; itemId?: string }>;
};

export type AvatarApplyResult = {
  ok: true;
  state: AvatarState;
  coins: number;
  purchased: string[];
  replayed?: boolean;
};

export type AvatarApplyError = Error & {
  code?: string;
  quote?: AvatarPurchaseQuote;
  current?: AvatarState;
  coins?: number;
  need?: number;
};
