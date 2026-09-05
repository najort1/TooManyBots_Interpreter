export const FUN_SCHEMA_VERSION = '34';

export const PERSONA_MEMORY_TYPES = Object.freeze(['thread', 'episodic', 'semantic', 'social']);
export const PERSONA_MEMORY_EVIDENCE = Object.freeze(['explicit', 'corroborated', 'inferred']);
export const PERSONA_MEMORY_SENSITIVITY = Object.freeze(['safe', 'private', 'sensitive']);
export const PERSONA_MEMORY_DEFAULTS = Object.freeze({
  maxContextItems: 8,
  threadTtlMs: 30 * 60_000,
  semanticTtlMs: 90 * 24 * 60 * 60_000,
  episodicTtlMs: 7 * 24 * 60 * 60_000,
  inferredConfidence: 0.35,
});

export const FUN_COMMANDS = Object.freeze({
  XP: 'xp',
  PERFIL: 'perfil',
  RANK: 'rank',
  RANK_COINS: 'rankcoins',
  RANK_MESSAGES: 'rankmessages',
  DAILY: 'daily',
  HELP: 'help',
  PAY: 'pay',
  COINS: 'coins',
  MARRY: 'marry',
  DIVORCE: 'divorce',
  SHIP: 'ship',
  ACCEPT: 'accept',
  DECLINE: 'decline',
  FLIP: 'flip',
  /** Freela — /trabalhar */
  JOB: 'job',
  /** Profissão CLT — /emprego */
  EMPLOYMENT: 'employment',
  RESIGN: 'resign',
  LUCKY: 'lucky',
  BET: 'bet',
  SHOP: 'shop',
  BUY: 'buy',
  TITLE: 'title',
  FACTION: 'faction',
  PANELINHA: 'panelinha',
  PANELINHA_GUIDE: 'panelinha_guide',
  PONTE: 'ponte',
  MISSION: 'mission',
  SQUAD: 'squad',
  EVENT: 'event',
  // Cassino
  ROULETTE: 'roulette',
  SLOT: 'slot',
  JACKPOT: 'jackpot',
  DICE_DUEL: 'dice_duel',
  CRASH: 'crash',
  CASHOUT: 'cashout',
  BLACKJACK: 'blackjack',
  HIT: 'hit',
  STAND: 'stand',
  TOURNAMENT: 'tournament',
  RANK_CASINO: 'rankcasino',
  BINGO: 'bingo',
  TAROT: 'tarot',
  // Cartas colecionáveis
  CARTAS: 'cartas',
  // Quem é Mais Provável?
  QMP: 'qmp',
  // Chaos / zoeira social
  RUSSIAN: 'russian',
  PULL: 'pull',
  CANCEL: 'cancel',
  GOSSIP: 'gossip',
  ORACLE: 'oracle',
  ILLUMINATI: 'illuminati',
  LORE: 'lore',
  FORGET_LORE: 'forget_lore',
  ROAST: 'roast',
  // Colecionáveis / mercado
  GALLERY: 'gallery',
  INVENTORY: 'inventory',
  BAZAAR: 'bazaar',
  SELL_ITEM: 'sell_item',
  BUY_COLLECTIBLE: 'buy_collectible',
  REPAIR_ITEM: 'repair_item',
  MARKET_EVENT: 'market_event',
  WEAPONS: 'weapons',
  ASSAULT: 'assault',
  // Negócios / propriedades
  PROPERTY: 'property',
  COLLECT: 'collect',
  HOUSE: 'house',
  AVATAR: 'avatar',
  // Conquistas
  ACHIEVEMENTS: 'achievements',
  // Bolsa de valores (ações das empresas)
  BOLSA: 'bolsa',
  CARTEIRA: 'carteira',
  // DM / escopo
  GROUP_SCOPE: 'group_scope',
  // Mídia
  STICKER: 'sticker',
  REACTION: 'reaction',
  // NSFW
  NSFW_ENABLE: 'nsfw_enable',
  NSFW_REJECT: 'nsfw_reject',
  NSFW_FORCE: 'nsfw_force',
  // Desafio Diário
  RESPONDER: 'responder',
  DICA: 'dica',
  TROCAR_DESAFIO: 'trocar_desafio',
  DESAFIO: 'desafio',
  // Geração de imagens (proxy /v1/images/generations)
  GERAR: 'gerar',
  IMAGINAR: 'imaginar',
  // Despedidas — /despedir (poema) + /despedida rank (ranking)
  DESPEDIR: 'despedir',
  DESPEDIDA_RANK: 'despedida_rank',
  // Rolês reais detectados nas conversas do grupo
  ROLES: 'roles',
  REMOVE_ROLE: 'remove_role',
  // Administração de Grupo (Baileys)
  GROUP_BAN: 'group_ban',
  GROUP_PROMOTE: 'group_promote',
  GROUP_DEMOTE: 'group_demote',
  GROUP_ADD: 'group_add',
  GROUP_CLOSE: 'group_close',
  GROUP_OPEN: 'group_open',
  GROUP_LOCK: 'group_lock',
  GROUP_UNLOCK: 'group_unlock',
});

/**
 * Com `replyCommandsInPrivate=true`, estes comandos continuam no grupo
 * (duelo/aposta, panelinhas e interações sociais que precisam de visibilidade).
 */
export const FUN_PUBLIC_GROUP_COMMANDS = Object.freeze(
  new Set([
    FUN_COMMANDS.BET,
    FUN_COMMANDS.ACCEPT,
    FUN_COMMANDS.DECLINE,
    FUN_COMMANDS.FACTION,
    FUN_COMMANDS.PANELINHA,
    FUN_COMMANDS.PONTE,
    FUN_COMMANDS.MISSION,
    FUN_COMMANDS.SQUAD,
    FUN_COMMANDS.EVENT,
    // social: o outro jogador precisa ver no grupo
    FUN_COMMANDS.MARRY,
    FUN_COMMANDS.DIVORCE,
    FUN_COMMANDS.SHIP,
    FUN_COMMANDS.PAY,
    // cassino social / mesa
    FUN_COMMANDS.DICE_DUEL,
    FUN_COMMANDS.TOURNAMENT,
    FUN_COMMANDS.JACKPOT,
    FUN_COMMANDS.BINGO,
    // tarô de grupo: a leitura é o entretenimento público
    FUN_COMMANDS.TAROT,
    // zoeira social (público no grupo)
    FUN_COMMANDS.RUSSIAN,
    FUN_COMMANDS.PULL,
    FUN_COMMANDS.CANCEL,
    FUN_COMMANDS.GOSSIP,
    FUN_COMMANDS.ORACLE,
    FUN_COMMANDS.ILLUMINATI,
    FUN_COMMANDS.LORE,
    FUN_COMMANDS.FORGET_LORE,
    // assalto/armas: precisa de visibilidade no grupo
    FUN_COMMANDS.ASSAULT,
    FUN_COMMANDS.WEAPONS,
    FUN_COMMANDS.BAZAAR,
    FUN_COMMANDS.CARTAS,
    FUN_COMMANDS.ROAST,
    FUN_COMMANDS.ACHIEVEMENTS,
    // QMP: votação social no grupo
    FUN_COMMANDS.QMP,
    // emprego: anúncio curto no grupo no start
    FUN_COMMANDS.EMPLOYMENT,
    FUN_COMMANDS.REACTION,
    // Desafio diário: precisa visibilidade no grupo
    FUN_COMMANDS.RESPONDER,
    FUN_COMMANDS.DICA,
    FUN_COMMANDS.TROCAR_DESAFIO,
    FUN_COMMANDS.DESAFIO,
    // geração de imagem: resposta precisa voltar no grupo
    FUN_COMMANDS.GERAR,
    FUN_COMMANDS.IMAGINAR,
    FUN_COMMANDS.ROLES,
    FUN_COMMANDS.REMOVE_ROLE,
  ])
);

export const FUN_COMMAND_ALIASES = Object.freeze({
  xp: FUN_COMMANDS.XP,
  perfil: FUN_COMMANDS.PERFIL,
  profile: FUN_COMMANDS.PERFIL,
  rank: FUN_COMMANDS.RANK,
  top: FUN_COMMANDS.RANK,
  leaderboard: FUN_COMMANDS.RANK,
  rankcoins: FUN_COMMANDS.RANK_COINS,
  topcoins: FUN_COMMANDS.RANK_COINS,
  coinrank: FUN_COMMANDS.RANK_COINS,
  moedasrank: FUN_COMMANDS.RANK_COINS,
  rankmoedas: FUN_COMMANDS.RANK_COINS,
  rankmessages: FUN_COMMANDS.RANK_MESSAGES,
  rankmsg: FUN_COMMANDS.RANK_MESSAGES,
  topmsg: FUN_COMMANDS.RANK_MESSAGES,
  topmensagens: FUN_COMMANDS.RANK_MESSAGES,
  mensagens: FUN_COMMANDS.RANK_MESSAGES,
  topchat: FUN_COMMANDS.RANK_MESSAGES,
  maisativos: FUN_COMMANDS.RANK_MESSAGES,
  daily: FUN_COMMANDS.DAILY,
  diario: FUN_COMMANDS.DAILY,
  help: FUN_COMMANDS.HELP,
  ajuda: FUN_COMMANDS.HELP,
  pay: FUN_COMMANDS.PAY,
  pagar: FUN_COMMANDS.PAY,
  coins: FUN_COMMANDS.COINS,
  moedas: FUN_COMMANDS.COINS,
  saldo: FUN_COMMANDS.COINS,
  marry: FUN_COMMANDS.MARRY,
  casar: FUN_COMMANDS.MARRY,
  divorce: FUN_COMMANDS.DIVORCE,
  divorciar: FUN_COMMANDS.DIVORCE,
  ship: FUN_COMMANDS.SHIP,
  aceitar: FUN_COMMANDS.ACCEPT,
  accept: FUN_COMMANDS.ACCEPT,
  sim: FUN_COMMANDS.ACCEPT,
  yes: FUN_COMMANDS.ACCEPT,
  recusar: FUN_COMMANDS.DECLINE,
  recusa: FUN_COMMANDS.DECLINE,
  decline: FUN_COMMANDS.DECLINE,
  nao: FUN_COMMANDS.DECLINE,
  não: FUN_COMMANDS.DECLINE,
  no: FUN_COMMANDS.DECLINE,
  cf: FUN_COMMANDS.FLIP,
  flip: FUN_COMMANDS.FLIP,
  caracoroa: FUN_COMMANDS.FLIP,
  coinflip: FUN_COMMANDS.FLIP,
  job: FUN_COMMANDS.JOB,
  trabalhar: FUN_COMMANDS.JOB,
  work: FUN_COMMANDS.JOB,
  emprego: FUN_COMMANDS.EMPLOYMENT,
  empregos: FUN_COMMANDS.EMPLOYMENT,
  profissao: FUN_COMMANDS.EMPLOYMENT,
  profissão: FUN_COMMANDS.EMPLOYMENT,
  carreira: FUN_COMMANDS.EMPLOYMENT,
  demitir: FUN_COMMANDS.RESIGN,
  demissao: FUN_COMMANDS.RESIGN,
  demissão: FUN_COMMANDS.RESIGN,
  resign: FUN_COMMANDS.RESIGN,
  sorte: FUN_COMMANDS.LUCKY,
  lucky: FUN_COMMANDS.LUCKY,
  roleta: FUN_COMMANDS.ROULETTE,
  roulette: FUN_COMMANDS.ROULETTE,
  roletae: FUN_COMMANDS.ROULETTE,
  slot: FUN_COMMANDS.SLOT,
  slots: FUN_COMMANDS.SLOT,
  caça: FUN_COMMANDS.SLOT,
  caca: FUN_COMMANDS.SLOT,
  jackpot: FUN_COMMANDS.JACKPOT,
  pot: FUN_COMMANDS.JACKPOT,
  dados: FUN_COMMANDS.DICE_DUEL,
  d20: FUN_COMMANDS.DICE_DUEL,
  dice: FUN_COMMANDS.DICE_DUEL,
  duelodados: FUN_COMMANDS.DICE_DUEL,
  duelo: FUN_COMMANDS.DICE_DUEL,
  crash: FUN_COMMANDS.CRASH,
  foguete: FUN_COMMANDS.CRASH,
  sair: FUN_COMMANDS.CASHOUT,
  cashout: FUN_COMMANDS.CASHOUT,
  descer: FUN_COMMANDS.CASHOUT,
  bj: FUN_COMMANDS.BLACKJACK,
  blackjack: FUN_COMMANDS.BLACKJACK,
  21: FUN_COMMANDS.BLACKJACK,
  hit: FUN_COMMANDS.HIT,
  stand: FUN_COMMANDS.STAND,
  parar: FUN_COMMANDS.STAND,
  torneio: FUN_COMMANDS.TOURNAMENT,
  tournament: FUN_COMMANDS.TOURNAMENT,
  torneiocassino: FUN_COMMANDS.TOURNAMENT,
  bingo: FUN_COMMANDS.BINGO,
  minbingo: FUN_COMMANDS.BINGO,
  tarot: FUN_COMMANDS.TAROT,
  taro: FUN_COMMANDS.TAROT,
  tarô: FUN_COMMANDS.TAROT,
  vidente: FUN_COMMANDS.TAROT,
  // cartas colecionáveis (não é tarô)
  cartas: FUN_COMMANDS.CARTAS,
  carta: FUN_COMMANDS.CARTAS,
  cards: FUN_COMMANDS.CARTAS,
  // Quem é Mais Provável?
  qmp: FUN_COMMANDS.QMP,
  quememaisprovavel: FUN_COMMANDS.QMP,
  maisprovavel: FUN_COMMANDS.QMP,
  mostlikely: FUN_COMMANDS.QMP,
  // oráculo maluco (não é tarô)
  oraculo: FUN_COMMANDS.ORACLE,
  oráculo: FUN_COMMANDS.ORACLE,
  oraculomaldito: FUN_COMMANDS.ORACLE,
  oraculomaluco: FUN_COMMANDS.ORACLE,
  perguntamaluca: FUN_COMMANDS.ORACLE,
  roletarussa: FUN_COMMANDS.RUSSIAN,
  roleta_russa: FUN_COMMANDS.RUSSIAN,
  russianroulette: FUN_COMMANDS.RUSSIAN,
  rr: FUN_COMMANDS.RUSSIAN,
  puxar: FUN_COMMANDS.PULL,
  gatilho: FUN_COMMANDS.PULL,
  pull: FUN_COMMANDS.PULL,
  cancelar: FUN_COMMANDS.CANCEL,
  cancelamento: FUN_COMMANDS.CANCEL,
  cancel: FUN_COMMANDS.CANCEL,
  fofoca: FUN_COMMANDS.GOSSIP,
  rumor: FUN_COMMANDS.GOSSIP,
  gossip: FUN_COMMANDS.GOSSIP,
  illuminati: FUN_COMMANDS.ILLUMINATI,
  iluminati: FUN_COMMANDS.ILLUMINATI,
  conspiracao: FUN_COMMANDS.ILLUMINATI,
  conspiração: FUN_COMMANDS.ILLUMINATI,
  teoria: FUN_COMMANDS.ILLUMINATI,
  lore: FUN_COMMANDS.LORE,
  memorias: FUN_COMMANDS.LORE,
  memórias: FUN_COMMANDS.LORE,
  memoria: FUN_COMMANDS.LORE,
  memória: FUN_COMMANDS.LORE,
  esquecelore: FUN_COMMANDS.FORGET_LORE,
  esquecerlore: FUN_COMMANDS.FORGET_LORE,
  limparlore: FUN_COMMANDS.FORGET_LORE,
  forgetlore: FUN_COMMANDS.FORGET_LORE,
  roast: FUN_COMMANDS.ROAST,
  zoar: FUN_COMMANDS.ROAST,
  humilhar: FUN_COMMANDS.ROAST,
  rankcassino: FUN_COMMANDS.RANK_CASINO,
  rankcasino: FUN_COMMANDS.RANK_CASINO,
  topcassino: FUN_COMMANDS.RANK_CASINO,
  grupo: FUN_COMMANDS.GROUP_SCOPE,
  group: FUN_COMMANDS.GROUP_SCOPE,
  grupos: FUN_COMMANDS.GROUP_SCOPE,
  meugrupo: FUN_COMMANDS.GROUP_SCOPE,
  fig: FUN_COMMANDS.STICKER,
  figurinha: FUN_COMMANDS.STICKER,
  sticker: FUN_COMMANDS.STICKER,
  s: FUN_COMMANDS.STICKER,
  kiss: FUN_COMMANDS.REACTION,
  beijo: FUN_COMMANDS.REACTION,
  beijar: FUN_COMMANDS.REACTION,
  hug: FUN_COMMANDS.REACTION,
  abraco: FUN_COMMANDS.REACTION,
  abraço: FUN_COMMANDS.REACTION,
  pat: FUN_COMMANDS.REACTION,
  carinho: FUN_COMMANDS.REACTION,
  slap: FUN_COMMANDS.REACTION,
  tapa: FUN_COMMANDS.REACTION,
  cuddle: FUN_COMMANDS.REACTION,
  cafune: FUN_COMMANDS.REACTION,
  cafuné: FUN_COMMANDS.REACTION,
  bite: FUN_COMMANDS.REACTION,
  morder: FUN_COMMANDS.REACTION,
  lick: FUN_COMMANDS.REACTION,
  lamber: FUN_COMMANDS.REACTION,
  poke: FUN_COMMANDS.REACTION,
  cutucar: FUN_COMMANDS.REACTION,
  handhold: FUN_COMMANDS.REACTION,
  maosdadas: FUN_COMMANDS.REACTION,
  maos: FUN_COMMANDS.REACTION,
  highfive: FUN_COMMANDS.REACTION,
  tocaqui: FUN_COMMANDS.REACTION,
  wave: FUN_COMMANDS.REACTION,
  acenar: FUN_COMMANDS.REACTION,
  nom: FUN_COMMANDS.REACTION,
  comer: FUN_COMMANDS.REACTION,
  happy: FUN_COMMANDS.REACTION,
  feliz: FUN_COMMANDS.REACTION,
  cry: FUN_COMMANDS.REACTION,
  chorar: FUN_COMMANDS.REACTION,
  laugh: FUN_COMMANDS.REACTION,
  rir: FUN_COMMANDS.REACTION,
  bruh: FUN_COMMANDS.REACTION,
  sus: FUN_COMMANDS.REACTION,
  // NSFW
  anal: FUN_COMMANDS.REACTION,
  blowjob: FUN_COMMANDS.REACTION,
  boquete: FUN_COMMANDS.REACTION,
  cum: FUN_COMMANDS.REACTION,
  gozo: FUN_COMMANDS.REACTION,
  fuck: FUN_COMMANDS.REACTION,
  transar: FUN_COMMANDS.REACTION,
  neko: FUN_COMMANDS.REACTION,
  pussylick: FUN_COMMANDS.REACTION,
  solo: FUN_COMMANDS.REACTION,
  solo_male: FUN_COMMANDS.REACTION,
  yaoi: FUN_COMMANDS.REACTION,
  yuri: FUN_COMMANDS.REACTION,
  aposta: FUN_COMMANDS.BET,
  bet: FUN_COMMANDS.BET,
  apostar: FUN_COMMANDS.BET,
  loja: FUN_COMMANDS.SHOP,
  shop: FUN_COMMANDS.SHOP,
  store: FUN_COMMANDS.SHOP,
  comprar: FUN_COMMANDS.BUY,
  buy: FUN_COMMANDS.BUY,
  galeria: FUN_COMMANDS.GALLERY,
  gallery: FUN_COMMANDS.GALLERY,
  mercado: FUN_COMMANDS.GALLERY,
  rua: FUN_COMMANDS.GALLERY,
  utilitarios: FUN_COMMANDS.GALLERY,
  inventario: FUN_COMMANDS.INVENTORY,
  inventory: FUN_COMMANDS.INVENTORY,
  itens: FUN_COMMANDS.INVENTORY,
  bag: FUN_COMMANDS.INVENTORY,
  bazar: FUN_COMMANDS.BAZAAR,
  feira: FUN_COMMANDS.BAZAAR,
  playerstore: FUN_COMMANDS.BAZAAR,
  vender: FUN_COMMANDS.SELL_ITEM,
  sell: FUN_COMMANDS.SELL_ITEM,
  adquirir: FUN_COMMANDS.BUY_COLLECTIBLE,
  comprararte: FUN_COMMANDS.BUY_COLLECTIBLE,
  consertar: FUN_COMMANDS.REPAIR_ITEM,
  reparar: FUN_COMMANDS.REPAIR_ITEM,
  repair: FUN_COMMANDS.REPAIR_ITEM,
  mercadoevento: FUN_COMMANDS.MARKET_EVENT,
  artevento: FUN_COMMANDS.MARKET_EVENT,
  armas: FUN_COMMANDS.WEAPONS,
  weapons: FUN_COMMANDS.WEAPONS,
  propriedades: FUN_COMMANDS.PROPERTY,
  propriedade: FUN_COMMANDS.PROPERTY,
  negocio: FUN_COMMANDS.PROPERTY,
  negócios: FUN_COMMANDS.PROPERTY,
  negocios: FUN_COMMANDS.PROPERTY,
  property: FUN_COMMANDS.PROPERTY,
  coletar: FUN_COMMANDS.COLLECT,
  collect: FUN_COMMANDS.COLLECT,
  sacar: FUN_COMMANDS.COLLECT,
  casa: FUN_COMMANDS.HOUSE,
  casas: FUN_COMMANDS.HOUSE,
  house: FUN_COMMANDS.HOUSE,
  avatar: FUN_COMMANDS.AVATAR,
  boneco: FUN_COMMANDS.AVATAR,
  conquistas: FUN_COMMANDS.ACHIEVEMENTS,
  conquista: FUN_COMMANDS.ACHIEVEMENTS,
  achievements: FUN_COMMANDS.ACHIEVEMENTS,
  badges: FUN_COMMANDS.ACHIEVEMENTS,
  armamento: FUN_COMMANDS.WEAPONS,
  assaltar: FUN_COMMANDS.ASSAULT,
  assalto: FUN_COMMANDS.ASSAULT,
  roubar: FUN_COMMANDS.ASSAULT,
  assault: FUN_COMMANDS.ASSAULT,
  crime: FUN_COMMANDS.ASSAULT,
  bolsa: FUN_COMMANDS.BOLSA,
  acoes: FUN_COMMANDS.BOLSA,
  acao: FUN_COMMANDS.BOLSA,
  corretora: FUN_COMMANDS.BOLSA,
  stocks: FUN_COMMANDS.BOLSA,
  carteira: FUN_COMMANDS.CARTEIRA,
  portfolio: FUN_COMMANDS.CARTEIRA,
  portifolio: FUN_COMMANDS.CARTEIRA,
  titulo: FUN_COMMANDS.TITLE,
  title: FUN_COMMANDS.TITLE,
  // Panelinha (ex-facção): comando principal
  panelinha: FUN_COMMANDS.FACTION,
  // aliases legados
  faccao: FUN_COMMANDS.FACTION,
  facção: FUN_COMMANDS.FACTION,
  faction: FUN_COMMANDS.FACTION,
  // relatório CIA (mesmo handler; sem args = placar)
  // guia completo
  panelinhas: FUN_COMMANDS.PANELINHA_GUIDE,
  comopanelinha: FUN_COMMANDS.PANELINHA_GUIDE,
  guiapanelinha: FUN_COMMANDS.PANELINHA_GUIDE,
  guiafaccao: FUN_COMMANDS.PANELINHA_GUIDE,
  comofaccao: FUN_COMMANDS.PANELINHA_GUIDE,
  ponte: FUN_COMMANDS.PONTE,
  missao: FUN_COMMANDS.MISSION,
  missão: FUN_COMMANDS.MISSION,
  mission: FUN_COMMANDS.MISSION,
  squad: FUN_COMMANDS.SQUAD,
  evento: FUN_COMMANDS.EVENT,
  event: FUN_COMMANDS.EVENT,
  // NSFW
  nsfw_enable: FUN_COMMANDS.NSFW_ENABLE,
  nsfw: FUN_COMMANDS.NSFW_ENABLE,
  liberarnsfw: FUN_COMMANDS.NSFW_ENABLE,
  nsfw_r: FUN_COMMANDS.NSFW_REJECT,
  nsfw_reject: FUN_COMMANDS.NSFW_REJECT,
  rejeitarnsfw: FUN_COMMANDS.NSFW_REJECT,
  // Forçar NSFW (qualquer usuário)
  nsfw_force: FUN_COMMANDS.NSFW_FORCE,
  forcarnsfw: FUN_COMMANDS.NSFW_FORCE,
  forcar_nsfw: FUN_COMMANDS.NSFW_FORCE,
  forcansfw: FUN_COMMANDS.NSFW_FORCE,
  forcansf: FUN_COMMANDS.NSFW_FORCE,
  // Desafio Diário
  responder: FUN_COMMANDS.RESPONDER,
  responda: FUN_COMMANDS.RESPONDER,
  answer: FUN_COMMANDS.RESPONDER,
  response: FUN_COMMANDS.RESPONDER,
  dica: FUN_COMMANDS.DICA,
  hint: FUN_COMMANDS.DICA,
  'trocar desafio': FUN_COMMANDS.TROCAR_DESAFIO,
  trocardesafio: FUN_COMMANDS.TROCAR_DESAFIO,
  skip: FUN_COMMANDS.TROCAR_DESAFIO,
  pular: FUN_COMMANDS.TROCAR_DESAFIO,
  desafio: FUN_COMMANDS.DESAFIO,
  desafiostatus: FUN_COMMANDS.DESAFIO,
  desafioforcar: FUN_COMMANDS.DESAFIO,
  desafioexpirar: FUN_COMMANDS.DESAFIO,
  desafioreiniciar: FUN_COMMANDS.DESAFIO,
  // Geração de imagens
  gerar: FUN_COMMANDS.GERAR,
  gerarimagem: FUN_COMMANDS.GERAR,
  imagem: FUN_COMMANDS.GERAR,
  create: FUN_COMMANDS.GERAR,
  imaginar: FUN_COMMANDS.IMAGINAR,
  imagine: FUN_COMMANDS.IMAGINAR,
  desenhar: FUN_COMMANDS.IMAGINAR,
  render: FUN_COMMANDS.IMAGINAR,
  // Despedidas (sem cooldown; não conflitam com /demitir do emprego)
  despedir: FUN_COMMANDS.DESPEDIR,
  despedida: FUN_COMMANDS.DESPEDIDA_RANK,
  roles: FUN_COMMANDS.ROLES,
  rolesidentificados: FUN_COMMANDS.ROLES,
  removerrole: FUN_COMMANDS.REMOVE_ROLE,
  removerroles: FUN_COMMANDS.REMOVE_ROLE,
  adeus: FUN_COMMANDS.DESPEDIR,
  dispensar: FUN_COMMANDS.DESPEDIR,
  // Administração de Grupo
  ban: FUN_COMMANDS.GROUP_BAN,
  banir: FUN_COMMANDS.GROUP_BAN,
  kick: FUN_COMMANDS.GROUP_BAN,
  expulsar: FUN_COMMANDS.GROUP_BAN,
  remover: FUN_COMMANDS.GROUP_BAN,
  promover: FUN_COMMANDS.GROUP_PROMOTE,
  promote: FUN_COMMANDS.GROUP_PROMOTE,
  admin: FUN_COMMANDS.GROUP_PROMOTE,
  rebaixar: FUN_COMMANDS.GROUP_DEMOTE,
  demote: FUN_COMMANDS.GROUP_DEMOTE,
  add: FUN_COMMANDS.GROUP_ADD,
  adicionar: FUN_COMMANDS.GROUP_ADD,
  colocar: FUN_COMMANDS.GROUP_ADD,
  fechar: FUN_COMMANDS.GROUP_CLOSE,
  close: FUN_COMMANDS.GROUP_CLOSE,
  abrir: FUN_COMMANDS.GROUP_OPEN,
  open: FUN_COMMANDS.GROUP_OPEN,
  trancar: FUN_COMMANDS.GROUP_LOCK,
  lock: FUN_COMMANDS.GROUP_LOCK,
  destrancar: FUN_COMMANDS.GROUP_UNLOCK,
  unlock: FUN_COMMANDS.GROUP_UNLOCK,
});

export const ACTION_TYPE = Object.freeze({
  MARRY: 'marry',
  BET_COINFLIP: 'bet_coinflip',
  BET_DICE: 'bet_dice',
  CARD_TRADE: 'card_trade',
});

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PROPOSAL_TTL_MS = 5 * 60 * 1000;
export const BET_TTL_MS = 5 * 60 * 1000;
export const CRASH_TTL_MS = 45_000;
export const BLACKJACK_TTL_MS = 3 * 60_000;
export const TOURNAMENT_SIZE = 4;

/** Persona (Bot Membro Vivo) — constantes de guarda e janela (spec 001). */
// 0 = guarda desabilitada (chat sem limite): sem cooldown e sem teto de turnos.
export const PERSONA_COOLDOWN_MS = 0;
export const PERSONA_MAX_TURNS = 0;
export const PERSONA_THREAD_TTL_MS = 30 * 60_000;
export const PERSONA_WINDOW_SIZE = 100;
export const PERSONA_WINDOW_MS = 24 * 60 * 60 * 1000;
// O modelo decide tools e redige respostas; 15s expira antes de provedores lentos responderem.
export const PERSONA_TIMEOUT_MS = 35_000;
export const PERSONA_MAX_CHARS = 280;
/** Intervalo mínimo entre derivações do perfil de voz por grupo (evita write a cada msg). */
export const PERSONA_DERIVE_INTERVAL_MS = 5 * 60_000;
/**
 * Meia-vida do decaimento exponencial das contagens de vocabulário acumuladas no
 * perfil persistido. Histórico mais antigo pesa menos; termos recentes ponderam mais,
 * mas o vocabulário do grupo nunca é sobrescrito por só a última janela.
 */
export const PERSONA_TOKEN_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
/** Teto de tokens mais frequentes exibidos no prompt do perfil de voz. */
export const PERSONA_TOP_TOKENS = 50;
/**
 * Quantas entradas de contexto a persona injeta no prompt em "Últimas trocas".
 * Cada troca = 2 entries (membro + bot) → 40 = 20 trocas.
 */
export const PERSONA_CONTEXT_TURNS = 40;

/** Defaults do bot Fun standalone (não herda config do TMB). */
export const DEFAULT_FUN_CONFIG = Object.freeze({
  enabled: true,
  prefix: '/',
  cooldownMs: 60_000,
  xpMin: 15,
  xpMax: 25,
  dailyXp: 150,
  dailyCoins: 50,
  rankLimit: 10,
  announceLevelUp: true,
  /**
   * Quando true, o bot @marca usuários no chat em vez de só escrever o nome.
   * Desligue se o grupo achar barulhento.
   */
  mentionUsers: true,
  /**
   * Quando true, respostas do bot citam (reply) a mensagem do usuário no WhatsApp.
   * Ajuda a ver a quem o bot está respondendo em grupo movimentado.
   */
  replyQuoted: true,
  reactionsEnabled: true,
  reactionProviderTimeoutMs: 4500,
  reactionAnimeProviderOrder: ['nekos_best', 'purrbot', 'waifu_pics', 'nekobot'],
  reactionUserAgent: 'TooManyBots-Fun/1.0 (https://github.com/anomalyco/TooManyBots_Interpreter)',
  tenorApiKey: '',
  youtubeApiKey: '',
  tenorClientKey: 'toomanybots_fun',
  requireGroupWhitelist: true,
  // DM: comandos no privado se for membro de grupo na whitelist
  allowDm: true,
  dmCommandsOnly: true,
  dmMembershipCacheTtlMs: 5 * 60_000,
  commandExclusive: true,
  groupWhitelistJids: [],
  debugMode: false,
  logLevel: 'info',
  rankCardImage: true,
  // Cartas colecionáveis
  cardsEnabled: true,
  cardPackCost: 30,
  cardMaxPacksPerOpen: 4,
  cardTradeTtlMs: 5 * 60_000,
  dashboardEnabled: true,
  dashboardHost: '127.0.0.1',
  dashboardPort: 8790,
  // jogos (economia: sinks na /loja; farm lento)
  flipMin: 5,
  flipMax: 80,
  flipCooldownMs: 45_000,
  jobMin: 5,
  jobMax: 14,
  jobCooldownMs: 2 * 60 * 60_000, // 2h — não quebra economia
  luckyMin: 5,
  luckyMax: 40,
  luckyCooldownMs: 3 * 60 * 60_000, // 3h
  betMin: 5,
  betMax: 150,
  divorceCost: 40,
  titleMaxLen: 16,
  // P0 — panelinhas / ponte / missões / evento
  factionsEnabled: true,
  factionMaxMembers: 8,
  factionLeaveCost: 25,
  factionCreateCost: 50,
  bridgeMinActions: 10,
  bridgeDebuffThreshold: 0.25,
  bridgeDebuffXpMult: 0.9,
  missionSquadSize: 3,
  missionRewardPerMember: 30,
  missionDurationMs: 12 * 60 * 60_000,
  missionAutoSpawn: true,
  eventDurationMs: 90 * 60_000,
  eventCrossMultiplier: 2,
  eventCooldownMs: 6 * 60 * 60_000,
  // Eventos só o bot sorteia (surpresa)
  eventAutoSpawn: true,
  /** Chance por mensagem de usuário (legado / complementar). */
  eventAutoSpawnChance: 0.028,
  /**
   * Chance por tick do relógio do mundo (~45s). Autonomia: bot anuncia sem
   * precisar de alguém falar no grupo.
   */
  eventTickChance: 0.12,
  eventHappyWeight: 0.5,
  eventCrossWeight: 0.5,
  /** Loop que dispara mercado/eventos/restock sozinho. */
  worldAutonomous: true,
  worldTickMs: 45_000,
  /** Madrugada real: sem eventos aleatórios do mundo (1h–6h). */
  worldQuietHoursEnabled: true,
  worldQuietHourStart: 1,
  worldQuietHourEnd: 6,
  worldTimezone: 'America/Sao_Paulo',
  /** Detecção LLM de anúncios reais de rolês, churrascos e encontros. */
  groupEventsEnabled: true,
  /** Janela máxima para complementar anúncios fragmentados do mesmo autor. */
  groupEventFragmentWindowMs: 30 * 60_000,
  /** Lembretes relativos ao horário persistido do evento. */
  groupEventReminderThreeDaysEnabled: true,
  groupEventReminderThreeHoursEnabled: true,
  /** Lote completo enviado à LLM para extrair anúncios reais de evento. */
  groupEventBatchSize: 40,
  /** Mensagens já processadas reenviadas apenas como contexto no próximo lote. */
  groupEventBatchContextMessages: 10,
  /** Tentativas adicionais quando a LLM falha antes de reencadear o lote. */
  groupEventBatchMaxRetries: 3,
  /** Limites de payload e operações extraídas em cada lote. */
  groupEventBatchMessageMaxChars: 700,
  groupEventBatchMaxOperations: 12,
  /** Limites de segurança legados para fallback de resolução de alvo. */
  groupEventFragmentMaxMessages: 4,
  groupEventReminderBatchSize: 12,
  selfHealEnabled: true,
  selfHealDryRun: true,
  selfHealIntervalMs: 10 * 60_000,
  selfHealEvidenceRetentionDays: 60,
  selfHealMaxItemsPerRun: 50,
  selfHealMaxCallsPerRun: 10,
  // Flavor LLM — OpenCode Zen (principal) → Ollama (fallback) → template
  // OpenCode Zen Proxy (OpenAI-compatible)
  zenEnabled: true,
  /** Proxy OpenAI-compatible Zen padronizado para todas as tarefas de chat. */
  zenBaseUrl: 'http://localhost:20128/v1',
  zenModel: 'bot-zap',
  // timeout de rede global (tarefas longas usam zen*TimeoutMs próprio)
  zenTimeoutMs: 90_000,
  /** Invent de evento de mercado — modelo grande demora; 45s gerava timeout com texto pronto. */
  zenInventTimeoutMs: 120_000,
  zenMaxTokens: 900,
  /** Orçamento total Zen→Ollama→template por resposta de flavor (ms). */
  flavorTimeoutMs: 55_000,
  zenTemperature: 0.85,
  /**
   * false = NÃO envia temperature/max_tokens (proxy com knobs fixos).
   * true = OpenAI-compat completo (OpenCode Zen etc.).
   */
  zenSendSamplingParams: false,
  zenApiKey: '',
  /**
   * Retentativas do Zen antes de cair nos fallbacks mockados (template/sintético):
   * 1 chamada + zenMaxRetries = total de chamadas (default 3 → 4 totais).
   * O fallback Ollama foi descontinuado.
   */
  zenMaxRetries: 3,
  /**
   * Knobs por tarefa (override de zenTemperature/zenMaxTokens globais).
   * Ver fun/llm/zenTaskParams.js — invent/extract/flavor/chaos/tarot/assault/persona/lore_reconcile/dailyGuess/dailyHint/journalist
   */
  zenInventTemperature: 0.75,
  zenInventMaxTokens: 1600,
  // zenInventTimeoutMs acima (120s)
  zenExtractTemperature: 0.3,
  zenExtractMaxTokens: 400,
  zenFlavorTemperature: 0.95,
  zenFlavorMaxTokens: 220,
  zenChaosTemperature: 1.0,
  zenChaosMaxTokens: 400,
  zenAssaultTemperature: 0.95,
  zenAssaultMaxTokens: 550,
  /** Teto do roteiro de assalto no WhatsApp (chars). */
  assaultStoryMaxChars: 900,
  assaultStoryMaxTokens: 550,
  zenPersonaTemperature: 0.7,
  zenPersonaMaxTokens: 360,
  zenDailyGuessTemperature: 0.9,
  zenDailyGuessMaxTokens: 400,
  zenDailyGuessTimeoutMs: 45_000,
  zenDailyHintTemperature: 0.8,
  zenDailyHintMaxTokens: 180,
  zenDailyHintTimeoutMs: 30_000,
  zenJournalistTemperature: 0.7,
  zenJournalistMaxTokens: 700,
  /** Se true: após motor de %, reescreve title/body com FACTS (anti-alucinação de direção). */
  marketJournalistEnabled: true,
  /** Sempre anexa flavor (template) se LLM vazio; false = omite linha. */
  flavorAlways: true,
  /** Quantas frases recentes lembrar p/ anti-eco (flavor/chaos). */
  flavorRecentMax: 10,
  // Ollama local (DEPRECATED — fallback descontinuado; keys mantidas por compat)
  ollamaEnabled: false,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'gemma4:latest',
  ollamaTimeoutMs: 25_000,
  ollamaNumPredict: 400,
  ollamaTemperature: 0.85,
  ollamaMaxChars: 1000,
  // -1 = modelo fica carregado até o Ollama reiniciar / outro unload
  ollamaKeepAlive: -1,
  ollamaWarmupOnBoot: true,
  ollamaWarmupTimeoutMs: 120_000,
  // reafirma residência a cada N ms (0 = só keep_alive do request; default 10 min)
  ollamaKeepAliveRefreshMs: 10 * 60_000,
  /**
   * Se true, respostas de comando vão no privado de quem pediu (menos spam no grupo).
   * Exceções: FUN_PUBLIC_GROUP_COMMANDS (aposta, panelinha, missões, marry, ship, pay…).
   * Default true — o grupo fica só com duelo/aposta/panelinha/social.
   */
  /**
   * false = tudo no grupo/chat atual.
   * DM em massa → WhatsApp restringe / ban por spam. NÃO ligar em produção de grupo.
   */
  replyCommandsInPrivate: false,
  // Cassino
  casinoMin: 5,
  casinoMax: 100,
  casinoCooldownMs: 20_000,
  casinoHouseEdge: 0.03,
  jackpotRate: 0.01,
  jackpotMinHit: 50,
  rouletteCooldownMs: 15_000,
  slotCooldownMs: 20_000,
  crashMin: 5,
  crashMax: 80,
  crashCooldownMs: 30_000,
  crashMaxMult: 12,
  crashGrowthPerSec: 0.18,
  crashTtlMs: 45_000,
  blackjackMin: 5,
  blackjackMax: 80,
  blackjackCooldownMs: 25_000,
  diceDuelMin: 5,
  diceDuelMax: 150,
  tournamentEntryMin: 10,
  tournamentEntryMax: 80,
  tournamentSize: 4,
  // Mini bingo: cartela 3×3 · só modo rápido (1 msg no fim; clássico removido — flood WA)
  bingoMin: 5,
  bingoMax: 100,
  bingoCooldownMs: 15_000,
  bingoSize: 4,
  bingoMinPlayers: 2,
  bingoLobbyTtlMs: 5 * 60_000,
  bingoPoolMax: 30,
  bingoDrawCount: 12,
  bingoHouseEdge: 0.05,
  bingoSoloLineMult: 2.5,
  bingoSoloFullMult: 8,
  bingoDefaultMode: 'fast',
  // Mercado de colecionáveis (galeria dinâmica)
  marketEnabled: true,
  /** Eventos de mercado mais raros: ~2h–5h (era 45min–3h e inflava preço). */
  marketEventMinMs: 2 * 60 * 60_000,
  marketEventMaxMs: 5 * 60 * 60_000,
  marketBreakChance: 0.06,
  marketRepairRate: 0.22,
  marketAnnounce: true,
  /** Reposição de estoque (armas + rua) em tempo real — 4 dias */
  marketRestockMs: 4 * 24 * 60 * 60_000,
  /** Economia 4 camadas: regulador + ticks de preço sem evento */
  economyEnabled: true,
  economyTickMs: 15 * 60_000,
  economyRegulateMs: 30 * 60_000,
  /** Bolsa: ações das 6 empresas (virtual, long-only) */
  bolsaEnabled: true,
  bolsaTradeCooldownMs: 30_000,
  bolsaMaxQtyPerTicker: 40,
  bolsaMaxPositionCoins: 2500,
  bolsaMinQty: 1,
  bolsaDividendPeriodMs: 24 * 60 * 60_000,
  bolsaDividendCapPerTick: 80,
  assaultCooldownMs: 5 * 60_000,
  assaultMinSteal: 8,
  /** PvP: ganho real mas menor que banco/lojinha */
  assaultMaxStealRatio: 0.12,
  assaultBaseChance: 0.38,
  // Profissões / testes (link público cloudflared)
  publicBaseUrl: '',
  jobTestPath: '/job/play',
  jobTokenSecret: '',
  jobLinkTtlMs: 15 * 60_000,
  dashboardUiPort: 3001,
  dashboardAllowedOrigins: ['*.trycloudflare.com'],
  /** Multa de falha PvP desativada por padrão (piso/teto não forçam cobrança). */
  assaultFailFinePct: 0,
  assaultFailFineMin: 10,
  assaultFailFineMax: 200,
  /** Heists NPC — fonte principal de coin do loop de armas */
  heistShopMin: 48,
  heistShopMax: 100,
  heistShopBaseChance: 0.5,
  /** Multa de falha em heist de loja: 5% do saldo (piso 10 · teto 200). */
  heistShopFailFinePct: 0.05,
  heistBankMin: 150,
  heistBankMax: 340,
  heistBankBaseChance: 0.34,
  /** Multa de falha em heist de banco: 10% do saldo (piso 10 · teto 200). */
  heistBankFailFinePct: 0.10,
  /** Penalidade de chance quando se usa arma em assalto a banco (armas corpo a corpo/fogo são ineficazes contra cofre). */
  heistBankWeaponPenalty: 0.10,
  heistBankCooldownMs: 60 * 60_000,
  /** Cooldown de heist de loja: 30 minutos (metade do banco; loja é crime menor). */
  heistShopCooldownMs: 30 * 60_000,
  // Tarô (tiragem local + leitura Zen)
  tarotEnabled: true,
  tarotCooldownMs: 45_000,
  tarotMaxChars: 3000,
  tarotCardCount: 3,
  tarotTimeoutMs: 25_000,
  tarotMaxTokens: 1400,
  tarotTemperature: 0.9,
  // Quem é Mais Provável? (QMP)
  qmpEnabled: true,
  /** Chance por mensagem normal do grupo de disparar pergunta automática (~2%). */
  qmpAutoTriggerChance: 0.02,
  /** Cooldown entre autos por grupo (evita spam). */
  qmpAutoTriggerCooldownMs: 30 * 60_000,
  /** Duração da rodada de votação. */
  qmpRoundDurationMs: 10 * 60_000,
  /** Cooldown por usuário entre criar perguntas manuais. */
  qmpCooldownMs: 45_000,
  qmpMaxPromptLen: 300,
  qmpRankLimit: 10,
  /** Quantas rodadas no `/qmp historico`. */
  qmpHistoryLimit: 8,
  /**
   * 1 pergunta pesada a cada N rodadas (5 = 4 normais + 1 pesada).
   * Estilo "Amigos de Merda" intercalado.
   */
  qmpHeavyEvery: 5,
  qmpHeavyEnabled: true,
  /** Quantas perguntas recentes entram no anti-eco do LLM. */
  qmpAntiEchoLimit: 12,
  qmpAntiEchoMaxOverlap: 0.42,
  /** Tentativas totais de gerar via Zen antes do template mockado (1 + retries = default 4).
   *  Fallback Ollama descontinuado. */
  qmpInventRetries: 4,
  /** Parâmetros do QMP são resolvidos exclusivamente pelos knobs Zen abaixo. */
  zenQmpTemperature: 0.95,
  zenQmpMaxTokens: 320,
  zenQmpTimeoutMs: 18_000,
  /** Modelo Zen opcional só para QMP; vazio usa o zenModel global do bot. */
  qmpZenModel: '',
  happyHourDurationMs: 45 * 60_000,
  happyHourPayoutMult: 1.12,
  happyHourCooldownMs: 4 * 60 * 60_000,
  // chaos social
  russianChambers: 6,
  russianDeathMs: 15 * 60_000,
  russianIdleMs: 10 * 60_000,
  chaosCooldownMs: 25_000,
  /** Budget Zen→Ollama pro texto de caos (oráculo/fofoca/etc.). */
  chaosTimeoutMs: 28_000,
  chaosMaxChars: 700,
  chaosMaxTokens: 360,
  // Negócios / propriedades (renda em buffer + /coletar)
  propertiesEnabled: true,
  propertyMaxOwned: 2,
  propertyTickMs: 15 * 60_000,
  propertyMinHealthToEarn: 15,
  // Casas e avatares — economia social por grupo.
  housesEnabled: true,
  avatarEnabled: true,
  visitsEnabled: true,
  giftsEnabled: true,
  robberyEnabled: true,
  houseDailyCollectMax: 1,
  houseMaxItems: 24,
  houseCellGrid: '6x8',
  houseSecurityMaxLevel: 3,
  houseRobberyCooldownMs: 6 * 60 * 60_000,
  houseRobberyDailyMax: 2,
  avatarShopRotationMs: 24 * 60 * 60_000,
  houseVisitDailyMax: 5,
  houseGiftDailyMax: 3,
  // Roast
  roastEnabled: true,
  roastCooldownMs: 60 * 60_000,
  roastMaxChars: 700,
  // Jornal diário (The Group Times)
  groupNewsEnabled: true,
  groupNewsHour: 23,
  groupNewsMinute: 59,
  /** Guarda mensagens elegíveis para o jornal conversacional. */
  groupNewsMessageHistoryEnabled: true,
  /** Retenção curta de texto bruto; snapshots diários nunca guardam citações. */
  groupNewsMessageRetentionDays: 3,
  /** Teto de mensagens lidas numa edição, sempre em ordem cronológica. */
  groupNewsMessageReadLimit: 1200,
  /** Teto de caracteres de conversa enviado à pauta do jornal. */
  groupNewsConversationMaxChars: 28_000,
  // Conquistas
  achievementsEnabled: true,
  // Memória persistente por grupo (lore seletiva)
  memoryEnabled: true,
  memoryMaxFacts: 120,
  /** Cota mínima de fatos independentes preservados por membro no cap 120. */
  memoryMemberMinFactsQuota: 5,
  /** Score mínimo para o fato ser protegido pela cota de membro. */
  memoryMemberMinScoreQuota: 80,
  memorySummaryMaxChars: 160,
  memoryPersonaMaxChars: 500,
  /** Quantos bullets o "clima" (persona) do grupo deve ter. */
  memoryPersonaBullets: 8,
  // Modelo grande (~40k chars): manda contexto de conversa de verdade, não 8 linhas
  memoryBufferSize: 100,
  memoryFlushMinMessages: 40,
  memoryMinMsgChars: 12,
  memoryExtractTimeoutMs: 45_000,
  memoryTtlDays: 45,
  memoryMinScore: 60,
  /** Teto do bloco de mensagens no prompt de extract (chars). System+regras cabem à parte. */
  memoryExtractMaxChars: 36_000,
  /** Quantos fatos “já sabemos” cabem no prompt. */
  memoryKnownFactsInPrompt: 24,
  /** Truncagem por mensagem no buffer/prompt. */
  memoryMsgMaxChars: 400,
  // Perfil customizado por grupo (nick / bio / niver / título / extras)
  profileEnabled: true,
  profileNicknameMax: 24,
  profileBioMax: 160,
  profileTitleMax: 16,
  /** Resto da fofoca que não cabe em nick/bio/niver */
  profileExtrasMax: 280,
  profileBirthdayAnnounce: true,
  profileBirthdayTz: 'America/Sao_Paulo',
  profileBlocklist: [],
  profileAiExtract: true,
  profileExtractTimeoutMs: 22_000,
  // Persona (Bot Membro Vivo) — o bot responde como membro quando citado
  personaEnabled: true,
  personaMemoryEnabled: true,
  personaMemoryMaxContextItems: PERSONA_MEMORY_DEFAULTS.maxContextItems,
  /** Contexto conversacional próprio da persona; não usa o jornal diário. */
  personaImmediateContextEnabled: true,
  personaImmediateContextMessages: 120,
  personaImmediateContextWindowMs: 6 * 60 * 60_000,
  personaImmediateContextRetentionMs: 24 * 60 * 60_000,
  /** Orçamento de caracteres do contexto recente dentro da janela de 32K. */
  personaImmediateContextMaxChars: 32_000,
  personaCooldownMs: PERSONA_COOLDOWN_MS,
  personaMaxTurns: PERSONA_MAX_TURNS,
  personaThreadTtlMs: PERSONA_THREAD_TTL_MS,
  personaWindowSize: PERSONA_WINDOW_SIZE,
  personaWindowMs: PERSONA_WINDOW_MS,
  personaTimeoutMs: PERSONA_TIMEOUT_MS,
  personaMaxChars: PERSONA_MAX_CHARS,
  personaDeriveIntervalMs: PERSONA_DERIVE_INTERVAL_MS,
  /** Meia-vida (ms) do decay das contagens de vocabulário acumuladas no perfil. */
  personaTokenHalfLifeMs: PERSONA_TOKEN_HALF_LIFE_MS,
  /** Quantos tokens mais frequentes persistir (e mostrar) no perfil de voz. */
  personaTopTokens: PERSONA_TOP_TOKENS,
  /** Entradas de "Últimas trocas" injetadas no prompt da persona (20 trocas = 40 entries). */
  personaContextTurns: PERSONA_CONTEXT_TURNS,
  // Persona agentiva: protocolo JSON e allowlist de consultas/zoeira segura.
  personaToolsEnabled: true,
  personaToolCooldownMs: 45_000,
  /** Cada mensagem pode executar uma tool e gerar uma fala final sobre o resultado. */
  personaAgentMaxToolCalls: 1,
  /** Tempo para tools de domínio concluírem e a persona formular a resposta final. */
  personaAgentDeadlineMs: 60_000,
  /** Participação espontânea continua desligada até ativação por grupo/config. */
  personaAutonomyEnabled: false,
  personaAutonomyMode: 'explicit',
  personaAutonomyMinScore: 7,
  personaAutonomyCooldownMs: 15 * 60_000,
  personaAutonomyMaxPerHour: 2,
  personaAutonomyMaxPerDay: 8,
  personaAutonomyMaxConsecutive: 1,
  personaAutonomyNegativeBlockMs: 60 * 60_000,
  // Continuação pós-silêncio: só após uma resposta acionada explicitamente.
  personaFollowupEnabled: true,
  personaFollowupSilenceMs: 60_000,
  personaFollowupMaxCandidates: 60,
  personaFollowupCandidateWindowMs: 30 * 60_000,
  // Reserva contexto para identidade/memória; grupos grandes normalmente usam ~12k de 32k.
  personaFollowupMaxContextChars: 18_000,
  personaFollowupLeaseMs: 90_000,
  personaFollowupMaxRetries: 3,
  // Reconciliação inversa: pedido explícito pode remover lore antiga ou errada.
  loreReconciliationEnabled: true,
  loreReconciliationCooldownMs: 60_000,
  loreReconciliationMaxCandidates: 50,
  loreReconciliationTimeoutMs: 35_000,
  // Inferência social assíncrona por lote para a persona.
  personaSocialHintsEnabled: true,
  personaSocialHintsBatchSize: 50,
  personaSocialHintsFlushIntervalMs: 10 * 60_000,
  personaSocialHintsMinMessages: 8,
  personaSocialHintsMaxChars: 600,
  /** Confiança mínima (0-100) de uma pista social p/ entrar no prompt da persona. */
  personaSocialHintsMinConfidence: 45,
  // 10 Minutos de Crime — evento diário de caos
  chaosEventEnabled: true,
  chaosEventHour: 23,
  chaosEventMinute: 30,
  chaosEventWeekendHour: 22,
  chaosEventWeekendMinute: 0,
  chaosEventDurationMs: 10 * 60_000,
  chaosEventNoWeaponSuccess: 0.50,
  chaosEventWeaponBaseChance: 0.60,
  chaosEventMaxStealAmount: 100,
  chaosEventMaxDebt: 100,
  chaosEventDefenseEnabled: true,
  chaosEventDefenseTimeoutMs: 8000,
  /** Grace wall-clock extra p/ Baileys atrasar a entrega da resposta de defesa */
  chaosEventDefenseDeliveryGraceMs: 25_000,
  /** Cooldown entre assaltos do mesmo user no mesmo grupo durante a PURGA */
  chaosEventAssaultCooldownMs: 30_000,
  /** Só pode ser vítima da Purga se mandou msg nos últimos N ms (padrão 3 min). */
  chaosEventActivityWindowMs: 3 * 60_000,
  // TUI (painel full-screen de auditoria no `npm run fun`)
  /** Liga/desliga a TUI interativa; false cai para log plain `[fun] ...`. */
  tuiEnabled: true,
  /** Intervalo de refresh do painel em ms (mín. 200, máx. 10_000). */
  tuiRefreshMs: 1000,
  /** Limite do histórico em anel (mín. 20, máx. 2000). */
  tuiMaxHistory: 200,
  // Filas de processamento (command queue + output queue)
  commandMaxConcurrency: 20,
  commandFastConcurrency: 8,
  commandStateConcurrency: 4,
  commandHeavyConcurrency: 8,
  commandQueueMax: 20000,
  commandQueueWarnThreshold: 2000,
  outputConcurrency: 8,
  outputJidGapMs: 250,
  outputCoalesceDelayMs: 1000,
  outputQueueMax: 10000,
  // Desafio Diário
  dailyChallengeEnabled: true,
  dailyChallengeStartHour: 8,
  dailyChallengeEndHour: 20,
  dailyChallengeDurationMs: 4 * 60 * 60 * 1000,
  dailyChallengeHintCooldownMs: 10 * 60 * 1000,
  dailyChallengeMaxAttemptsPerUser: 30,
  dailyChallengeAttemptCooldownMs: 5 * 1000,
  dailyChallengeSkipVotesRequired: 3,
  dailyChallengeRewardWeights: { boost_xp: 40, coins: 35, daily_bonus: 20, jackpot: 5 },
  dailyChallengeRewardCoinsMin: 20,
  dailyChallengeRewardCoinsMax: 50,
  dailyChallengeRewardBoostXpDurationMs: 4 * 60 * 60 * 1000,
  dailyChallengeRewardDailyBonusMultiplier: 2,
  dailyChallengeRewardJackpotAmount: 100,
  dailyChallengeSpeedBonus: {
    fast: { max: 5, mult: 1.0 },
    medium: { max: 15, mult: 0.8 },
    slow: { max: 30, mult: 0.6 },
    late: { max: Infinity, mult: 0.4 },
  },
  dailyChallengeNewsEnabled: true,
  dailyChallengePokemonMaxGen: 386,
  dailyChallengeContentMemory: { pokemon: 30, game: 30, riddle: 50 },
  // Geração de imagens (/gerar e /imaginar) — Gemini ou proxy OpenAI
  imageGenEnabled: true,
  /** Provedor: 'gemini' (padrão) ou 'openai' (proxy /v1/images/generations). */
  imageGenProvider: 'gemini',
  /** Base URL da proxy de geração de imagens (se provider='openai'). */
  imageGenBaseUrl: 'http://127.0.0.1:3300',
  /** API key para Gemini ou Bearer da proxy. */
  imageGenApiKey: '',
  /** Modelo do Gemini ou da proxy. */
  imageGenModel: 'models/gemini-3.1-flash-lite-image',
  /** Limite global diário (todos os grupos). Reset 00h America/Sao_Paulo. */
  imageGenDailyLimit: 25,
  /** Timeout por requisição de geração (ms). */
  imageGenTimeoutMs: 60_000,
  /** Tamanho solicitado (ex.: 1K, 2K ou 1024x1024). */
  imageGenSize: '1K',
  /** Nível de thinking (ex.: minimal). */
  imageGenThinkingLevel: 'minimal',
  /** Qualidade (ex.: standard / hd). Vazio = default do proxy. */
  imageGenQuality: '',
  /** Formato de resposta: 'b64_json' (default) ou 'url'. */
  imageGenResponseFormat: 'b64_json',
  /** Teto de chars da lore injetada no /gerar (prefixo de memória). */
  imageGenLoreMaxChars: 1200,
  // Adaptadores modulares de extração (Fase 1-5)
  extractionAdapters: {
    parseGuard: { enabled: false },
    evidenceEnricher: { enabled: false },
    bufferLock: { enabled: false },
    batchDedup: { enabled: false, minScore: 80, windowHours: 24 },
    promptContext: { enabled: false },
    metricsRecorder: { enabled: false, sink: 'stdout' },
  },
});

/**
 * Catálogo de conquistas (metas recalibradas à economia real).
 * @type {Readonly<Record<string, { id: string, name: string, description: string, icon: string }>>}
 */
export const ACHIEVEMENTS = Object.freeze({
  coins_2k: {
    id: 'coins_2k',
    name: 'Bolso gordo',
    description: 'Ter 2.000 coins no saldo',
    icon: '💰',
  },
  first_share: {
    id: 'first_share',
    name: 'O Investidor',
    description: 'Comprar a primeira ação na bolsa',
    icon: '📈',
  },
  crash_unlucky_5: {
    id: 'crash_unlucky_5',
    name: 'Viciado em Crash',
    description: 'Perder 5 vezes seguidas no Crash',
    icon: '🚀',
  },
  longshot_win: {
    id: 'longshot_win',
    name: 'A Sorte do Azarado',
    description: 'Vencer no Crash com multiplicador ≥ 5×',
    icon: '🎰',
  },
  cancel_10: {
    id: 'cancel_10',
    name: 'O Coringa',
    description: 'Cancelar 10 pessoas',
    icon: '🤡',
  },
  divorce_3: {
    id: 'divorce_3',
    name: 'Coração de Pedra',
    description: 'Divorciar 3 vezes',
    icon: '💔',
  },
  marry_3: {
    id: 'marry_3',
    name: 'Casamenteiro',
    description: 'Casar 3 vezes',
    icon: '💍',
  },
  assault_win_15: {
    id: 'assault_win_15',
    name: 'O Assaltante',
    description: '15 assaltos bem-sucedidos',
    icon: '🔫',
  },
  assault_fail_10: {
    id: 'assault_fail_10',
    name: 'Presidiário',
    description: 'Falhar 10 assaltos',
    icon: '🚓',
  },
  first_property: {
    id: 'first_property',
    name: 'Patrãozinho',
    description: 'Comprar o primeiro negócio',
    icon: '🏪',
  },
  collect_500: {
    id: 'collect_500',
    name: 'Caixa cheia',
    description: 'Coletar 500c de renda de negócios',
    icon: '💵',
  },
});
