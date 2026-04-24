import { sendTextMessage } from './sender.js';
import {
  completeSurveyBroadcastDispatch,
  createSession,
  createSurveyBroadcastDispatch,
  updateSession,
} from '../db/index.js';
import { isLikelyRealWhatsAppUserJid } from '../db/helpers.js';
import { BROADCAST_LIMITS, INTERNAL_VAR, SESSION_STATUS, WAIT_TYPE } from '../config/constants.js';
import { delay } from '../utils/async.js';
import { safeErrorMessage } from '../utils/errors.js';
import {
  buildPostSessionSurveyState,
} from '../runtime/sessionEndSurveyTrigger.js';
import { toText } from '../utils/normalization.js';

function normalizeJids(jids = []) {
  if (!Array.isArray(jids)) return [];
  const seen = new Set();
  const result = [];
  for (const item of jids) {
    const jid = toText(typeof item === 'string' ? item : item?.jid);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    result.push(jid);
  }
  return result;
}

function buildScope(flow = {}) {
  return {
    flowPath: toText(flow?.flowPath),
    botType: 'conversation',
  };
}

export function createSurveyBroadcastService({ logger, getSendDelayMs = null } = {}) {
  const log = logger?.child ? logger.child({ module: 'survey-broadcast-service' }) : logger;

  return {
    async send({ sock, flow, surveyTypeId, selectedJids = [], actor = 'dashboard-agent', onProgress = null } = {}) {
      if (!sock) throw new Error('socket-not-ready');
      if (!flow?.flowPath) throw new Error('flow-not-ready');
      const typeId = toText(surveyTypeId);
      if (!typeId) throw new Error('surveyTypeId is required');

      const allJids = normalizeJids(selectedJids);
      const groupJids = allJids.filter(jid => jid.endsWith('@g.us'));
      const recipients = allJids.filter(isLikelyRealWhatsAppUserJid);
      if (groupJids.length > 0) {
        throw new Error('survey-broadcast-groups-not-allowed');
      }
      if (recipients.length === 0) {
        throw new Error('Nenhum contato individual elegivel para envio');
      }

      const nowTs = Date.now();
      const stateBuild = buildPostSessionSurveyState({
        surveyTypeId: typeId,
        triggerType: 'manual_broadcast',
        session: null,
        flow,
        nowTs,
        source: 'manual-broadcast',
      });
      if (!stateBuild.ok) {
        throw new Error(stateBuild.error || 'invalid-survey');
      }

      const result = {
        ok: true,
        surveyTypeId: typeId,
        dispatchId: 0,
        attempted: recipients.length,
        sent: 0,
        failed: 0,
        failures: [],
        blockedGroups: groupJids,
        actor: toText(actor, 'dashboard-agent'),
        startedAt: nowTs,
        completedAt: 0,
      };

      const emit = payload => {
        if (typeof onProgress !== 'function') return;
        try {
          onProgress({
            surveyTypeId: typeId,
            attempted: result.attempted,
            sent: result.sent,
            failed: result.failed,
            processed: result.sent + result.failed,
            remaining: Math.max(0, result.attempted - result.sent - result.failed),
            percent: result.attempted > 0
              ? Math.min(100, Math.round(((result.sent + result.failed) / result.attempted) * 100))
              : 0,
            ...payload,
          });
        } catch (error) {
          log?.warn?.({ error: safeErrorMessage(error) }, 'Survey broadcast progress callback failed');
        }
      };

      emit({ status: 'started', jid: '' });
      const scope = buildScope(flow);
      const dispatch = createSurveyBroadcastDispatch({
        surveyTypeId: typeId,
        actor: result.actor,
        recipientCount: recipients.length,
        createdAt: nowTs,
      });
      result.dispatchId = dispatch.id;

      for (const jid of recipients) {
        try {
          const startedAt = Date.now();
          const state = {
            ...stateBuild.state,
            startedAt,
          };

          createSession(jid, scope);
          updateSession(jid, {
            status: SESSION_STATUS.ACTIVE,
            waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
            blockIndex: 0,
            botType: 'conversation',
            variables: {
              [INTERNAL_VAR.SESSION_ID]: `survey_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
              [INTERNAL_VAR.SESSION_USER_KEY]: jid,
              [INTERNAL_VAR.SESSION_STARTED_AT]: startedAt,
              [INTERNAL_VAR.SESSION_LAST_ACTIVITY_AT]: startedAt,
              [INTERNAL_VAR.SESSION_MESSAGE_COUNT]: 0,
              [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: state,
            },
          }, scope);

          await sendTextMessage(sock, jid, stateBuild.firstPrompt, {
            __flowPath: flow.flowPath,
            __sendSource: 'broadcast',
          });
          result.sent += 1;
          emit({ status: 'sending', jid, recipientStatus: 'sent' });
        } catch (error) {
          const errorText = safeErrorMessage(error);
          result.failed += 1;
          result.failures.push({ jid, error: errorText });
          emit({ status: 'sending', jid, recipientStatus: 'failed', error: errorText });
          log?.warn?.({ jid, surveyTypeId: typeId, error: errorText }, 'Survey broadcast recipient failed');
        }

        const configuredDelayMs = typeof getSendDelayMs === 'function'
          ? Number(getSendDelayMs())
          : BROADCAST_LIMITS.SEND_DELAY_MS;
        const delayMs = Math.max(BROADCAST_LIMITS.SEND_DELAY_MS, Math.floor(Number(configuredDelayMs) || 0));
        await delay(delayMs);
      }

      result.completedAt = Date.now();
      completeSurveyBroadcastDispatch({
        id: result.dispatchId,
        sentCount: result.sent,
        failedCount: result.failed,
        completedAt: result.completedAt,
      });
      emit({ status: 'completed', jid: '' });
      return result;
    },
  };
}
