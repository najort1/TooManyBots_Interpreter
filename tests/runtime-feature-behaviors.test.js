import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initDb,
  deleteSession,
  getSession,
  updateSession,
  listSatisfactionSurveyResponses,
} from '../db/index.js';
import { handleIncoming } from '../engine/flowEngine.js';
import { INTERNAL_VAR, WAIT_TYPE, SESSION_STATUS } from '../config/constants.js';

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

function createSocketRecorder() {
  const sent = [];
  return {
    sent,
    sock: {
      sendMessage: async (targetJid, payload) => {
        sent.push({ targetJid, payload });
        return { ok: true };
      },
    },
  };
}

test('startPolicyLimit blocks new session starts when max starts is exceeded', async () => {
  const now = Date.now();
  const jid = `start-limit-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/start-limit-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'inicio' } },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ], {
    conversationMode: 'conversation',
    startPolicy: 'max-per-period',
    startPolicyLimit: {
      maxStarts: 1,
      period: 'day',
      blockedMessage: 'Limite diario atingido.',
    },
  });

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `msg-a-${now}`);
    await handleIncoming(sock, jid, 'oi novamente', null, flow, `msg-b-${now}`);

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.includes('inicio'), true);
    assert.equal(texts.includes('Limite diario atingido.'), true);

    const session = getSession(jid, { flowPath });
    assert.equal(session?.status, SESSION_STATUS.ENDED);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('session timeout preset quick-30m overrides custom sessionTimeoutMinutes', async () => {
  const now = Date.now();
  const jid = `timeout-preset-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/timeout-preset-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const flow = createFlowFixture(flowPath, [
    {
      id: 'ask',
      type: 'send-text',
      config: { text: 'Aguardando resposta', waitForResponse: true, captureResponse: false, keywords: [] },
    },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ], {
    conversationMode: 'conversation',
    sessionLimits: {
      sessionTimeoutPreset: 'quick-30m',
      sessionTimeoutMinutes: 999,
      timeoutMessage: 'Sessao expirada por preset.',
    },
  });

  try {
    await handleIncoming(sock, jid, 'inicio', null, flow, `start-${now}`);
    const active = getSession(jid, { flowPath });
    assert.equal(active?.status, SESSION_STATUS.ACTIVE);

    updateSession(jid, {
      variables: {
        ...(active?.variables || {}),
        [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: Date.now() - (31 * 60 * 1000),
      },
    }, { flowPath });

    await handleIncoming(sock, jid, 'mensagem tardia', null, flow, `late-${now}`);

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.includes('Sessao expirada por preset.'), true);

    const ended = getSession(jid, { flowPath });
    assert.equal(ended?.status, SESSION_STATUS.ENDED);
    assert.equal(ended?.variables?.[INTERNAL_VAR.SESSION_END_REASON], 'timeout');
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('contextPersistence restores configured global variables on next session start', async () => {
  const now = Date.now();
  const jid = `context-memory-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/context-memory-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const flow = createFlowFixture(flowPath, [
    {
      id: 'ask-name',
      type: 'send-text',
      config: {
        text: 'Nome atual: {{$nome}}',
        waitForResponse: true,
        captureResponse: true,
        captureVariable: 'nome',
        keywords: [],
      },
    },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ], {
    conversationMode: 'conversation',
    contextPersistence: {
      variablePersistence: '7-days',
      globalVariables: ['nome'],
      memoryModeEnabled: true,
    },
  });

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `ctx-1-${now}`);
    await handleIncoming(sock, jid, 'Davi', null, flow, `ctx-2-${now}`);
    await handleIncoming(sock, jid, 'novo ciclo', null, flow, `ctx-3-${now}`);

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.some(text => text === 'Nome atual: Davi'), true);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('endBehavior.sendSatisfactionSurvey stores numeric responses and ends session', async () => {
  const now = Date.now();
  const jid = `survey-answer-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/survey-answer-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'Inicio' } },
    { id: 'end', type: 'end-conversation', config: { message: 'Encerrando' } },
  ], {
    conversationMode: 'conversation',
    endBehavior: {
      sendClosingMessage: true,
      sendSatisfactionSurvey: {
        enabled: true,
        questionType: 'rating-scale',
        scale: 5,
        timeoutMinutes: 10,
        thankYouMessage: 'Valeu pelo feedback!',
      },
    },
  });

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `survey-1-${now}`);

    const waitingSession = getSession(jid, { flowPath });
    assert.equal(waitingSession?.waitingFor, WAIT_TYPE.SATISFACTION_SURVEY);

    await handleIncoming(sock, jid, '4', null, flow, `survey-2-${now}`);

    const rows = listSatisfactionSurveyResponses({ jid, flowPath, limit: 10 });
    assert.equal(rows.some(row => row.rating === 4 && row.timedOut === false), true);

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.includes('Valeu pelo feedback!'), true);

    const endedSession = getSession(jid, { flowPath });
    assert.equal(endedSession?.status, SESSION_STATUS.ENDED);
    assert.equal(endedSession?.variables?.[INTERNAL_VAR.SESSION_END_REASON], 'satisfaction-completed');
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('satisfaction survey timeout finalizes session and records timeout outcome', async () => {
  const now = Date.now();
  const jid = `survey-timeout-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/survey-timeout-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'Inicio' } },
    { id: 'end', type: 'end-conversation', config: { message: 'Encerrando' } },
  ], {
    conversationMode: 'conversation',
    endBehavior: {
      sendClosingMessage: true,
      sendSatisfactionSurvey: {
        enabled: true,
        questionType: 'rating-scale',
        scale: 5,
        timeoutMinutes: 0,
        thankYouMessage: 'Obrigado mesmo sem resposta.',
      },
    },
  });

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `survey-timeout-1-${now}`);

    const rows = listSatisfactionSurveyResponses({ jid, flowPath, limit: 10 });
    assert.equal(rows.some(row => row.rating == null && row.timedOut === true), true);

    const endedSession = getSession(jid, { flowPath });
    assert.equal(endedSession?.status, SESSION_STATUS.ENDED);
    assert.equal(endedSession?.variables?.[INTERNAL_VAR.SESSION_END_REASON], 'satisfaction-timeout');

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.includes('Obrigado mesmo sem resposta.'), true);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('availability blocks session start outside allowed schedule', async () => {
  const now = Date.now();
  const jid = `availability-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/availability-${now}.tmb`;
  const { sent, sock } = createSocketRecorder();

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
  }).format(new Date(now)).toLowerCase();
  const blockedDay = weekdays.find(day => day !== currentWeekday) || 'sunday';

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'Inicio' } },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ], {
    conversationMode: 'conversation',
    availability: {
      restrictBySchedule: true,
      allowedDays: [blockedDay],
      timeRangeStart: '00:00',
      timeRangeEnd: '23:59',
      outsideScheduleMessage: 'Atendimento indisponivel agora.',
      includeBrazilNationalHolidays: false,
      timezone: 'America/Sao_Paulo',
    },
  });

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `avail-${now}`);

    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.equal(texts.includes('Atendimento indisponivel agora.'), true);

    const session = getSession(jid, { flowPath });
    assert.equal(session, null);
  } finally {
    deleteSession(jid, { flowPath });
  }
});
