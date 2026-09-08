import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPersonaOpportunityDetector,
  parsePersonaOpportunityEnvelope,
} from '../fun/services/personaOpportunityDetector.js';

process.env.FUN_DISABLE_LIVE_LLM = '0';

const group = '120363999999999@g.us';
const baseConfig = {
  zenEnabled: true,
  personaAutonomyLlmEnabled: true,
  personaAutonomyMinScore: 75,
  personaAutonomyAllowedActions: ['react', 'sticker', 'comment'],
  personaAutonomyCommentMaxChars: 140,
  personaAutonomyCandidateMinMessages: 0,
  zenSendSamplingParams: true,
};

function policy(result = { eligible: true, score: 2, reason: 'llm-preflight' }) {
  return { evaluate: () => result };
}

function context() {
  return {
    immediateContext: [
      { authorLabel: 'Lia', text: 'olha esse meme kkkkk' },
      { authorLabel: 'Rafa', text: 'eu não aguento mais' },
    ],
    groupIdentity: {
      botName: 'Puck',
      botRole: 'membro caótico',
      botTraits: ['bem-humorado'],
      voiceStyle: ['leve'],
      groupLoreSummary: 'A galera ri de memes ruins.',
    },
    confirmedFacts: [{ factText: 'O grupo coleciona memes ruins.', sensitivityLevel: 'safe' }],
    socialSignals: [{ socialSignal: 'positive', hintText: 'tom leve', confidence: 80 }],
  };
}

test('parsePersonaOpportunityEnvelope: aceita somente ação única, score e payload compatíveis', () => {
  const result = parsePersonaOpportunityEnvelope(JSON.stringify({
    action: 'react', score: 88, reason: 'piada coletiva', emoji: '😂', stickerSlug: null, commentText: null,
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.decision.outputAction, { type: 'react', emoji: '😂' });

  const invalid = parsePersonaOpportunityEnvelope(JSON.stringify({
    action: 'sticker', score: 90, reason: 'meme', emoji: '😂', stickerSlug: 'missing', commentText: null,
  }));
  assert.equal(invalid.ok, false);
});

test('persona opportunity detector: envia contexto a Zen e retorna reação validada', async () => {
  let received = null;
  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: policy(),
    generateZen: async (params) => {
      received = params;
      return JSON.stringify({
        action: 'react', score: 91, reason: 'reação coletiva', emoji: '😂', stickerSlug: null, commentText: null,
      });
    },
  });

  const result = await detector.evaluate({
    scopeKey: group,
    text: 'olha isso kkkkk',
    authorLabel: 'Lia',
    messageType: 'text',
    responseContextPack: context(),
    funConfig: baseConfig,
    now: 1_700_000_000_000,
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.action, { type: 'react', emoji: '😂' });
  assert.match(received.system, /padrão correto é PASSAR/i);
  assert.match(received.prompt, /Puck/);
  assert.match(received.prompt, /olha esse meme/i);
  assert.equal(received.jsonMode, true);
});

test('persona opportunity detector: pass, baixo score, JSON inválido e erro degradam para silêncio', async () => {
  const cases = [
    JSON.stringify({ action: 'pass', score: 99, reason: 'conversa privada', emoji: null, stickerSlug: null, commentText: null }),
    JSON.stringify({ action: 'comment', score: 70, reason: 'baixa confiança', emoji: null, stickerSlug: null, commentText: 'oi' }),
    '{invalid json',
  ];

  for (const raw of cases) {
    const detector = createPersonaOpportunityDetector({ autonomyPolicy: policy(), generateZen: async () => raw });
    const result = await detector.evaluate({
      scopeKey: group,
      text: 'kkkk olha isso',
      responseContextPack: context(),
      funConfig: baseConfig,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.action, null);
  }

  const failing = createPersonaOpportunityDetector({
    autonomyPolicy: policy(),
    generateZen: async () => { throw new Error('timeout'); },
  });
  const result = await failing.evaluate({
    scopeKey: group,
    text: 'kkkk olha isso',
    responseContextPack: context(),
    funConfig: baseConfig,
  });
  assert.equal(result.reason, 'llm-error');
});

test('persona opportunity detector: não chama LLM quando política bloqueia', async () => {
  let calls = 0;
  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: policy({ eligible: false, reason: 'quiet-hours', score: 0 }),
    generateZen: async () => { calls += 1; return ''; },
  });

  const result = await detector.evaluate({ scopeKey: group, text: 'kkkk', responseContextPack: context(), funConfig: baseConfig });
  assert.equal(result.reason, 'quiet-hours');
  assert.equal(calls, 0);
});

test('persona opportunity detector: lote de 40 mensagens acumula e só chama LLM na 40ª com 10 de contexto (50 total)', async () => {
  let zenCalls = 0;
  let receivedParams = null;
  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: policy(),
    generateZen: async (params) => {
      zenCalls += 1;
      receivedParams = params;
      return JSON.stringify({
        action: 'react',
        target_message_index: 25,
        score: 89,
        reason: 'piada no meio do lote',
        emoji: '🔥',
        stickerSlug: null,
        commentText: null,
      });
    },
  });

  const batchConfig = {
    ...baseConfig,
    personaAutonomyBatchSize: 40,
    personaAutonomyBatchContextMessages: 10,
  };

  // Simular 39 mensagens: nenhuma deve disparar flush nem chamar LLM
  for (let i = 1; i <= 39; i += 1) {
    const obs = detector.observeMessage({
      scopeKey: group,
      text: `mensagem de teste número ${i}`,
      authorLabel: `User${i}`,
      funConfig: batchConfig,
    });
    assert.equal(obs.observed, true);
    assert.equal(obs.shouldFlush, false);
    assert.equal(obs.count, i);
  }
  assert.equal(zenCalls, 0);

  // 40ª mensagem: deve indicar shouldFlush = true
  const obs40 = detector.observeMessage({
    scopeKey: group,
    text: 'mensagem de teste número 40 kkkk',
    authorLabel: 'User40',
    funConfig: batchConfig,
  });
  assert.equal(obs40.observed, true);
  assert.equal(obs40.shouldFlush, true);
  assert.equal(obs40.count, 40);
  assert.equal(zenCalls, 0);

  // Executar evaluateBatch no lote de 40
  const result = await detector.evaluateBatch({
    scopeKey: group,
    responseContextPack: context(),
    funConfig: batchConfig,
    now: 1_700_000_000_000,
  });

  assert.equal(zenCalls, 1);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.action, { type: 'react', emoji: '🔥' });
  assert.equal(result.count, 40);
  assert.equal(result.targetMessage.text, 'mensagem de teste número 26');
  assert.match(receivedParams.prompt, /mensagem de teste número 1/);
  assert.match(receivedParams.prompt, /mensagem de teste número 40/);

  // Buffer de mensagens deve estar vazio após flush, e contextTail deve ter 10 mensagens
  const buf = detector.getBuffer(group);
  assert.equal(buf.messages.length, 0);
  assert.equal(buf.contextTail.length, 10);
  assert.equal(buf.contextTail[0].text, 'mensagem de teste número 31');
  assert.equal(buf.contextTail[9].text, 'mensagem de teste número 40 kkkk');

  // Adicionar mais 40 mensagens no segundo lote
  for (let i = 41; i <= 80; i += 1) {
    detector.observeMessage({
      scopeKey: group,
      text: `mensagem de teste número ${i}`,
      authorLabel: `User${i}`,
      funConfig: batchConfig,
    });
  }

  const result2 = await detector.evaluateBatch({
    scopeKey: group,
    responseContextPack: context(),
    funConfig: batchConfig,
    now: 1_700_000_000_000,
  });

  assert.equal(zenCalls, 2);
  // O segundo prompt deve conter mensagens do contextTail marcadas como CONTEXTO
  assert.match(receivedParams.prompt, /CONTEXTO/);
  assert.match(receivedParams.prompt, /mensagem de teste número 31/);
  assert.match(receivedParams.prompt, /NOVA/);
  assert.match(receivedParams.prompt, /mensagem de teste número 80/);
});

test('persona opportunity detector: falha no lote reencadeia mensagens no buffer', async () => {
  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: policy(),
    generateZen: async () => { throw new Error('zen timeout'); },
  });

  const batchConfig = {
    ...baseConfig,
    personaAutonomyBatchSize: 40,
    personaAutonomyBatchContextMessages: 10,
  };

  for (let i = 1; i <= 40; i += 1) {
    detector.observeMessage({
      scopeKey: group,
      text: `msg ${i}`,
      funConfig: batchConfig,
    });
  }

  const result = await detector.evaluateBatch({
    scopeKey: group,
    responseContextPack: context(),
    funConfig: batchConfig,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'llm-error');
  assert.equal(result.requeued, 40);

  // Mensagens foram restauradas para tentar novamente
  const buf = detector.getBuffer(group);
  assert.equal(buf.messages.length, 40);
  assert.equal(buf.messages[0].text, 'msg 1');
  assert.equal(buf.messages[39].text, 'msg 40');
});

