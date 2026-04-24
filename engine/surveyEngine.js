/**
 * engine/surveyEngine.js
 *
 * Extracted survey-related logic from flowEngine.js.
 */

import {
  saveSatisfactionSurveyResponse,
  createSurveyInstance,
  saveSurveyResponse,
  markSurveyInstanceCompleted,
  markSurveyInstanceAbandoned,
  recordSurveyUserResponse,
  updateRealtimeSurveyMetrics,
} from '../db/index.js';
import { emitConversationEvent } from './conversationEvents.js';
import { interpolate } from './utils.js';
import { sendTextMessage } from './sender.js';
import {
  buildSatisfactionSurveyQuestion,
  parseSatisfactionSurveyResponse,
} from '../utils/satisfactionSurvey.js';
import {
  buildSurveyQuestionPrompt,
  parseSurveyConsentResponse,
  parseSurveyQuestionResponse,
} from '../utils/surveyRuntime.js';
import {
  buildPostSessionSurveyState,
  shouldTriggerPostSessionSurvey,
} from '../runtime/sessionEndSurveyTrigger.js';
import {
  SESSION_STATUS,
  WAIT_TYPE,
  INTERNAL_VAR,
  BLOCK_TYPE,
} from '../config/constants.js';

// These helpers are imported from flowEngine.js to avoid duplication
// and maintain consistency in session management.
import {
  persistSessionPatch,
  buildSessionScope,
  getSessionId,
  getSessionUserKey,
  endSession,
} from './flowEngine.js';

export const SATISFACTION_INVALID_MESSAGE = 'Resposta invalida. Envie apenas um numero dentro da escala informada.';
export const SURVEY_INVALID_MESSAGE = 'Resposta invalida. Revise a pergunta e tente novamente.';

export function getSatisfactionSurveyConfig(flow) {
  const endBehavior = flow?.runtimeConfig?.endBehavior ?? {};
  const cfg = endBehavior.sendSatisfactionSurvey;
  if (typeof cfg === 'boolean') {
    return {
      enabled: cfg,
      questionType: 'rating-scale',
      scale: 5,
      timeoutMinutes: 5,
      thankYouMessage: 'Obrigado pelo seu feedback!',
    };
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return {
      enabled: false,
      questionType: 'rating-scale',
      scale: 5,
      timeoutMinutes: 5,
      thankYouMessage: 'Obrigado pelo seu feedback!',
    };
  }
  const scaleRaw = Number(cfg.scale);
  const timeoutRaw = Number(cfg.timeoutMinutes);
  return {
    enabled: cfg.enabled === true,
    questionType: String(cfg.questionType ?? 'rating-scale').trim().toLowerCase() || 'rating-scale',
    scale: Math.max(1, Math.min(10, Number.isFinite(scaleRaw) ? Math.floor(scaleRaw) : 5)),
    timeoutMinutes: Math.max(0, Math.min(24 * 60, Number.isFinite(timeoutRaw) ? Math.floor(timeoutRaw) : 5)),
    thankYouMessage: String(cfg.thankYouMessage ?? 'Obrigado pelo seu feedback!').trim() || 'Obrigado pelo seu feedback!',
  };
}

export function flowHasSurveyBlock(flow) {
  const blocks = Array.isArray(flow?.blocks) ? flow.blocks : [];
  return blocks.some(block => String(block?.type || '').trim() === BLOCK_TYPE.SURVEY);
}

export function getSatisfactionSurveyState(session) {
  const raw = session?.variables?.[INTERNAL_VAR.SATISFACTION_SURVEY_STATE];
  if (!raw) return null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function buildSatisfactionSurveyState(flow, session, nowTs) {
  const config = getSatisfactionSurveyConfig(flow);
  if (!config.enabled) return null;

  const timeoutAt = nowTs + (config.timeoutMinutes * 60 * 1000);
  return {
    mode: 'end-behavior',
    questionType: config.questionType,
    scale: config.scale,
    timeoutMinutes: config.timeoutMinutes,
    timeoutAt,
    thankYouMessage: config.thankYouMessage,
    createdAt: nowTs,
    sessionId: getSessionId(session),
  };
}

export function isBlockSurveyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  return String(state.mode || '').trim().toLowerCase() === 'block';
}

export function isDedicatedSurveyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const mode = String(state.mode || '').trim().toLowerCase();
  return mode === 'dedicated' || mode === 'dedicated-broadcast';
}

export function buildSurveyConversationContext(session) {
  const context = {
    lastMessage: String(session?.variables?.[INTERNAL_VAR.LAST_MESSAGE] ?? ''),
    lastIncomingMessageId: String(session?.variables?.[INTERNAL_VAR.LAST_INCOMING_MESSAGE_ID] ?? ''),
    lastIncomingListId: String(session?.variables?.[INTERNAL_VAR.LAST_INCOMING_LIST_ID] ?? ''),
  };
  return JSON.stringify(context);
}

export function ensureBlockSurveyInstance(surveyState, session, flow, jid, nowTs) {
  if (String(surveyState?.instanceId || '').trim()) {
    return String(surveyState.instanceId).trim();
  }

  const resolvedSurveyTypeId = String(surveyState?.surveyTypeId || '').trim() || 'csat';
  try {
    const created = createSurveyInstance({
      surveyTypeId: resolvedSurveyTypeId,
      flowPath: flow?.flowPath ?? '',
      blockId: String(surveyState?.contextBlockId || '').trim(),
      sessionId: getSessionId(session),
      jid: getSessionUserKey(session, jid),
      startedAt: Number(surveyState?.startedAt) || nowTs,
      conversationContext: buildSurveyConversationContext(session),
    });
    return String(created?.instanceId || '').trim();
  } catch {
    const fallback = createSurveyInstance({
      surveyTypeId: 'csat',
      flowPath: flow?.flowPath ?? '',
      blockId: String(surveyState?.contextBlockId || '').trim(),
      sessionId: getSessionId(session),
      jid: getSessionUserKey(session, jid),
      startedAt: Number(surveyState?.startedAt) || nowTs,
      conversationContext: buildSurveyConversationContext(session),
    });
    return String(fallback?.instanceId || '').trim();
  }
}

export async function finalizeBlockSurvey(
  sock,
  jid,
  session,
  flow,
  nowTs,
  {
    completed = true,
    abandonmentReason = 'timeout',
  } = {}
) {
  const surveyState = getSatisfactionSurveyState(session);
  if (!isBlockSurveyState(surveyState) && !isDedicatedSurveyState(surveyState)) {
    return session;
  }

  const workingState = {
    ...surveyState,
    instanceId: ensureBlockSurveyInstance(surveyState, session, flow, jid, nowTs),
  };
  const scope = buildSessionScope(flow);
  const nextVariables = {
    ...session.variables,
    [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: undefined,
  };
  const fallbackNextBlockIndex = Number(session.blockIndex) + 1;
  const configuredNextBlockIndex = Number(workingState.nextBlockIndex);
  const nextBlockIndex = Number.isInteger(configuredNextBlockIndex) && configuredNextBlockIndex >= 0
    ? configuredNextBlockIndex
    : fallbackNextBlockIndex;

  if (completed) {
    markSurveyInstanceCompleted({
      instanceId: workingState.instanceId,
      completedAt: nowTs,
    });
    recordSurveyUserResponse({
      surveyTypeId: String(workingState.surveyTypeId || '').trim(),
      jid: getSessionUserKey(session, jid),
      instanceId: workingState.instanceId,
      triggerType: String(workingState.triggerType || workingState.source || 'inline-block'),
      respondedAt: nowTs,
    });
  } else {
    markSurveyInstanceAbandoned({
      instanceId: workingState.instanceId,
      abandonedAt: nowTs,
      abandonmentReason,
    });
  }

  const realtimeMetrics = updateRealtimeSurveyMetrics({
    typeId: String(workingState.surveyTypeId || '').trim(),
    flowPath: flow?.flowPath ?? '',
    nowTs,
  });

  let resolvedSession = persistSessionPatch(jid, scope, session, {
    waitingFor: null,
    blockIndex: nextBlockIndex,
    variables: nextVariables,
  });

  if (completed) {
    const thankYouMessage = String(workingState.thankYouMessage ?? '').trim();
    if (thankYouMessage) {
      await sendTextMessage(sock, jid, thankYouMessage);
    }
  } else {
    const timeoutMessage = String(workingState.timeoutMessage ?? '').trim();
    if (timeoutMessage) {
      await sendTextMessage(sock, jid, timeoutMessage);
    }
  }

  emitConversationEvent({
    occurredAt: nowTs,
    eventType: completed ? 'survey:response:completed' : 'survey:response:abandoned',
    direction: 'system',
    jid: getSessionUserKey(session, jid),
    flowPath: flow?.flowPath ?? '',
    messageText: completed ? 'Pesquisa concluida' : 'Pesquisa abandonada',
    metadata: {
      instanceId: workingState.instanceId,
      surveyTypeId: String(workingState.surveyTypeId || '').trim(),
      completed,
      abandonmentReason: completed ? '' : abandonmentReason,
      responseCount: Array.isArray(workingState.responses) ? workingState.responses.length : 0,
      blockId: String(workingState.contextBlockId || '').trim(),
    },
  });

  emitConversationEvent({
    occurredAt: nowTs,
    eventType: 'survey:metrics:updated',
    direction: 'system',
    jid: 'system',
    flowPath: flow?.flowPath ?? '',
    messageText: 'Metricas de pesquisa atualizadas',
    metadata: {
      surveyTypeId: String(workingState.surveyTypeId || '').trim(),
      metrics: realtimeMetrics?.overview ?? null,
      calculatedAt: realtimeMetrics?.calculatedAt ?? nowTs,
    },
  });

  if (isDedicatedSurveyState(workingState) || workingState.endSessionOnComplete === true) {
    resolvedSession = endSession(
      jid,
      resolvedSession,
      nowTs,
      completed ? 'dedicated-survey-completed' : 'dedicated-survey-abandoned',
      flow
    );
  }

  return resolvedSession;
}

export async function finalizeEndBehaviorSatisfactionSurvey(
  sock,
  jid,
  session,
  flow,
  nowTs,
  {
    rating = null,
    timedOut = false,
    reason = 'satisfaction-survey',
  } = {}
) {
  const surveyState = getSatisfactionSurveyState(session);
  if (!surveyState || isBlockSurveyState(surveyState)) {
    return endSession(jid, session, nowTs, reason, flow);
  }

  saveSatisfactionSurveyResponse({
    jid: getSessionUserKey(session, jid),
    flowPath: flow?.flowPath ?? '',
    sessionId: String(surveyState.sessionId ?? '').trim(),
    questionType: String(surveyState.questionType ?? 'rating-scale'),
    scale: Number(surveyState.scale) || 5,
    rating,
    timedOut,
    thankYouMessage: String(surveyState.thankYouMessage ?? ''),
    createdAt: Number(surveyState.createdAt) || nowTs,
    answeredAt: timedOut ? null : nowTs,
  });

  const thankYouMessage = String(surveyState.thankYouMessage ?? '').trim();
  if (thankYouMessage) {
    await sendTextMessage(sock, jid, thankYouMessage);
  }

  return endSession(jid, session, nowTs, reason, flow);
}

export async function finalizeSatisfactionSurvey(
  sock,
  jid,
  session,
  flow,
  nowTs,
  options = {}
) {
  const surveyState = getSatisfactionSurveyState(session);
  if (isBlockSurveyState(surveyState) || isDedicatedSurveyState(surveyState)) {
    const timedOut = options?.timedOut === true;
    return finalizeBlockSurvey(sock, jid, session, flow, nowTs, {
      completed: !timedOut,
      abandonmentReason: timedOut ? String(options?.reason || 'timeout') : '',
    });
  }
  return finalizeEndBehaviorSatisfactionSurvey(sock, jid, session, flow, nowTs, options);
}

export function isPendingSatisfactionSurveyTimedOut(session, nowTs) {
  if (session?.waitingFor !== WAIT_TYPE.SATISFACTION_SURVEY) return false;
  const surveyState = getSatisfactionSurveyState(session);
  if (!surveyState) return false;
  const timeoutAt = Number(surveyState.timeoutAt) || 0;
  if (timeoutAt <= 0) return false;
  return nowTs >= timeoutAt;
}

export async function maybeStartSatisfactionSurvey(sock, jid, session, flow, nowTs) {
  const surveyState = buildSatisfactionSurveyState(flow, session, nowTs);
  if (!surveyState) {
    return { started: false, session };
  }

  const questionText = buildSatisfactionSurveyQuestion({
    questionType: surveyState.questionType,
    scale: surveyState.scale,
  });
  await sendTextMessage(sock, jid, questionText);

  const scope = buildSessionScope(flow);
  const nextSession = persistSessionPatch(jid, scope, session, {
    waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: surveyState,
    },
  });

  if (surveyState.timeoutMinutes <= 0) {
    const ended = await finalizeSatisfactionSurvey(sock, jid, nextSession, flow, nowTs, {
      rating: null,
      timedOut: true,
      reason: 'satisfaction-timeout',
    });
    return { started: true, session: ended };
  }
  return { started: true, session: nextSession };
}

export async function maybeStartDedicatedPostSessionSurvey(sock, jid, session, flow, nowTs, triggerType = 'session_end') {
  const decision = shouldTriggerPostSessionSurvey({
    flow,
    session,
    jid,
    triggerType,
    nowTs,
  });

  if (!decision.shouldTrigger) {
    return { started: false, session, reason: decision.reason };
  }

  const stateBuild = buildPostSessionSurveyState({
    surveyTypeId: decision.surveyTypeId,
    triggerType: decision.triggerType || triggerType,
    session,
    flow,
    nowTs,
  });

  if (!stateBuild.ok) {
    emitConversationEvent({
      occurredAt: nowTs,
      eventType: 'survey:trigger:skipped',
      direction: 'system',
      jid: getSessionUserKey(session, jid),
      flowPath: flow?.flowPath ?? '',
      messageText: 'Pesquisa dedicada nao iniciada',
      metadata: {
        reason: stateBuild.error || 'invalid-survey',
        surveyTypeId: decision.surveyTypeId || '',
        triggerType,
      },
    });
    return { started: false, session, reason: stateBuild.error || 'invalid-survey' };
  }

  await sendTextMessage(sock, jid, interpolate(stateBuild.firstPrompt, session.variables || {}));
  const scope = buildSessionScope(flow);
  const nextSession = persistSessionPatch(jid, scope, session, {
    waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: stateBuild.state,
    },
  });

  emitConversationEvent({
    occurredAt: nowTs,
    eventType: 'survey:trigger:started',
    direction: 'system',
    jid: getSessionUserKey(session, jid),
    flowPath: flow?.flowPath ?? '',
    messageText: 'Pesquisa dedicada iniciada',
    metadata: {
      surveyTypeId: decision.surveyTypeId,
      triggerType: decision.triggerType || triggerType,
      questionCount: stateBuild.questions.length,
    },
  });

  return { started: true, session: nextSession };
}

export async function resolveSatisfactionSurveyWait(sock, jid, message, session, flow, nowTs) {
  if (session?.waitingFor !== WAIT_TYPE.SATISFACTION_SURVEY) {
    return { handled: false, session };
  }

  if (isPendingSatisfactionSurveyTimedOut(session, nowTs)) {
    const ended = await finalizeSatisfactionSurvey(sock, jid, session, flow, nowTs, {
      rating: null,
      timedOut: true,
      reason: 'satisfaction-timeout',
    });
    return { handled: true, session: ended };
  }

  const surveyState = getSatisfactionSurveyState(session);
  if (!surveyState) {
    const ended = endSession(jid, session, nowTs, 'satisfaction-invalid-state', flow);
    return { handled: true, session: ended };
  }

  if (isBlockSurveyState(surveyState) || isDedicatedSurveyState(surveyState)) {
    const questions = Array.isArray(surveyState.questions) ? surveyState.questions : [];
    const currentQuestionIndex = Math.max(0, Number(surveyState.questionIndex) || 0);

    if (isDedicatedSurveyState(surveyState) && surveyState.awaitingConsent !== false) {
      const consent = parseSurveyConsentResponse(message);
      if (!consent.valid) {
        const consentInvalidMessage = String(
          surveyState.consentInvalidMessage || 'Para responder a pesquisa, envie 1 ou sim. Para recusar, envie 2 ou nao.'
        ).trim();
        await sendTextMessage(sock, jid, consentInvalidMessage);
        return { handled: true, session };
      }

      if (!consent.accepted) {
        const declineMessage = String(surveyState.declineMessage || 'Tudo bem, obrigado pelo seu tempo.').trim();
        if (declineMessage) {
          await sendTextMessage(sock, jid, declineMessage);
        }
        emitConversationEvent({
          occurredAt: nowTs,
          eventType: 'survey:response:declined',
          direction: 'system',
          jid: getSessionUserKey(session, jid),
          flowPath: flow?.flowPath ?? '',
          messageText: 'Pesquisa recusada pelo usuario',
          metadata: {
            surveyTypeId: String(surveyState.surveyTypeId || '').trim(),
            triggerType: String(surveyState.triggerType || surveyState.source || 'dedicated'),
          },
        });
        return {
          handled: true,
          session: endSession(jid, session, nowTs, 'dedicated-survey-declined', flow),
        };
      }

      const nextState = {
        ...surveyState,
        awaitingConsent: false,
        consentAcceptedAt: nowTs,
      };
      const scope = buildSessionScope(flow);
      const updatedSession = persistSessionPatch(jid, scope, session, {
        waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
        variables: {
          ...session.variables,
          [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: nextState,
        },
      });
      const firstQuestion = questions[currentQuestionIndex];
      if (!firstQuestion) {
        const finalized = await finalizeBlockSurvey(sock, jid, updatedSession, flow, nowTs, {
          completed: true,
        });
        return { handled: true, session: finalized };
      }
      const firstPrompt = interpolate(buildSurveyQuestionPrompt(firstQuestion, {
        index: currentQuestionIndex,
        total: questions.length,
      }), updatedSession.variables || {});
      await sendTextMessage(sock, jid, firstPrompt);
      return { handled: true, session: updatedSession };
    }

    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) {
      const finalized = await finalizeBlockSurvey(sock, jid, session, flow, nowTs, {
        completed: true,
      });
      return { handled: isDedicatedSurveyState(surveyState), session: finalized };
    }

    const parsed = parseSurveyQuestionResponse(message, currentQuestion);
    if (!parsed.valid) {
      const invalidMessage = String(surveyState.invalidMessage || SURVEY_INVALID_MESSAGE).trim() || SURVEY_INVALID_MESSAGE;
      await sendTextMessage(sock, jid, invalidMessage);
      return { handled: true, session };
    }

    const nextState = {
      ...surveyState,
      instanceId: ensureBlockSurveyInstance(surveyState, session, flow, jid, nowTs),
      responses: Array.isArray(surveyState.responses) ? [...surveyState.responses] : [],
    };

    const responsePayload = {
      questionId: String(currentQuestion.id || `q_${currentQuestionIndex + 1}`),
      questionType: String(currentQuestion.type || 'text'),
      numericValue: parsed.response.numericValue,
      textValue: parsed.response.textValue,
      choiceId: parsed.response.choiceId,
      choiceIds: parsed.response.choiceIds,
      respondedAt: nowTs,
    };

    saveSurveyResponse({
      instanceId: nextState.instanceId,
      ...responsePayload,
    });
    nextState.responses.push(responsePayload);

    const scope = buildSessionScope(flow);
    const nextQuestionIndex = currentQuestionIndex + 1;
    if (nextQuestionIndex >= questions.length) {
      const sessionWithState = persistSessionPatch(jid, scope, session, {
        variables: {
          ...session.variables,
          [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: nextState,
        },
      });
      const finalized = await finalizeBlockSurvey(sock, jid, sessionWithState, flow, nowTs, {
        completed: true,
      });
      return { handled: isDedicatedSurveyState(nextState), session: finalized };
    }

    nextState.questionIndex = nextQuestionIndex;
    const updatedSession = persistSessionPatch(jid, scope, session, {
      waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: nextState,
      },
    });

    const nextQuestion = questions[nextQuestionIndex];
    const nextPrompt = interpolate(buildSurveyQuestionPrompt(nextQuestion, {
      index: nextQuestionIndex,
      total: questions.length,
    }), updatedSession.variables || {});
    await sendTextMessage(sock, jid, nextPrompt);
    return { handled: true, session: updatedSession };
  }

  const parsed = parseSatisfactionSurveyResponse(message, {
    scale: Number(surveyState.scale) || 5,
    min: surveyState.questionType === 'nps' ? 0 : 1,
  });

  if (!parsed.valid) {
    await sock.sendMessage(jid, { text: SATISFACTION_INVALID_MESSAGE });
    return { handled: true, session };
  }

  const ended = await finalizeSatisfactionSurvey(sock, jid, session, flow, nowTs, {
    rating: parsed.value,
    timedOut: false,
    reason: 'satisfaction-completed',
  });
  return { handled: true, session: ended };
}
