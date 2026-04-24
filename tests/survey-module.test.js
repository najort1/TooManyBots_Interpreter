import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteSession, getSession, initDb, upsertSurveyTypeDefinition } from '../db/index.js';
import {
  checkSurveyFrequencyRules,
  recordSurveyUserResponse,
  upsertSurveyFrequencyRule,
} from '../db/surveyFrequencyRepository.js';
import { DashboardServer } from '../dashboard/server.js';
import { handleIncoming } from '../engine/flowEngine.js';
import { createSurveyBroadcastService } from '../engine/surveyBroadcastService.js';
import { INTERNAL_VAR, SESSION_STATUS } from '../config/constants.js';
import { parseSurveyQuestionResponse } from '../utils/surveyRuntime.js';

await initDb();

test('survey runtime validates dedicated question types', () => {
  assert.deepEqual(parseSurveyQuestionResponse('10', { type: 'nps' }).response.numericValue, 10);
  assert.equal(parseSurveyQuestionResponse('11', { type: 'nps' }).valid, false);
  assert.deepEqual(parseSurveyQuestionResponse('5', { type: 'scale_0_5' }).response.numericValue, 5);
  assert.equal(parseSurveyQuestionResponse('6', { type: 'scale_0_5' }).valid, false);
  assert.equal(parseSurveyQuestionResponse('sim', { type: 'boolean' }).response.numericValue, 1);
  assert.equal(parseSurveyQuestionResponse('nao', { type: 'boolean' }).response.numericValue, 0);
  assert.equal(parseSurveyQuestionResponse('talvez', { type: 'boolean' }).valid, false);
});

test('survey frequency rules block repeated responses inside configured windows', () => {
  const surveyTypeId = `survey_frequency_${Date.now()}`;
  const jid = `55119999${String(Date.now()).slice(-6)}@s.whatsapp.net`;
  const nowTs = Date.now();

  upsertSurveyTypeDefinition({
    typeId: surveyTypeId,
    name: 'Frequency test',
    schema: {
      status: 'active',
      questions: [{ id: 'q_1', text: 'Nota?', type: 'nps', required: true }],
    },
    isActive: true,
  });
  upsertSurveyFrequencyRule(surveyTypeId, {
    maxResponsesPerUser: 1,
    periodUnit: 'month',
    periodValue: 1,
    minIntervalSeconds: 3600,
  });

  assert.equal(checkSurveyFrequencyRules({ surveyTypeId, jid, nowTs }).allowed, true);
  recordSurveyUserResponse({ surveyTypeId, jid, instanceId: 'instance_1', triggerType: 'session_end', respondedAt: nowTs });

  const blocked = checkSurveyFrequencyRules({ surveyTypeId, jid, nowTs: nowTs + 1000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'max-responses-per-period');
});

test('survey broadcast rejects groups and starts individual survey sessions', async () => {
  const surveyTypeId = `survey_broadcast_${Date.now()}`;
  const userJid = `55118888${String(Date.now()).slice(-6)}@s.whatsapp.net`;
  const groupJid = `120363${String(Date.now()).slice(-10)}@g.us`;
  const flow = {
    flowPath: '/tmp/survey-broadcast-flow.tmb',
    runtimeConfig: { conversationMode: 'conversation' },
  };

  upsertSurveyTypeDefinition({
    typeId: surveyTypeId,
    name: 'Broadcast test',
    schema: {
      status: 'active',
      title: 'Pesquisa rapida',
      description: 'Ajude a melhorar o atendimento.',
      questions: [{ id: 'q_1', text: 'Recomenda?', type: 'boolean', required: true }],
    },
    isActive: true,
  });

  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      return { ok: true };
    },
  };
  const service = createSurveyBroadcastService({ logger: null, getSendDelayMs: () => 0 });

  await assert.rejects(
    () => service.send({ sock, flow, surveyTypeId, selectedJids: [groupJid] }),
    /groups-not-allowed/
  );

  const result = await service.send({ sock, flow, surveyTypeId, selectedJids: [userJid] });
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(String(sent[0].payload?.text || ''), /Ola, queremos convidar voce/);
  assert.doesNotMatch(String(sent[0].payload?.text || ''), /Antes de encerrar/);
  assert.match(String(sent[0].payload?.text || ''), /Pesquisa rapida/);
  assert.match(String(sent[0].payload?.text || ''), /Deseja responder/);

  const session = getSession(userJid, { flowPath: flow.flowPath, botType: 'conversation' });
  assert.equal(session.waitingFor, 'satisfaction-survey');
  assert.equal(session.variables.__satisfactionSurveyState.surveyTypeId, surveyTypeId);
  assert.equal(session.variables.__satisfactionSurveyState.mode, 'dedicated');
  assert.equal(session.variables.__satisfactionSurveyState.awaitingConsent, true);
});

test('dedicated survey response thanks the user and does not trigger normal flow', async () => {
  const now = Date.now();
  const surveyTypeId = `survey_dedicated_complete_${now}`;
  const userJid = `55117777${String(now).slice(-6)}@s.whatsapp.net`;
  const flow = {
    flowPath: `/tmp/survey-dedicated-complete-${now}.tmb`,
    runtimeConfig: { conversationMode: 'conversation' },
    blocks: [
      {
        id: 'start',
        type: 'initial-message',
        config: { text: 'Bem-vindo ao fluxo normal' },
      },
    ],
  };

  upsertSurveyTypeDefinition({
    typeId: surveyTypeId,
    name: 'Dedicated completion test',
    schema: {
      status: 'active',
      title: 'Pesquisa de atendimento',
      description: 'Sua resposta ajuda a melhorar nosso atendimento.',
      questions: [{ id: 'nps_score', text: 'Recomenda?', type: 'nps', required: true }],
    },
    isActive: true,
  });

  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      return { ok: true };
    },
  };
  const service = createSurveyBroadcastService({ logger: null, getSendDelayMs: () => 0 });

  try {
    await service.send({ sock, flow, surveyTypeId, selectedJids: [userJid] });
    await handleIncoming(sock, userJid, 'sim', null, flow, `survey-consent-${now}`);
    await handleIncoming(sock, userJid, '10', null, flow, `survey-answer-${now}`);

    const texts = sent.map(item => String(item.payload?.text || '')).filter(Boolean);
    assert.equal(texts.some(text => text.includes('Pesquisa de atendimento')), true);
    assert.equal(texts.some(text => text.includes('Recomenda?')), true);
    assert.equal(texts.some(text => text.includes('Obrigado pelo seu feedback')), true);
    assert.equal(texts.some(text => text.includes('Bem-vindo ao fluxo normal')), false);

    const endedSession = getSession(userJid, { flowPath: flow.flowPath, botType: 'conversation' });
    assert.equal(endedSession?.status, SESSION_STATUS.ENDED);
    assert.equal(
      endedSession?.variables?.[INTERNAL_VAR.SESSION_END_REASON],
      'dedicated-survey-completed'
    );
  } finally {
    deleteSession(userJid, { flowPath: flow.flowPath, botType: 'conversation' });
  }
});

test('dedicated survey decline ends session and does not trigger normal flow', async () => {
  const now = Date.now();
  const surveyTypeId = `survey_dedicated_decline_${now}`;
  const userJid = `55116666${String(now).slice(-6)}@s.whatsapp.net`;
  const flow = {
    flowPath: `/tmp/survey-dedicated-decline-${now}.tmb`,
    runtimeConfig: { conversationMode: 'conversation' },
    blocks: [
      {
        id: 'start',
        type: 'initial-message',
        config: { text: 'Bem-vindo ao fluxo normal' },
      },
    ],
  };

  upsertSurveyTypeDefinition({
    typeId: surveyTypeId,
    name: 'Dedicated decline test',
    schema: {
      status: 'active',
      title: 'Pesquisa opcional',
      description: 'Voce pode recusar se preferir.',
      questions: [{ id: 'nps_score', text: 'Recomenda?', type: 'nps', required: true }],
    },
    isActive: true,
  });

  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      return { ok: true };
    },
  };
  const service = createSurveyBroadcastService({ logger: null, getSendDelayMs: () => 0 });

  try {
    await service.send({ sock, flow, surveyTypeId, selectedJids: [userJid] });
    await handleIncoming(sock, userJid, 'nao', null, flow, `survey-decline-${now}`);

    const texts = sent.map(item => String(item.payload?.text || '')).filter(Boolean);
    assert.equal(texts.some(text => text.includes('Tudo bem, obrigado pelo seu tempo')), true);
    assert.equal(texts.some(text => text.includes('Bem-vindo ao fluxo normal')), false);
    assert.equal(texts.some(text => text.includes('Recomenda?')), false);

    const endedSession = getSession(userJid, { flowPath: flow.flowPath, botType: 'conversation' });
    assert.equal(endedSession?.status, SESSION_STATUS.ENDED);
    assert.equal(
      endedSession?.variables?.[INTERNAL_VAR.SESSION_END_REASON],
      'dedicated-survey-declined'
    );
  } finally {
    deleteSession(userJid, { flowPath: flow.flowPath, botType: 'conversation' });
  }
});

test('dashboard server keeps dedicated survey route handlers registered', () => {
  const handler = async () => ({ ok: true });
  const server = new DashboardServer({
    onCreateSurvey: handler,
    onUpdateSurvey: handler,
    onSetSurveyStatus: handler,
    onDuplicateSurvey: handler,
    onGetSurveyFrequency: handler,
    onUpdateSurveyFrequency: handler,
    onListAvailableSurveysForBot: handler,
    onLinkSurveyToBot: handler,
    onUnlinkSurveyFromBot: handler,
    onBroadcastSurvey: handler,
  });

  assert.equal(server.onCreateSurvey, handler);
  assert.equal(server.onUpdateSurvey, handler);
  assert.equal(server.onSetSurveyStatus, handler);
  assert.equal(server.onDuplicateSurvey, handler);
  assert.equal(server.onGetSurveyFrequency, handler);
  assert.equal(server.onUpdateSurveyFrequency, handler);
  assert.equal(server.onListAvailableSurveysForBot, handler);
  assert.equal(server.onLinkSurveyToBot, handler);
  assert.equal(server.onUnlinkSurveyFromBot, handler);
  assert.equal(server.onBroadcastSurvey, handler);
});
