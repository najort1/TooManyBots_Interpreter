import { sendBroadcastMessage } from './sender.js';
import {
  createBroadcastDispatch,
  listBroadcastContacts,
  markBroadcastRecipientResult,
} from '../db/index.js';
import { BROADCAST_LIMITS } from '../config/constants.js';
import { createActiveSessionLookup, resolveBroadcastSelection } from './broadcastContactUtils.js';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeErrorMessage(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error ?? 'Unknown error');
}

function buildProgressSnapshot(result, {
  status = 'sending',
  jid = '',
  recipientStatus = '',
  error = '',
} = {}) {
  const attempted = Math.max(0, Number(result?.attempted) || 0);
  const sent = Math.max(0, Number(result?.sent) || 0);
  const failed = Math.max(0, Number(result?.failed) || 0);
  const processed = Math.max(0, Math.min(attempted, sent + failed));
  const remaining = Math.max(0, attempted - processed);
  const percent = attempted > 0 ? Math.min(100, Math.round((processed / attempted) * 100)) : 0;
  return {
    campaignId: Number(result?.campaignId) || 0,
    attempted,
    processed,
    sent,
    failed,
    remaining,
    percent,
    status: String(status || 'sending'),
    jid: String(jid || ''),
    recipientStatus: String(recipientStatus || ''),
    error: String(error || ''),
  };
}

export function createBroadcastService({ logger, getSendDelayMs = null }) {
  const log = logger?.child ? logger.child({ module: 'broadcast-service' }) : logger;
  const activeLookup = createActiveSessionLookup();

  return {
    listContacts({ search = '', limit = BROADCAST_LIMITS.CONTACT_SEARCH_MAX } = {}) {
      const contacts = listBroadcastContacts({
        search,
        limit,
      });

      return contacts.map(contact => ({
        ...contact,
        hasActiveSession: activeLookup.has(contact.jid),
      }));
    },

    async send({ sock, actor = 'dashboard-agent', target = 'all', selectedJids = [], message, onProgress = null }) {
      const allContacts = listBroadcastContacts({
        search: '',
        limit: BROADCAST_LIMITS.CONTACT_LIST_MAX,
      });
      const selection = resolveBroadcastSelection({
        target,
        selectedJids,
        allContacts,
      });

      if (selection.recipients.length === 0) {
        throw new Error('Nenhum destinatario elegivel para envio');
      }

      const campaign = createBroadcastDispatch({
        actor,
        targetMode: selection.target,
        messageType: message.kind,
        messageText: message.text,
        mediaMimeType: message.mimeType,
        mediaFileName: message.fileName,
        recipients: selection.recipients,
      });

      const result = {
        campaignId: campaign.campaignId,
        target: selection.target,
        attempted: selection.recipients.length,
        sent: 0,
        failed: 0,
        failures: [],
      };

      const emitProgress = (payload) => {
        if (typeof onProgress !== 'function') return;
        try {
          onProgress(payload);
        } catch (error) {
          const errorText = safeErrorMessage(error);
          log?.warn?.({ campaignId: result.campaignId, error: errorText }, 'Broadcast progress callback failed');
        }
      };

      emitProgress(buildProgressSnapshot(result, { status: 'started' }));

      for (const jid of selection.recipients) {
        let recipientStatus = 'sent';
        let recipientError = '';

        try {
          await sendBroadcastMessage(sock, jid, message);
          markBroadcastRecipientResult({
            campaignId: campaign.campaignId,
            jid,
            status: 'sent',
            errorMessage: '',
          });
          result.sent += 1;
        } catch (error) {
          recipientStatus = 'failed';
          const errorText = safeErrorMessage(error);
          recipientError = errorText;
          markBroadcastRecipientResult({
            campaignId: campaign.campaignId,
            jid,
            status: 'failed',
            errorMessage: errorText,
          });
          result.failed += 1;
          result.failures.push({ jid, error: errorText });
          log?.warn?.({ campaignId: campaign.campaignId, jid, error: errorText }, 'Broadcast recipient failed');
        }

        emitProgress(buildProgressSnapshot(result, {
          status: 'sending',
          jid,
          recipientStatus,
          error: recipientError,
        }));

        const configuredDelayMs = typeof getSendDelayMs === 'function'
          ? Number(getSendDelayMs())
          : BROADCAST_LIMITS.SEND_DELAY_MS;
        const sendDelayMs = Number.isFinite(configuredDelayMs) && configuredDelayMs > 0
          ? Math.floor(configuredDelayMs)
          : 0;

        if (sendDelayMs > 0) {
          await delay(sendDelayMs);
        }
      }

      emitProgress(buildProgressSnapshot(result, { status: 'completed' }));

      return result;
    },
  };
}
