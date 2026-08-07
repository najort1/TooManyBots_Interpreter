const sensitive = /(senha|password|token|api[_-]?key|pix|cpf|telefone|celular|endereço|endereco)/iu;
const words = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

const TOPIC_STOPWORDS = new Set([
  'que', 'para', 'com', 'por', 'uma', 'como', 'mas', 'voce', 'tudo',
  'mais', 'esse', 'essa', 'isso', 'ela', 'ele', 'nao', 'esta', 'tem',
  'foi', 'ser', 'ter', 'dos', 'das', 'nos', 'sao', 'sou', 'dele',
]);

const STYLE_HUMOROUS = [
  'kk', 'kkk', 'kkkk', 'kkkkk', 'kkkkkk', 'rs', 'rss', 'hue', 'haha', 'hehe',
  'kkj', 'sla', 'mano', 'zoeira', 'zoeção', 'meme', 'piada',
];
const STYLE_HELPFUL = ['ajuda', 'dúvida', 'duvida', 'obrigado', 'obrigada', 'valeu', 'vlw', 'obg', 'sucesso', 'dica'];
// buckets extras para capturar a zoeira real do grupo (heurística só — sem LLM aqui).
const STYLE_ACID = ['viado', 'arrombado', 'puta', 'caralho', 'fdp', 'mlk', 'bct', 'teh'];
const STYLE_AFFECTIONATE = ['saudade', 'saudades', 'amorzinho', 'mozão', 'crush'];
/**
 * Labels das vozes observadas. 'neutral' (sem gatilho claro) mapeia para []
 * — assim o prompt da persona NÃO afirma "direto, respeitoso" sem evidência
 * e a linha "Voz observada do grupo" some quando não há sinal real.
 */
const STYLE_MAP = {
  humorous: ['bem-humorado', 'leve'],
  helpful: ['prestativo', 'respeitoso'],
  acid: ['ácido', 'debochado'],
  affectionate: ['carinhoso'],
  neutral: [],
};

const TOPIC_MIN_COVERAGE = 2;
const TOPIC_TAKE = 5;
const MAX_SCOPES = 500;

function styleOf(vocabulary) {
  if (vocabulary.some((word) => STYLE_HUMOROUS.includes(word))) return 'humorous';
  if (vocabulary.some((word) => STYLE_HELPFUL.includes(word))) return 'helpful';
  if (vocabulary.some((word) => STYLE_ACID.includes(word))) return 'acid';
  if (vocabulary.some((word) => STYLE_AFFECTIONATE.includes(word))) return 'affectionate';
  return 'neutral';
}

function topicOf(counts, total) {
  if (total < 3) return '';
  return [...counts.entries()]
    .filter(([w, c]) => c >= TOPIC_MIN_COVERAGE && !TOPIC_STOPWORDS.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOPIC_TAKE)
    .map(([w]) => w)
    .join(' ');
}

/**
 * Sinais sociais observacionais por grupo.
 *
 * A lore ("Temas recorrentes") só é produzida a partir de recorrência real na
 * janela de mensagens do grupo — nunca do conteúdo de uma única mensagem —
 * para não poluir o prompt da persona com fragmentos da conversa atual.
 */
export function createSocialMemoryService({ maxScopes = MAX_SCOPES } = {}) {
  const windows = new Map();

  function observe(event = {}) {
    const scopeKey = String(event.scopeKey || '');
    const text = String(event.text || '').trim();
    const participants = [...new Set([event.authorJid, ...(event.mentionedJids || [])].map(String).filter(Boolean))];
    if (!scopeKey || sensitive.test(text)) return { scopeKey, participants: [], topic: '', style: [] };

    const vocabulary = words(text);
    const styleKey = styleOf(vocabulary);

    let win = windows.get(scopeKey);
    if (!win) {
      win = { counts: new Map(), styleCounts: { humorous: 0, helpful: 0, acid: 0, affectionate: 0, neutral: 0 }, total: 0 };
      windows.set(scopeKey, win);
    }
    if (windows.size > maxScopes) windows.delete(windows.keys().next().value);

    win.total += 1;
    win.styleCounts[styleKey] += 1;
    for (const w of new Set(vocabulary)) win.counts.set(w, (win.counts.get(w) || 0) + 1);
    if (win.counts.size > 200) {
      const trimmed = [...win.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
      win.counts = new Map(trimmed);
    }

    const style = STYLE_MAP[Object.entries(win.styleCounts).sort((a, b) => b[1] - a[1])[0][0]];
    return { scopeKey, participants, topic: topicOf(win.counts, win.total), style };
  }

  function toIdentityInput(signal = {}) {
    return { voiceStyle: Array.isArray(signal.style) ? signal.style : [] };
  }

  return { observe, toIdentityInput };
}
