/**
 * engine/flowEngine.js
 *
 * Core interpreter. Given a session and an incoming message,
 * this module drives the flow forward block by block.
 */

import { HANDLERS } from '../handlers/index.js';
import { getSession, createSession, updateSession, getActiveSessions } from '../db/index.js';
import { LRUCache } from './utils.js';
import { parseCommandInput } from './commandParser.js';
import { resolveKeyword } from './resolvers/keywordResolver.js';
import { resolveList } from './resolvers/listResolver.js';
import { resolveMultipleChoice } from './resolvers/multipleChoiceResolver.js';
import {
  SESSION_STATUS,
  WAIT_TYPE,
  ENGINE_LIMITS,
  INTERNAL_VAR,
  BLOCK_TYPE,
} from '../config/constants.js';

const userLocks = new Map();

async function executeWithLock(jid, task) {
  while (userLocks.has(jid)) {
    await userLocks.get(jid).catch(() => {});
  }

  let resolveLock;
  const lockPromise = new Promise(resolve => {
    resolveLock = resolve;
  });
  userLocks.set(jid, lockPromise);

  try {
    return await task();
  } finally {
    if (userLocks.get(jid) === lockPromise) {
      userLocks.delete(jid);
    }
    resolveLock();
  }
}

const PROCESSED_IDS = new LRUCache(ENGINE_LIMITS.PROCESSED_IDS_MAX, ENGINE_LIMITS.PROCESSED_IDS_TTL_MS);

function getRuntimeConfig(flow) {
  return flow?.runtimeConfig ?? {};
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
    timeoutMessage: limits.timeoutMessage || 'Sessao encerrada por tempo limite.',
  };
}

function getPostEndConfig(flow) {
  const cfg = getRuntimeConfig(flow).postEnd ?? {};
  return {
    reentryPolicy: cfg.reentryPolicy ?? 'allow-always',
    cooldownMinutes: Number(cfg.cooldownMinutes) || 0,
    blockedMessage: cfg.blockedMessage || 'Este fluxo nao permite novas conversas para este usuario.',
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

function createOrResetSessionRuntimeState(jid, nowTs) {
  createSession(jid);
  const session = getSession(jid);

  updateSession(jid, {
    blockIndex: 0,
    waitingFor: null,
    status: SESSION_STATUS.ACTIVE,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_STARTED_AT]: nowTs,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
      [INTERNAL_VAR.SESSION_MESSAGE_COUNT]: 0,
      [INTERNAL_VAR.SESSION_ENDED_AT]: undefined,
      [INTERNAL_VAR.SESSION_END_REASON]: undefined,
    },
  });

  return getSession(jid);
}

function endSession(jid, session, nowTs, reason) {
  updateSession(jid, {
    status: SESSION_STATUS.ENDED,
    waitingFor: null,
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
      [INTERNAL_VAR.SESSION_ENDED_AT]: nowTs,
      [INTERNAL_VAR.SESSION_END_REASON]: reason,
    },
  });
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

  if (isSessionTimedOut(session, flow, nowTs)) {
    if (limits.timeoutMessage) {
      await sock.sendMessage(jid, { text: limits.timeoutMessage });
    }
    endSession(jid, session, nowTs, 'timeout');
    return { blocked: true, session: getSession(jid) };
  }

  const nextMessageCount = getNumericInternalVar(session, INTERNAL_VAR.SESSION_MESSAGE_COUNT, 0) + 1;
  updateSession(jid, {
    variables: {
      ...session.variables,
      [INTERNAL_VAR.SESSION_MESSAGE_COUNT]: nextMessageCount,
      [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: nowTs,
    },
  });

  session = getSession(jid);

  if (limits.maxMessagesPerSession > 0 && nextMessageCount > limits.maxMessagesPerSession) {
    if (limits.timeoutMessage) {
      await sock.sendMessage(jid, { text: limits.timeoutMessage });
    }
    endSession(jid, session, nowTs, 'max-messages');
    return { blocked: true, session: getSession(jid) };
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
    return { blocked: false, session: createOrResetSessionRuntimeState(jid, nowTs) };
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

  return { blocked: false, session: createOrResetSessionRuntimeState(jid, nowTs) };
}

/**
 * Main entry point called on every incoming WhatsApp message.
 */
export async function handleIncoming(sock, jid, message, listId, flow, msgId, messageKey = null) {
  if (msgId) {
    if (PROCESSED_IDS.has(msgId)) {
      console.log(`[handleIncoming] DUPLICATE message detected, skipping. ID: ${msgId}`);
      return;
    }
    PROCESSED_IDS.add(msgId);
  }

  return executeWithLock(jid, async () => {
    const nowTs = Date.now();
    const commandMode = isCommandMode(flow);
    let session = getSession(jid);
    let commandCandidate = null;

    if (commandMode && (!session || session.status === SESSION_STATUS.ENDED)) {
      commandCandidate = findCommandCandidate(flow, message);
      if (!commandCandidate) {
        return;
      }
    }

    const startResolution = await resolveSessionStartPolicy(sock, jid, session, flow, nowTs);
    if (startResolution.blocked) return;
    session = startResolution.session;

    if (commandCandidate && session.blockIndex !== commandCandidate.index) {
      updateSession(jid, { blockIndex: commandCandidate.index });
      session = getSession(jid);
    }

    updateSession(jid, {
      variables: {
        ...session.variables,
        [INTERNAL_VAR.LAST_MESSAGE]: message,
        [INTERNAL_VAR.LAST_INCOMING_MESSAGE_ID]: msgId ?? '',
        [INTERNAL_VAR.LAST_INCOMING_LIST_ID]: listId ?? '',
        [INTERNAL_VAR.LAST_INCOMING_MESSAGE_KEY]: messageKey ?? null,
      },
    });
    session = getSession(jid);

    const limitsResolution = await enforceSessionLimits(sock, jid, session, flow, nowTs);
    if (limitsResolution.blocked) return;
    session = limitsResolution.session;

    if (session.waitingFor === WAIT_TYPE.KEYWORD) {
      try {
        session = await resolveKeywordWait(sock, jid, message, session, flow);
        if (!session) return;
      } catch (err) {
        console.error(`[handleIncoming] Erro em resolveKeywordWait para ${jid}:`, err);
        return;
      }
    } else if (session.waitingFor === WAIT_TYPE.LIST) {
      try {
        session = await resolveListWait(sock, jid, message, listId, session, flow);
        if (!session) return;
      } catch (err) {
        console.error(`[handleIncoming] Erro em resolveListWait para ${jid}:`, err);
        return;
      }
    } else if (session.waitingFor === WAIT_TYPE.MULTIPLE_CHOICE) {
      try {
        session = await resolveMultipleChoiceWait(sock, jid, message, session, flow);
        if (!session) return;
      } catch (err) {
        console.error(`[handleIncoming] Erro em resolveMultipleChoiceWait para ${jid}:`, err);
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

    await runEngine(sock, jid, session, flow, runtime);
  });
}

async function runEngine(sock, jid, session, flow, runtime = {}) {
  const MAX_STEPS = ENGINE_LIMITS.MAX_STEPS;
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;

    if (session.blockIndex >= flow.blocks.length) {
      console.log(`[Engine] ${jid} reached end of flow.`);
      endSession(jid, session, Date.now(), 'flow-complete');
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
      updateSession(jid, { blockIndex: session.blockIndex + 1 });
      session = getSession(jid);
      continue;
    }

    let result;
    try {
      result = await handler({ block, session, sock, jid, flow, runtime });
    } catch (err) {
      console.error(`[Engine] Error in handler "${block.type}":`, err);
      return;
    }

    const patch = {
      ...(result.sessionPatch ?? {}),
      blockIndex: result.nextBlockIndex ?? session.blockIndex,
    };

    updateSession(jid, patch);
    session = getSession(jid);

    if (result.done) {
      endSession(jid, session, Date.now(), 'end-conversation');
      return;
    }

    if (result.nextBlockIndex === null) {
      return;
    }
  }

  console.error(`[Engine] ${jid} hit MAX_STEPS (${MAX_STEPS}). Possible infinite loop in flow.`);
}

async function resolveKeywordWait(sock, jid, message, session, flow) {
  const { patch, matchedResponse } = resolveKeyword(sock, jid, message, session, flow);

  if (matchedResponse) {
    await sock.sendMessage(jid, { text: matchedResponse });
  }

  updateSession(jid, patch);
  return getSession(jid);
}

async function resolveListWait(sock, jid, message, listId, session, flow) {
  const { patch, match } = resolveList(message, listId, session, flow);

  if (!match) {
    console.warn(`Nenhum match para "${message}" nas opcoes da lista`);
    await sock.sendMessage(jid, {
      text: 'Opcao invalida. Por favor, responda digitando o numero ou nome da opcao desejada de forma valida.',
    });
    return null;
  }

  updateSession(jid, patch);
  return getSession(jid);
}

async function resolveMultipleChoiceWait(sock, jid, message, session, flow) {
  const { patch, selected } = resolveMultipleChoice(message, session, flow);

  if (!selected) {
    const invalidMessage =
      session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_INVALID_MESSAGE] ||
      'Opcao invalida. Responda com o numero ou nome da opcao conforme exibido.';

    await sock.sendMessage(jid, { text: invalidMessage });
    return null;
  }

  updateSession(jid, patch);
  return getSession(jid);
}

let cleanupInterval = null;

export function startSessionCleanup(sock, flow) {
  if (cleanupInterval) clearInterval(cleanupInterval);
  
  // Check periodically (e.g., every 15 seconds)
  cleanupInterval = setInterval(async () => {
    const limits = getSessionLimits(flow);
    if (limits.sessionTimeoutMinutes <= 0) return;
    
    const activeSessions = getActiveSessions();
    const nowTs = Date.now();
    
    for (const session of activeSessions) {
      if (isSessionTimedOut(session, flow, nowTs)) {
        await executeWithLock(session.jid, async () => {
          // Re-fetch inside lock to make sure it wasn't updated just now
          const syncSession = getSession(session.jid);
          if (syncSession && syncSession.status === SESSION_STATUS.ACTIVE && isSessionTimedOut(syncSession, flow, nowTs)) {
            console.log(`[SessionCleanup] Sessao para ${session.jid} atingiu o timeout (${limits.sessionTimeoutMinutes} min). Encerrando e enviando mensagem...`);
            if (limits.timeoutMessage) {
              await sock.sendMessage(session.jid, { text: limits.timeoutMessage }).catch(console.error);
            }
            endSession(session.jid, syncSession, nowTs, 'timeout');
          }
        });
      }
    }
  }, 15000); // 15 seconds intervals
}
