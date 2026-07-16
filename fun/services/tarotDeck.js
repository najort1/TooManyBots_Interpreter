/**
 * Baralho de Tarô — Arcanos Maiores (22).
 * Tiragem local (RNG); significado narrado pelo LLM.
 */

export const TAROT_MAJOR = Object.freeze([
  {
    id: 0,
    name: 'O Louco',
    emoji: '🃏',
    upright: ['início', 'salto no escuro', 'inocência', 'liberdade'],
    reversed: ['imprudência', 'medo de começar', 'caos sem filtro', 'naivê demais'],
  },
  {
    id: 1,
    name: 'O Mago',
    emoji: '🪄',
    upright: ['habilidade', 'foco', 'manifestar', 'ter as ferramentas'],
    reversed: ['manipulação', 'promessa vazia', 'dispersão', 'falar mais que fazer'],
  },
  {
    id: 2,
    name: 'A Sacerdotisa',
    emoji: '🌙',
    upright: ['intuição', 'segredo', 'paciência', 'ouvir o silêncio'],
    reversed: ['ignorar o feeling', 'fofoca', 'bloqueio interior', 'forçar resposta'],
  },
  {
    id: 3,
    name: 'A Imperatriz',
    emoji: '👑',
    upright: ['cuidado', 'abundância', 'criar', 'afeto generoso'],
    reversed: ['dependência', 'esgotamento', 'possessividade', 'mimo demais'],
  },
  {
    id: 4,
    name: 'O Imperador',
    emoji: '🏛️',
    upright: ['estrutura', 'autoridade', 'plano', 'limites saudáveis'],
    reversed: ['controle tóxico', 'rigidez', 'chefe chato', 'medo de ceder'],
  },
  {
    id: 5,
    name: 'O Hierofante',
    emoji: '📿',
    upright: ['tradição', 'mentor', 'valores', 'grupo de referência'],
    reversed: ['rebeldia cega', 'dogma', 'seguir moda errada', 'guru furado'],
  },
  {
    id: 6,
    name: 'Os Enamorados',
    emoji: '💕',
    upright: ['escolha do coração', 'parceria', 'valores alinhados', 'atração real'],
    reversed: ['indecisão', 'triangulação', 'escolher por medo', 'desalinho'],
  },
  {
    id: 7,
    name: 'O Carro',
    emoji: '🏎️',
    upright: ['vitória', 'direção', 'força de vontade', 'seguir em frente'],
    reversed: ['perda de controle', 'raiva no volante', 'travado', 'ego no caminho'],
  },
  {
    id: 8,
    name: 'A Força',
    emoji: '🦁',
    upright: ['coragem mansa', 'paciência firme', 'domínio de si', 'gentileza poderosa'],
    reversed: ['insegurança', 'explosão', 'forçar a barra', 'dúvida de si'],
  },
  {
    id: 9,
    name: 'O Eremita',
    emoji: '🏮',
    upright: ['recuo sábio', 'autoconhecimento', 'solitude útil', 'buscar luz interior'],
    reversed: ['isolamento tóxico', 'fugir de gente', 'teimosia solitária', 'perdido'],
  },
  {
    id: 10,
    name: 'A Roda da Fortuna',
    emoji: '🎡',
    upright: ['virada', 'ciclo', 'sorte em movimento', 'o que sobe desce (e sobe)'],
    reversed: ['má fase', 'resistir à mudança', 'azar temporário', 'ficar no mesmo loop'],
  },
  {
    id: 11,
    name: 'A Justiça',
    emoji: '⚖️',
    upright: ['verdade', 'consequência', 'equilíbrio', 'conta que fecha'],
    reversed: ['injustiça', 'desculpa esfarrapada', 'evitar responsabilidade', 'vies'],
  },
  {
    id: 12,
    name: 'O Enforcado',
    emoji: '🙃',
    upright: ['pausa estratégica', 'novo ângulo', 'soltar o controle', 'sacrifício útil'],
    reversed: ['martírio inútil', 'atraso teimoso', 'ficar preso', 'vitimismo'],
  },
  {
    id: 13,
    name: 'A Morte',
    emoji: '🥀',
    upright: ['fim necessário', 'transformação', 'fechar ciclo', 'renascimento'],
    reversed: ['apegar no morto', 'medo de mudar', 'arrastar o que já era', 'negar o óbvio'],
  },
  {
    id: 14,
    name: 'A Temperança',
    emoji: '🕊️',
    upright: ['equilíbrio', 'paciência', 'mistura certa', 'meio-termo inteligente'],
    reversed: ['excesso', 'impaciência', 'tudo ou nada', 'descompasso'],
  },
  {
    id: 15,
    name: 'O Diabo',
    emoji: '😈',
    upright: ['apego', 'tentação', 'vício de padrão', 'sombra exposta'],
    reversed: ['soltar corrente', 'enxergar a armadilha', 'recuperar agência', 'sair do looping'],
  },
  {
    id: 16,
    name: 'A Torre',
    emoji: '🗼',
    upright: ['queda de castelo de areia', 'verdade brusca', 'liberdade após o tombo', 'reset'],
    reversed: ['adiar o colapso', 'medo do caos', 'reforma cosmetica', 'negar o abalo'],
  },
  {
    id: 17,
    name: 'A Estrela',
    emoji: '⭐',
    upright: ['esperança', 'cura', 'inspiração', 'fé calma'],
    reversed: ['desânimo', 'fé baixa', 'cinismo', 'perder o norte por um tempo'],
  },
  {
    id: 18,
    name: 'A Lua',
    emoji: '🌕',
    upright: ['ilusão', 'inconsciente', 'medo nebuloso', 'o que não está claro'],
    reversed: ['clareza chegando', 'ansiedade baixando', 'segredo saindo', 'pé no chão'],
  },
  {
    id: 19,
    name: 'O Sol',
    emoji: '☀️',
    upright: ['clareza', 'alegria', 'sucesso visível', 'vitalidade'],
    reversed: ['otimismo forçado', 'ego brilhando demais', 'atraso da vitória', 'cansaço'],
  },
  {
    id: 20,
    name: 'O Julgamento',
    emoji: '📯',
    upright: ['chamado', 'prestação de contas', 'despertar', 'segunda chance real'],
    reversed: ['dúvida no chamado', 'autojulgamento pesado', 'ignorar o aviso', 'ficar no passado'],
  },
  {
    id: 21,
    name: 'O Mundo',
    emoji: '🌍',
    upright: ['conclusão', 'integração', 'ciclo completo', 'chegada'],
    reversed: ['quase lá', 'ponta solta', 'medo de fechar', 'próximo nível adiado'],
  },
]);

const SPREAD_LABELS = Object.freeze(['Passado / base', 'Presente', 'Conselho / tendência']);

/**
 * @param {() => number} random
 * @param {number} [count]
 */
export function drawTarotCards(random = Math.random, count = 3) {
  const n = Math.max(1, Math.min(5, Math.floor(Number(count) || 3)));
  const pool = [...TAROT_MAJOR];
  const drawn = [];
  for (let i = 0; i < n && pool.length > 0; i += 1) {
    const idx = Math.floor((typeof random === 'function' ? random() : Math.random()) * pool.length);
    const card = pool.splice(Math.max(0, idx), 1)[0];
    const reversed = (typeof random === 'function' ? random() : Math.random()) < 0.45;
    drawn.push({
      ...card,
      reversed,
      position: SPREAD_LABELS[i] || `Carta ${i + 1}`,
      keywords: reversed ? card.reversed : card.upright,
    });
  }
  return drawn;
}

/**
 * @param {ReturnType<typeof drawTarotCards>} cards
 */
export function formatTarotDraw(cards) {
  return (cards || [])
    .map((c, i) => {
      const orient = c.reversed ? 'invertida' : 'direita';
      const keys = (c.keywords || []).slice(0, 3).join(', ');
      return `${i + 1}. ${c.emoji || '🃏'} *${c.name}* (${orient}) — _${c.position}_\n   · ${keys}`;
    })
    .join('\n');
}

/**
 * Leitura template se LLM cair.
 * @param {string} question
 * @param {ReturnType<typeof drawTarotCards>} cards
 */
export function fallbackTarotReading(question, cards) {
  const q = String(question || '').trim() || 'a situação em geral';
  const parts = (cards || []).map((c) => {
    const orient = c.reversed ? 'invertida' : 'na direita';
    const k = (c.keywords || []).slice(0, 2).join(' e ');
    return `*${c.name}* (${orient}, ${c.position}): aponta pra *${k}*.`;
  });
  const last = cards?.[cards.length - 1];
  const tip = last
    ? last.reversed
      ? 'Conselho da casa: solta o que tá te prendendo antes de forçar o próximo passo.'
      : 'Conselho da casa: confia no movimento, mas não ignore o detalhe chato do caminho.'
    : 'As cartas sumiram. Até o destino tirou férias.';

  return [
    `Tiragem pra: _${q.slice(0, 120)}_`,
    '',
    ...parts,
    '',
    tip,
    '',
    '_(leitura reserva — o astrólogo virtual tava de bico)_',
  ].join('\n');
}
