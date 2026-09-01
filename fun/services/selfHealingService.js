import { randomUUID } from 'crypto';
import { isWorldQuietHours } from '../utils/worldQuietHours.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { validateFindingsPayload, validateEvidenceFinding } from './selfHealingValidators.js';
import { buildFactTemporalContext, resolveFactTimeZone } from '../utils/factTemporalContext.js';

export function createSelfHealingService({ selfHealRepository, evidenceRepository, memoryRepository, conversationMemoryRepository, statsRepository, marketRepository, profileRepository, getLogger = () => null, generateZen, getConfig = () => ({}) } = {}) {
  if (!selfHealRepository || !evidenceRepository || !memoryRepository) throw new Error('[fun/selfHealingService] repositories required');
  function domainState(scopeKey, domain, limit) {
    if (domain === 'memory_lore') {
      const facts = memoryRepository.listFacts(scopeKey, { limit, minScore: 0 });
      return { items: facts, targetTable: 'fun_group_memories', tools: { list_facts: () => ({ facts }) } };
    }
    if (domain === 'conversation_memory') {
      const memories = conversationMemoryRepository?.listForAudit({ scopeKey, limit }) || [];
      return { items: memories, targetTable: 'fun_conversation_memories', tools: { list_memories: () => ({ memories }) } };
    }
    if (domain === 'economy') {
      const invariants = [
        ...(statsRepository?.listBalanceInvariants(scopeKey, limit) || []),
        ...(marketRepository?.listPriceInvariants(scopeKey, limit) || []),
      ].slice(0, limit);
      return { items: invariants, targetTable: 'integrity', tools: { list_invariants: () => ({ invariants }) } };
    }
    if (domain === 'profile') {
      const invariants = (statsRepository?.listProfileOrphans(scopeKey, limit) || []).slice(0, limit);
      return { items: invariants, targetTable: 'fun_user_profiles', tools: { list_invariants: () => ({ invariants }) } };
    }
    return null;
  }
  async function runSweep({ scopeKey, domain = 'memory_lore', dryRun, now = Date.now() } = {}) {
    const config = getConfig() || {};
    if (isWorldQuietHours(config, now)) return { ok: false, reason: 'quiet-hours' };
    const configuredMaxItems = Number(config.selfHealMaxItemsPerRun);
    const maxItemsPerRun = Math.min(500, Math.max(1, Math.floor(Number.isFinite(configuredMaxItems) ? configuredMaxItems : 50)));
    const state = domainState(scopeKey, domain, maxItemsPerRun);
    if (!state) return { ok: false, reason: 'unsupported-domain' };
    evidenceRepository.gcExpired(now);
    const itemsById = new Map(state.items.map((item) => [String(item.id), item]));
    const runId = randomUUID(); const mode = (dryRun ?? config.selfHealDryRun) ? 'dry_run' : 'live';
    const tools = {
      ...state.tools,
      find_evidence: ({ authorJid, text }) => ({ matches: evidenceRepository.findByAuthorAndText(scopeKey, authorJid, text) }),
      get_stats: () => ({ items: state.items.length, evidenceRows: evidenceRepository.countByScope(scopeKey) }),
    };
    if (typeof generateZen !== 'function') return { ok: false, reason: 'llm-unavailable', runId, tools };
    const prompt = [
      ...(domain === 'memory_lore'
        ? [
            buildFactTemporalContext({
              now,
              timeZone: resolveFactTimeZone(config.worldTimezone),
            }),
          ]
        : []),
      'Audite somente os dados públicos e auditáveis abaixo. Não há escrita nesta chamada.',
      `Retorne APENAS JSON válido: {"domain":"${domain}","findings":[...]}.`,
      'Cada finding deve respeitar o contrato selfheal: targetId, action, confidence (0-100), reason e campos exigidos pela action. Não invente dados nem fatos.',
      'PAPEL DA AUDITORIA: validar VERACIDADE, AUTORIA, CONSISTÊNCIA e DUPLICIDADE dos fatos da lore do grupo. NÃO é curadoria de conteúdo.',
      'A lore vem de grupos de WhatsApp BR: gírias, palavrões, duplo sentido e humor pesado são a cultura normal do grupo e NUNCA são motivo para nenhum finding (delete, downgrade ou flag). Conteúdo vulgar ou ofensivo não é defeito de dado.',
      'Só proponha ações para problemas reais de integridade: fato que contradiz outro fato do mesmo grupo, autoria claramente trocada, fato duplicado, ou texto que não é lore (spam, dado pessoal, comando de bot, instrução técnica).',
      'Sem certeza sobre um fato, prefira flag_unverifiable (baixo risco) ou report em vez de ações destrutivas.',
      'Se tudo estiver íntegro, retorne {"findings":[]}. Não force achados: inventar problemas é pior do que não achar nenhum.',
      `Dados selecionados: ${JSON.stringify(state.items)}`,
    ].join('\n');
    let payload;
    try {
      payload = await generateZen({ ...resolveZenTaskParams('selfheal', config), prompt, tools, domain, facts: domain === 'memory_lore' ? state.items : undefined, memories: domain === 'conversation_memory' ? state.items : undefined, invariants: domain === 'economy' || domain === 'profile' ? state.items : undefined });
      if (typeof payload === 'string') payload = JSON.parse(payload);
    } catch (error) {
      selfHealRepository.insertAudit({ runId, scopeKey, domain, targetTable: state.targetTable, targetId: '0', action: 'report', riskLevel: 'low', status: 'error', reason: error?.message || 'llm-error', mode, createdAt: now });
      return { ok: false, reason: 'llm-error', runId, tools };
    }
    const validated = validateFindingsPayload(payload, { domain, factsById: itemsById });
    if (!validated.ok) return { ok: false, reason: validated.reason, runId, tools };
    const results = [];
    for (const finding of validated.findings) {
      const before = itemsById.get(finding.targetId);
      const evidenceId = String(finding.evidenceRef || '').match(/^fun_evidence_log#(\d+)$/)?.[1];
      const evidence = evidenceId ? evidenceRepository.getById(evidenceId, scopeKey) : null;
      if (evidence && before?.summary) evidence.similarity = evidenceRepository.similarity(before.summary, evidence.text);
      const evidenceCheck = domain === 'memory_lore' ? validateEvidenceFinding(finding, evidence, before) : { ok: true };
      let status = 'rejected'; let after = null;
      if (finding.riskLevel === 'high') status = 'pending_review';
      else if (!evidenceCheck.ok) status = 'rejected';
      else if (mode === 'dry_run') status = 'simulated';
      else if (finding.action === 'report') status = 'applied';
      else if (domain === 'memory_lore' && finding.action === 'fix_author') after = memoryRepository.updateFactAuthor(before.id, scopeKey, finding.suggestedAuthorJid);
      else if (domain === 'memory_lore' && finding.action === 'fix_text') after = memoryRepository.updateFactSummary(before.id, scopeKey, finding.suggestedText);
      else if (domain === 'memory_lore' && finding.action === 'flag_unverifiable') after = memoryRepository.setFactEvidenceStatus(before.id, scopeKey, 'unverified');
      else if (domain === 'conversation_memory' && finding.action === 'promote_confidence') after = conversationMemoryRepository.promoteConfidence({ scopeKey, id: before.id, confidence: finding.suggestedConfidence, now });
      else if (domain === 'conversation_memory' && finding.action === 'merge_duplicates') after = conversationMemoryRepository.mergeDuplicateMemories({ scopeKey, primaryId: before.id, duplicateId: finding.duplicateId, now });
      if (after?.ok === false) after = null;
      if (after) status = 'applied';
      const audit = selfHealRepository.insertAudit({ runId, scopeKey, domain, targetTable: state.targetTable, targetId: before.id, action: finding.action, riskLevel: finding.riskLevel, status, before, after: after?.memory || after, reason: finding.reason || '', evidenceRef: finding.evidenceRef || null, llmConfidence: finding.confidence, mode, createdAt: now, ...((status === 'applied' || status === 'simulated') ? { decidedAt: now, decidedBy: 'system' } : {}) });
      results.push(audit);
    }
    return { ok: true, runId, mode, findings: results, tools };
  }
  return { runSweep };
}
