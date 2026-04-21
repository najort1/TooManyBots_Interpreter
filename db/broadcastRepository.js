/**
 * db/broadcastRepository.js
 *
 * Broadcast campaign and recipient operations.
 *
 * Extracted from db/index.js (C1 refactor) — zero logic changes.
 * Uses db/context.js to access the shared db handle and prepared statements.
 */

import { getDb, getStmts, ensureFlushForRead } from './context.js';
import { normalizeRecipientList } from './helpers.js';

// ─── Broadcast Contacts ───────────────────────────────────────────────────────

/**
 * Lists contacts eligible for broadcast, optionally filtered by a search term.
 * Always flushes the event buffer first to ensure display-name data is current.
 *
 * @param {{ search?: string, limit?: number }} [opts]
 * @returns {{ jid: string, name: string, lastInteractionAt: number }[]}
 */
export function listBroadcastContacts({ search = '', limit = 200 } = {}) {
  const stmts = getStmts();

  // Flush pending events so display-name data is consistent with queries.
  ensureFlushForRead();

  const normalizedLimit = Math.max(1, Math.min(5000, Number(limit) || 200));
  const normalizedSearch = String(search ?? '').trim();

  const rows = normalizedSearch
    ? stmts.searchBroadcastContacts.all(
        `%${normalizedSearch}%`,
        `%${normalizedSearch}%`,
        normalizedLimit
      )
    : stmts.listBroadcastContacts.all(normalizedLimit);

  return rows
    .map(row => ({
      jid: String(row?.jid || '').trim(),
      name: String(row?.display_name || '').trim(),
      lastInteractionAt: Number(row?.last_interaction_at) || 0,
    }))
    .filter(row => row.jid);
}

// ─── Broadcast Campaigns ──────────────────────────────────────────────────────

/**
 * Creates a new broadcast campaign and bulk-inserts its recipient rows in a
 * single atomic transaction.
 *
 * @param {{
 *   createdAt?: number,
 *   actor?: string,
 *   targetMode?: string,
 *   messageType?: string,
 *   messageText?: string,
 *   mediaMimeType?: string,
 *   mediaFileName?: string,
 *   recipients?: string[],
 * }} opts
 * @returns {{ campaignId: number }}
 */
export function createBroadcastDispatch({
  createdAt = Date.now(),
  actor = 'dashboard-agent',
  targetMode = 'all',
  messageType = 'text',
  messageText = '',
  mediaMimeType = '',
  mediaFileName = '',
  recipients = [],
} = {}) {
  const db = getDb();
  const stmts = getStmts();
  const normalizedRecipients = normalizeRecipientList(recipients);
  const nowTs = Number(createdAt) || Date.now();

  const insertTx = db.transaction(() => {
    const info = stmts.insertBroadcastCampaign.run(
      nowTs,
      String(actor || 'dashboard-agent'),
      String(targetMode || 'all'),
      String(messageType || 'text'),
      String(messageText || ''),
      String(mediaMimeType || ''),
      String(mediaFileName || ''),
      normalizedRecipients.length
    );
    const campaignId = Number(info?.lastInsertRowid) || 0;

    for (const jid of normalizedRecipients) {
      stmts.insertBroadcastRecipient.run(campaignId, jid, 'pending', '', null, nowTs, nowTs);
    }

    return { campaignId };
  });

  return insertTx();
}

/**
 * Records the send result (sent / failed) for a single broadcast recipient.
 *
 * @param {{
 *   campaignId: number,
 *   jid: string,
 *   status?: 'sent' | 'failed',
 *   errorMessage?: string,
 *   sentAt?: number,
 * }} opts
 */
export function markBroadcastRecipientResult({
  campaignId,
  jid,
  status = 'failed',
  errorMessage = '',
  sentAt = Date.now(),
} = {}) {
  const stmts = getStmts();
  const normalizedCampaignId = Number(campaignId) || 0;
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedCampaignId || !normalizedJid) return;

  const normalizedStatus = String(status ?? '').trim().toLowerCase() === 'sent' ? 'sent' : 'failed';
  const nowTs = Date.now();
  stmts.updateBroadcastRecipientResult.run(
    normalizedStatus,
    String(errorMessage || ''),
    normalizedStatus === 'sent' ? (Number(sentAt) || nowTs) : null,
    nowTs,
    normalizedCampaignId,
    normalizedJid
  );
}

/**
 * Batch-records send results for multiple recipients in a single transaction.
 *
 * @param {{
 *   campaignId: number,
 *   results?: Array<{ jid: string, status: string, errorMessage?: string, sentAt?: number }>,
 * }} opts
 * @returns {{ applied: number }}
 */
export function markBroadcastRecipientResultsBatch({
  campaignId,
  results = [],
} = {}) {
  const db = getDb();
  const stmts = getStmts();
  const normalizedCampaignId = Number(campaignId) || 0;
  if (!normalizedCampaignId || !Array.isArray(results) || results.length === 0) return { applied: 0 };

  const nowTs = Date.now();
  const normalizedRows = [];
  for (const row of results) {
    const normalizedJid = String(row?.jid ?? '').trim();
    if (!normalizedJid) continue;
    const normalizedStatus = String(row?.status ?? '').trim().toLowerCase() === 'sent' ? 'sent' : 'failed';
    normalizedRows.push({
      jid: normalizedJid,
      status: normalizedStatus,
      errorMessage: String(row?.errorMessage || ''),
      sentAt: normalizedStatus === 'sent' ? (Number(row?.sentAt) || nowTs) : null,
    });
  }

  if (normalizedRows.length === 0) return { applied: 0 };

  const applyTx = db.transaction((rows) => {
    for (const row of rows) {
      stmts.updateBroadcastRecipientResult.run(
        row.status,
        row.errorMessage,
        row.sentAt,
        nowTs,
        normalizedCampaignId,
        row.jid
      );
    }
  });
  applyTx(normalizedRows);
  return { applied: normalizedRows.length };
}

/**
 * Cancels all pending recipients for a campaign.
 *
 * @param {{ campaignId: number, errorMessage?: string }} opts
 * @returns {{ cancelled: number }}
 */
export function cancelBroadcastPendingRecipients({
  campaignId,
  errorMessage = 'cancelled',
} = {}) {
  const stmts = getStmts();
  const normalizedCampaignId = Number(campaignId) || 0;
  if (!normalizedCampaignId) return { cancelled: 0 };
  const nowTs = Date.now();
  const info = stmts.cancelPendingBroadcastRecipients.run(
    String(errorMessage || 'cancelled'),
    nowTs,
    normalizedCampaignId
  );
  return { cancelled: Number(info?.changes) || 0 };
}
