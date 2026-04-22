/**
 * db/contactRepository.js
 *
 * Contact profile persistence operations.
 *
 * Extracted from db/index.js (C1 refactor) — zero logic changes.
 * Uses db/context.js to access the shared prepared statements.
 */

import { getStmts } from './context.js';
import { isLikelyRealWhatsAppUserJid, normalizePersistedDisplayName } from './helpers.js';

// ─── Contact Profiles ─────────────────────────────────────────────────────────

/**
 * Inserts or updates a contact's display name in the analytics DB.
 * Returns `false` if the JID is empty or the display name is not persistable.
 *
 * @param {{
 *   jid?: string,
 *   displayName?: string,
 *   source?: string,
 *   updatedAt?: number,
 * }} opts
 * @returns {boolean}
 */
export function upsertContactDisplayName({
  jid = '',
  displayName = '',
  source = 'runtime',
  updatedAt = Date.now(),
} = {}) {
  const stmts = getStmts();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return false;
  if (normalizedJid.endsWith('@s.whatsapp.net') && !isLikelyRealWhatsAppUserJid(normalizedJid)) {
    return false;
  }

  const normalizedDisplayName = normalizePersistedDisplayName(displayName, normalizedJid);
  if (!normalizedDisplayName) return false;

  const normalizedSource = String(source ?? '').trim() || 'runtime';
  const normalizedUpdatedAt = Number(updatedAt) || Date.now();

  stmts.upsertContactProfile.run(
    normalizedJid,
    normalizedDisplayName,
    normalizedSource,
    normalizedUpdatedAt
  );

  return true;
}

/**
 * Retrieves the stored display name for a JID.
 * Returns an empty string if not found or not persistable.
 *
 * @param {string} jid
 * @returns {string}
 */
export function getContactDisplayName(jid = '') {
  const stmts = getStmts();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return '';
  const row = stmts.getContactDisplayNameByJid.get(normalizedJid);
  return normalizePersistedDisplayName(row?.display_name, normalizedJid);
}

/**
 * Lists stored contact display names sorted by recency.
 *
 * @param {number} [limit=5000]
 * @returns {{ jid: string, name: string, source: string, updatedAt: number }[]}
 */
export function listContactDisplayNames(limit = 5000) {
  const stmts = getStmts();
  const normalizedLimit = Math.max(1, Math.min(50000, Number(limit) || 5000));
  const rows = stmts.listContactProfiles.all(normalizedLimit);

  return rows
    .map(row => {
      const jid = String(row?.jid || '').trim();
      if (jid.endsWith('@s.whatsapp.net') && !isLikelyRealWhatsAppUserJid(jid)) return null;
      const name = normalizePersistedDisplayName(row?.display_name, jid);
      if (!jid || !name) return null;
      return {
        jid,
        name,
        source: String(row?.source || '').trim() || 'runtime',
        updatedAt: Number(row?.updated_at) || 0,
      };
    })
    .filter(Boolean);
}
