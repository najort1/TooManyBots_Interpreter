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

export function createBroadcastService({ logger }) {
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

    async send({ sock, actor = 'dashboard-agent', target = 'all', selectedJids = [], message }) {
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

      for (const jid of selection.recipients) {
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
          const errorText = safeErrorMessage(error);
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

        if (BROADCAST_LIMITS.SEND_DELAY_MS > 0) {
          await delay(BROADCAST_LIMITS.SEND_DELAY_MS);
        }
      }

      return result;
    },
  };
}
