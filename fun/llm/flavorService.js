import { ollamaGenerate } from './ollamaClient.js';

const SYSTEM_PROMPT = `Você é o narrador de um bot de diversão de WhatsApp em português brasileiro (pt-BR).
Escreva UMA frase curta (máximo 140 caracteres), tom de grupo: irônico, leve, brincalhão.
Regras rígidas:
- NÃO invente números, coins, XP, vencedores, resultados ou regras de jogo.
- NÃO use markdown, hashtags nem listas.
- NÃO coloque aspas no início e no fim.
- No máximo 2 emojis.
- Responda somente com a frase, nada mais.`;

/** Fallbacks estáticos — sempre seguros se Ollama falhar. */
const FALLBACKS = {
  faction_create: (v) =>
    pick([
      `A panelinha *${v.name || 'nova'}* agora é oficial.`,
      `Registro feito. *${v.name || 'Eles'}* vão se arrepender… ou não.`,
      `Facção no papel. O drama começa agora.`,
    ]),
  faction_join: (v) =>
    pick([
      `*${v.user || 'Alguém'}* entrou no *${v.name || 'time'}*. Bem-vindo ao caos.`,
      `Mais um no *${v.name || 'clã'}*. A ponte social agradece.`,
      `Membro novo no *${v.name || 'grupo'}*. Contém emoções.`,
    ]),
  faction_leave: (v) =>
    pick([
      `*${v.user || 'Alguém'}* largou o *${v.name || 'barco'}*. Portas batendo.`,
      `Saída confirmada de *${v.name || 'facção'}*. Drama level up.`,
      v.dissolved
        ? `Fim de *${v.name || 'facção'}* — ninguém restou no barco.`
        : `*${v.user || 'Alguém'}* saiu. A panelinha segue sem ele(a).`,
    ]),
  mission_spawn: () =>
    pick([
      'Squad misto montado. Cooperem ou virem meme.',
      'Operação Mistura no ar — facções diferentes, um prêmio só.',
      'Missão aberta. Daily, aposta e ship: meta do squad.',
    ]),
  event_start: (v) =>
    pick([
      `Trégua falsa por ~${v.minutes || '?'} min. Cross-facção paga melhor.`,
      'Evento no ar: isolar a panelinha é perder o meta.',
      'Janela cross-facção aberta. Saiam da bolha.',
    ]),
  marry_propose: (v) =>
    pick([
      `*${v.me || 'Alguém'}* se declarou pra *${v.other || 'alguém'}*. Coração na mão.`,
      'Pedido enviado. Agora é com a outra pessoa… e o chat.',
      'Anel no ar. Aceitar ou recusar — o grupo está de olho.',
    ]),
  marry_accept: (v) =>
    pick([
      `*${v.a || 'A'}* e *${v.b || 'B'}* oficiais. Parabéns (e boa sorte).`,
      'Casamento confirmado. O grupo já está shippando o divórcio? Não.',
      'Alianças digitais seladas. Que o daily continue juntos.',
    ]),
  marry_mutual: (v) =>
    pick([
      `Pedido mútuo! *${v.a || 'A'}* e *${v.b || 'B'}* se acharam no chat.`,
      'Dois pedidos se cruzaram. Casamento instantâneo.',
    ]),
  job_done: (v) =>
    pick([
      v.flavor
        ? `Trabalho: ${v.flavor}. Pago e suado.`
        : 'Mais um expediente no chat. Coins no bolso.',
      'Farm honesto (ou quase). Até o próximo turno.',
    ]),
  flip_win: () =>
    pick(['A moeda te amou hoje.', 'Sorte rara no grupo — aproveita.', 'Cara ou coroa? Acertou. Clima de lenda.']),
  flip_lose: () =>
    pick(['A moeda te traiu. Clássico.', 'Não era o lado. Tenta de novo depois.', 'Errou o lado — o chat ri por você.']),
  bet_result: (v) =>
    pick([
      v.winner
        ? `*${v.winner}* ficou com o pot. *${v.loser || 'O outro'}* paga o mico.`
        : 'Aposta resolvida. Um ri, outro atualiza o saldo.',
      'PvP de moeda encerrado. Drama entregue.',
    ]),
  ship: (v) => {
    const p = Number(v.percent) || 0;
    if (p >= 80) {
      return pick(['Química absurda. O chat já está fazendo fanfic.', 'Ship alto. Alguém já pediu o marry?']);
    }
    if (p >= 50) {
      return pick(['Tem potencial. Falta um daily juntos.', 'Meio a meio — ainda dá pra forçar o destino.']);
    }
    return pick(['Ship gelado. Talvez só amizade… ou rivalidade.', 'Percentual tímido. O universo disse “hmm”.']);
  },
  lucky_hit: () => pick(['Sorte batendo na porta. Raro e gostoso.', 'RNG te beijou na testa.']),
  lucky_miss: () => pick(['Azar puro. O universo tirou férias.', 'Saiu nada. Amanhã é outro dia (ou em 3h).']),
  level_up: (v) =>
    pick([
      `Level *${v.level || '?'}*! O rank já tremeu um pouco.`,
      'Subiu de nível. XP bem gasto no chat.',
    ]),
  default: () => 'O chat reage em silêncio… por enquanto.',
};

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) return FALLBACKS.default();
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

function sanitizeFlavor(raw, maxLen = 160) {
  let s = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)[0] || '';

  // remove cercas de aspas comuns
  s = s.replace(/^["'“”«»]+|["'“”«»]+$/g, '').trim();
  // tira prefixos tipo "Narrador:"
  s = s.replace(/^(narrador|bot|assistente)\s*:\s*/i, '').trim();
  // evita respostas que tentam ditar regras/números longos
  if (/^\d+$/.test(s)) return '';
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1).trim()}…`;
  return s;
}

function buildUserPrompt(scenario, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  const facts = Object.entries(v)
    .filter(([, val]) => val != null && String(val).trim() !== '')
    .map(([k, val]) => `${k}=${String(val).slice(0, 80)}`)
    .join('; ');

  const scenarioHints = {
    faction_create: 'Celebre a criação de uma facção/panelinha no grupo.',
    faction_join: 'Comente alguém entrando numa facção.',
    faction_leave: 'Comente alguém saindo de uma facção (tom leve).',
    mission_spawn: 'Anuncie uma missão mista entre facções diferentes.',
    event_start: 'Anuncie evento relâmpago cross-facção (trégua falsa).',
    marry_propose: 'Comente um pedido de casamento no chat.',
    marry_accept: 'Comente casamento aceito.',
    marry_mutual: 'Comente casamento mútuo instantâneo.',
    job_done: 'Comente alguém que “trabalhou” e ganhou coins (sem inventar valor).',
    flip_win: 'Comente vitória em cara ou coroa (sem inventar valor).',
    flip_lose: 'Comente derrota em cara ou coroa (sem inventar valor).',
    bet_result: 'Comente resultado de aposta PvP (use os nomes; sem inventar pot).',
    ship: 'Comente um ship entre duas pessoas (use o clima do percent se houver).',
    lucky_hit: 'Comente sorte no comando de sorte.',
    lucky_miss: 'Comente azar no comando de sorte.',
    level_up: 'Comente level up de XP no grupo.',
  };

  const hint = scenarioHints[scenario] || 'Faça uma frase de recheio pro bot de diversão.';
  return `${hint}\nContexto fixo (não invente além disso): ${facts || 'nenhum'}\nFrase:`;
}

/**
 * @param {object} deps
 * @param {() => object} [deps.getConfig] — retorna funConfig atualizado
 * @param {() => object|null} [deps.getLogger]
 * @param {typeof ollamaGenerate} [deps.generate] — injetável p/ testes
 */
export function createFlavorService(deps = {}) {
  const getConfig = deps.getConfig || (() => ({}));
  const getLogger = deps.getLogger || (() => null);
  const generate = deps.generate || ollamaGenerate;

  function isEnabled(cfg) {
    if (cfg?.ollamaEnabled === false) return false;
    // default ON se model configurado; ainda com fallback se offline
    return cfg?.ollamaEnabled !== false;
  }

  function fallback(scenario, vars) {
    const fn = FALLBACKS[scenario] || FALLBACKS.default;
    try {
      return fn(vars || {}) || FALLBACKS.default();
    } catch {
      return FALLBACKS.default();
    }
  }

  /**
   * Gera uma linha de flavor. Nunca falha — retorna string.
   * @param {string} scenario
   * @param {Record<string, string|number|boolean>} [vars]
   * @returns {Promise<string>}
   */
  async function line(scenario, vars = {}) {
    const cfg = getConfig() || {};
    const key = String(scenario || 'default');
    const safeFallback = fallback(key, vars);

    if (!isEnabled(cfg)) return safeFallback;

    const baseUrl = String(cfg.ollamaBaseUrl || 'http://127.0.0.1:11434').trim();
    const model = String(cfg.ollamaModel || 'gemma4:latest').trim() || 'gemma4:latest';
    const timeoutMs = Math.max(500, Math.floor(Number(cfg.ollamaTimeoutMs) || 8_000));

    try {
      const raw = await generate({
        baseUrl,
        model,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(key, vars),
        timeoutMs,
        numPredict: Math.max(24, Math.floor(Number(cfg.ollamaNumPredict) || 72)),
        temperature: Number.isFinite(Number(cfg.ollamaTemperature))
          ? Number(cfg.ollamaTemperature)
          : 0.85,
      });
      const clean = sanitizeFlavor(raw, Math.floor(Number(cfg.ollamaMaxChars) || 160));
      if (!clean || clean.length < 6) return safeFallback;
      return clean;
    } catch (err) {
      getLogger?.()?.debug?.(
        {
          err: { message: err?.message || 'ollama-fail', name: err?.name },
          scenario: key,
        },
        'Fun flavor: Ollama fallback'
      );
      return safeFallback;
    }
  }

  /** Linha em itálico pronta pro WhatsApp (com fallback). */
  async function italicLine(scenario, vars = {}) {
    const text = await line(scenario, vars);
    const t = String(text || '').trim();
    if (!t) return '';
    // se já veio com _..._ mantém
    if (t.startsWith('_') && t.endsWith('_')) return t;
    return `_${t}_`;
  }

  return {
    line,
    italicLine,
    fallback,
    sanitizeFlavor,
    isEnabled: () => isEnabled(getConfig() || {}),
  };
}
