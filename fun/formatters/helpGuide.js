/**
 * Ajuda modular do Fun — índice curto + `/ajuda <tema>`.
 * Evita parede de texto no WhatsApp.
 */

function pfx(prefix) {
  return String(prefix || '/');
}

function norm(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

/** @type {ReadonlyArray<{ id: string, title: string, aliases: string[] }>} */
export const HELP_TOPICS = Object.freeze([
  { id: 'basico', title: 'Básico', aliases: ['basico', 'perfil', 'rank', 'inicio', 'home'] },
  {
    id: 'economia',
    title: 'Economia',
    aliases: ['economia', 'loja', 'mercado', 'bolsa', 'rua', 'armas', 'carteira', 'coins'],
  },
  { id: 'social', title: 'Social', aliases: ['social', 'casar', 'marry', 'ship'] },
  { id: 'emprego', title: 'Emprego', aliases: ['emprego', 'trabalho', 'job', 'clt'] },
  { id: 'jogos', title: 'Jogos', aliases: ['jogos', 'games', 'games', 'cf', 'aposta'] },
  {
    id: 'cassino',
    title: 'Cassino',
    aliases: ['cassino', 'casino', 'roleta', 'bingo', 'bj', 'crash'],
  },
  {
    id: 'zoeira',
    title: 'Zoeira',
    aliases: ['zoeira', 'chaos', 'fofoca', 'oraculo', 'tarot', 'lore'],
  },
  {
    id: 'faccoes',
    title: 'Facções',
    aliases: ['faccoes', 'faccao', 'panelinha', 'missao', 'guerra'],
  },
  { id: 'midia', title: 'Mídia', aliases: ['midia', 'media', 'fig', 'figurinha', 'sticker'] },
  { id: 'privado', title: 'Privado', aliases: ['privado', 'dm', 'pv', 'grupo'] },
]);

const TOPIC_BY_ALIAS = (() => {
  const m = new Map();
  for (const t of HELP_TOPICS) {
    for (const a of t.aliases) m.set(a, t.id);
  }
  return m;
})();

export function resolveHelpTopic(token) {
  const t = norm(token);
  if (!t) return null;
  return TOPIC_BY_ALIAS.get(t) || null;
}

function formatIndex(p) {
  return [
    '🎮 *Fun — ajuda*',
    '',
    '*Temas* · digite o nome:',
    `• \`${p}ajuda basico\` · \`${p}ajuda economia\``,
    `• \`${p}ajuda social\` · \`${p}ajuda emprego\``,
    `• \`${p}ajuda jogos\` · \`${p}ajuda cassino\``,
    `• \`${p}ajuda zoeira\` · \`${p}ajuda faccoes\``,
    `• \`${p}ajuda midia\` · \`${p}ajuda privado\``,
    '',
    '*Atalhos do dia*',
    `\`${p}daily\` · \`${p}saldo\` · \`${p}rank\` · \`${p}mercado\``,
    `\`${p}bolsa\` · \`${p}loja\` · \`${p}cf 20 cara\` · \`${p}fig\``,
    '',
    `_Ex.: \`${p}ajuda bolsa\` ou \`${p}ajuda cassino\`_`,
  ].join('\n');
}

function topicBasico(p) {
  return [
    '👤 *Básico*',
    '',
    `\`${p}xp\` / \`${p}perfil\` — você · \`${p}perfil @user\``,
    `\`${p}rank\` — top XP · \`${p}rankcoins\` — coins`,
    `\`${p}topmsg\` — quem mais fala`,
    `\`${p}daily\` — recompensa diária`,
    `\`${p}coins\` / \`${p}saldo\` · \`${p}pay 50 @user\``,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicEconomia(p) {
  return [
    '💰 *Economia*',
    '',
    '*Loja*',
    `\`${p}loja\` · \`${p}comprar chave_armas\` · \`${p}comprar boost_xp\``,
    '',
    '*Rua & armas*',
    `\`${p}mercado\` · \`${p}armas\` · \`${p}adquirir gasolina\``,
    `\`${p}inventario\` · \`${p}bazar\` · \`${p}vender <id> <preço>\``,
    `\`${p}consertar <id>\` · \`${p}assaltar\` (banco · lojinha · @user)`,
    '',
    '*Bolsa*',
    `\`${p}bolsa\` — cotações · \`${p}carteira\` — suas ações`,
    `\`${p}bolsa comprar bombatech 3\``,
    `\`${p}bolsa vender pato 1\``,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicSocial(p) {
  return [
    '💛 *Social*',
    '',
    `\`${p}marry @user\` → \`${p}aceitar\` / \`${p}recusar\``,
    `\`${p}divorce\` · \`${p}ship @a @b\``,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicEmprego(p) {
  return [
    '💼 *Emprego*',
    '',
    `\`${p}emprego\` — cargos`,
    `\`${p}emprego bombeiro\` — teste no celular`,
    `\`${p}demitir sim\` — sair · salário no \`${p}daily\``,
    `\`${p}trabalhar\` — freela (à parte do CLT)`,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicJogos(p) {
  return [
    '🎲 *Jogos*',
    '',
    `\`${p}cf 20 cara\` — cara ou coroa`,
    `\`${p}sorte\` — chance free`,
    `\`${p}aposta @user 20 cara\` — duelo de moeda`,
    `\`${p}roletarussa\` → \`${p}puxar\` — sem XP 15 min se morrer`,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicCassino(p) {
  return [
    '🎰 *Cassino*',
    '',
    `\`${p}roleta 20 vermelho\` · \`${p}slot 15\` · \`${p}jackpot\``,
    `\`${p}crash 20\` → \`${p}sair\` (cashout)`,
    `\`${p}bj 25\` → \`${p}hit\` / \`${p}stand\``,
    `\`${p}desafio @user 30\` — dados d20`,
    `\`${p}torneio 20\` · \`${p}rankcassino\``,
    `\`${p}bingo 15\` · \`${p}bingo start\` · \`${p}bingo solo 15\``,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicZoeira(p) {
  return [
    '🤡 *Zoeira*',
    '',
    `\`${p}tarot minha pergunta\` — tiragem`,
    `\`${p}cancelar @user\` · \`${p}fofoca @user\``,
    `\`${p}oraculo Vou namorar?\` — IA maluca (≠ tarô)`,
    `\`${p}illuminati\` — conspiração aleatória`,
    `\`${p}lore\` — memória do grupo`,
    `\`${p}esquecelore @user\` · \`${p}esquecelore tudo sim\``,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicFaccoes(p) {
  return [
    '🏴‍☠️ *Facções*',
    '',
    `\`${p}faccao criar|entrar|sair|doar|rank|info\``,
    `\`${p}panelinha\` — placar · \`${p}comopanelinha\` — guia`,
    `\`${p}ponte\` · \`${p}missao\` · \`${p}squad\``,
    `\`${p}evento\` — status (trégua/happy o *bot* sorteia)`,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicMidia(p) {
  return [
    '🖼️ *Mídia*',
    '',
    `\`${p}fig\` / \`${p}figurinha\` — vira sticker`,
    '• legenda na mídia *ou* responda a mídia com o comando',
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

function topicPrivado(p) {
  return [
    '💬 *Privado*',
    '',
    'No PV (se for membro de grupo liberado):',
    '• jogos solo, saldo, daily, rank…',
    `\`${p}grupo\` — escolhe o grupo do privado`,
    '',
    `_Voltar: \`${p}ajuda\`_`,
  ].join('\n');
}

const RENDERERS = Object.freeze({
  basico: topicBasico,
  economia: topicEconomia,
  social: topicSocial,
  emprego: topicEmprego,
  jogos: topicJogos,
  cassino: topicCassino,
  zoeira: topicZoeira,
  faccoes: topicFaccoes,
  midia: topicMidia,
  privado: topicPrivado,
});

/**
 * @param {string} [prefix='/']
 * @param {string} [topicToken] — opcional; vazio = índice
 */
export function formatHelp(prefix = '/', topicToken = '') {
  const p = pfx(prefix);
  const raw = String(topicToken || '').trim();
  if (!raw) return formatIndex(p);

  const id = resolveHelpTopic(raw);
  if (!id || !RENDERERS[id]) {
    return [
      `Não achei o tema *${raw}*.`,
      '',
      formatIndex(p),
    ].join('\n');
  }
  return RENDERERS[id](p);
}

/** Índice + lista de ids (testes / debug) */
export function listHelpTopicIds() {
  return HELP_TOPICS.map((t) => t.id);
}
