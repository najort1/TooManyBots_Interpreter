/**
 * Baralho de Tarô — Arcanos Maiores (22).
 * Tiragem local (RNG); significado narrado pelo LLM.
 */

export const TAROT_MAJOR = Object.freeze([
  {
    id: 0,
    name: 'O Louco',
    emoji: '🃏',
    upright: ['novo ciclo', 'salto de fé', 'espontaneidade', 'potencial puro'],
    reversed: ['imprudência', 'precipitação', 'hesitação paralisante', 'falta de discernimento'],
  },
  {
    id: 1,
    name: 'O Mago',
    emoji: '🪄',
    upright: ['habilidade', 'foco e intenção', 'capacidade de manifestação', 'recursos internos'],
    reversed: ['manipulação', 'intenções turvas', 'dispersão de energia', 'potencial bloqueado'],
  },
  {
    id: 2,
    name: 'A Sacerdotisa',
    emoji: '🌙',
    upright: ['intuição profunda', 'mistério', 'sabedoria interior', 'silêncio contemplativo'],
    reversed: ['intuição reprimida', 'superficialidade', 'segredos nocivos', 'desconexão interior'],
  },
  {
    id: 3,
    name: 'A Imperatriz',
    emoji: '👑',
    upright: ['fertilidade criativa', 'abundância', 'nutrição emocional', 'generosidade'],
    reversed: ['sufocamento afetivo', 'bloqueio criativo', 'esgotamento', 'negligência pessoal'],
  },
  {
    id: 4,
    name: 'O Imperador',
    emoji: '🏛️',
    upright: ['estrutura', 'autoridade legítima', 'disciplina', 'limites conscientes'],
    reversed: ['autoritarismo', 'rigidez inflexível', 'instabilidade', 'perda de controle'],
  },
  {
    id: 5,
    name: 'O Hierofante',
    emoji: '📿',
    upright: ['tradição espiritual', 'sabedoria ancestral', 'valores éticos', 'busca de sentido'],
    reversed: ['dogmatismo cego', 'crise de crenças', 'rigidez moral', 'rejeição a ensinamentos válidos'],
  },
  {
    id: 6,
    name: 'Os Enamorados',
    emoji: '🕊️',
    upright: ['escolha da alma', 'aliança consciente', 'harmonia de valores', 'atração genuína'],
    reversed: ['indecisão profunda', 'conflito interno', 'escolhas por medo', 'desalinhamento ético'],
  },
  {
    id: 7,
    name: 'O Carro',
    emoji: '🛡️',
    upright: ['determinação vitoriosa', 'autodomínio', 'direção clara', 'superação de obstáculos'],
    reversed: ['perda de direção', 'pressa destrutiva', 'descontrole emocional', 'força desgovernada'],
  },
  {
    id: 8,
    name: 'A Força',
    emoji: '🦁',
    upright: ['coragem compassiva', 'paciência inabalável', 'domínio interior', 'força moral'],
    reversed: ['fraqueza diante do medo', 'impulsividade agressiva', 'insegurança', 'dúvida sobre si'],
  },
  {
    id: 9,
    name: 'O Eremita',
    emoji: '🏮',
    upright: ['recolhimento sábio', 'busca da verdade', 'introspecção iluminada', 'prudência'],
    reversed: ['isolamento estéril', 'alienação', 'recusa em ouvir', 'solidão amarga'],
  },
  {
    id: 10,
    name: 'A Roda da Fortuna',
    emoji: '🎡',
    upright: ['viradas do destino', 'ciclos universais', 'movimento inevitável', 'oportunidades'],
    reversed: ['resistência à mudança', 'fase de provação', 'repetição de erros', 'estagnação kármica'],
  },
  {
    id: 11,
    name: 'A Justiça',
    emoji: '⚖️',
    upright: ['verdade cristalina', 'imparcialidade', 'equilíbrio kármico', 'responsabilidade ética'],
    reversed: ['injustiça', 'fuga da responsabilidade', 'parcialidade nociva', 'autonegação da verdade'],
  },
  {
    id: 12,
    name: 'O Enforcado',
    emoji: '⏳',
    upright: ['pausa consciente', 'nova perspectiva', 'renúncia iluminada', 'rendição ao tempo'],
    reversed: ['sacrifício estéril', 'estagnação obstinada', 'vitimização', 'resistência ao aprendizado'],
  },
  {
    id: 13,
    name: 'A Morte',
    emoji: '🥀',
    upright: ['encerramento necessário', 'profunda transmutação', 'fechamento de ciclo', 'renovação'],
    reversed: ['resistência à transição', 'apego ao que findou', 'medo do renascimento', 'estagnação dolorosa'],
  },
  {
    id: 14,
    name: 'A Temperança',
    emoji: '🕊️',
    upright: ['harmonia e cura', 'paciência serena', 'alquimia interior', 'moderação sábia'],
    reversed: ['desequilíbrio', 'impaciência desmedida', 'excessos prejudiciais', 'desarmonia interna'],
  },
  {
    id: 15,
    name: 'O Diabo',
    emoji: '⛓️',
    upright: ['sombras inconscientes', 'apego material', 'fascínio ilusório', 'força dos instintos'],
    reversed: ['libertação de amarras', 'consciência das próprias correntes', 'superação de ilusões', 'cura da sombra'],
  },
  {
    id: 16,
    name: 'A Torre',
    emoji: '⚡',
    upright: ['ruptura de falsas certezas', 'queda de ilusões', 'despertar brusco', 'libertação necessária'],
    reversed: ['adiamento do colapso', 'medo da verdade', 'crise prolongada', 'resistência à renovação'],
  },
  {
    id: 17,
    name: 'A Estrela',
    emoji: '⭐',
    upright: ['esperança renovada', 'cura espiritual', 'inspiração serena', 'fé e clareza'],
    reversed: ['desalento temporário', 'crise de fé', 'pessimismo', 'desconexão com a esperança'],
  },
  {
    id: 18,
    name: 'A Lua',
    emoji: '🌕',
    upright: ['mistérios do inconsciente', 'intuição oculta', 'navegar pelas sombras', 'sonhos reveladores'],
    reversed: ['dissipação de ilusões', 'superação de medos ocultos', 'clareza emergente', 'angústia superada'],
  },
  {
    id: 19,
    name: 'O Sol',
    emoji: '☀️',
    upright: ['vitalidade plena', 'clareza e verdade', 'alegria consciente', 'sucesso iluminado'],
    reversed: ['dificuldade em enxergar a luz', 'otimismo ingênuo', 'vaidade temporária', 'vitalidade reduzida'],
  },
  {
    id: 20,
    name: 'O Julgamento',
    emoji: '📯',
    upright: ['chamado da consciência', 'despertar espiritual', 'redenção e cura', 'segunda oportunidade'],
    reversed: ['recusa ao chamado', 'culpa estéril', 'resistência ao despertar', 'apego a velhos julgamentos'],
  },
  {
    id: 21,
    name: 'O Mundo',
    emoji: '🌍',
    upright: ['integração cósmica', 'realização plena', 'conclusão de jornada', 'harmonia total'],
    reversed: ['ciclo incompleto', 'pendências a sanar', 'hesitação na reta final', 'plenitude adiada'],
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
  const q = String(question || '').trim() || 'questão apresentada';
  const parts = (cards || []).map((c) => {
    const orient = c.reversed ? 'em posição invertida' : 'em posição direta';
    const k = (c.keywords || []).slice(0, 2).join(' e ');
    return `*${c.name}* (${orient}) na posição *${c.position}*:\n  Manifesta energias de *${k}*, indicando reflexão necessária sobre essas forças.`;
  });
  const last = cards?.[cards.length - 1];
  const tip = last
    ? last.reversed
      ? '*Orientação Oracular:* O momento exige prudência, introspecção e liberação de bloqueios antes de empreender novos passos.'
      : '*Orientação Oracular:* Mantenha a presença de espírito e avance com discernimento, confiando no processo e mantendo a integridade de seus valores.'
    : 'As cartas permanecem em silêncio neste momento.';

  return [
    `*Tiragem para:* _${q.slice(0, 120)}_`,
    '',
    ...parts,
    '',
    tip,
  ].join('\n');
}
