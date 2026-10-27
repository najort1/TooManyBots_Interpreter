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
  economy?: {
    circulatingCoins: number;
    baselineCoins: number;
    healthStatus: "stable" | "inflationary" | "deflationary" | "high_inequality";
    healthLabel: string;
    gini: number;
    totalMembers?: number;
    economicPlayers?: number;
    passiveMembers?: number;
    participationRate?: number;
  };
  activity?: {
    activePlayers24h: number;
    totalTransactions24h?: number;
  };
  botStatus?: {
    uptimeSeconds: number;
    socketReady: boolean;
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
  llmFeatures?: Record<string, boolean>;
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
  /** QMP (Quem é Mais Provável) — habilitado globalmente. */
  qmpEnabled?: boolean;
  /** Chance por mensagem normal do grupo de disparar pergunta automática (0–1, default 0.02). */
  qmpAutoTriggerChance?: number;
  /** Cooldown entre autos por grupo (ms, default 30min). */
  qmpAutoTriggerCooldownMs?: number;
  /** Duração da rodada de votação (ms, default 10min). */
  qmpRoundDurationMs?: number;
  /** Cooldown por usuário entre criar perguntas manuais (ms, default 45s). */
  qmpCooldownMs?: number;
  qmpHeavyEnabled?: boolean;
  qmpHeavyEvery?: number;
};

export type LlmFeatureItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  fallback: string;
  enabled: boolean;
  active: boolean;
  /** Modelo fixado manualmente para esta função; vazio/undefined = herda o padrão global. */
  modelOverride?: string;
  /** Modelo que será efetivamente usado na chamada (override ou padrão global). */
  effectiveModel?: string;
  /** Modelo padrão global usado quando não há override. */
  defaultModel?: string;
};

export type LlmSuggestedModel = {
  id: string;
  name: string;
  providerId?: string;
  providerName?: string;
  source?: string;
};

export type LlmConfigResponse = {
  ok: boolean;
  zenEnabled: boolean;
  zenBaseUrl: string;
  zenModel: string;
  activeProvider?: string;
  llmFeatures: Record<string, boolean>;
  llmModels?: Record<string, string>;
  items: LlmFeatureItem[];
  suggestedModels?: LlmSuggestedModel[];
  masterEnabled: boolean;
  persisted?: boolean;
  appliedImmediately?: boolean;
};

export type LlmConfigUpdatePayload = {
  zenEnabled?: boolean;
  zenModel?: string;
  llmFeatures?: Record<string, boolean>;
  llmModels?: Record<string, string>;
};

export type LlmDailyMetric = {
  date: string;
  calls: number;
  success: number;
  errors: number;
  fallbacks: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
};

export type LlmTaskMetric = {
  task: string;
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDurationMs: number;
  errors: number;
  percentage: number;
};

export type LlmDistributionMetric = {
  provider?: string;
  model?: string;
  calls: number;
  totalTokens: number;
  avgDurationMs: number;
  percentage: number;
};

export type LlmHourMetric = {
  hour: number;
  calls: number;
  avgDurationMs: number;
};

export type LlmGroupMetric = {
  scopeKey: string;
  groupName: string;
  calls: number;
  totalTokens: number;
  avgDurationMs: number;
};

export type LlmUserMetric = {
  userJid: string;
  userName: string;
  calls: number;
  totalTokens: number;
};

export type LlmCallLog = {
  id: number;
  createdAt: number;
  scopeKey: string;
  groupName?: string;
  userJid: string;
  userName?: string;
  task: string;
  provider: string;
  model: string;
  status: "success" | "error" | "timeout" | "fallback" | string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  promptPreview: string;
  responsePreview: string;
  errorMessage: string | null;
  costEstimated: number;
};

export type LlmAnalyticsSummary = {
  totalCalls: number;
  successfulCalls: number;
  errorCalls: number;
  fallbackCalls: number;
  successRate: number;
  fallbackRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgTokensPerCall: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalDurationMs: number;
  estimatedCostUsd: number;
  activeProvider: string;
  activeModel: string;
  masterEnabled: boolean;
};

export type LlmAnalyticsResponse = {
  ok: boolean;
  period: {
    days: number;
    fromTimestamp: number;
    toTimestamp: number;
  };
  summary: LlmAnalyticsSummary;
  daily: LlmDailyMetric[];
  byTask: LlmTaskMetric[];
  byProvider: LlmDistributionMetric[];
  byModel: LlmDistributionMetric[];
  byHour: LlmHourMetric[];
  byGroup: LlmGroupMetric[];
  topUsers: LlmUserMetric[];
  recentCalls: LlmCallLog[];
  realtime?: {
    counts: Record<string, number>;
    lastByTask: Record<string, unknown>;
    recent: Array<Record<string, unknown>>;
  };
  zenHealth?: {
    ok: boolean;
    baseUrl: string;
    model: string;
  };
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
  /** Lista de IDs de comandos desabilitados para este grupo. */
  disabledCommands?: string[];
  /** Flag de liberação de comandos NSFW (via /force_nsfw ou dashboard). */
  permitirNsfw?: boolean;
};

export type CommandCategory = {
  id: string;
  name: string;
  emoji: string;
  description: string;
};

export type CommandItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  isNsfw: boolean;
  examples: string[];
};

export type CommandCatalogResponse = {
  categories: CommandCategory[];
  commands: CommandItem[];
  defaultDisabled: string[];
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

export type CarState = {
  scopeKey?: string;
  userJid?: string;
  color: string;
  secondaryColor: string;
  finish?: string;
  bodykit?: string;
  headlight?: string;
  interior?: string;
  rollCage?: string;
  camber?: string;
  caliperColor?: string;
  wheelColor?: string;
  exhaust?: string;
  wheels: string;
  spoiler: string;
  suspension: string;
  neon: string;
  decal: string;
  windowTint: string;
  plateText: string;
  customizations?: Record<string, unknown>;
  revision?: number;
  updatedAt?: number;
};

export type CarCatalogItem = {
  id: string;
  name: string;
  cost: number;
  hex?: string | null;
  heightOffset?: number;
  opacity?: number;
  hpBonus?: number;
  downforce?: number;
  angle?: number;
};

export type CarCatalog = {
  colors: CarCatalogItem[];
  secondaryColors: CarCatalogItem[];
  finishes: CarCatalogItem[];
  bodykits: CarCatalogItem[];
  headlights: CarCatalogItem[];
  interiors: CarCatalogItem[];
  rollCages: CarCatalogItem[];
  cambers: CarCatalogItem[];
  caliperColors?: CarCatalogItem[];
  wheelColors?: CarCatalogItem[];
  exhaustStyles?: CarCatalogItem[];
  wheels: CarCatalogItem[];
  spoilers: CarCatalogItem[];
  suspensions: CarCatalogItem[];
  neon: CarCatalogItem[];
  decals: CarCatalogItem[];
  windowTints: CarCatalogItem[];
};

export type DynoPoint = {
  rpm: number;
  torque: number;
  hp: number;
};

export type CarView = {
  ok: boolean;
  owns: boolean;
  ownsCar: boolean;
  state: CarState;
  catalog: CarCatalog;
  coins: number;
  level: number;
  owner: {
    nickname: string;
  };
};

export type PanelinhaGameType = "quiz_royale" | "grid_ctf" | "king_of_the_hill";

export type SpawnGamePayload = {
  scope: string;
  gameType: PanelinhaGameType;
  prize?: number;
  startInMinutes?: number;
  announce?: boolean;
  force?: boolean;
};

export type SpawnGameResult = {
  ok: boolean;
  room?: {
    id: string;
    scopeKey: string;
    gameType: PanelinhaGameType;
    title: string;
    emoji: string;
    description: string;
    minPlayers: number;
    maxPlayers: number;
    prize: number;
    status: string;
    startsAt: number;
  };
  gameLink?: string;
  announcementText?: string;
  reason?: string;
  error?: string;
  message?: string;
};

export type ActiveGameResult = {
  ok: boolean;
  active: boolean;
  room: {
    id: string;
    scopeKey: string;
    gameType: PanelinhaGameType;
    title: string;
    emoji: string;
    description: string;
    minPlayers: number;
    maxPlayers: number;
    prize: number;
    status: string;
    startsAt: number;
    playersCount?: number;
  } | null;
  gameLink?: string | null;
};

export type CarApplyResult = {
  ok: boolean;
  state: CarState;
  coins: number;
  debited: number;
  purchased: Array<{ category: string; id: string; name: string; cost: number }>;
  replayed?: boolean;
};


export type AvatarApplyError = Error & {
  code?: string;
  quote?: AvatarPurchaseQuote;
  current?: AvatarState;
  coins?: number;
  need?: number;
};

// ==========================================
// Tipos de Gestão de Economia & Inflação
// ==========================================

export type EconomyRegulatorKnobs = {
  volMult: number;
  eventImpactMult: number;
  eventFreqMult: number;
  rewardMult: number;
  restockMult: number;
  flowScale: number;
  baseNoisePct: number;
  deceptionRate: number;
  shockDecay: number;
  volumeDecay: number;
  lastRegulateAt: number;
  narrativeSeeds: string[];
};

export type WealthBracket = {
  bracket: string;
  players: number;
  totalCoins: number;
  percentage: number;
};

export type WealthDistribution = {
  top1Percent: number;
  top10Percent: number;
  bottom50Percent: number;
  brackets: WealthBracket[];
};

export type EconomyMetrics = {
  ok: boolean;
  scope: string;
  groupName?: string;
  circulatingCoins: number;
  baselineCoins: number;
  gini: number;
  activePlayers: number;
  totalMembers?: number;
  economicPlayers?: number;
  passiveMembers?: number;
  participationRate?: number;
  investedValue: number;
  avgAbsDeltaPct: number;
  eventsLast24h: number;
  inflationState: "stable" | "inflationary" | "deflationary" | "high_inequality" | "hyperinflation";
  inflationLabel: string;
  mintSink24h: {
    minted: number;
    sunk: number;
    net: number;
  };
  jackpot: number;
  factionsCount: number;
  factionsVaultTotal: number;
  regulator: EconomyRegulatorKnobs;
  wealthDistribution: WealthDistribution;
};

export type EconomyInterventionPayload = {
  scope: string;
  action: "inject_jackpot" | "burn_jackpot" | "set_baseline" | "trigger_seed" | "adjust_knobs";
  amount?: number;
  seed?: string;
  knobs?: Partial<Record<string, number>>;
};

export type EconomyInterventionResult = {
  ok: boolean;
  action: string;
  message: string;
  previousValue?: unknown;
  newValue?: unknown;
};

// ==========================================
// Tipos de Logs Operacionais em Tempo Real
// ==========================================

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogDomain = "economy" | "casino" | "games" | "whatsapp" | "system" | "llm" | "social";

export type SystemLogEntry = {
  id: string;
  timestamp: number;
  level: LogLevel;
  domain: LogDomain;
  message: string;
  scope?: string;
  details?: Record<string, unknown>;
};

export type LogsResponse = {
  ok: boolean;
  logs: SystemLogEntry[];
  total: number;
  bufferCapacity: number;
  dropped: number;
  lastTimestamp: number;
};

