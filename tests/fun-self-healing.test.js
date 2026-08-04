import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createFunEvidenceRepository } from '../fun/db/funEvidenceRepository.js';
import { createFunSelfHealRepository } from '../fun/db/funSelfHealRepository.js';
import { createFunConversationMemoryRepository } from '../fun/db/funConversationMemoryRepository.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunProfileRepository } from '../fun/db/funProfileRepository.js';
import { createGroupMemoryService } from '../fun/services/groupMemoryService.js';
import { createSelfHealingService } from '../fun/services/selfHealingService.js';
import { validateFindingsPayload, riskForAction } from '../fun/services/selfHealingValidators.js';
import { createFunModule, resolveFunConfig } from '../fun/index.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';
import http from 'node:http';

await initDb();
const group = () => `120363${Date.now()}${Math.floor(Math.random() * 10000)}@g.us`;
const jid = () => `5511${Date.now()}${Math.floor(Math.random() * 10000)}@s.whatsapp.net`;
function setup() {
  const db = getDb(); const memory = createFunMemoryRepository({ getDatabase: () => db });
  const evidence = createFunEvidenceRepository({ getDatabase: () => db });
  const audit = createFunSelfHealRepository({ getDatabase: () => db });
  const conversationMemory = createFunConversationMemoryRepository({ getDatabase: () => db });
  const stats = createFunStatsRepository({ getDatabase: () => db });
  const market = createFunMarketRepository({ getDatabase: () => db });
  const profile = createFunProfileRepository({ getDatabase: () => db });
  return { db, memory, evidence, audit, conversationMemory, stats, market, profile };
}

function selfHealing(deps, generateZen, config = {}) {
  return createSelfHealingService({
    selfHealRepository: deps.audit, evidenceRepository: deps.evidence, memoryRepository: deps.memory,
    conversationMemoryRepository: deps.conversationMemory, statsRepository: deps.stats,
    marketRepository: deps.market, profileRepository: deps.profile,
    getConfig: () => ({ worldQuietHoursEnabled: false, selfHealDryRun: false, ...config }), generateZen,
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson({ port, path, method = 'GET', apiKey, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('C1/C2 HTTP selfheal: autenticação, config, dry-run e auditoria sem before/after', async () => {
  const deps = setup(); const scope = group(); const apiKey = `selfheal-${Date.now()}`;
  const previousKey = process.env.FUN_DASHBOARD_API_KEY;
  process.env.FUN_DASHBOARD_API_KEY = apiKey;
  let receivedRun = null;
  const port = await availablePort();
  const funModule = {
    _services: {
      repository: deps.stats,
      groupRepository: { getGroupSettings: () => ({}) },
      selfHealRepository: deps.audit,
      evidenceRepository: deps.evidence,
      selfHealingService: {
        runSweep: async (params) => {
          receivedRun = params;
          return { ok: true, runId: 'http-dry-run', mode: 'dry_run', findings: [] };
        },
      },
    },
  };
  const server = await startFunDashboardServer({
    funModule,
    getConfig: () => ({ dashboardHost: '127.0.0.1', dashboardPort: port, groupWhitelistJids: [scope], selfHealDryRun: true, selfHealIntervalMs: 60_000, selfHealEvidenceRetentionDays: 60, selfHealMaxItemsPerRun: 50, selfHealMaxCallsPerRun: 10 }),
  });
  try {
    const unauthorized = await requestJson({ port, path: '/api/fun/selfheal/config' });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, 'unauthorized');
    const config = await requestJson({ port, path: '/api/fun/selfheal/config', apiKey });
    assert.equal(config.status, 200); assert.equal(config.body.dryRun, true);
    const run = await requestJson({ port, path: '/api/fun/selfheal/run', method: 'POST', apiKey, body: { scopeKey: scope, domain: 'memory_lore', dryRun: true } });
    assert.equal(run.status, 200); assert.equal(run.body.mode, 'dry_run');
    assert.deepEqual(receivedRun, { scopeKey: scope, domain: 'memory_lore', dryRun: true });
    deps.audit.insertAudit({ runId: 'http-audit', scopeKey: scope, domain: 'memory_lore', targetTable: 'fun_group_memories', targetId: 'fact-1', action: 'report', riskLevel: 'low', status: 'applied', mode: 'live', before: { secret: 'before' }, after: { secret: 'after' } });
    const audit = await requestJson({ port, path: '/api/fun/selfheal/audit', apiKey });
    assert.equal(audit.status, 200); assert.equal(audit.body.entries.length, 1);
    assert.ok(!Object.hasOwn(audit.body.entries[0], 'before')); assert.ok(!Object.hasOwn(audit.body.entries[0], 'after'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousKey === undefined) delete process.env.FUN_DASHBOARD_API_KEY;
    else process.env.FUN_DASHBOARD_API_KEY = previousKey;
  }
});

test('FIX# self-healing: fallback usa configuração Zen normalizada e envia prompt JSON', async () => {
  const scope = group();
  const originalFetch = globalThis.fetch;
  const previousDisabled = process.env.FUN_DISABLE_LIVE_LLM;
  let url;
  let request;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  globalThis.fetch = async (receivedUrl, options) => {
    url = receivedUrl;
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domain":"memory_lore","findings":[]}' } }] }),
    };
  };
  try {
    const funModule = createFunModule({
      getConfig: () => ({ enabled: true, worldQuietHoursEnabled: false, selfHealDryRun: true }),
    });
    await funModule.init();
    const result = await funModule._services.selfHealingService.runSweep({ scopeKey: scope });
    assert.equal(result.ok, true);
    assert.equal(url, 'http://localhost:20128/v1/chat/completions');
    assert.equal(request.model, 'bot-zap');
    assert.equal(request.response_format.type, 'json_object');
    assert.match(request.messages.at(-1).content, /APENAS JSON válido/);
    assert.match(request.messages.at(-1).content, /"domain":"memory_lore"/);
    assert.match(request.messages.at(-1).content, /Não há escrita nesta chamada/);
    assert.match(request.messages.at(-1).content, /PAPEL DA AUDITORIA/);
    assert.match(request.messages.at(-1).content, /NÃO é curadoria de conteúdo/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDisabled === undefined) delete process.env.FUN_DISABLE_LIVE_LLM;
    else process.env.FUN_DISABLE_LIVE_LLM = previousDisabled;
  }
});

test('FIX# self-healing: DI vence fallback e flags que desabilitam LLM não fazem rede', async () => {
  const scope = group();
  const originalFetch = globalThis.fetch;
  const previousDisabled = process.env.FUN_DISABLE_LIVE_LLM;
  let fetchCalls = 0;
  let injectedCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch não deveria executar');
  };
  try {
    const injected = createFunModule({
      getConfig: () => ({ enabled: true, worldQuietHoursEnabled: false, selfHealDryRun: true, zenEnabled: false }),
      openaiChatComplete: async () => {
        injectedCalls += 1;
        return '{"domain":"memory_lore","findings":[]}';
      },
    });
    await injected.init();
    const injectedResult = await injected._services.selfHealingService.runSweep({ scopeKey: scope });
    assert.equal(injectedResult.ok, true);
    assert.equal(injectedCalls, 1);
    assert.equal(fetchCalls, 0);

    process.env.FUN_DISABLE_LIVE_LLM = '1';
    const disabled = createFunModule({
      getConfig: () => ({ enabled: true, worldQuietHoursEnabled: false, selfHealDryRun: true, zenEnabled: false }),
    });
    await disabled.init();
    const disabledResult = await disabled._services.selfHealingService.runSweep({ scopeKey: group() });
    assert.deepEqual(
      { ok: disabledResult.ok, reason: disabledResult.reason },
      { ok: false, reason: 'llm-error' }
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDisabled === undefined) delete process.env.FUN_DISABLE_LIVE_LLM;
    else process.env.FUN_DISABLE_LIVE_LLM = previousDisabled;
  }
});

test('C1: captura evidência elegível sem duplicar message_id', () => {
  const { memory, evidence } = setup(); const scope = group(); const author = jid();
  const service = createGroupMemoryService({ memoryRepository: memory, evidenceRepository: evidence });
  service.observeMessage({ scopeKey: scope, userJid: author, messageId: 'm-1', text: 'Hoje eu derrubei café no teclado de novo', funConfig: { selfHealEvidenceRetentionDays: 60 }, now: 1000 });
  service.observeMessage({ scopeKey: scope, userJid: author, messageId: 'm-1', text: 'Hoje eu derrubei café no teclado de novo', funConfig: { selfHealEvidenceRetentionDays: 60 }, now: 1000 });
  assert.equal(evidence.countByScope(scope), 1);
});

test('validador rejeita schema inválido e classifica risco deterministicamente', () => {
  const fact = { id: 'fact-1' }; const factsById = new Map([[fact.id, fact]]);
  assert.equal(validateFindingsPayload({ domain: 'memory_lore', findings: [{ targetId: fact.id, action: 'delete', confidence: 101 }] }, { factsById }).findings.length, 0);
  assert.equal(riskForAction('fix_author'), 'low'); assert.equal(riskForAction('delete'), 'high');
});

test('memory_lore não aceita delete: auditoria valida veracidade, não faz curadoria de conteúdo', () => {
  const fact = { id: 'fact-1' }; const factsById = new Map([[fact.id, fact]]);
  const payload = validateFindingsPayload({ domain: 'memory_lore', findings: [{ targetId: fact.id, action: 'delete', confidence: 90, reason: 'descrição explícita de ato sexual' }] }, { factsById });
  assert.equal(payload.ok, true);
  assert.equal(payload.findings.length, 0);
});

test('C2: dry-run não altera lore e registra proposta simulada', async () => {
  const { memory, evidence, audit } = setup(); const scope = group(); const wrong = jid(); const correct = jid();
  const fact = memory.insertFact({ scopeKey: scope, summary: 'João derrubou café no teclado', subjects: [wrong] });
  const ev = evidence.insertEvidence({ scopeKey: scope, messageId: 'm-2', authorJid: correct, text: 'João derrubou café no teclado', now: Date.now() });
  const service = createSelfHealingService({ selfHealRepository: audit, evidenceRepository: evidence, memoryRepository: memory, getConfig: () => ({ worldQuietHoursEnabled: false, selfHealDryRun: true }), generateZen: async () => ({ domain: 'memory_lore', findings: [{ targetId: fact.id, action: 'fix_author', confidence: 99, evidenceRef: `fun_evidence_log#${ev.id}`, suggestedAuthorJid: correct, reason: 'evidência direta' }] }) });
  const result = await service.runSweep({ scopeKey: scope });
  assert.equal(result.ok, true); assert.deepEqual(memory.getFact(fact.id).subjects, [wrong]); assert.equal(audit.listAudit({ runId: result.runId })[0].status, 'simulated');
});

test('C3: fix_author corrige subjects_json no mesmo scope e audita', async () => {
  const { memory, evidence, audit } = setup(); const scope = group(); const wrong = jid(); const correct = jid();
  const fact = memory.insertFact({ scopeKey: scope, summary: 'João derrubou café no teclado', subjects: [wrong] });
  const ev = evidence.insertEvidence({ scopeKey: scope, messageId: 'm-3', authorJid: correct, text: 'João derrubou café no teclado', now: Date.now() });
  const service = createSelfHealingService({ selfHealRepository: audit, evidenceRepository: evidence, memoryRepository: memory, getConfig: () => ({ worldQuietHoursEnabled: false, selfHealDryRun: false }), generateZen: async () => ({ domain: 'memory_lore', findings: [{ targetId: fact.id, action: 'fix_author', confidence: 99, evidenceRef: `fun_evidence_log#${ev.id}`, suggestedAuthorJid: correct, reason: 'evidência direta' }] }) });
  const result = await service.runSweep({ scopeKey: scope });
  assert.equal(result.findings[0].status, 'applied'); assert.equal(memory.getFact(fact.id).subjects[0], correct); assert.equal(result.findings[0].decided_by, 'system');
});

test('C4/C8: fato sem evidência torna-se unverified sem exclusão e GC remove expirados', async () => {
  const { memory, evidence, audit } = setup(); const scope = group(); const fact = memory.insertFact({ scopeKey: scope, summary: 'Fato antigo sem fonte', subjects: [jid()] });
  evidence.insertEvidence({ scopeKey: scope, messageId: 'expired', authorJid: jid(), text: 'fonte expirada', now: 1, retentionDays: 1 });
  const service = createSelfHealingService({ selfHealRepository: audit, evidenceRepository: evidence, memoryRepository: memory, getConfig: () => ({ worldQuietHoursEnabled: false, selfHealDryRun: false }), generateZen: async () => ({ domain: 'memory_lore', findings: [{ targetId: fact.id, action: 'flag_unverifiable', confidence: 90, reason: 'sem fonte' }] }) });
  await service.runSweep({ scopeKey: scope, now: 100000000 });
  assert.equal(memory.getFact(fact.id).evidenceStatus, 'unverified'); assert.ok(memory.getFact(fact.id)); assert.equal(evidence.countByScope(scope), 0);
});

test('C5: falha de LLM não altera lore', async () => {
  const { memory, evidence, audit } = setup(); const scope = group(); const fact = memory.insertFact({ scopeKey: scope, summary: 'Fato sem alteração', subjects: [jid()] });
  const service = createSelfHealingService({ selfHealRepository: audit, evidenceRepository: evidence, memoryRepository: memory, getConfig: () => ({ worldQuietHoursEnabled: false }), generateZen: async () => '{ inválido' });
  const result = await service.runSweep({ scopeKey: scope });
  assert.equal(result.ok, false); assert.equal(memory.getFact(fact.id).summary, 'Fato sem alteração'); assert.equal(audit.listAudit({ runId: result.runId })[0].status, 'error');
});

test('US2: promote_confidence aplica somente no scope e merge_duplicates consolida', async () => {
  const deps = setup(); const scope = group();
  const primary = deps.conversationMemory.create({ scopeKey: scope, subjectUserJid: jid(), factText: 'Prefere café sem açúcar', factKey: 'cafe', confidence: 0.35 });
  const duplicate = deps.conversationMemory.create({ scopeKey: scope, subjectUserJid: primary.memory.subjectUserJid, factText: 'Prefere café sem açúcar mesmo', factKey: 'cafe', confidence: 0.8, keywords: ['café'] });
  const service = selfHealing(deps, async () => ({ domain: 'conversation_memory', findings: [
    { targetId: primary.memory.id, action: 'promote_confidence', confidence: 95, suggestedConfidence: 0.9, reason: 'confirmações repetidas' },
    { targetId: primary.memory.id, action: 'merge_duplicates', duplicateId: duplicate.memory.id, confidence: 90, reason: 'mesmo sujeito e fato' },
  ] }));
  const result = await service.runSweep({ scopeKey: scope, domain: 'conversation_memory' });
  assert.equal(result.ok, true); assert.equal(deps.conversationMemory.getById(scope, primary.memory.id).confirmationLevel, 'confirmed');
  assert.equal(deps.conversationMemory.getById(scope, duplicate.memory.id).suppressed, true);
});

test('US2: downgrade e suppress ficam pending_review e memória sensível não é exposta', async () => {
  const deps = setup(); const scope = group();
  const safe = deps.conversationMemory.create({ scopeKey: scope, factText: 'Gosta de jogos de tabuleiro', confidence: 0.8 });
  deps.conversationMemory.create({ scopeKey: scope, factText: 'Dado privado', confidence: 0.8, sensitivityLevel: 'sensitive' });
  let received;
  const service = selfHealing(deps, async ({ memories }) => { received = memories; return { domain: 'conversation_memory', findings: [
    { targetId: safe.memory.id, action: 'downgrade', suggestedConfidence: 0.2, confidence: 90, reason: 'contradição posterior' },
    { targetId: safe.memory.id, action: 'suppress', confidence: 90, reason: 'contradição confirmada' },
  ] }; });
  const result = await service.runSweep({ scopeKey: scope, domain: 'conversation_memory' });
  assert.equal(received.length, 1); assert.equal(received[0].id, safe.memory.id);
  assert.equal(deps.conversationMemory.getById(scope, safe.memory.id).confidence, 0.8);
  assert.equal(result.findings.every((finding) => finding.status === 'pending_review'), true);
});

test('C6: invariantes econômicos e de perfil geram integrity_fix pendente sem escrita; revisão é idempotente', async () => {
  const deps = setup(); const scope = group(); const user = jid();
  deps.stats.ensureUserRow(user, scope);
  deps.db.prepare('UPDATE analytics.fun_user_stats SET coins=-5 WHERE user_jid=? AND scope_key=?').run(user, scope);
  const service = selfHealing(deps, async ({ invariants }) => ({ domain: 'economy', findings: invariants.map((item) => ({ targetId: item.id, action: 'integrity_fix', confidence: 99, reason: item.reason })) }));
  const result = await service.runSweep({ scopeKey: scope, domain: 'economy' });
  assert.equal(deps.stats.getUserStats(user, scope).coins, -5); assert.equal(result.findings[0].status, 'pending_review');
  const first = deps.audit.reviewFinding(result.findings[0].id, { decision: 'apply', adminJid: 'admin' });
  const second = deps.audit.reviewFinding(result.findings[0].id, { decision: 'reject', adminJid: 'admin' });
  assert.equal(first.ok, true); assert.deepEqual(second, { ok: false, reason: 'already-decided' });
});

test('C7/T033: config normaliza caps; serviço limita itens e tick limita chamadas, quiet hours e falhas', async () => {
  const config = resolveFunConfig({ selfHealMaxItemsPerRun: 0, selfHealMaxCallsPerRun: 999 });
  assert.equal(config.selfHealMaxItemsPerRun, 1); assert.equal(config.selfHealMaxCallsPerRun, 500);
  const deps = setup(); const scope = group();
  for (let i = 0; i < 3; i += 1) deps.memory.insertFact({ scopeKey: scope, summary: `Fato ${i}`, subjects: [jid()] });
  let calls = 0; let itemCount = 0;
  const service = selfHealing(deps, async ({ facts }) => { calls += 1; itemCount = facts.length; return { domain: 'memory_lore', findings: [] }; }, { selfHealMaxItemsPerRun: 1 });
  await service.runSweep({ scopeKey: scope });
  assert.equal(calls, 1); assert.equal(itemCount, 1);
  const scopes = [group(), group(), group()]; const swept = [];
  const mod = createFunModule({
    getConfig: () => ({ enabled: true, worldAutonomous: true, worldQuietHoursEnabled: false, groupWhitelistJids: scopes, selfHealEnabled: true, selfHealIntervalMs: 1, selfHealMaxCallsPerRun: 2 }),
    selfHealingService: { runSweep: async ({ scopeKey }) => { swept.push(scopeKey); if (scopeKey === scopes[0]) throw new Error('stub-failure'); return { ok: true }; } },
  });
  const tick = await mod.tickWorldEvents({ now: 1_000, sendText: async () => {} });
  assert.equal(swept.length, 2); assert.equal(tick.results.some((result) => result.reason === 'stub-failure'), true);
  const quietMod = createFunModule({ getConfig: () => ({ enabled: true, worldAutonomous: true, worldQuietHoursEnabled: true, worldQuietHourStart: 0, worldQuietHourEnd: 24, groupWhitelistJids: [group()], selfHealEnabled: true, selfHealIntervalMs: 1, selfHealMaxCallsPerRun: 1 }), selfHealingService: { runSweep: async () => { throw new Error('não deve executar'); } } });
  const quiet = await quietMod.tickWorldEvents({ now: 1_000, sendText: async () => {} });
  assert.equal(quiet.results.some((result) => result.kind === 'self-heal'), false);
});

test('US3: preço fora do range e report de perfil não alteram fonte de verdade', async () => {
  const deps = setup(); const scope = group();
  deps.market.ensurePrices(scope); const price = deps.market.listPrices(scope)[0];
  deps.db.prepare('UPDATE analytics.fun_market_prices SET price=0 WHERE scope_key=? AND item_id=?').run(scope, price.itemId);
  const marketService = selfHealing(deps, async ({ invariants }) => ({ domain: 'economy', findings: invariants.map((item) => ({ targetId: item.id, action: 'report', confidence: 90, reason: item.reason })) }));
  const marketResult = await marketService.runSweep({ scopeKey: scope, domain: 'economy' });
  assert.equal(deps.db.prepare('SELECT price FROM analytics.fun_market_prices WHERE scope_key=? AND item_id=?').get(scope, price.itemId).price, 0); assert.equal(marketResult.findings[0].status, 'applied');
  const profile = deps.profile.upsertProfile({ userJid: jid(), scopeKey: scope, nickname: 'duplicado' }).profile;
  const profileService = selfHealing(deps, async () => ({ domain: 'profile', findings: [{ targetId: profile.userJid, action: 'report', confidence: 90, reason: 'perfil precisa revisão' }] }));
  const profileResult = await profileService.runSweep({ scopeKey: scope, domain: 'profile' });
  assert.equal(profileResult.findings[0].status, 'applied'); assert.equal(deps.profile.getProfile(profile.userJid, scope).nickname, 'duplicado');
});
