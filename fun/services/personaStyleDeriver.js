/**
 * Motor de Análise e Derivação de Estilo Linguístico da Persona.
 *
 * Responsável por:
 * - Tokenização avançada, normalização de risadas e remoção de ruídos.
 * - Extração de emojis recorrentes e cálculo de média móvel de comprimento.
 * - Amostragem inteligente e anônima de falas reais representativas do tom do grupo.
 * - Acumulação ponderada com decaimento exponencial temporal (half-life).
 */

const STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não',
  'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas',
  'ao', 'ele', 'das', 'à', 'seu', 'sua', 'ou', 'quando', 'muito', 'nos',
  'já', 'isso', 'também', 'só', 'pelo', 'pela', 'até', 'ela', 'entre',
  'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'quem', 'nas',
  'me', 'esse', 'eles', 'você', 'está', 'mas', 'foi', 'qual', 'tem',
  'the', 'and', 'for', 'are', 'you', 'bot', 'botao',
]);

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LAUGH_ONLY_RE = /^k+$/i;
const REPEAT_RE = /(.)\1{3,}/g;
const TONE_CMD_RE = /^\s*(?:[/!])/;
const TONE_URL_RE = /(?:https?:\/\/|www\.)/i;

/**
 * Normaliza um token individual colapsando repetições exageradas e risadas.
 */
export function normalizeToken(token) {
  const t = String(token || '');
  if (LAUGH_ONLY_RE.test(t)) return 'kkk';
  return t.replace(REPEAT_RE, '$1$1');
}

/**
 * Anonimiza menções e números de telefone em uma linha de texto.
 */
export function anonymizeLine(text) {
  return String(text || '')
    .replace(/@\d{5,}/g, '[nome]')
    .replace(/\b\d{10,}\b/g, '[nome]');
}

/**
 * Extrai tokens lexicais significativos de um texto.
 */
export function extractTokens(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(normalizeToken)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

/**
 * Extrai todos os emojis presentes em um texto.
 */
export function extractEmojis(text) {
  const matches = String(text || '').match(EMOJI_RE);
  return matches || [];
}

/**
 * Calcula uma pontuação de expressividade de tom para uma linha de mensagem.
 */
export function toneScore(line) {
  let score = 0;
  const len = line.length;
  if (len >= 6 && len <= 60) score += 1;
  if (/[!?…]/.test(line)) score += 1;
  if (/[aeiouàáâãéêíóôõú]/i.test(line)) score += 1;
  score += Math.min(2, (line.match(/\bk+\b/gi) || []).length);
  if (/[A-Z]{2,}/.test(line)) score += 1;
  return score;
}

/**
 * Identifica se uma linha é ruído para amostragem de tom.
 */
export function isNoiseToneLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  if (TONE_CMD_RE.test(trimmed)) return true;
  if (TONE_URL_RE.test(trimmed)) return true;
  if (/^[k\s!?.,]+$/i.test(trimmed)) return true;
  return false;
}

/**
 * Seleciona as melhores amostras anonimizadas de tom de mensagens do grupo.
 */
export function pickToneSamples(msgs, count = 4) {
  const seen = new Set();
  const candidates = [];
  for (const m of msgs) {
    const text = String(m?.text || '').trim();
    if (!text || seen.has(text) || isNoiseToneLine(text)) continue;
    seen.add(text);
    candidates.push({ text, userJid: String(m.userJid || ''), score: toneScore(text) });
  }
  candidates.sort((a, b) => b.score - a.score || (a.text < b.text ? -1 : 1));
  const chosen = [];
  const authors = new Set();
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (authors.has(c.userJid)) continue;
    authors.add(c.userJid);
    chosen.push(c);
  }
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.includes(c)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => anonymizeLine(c.text));
}

/**
 * Deriva estatisticamente o perfil de estilo do grupo aplicando decaimento exponencial.
 */
export function deriveGroupStyle({
  msgs = [],
  prevCounts = new Map(),
  prevAvgLen = 0,
  dtMs = 0,
  halfLifeMs = 86_400_000,
  topTokensCap = 30,
}) {
  const batchCounts = new Map();
  let totalLen = 0;
  const emojiCounts = new Map();

  for (const m of msgs) {
    const seenTokens = new Set(extractTokens(m.text));
    for (const tk of seenTokens) {
      batchCounts.set(tk, (batchCounts.get(tk) || 0) + 1);
    }
    totalLen += String(m.text).length;
    const em = extractEmojis(m.text);
    for (const e of em) {
      emojiCounts.set(e, (emojiCounts.get(e) || 0) + 1);
    }
  }

  const emojis = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([e, count]) => ({ emoji: e, count }));

  const batchAvgLen = msgs.length ? totalLen / msgs.length : 0;
  const styleLines = pickToneSamples(msgs);

  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const decay = dt <= 0 ? 1 : Math.exp(-dt / Math.max(60_000, halfLifeMs));

  const tokenCounts = new Map();
  for (const [tk, weight] of prevCounts.entries()) {
    const w2 = weight * decay;
    if (w2 > 0) tokenCounts.set(tk, w2);
  }

  // Só termos recorrentes (c >= 2) entram no estilo persistente
  for (const [tk, c] of batchCounts.entries()) {
    if (c < 2) continue;
    tokenCounts.set(tk, (tokenCounts.get(tk) || 0) + c);
  }

  const topTokens = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topTokensCap)
    .map(([w2]) => w2);

  const avgLen = prevAvgLen > 0
    ? decay * prevAvgLen + (1 - decay) * batchAvgLen
    : batchAvgLen;

  return {
    topTokens,
    emojis,
    avgLen,
    styleLines,
    tokenCounts,
  };
}
