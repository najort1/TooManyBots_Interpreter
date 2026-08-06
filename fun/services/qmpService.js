/**
 * Quem é Mais Provável? (QMP)
 * Perguntas LLM/fallback · votação por menção · ranking semanal.
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { recordLlmHit } from '../llm/llmMetrics.js';
import { getWeekKey } from '../db/funSocialRepository.js';

/** Normal / leve — zoação humana de grupo (few-shot real em vez de checklist de proibições). */
export const QMP_SYSTEM_PROMPT = `Você é aquele amigo do grupo de zap que sempre solta a pergunta certeira de "Quem é mais provável de...?". Digita rápido, com malícia boa, tipo conversa de bar — não como um redator de IA fazendo tarefa.

Cenas que já mandaram bem (não repita, é só pra pegar o clima):
- "Quem é mais provável de brigar com o GPS e parar no lugar errado por orgulho?"
- "Quem é mais provável de gastar o salário em 3 dias e postar 'mês difícil'?"
- "Quem é mais provável de fingir que leu a mensagem e responder 'kkk' genérico?"
- "Quem é mais provável de defender pizza com ketchup com PowerPoint?"
- "Quem é mais provável de reenviar figurinha feia 6 meses depois como se fosse nova?"
- "Quem é mais provável de sumir do grupo e voltar como se nada tivesse acontecido?"

O jogo é vida real: casa, trampo, grana, sono, comida, viagem, família, vaidade, preguiça, orgulho, mentira besta. Detalhe concreto > tema genérico. Pode ser maldoso leve e constrangedor.

Antes de mandar, pensa rápido em 3 ideias diferentes dentro de <think></think> (ninguém vê isso) e escolhe a mais engraçada e menos óbvia — não a primeira que vier.

Forma: uma linha em pt-BR começando com "Quem é mais provável de" (ou variação natural), 1–2 frases se ajudar a cena (máx. ~300 caracteres), sem aspas no bloco inteiro, sem numeração, sem meta tipo "aqui vai". Sem nomes de gente real de fora. Sem doxxing, sem menor em contexto sexual, sem incitar crime real.

Manda só a pergunta final, pronta pro zap.`;

/**
 * Pesada — vibe "Amigos de Merda": queima, constrange, gera caos — few-shot real em vez de checklist.
 */
export const QMP_HEAVY_SYSTEM_PROMPT = `Você é o amigo maldoso do grupo que solta a pergunta PESADA de "Quem é mais provável de...?" no estilo "Amigos de Merda" — a que silencia todo mundo por 2 segundos e depois explode em kkk. Voz de gente, não de IA fazendo tarefa.

Cenas que já queimaram bem (não repita, é só clima):
- "Quem é mais provável de mentir o salário pra impressionar e depois pedir um 'empresta 50'?"
- "Quem é mais provável de falar mal de todo mundo no grupo paralelo e agir de anjo no principal?"
- "Quem é mais provável de inventar doença pra faltar no trampo e postar story na praia no mesmo dia?"
- "Quem é mais provável de jurar que parou de beber e aparecer zicado no domingo de manhã?"
- "Quem é mais provável de sabotar o amigo no trampo com 'só uma brincadeira' e rir depois?"

Temas ricos: ego, dinheiro, hipocrisia, vício, mentira, fofoca cruel, sexo adulto implícito/explícito leve, usar gente, drama de amizade, trabalho, família tóxica, vaidade. Mostra o gesto + a desculpa ridícula, nunca o genérico ("ser babaca", "trair").

Antes de mandar, pensa rápido em 3 ideias diferentes dentro de <think></think> (ninguém vê isso) e escolhe a mais afiada e menos batida.

Forma: uma linha em pt-BR (pode ser 1–2 frases, máx. ~300 caracteres), começando de forma natural ("Quem é mais provável de…"), sem meta, sem lista, sem aspas no bloco inteiro, sem nomes de gente famosa. Sem doxxing, sem menor em contexto sexual, sem incitar crime violento real.

Só a pergunta final.`;

/** Fallback leve quando LLM offline. */
export const QMP_FALLBACK_PROMPTS = Object.freeze([
  'Quem é mais provável de chegar atrasado e culpar o trânsito inventado?',
  'Quem é mais provável de responder "tô chegando" a 40 minutos de distância?',
  'Quem é mais provável de dormir no call com o microfone aberto?',
  'Quem é mais provável de gastar o salário em 3 dias e postar "mês difícil"?',
  'Quem é mais provável de mandar áudio de 4 minutos pra dizer "ok"?',
  'Quem é mais provável de spoilar série sem aviso e rir depois?',
  'Quem é mais provável de sumir do grupo e voltar como se nada tivesse acontecido?',
  'Quem é mais provável de brigar com o GPS e parar no lugar errado por orgulho?',
  'Quem é mais provável de pedir desculpas pro boleto, não pra pessoa?',
  'Quem é mais provável de inventar "só mais um episódio" às 3h da manhã?',
  'Quem é mais provável de deixar o Wi-Fi do vizinho sem permissão?',
  'Quem é mais provável de reenviar figurinha feia 6 meses depois como se fosse nova?',
  'Quem é mais provável de esquecer o aniversário de todo mundo menos o próprio?',
  'Quem é mais provável de entrar em call e só aparecer o teto da câmera?',
  'Quem é mais provável de dizer "depois a gente vê" e nunca ver?',
  'Quem é mais provável de pechinchar no iFood e pedir sobremesa extra?',
  'Quem é mais provável de postar "acordei" às 14h com orgulho?',
  'Quem é mais provável de perder as chaves e culpar o universo?',
  'Quem é mais provável de zoar o outro e ficar vermelho quando devolvem?',
  'Quem é mais provável de fingir que leu a mensagem e responder "kkk" genérico?',
  'Quem é mais provável de levar o grupo pro caos com uma pergunta inocente?',
  'Quem é mais provável de defender pizza com ketchup com PowerPoint?',
  'Quem é mais provável de chegar na festa e ir embora em 20 minutos?',
  'Quem é mais provável de guardar print de vitória e esconder 40 derrotas?',
]);

/** Fallback pesado (offline) — Amigos de Merda, sem vício em "ex". */
export const QMP_HEAVY_FALLBACK_PROMPTS = Object.freeze([
  'Quem é mais provável de trair a confiança do grupo e ainda postar "amizades que a vida me deu"?',
  'Quem é mais provável de mentir o salário pra impressionar e depois pedir um "empresta 50"?',
  'Quem é mais provável de mandar nudes pro contato errado e culpar o iOS com cara de paisagem?',
  'Quem é mais provável de sumir depois de comer na sua casa e só voltar no aniversário?',
  'Quem é mais provável de falar mal de todo mundo no grupo paralelo e agir de anjo no principal?',
  'Quem é mais provável de dar ghosting em amizade e reaparecer 8 meses depois com "sumido(a)"?',
  'Quem é mais provável de beijar alguém na festa e no dia seguinte fingir amnésia seletiva?',
  'Quem é mais provável de devassar o celular do parceiro "só por precaução" e achar pior ainda?',
  'Quem é mais provável de inventar doença pra faltar no trampo e postar story na praia no mesmo dia?',
  'Quem é mais provável de ficar com dois da mesma panelinha no mesmo mês e achar que ninguém nota?',
  'Quem é mais provável de gastar o dinheiro do boleto no rolê e pedir emprestado com drama?',
  'Quem é mais provável de espalhar fofoca e quando perguntarem jurar "eu? jamais"?',
  'Quem é mais provável de jurar que parou de beber e aparecer zicado no domingo de manhã?',
  'Quem é mais provável de usar o amigo só de motorista e sumir na hora de ratear a conta?',
  'Quem é mais provável de fingir que tá bem de grana e viver no limite do cartão com story de restaurante?',
  'Quem é mais provável de sabotar o amigo no trampo com "só uma brincadeira" e rir depois?',
]);

const RANK_SUBS = new Set(['rank', 'ranking', 'top', 'semana', 'weekly', 'lider']);
const CLOSE_SUBS = new Set(['fechar', 'close', 'encerrar', 'fim', 'result', 'resultado']);
const HISTORY_SUBS = new Set([
  'historico',
  'historicos',
  'history',
  'hist',
  'log',
  'passado',
  'ultimas',
  'last',
]);
const HEAVY_SUBS = new Set([
  'pesada',
  'pesado',
  'heavy',
  'spicy',
  'amigosdemerda',
  'merda',
  'quente',
]);
const LIGHT_SUBS = new Set(['leve', 'normal', 'safe', 'light']);

/** Motivos monótonos — bloquear se já saiu no anti-eco (e "ex" em modo normal). */
const HOOK_PATTERNS = Object.freeze([
  { id: 'chegando', re: /t[oô]\s*chegando|chegando.*chuveiro|chegando.*cama|chegando.*pijama|t[oô]\s*saindo/i },
  { id: 'wifi', re: /wi-?fi|wifi/i },
  { id: 'bomdia', re: /bom\s*dia/i },
  { id: 'bar_conta', re: /conta\s+no\s+bar|pedir\s+a\s+conta|rodada/i },
  { id: 'grupo_paralelo', re: /grupo\s+paralelo|fofocar\s+do\s+grupo/i },
  { id: 'audio', re: /[aá]udio\s+de\s+\d|mandar\s+[aá]udio/i },
  { id: 'spoiler', re: /spoiler/i },
  { id: 'ghost', re: /ghost|sumir\s+do\s+grupo|sumiu/i },
  { id: 'trair', re: /trair|trai[cç][aã]o|corno/i },
  { id: 'nudes', re: /nudes?|pack|foto\s+sem\s+roupa/i },
  { id: 'ex', re: /\bex\b|ex-namor|ex namor|story do ex|ligar\s+(pro|para\s+o)\s+ex|curtir.*ex/i },
  { id: 'crush_stalk', re: /stalkear\s+(o\s+)?crush|curtir\s+foto\s+de\s+20\d\d|foi\s+mal,?\s*caiu/i },
  { id: 'salario', re: /sal[aá]rio|boleto|emprestado/i },
  { id: 'uber_pix', re: /pix\s+do\s+uber|pedir\s+o\s+pix/i },
  { id: 'geladeira', re: /geladeira/i },
]);

/** Tema "ex/crush stalk" batido — rejeita no invent normal. */
export function isMonotoneExTheme(text) {
  const s = String(text || '');
  if (/\bex\b|ex-namor|ex namor|story do ex|ligar\s+(pro|para\s+o)\s+ex/i.test(s)) return true;
  if (/stalkear\s+(o\s+)?(crush|ex)|curtir\s+foto\s+de\s+20\d\d/i.test(s)) return true;
  return false;
}

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pick(arr, random) {
  if (!arr?.length) return null;
  const i = Math.floor((random() || 0) * arr.length) % arr.length;
  return arr[i];
}

/**
 * Limpa saída do LLM para uma linha de pergunta QMP.
 */
export function sanitizeQmpPrompt(raw, maxLen = 300) {
  let s = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    // <think> sem fechamento (cortado por maxTokens) — descarta tudo a partir dali,
    // em vez de deixar o brainstorm interno vazar pro grupo.
    .replace(/<think>[\s\S]*$/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    .trim();

  s = s
    .replace(/^(claro[!.,]?\s*|aqui vai[:\s]*|pergunta[:\s]*)/i, '')
    .trim();

  // até 2 linhas úteis (pergunta longa com cena)
  const lines = s
    .split('\n')
    .map((l) => l.replace(/^\s*[\d]+[.)\-]\s*/, '').trim())
    .filter((l) => l.length >= 8);
  if (lines.length >= 2 && lines[0].length + lines[1].length < (Number(maxLen) || 300)) {
    s = `${lines[0]} ${lines[1]}`.replace(/\s+/g, ' ').trim();
  } else {
    s = (lines[0] || s).replace(/\s+/g, ' ').trim();
  }

  if (!s || s.length < 12) return '';
  if (/\b(I need|as an AI|thinking)\b/i.test(s) && s.length < 80) return '';

  const max = Math.max(40, Math.min(300, Math.floor(Number(maxLen) || 300)));
  if (s.length > max) {
    const cut = s.slice(0, max);
    const sp = Math.max(cut.lastIndexOf('?'), cut.lastIndexOf('. '), cut.lastIndexOf(' '), cut.lastIndexOf(','));
    s = sp > max * 0.55 ? cut.slice(0, sp + (cut[sp] === '?' ? 1 : 0)).trim() : `${cut.trim()}…`;
  }

  // garante tom de pergunta se o modelo esqueceu
  if (!/[?？]$/.test(s) && !/^quem\b/i.test(s)) {
    s = `Quem é mais provável de ${s.replace(/^de\s+/i, '')}?`;
  } else if (!/[?？]$/.test(s)) {
    s = `${s}?`;
  }

  return s.slice(0, max);
}

/**
 * Monta prompt a partir de descrição custom ("pular aula" → "Quem é mais provável de pular aula?").
 */
export function buildCustomPrompt(description, maxLen = 140) {
  let d = String(description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!d) return '';

  // remove prefixos acidentais
  d = d
    .replace(/^quem\s+(e|é)\s+mais\s+provavel( de)?\s*/i, '')
    .replace(/^mais\s+provavel( de)?\s*/i, '')
    .trim();

  if (!d) return '';

  let prompt = /^quem\b/i.test(d)
    ? d
    : `Quem é mais provável de ${d.replace(/^de\s+/i, '')}`;

  if (!/[?？]$/.test(prompt)) prompt = `${prompt}?`;
  return sanitizeQmpPrompt(prompt, maxLen);
}

export function parseQmpSubcommand(args = []) {
  const list = Array.isArray(args) ? args.map((a) => String(a || '').trim()).filter(Boolean) : [];
  if (!list.length) return { kind: 'random', rest: [] };

  const head = list[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');

  if (RANK_SUBS.has(head)) return { kind: 'rank', rest: list.slice(1) };
  if (CLOSE_SUBS.has(head)) return { kind: 'close', rest: list.slice(1) };
  if (HISTORY_SUBS.has(head)) return { kind: 'history', rest: list.slice(1) };
  if (HEAVY_SUBS.has(head)) return { kind: 'heavy', rest: list.slice(1) };
  if (LIGHT_SUBS.has(head)) return { kind: 'light', rest: list.slice(1) };
  return { kind: 'custom', rest: list };
}

/** Normaliza texto pra comparar eco. */
export function normalizeQmpKey(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/quem e mais provavel de\s*/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text) {
  return new Set(
    normalizeQmpKey(text)
      .split(' ')
      .filter((w) => w.length > 3)
  );
}

/**
 * Similaridade 0..1 por tokens compartilhados (anti-eco).
 */
export function qmpOverlapScore(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

export function extractQmpHooks(text) {
  const hits = [];
  for (const h of HOOK_PATTERNS) {
    if (h.re.test(String(text || ''))) hits.push(h.id);
  }
  return hits;
}

/**
 * true se a pergunta nova ecoa demais o histórico.
 */
export function isQmpEcho(candidate, recent = [], { maxOverlap = 0.42 } = {}) {
  const c = String(candidate || '').trim();
  if (!c) return true;
  const cKey = normalizeQmpKey(c);
  const cHooks = new Set(extractQmpHooks(c));

  for (const prev of recent || []) {
    const p = String(prev || '').trim();
    if (!p) continue;
    if (normalizeQmpKey(p) === cKey) return true;
    if (qmpOverlapScore(c, p) >= maxOverlap) return true;
    // mesmo gancho temático recente (tô chegando / wifi / etc.)
    if (cHooks.size) {
      const pHooks = extractQmpHooks(p);
      if (pHooks.some((h) => cHooks.has(h))) return true;
    }
  }
  return false;
}

/**
 * Decide tom: a cada `heavyEvery` rodadas (padrão 5 = 4 normais + 1 pesada).
 * @param {number} existingCount — perguntas já gravadas no escopo
 * @param {number} heavyEvery
 * @param {'normal'|'heavy'|null} forceTone
 */
export function resolveQmpTone(existingCount, heavyEvery = 5, forceTone = null) {
  if (forceTone === 'heavy' || forceTone === 'normal') return forceTone;
  const every = Math.max(2, Math.floor(Number(heavyEvery) || 5));
  // 1ª pergunta = normal; a cada N-ésima (5, 10, 15…) = heavy
  const nextIndex = Math.max(0, Math.floor(Number(existingCount) || 0)) + 1;
  return nextIndex % every === 0 ? 'heavy' : 'normal';
}

export function createQmpService({
  qmpRepository,
  profileService = null,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
  random = Math.random,
  getLogger = () => null,
} = {}) {
  function opts(funConfig = {}) {
    const envChance = process.env.QMP_AUTO_TRIGGER_CHANCE;
    const chanceFromEnv =
      envChance != null && envChance !== '' && Number.isFinite(Number(envChance))
        ? Number(envChance)
        : null;

    return {
      enabled: funConfig.qmpEnabled !== false,
      autoChance:
        chanceFromEnv != null
          ? Math.min(1, Math.max(0, chanceFromEnv))
          : Math.min(1, Math.max(0, numOr(funConfig.qmpAutoTriggerChance, 0.02))),
      autoCooldownMs: Math.max(0, Math.floor(numOr(funConfig.qmpAutoTriggerCooldownMs, 30 * 60_000))),
      roundDurationMs: Math.max(60_000, Math.floor(numOr(funConfig.qmpRoundDurationMs, 10 * 60_000))),
      cooldownMs: Math.max(0, Math.floor(numOr(funConfig.qmpCooldownMs, 45_000))),
      maxPromptLen: Math.max(40, Math.min(300, Math.floor(numOr(funConfig.qmpMaxPromptLen, 300)))),
      rankLimit: Math.max(3, Math.min(50, Math.floor(numOr(funConfig.qmpRankLimit, 10)))),
      historyLimit: Math.max(3, Math.min(20, Math.floor(numOr(funConfig.qmpHistoryLimit, 8)))),
      /** 1 pesada a cada N rodadas (5 = 4 normais + 1 pesada). */
      heavyEvery: Math.max(2, Math.min(20, Math.floor(numOr(funConfig.qmpHeavyEvery, 5)))),
      heavyEnabled: funConfig.qmpHeavyEnabled !== false,
      antiEchoLimit: Math.max(4, Math.min(40, Math.floor(numOr(funConfig.qmpAntiEchoLimit, 12)))),
      antiEchoMaxOverlap: Number.isFinite(Number(funConfig.qmpAntiEchoMaxOverlap))
        ? Math.min(0.9, Math.max(0.2, Number(funConfig.qmpAntiEchoMaxOverlap)))
        : 0.42,
      inventRetries: Math.max(1, Math.min(8, Math.floor(numOr(funConfig.qmpInventRetries, 4)))),
      ...resolveZenTaskParams('qmp', funConfig),
      /** Override explícito por task; vazio mantém o modelo Zen global. */
      zenModel: String(funConfig.qmpZenModel || '').trim(),
    };
  }

  function zenOn(cfg) {
    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return false;
    return cfg.zenEnabled !== false;
  }

  function ollamaOn(cfg) {
    // Ollama descontinuado como fallback — Zen cai direto em template mockado.
    return false;
  }

  function fallbackPrompt(tone = 'normal', recent = []) {
    const pool =
      tone === 'heavy' ? QMP_HEAVY_FALLBACK_PROMPTS : QMP_FALLBACK_PROMPTS;
    const fresh = pool.filter((p) => !isQmpEcho(p, recent, { maxOverlap: 0.35 }));
    const list = fresh.length ? fresh : pool;
    return pick(list, random) || list[0];
  }

  function buildCastBlock(scopeKey, participantJids = []) {
    if (!profileService?.displayName || !scopeKey) return '';
    const members = [...new Set(
      (Array.isArray(participantJids) ? participantJids : [])
        .map((jid) => String(jid || '').trim())
        .filter(Boolean)
    )];
    if (!members.length) return '';

    const listed = members.slice(0, 15).map((jid) => profileService.displayName(jid, scopeKey));
    const overflow = members.length - listed.length;
    return [
      '<cast>',
      `Elenco ativo do grupo: ${listed.join(', ')}${overflow > 0 ? ` (+${overflow} outros)` : ''}.`,
      'Use só como referência de convivência; não cite nomes na pergunta nem invente fatos sobre alguém.',
      '</cast>',
    ].join('\n');
  }

  function buildInventUserPrompt({ tone, recent, maxChars, scopeKey = '', participantJids = [] }) {
    const example = fallbackPrompt(tone, recent);
    const recentBlock =
      recent?.length > 0
        ? [
            'ANTI-ECO — NÃO repita estas perguntas nem o mesmo gancho/tema:',
            ...recent.slice(0, 12).map((p, i) => `${i + 1}. ${p}`),
            'Mude de universo (casa/trampo/dinheiro/vaidade/preguiça/amizade — não o mesmo loop).',
          ].join('\n')
        : 'Sem histórico ainda — invente com detalhe de vida real.';
    const castBlock = buildCastBlock(scopeKey, participantJids);
    const intro = tone === 'heavy'
      ? 'Bora, modo PESADO agora: solta a pergunta que queima o grupo com cena bem humana.'
      : 'Bora, solta UMA pergunta de "Quem é mais provável?" agora, no clima de sempre.';

    return [
      intro,
      `Até ${maxChars} caracteres. Pode ser 1–2 frases. Lembra do brainstorm de 3 e escolhe a melhor. Só a pergunta.`,
      `Clima parecido com (não repita): ${example}`,
      '',
      recentBlock,
      castBlock ? `\n${castBlock}` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * @param {object} funConfig
   * @param {{ scopeKey?: string, tone?: 'normal'|'heavy', recentPrompts?: string[], participantJids?: string[] }} [ctx]
   */
  async function inventPrompt(funConfig = {}, ctx = {}) {
    const o = opts(funConfig);
    const tone = ctx.tone === 'heavy' ? 'heavy' : 'normal';
    const system = tone === 'heavy' ? QMP_HEAVY_SYSTEM_PROMPT : QMP_SYSTEM_PROMPT;
    const recent =
      Array.isArray(ctx.recentPrompts) && ctx.recentPrompts.length
        ? ctx.recentPrompts
        : ctx.scopeKey && qmpRepository?.listRecentPrompts
          ? qmpRepository.listRecentPrompts(ctx.scopeKey, o.antiEchoLimit)
          : [];

    const echoOpts = { maxOverlap: o.antiEchoMaxOverlap };
    let lastClean = '';
    let lastProvider = 'template';

    const tryClean = (raw, provider) => {
      const clean = sanitizeQmpPrompt(raw, o.maxPromptLen);
      if (!clean) return null;
      if (isQmpEcho(clean, recent, echoOpts)) return null;
      // modo normal: barra obsessão em "ex"/crush stalk (monotonia de IA)
      if (tone !== 'heavy' && isMonotoneExTheme(clean)) return null;
      // pesada: ainda evita se o histórico já usou "ex"
      if (
        tone === 'heavy' &&
        isMonotoneExTheme(clean) &&
        (recent || []).some((p) => isMonotoneExTheme(p))
      ) {
        return null;
      }
      return { prompt: clean, provider, tone };
    };

    for (let attempt = 0; attempt < o.inventRetries; attempt += 1) {
      const userPrompt = buildInventUserPrompt({
        tone,
        recent: [
          ...recent,
          // se já gerou eco nesta sessão de invent, evita de novo
          ...(lastClean ? [lastClean] : []),
        ],
        maxChars: o.maxPromptLen,
        scopeKey: ctx.scopeKey,
        participantJids: ctx.participantJids,
      });
      // segunda tentativa: temperatura um pouco maior via prompt nudge
      const nudge =
        attempt > 0
          ? '\n\nA anterior foi rejeitada (eco ou tema batido tipo ex/crush). Mude TOTAL o universo — cena nova, sem "ex".'
          : '';

      if (zenOn(funConfig)) {
        try {
          const ep = resolveZenEndpoint(funConfig);
          const raw = await generateZen({
            baseUrl: ep.baseUrl,
            model: o.zenModel || ep.model,
            system,
            prompt: userPrompt + nudge,
            timeoutMs: o.timeoutMs,
            maxTokens: o.maxTokens,
            temperature: Math.min(1.3, o.temperature + attempt * 0.08),
            apiKey: ep.apiKey,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          const hit = tryClean(raw, 'zen');
          if (hit) {
            recordLlmHit('qmp', 'zen', { tone, attempt });
            return hit;
          }
          lastClean = sanitizeQmpPrompt(raw, o.maxPromptLen) || lastClean;
          lastProvider = 'zen';
        } catch (err) {
          try {
            getLogger?.()?.warn?.({ err: err?.message, tone }, 'Fun QMP zen fail');
          } catch {
            // ignore
          }
        }
      }

      // Ollama descontinuado como fallback — não tenta mais.
    }

    // fallback template sem eco
    const fb = fallbackPrompt(tone, recent);
    recordLlmHit('qmp', 'template', { tone });
    return { prompt: fb, provider: 'template', tone, echoRejected: Boolean(lastClean) };
  }

  function ensureExpiredClosed(scopeKey, now = Date.now()) {
    if (!qmpRepository?.closeExpired) return [];
    return qmpRepository.closeExpired(scopeKey, now);
  }

  /**
   * Inicia rodada (manual ou auto).
   */
  async function startRound({
    scopeKey,
    userJid = '',
    customText = '',
    source = 'llm',
    funConfig = {},
    now = Date.now(),
    force = false,
    /** @type {'normal'|'heavy'|null} */
    forceTone = null,
    participantJids = [],
    getParticipantJids = null,
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (!scopeKey) return { ok: false, reason: 'no-scope' };

    ensureExpiredClosed(scopeKey, now);

    const active = qmpRepository.getActiveQuestion(scopeKey, now);
    if (active && !force) {
      return {
        ok: false,
        reason: 'active-exists',
        question: active,
        voteCount: qmpRepository.countVotes(active.id),
      };
    }
    if (active && force) {
      qmpRepository.closeQuestion(active.id, now);
    }

    const existingCount = qmpRepository.countQuestions?.(scopeKey) || 0;
    const tone = o.heavyEnabled
      ? resolveQmpTone(existingCount, o.heavyEvery, forceTone)
      : forceTone === 'heavy'
        ? 'heavy'
        : 'normal';

    let prompt = '';
    let provider = source;
    if (customText) {
      prompt = buildCustomPrompt(customText, o.maxPromptLen);
      if (!prompt) return { ok: false, reason: 'empty-prompt' };
      provider = 'custom';
    } else {
      let cast = participantJids;
      if (typeof getParticipantJids === 'function') {
        try {
          cast = await getParticipantJids();
        } catch {
          // Elenco é contexto opcional; não bloqueia a rodada.
        }
      }
      const invented = await inventPrompt(funConfig, { scopeKey, tone, participantJids: cast });
      prompt = invented.prompt;
      provider = invented.provider === 'template' ? 'fallback' : invented.provider;
      if (source === 'auto') provider = 'auto';
    }

    const expiresAt = now + o.roundDurationMs;
    const question = qmpRepository.createQuestion({
      scopeKey,
      prompt,
      source: source === 'auto' ? 'auto' : provider === 'custom' ? 'custom' : provider,
      tone,
      createdBy: userJid || '',
      expiresAt,
      now,
      weekKey: getWeekKey(now),
    });

    if (source === 'auto') {
      qmpRepository.touchAuto?.(scopeKey, now);
    }

    return {
      ok: true,
      question,
      provider: source === 'auto' ? 'auto' : provider,
      tone,
      expiresAt,
    };
  }

  function castVote({
    scopeKey,
    voterJid,
    targetJid,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (!scopeKey || !voterJid || !targetJid) return { ok: false, reason: 'invalid' };

    ensureExpiredClosed(scopeKey, now);
    const active = qmpRepository.getActiveQuestion(scopeKey, now);
    if (!active) return { ok: false, reason: 'no-active' };

    const result = qmpRepository.registerVote({
      questionId: active.id,
      scopeKey,
      voterJid,
      targetJid,
      weekKey: active.weekKey || getWeekKey(now),
      now,
    });

    if (!result.ok) return result;

    return {
      ok: true,
      question: active,
      vote: result.vote,
      voteCount: qmpRepository.countVotes(active.id),
      tally: qmpRepository.tallyQuestion(active.id),
    };
  }

  function closeRound({ scopeKey, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    ensureExpiredClosed(scopeKey, now);
    // tenta active ainda válido OU recém-expirado (último id fechado)
    let question = qmpRepository.getActiveQuestion(scopeKey, now);
    if (!question) {
      // pega a última pergunta do escopo (fechada ou não)
      // via tally — se não houver active, não fecha
      return { ok: false, reason: 'no-active' };
    }

    question = qmpRepository.closeQuestion(question.id, now);
    const tally = qmpRepository.tallyQuestion(question.id);
    return {
      ok: true,
      question,
      tally,
      totalVotes: tally.reduce((s, r) => s + (r.votes || 0), 0),
    };
  }

  /**
   * Fecha se expirou e devolve resultado pra anunciar (lazy close).
   */
  function harvestExpired(scopeKey, now = Date.now()) {
    const before = qmpRepository.getActiveQuestion?.(scopeKey, now - 1);
    // closeExpired fecha os que já passaram; precisamos do que expirou agora
    // Estratégia: buscar active "falso" — status active mas expires_at <= now
    const closedIds = ensureExpiredClosed(scopeKey, now);
    if (!closedIds.length) return null;

    const id = closedIds[closedIds.length - 1];
    const question = qmpRepository.getQuestionById(id);
    if (!question) return null;
    const tally = qmpRepository.tallyQuestion(id);
    return {
      question,
      tally,
      totalVotes: tally.reduce((s, r) => s + (r.votes || 0), 0),
      wasActive: Boolean(before),
    };
  }

  function getWeeklyRank({ scopeKey, userJid = '', funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    const weekKey = getWeekKey(now);
    const entries = qmpRepository.weeklyLeaderboard(scopeKey, weekKey, o.rankLimit);
    const position = userJid
      ? qmpRepository.getUserWeekRank(scopeKey, userJid, weekKey)
      : { rank: null, total: entries.length, votes: 0 };
    return { weekKey, entries, position, limit: o.rankLimit };
  }

  /**
   * Histórico de rodadas fechadas com ganhador.
   */
  function getHistory({ scopeKey, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled', rounds: [], limit: o.historyLimit };
    ensureExpiredClosed(scopeKey, now);
    const rounds = qmpRepository.listRecentRounds?.(scopeKey, o.historyLimit) || [];
    return { ok: true, rounds, limit: o.historyLimit };
  }

  function formatHistoryRelative(ts, now = Date.now()) {
    const t = Number(ts) || 0;
    if (t <= 0) return '';
    const diff = Math.max(0, now - t);
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 48) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d}d`;
  }

  function formatHistory({ rounds = [], limit = 8, nameOf, now = Date.now() } = {}) {
    const lines = [
      '📜 *Histórico QMP*',
      `Últimas ${limit} rodadas · pergunta + ganhador`,
      '',
    ];

    if (!rounds.length) {
      lines.push('Ainda sem rodadas fechadas.');
      lines.push('Use `/qmp` e depois `/qmp fechar` (ou espera o tempo acabar).');
      return lines.join('\n');
    }

    rounds.forEach((round, idx) => {
      const q = round.question || {};
      const prompt = String(q.prompt || '…').trim();
      const when = formatHistoryRelative(q.closedAt || q.createdAt, now);
      lines.push(`*${idx + 1}.* ${prompt}`);
      if (!round.winnerJid || !round.totalVotes) {
        lines.push(when ? `   _sem votos_ · ${when}` : '   _sem votos_');
      } else {
        const winner =
          typeof nameOf === 'function' ? nameOf(round.winnerJid) : round.winnerJid;
        const detail = `👑 ${winner} · *${round.winnerVotes}* de ${round.totalVotes}`;
        lines.push(when ? `   ${detail} · ${when}` : `   ${detail}`);
      }
      if (idx < rounds.length - 1) lines.push('');
    });

    lines.push('', `_Semana: /qmp rank_`);
    return lines.join('\n');
  }

  /**
   * Chance de auto-disparo em mensagem normal do grupo.
   */
  async function tryAutoTrigger({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    participantJids = [],
    getParticipantJids = null,
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (!scopeKey) return { ok: false, reason: 'no-scope' };
    if (o.autoChance <= 0) return { ok: false, reason: 'chance-zero' };

    ensureExpiredClosed(scopeKey, now);
    if (qmpRepository.getActiveQuestion(scopeKey, now)) {
      return { ok: false, reason: 'active-exists' };
    }

    const meta = qmpRepository.getMeta(scopeKey);
    if (meta.lastAutoAt > 0 && now - meta.lastAutoAt < o.autoCooldownMs) {
      return { ok: false, reason: 'auto-cooldown' };
    }

    if (random() >= o.autoChance) {
      return { ok: false, reason: 'no-roll' };
    }

    return startRound({
      scopeKey,
      source: 'auto',
      funConfig,
      now,
      participantJids,
      getParticipantJids,
    });
  }

  function formatQuestionAnnouncement(question, { voteCount = 0, auto = false } = {}) {
    if (!question) return '';
    const mins = Math.max(
      1,
      Math.round(Math.max(0, (question.expiresAt || 0) - (question.createdAt || Date.now())) / 60_000)
    );
    const heavy = question.tone === 'heavy';
    const title = heavy
      ? auto
        ? '🔥 *QMP PESADA* (surpresa) · modo Amigos de Merda'
        : '🔥 *QMP PESADA* · modo Amigos de Merda'
      : auto
        ? '🎲 *Quem é Mais Provável?* (surpresa)'
        : '🎲 *Quem é Mais Provável?*';
    const lines = [
      title,
      '',
      `*${question.prompt}*`,
      '',
      'Mencione *uma pessoa* no grupo pra votar.',
      `Ou: \`/qmp @pessoa\``,
      `Tempo: ~${mins} min · votos: ${voteCount}`,
      '',
      `_Ranking: /qmp rank · histórico: /qmp historico_`,
    ];
    if (!heavy) lines.push(`_Forçar pesada: /qmp pesada_`);
    return lines.join('\n');
  }

  function formatVoteConfirm({ voterLabel, targetLabel, voteCount, question }) {
    return [
      `✅ ${voterLabel} votou em ${targetLabel}`,
      question?.prompt ? `_${question.prompt}_` : null,
      `Votos nesta rodada: *${voteCount}*`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function formatRoundResult({ question, tally, totalVotes, nameOf }) {
    const lines = [
      '🏁 *Rodada QMP encerrada*',
      question?.prompt ? `*${question.prompt}*` : null,
      '',
    ].filter(Boolean);

    if (!tally?.length) {
      lines.push('Ninguém votou desta vez. Covardia coletiva.');
      return lines.join('\n');
    }

    lines.push(`Total: *${totalVotes || tally.reduce((s, r) => s + r.votes, 0)}* voto(s)`);
    lines.push('');
    for (const row of tally.slice(0, 5)) {
      const medal =
        row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `${row.rank}.`;
      const label = typeof nameOf === 'function' ? nameOf(row.userJid) : row.userJid;
      lines.push(`${medal} ${label} — *${row.votes}*`);
    }
    if (tally[0]) {
      const top = typeof nameOf === 'function' ? nameOf(tally[0].userJid) : tally[0].userJid;
      lines.push('');
      lines.push(`👑 Mais votado(a): *${top}*`);
    }
    lines.push('', `_Semana: /qmp rank · histórico: /qmp historico_`);
    return lines.join('\n');
  }

  function formatWeeklyRankText({ entries, position, weekKey, limit, nameOf }) {
    const lines = [
      '📊 *QMP — Mais Provável da semana*',
      `Semana \`${weekKey}\` · top ${limit}`,
      '',
    ];

    if (!entries?.length) {
      lines.push('Ainda sem votos esta semana.');
      lines.push('Use `/qmp` e marque alguém!');
      return lines.join('\n');
    }

    for (const row of entries) {
      const medal =
        row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `${row.rank}.`;
      const label = typeof nameOf === 'function' ? nameOf(row.userJid) : row.userJid;
      lines.push(`${medal} ${label} — *${row.votes}* voto(s)`);
    }

    if (entries[0]) {
      const crown = typeof nameOf === 'function' ? nameOf(entries[0].userJid) : entries[0].userJid;
      lines.push('');
      lines.push(`👑 *Mais Provável da semana:* ${crown}`);
    }

    if (position?.rank != null) {
      lines.push('');
      lines.push(
        `Sua posição: *#${position.rank}*${position.total ? `/${position.total}` : ''} · ${position.votes} voto(s)`
      );
    }

    return lines.join('\n');
  }

  return {
    opts,
    inventPrompt,
    startRound,
    castVote,
    closeRound,
    harvestExpired,
    getWeeklyRank,
    getHistory,
    tryAutoTrigger,
    ensureExpiredClosed,
    formatQuestionAnnouncement,
    formatVoteConfirm,
    formatRoundResult,
    formatWeeklyRankText,
    formatHistory,
    sanitizeQmpPrompt,
    buildCustomPrompt,
    parseQmpSubcommand,
    resolveQmpTone,
    isQmpEcho,
    isMonotoneExTheme,
    qmpOverlapScore,
    getWeekKey,
  };
}