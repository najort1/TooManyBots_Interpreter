/**
 * engine/handoffEngine.js
 *
 * Handoff-related logic extracted from flowEngine.js.
 */

import { emitConversationEvent } from './conversationEvents.js';
import {
  maybeStartDedicatedPostSessionSurvey,
} from './surveyEngine.js';
import {
  INTERNAL_VAR,
} from '../config/constants.js';
import {
  buildSessionScope,
  executeWithLock,
  sessionRead,
  persistSessionPatch,
  endSession,
  runEngine,
  parseObjectVar,
} from './flowEngine.js';

/**
 * Resumes a session that was in human handoff state.
 */
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

/**
 * Ends a session from the dashboard.
 */
export async function endSessionFromDashboard({ jid, flow, sock = null, reason = 'human-agent-ended', actor = 'dashboard-agent' }) {
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

    if (sock) {
      const dedicatedSurveyStart = await maybeStartDedicatedPostSessionSurvey(
        sock,
        jid,
        session,
        flow,
        nowTs,
        'human_handoff_end'
      );
      if (dedicatedSurveyStart.started) {
        return { ok: true, session: dedicatedSurveyStart.session, surveyStarted: true };
      }
    }

    session = endSession(jid, session, nowTs, reason, flow);
    return { ok: true, session };
  });
}
