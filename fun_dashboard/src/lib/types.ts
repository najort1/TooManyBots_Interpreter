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
  /** Eventos aleatórios do mundo (mercado auto + trégua). Happy hour segue anunciando. Default true. */
  worldEventsEnabled?: boolean;
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
