/**
 * engine/flowEngine.js
 *
 * Core interpreter. Given a session and an incoming message,
 * this module drives the flow forward block by block.
 */

import { HANDLERS } from '../handlers/index.js';
import {
  getSession,
  createSession,
  updateSession,
  getActiveSessions,
  getActiveSessionsPage,
  deleteSession,
  createConversationSessionRecord,
  finishConversationSessionRecord,
} from '../db/index.js';
import { emitConversationEvent } from './conversationEvents.js';
import { LRUCache } from './utils.js';
import { parseCommandInput } from './commandParser.js';
import { getFlowBotType } from './flowLoader.js';
import { resolveKeyword } from './resolvers/keywordResolver.js';
import { resolveList } from './resolvers/listResolver.js';
import { resolveMultipleChoice } from './resolvers/multipleChoiceResolver.js';
import { sendTextMessage } from './sender.js';
import { isSessionTerminationMessage } from '../utils/sessionTermination.js';
import { stringifyError } from '../utils/errors.js';
import {
  SESSION_STATUS,
  WAIT_TYPE,
  ENGINE_LIMITS,
  INTERNAL_VAR,
  BLOCK_TYPE,
} from '../config/constants.js';

const userLocks = new Map();
const SESSION_TERMINATION_REASON = 'user-requested-stop';
const SESSION_TERMINATION_MESSAGE = 'Sessao encerrada. Ate logo!';

function normalizeFlowPath(flow) {
  return String(flow?.flowPath ?? '').trim();
}

function buildSessionScope(flow) {
  return {
    flowPath: normalizeFlowPath(flow),
    botType: getFlowBotType(flow),
  };
}

function buildLockKey(jid, flow) {
  return `${String(jid ?? '').trim()}::${normalizeFlowPath(flow)}`;
}

function createFlowScopedSocket(sock, flow) {
  if (!sock || typeof sock !== 'object') return sock;
  const flowPath = normalizeFlowPath(flow);
  if (!flowPath || typeof sock.sendMessage !== 'function') return sock;

  const scopedSock = Object.create(sock);
  scopedSock.sendMessage = (jid, content, options = {}) => {
    const safeOptions = options && typeof options === 'object' ? { ...options } : {};
    if (safeOptions.__flowPath == null) {
      safeOptions.__flowPath = flowPath;
    }
    return sock.sendMessage(jid, content, safeOptions);
  };
  return scopedSock;
}

async function executeWithLock(jid, flow, task) {
  const lockKey = buildLockKey(jid, flow);
  while (userLocks.has(lockKey)) {
    await userLocks.get(lockKey).catch(() => {});
  }

  let resolveLock;
  const lockPromise = new Promise(resolve => {
    resolveLock = resolve;
  });
  userLocks.set(lockKey, lockPromise);

  try {
    return await task();
  } finally {
    if (userLocks.get(lockKey) === lockPromise) {
      userLocks.delete(lockKey);
    }
    resolveLock();
  }
}

const PROCESSED_IDS = new LRUCache(ENGINE_LIMITS.PROCESSED_IDS_MAX, ENGINE_LIMITS.PROCESSED_IDS_TTL_MS);
const engineRuntimeStats = {
  duplicateDropped: 0,
  handleIncomingCount: 0,
  handleIncomingFailed: 0,
  handleIncomingTotalMs: 0,
  runEngineStepsTotal: 0,
  runEngineYieldCount: 0,
  sessionReads: 0,
  sessionWrites: 0,
  handlerStats: new Map(),
  maxStepsHitCount: 0,
};

const ENGINE_LOOP_YIELD_EVERY_STEPS = Math.max(10, Number(process.env.TMB_ENGINE_YIELD_EVERY_STEPS) || 25);
const ENGINE_LOOP_YIELD_TIME_BUDGET_MS = Math.max(5, Number(process.env.TMB_ENGINE_YIELD_TIME_BUDGET_MS) || 20);

export function clearEngineRuntimeCaches() {
  PROCESSED_IDS.clear();
  engineRuntimeStats.duplicateDropped = 0;
  engineRuntimeStats.handleIncomingCount = 0;
  engineRuntimeStats.handleIncomingFailed = 0;
  engineRuntimeStats.handleIncomingTotalMs = 0;
  engineRuntimeStats.runEngineStepsTotal = 0;
  engineRuntimeStats.runEngineYieldCount = 0;
  engineRuntimeStats.sessionReads = 0;
  engineRuntimeStats.sessionWrites = 0;
  engineRuntimeStats.handlerStats = new Map();
  engineRuntimeStats.maxStepsHitCount = 0;
}

export function getEngineRuntimeStats() {
  const handlerBreakdown = [...engineRuntimeStats.handlerStats.values()]
    .map(item => ({
      type: item.type,
      count: item.count,
      failed: item.failed,
      avgMs: safeAverage(item.totalMs, item.count),
      maxMs: Number(item.maxMs || 0),
      totalMs: Number(item.totalMs || 0),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const totalHandled = Number(engineRuntimeStats.handleIncomingCount || 0);
  const totalHandlerInvocations = handlerBreakdown.reduce((acc, item) => acc + item.count, 0);
  return {
    duplicateDropped: Number(engineRuntimeStats.duplicateDropped || 0),
    handleIncomingCount: totalHandled,
    handleIncomingFailed: Number(engineRuntimeStats.handleIncomingFailed || 0),
    handleIncomingAvgMs: safeAverage(engineRuntimeStats.handleIncomingTotalMs, totalHandled),
    runEngineStepsTotal: Number(engineRuntimeStats.runEngineStepsTotal || 0),
    runEngineAvgSteps: safeAverage(engineRuntimeStats.runEngineStepsTotal, totalHandled),
    runEngineYieldCount: Number(engineRuntimeStats.runEngineYieldCount || 0),
    sessionReads: Number(engineRuntimeStats.sessionReads || 0),
    sessionWrites: Number(engineRuntimeStats.sessionWrites || 0),
    avgSessionReadsPerMessage: safeAverage(engineRuntimeStats.sessionReads, totalHandled),
    avgSessionWritesPerMessage: safeAverage(engineRuntimeStats.sessionWrites, totalHandled),
    avgHandlerInvocationsPerMessage: safeAverage(totalHandlerInvocations, totalHandled),
    maxStepsHitCount: Number(engineRuntimeStats.maxStepsHitCount || 0),
    handlers: handlerBreakdown,
    updatedAt: Date.now(),
  };
}

function getRuntimeConfig(flow) {
  return flow?.runtimeConfig ?? {};
}

function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function sessionRead(jid, scope) {
  engineRuntimeStats.sessionReads += 1;
  return getSession(jid, scope);
}

function sessionWrite(jid, patch, scope) {
  engineRuntimeStats.sessionWrites += 1;
  updateSession(jid, patch, scope);
}

function sessionCreate(jid, scope) {
  engineRuntimeStats.sessionWrites += 1;
  return createSession(jid, scope);
}

function normalizeSessionState(scope, session = null) {
  if (session) {
    return {
      ...session,
      flowPath: String(session.flowPath ?? scope.flowPath ?? ''),
      botType: String(session.botType ?? scope.botType ?? 'conversation'),
      variables: session.variables && typeof session.variables === 'object' ? { ...session.variables } : {},
      waitingFor: session.waitingFor ?? null,
    };
  }

  return {
    jid: '',
    flowPath: String(scope?.flowPath ?? ''),
    botType: String(scope?.botType ?? 'conversation'),
    blockIndex: 0,
    variables: {},
    status: SESSION_STATUS.ACTIVE,
    waitingFor: null,
    updatedAt: 0,
  };
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  const leftType = typeof left;
  const rightType = typeof right;
  if (leftType !== rightType) return false;
  if (left == null || right == null) return false;
  if (leftType !== 'object') return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function computeVariablesDelta(previousVars = {}, nextVars = {}) {
  const set = {};
  const remove = [];
  const keys = new Set([
    ...Object.keys(previousVars || {}),
    ...Object.keys(nextVars || {}),
  ]);

  for (const key of keys) {
    const hasPrev = Object.prototype.hasOwnProperty.call(previousVars || {}, key);
    const hasNext = Object.prototype.hasOwnProperty.call(nextVars || {}, key);
    if (!hasNext) {
      if (hasPrev) remove.push(key);
      continue;
    }
    const prevValue = hasPrev ? previousVars[key] : undefined;
    const nextValue = nextVars[key];
    if (!hasPrev || !valuesEqual(prevValue, nextValue)) {
      set[key] = nextValue;
    }
  }

  return {
    set,
    remove,
  };
}

function applySessionPatchState(scope, session, patch = {}, { jid = '' } = {}) {
  const next = normalizeSessionState(scope, session);
  if (jid) {
    next.jid = String(jid ?? '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'blockIndex')) {
    next.blockIndex = patch.blockIndex;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    next.status = patch.status;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'waitingFor')) {
    next.waitingFor = patch.waitingFor;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'botType')) {
    next.botType = patch.botType;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'variables')) {
    next.variables = patch.variables && typeof patch.variables === 'object'
      ? patch.variables
      : {};
  }

  return next;
}

function persistSessionPatch(jid, scope, currentSession, patch = {}) {
  const dbPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'variables')) {
    const previousVars = currentSession?.variables && typeof currentSession.variables === 'object'
      ? currentSession.variables
      : {};
    const nextVars = patch.variables && typeof patch.variables === 'object'
      ? patch.variables
      : {};
    dbPatch.variablesDelta = computeVariablesDelta(previousVars, nextVars);
    delete dbPatch.variables;
  }

  sessionWrite(jid, dbPatch, scope);
  return applySessionPatchState(scope, currentSession, patch, { jid });
}

function recordHandlerMetric(blockType, durationMs, { failed = false } = {}) {
  const key = String(blockType || 'unknown');
  const current = engineRuntimeStats.handlerStats.get(key) ?? {
    type: key,
    count: 0,
    failed: 0,
    totalMs: 0,
    maxMs: 0,
  };
  current.count += 1;
  current.totalMs += Math.max(0, Number(durationMs) || 0);
  current.maxMs = Math.max(current.maxMs, Number(durationMs) || 0);
  if (failed) current.failed += 1;
  engineRuntimeStats.handlerStats.set(key, current);
}

export async function resumeSessionFromHumanHandoff({ sock, jid, flow, targetBlockIndex, actor = 'dashboard-agent' }) {
  const scope = buildSessionScope(flow);
  return executeWithLock(jid, flow, async () => {
    let session = sessionRead(jid, scope);
    if (!session) {
      return { ok: false, error: 'session-not-found' };
    }

    const totalBlocks = Array.isArray(flow?.blocks) ? flow.blocks.length : 0;
    const nextIndex = Number(targetBlockIndex);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= totalBlocks) {
      return { ok: false, error: 'invalid-target-block-index' };
    }

    const nowTs = Date.now();
    const previousHandoff = parseObjectVar(session.variables?.[INTERNAL_VAR.HUMAN_HANDOFF]);
    const nextHandoff = {
      ...previousHandoff,
      active: false,
      resumedAt: nowTs,
      resumedBy: actor,
      resumeTargetIndex: nextIndex,
    };

    session = persistSessionPatch(jid, scope, session, {
      blockIndex: nextIndex,
      waitingFor: null,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.HUMAN_HANDOFF]: nextHandoff,
        [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
      },
    });

    emitConversationEvent({
      occurredAt: nowTs,
      eventType: 'human-handoff-resumed',
      direction: 'system',
      jid,
      flowPath: flow?.flowPath ?? '',
      messageText: `Retomado no bloco ${nextIndex}`,
      metadata: {
        actor,
        targetBlockIndex: nextIndex,
      },
    });

    await runEngine(sock, jid, session, flow, {
      incoming: {
        text: '',
        listId: null,
        msgId: null,
        messageKey: null,
        receivedAt: nowTs,
      },
    });

    return {
      ok: true,
      session,
    };
  });
}

export async function endSessionFromDashboard({ jid, flow, reason = 'human-agent-ended', actor = 'dashboard-agent' }) {
  const scope = buildSessionScope(flow);
  return executeWithLock(jid, flow, async () => {
    let session = sessionRead(jid, scope);
    if (!session) {
      return { ok: false, error: 'session-not-found' };
    }

    const nowTs = Date.now();
    const previousHandoff = parseObjectVar(session.variables?.[INTERNAL_VAR.HUMAN_HANDOFF]);
    session = persistSessionPatch(jid, scope, session, {
      variables: {
        ...session.variables,
        [INTERNAL_VAR.HUMAN_HANDOFF]: {
          ...previousHandoff,
          active: false,
          closedAt: nowTs,
          closedBy: actor,
          closeReason: reason,
        },
      },
    });

    session = endSession(jid, session, nowTs, reason, flow);
    return { ok: true, session };
  });
}

function formatErrorForEvent(err) {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isCommandMode(flow) {
  const mode = String(getRuntimeConfig(flow).conversationMode ?? 'conversation').toLowerCase();
  return mode === 'command';
}

function findCommandCandidate(flow, message) {
  const blocks = Array.isArray(flow?.blocks) ? flow.blocks : [];
  let partial = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type !== BLOCK_TYPE.COMMAND_INPUT) continue;

    const parsed = parseCommandInput(message, block.config ?? {});
    if (parsed.matched) {
      return { index: i, parsed, blockId: block.id, strict: true };
    }

    if (!partial && parsed.partial) {
      partial = { index: i, parsed, blockId: block.id, strict: false };
    }
  }

  return partial;
}

function getSessionLimits(flow) {
  const limits = getRuntimeConfig(flow).sessionLimits ?? {};
  return {
    maxMessagesPerSession: Number(limits.maxMessagesPerSession) || 0,
    sessionTimeoutMinutes: Number(limits.sessionTimeoutMinutes) || 0,
    timeoutMessage: limits.timeoutMessage || 'Sessão encerrada por tempo limite.',
  };
}

function getPostEndConfig(flow) {
  const cfg = getRuntimeConfig(flow).postEnd ?? {};
  return {
    reentryPolicy: cfg.reentryPolicy ?? 'allow-always',
    cooldownMinutes: Number(cfg.cooldownMinutes) || 0,
    blockedMessage: cfg.blockedMessage || 'Este fluxo não permite novas conversas para este usuário.',
    cooldownMessage: cfg.cooldownMessage || 'Aguarde alguns minutos para iniciar uma nova conversa.',
  };
}

function shouldAllowByStartPolicy(flow) {
  const policy = String(getRuntimeConfig(flow).startPolicy ?? 'allow-always').toLowerCase();
  if (policy === 'allow-always') return true;
  if (policy === 'blocked' || policy === 'deny-always' || policy === 'disallow-always') return false;
  return true;
}

function getNumericInternalVar(session, key, fallback = 0) {
  const value = Number(session?.variables?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function createSessionId(jid, nowTs) {
  return `${jid}:${nowTs}`;
}

function getSessionId(session) {
  return String(session?.variables?.[INTERNAL_VAR.SESSION_ID] ?? '').trim();
}

function parseObjectVar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function createOrResetSessionRuntimeState(jid, nowTs, flow) {
  const scope = buildSessionScope(flow);
  const isConversationBot = scope.botType === 'conversation';
  sessionCreate(jid, scope);
  let session = sessionRead(jid, scope);
  if (!session) {
    session = normalizeSessionState(scope, null);
  }
  session.jid = jid;
  const sessionId = createSessionId(jid, nowTs);

  session = persistSessionPatch(jid, scope, session, {
    blockIndex: 0,
    waitingFor: null,
    status: SESSION_STATUS.ACTIVE,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_ID]: sessionId,
      [INTERNAL_VAR.SESSION_STARTED_AT]: nowTs,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
      [INTERNAL_VAR.SESSION_MESSAGE_COUNT]: 0,
      [INTERNAL_VAR.SESSION_ENDED_AT]: undefined,
      [INTERNAL_VAR.SESSION_END_REASON]: undefined,
    },
    botType: scope.botType,
  });

  if (isConversationBot) {
    createConversationSessionRecord({
      sessionId,
      jid,
      flowPath: flow?.flowPath ?? '',
      startedAt: nowTs,
    });

    emitConversationEvent({
      occurredAt: nowTs,
      eventType: 'session-start',
      direction: 'system',
      jid,
      flowPath: flow?.flowPath ?? '',
      messageText: '',
      metadata: { sessionId },
    });
  }

  return session;
}

function endSession(jid, session, nowTs, reason, flow) {
  if (!session) return session;
  const scope = buildSessionScope(flow);
  const isConversationBot = scope.botType === 'conversation';
  const startedAt = getNumericInternalVar(session, INTERNAL_VAR.SESSION_STARTED_AT, 0);
  const sessionId = getSessionId(session);
  const durationMs = startedAt > 0 ? Math.max(0, nowTs - startedAt) : 0;

  const endedSession = persistSessionPatch(jid, scope, session, {
    status: SESSION_STATUS.ENDED,
    waitingFor: null,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
      [INTERNAL_VAR.SESSION_ENDED_AT]: nowTs,
      [INTERNAL_VAR.SESSION_END_REASON]: reason,
    },
    botType: scope.botType,
  });

  if (isConversationBot) {
    finishConversationSessionRecord({
      sessionId,
      endedAt: nowTs,
      endReason: reason,
    });

    emitConversationEvent({
      occurredAt: nowTs,
      eventType: 'session-end',
      direction: 'system',
      jid,
      flowPath: flow?.flowPath ?? '',
      messageText: '',
      metadata: {
        reason,
        sessionId,
        durationMs,
      },
    });
  }

  return endedSession;
}

async function terminateSessionFromUserKeyword(sock, jid, message, session, flow) {
  if (!session || session.status !== SESSION_STATUS.ACTIVE) {
    return { terminated: false, session };
  }

  if (!isSessionTerminationMessage(message)) {
    return { terminated: false, session };
  }

  try {
    await sendTextMessage(sock, jid, SESSION_TERMINATION_MESSAGE);
  } catch (error) {
    console.warn(
      `[SessionTermination] Falha ao enviar mensagem de encerramento para ${jid}: ${stringifyError(error)}`
    );
  }

  return {
    terminated: true,
    session: endSession(jid, session, Date.now(), SESSION_TERMINATION_REASON, flow),
  };
}

function isSessionTimedOut(session, flow, nowTs) {
  const { sessionTimeoutMinutes } = getSessionLimits(flow);
  if (sessionTimeoutMinutes <= 0) return false;

  const lastActivityAt = getNumericInternalVar(session, INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT, 0);
  if (!lastActivityAt) return false;

  const timeoutMs = sessionTimeoutMinutes * 60 * 1000;
  return (nowTs - lastActivityAt) >= timeoutMs;
}

async function enforceSessionLimits(sock, jid, session, flow, nowTs) {
  const limits = getSessionLimits(flow);
  const scope = buildSessionScope(flow);

  if (isSessionTimedOut(session, flow, nowTs)) {
    if (limits.timeoutMessage) {
      await sock.sendMessage(jid, { text: limits.timeoutMessage });
    }
    session = endSession(jid, session, nowTs, 'timeout', flow);
    return { blocked: true, session };
  }

  const nextMessageCount = getNumericInternalVar(session, INTERNAL_VAR.SESSION_MESSAGE_COUNT, 0) + 1;
  session = persistSessionPatch(jid, scope, session, {
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_MESSAGE_COUNT]: nextMessageCount,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
    },
  });

  if (limits.maxMessagesPerSession > 0 && nextMessageCount > limits.maxMessagesPerSession) {
    if (limits.timeoutMessage) {
      await sock.sendMessage(jid, { text: limits.timeoutMessage });
    }
    session = endSession(jid, session, nowTs, 'max-messages', flow);
    return { blocked: true, session };
  }

  return { blocked: false, session };
}

async function resolveSessionStartPolicy(sock, jid, session, flow, nowTs) {
  const postEnd = getPostEndConfig(flow);

  if (!shouldAllowByStartPolicy(flow)) {
    if (postEnd.blockedMessage) {
      await sock.sendMessage(jid, { text: postEnd.blockedMessage });
    }
    return { blocked: true, session: null };
  }

  if (!session) {
    return { blocked: false, session: createOrResetSessionRuntimeState(jid, nowTs, flow) };
  }

  if (session.status !== SESSION_STATUS.ENDED) {
    return { blocked: false, session };
  }

  const policy = String(postEnd.reentryPolicy ?? 'allow-always').toLowerCase();

  if (policy === 'blocked' || policy === 'deny' || policy === 'disallow') {
    if (postEnd.blockedMessage) {
      await sock.sendMessage(jid, { text: postEnd.blockedMessage });
    }
    return { blocked: true, session };
  }

  if (policy === 'cooldown') {
    const endedAt = getNumericInternalVar(session, INTERNAL_VAR.SESSION_ENDED_AT, 0);
    const cooldownMinutes = Math.max(0, postEnd.cooldownMinutes);
    const cooldownMs = cooldownMinutes * 60 * 1000;

    if (endedAt > 0 && cooldownMs > 0 && (nowTs - endedAt) < cooldownMs) {
      if (postEnd.cooldownMessage) {
        await sock.sendMessage(jid, { text: postEnd.cooldownMessage });
      }
      return { blocked: true, session };
    }
  }

  return { blocked: false, session: createOrResetSessionRuntimeState(jid, nowTs, flow) };
}

/**
 * Main entry point called on every incoming WhatsApp message.
 */
export async function handleIncoming(sock, jid, message, listId, flow, msgId, messageKey = null) {
  const startedAt = Date.now();
  engineRuntimeStats.handleIncomingCount += 1;
  const scope = buildSessionScope(flow);
  if (msgId) {
    const processedKey = `${scope.flowPath}::${msgId}`;
    if (PROCESSED_IDS.has(processedKey)) {
      engineRuntimeStats.duplicateDropped += 1;
      console.log(`[handleIncoming] DUPLICATE message detected, skipping. ID: ${msgId} | flow=${scope.flowPath}`);
      return;
    }
    PROCESSED_IDS.add(processedKey);
  }
  const scopedSock = createFlowScopedSocket(sock, flow);

  try {
    return await executeWithLock(jid, flow, async () => {
      const nowTs = Date.now();
      const commandMode = isCommandMode(flow);
      const normalizedIncoming = String(message ?? '').trim();
      const hasCommandPrefix = normalizedIncoming.startsWith('/');
      let session = sessionRead(jid, scope);
      let commandCandidate = null;

      const terminationResolution = await terminateSessionFromUserKeyword(
        scopedSock,
        jid,
        message,
        session,
        flow
      );
      if (terminationResolution.terminated) {
        return;
      }
      session = terminationResolution.session;

      const shouldResolveCommandCandidate =
        commandMode && (
          !session ||
          session.status === SESSION_STATUS.ENDED ||
          (hasCommandPrefix && session.waitingFor == null)
        );

      if (shouldResolveCommandCandidate) {
        commandCandidate = findCommandCandidate(flow, message);
        if (!commandCandidate) {
          if (hasCommandPrefix) {
            console.log(`[CommandMode] comando sem match para ${jid}: "${normalizedIncoming}"`);
          }
          return;
        }

        console.log(
          `[CommandMode] comando roteado para blockIndex ${commandCandidate.index} (${commandCandidate.blockId}) em ${jid}`
        );
      }

      const startResolution = await resolveSessionStartPolicy(scopedSock, jid, session, flow, nowTs);
      if (startResolution.blocked) return;
      session = startResolution.session;

      if (commandCandidate && session.blockIndex !== commandCandidate.index) {
        session = persistSessionPatch(jid, scope, session, { blockIndex: commandCandidate.index });
      }

      session = persistSessionPatch(jid, scope, session, {
        variables: {
          ...session.variables,
          [INTERNAL_VAR.LAST_MESSAGE]: message,
          [INTERNAL_VAR.LAST_INCOMING_MESSAGE_ID]: msgId ?? '',
          [INTERNAL_VAR.LAST_INCOMING_LIST_ID]: listId ?? '',
          [INTERNAL_VAR.LAST_INCOMING_MESSAGE_KEY]: messageKey ?? null,
        },
        botType: scope.botType,
      });

      const limitsResolution = await enforceSessionLimits(scopedSock, jid, session, flow, nowTs);
      if (limitsResolution.blocked) return;
      session = limitsResolution.session;

      if (session.waitingFor === WAIT_TYPE.HUMAN) {
        return;
      }

      if (session.waitingFor === WAIT_TYPE.KEYWORD) {
        try {
          session = await resolveKeywordWait(scopedSock, jid, message, session, flow);
          if (!session) return;
        } catch (err) {
          console.error(`[handleIncoming] Erro em resolveKeywordWait para ${jid}:`, err);
          emitConversationEvent({
            occurredAt: Date.now(),
            eventType: 'engine-error',
            direction: 'system',
            jid,
            flowPath: flow?.flowPath ?? '',
            messageText: 'Erro em resolveKeywordWait',
            metadata: { error: formatErrorForEvent(err) },
          });
          return;
        }
      } else if (session.waitingFor === WAIT_TYPE.LIST) {
        try {
          session = await resolveListWait(scopedSock, jid, message, listId, session, flow);
          if (!session) return;
        } catch (err) {
          console.error(`[handleIncoming] Erro em resolveListWait para ${jid}:`, err);
          emitConversationEvent({
            occurredAt: Date.now(),
            eventType: 'engine-error',
            direction: 'system',
            jid,
            flowPath: flow?.flowPath ?? '',
            messageText: 'Erro em resolveListWait',
            metadata: { error: formatErrorForEvent(err) },
          });
          return;
        }
      } else if (session.waitingFor === WAIT_TYPE.MULTIPLE_CHOICE) {
        try {
          session = await resolveMultipleChoiceWait(scopedSock, jid, message, session, flow);
          if (!session) return;
        } catch (err) {
          console.error(`[handleIncoming] Erro em resolveMultipleChoiceWait para ${jid}:`, err);
          emitConversationEvent({
            occurredAt: Date.now(),
            eventType: 'engine-error',
            direction: 'system',
            jid,
            flowPath: flow?.flowPath ?? '',
            messageText: 'Erro em resolveMultipleChoiceWait',
            metadata: { error: formatErrorForEvent(err) },
          });
          return;
        }
      }

      const runtime = {
        incoming: {
          text: message,
          listId: listId ?? null,
          msgId: msgId ?? null,
          messageKey: messageKey ?? null,
          receivedAt: nowTs,
        },
      };

      await runEngine(scopedSock, jid, session, flow, runtime);
    });
  } catch (error) {
    engineRuntimeStats.handleIncomingFailed += 1;
    throw error;
  } finally {
    engineRuntimeStats.handleIncomingTotalMs += Math.max(0, Date.now() - startedAt);
  }
}

async function runEngine(sock, jid, session, flow, runtime = {}) {
  const scopedSock = createFlowScopedSocket(sock, flow);
  const scope = buildSessionScope(flow);
  const MAX_STEPS = ENGINE_LIMITS.MAX_STEPS;
  let steps = 0;
  let lastYieldAt = Date.now();

  while (steps < MAX_STEPS) {
    steps++;
    engineRuntimeStats.runEngineStepsTotal += 1;

    if (session.blockIndex >= flow.blocks.length) {
      console.log(`[Engine] ${jid} reached end of flow.`);
      session = endSession(jid, session, Date.now(), 'flow-complete', flow);
      return;
    }

    if (session.status === SESSION_STATUS.ENDED) {
      return;
    }

    const block = flow.blocks[session.blockIndex];

    if (!block) {
      console.warn(`[Engine] No block at index ${session.blockIndex} for ${jid}`);
      return;
    }

    const handler = HANDLERS[block.type];

    if (!handler) {
      console.warn(`[Engine] No handler for block type "${block.type}" - skipping.`);
      session = persistSessionPatch(jid, scope, session, { blockIndex: session.blockIndex + 1 });
      continue;
    }

    let result;
    const handlerStartedAt = Date.now();
    try {
      result = await handler({ block, session, sock: scopedSock, jid, flow, runtime });
      recordHandlerMetric(block.type, Date.now() - handlerStartedAt, { failed: false });
    } catch (err) {
      recordHandlerMetric(block.type, Date.now() - handlerStartedAt, { failed: true });
      console.error(`[Engine] Error in handler "${block.type}":`, err);
      emitConversationEvent({
        occurredAt: Date.now(),
        eventType: 'engine-error',
        direction: 'system',
        jid,
        flowPath: flow?.flowPath ?? '',
        messageText: `Erro no handler ${block.type}`,
        metadata: {
          blockId: block?.id ?? '',
          blockType: block?.type ?? '',
          blockName: block?.name ?? '',
          error: formatErrorForEvent(err),
        },
      });
      return;
    }

    const patch = {
      ...(result.sessionPatch ?? {}),
      blockIndex: result.nextBlockIndex ?? session.blockIndex,
    };

    session = persistSessionPatch(jid, scope, session, patch);

    if (result.done) {
      session = endSession(jid, session, Date.now(), 'end-conversation', flow);
      return;
    }

    if (result.nextBlockIndex === null) {
      return;
    }

    const nowTs = Date.now();
    if (
      steps % ENGINE_LOOP_YIELD_EVERY_STEPS === 0 ||
      (nowTs - lastYieldAt) >= ENGINE_LOOP_YIELD_TIME_BUDGET_MS
    ) {
      await yieldToEventLoop();
      engineRuntimeStats.runEngineYieldCount += 1;
      lastYieldAt = Date.now();
    }
  }

  engineRuntimeStats.maxStepsHitCount += 1;
  console.error(`[Engine] ${jid} hit MAX_STEPS (${MAX_STEPS}). Possible infinite loop in flow.`);
}

async function resolveKeywordWait(sock, jid, message, session, flow) {
  const scope = buildSessionScope(flow);
  const { patch, matchedResponse } = resolveKeyword(sock, jid, message, session, flow);

  if (matchedResponse) {
    await sock.sendMessage(jid, { text: matchedResponse });
  }

  return persistSessionPatch(jid, scope, session, patch);
}

async function resolveListWait(sock, jid, message, listId, session, flow) {
  const scope = buildSessionScope(flow);
  const { patch, match } = resolveList(message, listId, session, flow);

  if (!match) {
    console.warn(`Nenhum match para "${message}" nas opcoes da lista`);
    await sock.sendMessage(jid, {
      text: 'Opcao invalida. Por favor, responda digitando o numero ou nome da opcao desejada de forma valida.',
    });
    return null;
  }

  return persistSessionPatch(jid, scope, session, patch);
}

async function resolveMultipleChoiceWait(sock, jid, message, session, flow) {
  const scope = buildSessionScope(flow);
  const { patch, selected } = resolveMultipleChoice(message, session, flow);

  if (!selected) {
    const invalidMessage =
      session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_INVALID_MESSAGE] ||
      'Opcao invalida. Responda com o numero ou nome da opcao conforme exibido.';

    await sock.sendMessage(jid, { text: invalidMessage });
    return null;
  }

  return persistSessionPatch(jid, scope, session, patch);
}

const cleanupIntervals = new Map();
const cleanupCycleState = new Map();
const SESSION_CLEANUP_BATCH_SIZE = Math.max(10, Number(process.env.TMB_SESSION_CLEANUP_BATCH_SIZE) || 120);
const SESSION_CLEANUP_TIME_BUDGET_MS = Math.max(5, Number(process.env.TMB_SESSION_CLEANUP_TIME_BUDGET_MS) || 25);
const CLEANUP_CURSOR_START_UPDATED_AT = Number.MAX_SAFE_INTEGER;
const CLEANUP_CURSOR_START_JID = '\uffff';

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

function clearCleanupInterval(flowPath) {
  const interval = cleanupIntervals.get(flowPath);
  if (!interval) return;
  clearInterval(interval);
  cleanupIntervals.delete(flowPath);
  cleanupCycleState.delete(flowPath);
}

function resetCleanupCursor(cycleState) {
  cycleState.cursorUpdatedAt = CLEANUP_CURSOR_START_UPDATED_AT;
  cycleState.cursorJid = CLEANUP_CURSOR_START_JID;
}

export function startSessionCleanup(sock, flowOrFlows) {
  const flows = Array.isArray(flowOrFlows) ? flowOrFlows : [flowOrFlows];
  const validFlows = flows.filter(Boolean);
  const activeFlowPaths = new Set(validFlows.map(flow => normalizeFlowPath(flow)).filter(Boolean));

  for (const flowPath of [...cleanupIntervals.keys()]) {
    if (!activeFlowPaths.has(flowPath)) {
      clearCleanupInterval(flowPath);
    }
  }

  for (const flow of validFlows) {
    const flowPath = normalizeFlowPath(flow);
    if (!flowPath) continue;
    clearCleanupInterval(flowPath);

    const scope = buildSessionScope(flow);
    const cycleState = { running: false };
    resetCleanupCursor(cycleState);
    cleanupCycleState.set(flowPath, cycleState);
    const interval = setInterval(async () => {
      if (cycleState.running) return;
      cycleState.running = true;
      const limits = getSessionLimits(flow);
      if (limits.sessionTimeoutMinutes <= 0) {
        cycleState.running = false;
        return;
      }

      try {
        const cleanupStartedAt = Date.now();
        let cursorUpdatedAt = Number(cycleState.cursorUpdatedAt ?? CLEANUP_CURSOR_START_UPDATED_AT);
        let cursorJid = String(cycleState.cursorJid ?? CLEANUP_CURSOR_START_JID);

        while ((Date.now() - cleanupStartedAt) < SESSION_CLEANUP_TIME_BUDGET_MS) {
          const page = getActiveSessionsPage(scope, {
            cursorUpdatedAt,
            cursorJid,
            limit: SESSION_CLEANUP_BATCH_SIZE,
          });

          if (page.length === 0) {
            resetCleanupCursor(cycleState);
            break;
          }

          const nowTs = Date.now();
          for (const session of page) {
            if (!isSessionTimedOut(session, flow, nowTs)) continue;

            await executeWithLock(session.jid, flow, async () => {
              const syncSession = getSession(session.jid, scope);
              if (!syncSession || syncSession.status !== SESSION_STATUS.ACTIVE) return;
              if (!isSessionTimedOut(syncSession, flow, nowTs)) return;

              console.log(`[SessionCleanup] Sessão para ${session.jid} atingiu o timeout (${limits.sessionTimeoutMinutes} min). Encerrando e enviando mensagem...`);
              if (limits.timeoutMessage) {
                await sock.sendMessage(session.jid, { text: limits.timeoutMessage }).catch(console.error);
              }
              endSession(session.jid, syncSession, nowTs, 'timeout', flow);
            });
          }

          const lastSession = page[page.length - 1];
          cursorUpdatedAt = Number(lastSession?.updatedAt) || 0;
          cursorJid = String(lastSession?.jid || '');
          cycleState.cursorUpdatedAt = cursorUpdatedAt;
          cycleState.cursorJid = cursorJid;

          if (page.length < SESSION_CLEANUP_BATCH_SIZE) {
            resetCleanupCursor(cycleState);
            break;
          }

          await yieldToEventLoop();
        }
      } finally {
        cycleState.running = false;
      }
    }, 15000);

    if (typeof interval.unref === 'function') {
      interval.unref();
    }

    cleanupIntervals.set(flowPath, interval);
  }
}

export async function resetActiveSessions(reason = 'manual-reload', flow = null) {
  const scope = flow ? buildSessionScope(flow) : null;
  const activeSessions = getActiveSessions(scope);
  const nowTs = Date.now();

  for (const session of activeSessions) {
    const flowLike = flow ?? {
      flowPath: session.flowPath,
      runtimeConfig: { conversationMode: session.botType },
    };
    await executeWithLock(session.jid, flowLike, async () => {
      const current = getSession(session.jid, { flowPath: session.flowPath, botType: session.botType });
      if (!current || current.status !== SESSION_STATUS.ACTIVE) return;
      endSession(session.jid, current, nowTs, reason, flowLike);
      deleteSession(session.jid, { flowPath: session.flowPath });
    });
  }

  return activeSessions.length;
}
