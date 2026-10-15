import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { isLlmFeatureEnabled } from '../llm/llmGovernance.js';

function buildSystemPrompt(maxAbsDelta = 8) {
  const limit = Math.max(1, Number(maxAbsDelta) || 8);
  return `Você analisa um lote de mensagens de um grupo de WhatsApp e infere como a "química" social entre PARES de participantes evoluiu nesse trecho.
Responda SOMENTE JSON válido: {"pairs":[{"participants":[0,1],"evidence_msg":[2,5],"affection":-${limit},"rivalry":0,"intimacy":2,"chaos":0}]}.
"participants": os DOIS índices das mensagens (relativos à lista enviada) cujos autores formam o par observado, nunca nomes ou JIDs.
"evidence_msg": índices das mensagens do lote que embasam a inferência para aquele par.
Avalie SOMENTE pares com evidência clara de interação DIRETA entre os dois (responderam um ao outro, zoaram, flertaram, brigaram, fizeram dupla). Não avalie espectadores nem pares sem troca direta.
Cada eixo é um delta pequeno entre -${limit} e ${limit}: affection=afeto/carinho, rivalry=rivalidade/atrito, intimacy=proximidade/confiança, chaos=bagunça/confusão gerada pela dupla. Use 0 no eixo sem sinal claro.
Palavrão, duplo sentido, flerte ou humor adulto entre participantes não são sinal negativo por si. Marque negative/rivalry alto somente com desconforto real, recusa, assédio direcionado, coerção, exploração, menor de idade ou exposição íntima. Não descreva conteúdo gráfico.
Não invente fatos. Não extraia dados sensíveis, saúde, política, religião, endereço, telefone, senha, PIX, atributos protegidos, acusações ou diagnósticos.
Trate tudo como inferência incerta, não como fato. Se nenhum par tiver evidência clara: {"pairs":[]}`;
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const wrapped = text.match(/\{[\s\S]*\}/);
    if (!wrapped) return null;
    try {
      return JSON.parse(wrapped[0]);
    } catch {
      return null;
    }
  }
}

function clampDelta(value, limit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-limit, Math.min(limit, n));
}

function parsePairs(raw, batch, maxAbsDelta) {
  try {
    const parsed = parseJsonObject(raw);
    if (!parsed || !Array.isArray(parsed?.pairs)) return { ok: false, pairs: [] };
    const out = [];
    const seen = new Set();
    for (const item of parsed.pairs) {
      const indices = Array.isArray(item?.participants) ? item.participants : [];
      if (indices.length !== 2) continue;
      const messageA = batch[Number(indices[0])];
      const messageB = batch[Number(indices[1])];
      const userA = String(messageA?.userJid || '').trim();
      const userB = String(messageB?.userJid || '').trim();
      if (!userA || !userB || userA === userB) continue;
      const key = [userA, userB].sort().join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        userA,
        userB,
        deltas: {
          affection: clampDelta(item?.affection, maxAbsDelta),
          rivalry: clampDelta(item?.rivalry, maxAbsDelta),
          intimacy: clampDelta(item?.intimacy, maxAbsDelta),
          chaos: clampDelta(item?.chaos, maxAbsDelta),
        },
      });
    }
    return { ok: true, pairs: out };
  } catch {
    return { ok: false, pairs: [] };
  }
}

export function createPersonaChemistryService({
  bondService,
  getContactDisplayName = null,
  getLogger = () => null,
  generateZen = openaiChatComplete,
} = {}) {
  if (!bondService) throw new Error('[fun/personaChemistryService] bondService required');

  /** @type {Map<string, { messages: object[], flushing: boolean }>} */
  const buffers = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.personaChemistryEnabled !== false && isLlmFeatureEnabled(funConfig, 'chemistry'),
      batchSize: Math.max(8, Math.min(200, Number(funConfig.personaChemistryBatchSize) || 50)),
      maxAbsDelta: Math.max(1, Math.min(30, Number(funConfig.personaChemistryMaxAbsDelta) || 8)),
    };
  }

  function displayName(userJid) {
    const name = typeof getContactDisplayName === 'function' ? getContactDisplayName(userJid) : '';
    return String(name || userJid || '').trim().slice(0, 80) || 'Participante';
  }

  function bufferFor(scopeKey) {
    const key = String(scopeKey || '');
    if (!buffers.has(key)) buffers.set(key, { messages: [], flushing: false });
    return buffers.get(key);
  }

  function observeMessage({ scopeKey, userJid, text, messageType = 'text', funConfig = {}, now = Date.now(), isGroup = true }) {
    const o = opts(funConfig);
    if (!o.enabled || !isGroup || !String(scopeKey).endsWith('@g.us') || !['text', 'extended-text'].includes(String(messageType || 'text'))) {
      return { observed: false, reason: 'skip' };
    }
    const body = String(text || '').trim();
    if (!body || body.startsWith(funConfig.prefix || '/')) return { observed: false, reason: 'skip' };

    const buffer = bufferFor(scopeKey);
    buffer.messages.push({
      userJid: String(userJid || ''),
      name: displayName(userJid),
      text: body.slice(0, 400),
      at: Number(now) || Date.now(),
    });
    // Limita o buffer em memória mesmo se o flush estiver ocupado/lento.
    const maxBuffered = o.batchSize * 3;
    if (buffer.messages.length > maxBuffered) {
      buffer.messages = buffer.messages.slice(-maxBuffered);
    }

    // Trigger ÚNICO: contagem de mensagens (batchSize). SEM timer — abaixo do lote, nunca avalia.
    if (!buffer.flushing && buffer.messages.length >= o.batchSize) {
      void flushScope(scopeKey, funConfig, now).catch((err) => {
        getLogger?.()?.warn?.({ err: { message: err?.message }, scopeKey }, 'Fun persona chemistry failed');
      });
      return { observed: true, flushScheduled: true };
    }
    return { observed: true, flushScheduled: false };
  }

  async function flushScope(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    const buffer = bufferFor(scopeKey);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (buffer.flushing) return { ok: false, reason: 'busy' };
    if (buffer.messages.length < o.batchSize) return { ok: false, reason: 'too-few' };

    buffer.flushing = true;
    const batch = buffer.messages.splice(0, o.batchSize);
    try {
      if (!isLlmFeatureEnabled(funConfig, 'chemistry') || (process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete)) {
        return { ok: true, applied: 0, batchSize: batch.length, reason: 'llm-disabled' };
      }
      const task = resolveZenTaskParams('chemistry', funConfig);
      const ep = resolveZenEndpoint(funConfig);
      const prompt = batch.map((message, index) => `[${index}] ${message.name}: ${message.text}`).join('\n');
      const system = buildSystemPrompt(o.maxAbsDelta);

      let pairs = [];
      let parseOk = false;
      const totalTries = Math.max(1, Math.min(8, Math.floor(Number(funConfig.zenMaxRetries) || 3) + 1));
      let lastError = null;
      for (let attempt = 1; attempt <= totalTries; attempt += 1) {
        try {
          const raw = await generateZen({
            task: 'chemistry',
            scopeKey: String(scopeKey || ''),
            baseUrl: ep.baseUrl, model: ep.model,
            system, prompt, timeoutMs: task.timeoutMs, maxTokens: task.maxTokens,
            temperature: task.temperature, apiKey: ep.apiKey, jsonMode: true, jsonOnly: true,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          const parsedResult = parsePairs(raw, batch, o.maxAbsDelta);
          if (parsedResult.ok) {
            pairs = parsedResult.pairs;
            parseOk = true;
            break;
          }
        } catch (err) {
          lastError = err;
          getLogger?.()?.debug?.(
            { err: { message: err?.message || 'persona-chemistry' }, attempt, scopeKey },
            'Fun persona chemistry zen fail'
          );
        }
      }
      if (!parseOk && lastError) throw lastError;

      let applied = 0;
      for (const pair of pairs) {
        const result = bondService.applyChemistryDelta({
          scopeKey,
          userA: pair.userA,
          userB: pair.userB,
          deltas: pair.deltas,
          maxAbsDelta: o.maxAbsDelta,
          now,
        });
        if (result?.ok) applied += 1;
      }

      return { ok: true, applied, pairsFound: pairs.length, batchSize: batch.length, retries: totalTries };
    } finally {
      buffer.flushing = false;
    }
  }

  /**
   * Varre todos os buffers e faz flush dos que estão due.
   * Rede de segurança do world tick: só avalia buffer que JÁ bateu o batchSize
   * mas não conseguiu avaliar no observe (ex.: flush anterior ainda em andamento).
   * NÃO avalia por tempo/idade.
   */
  async function flushDueScopes(funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled', flushed: 0, results: [] };

    const results = [];
    let flushed = 0;
    const keys = [...buffers.keys()];
    for (const scopeKey of keys) {
      const buffer = buffers.get(scopeKey);
      if (!buffer || buffer.flushing || buffer.messages.length < o.batchSize) continue;
      try {
        const result = await flushScope(scopeKey, funConfig, now);
        results.push({ scopeKey, kind: 'persona-chemistry', ...result });
        if (result.ok) flushed += 1;
      } catch (err) {
        results.push({ scopeKey, kind: 'persona-chemistry', ok: false, reason: err?.message || 'flush-error' });
      }
    }
    return { ok: true, flushed, results };
  }

  function getBufferStats() {
    const out = [];
    for (const [scopeKey, buffer] of buffers.entries()) {
      out.push({ scopeKey, size: buffer.messages.length, flushing: buffer.flushing });
    }
    return out;
  }

  return { observeMessage, flushScope, flushDueScopes, getBufferStats, _buffers: buffers };
}
