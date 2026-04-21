
/**
 * Normalizes a contact name for persistence, stripping WhatsApp tilde prefixes
 * and values that are identical to the JID itself (which carry no information).
 *
 * @param {string} name - Raw contact name from the WhatsApp event.
 * @param {string} jid  - Contact JID, used to detect trivial/duplicate names.
 * @returns {string} Cleaned name ready for storage, or empty string if not persistable.
 */
export function normalizePersistableContactName(name, jid) {
  const normalizedJid = String(jid ?? '').trim();
  const rawName = String(name ?? '').trim();
  if (!rawName) return '';
  const cleaned = rawName.replace(/^~+\s*/, '').trim() || rawName;
  if (!cleaned) return '';
  if (normalizedJid && cleaned === normalizedJid) return '';
  const jidLocal = normalizedJid.split('@')[0] || '';
  if (jidLocal && cleaned === jidLocal) return '';
  return cleaned.slice(0, 180);
}

/**
 * In-memory Map that transparently persists display-name updates to the database.
 *
 * On every `set()` call, if the resolved display name differs from what was
 * previously persisted for that JID, it fires `upsertContactDisplayName` so
 * the analytics DB stays in sync without any caller needing to know about it.
 *
 * The `hydrate()` method is used during startup to pre-populate the cache from
 * the database without triggering redundant persistence writes.
 */
export class PersistentContactCache extends Map {
  /**
   * @param {{ onPersistName?: (entry: { jid: string, name: string }) => void }} [options]
   */
  constructor({ onPersistName = null } = {}) {
    super();
    this.onPersistName = typeof onPersistName === 'function' ? onPersistName : null;
    this.persistedNames = new Map();
    this.hydrating = false;
  }

  /**
   * Bulk-loads database entries into the cache without triggering persistence callbacks.
   * @param {Array<{ jid: string, name: string }>} entries
   */
  hydrate(entries = []) {
    this.hydrating = true;
    try {
      for (const entry of entries) {
        const jid = String(entry?.jid ?? '').trim();
        const name = String(entry?.name ?? '').trim();
        if (!jid) continue;
        const normalizedName = normalizePersistableContactName(name, jid) || jid;
        this.persistedNames.set(jid, normalizedName);
        super.set(jid, { jid, name: normalizedName });
      }
    } finally {
      this.hydrating = false;
    }
  }

  /**
   * Sets a contact entry and, when the name materially changed, persists it to the DB.
   * @param {string} key   - The contact JID.
   * @param {object} value - Contact object; at minimum `{ jid, name }`.
   * @returns {this}
   */
  set(key, value) {
    const normalizedJid = String(key ?? value?.jid ?? '').trim();
    if (!normalizedJid) return this;

    const normalizedValue =
      value && typeof value === 'object'
        ? { ...value, jid: normalizedJid, name: String(value?.name ?? normalizedJid).trim() || normalizedJid }
        : { jid: normalizedJid, name: normalizedJid };

    const result = super.set(normalizedJid, normalizedValue);

    if (!this.hydrating && this.onPersistName) {
      const normalizedName = normalizePersistableContactName(normalizedValue.name, normalizedJid);
      if (normalizedName) {
        const previousPersistedName = this.persistedNames.get(normalizedJid) || '';
        if (previousPersistedName !== normalizedName) {
          this.persistedNames.set(normalizedJid, normalizedName);
          this.onPersistName({ jid: normalizedJid, name: normalizedName });
        }
      }
    }

    return result;
  }

  /** Clears both the cache and the in-memory persisted-names tracking map. */
  clear() {
    super.clear();
    this.persistedNames.clear();
  }
}
