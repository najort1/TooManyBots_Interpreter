import { ollamaGenerate, ollamaWarmup, ollamaTouch } from './ollamaClient.js';
import { openaiChatComplete } from './openaiClient.js';

const SYSTEM_PROMPT = `Você é o narrador de um bot de diversão de WhatsApp BR (pt-BR do dia a dia, não de livro).

Voz: grupo de amigos zoando. Natural, irônico, carinhoso na sacanagem. Pode ter piada leve e duplo sentido de vez em quando — sem forçar, sem cringe, sem soar IA genérica.

Escreva 1 a 3 frases (até ~1000 caracteres).

Pode: gíria BR leve (pô, mano, né, viu, kkk, meteu o louco, pagou mico, se lascou).
Pode: humor seco, indireta, "olha o casal", "foi de base", "hoje não é o dia".

NÃO:
- inventar coins, XP, vencedor, placar ou regra de jogo (o bot já mostrou)
- inglês, tom de anúncio, "seamless/unlock/vibes"
- ofensa pesada, preconceito, puteiro explícito
- markdown, lista, aspas no começo/fim
- explicar o que vai fazer — só manda o comentário

No máximo 3 emojis. Só o texto final.`;

/** System enxuto pro Zen (modelos free se perdem com prompt longo). */
const ZEN_SYSTEM_PROMPT = `Narrador de zap BR. Só pt-BR de verdade (1–3 frases, até 1000 chars). Tom: zoação de grupo, ironia leve, às vezes um duplo sentido sutil — nunca forçado nem IA genérica. Sem markdown, sem aspas, sem inglês, sem ofensa pesada. Não invente números de jogo. Máx 3 emojis. Só o texto final.`;

/** Fallbacks estáticos — sempre seguros se LLM falhar. */
const FALLBACKS = {
  faction_create: (v) =>
    pick([
      `*${v.name || 'A panelinha'}* saiu do papel. Agora é oficial… e o drama também.`,
      `Registrou *${v.name || 'o time'}*. Se der ruim, a culpa é coletiva, viu.`,
      `*${v.name || 'Eles'}* abriram a firma. Só falta alguém trair o líder no primeiro daily.`,
    ]),
  faction_join: (v) =>
    pick([
      `*${v.user || 'Fulano'}* entrou no *${v.name || 'time'}*. Bem-vindo(a) ao caos organizado.`,
      `Mais um no *${v.name || 'clã'}*. A panelinha engrossou… o contador, né.`,
      `*${v.user || 'Alguém'}* assinou a carteira do *${v.name || 'grupo'}*. Holerite: zero.`,
    ]),
  faction_leave: (v) =>
    pick([
      `*${v.user || 'Fulano'}* largou o *${v.name || 'barco'}*. Porta bateu, ego não.`,
      v.dissolved
        ? `*${v.name || 'A facção'}* acabou. Ficou só o mico e o histórico.`
        : `*${v.user || 'Alguém'}* saiu do *${v.name || 'time'}*. O chat já inventou o motivo.`,
      `Saída confirmada. Às vezes é só “preciso de um tempo”… da panelinha.`,
    ]),
  mission_spawn: () =>
    pick([
      'Squad misto no ar. Ou colaboram, ou viram print de vergonha.',
      'Missão entre facções diferentes. Paz falsa, prêmio real.',
      'Operação Mistura: daily, aposta e ship. Quem falhar, paga o mico.',
    ]),
  event_start: (v) =>
    pick([
      `Trégua falsa por uns *${v.minutes || '?'}* min. Falar com “o inimigo” agora rende.`,
      'Evento: sair da bolha da panelinha tá valendo mais. Coincidência? Não.',
      'Janela cross-facção aberta. Isolado perde o meta — e a moral.',
    ]),
  marry_propose: (v) =>
    pick([
      `*${v.me || 'Alguém'}* foi de joelho (digital) pra *${v.other || 'alguém'}*. O grupo já tá no cinema.`,
      'Pedido mandado. Agora é coragem… ou recusar e virar lore.',
      `*${v.me || 'Fulano'}* botou o relacionamento em votação pública. Classicamente BR.`,
    ]),
  marry_accept: (v) =>
    pick([
      `*${v.a || 'A'}* e *${v.b || 'B'}* casaram no zap. Parabéns — e boa sorte no divórcio free.`,
      'Aliança confirmada. Já tem enquete de “quanto tempo dura?”.',
      'Casamento selado. O daily agora é a dois… ou a treta fica a dois.',
    ]),
  marry_mutual: (v) =>
    pick([
      `Pedido mútuo: *${v.a || 'A'}* e *${v.b || 'B'}* se acharam. Raro, quase assustador.`,
      'Os dois pediram ao mesmo tempo. Destino ou desespero coletivo? Os dois.',
    ]),
  job_done: (v) =>
    pick([
      v.flavor
        ? `${v.flavor} — suou a camisa (ou o teclado) e saiu com coins.`
        : 'Trabalhou no grupo. Honestidade duvidosa, pagamento real.',
      'Expediente fechado. Até o próximo turno de exploração assalariada.',
      'Bateu ponto no chat. CLT emocional, PJ de coins.',
    ]),
  flip_win: () =>
    pick([
      'A moeda te escolheu hoje. Aproveita antes dela te trair de novo.',
      'Caiu do seu lado. Sorte ou o universo de mau humor com o outro?',
      'Acertou. Agora finge que foi skill.',
      'Vitória limpa… se a gente ignorar que é 50/50.',
    ]),
  flip_lose: () =>
    pick([
      'A moeda te deu um chapéu. Clássico nacional.',
      'Errou o lado. O chat ri, o saldo chora.',
      'Hoje a coroa (ou a cara) não tava pra você.',
      'Foi de base na moeda. Respira e tenta depois do cooldown.',
    ]),
  bet_result: (v) =>
    pick([
      v.winner
        ? `*${v.winner}* levou o pot. *${v.loser || 'O outro'}* ficou com a moral e o mico.`
        : 'Aposta resolvida. Um ri agora, o outro jura que “era só brincadeira”.',
      'Duelo de moeda fechado. Drama entregue, recibo em emoji.',
      v.winner
        ? `*${v.winner}* saiu com o bolo. *${v.loser || 'Perdedor'}* que pague o café da vergonha.`
        : 'Fim da aposta. Próximo round é orgulho ferido.',
    ]),
  ship: (v) => {
    const p = Number(v.percent) || 0;
    if (p >= 80) {
      return pick([
        'Química absurda. Já pode abrir a fanfic no grupo.',
        'Ship alto desse jeito… alguém vai ter que assumir ou fugir do país.',
        'Tá quase oficial. Falta só o /marry e a coragem.',
      ]);
    }
    if (p >= 50) {
      return pick([
        'Tem potencial. Falta um daily juntos e menos vergonha na cara.',
        'Meio a meio: nem namoro, nem só amizade — o pior dos mundos.',
        'Dá pra forçar o destino… ou deixar o clima estranho no ar.',
      ]);
    }
    return pick([
      'Ship gelado. Amizade talvez — ou rivalidade com zero intenção.',
      'Percentual tímido. O universo deu um “hmm” e mudou de assunto.',
      'Frio demais. Melhor não forçar… a não ser que o grupo force por vocês.',
    ]);
  },
  lucky_hit: () =>
    pick([
      'Sorte bateu na porta. Raro, gostoso e sem explicação.',
      'O RNG te beijou na testa. Não se acostuma.',
      'Caiu um dinheirinho do céu. Ou do bot. Mesma coisa.',
    ]),
  lucky_miss: () =>
    pick([
      'Azar puro. O universo tirou férias e te esqueceu na fila.',
      'Saiu nada. Clássico: esperança alta, retorno zero.',
      'Hoje não. Volta daqui a umas horas e finge que confia de novo.',
    ]),
  level_up: (v) =>
    pick([
      `Subiu pro level *${v.level || '?'}*. O rank tremeu — ou fingiu que tremeu.`,
      'Level up no chat. XP bem gasto zoando os outros.',
      `Nível *${v.level || '?'}*. Continua mandando mensagem, campeão da atividade.`,
    ]),
  default: () =>
    pick([
      'O chat reage em silêncio… por enquanto.',
      'Situação processada. Opiniões no privado, mico no grupo.',
      'Anotado. O grupo já tá criando a narrativa.',
    ]),
};

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) return FALLBACKS.default();
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

function looksLikeMetaReasoning(s) {
  const t = String(s || '');
  if (!t) return true;
  // raciocínio em inglês / meta sobre o prompt
  if (
    /\b(I need to|we are|the user|therefore|so this is|since I can't|shouldn'?t|compatibility ship|I should|let me|characters|max\s*\d+)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // meta em pt-BR (modelo planejando a frase em vez de dizer a frase)
  if (
    /\b(posso brincar|outra ideia|então posso|talvez algo sobre|preciso (criar|escrever|gerar)|vou (escrever|focar|criar)|a frase (poderia|tem que)|algo que brinque|responda somente|só a frase)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^(contexto|regras?|passo|thinking|racioc|a frase|vou |algo que|preciso |- )/i.test(t)) return true;
  return false;
}

function sanitizeFlavor(raw, maxLen = 160) {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(thinking|raciocínio|step\s*\d)/i.test(l));

  // prefere primeira linha boa; se todas forem meta, falha
  let s = '';
  for (const line of lines) {
    let cand = line
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .replace(/^(narrador|bot|assistente|resposta|final)\s*:\s*/i, '')
      .trim();
    if (cand.length < 6 || looksLikeMetaReasoning(cand)) continue;
    s = cand;
    break;
  }
  if (!s) return '';

  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
  }
  if (/^\d+$/.test(s)) return '';
  if (looksLikeMetaReasoning(s)) return '';
  return s;
}

function buildUserPrompt(scenario, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  const facts = Object.entries(v)
    .filter(([, val]) => val != null && String(val).trim() !== '')
    .map(([k, val]) => `${k}=${String(val).slice(0, 80)}`)
    .join('; ');

  const scenarioHints = {
    faction_create: 'Zoação leve sobre panelinha/facção recém-criada no grupo.',
    faction_join: 'Comente alguém entrando na facção — tom de “bem-vindo ao caos”.',
    faction_leave: 'Comente saída de facção sem ser cruel de verdade.',
    mission_spawn: 'Missão mista entre facções: cooperação forçada, prêmio real.',
    event_start: 'Evento relâmpago (trégua falsa / cross-facção) — sai da bolha.',
    marry_propose: 'Pedido de casamento no zap: vergonha alheia e torcida do grupo.',
    marry_accept: 'Casamento aceito: parabéns com pitada de deboche carinhoso.',
    marry_mutual: 'Pedido mútuo: raro, quase assustador, engraçado.',
    job_done: 'Alguém “trabalhou” no bot e ganhou coins (não invente o valor).',
    flip_win: 'Ganhou no cara ou coroa — sorte com cara de skill (sem inventar valor).',
    flip_lose: 'Perdeu no cara ou coroa — mico leve, sem humilhar de graça.',
    bet_result: 'Resultado de aposta PvP: use os nomes; não invente pot/números.',
    ship: 'Ship do grupo: use o clima do percent se tiver; pode ser safado de leve.',
    lucky_hit: 'Deu sorte no comando de sorte — raro e gostoso.',
    lucky_miss: 'Azar no comando de sorte — clássico, sem drama falso.',
    level_up: 'Level up de XP — orgulho irônico de ranqueiro de grupo.',
  };

  const hint = scenarioHints[scenario] || 'Comentário de narrador de grupo BR sobre o que rolou.';
  return `${hint}\nContexto fixo (não invente além disso): ${facts || 'nenhum'}\nTexto (1 a 3 frases, pt-BR de zap):`;
}

function resolveOllamaEndpoint(cfg) {
  return {
    baseUrl: String(cfg.ollamaBaseUrl || 'http://127.0.0.1:11434').trim(),
    model: String(cfg.ollamaModel || 'gemma4:latest').trim() || 'gemma4:latest',
    keepAlive:
      cfg.ollamaKeepAlive === undefined || cfg.ollamaKeepAlive === null || cfg.ollamaKeepAlive === ''
        ? -1
        : cfg.ollamaKeepAlive,
    timeoutMs: Math.max(500, Math.floor(Number(cfg.ollamaTimeoutMs) || 25_000)),
    warmupTimeoutMs: Math.max(5_000, Math.floor(Number(cfg.ollamaWarmupTimeoutMs) || 120_000)),
    refreshMs: Math.max(0, Math.floor(Number(cfg.ollamaKeepAliveRefreshMs) || 0)),
  };
}

function resolveZenEndpoint(cfg) {
  return {
    baseUrl: String(cfg.zenBaseUrl || 'http://127.0.0.1:3000').trim(),
    model: String(cfg.zenModel || 'mimo-v2.5-free').trim() || 'mimo-v2.5-free',
    timeoutMs: Math.max(500, Math.floor(Number(cfg.zenTimeoutMs) || 5_000)),
    maxTokens: Math.max(16, Math.floor(Number(cfg.zenMaxTokens) || 400)),
    temperature: Number.isFinite(Number(cfg.zenTemperature)) ? Number(cfg.zenTemperature) : 0.85,
    apiKey: String(cfg.zenApiKey || '').trim(),
  };
}

function logFlavor(getLogger, payload, tag = 'Fun flavor') {
  const logger = typeof getLogger === 'function' ? getLogger() : null;
  try {
    logger?.warn?.(payload, tag);
  } catch {
    // ignore
  }
  try {
    const reason = payload?.reason || payload?.err?.message || 'unknown';
    const provider = payload?.provider || '?';
    console.warn(
      `[fun/llm] ${provider} scenario=${payload?.scenario || '?'} reason=${reason}`
    );
  } catch {
    // ignore
  }
}

/**
 * @param {object} deps
 * @param {() => object} [deps.getConfig]
 * @param {() => object|null} [deps.getLogger]
 * @param {typeof ollamaGenerate} [deps.generate] — ollama (ou mock)
 * @param {typeof openaiChatComplete} [deps.zenGenerate] — zen/openai (ou mock)
 * @param {typeof ollamaWarmup} [deps.warmup]
 * @param {typeof ollamaTouch} [deps.touch]
 */
export function createFlavorService(deps = {}) {
  const getConfig = deps.getConfig || (() => ({}));
  const getLogger = deps.getLogger || (() => null);
  const generateOllama = deps.generate || ollamaGenerate;
  const generateZen = deps.zenGenerate || openaiChatComplete;
  const warmupFn = deps.warmup || ollamaWarmup;
  const touchFn = deps.touch || ollamaTouch;

  /** @type {ReturnType<typeof setInterval> | null} */
  let keepAliveTimer = null;
  let warm = false;
  let lastWarmAt = 0;
  let lastProvider = '';

  // testes setam FUN_DISABLE_LIVE_LLM=1; mocks injetados ainda funcionam
  const liveLlmAllowed =
    process.env.FUN_DISABLE_LIVE_LLM !== '1' || Boolean(deps.allowLiveLlm);

  function zenOn(cfg) {
    if (!liveLlmAllowed && generateZen === openaiChatComplete) return false;
    return cfg?.zenEnabled !== false;
  }

  function ollamaOn(cfg) {
    if (!liveLlmAllowed && generateOllama === ollamaGenerate) return false;
    return cfg?.ollamaEnabled !== false;
  }

  function isEnabled(cfg) {
    return zenOn(cfg) || ollamaOn(cfg);
  }

  function fallback(scenario, vars) {
    const fn = FALLBACKS[scenario] || FALLBACKS.default;
    try {
      return fn(vars || {}) || FALLBACKS.default();
    } catch {
      return FALLBACKS.default();
    }
  }

  function buildPromptParts(cfg, key, vars, simple, { forZen = false } = {}) {
    const maxChars = Math.floor(Number(cfg.ollamaMaxChars) || 1000);
    let prompt;
    if (forZen) {
      // prompt curto funciona melhor nos free models do Zen
      const facts = Object.entries(vars || {})
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
        .join(', ');
      prompt = simple
        ? `Texto de grupo WhatsApp (pt-BR, até ${maxChars} chars) sobre ${key}. ${facts}. Só o texto final:`
        : `Comente em 1 a 3 frases (pt-BR, tom de zap, até ${maxChars} chars) o cenário "${key}". Dados: ${facts || 'nenhum'}. Só o texto final:`;
    } else {
      prompt = simple
        ? `Texto em pt-BR (até ${maxChars} chars), tom de grupo WhatsApp, cenário=${key}. Contexto: ${JSON.stringify(vars || {}).slice(0, 300)}. Só o texto:`
        : buildUserPrompt(key, vars);
    }
    const system = simple
      ? `Responda somente em português brasileiro, 1 a 3 frases (até ${maxChars} caracteres). Sem aspas, sem markdown, sem listas. Só o texto final.`
      : forZen
        ? ZEN_SYSTEM_PROMPT
        : SYSTEM_PROMPT;
    return { prompt, system, maxChars };
  }

  async function tryZen(cfg, key, vars, { simple = false } = {}) {
    if (!zenOn(cfg)) return { ok: false, reason: 'zen-disabled' };
    const ep = resolveZenEndpoint(cfg);
    const { prompt, system, maxChars } = buildPromptParts(cfg, key, vars, simple, {
      forZen: true,
    });
    try {
      const raw = await generateZen({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt,
        timeoutMs: ep.timeoutMs,
        maxTokens: ep.maxTokens,
        temperature: ep.temperature,
        apiKey: ep.apiKey,
      });
      const clean = sanitizeFlavor(raw, maxChars);
      if (!clean) return { ok: false, reason: 'zen-empty', model: ep.model };
      return { ok: true, text: clean, provider: 'zen', model: ep.model };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'zen-fail',
        model: ep.model,
        err,
      };
    }
  }

  async function tryOllama(cfg, key, vars, { simple = false } = {}) {
    if (!ollamaOn(cfg)) return { ok: false, reason: 'ollama-disabled' };
    const ep = resolveOllamaEndpoint(cfg);
    const { prompt, system, maxChars } = buildPromptParts(cfg, key, vars, simple, {
      forZen: false,
    });
    try {
      const raw = await generateOllama({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt,
        timeoutMs: ep.timeoutMs,
        keepAlive: ep.keepAlive,
        think: false,
        numPredict: Math.max(32, Math.floor(Number(cfg.ollamaNumPredict) || 80)),
        temperature: Number.isFinite(Number(cfg.ollamaTemperature))
          ? Number(cfg.ollamaTemperature)
          : 0.85,
      });
      const clean = sanitizeFlavor(raw, maxChars);
      if (!clean) return { ok: false, reason: 'ollama-empty', model: ep.model };
      warm = true;
      lastWarmAt = Date.now();
      return { ok: true, text: clean, provider: 'ollama', model: ep.model };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'ollama-fail',
        model: ep.model,
        err,
      };
    }
  }

  /**
   * Pré-carrega Ollama (fallback local). Zen não precisa de warmup de VRAM.
   */
  async function warmup() {
    const cfg = getConfig() || {};
    if (!ollamaOn(cfg)) {
      return { ok: false, reason: ollamaOn(cfg) ? 'skip' : 'ollama-disabled', ms: 0 };
    }
    const ep = resolveOllamaEndpoint(cfg);
    const result = await warmupFn({
      baseUrl: ep.baseUrl,
      model: ep.model,
      keepAlive: ep.keepAlive,
      timeoutMs: ep.warmupTimeoutMs,
    });
    if (result.ok) {
      warm = true;
      lastWarmAt = Date.now();
      getLogger?.()?.info?.(
        { model: result.model, ms: result.ms },
        'Fun Ollama: modelo aquecido e residente'
      );
    } else {
      warm = false;
      getLogger?.()?.warn?.(
        { model: result.model, ms: result.ms, reason: result.reason },
        'Fun Ollama: warmup falhou — ainda tenta sob demanda como fallback'
      );
    }
    return result;
  }

  function startKeepAliveLoop() {
    stopKeepAliveLoop();
    const cfg = getConfig() || {};
    if (!ollamaOn(cfg)) return { started: false, reason: 'ollama-disabled' };

    const ep = resolveOllamaEndpoint(cfg);
    const refreshMs =
      cfg.ollamaKeepAliveRefreshMs === 0 ? 0 : ep.refreshMs || 10 * 60_000;

    if (refreshMs <= 0) return { started: false, reason: 'refresh-disabled' };

    keepAliveTimer = setInterval(() => {
      const live = getConfig() || {};
      if (!ollamaOn(live)) return;
      const e = resolveOllamaEndpoint(live);
      touchFn({
        baseUrl: e.baseUrl,
        model: e.model,
        keepAlive: e.keepAlive,
        timeoutMs: Math.min(e.warmupTimeoutMs, 60_000),
      })
        .then((r) => {
          if (r.ok) {
            warm = true;
            lastWarmAt = Date.now();
          }
        })
        .catch(() => {});
    }, refreshMs);

    if (typeof keepAliveTimer.unref === 'function') {
      keepAliveTimer.unref();
    }

    return { started: true, refreshMs };
  }

  function stopKeepAliveLoop() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  /**
   * Cascata: Zen → Ollama → template estático.
   * Budget curto (default 6s) pra não travar /sorte /trabalhar /ship no WhatsApp.
   */
  async function line(scenario, vars = {}) {
    const cfg = getConfig() || {};
    const key = String(scenario || 'default');
    const safeFallback = fallback(key, vars);

    if (!isEnabled(cfg)) {
      return safeFallback;
    }

    const budgetMs = Math.max(
      1500,
      Math.min(20_000, Math.floor(Number(cfg.flavorTimeoutMs) || 6_000))
    );

    const cascade = async () => {
      // 1) OpenCode Zen (principal)
      let zenResult = await tryZen(cfg, key, vars, { simple: false });
      if (!zenResult.ok && zenResult.reason === 'zen-empty') {
        zenResult = await tryZen(cfg, key, vars, { simple: true });
      }
      if (zenResult.ok) {
        lastProvider = 'zen';
        return zenResult.text;
      }
      if (zenOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'zen',
          reason: zenResult.reason,
          model: zenResult.model,
          err: zenResult.err
            ? { message: zenResult.err.message, name: zenResult.err.name }
            : undefined,
        });
      }

      // 2) Ollama local (fallback)
      let ollamaResult = await tryOllama(cfg, key, vars, { simple: false });
      if (!ollamaResult.ok && ollamaResult.reason === 'ollama-empty') {
        ollamaResult = await tryOllama(cfg, key, vars, { simple: true });
      }
      if (ollamaResult.ok) {
        lastProvider = 'ollama';
        return ollamaResult.text;
      }
      if (ollamaOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'ollama',
          reason: ollamaResult.reason,
          model: ollamaResult.model,
          warm,
          err: ollamaResult.err
            ? { message: ollamaResult.err.message, name: ollamaResult.err.name }
            : undefined,
        });
      }

      lastProvider = 'template';
      return safeFallback;
    };

    try {
      return await Promise.race([
        cascade(),
        new Promise((resolve) => {
          setTimeout(() => {
            lastProvider = 'template-timeout';
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
    } catch {
      lastProvider = 'template';
      return safeFallback;
    }
  }

  async function italicLine(scenario, vars = {}) {
    const text = await line(scenario, vars);
    const t = String(text || '').trim();
    if (!t) return '';
    if (t.startsWith('_') && t.endsWith('_')) return t;
    return `_${t}_`;
  }

  return {
    line,
    italicLine,
    fallback,
    sanitizeFlavor,
    warmup,
    startKeepAliveLoop,
    stopKeepAliveLoop,
    isWarm: () => warm,
    lastWarmAt: () => lastWarmAt,
    lastProvider: () => lastProvider,
    isEnabled: () => isEnabled(getConfig() || {}),
  };
}
