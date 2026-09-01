import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import {
  buildFactTemporalContext,
  formatDatedFact,
  resolveFactTimeZone,
} from '../utils/factTemporalContext.js';

const RETRACTION_HINT = /\b(esque[cç]|esquecer|apaga|apagar|remove|remover|errad[oa]|mentira|antig[oa]|velh[oa]|n[aã]o aconteceu|nunca aconteceu)\b/iu;

function parseRemovals(raw, factsById, limit) {
  let parsed;
  try { parsed = JSON.parse(String(raw || '')); } catch { return []; }
  const removals = Array.isArray(parsed?.removals) ? parsed.removals : [];
  const seen = new Set();
  return removals.flatMap((item) => {
    const factId = String(item?.factId || '').trim();
    const reason = String(item?.reason || '').trim().slice(0, 180);
    if (!factId || !reason || seen.has(factId) || !factsById.has(factId)) return [];
    seen.add(factId);
    return [{ factId, reason }];
  }).slice(0, limit);
}

export function createLoreReconciliationService({
  memoryRepository,
  groupMemoryService = null,
  generateZen = openaiChatComplete,
  getLogger = () => null,
} = {}) {
  if (!memoryRepository) throw new Error('[fun/loreReconciliationService] memoryRepository required');
  const inFlight = new Set();
  const cooldowns = new Map();

  async function observe({ scopeKey, text, funConfig = {}, now = Date.now() } = {}) {
    const scope = String(scopeKey || '');
    const message = String(text || '').trim();
    if (funConfig.loreReconciliationEnabled === false || !scope.endsWith('@g.us') || !RETRACTION_HINT.test(message)) {
      return { ok: false, reason: 'not-requested' };
    }
    if (inFlight.has(scope)) return { ok: false, reason: 'in-flight' };
    const cooldownMs = Math.max(5_000, Number(funConfig.loreReconciliationCooldownMs) || 60_000);
    if ((cooldowns.get(scope) || 0) > now) return { ok: false, reason: 'cooldown' };

    const maxCandidates = Math.max(1, Math.min(100, Number(funConfig.loreReconciliationMaxCandidates) || 50));
    const facts = memoryRepository.listFacts(scope, { limit: maxCandidates, minScore: 0 });
    if (!facts.length) return { ok: true, removed: 0, reason: 'no-facts' };
    inFlight.add(scope);
    cooldowns.set(scope, now + cooldownMs);
    try {
      if (process.env.FUN_DISABLE_LIVE_LLM === '1') return { ok: false, reason: 'llm-disabled' };
      const task = resolveZenTaskParams('lore_reconcile', funConfig);
      const endpoint = resolveZenEndpoint(funConfig);
      const timeZone = resolveFactTimeZone(funConfig.worldTimezone);
      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        apiKey: endpoint.apiKey,
        timeoutMs: Math.min(Math.max(5_000, Number(funConfig.loreReconciliationTimeoutMs) || 35_000), task.timeoutMs),
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        jsonMode: true,
        jsonOnly: true,
        sendSamplingParams: funConfig.zenSendSamplingParams !== false,
        system: 'Você reconcilia lore de um grupo de WhatsApp. Só remova um fato quando a mensagem pedir explicitamente para esquecê-lo, disser que é antigo/errado/mentira, e identificar inequivocamente o fato listado. Responda SOMENTE JSON: {"removals":[{"factId":"id listado","reason":"motivo curto"}]}. Em dúvida, use []. Nunca invente IDs.',
        prompt: `${buildFactTemporalContext({ now, timeZone })}\nMensagem do membro:\n${message.slice(0, 600)}\n\nFatos candidatos deste MESMO grupo:\n${facts.map((fact) => `- id=${fact.id} | ${formatDatedFact(fact, fact.summary, timeZone)}`).join('\n')}`,
      });
      const factsById = new Map(facts.map((fact) => [String(fact.id), fact]));
      const removals = parseRemovals(raw, factsById, maxCandidates);
      let removed = 0;
      for (const item of removals) if (memoryRepository.deleteFact(item.factId)) removed += 1;
      if (removed) await groupMemoryService?.refreshPersona?.(scope, funConfig);
      return { ok: true, removed, removals };
    } catch (err) {
      getLogger?.()?.warn?.('[lore-reconciliation] failed: %s', String(err?.message || err));
      return { ok: false, reason: 'llm-error' };
    } finally {
      inFlight.delete(scope);
    }
  }

  return { observe, parseRemovals: (raw, facts) => parseRemovals(raw, new Map((facts || []).map((f) => [String(f.id), f])), 100), _inFlight: inFlight };
}
