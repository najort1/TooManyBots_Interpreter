/**
 * Tarô Fun — tiragem local + leitura via Zen (prompt específico) → Ollama → template.
 * Humor BR, leitura resumida (até tarotMaxChars, default 3000).
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import {
  drawTarotCards,
  formatTarotDraw,
  fallbackTarotReading,
} from './tarotDeck.js';

export const TAROT_SYSTEM_PROMPT = `Você é o tarólogo caótico-bom de um bot de WhatsApp BR (pt-BR do dia a dia).

PERSONA
- Mistura de vidente de feira + amigo zoado do grupo.
- Respeita a simbologia do tarô (arcanos, direita/invertida, posições), mas fala humano.
- Pode ser engraçado e irônico; nunca cruel com trauma, doença, luto ou ideação.

REGRAS DA LEITURA
1. Use APENAS as cartas e orientações dadas no prompt do usuário (não invente outras cartas).
2. Estrutura sugerida (sem markdown pesado; *negrito* do WhatsApp ok):
   - 1 linha de abertura (pode zoar leve a pergunta)
   - 1 bloco curto por carta (nome + posição + significado aplicado à pergunta)
   - 1 fechamento com conselho prático ou "o que observar"
3. Tom: conversa de zap, não monografia esotérica.
4. Limite rígido: no máximo o número de caracteres indicado (cabe em uma mensagem de WhatsApp longa).
5. Não invente coins, XP, datas exatas de morte, "você vai morrer", diagnóstico médico/jurídico.
6. Não diga que é destino absoluto; fale em tendência, clima, escolha.
7. Sem listas intermináveis, sem inglês, sem "as an AI".
8. Responda SÓ com a leitura final (sem preâmbulo tipo "claro, aqui vai").`;

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Sanitizer multi-parágrafo (diferente do flavor de 1 linha).
 */
export function sanitizeTarotText(raw, maxChars = 3000) {
  let s = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim();

  // corta meta comum no começo
  s = s
    .replace(/^(claro[!.,]?\s*|aqui vai[:\s]*|leitura[:\s]*|como tarólogo[,:]?\s*)/i, '')
    .trim();

  if (!s) return '';

  const max = Math.max(200, Math.min(3000, Math.floor(Number(maxChars) || 3000)));
  if (s.length <= max) return s;

  const cut = s.slice(0, max);
  const sp = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  if (sp > max * 0.55) return `${cut.slice(0, sp).trim()}…`;
  return `${cut.trim()}…`;
}

function buildTarotUserPrompt({ question, cards, maxChars }) {
  const q = String(question || '').trim() || '(sem pergunta — leitura geral do clima atual)';
  const cardBlock = (cards || [])
    .map((c, i) => {
      const orient = c.reversed ? 'INVERTIDA' : 'DIREITA';
      const keys = (c.keywords || []).join(', ');
      return [
        `Carta ${i + 1}: ${c.name} (${orient})`,
        `  Posição no spread: ${c.position}`,
        `  Palavras-chave: ${keys}`,
      ].join('\n');
    })
    .join('\n');

  return [
    `Pergunta do consulente: ${q}`,
    '',
    'Tiragem (use só estas cartas):',
    cardBlock,
    '',
    `Escreva a leitura em pt-BR, tom de WhatsApp, engraçada mas útil, no máximo ${maxChars} caracteres.`,
    'Aplique cada carta à pergunta. Feche com um conselho curto.',
  ].join('\n');
}

export function createTarotService({
  casinoRepository = null,
  random = Math.random,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
  getLogger = () => null,
} = {}) {
  function opts(funConfig = {}) {
    return {
      enabled: funConfig.tarotEnabled !== false,
      cooldownMs: Math.max(0, Math.floor(numOr(funConfig.tarotCooldownMs, 45_000))),
      maxChars: Math.max(400, Math.min(3000, Math.floor(numOr(funConfig.tarotMaxChars, 3000)))),
      cardCount: Math.max(1, Math.min(5, Math.floor(numOr(funConfig.tarotCardCount, 3)))),
      timeoutMs: Math.max(
        3000,
        Math.floor(numOr(funConfig.tarotTimeoutMs, funConfig.zenTimeoutMs || 25_000))
      ),
      maxTokens: Math.max(128, Math.min(2000, Math.floor(numOr(funConfig.tarotMaxTokens, 900)))),
      temperature: Number.isFinite(Number(funConfig.tarotTemperature))
        ? Number(funConfig.tarotTemperature)
        : 0.9,
    };
  }

  function zenOn(cfg) {
    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return false;
    return cfg.zenEnabled !== false;
  }

  function ollamaOn(cfg) {
    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return false;
    return cfg.ollamaEnabled !== false;
  }

  async function narrate({ question, cards, funConfig = {} }) {
    const o = opts(funConfig);
    const prompt = buildTarotUserPrompt({
      question,
      cards,
      maxChars: o.maxChars,
    });
    const system = TAROT_SYSTEM_PROMPT;

    if (zenOn(funConfig)) {
      try {
        const raw = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3000',
          model: funConfig.zenModel || 'mimo-v2.5-free',
          system,
          prompt,
          timeoutMs: o.timeoutMs,
          maxTokens: o.maxTokens,
          temperature: o.temperature,
          apiKey: funConfig.zenApiKey || '',
        });
        const clean = sanitizeTarotText(raw, o.maxChars);
        if (clean) return { text: clean, provider: 'zen' };
      } catch (err) {
        try {
          getLogger?.()?.warn?.(
            { err: err?.message, scenario: 'tarot' },
            'Fun tarot zen fail'
          );
        } catch {
          // ignore
        }
        console.warn(`[fun/tarot] zen fail reason=${err?.message || 'error'}`);
      }
    }

    if (ollamaOn(funConfig)) {
      try {
        const raw = await generateOllama({
          baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
          model: funConfig.ollamaModel || 'gemma4:latest',
          system,
          prompt,
          timeoutMs: Math.max(o.timeoutMs, numOr(funConfig.ollamaTimeoutMs, 25_000)),
          keepAlive: funConfig.ollamaKeepAlive ?? -1,
          think: false,
          numPredict: o.maxTokens,
          temperature: o.temperature,
        });
        const clean = sanitizeTarotText(raw, o.maxChars);
        if (clean) return { text: clean, provider: 'ollama' };
      } catch (err) {
        console.warn(`[fun/tarot] ollama fail reason=${err?.message || 'error'}`);
      }
    }

    return {
      text: sanitizeTarotText(fallbackTarotReading(question, cards), o.maxChars),
      provider: 'template',
    };
  }

  /**
   * @param {{ userJid: string, scopeKey: string, question?: string, funConfig?: object, now?: number }} input
   */
  async function reading({
    userJid,
    scopeKey,
    question = '',
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    const q = String(question || '').trim();
    if (q.length > 500) {
      return { ok: false, reason: 'question-too-long', max: 500 };
    }

    if (casinoRepository && o.cooldownMs > 0) {
      const cd = casinoRepository.checkCooldown(
        userJid,
        scopeKey,
        'tarot',
        o.cooldownMs,
        now
      );
      if (!cd.ok) {
        return {
          ok: false,
          reason: 'cooldown',
          retryIn: formatRetry(cd.retryInMs),
          retryInMs: cd.retryInMs,
        };
      }
    }

    const cards = drawTarotCards(random, o.cardCount);
    const drawText = formatTarotDraw(cards);
    const narrated = await narrate({ question: q, cards, funConfig });

    if (casinoRepository && o.cooldownMs > 0) {
      casinoRepository.touchCooldown(userJid, scopeKey, 'tarot', now);
    }

    return {
      ok: true,
      question: q || '(leitura geral)',
      cards,
      drawText,
      reading: narrated.text,
      provider: narrated.provider,
      maxChars: o.maxChars,
    };
  }

  return {
    reading,
    drawTarotCards: (n) => drawTarotCards(random, n),
    formatTarotDraw,
    sanitizeTarotText,
    fallbackTarotReading,
    TAROT_SYSTEM_PROMPT,
  };
}
