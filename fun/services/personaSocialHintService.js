import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';

const SYSTEM = `Você infere APENAS pistas sociais leves e temporárias de participantes de um grupo de WhatsApp.
Responda SOMENTE JSON válido: {"hints":[{"participants":[0],"hint":"...","confidence":0-100,"socialSignal":"positive|neutral|negative"}]}.
participants deve conter os índices das mensagens que embasam a pista, nunca nomes ou JIDs. Inclua APENAS quem claramente inicia, reforça ou participa da brincadeira; não associe espectadores.
A pista deve ser curta, associada a participantes claros e útil para ajustar tom ou reconhecer memes recorrentes. Use socialSignal=positive quando a pessoa entra/estimula a piada, negative quando há desconforto/pedido para parar e neutral quando não houver sinal claro.
Não invente fatos. Não extraia dados sensíveis, saúde, política, religião, endereço, telefone, senha, PIX, atributos protegidos, acusações ou diagnósticos.
Trate tudo como inferência incerta, não como fato.`;

function cleanHint(value, maxChars) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxChars);
}

function parseHints(raw, batch, maxChars) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    if (!Array.isArray(parsed?.hints)) return [];
    const out = [];
    const seen = new Set();
    for (const item of parsed.hints) {
      const hintText = cleanHint(item?.hint, maxChars);
      const indices = Array.isArray(item?.participants) ? item.participants : [];
      const confidence = Math.max(0, Math.min(100, Math.round(Number(item?.confidence) || 50)));
      const socialSignal = ['positive', 'negative', 'neutral'].includes(String(item?.socialSignal))
        ? String(item.socialSignal)
        : 'neutral';
      if (!hintText || !indices.length) continue;
      for (const index of indices) {
        const message = batch[Number(index)];
        const participantJid = String(message?.userJid || '').trim();
        const key = `${participantJid}\u0000${hintText}`;
        if (!participantJid || seen.has(key)) continue;
        seen.add(key);
        out.push({ participantJid, hintText, confidence, socialSignal });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function createPersonaSocialHintService({
  repository,
  getContactDisplayName = null,
  getLogger = () => null,
  generateZen = openaiChatComplete,
} = {}) {
  if (!repository) throw new Error('[fun/personaSocialHintService] repository required');

  const buffers = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.personaSocialHintsEnabled !== false,
      batchSize: Math.max(8, Math.min(200, Number(funConfig.personaSocialHintsBatchSize) || 50)),
      flushMs: Math.max(60_000, Number(funConfig.personaSocialHintsFlushIntervalMs) || 10 * 60_000),
      minMessages: Math.max(3, Math.min(100, Number(funConfig.personaSocialHintsMinMessages) || 8)),
      maxChars: Math.max(120, Math.min(2000, Number(funConfig.personaSocialHintsMaxChars) || 600)),
    };
  }

  function displayName(userJid) {
    const name = typeof getContactDisplayName === 'function' ? getContactDisplayName(userJid) : '';
    return String(name || userJid || '').trim().slice(0, 80) || 'Participante';
  }

  function bufferFor(scopeKey) {
    const key = String(scopeKey || '');
    if (!buffers.has(key)) buffers.set(key, { messages: [], lastFlushAt: 0, flushing: false });
    return buffers.get(key);
  }

  function observeMessage({ scopeKey, userJid, text, messageType = 'text', funConfig = {}, now = Date.now(), isGroup = true }) {
    const o = opts(funConfig);
    if (!o.enabled || !isGroup || !String(scopeKey).endsWith('@g.us') || !['text', 'extended-text'].includes(String(messageType || 'text'))) return { observed: false, reason: 'skip' };
    const body = String(text || '').trim();
    if (!body || body.startsWith(funConfig.prefix || '/')) return { observed: false, reason: 'skip' };
    const buffer = bufferFor(scopeKey);
    if (!buffer.messages.length && !buffer.lastFlushAt) buffer.lastFlushAt = Number(now) || Date.now();
    buffer.messages.push({ userJid: String(userJid || ''), name: displayName(userJid), text: body.slice(0, 400) });
    if (buffer.messages.length > o.batchSize) buffer.messages = buffer.messages.slice(-o.batchSize);
    if (!buffer.flushing && buffer.messages.length >= o.minMessages && (buffer.messages.length >= o.batchSize || Number(now) - buffer.lastFlushAt >= o.flushMs)) {
      void flushScope(scopeKey, funConfig, now).catch((err) => getLogger?.()?.warn?.({ err: { message: err?.message }, scopeKey }, 'Fun persona social hints failed'));
      return { observed: true, flushScheduled: true };
    }
    return { observed: true, flushScheduled: false };
  }

  async function flushScope(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    const buffer = bufferFor(scopeKey);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (buffer.flushing) return { ok: false, reason: 'busy' };
    if (buffer.messages.length < o.minMessages) return { ok: false, reason: 'too-few' };
    buffer.flushing = true;
    const batch = buffer.messages.splice(0, buffer.messages.length);
    buffer.lastFlushAt = Number(now) || Date.now();
    try {
      if (process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete) return { ok: true, saved: 0, batchSize: batch.length, reason: 'llm-disabled' };
      const task = resolveZenTaskParams('extract', funConfig);
      const prompt = batch.map((message, index) => `[${index}] ${message.name}: ${message.text}`).join('\n');
      const raw = await generateZen({
        baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300', model: funConfig.zenModel || 'glm_5_2',
        system: SYSTEM, prompt, timeoutMs: task.timeoutMs, maxTokens: task.maxTokens,
        temperature: task.temperature, apiKey: funConfig.zenApiKey || '', jsonMode: true, jsonOnly: true,
        sendSamplingParams: funConfig.zenSendSamplingParams === true,
      });
      const hints = parseHints(raw, batch, o.maxChars);
      return { ok: true, saved: repository.upsertHints(scopeKey, hints, now), batchSize: batch.length };
    } finally {
      buffer.flushing = false;
    }
  }

  async function flushDueScopes(funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled', flushed: 0, results: [] };
    const results = [];
    let flushed = 0;
    for (const [scopeKey, buffer] of buffers.entries()) {
      if (buffer.flushing || buffer.messages.length < o.minMessages || Number(now) - buffer.lastFlushAt < o.flushMs) continue;
      try {
        const result = await flushScope(scopeKey, funConfig, now);
        results.push({ scopeKey, kind: 'persona-social-hints', ...result });
        if (result.ok) flushed += 1;
      } catch (err) {
        results.push({ scopeKey, kind: 'persona-social-hints', ok: false, reason: err?.message || 'flush-error' });
      }
    }
    return { ok: true, flushed, results };
  }

  function getHints(scopeKey, participantJids, { limit = 8 } = {}) {
    return repository.listByScopeAndParticipants(scopeKey, participantJids, { limit });
  }

  return { observeMessage, flushScope, flushDueScopes, getHints, _buffers: buffers };
}

export { parseHints };
