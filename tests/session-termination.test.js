import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb, deleteSession, getSession } from '../db/index.js';
import { handleIncoming } from '../engine/flowEngine.js';
import { INTERNAL_VAR, SESSION_STATUS } from '../config/constants.js';
import { isSessionTerminationMessage } from '../utils/sessionTermination.js';

await initDb();

function createFlowFixture(flowPath, blocks, runtimeConfig = { conversationMode: 'conversation' }) {
  const blockMap = new Map();
  const indexMap = new Map();
  blocks.forEach((block, index) => {
    blockMap.set(block.id, block);
    indexMap.set(block.id, index);
  });

  return {
    flowPath,
    runtimeConfig,
    blocks,
    blockMap,
    indexMap,
    branchMap: new Map(),
    endIfMap: new Map(),
  };
}

test('session termination keyword detection accepts supported variations', () => {
  const positiveCases = [
    'sair',
    ' SAIR ',
    'sair do bot',
    'parar conversa',
    'parar   a    conversa',
    'encerrar',
    'ENCERRAR sessao',
    'finalizar',
    'finalizar atendimento',
    'por favor, parar atendimento agora',
    'encerrar conversas',
  ];

  const negativeCases = [
    '',
    '   ',
    'finalizar pagamento',
    'sair para almoco',
    'preciso parar o alarme',
    'conversa normal sem comando de parada',
  ];

  for (const sample of positiveCases) {
    assert.equal(
      isSessionTerminationMessage(sample),
      true,
      `expected "${sample}" to be detected as session termination`
    );
  }

  for (const sample of negativeCases) {
    assert.equal(
      isSessionTerminationMessage(sample),
      false,
      `expected "${sample}" to not be detected as session termination`
    );
  }
});

test('termination keyword immediately ends active session and blocks additional flow blocks', async () => {
  const now = Date.now();
  const jid = `terminate-session-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/session-termination-${now}.tmb`;
  const sent = [];

  const sock = {
    sendMessage: async (_jid, payload) => {
      sent.push(payload);
      return { ok: true };
    },
  };

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'Bem-vindo' } },
    { id: 'wait', type: 'send-text', config: { text: 'Como posso ajudar?', waitForResponse: true, captureResponse: false } },
    { id: 'should-not-run', type: 'send-text', config: { text: 'Fluxo continuou indevidamente', waitForResponse: false, captureResponse: false } },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ]);

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `start-${now}`);
    await handleIncoming(sock, jid, '   Encerrar   conversa   ', null, flow, `stop-${now}`);

    const sentTexts = sent.map(item => item?.text).filter(Boolean);
    assert.deepEqual(sentTexts, [
      'Bem-vindo',
      'Como posso ajudar?',
      'Sessao encerrada. Ate logo!',
    ]);
    assert.equal(sentTexts.includes('Fluxo continuou indevidamente'), false);

    const session = getSession(jid, { flowPath });
    assert.equal(session?.status, SESSION_STATUS.ENDED);
    assert.equal(session?.waitingFor, null);
    assert.equal(session?.variables?.[INTERNAL_VAR.SESSION_END_REASON], 'user-requested-stop');
  } finally {
    deleteSession(jid, { flowPath });
  }
});
