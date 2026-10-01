import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { isLlmFeatureEnabled } from '../llm/llmGovernance.js';
import {
  buildFactTemporalContext,
  formatDatedFact,
  resolveFactTimeZone,
} from '../utils/factTemporalContext.js';
import { hasRetractionIntent } from '../utils/retractionIntent.js';
import { normalizeKey, tokenSet } from '../utils/textSimilarity.js';

const RETRACTION_STOP_WORDS = new Set([
  'tira', 'tirar', 'tirem', 'tire', 'tiram', 'arranca', 'arrancar',
  'apaga', 'apagar', 'apaguem', 'apague',
  'deleta', 'deletar', 'deletem', 'delete',
  'exclui', 'excluir', 'excluam',
  'remove', 'remover', 'removam',
  'esquece', 'esquecer', 'esquecam', 'esqueça',
  'limpa', 'limpar', 'limpem', 'cancela', 'cancelar', 'some', 'sumir',
  'fato', 'fatos', 'lore', 'historia', 'historias', 'piada', 'piadas',
  'zoeira', 'disso', 'esse', 'essa', 'isso', 'aqui', 'tudo', 'nada',
  'mentira', 'fake', 'velho', 'velha', 'antigo', 'antiga', 'passado',
  'supera', 'superem', 'chega', 'para', 'pare', 'nao', 'gosto', 'gostei',
  'odeio', 'mim', 'meu', 'meus', 'minha', 'minhas', 'dele', 'dela',
  'favor', 'pfv', 'por', 'que', 'com', 'sem', 'mais', 'muito', 'gente',
]);

const SYSTEM_PROMPT = `Você reconcilia lore e memórias de um grupo de WhatsApp de amigos.
Sua função é identificar e remover fatos da lore que os membros do grupo querem esquecer, apagar, corrigir, ou que disseram que é mentira/antigo/sem graça/ultrapassado.

REGRAS:
1. Analise a mensagem do membro e a mensagem citada (se houver).
2. Compreenda gírias e expressões coloquiais em pt-BR de WhatsApp:
   - Pedidos diretos: "tira isso", "apaga", "deleta", "exclui", "some com isso", "esquece isso", "limpa isso".
   - Desgosto / incômodo / cansaço: "não gosto disso", "odeio essa piada", "para de falar disso", "chega dessa piada", "não aguento mais", "sem graça", "perdeu a graça".
   - Desmentidos / contestações: "mentira", "fake", "nunca aconteceu", "tá errado", "inventou isso", "nada a ver", "nem é verdade".
   - Fatos antigos / superados: "isso é velho", "já passou", "já era", "supera isso", "faz anos", "já mudei de vida".
3. Se o membro respondeu citando uma mensagem (quote), use a mensagem citada para identificar a qual fato ele se refere ao dizer "tira isso", "mentira", "supera", etc.
4. Conecte o autor do pedido aos fatos em que ele é o sujeito (ex.: se o autor diz "não gosto que falem de mim" ou "eu nunca fiz isso, apaga").
5. Só remova fatos quando houver intenção clara de retirada, contestação ou rejeição. NÃO remova se o membro estiver apenas rindo ("kkk"), concordando ("pior que é verdade") ou citando a lore em tom positivo.
6. Responda SOMENTE JSON: {"removals":[{"factId":"id listado","reason":"motivo curto"}]}.
7. Se nenhum fato corresponder, retorne: {"removals":[]}. Nunca invente IDs.`;

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

/**
 * Seleciona e ranqueia fatos candidatos priorizando:
 * 1. Palavras-chave do assunto presentes no texto ou citação
 * 2. Sujeito igual ao autor da mensagem ou participante citado
 * 3. Fatos mais antigos quando há intenção de antiguidade
 * 4. Fatos com maior score/atividade geral
 */
function rankCandidateFacts({
  allFacts = [],
  text = '',
  quotedText = '',
  authorJid = '',
  authorName = '',
  quotedParticipant = '',
  mentionedJids = [],
  limit = 50,
  now = Date.now(),
}) {
  const normText = normalizeKey(text);
  const normQuote = normalizeKey(quotedText);
  const combinedTokens = [...tokenSet(normText, 3), ...tokenSet(normQuote, 3)];
  const topicTokens = combinedTokens.filter((tok) => !RETRACTION_STOP_WORDS.has(tok));

  const authorNorm = normalizeKey(authorName);
  const isStaleIntent = /\b(antig[oa]|velh[oa]|passado|ja passou|ja era|supera|faz tempo|faz anos)\b/i.test(normText);
  const mentionsSet = new Set((mentionedJids || []).map(String));

  const scored = allFacts.map((fact) => {
    let score = (Number(fact.score) || 0) * 0.1;
    const factSummaryNorm = normalizeKey(fact.summary);
    const factKeywords = (fact.keywords || []).map(normalizeKey);
    const factSubjects = (fact.subjects || []).map(String);

    // 1. Sobreposição de tokens de assunto
    for (const token of topicTokens) {
      if (factSummaryNorm.includes(token)) score += 35;
      if (factKeywords.includes(token)) score += 25;
    }

    // 2. Correspondência com autor (fatos sobre o próprio autor quando ele reclama)
    if (authorJid && factSubjects.includes(String(authorJid))) score += 30;
    if (authorNorm && authorNorm.length >= 3 && factSummaryNorm.includes(authorNorm)) score += 20;

    // 3. Correspondência com participante citado
    if (quotedParticipant && factSubjects.includes(String(quotedParticipant))) score += 35;

    // 4. Membros mencionados
    for (const mJid of factSubjects) {
      if (mentionsSet.has(mJid)) score += 25;
    }

    // 5. Boost para fatos antigos se houver intenção de tempo/antiguidade
    if (isStaleIntent) {
      const ageMs = now - (Number(fact.createdAt) || now);
      if (ageMs > 7 * 86_400_000) score += 20; // > 7 dias
      else if (ageMs > 2 * 86_400_000) score += 10;
    }

    return { fact, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((item) => item.fact);
}

export function createLoreReconciliationService({
  memoryRepository,
  groupMemoryService = null,
  generateZen = openaiChatComplete,
  notifyRemoval = null,
  getLogger = () => null,
} = {}) {
  if (!memoryRepository) throw new Error('[fun/loreReconciliationService] memoryRepository required');
  const inFlight = new Set();
  const cooldowns = new Map();

  async function observe({
    scopeKey,
    text,
    quotedText = '',
    quotedParticipant = '',
    quotedParticipantName = '',
    authorJid = '',
    authorName = '',
    mentionedJids = [],
    messageKey = null,
    sock = null,
    sendText = null,
    funConfig = {},
    now = Date.now(),
  } = {}) {
    const scope = String(scopeKey || '');
    const message = String(text || '').trim();
    const quote = String(quotedText || '').trim();

    if (
      funConfig.loreReconciliationEnabled === false ||
      !scope.endsWith('@g.us') ||
      !hasRetractionIntent(message, { quotedText: quote })
    ) {
      return { ok: false, reason: 'not-requested' };
    }
    if (inFlight.has(scope)) return { ok: false, reason: 'in-flight' };

    const successCooldownMs = Math.max(5_000, Number(funConfig.loreReconciliationCooldownMs) || 60_000);
    const missCooldownMs = Math.max(1_000, Number(funConfig.loreReconciliationMissCooldownMs) || 5_000);

    if ((cooldowns.get(scope) || 0) > now) return { ok: false, reason: 'cooldown' };

    const maxCandidates = Math.max(1, Math.min(100, Number(funConfig.loreReconciliationMaxCandidates) || 50));
    const allFacts = memoryRepository.listFacts(scope, { limit: 150, minScore: 0 });
    if (!allFacts.length) return { ok: true, removed: 0, reason: 'no-facts' };

    const candidates = rankCandidateFacts({
      allFacts,
      text: message,
      quotedText: quote,
      authorJid,
      authorName,
      quotedParticipant,
      mentionedJids,
      limit: maxCandidates,
      now,
    });

    inFlight.add(scope);
    try {
      if (process.env.FUN_DISABLE_LIVE_LLM === '1' || !isLlmFeatureEnabled(funConfig, 'loreReconciliation')) {
        return { ok: false, reason: 'llm-disabled' };
      }

      const task = resolveZenTaskParams('lore_reconcile', funConfig);
      const endpoint = resolveZenEndpoint(funConfig);
      const timeZone = resolveFactTimeZone(funConfig.worldTimezone);

      const promptSections = [
        buildFactTemporalContext({ now, timeZone }),
      ];

      if (authorName || authorJid) {
        promptSections.push(`Autor da mensagem: ${authorName || authorJid}${authorJid ? ` (${authorJid})` : ''}`);
      }
      if (quote) {
        promptSections.push(
          `Mensagem citada/respondida pelo autor:\n"${quote.slice(0, 400)}"${quotedParticipantName ? ` (de ${quotedParticipantName})` : ''}`
        );
      }
      promptSections.push(
        `Mensagem do membro:\n${message.slice(0, 600)}`,
        '',
        `Fatos candidatos deste MESMO grupo:`,
        candidates
          .map((fact) => {
            const dateStr = formatDatedFact(fact, fact.summary, timeZone);
            const subjectsList = Array.isArray(fact.subjects) && fact.subjects.length ? ` (envolve: ${fact.subjects.join(', ')})` : '';
            return `- id=${fact.id} | ${dateStr}${subjectsList}`;
          })
          .join('\n')
      );

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
        system: SYSTEM_PROMPT,
        prompt: promptSections.join('\n'),
      });

      const factsById = new Map(allFacts.map((fact) => [String(fact.id), fact]));
      const removals = parseRemovals(raw, factsById, maxCandidates);
      let removed = 0;
      for (const item of removals) {
        if (memoryRepository.deleteFact(item.factId)) removed += 1;
      }

      if (removed > 0) {
        cooldowns.set(scope, now + successCooldownMs);
        await groupMemoryService?.refreshPersona?.(scope, funConfig);

        // Feedback / confirmação
        const ackMode = String(funConfig.loreReconciliationAckMode || 'react').toLowerCase();
        const ackEmoji = String(funConfig.loreReconciliationAckEmoji || '🗑️');

        if (typeof notifyRemoval === 'function') {
          try {
            await notifyRemoval({ scopeKey: scope, messageKey, removed, removals, ackMode, ackEmoji });
          } catch {
            // notificação nunca bloqueia a conclusão
          }
        } else if (ackMode === 'react' && messageKey && typeof sock?.sendMessage === 'function') {
          try {
            await sock.sendMessage(scope, { react: { text: ackEmoji, key: messageKey } });
          } catch (err) {
            getLogger?.()?.warn?.('[lore-reconciliation] reaction ack failed: %s', String(err?.message || err));
          }
        } else if (ackMode === 'text' && typeof sendText === 'function' && sock) {
          try {
            const textMsg = removed === 1
              ? '🗑️ _Fato esquecido da lore._'
              : `🗑️ _${removed} fatos esquecidos da lore._`;
            await sendText(sock, scope, textMsg);
          } catch (err) {
            getLogger?.()?.warn?.('[lore-reconciliation] text ack failed: %s', String(err?.message || err));
          }
        }
      } else {
        // Se 0 fatos foram removidos, aplica apenas debounce curto para permitir esclarecimento imediato
        cooldowns.set(scope, now + missCooldownMs);
      }

      return { ok: true, removed, removals };
    } catch (err) {
      getLogger?.()?.warn?.('[lore-reconciliation] failed: %s', String(err?.message || err));
      cooldowns.set(scope, now + missCooldownMs);
      return { ok: false, reason: 'llm-error' };
    } finally {
      inFlight.delete(scope);
    }
  }

  return {
    observe,
    parseRemovals: (raw, facts) => parseRemovals(raw, new Map((facts || []).map((f) => [String(f.id), f])), 100),
    rankCandidateFacts,
    _inFlight: inFlight,
    _cooldowns: cooldowns,
  };
}
