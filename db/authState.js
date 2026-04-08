/**
 * db/authState.js
 *
 * Adaptador de estado de autenticação Baileys baseado em SQLite (better-sqlite3).
 * Substitui o useMultiFileAuthState padrão baseado em arquivos.
 *
 * Migração de sql.js → better-sqlite3:
 * - Usa prepared statements pré-compilados do db/index.js
 * - Sem mais writeToDisk() — persistência automática via WAL
 * - Batch de escritas via transaction() para performance em keys.set()
 */

import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { getDb, getStmts } from './index.js';

const SESSION_KEY_PREFIX = 'session-';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSessionSortScore(session) {
  const used = Number(session?.indexInfo?.used) || 0;
  const created = Number(session?.indexInfo?.created) || 0;
  return [used, created];
}

function compareSessionPriority(a, b) {
  const [aUsed, aCreated] = toSessionSortScore(a);
  const [bUsed, bCreated] = toSessionSortScore(b);
  if (aUsed !== bUsed) return bUsed - aUsed;
  return bCreated - aCreated;
}

function isOpenSignalSession(session) {
  return Number(session?.indexInfo?.closed) === -1;
}

function pruneSignalSessionRecord(value) {
  if (!isPlainObject(value)) {
    return { changed: false, record: value, beforeCount: 0, afterCount: 0 };
  }

  const sessionsObject = value._sessions;
  if (!isPlainObject(sessionsObject)) {
    return { changed: false, record: value, beforeCount: 0, afterCount: 0 };
  }

  const entries = Object.entries(sessionsObject).filter(([, session]) => isPlainObject(session));
  const beforeCount = entries.length;
  if (beforeCount === 0) {
    return { changed: true, record: { ...value, _sessions: {} }, beforeCount: 0, afterCount: 0 };
  }

  const openEntries = entries.filter(([, session]) => isOpenSignalSession(session));
  if (openEntries.length === 0) {
    return { changed: true, record: { ...value, _sessions: {} }, beforeCount, afterCount: 0 };
  }

  openEntries.sort(([, left], [, right]) => compareSessionPriority(left, right));

  const [winnerKey, winnerSession] = openEntries[0] || [];
  if (!winnerKey || !winnerSession) {
    return { changed: true, record: { ...value, _sessions: {} }, beforeCount, afterCount: 0 };
  }

  if (beforeCount === 1 && winnerKey === entries[0][0]) {
    return { changed: false, record: value, beforeCount, afterCount: 1 };
  }

  const nextRecord = {
    ...value,
    _sessions: {
      [winnerKey]: winnerSession,
    },
  };

  return { changed: true, record: nextRecord, beforeCount, afterCount: 1 };
}

export function cleanupAuthSignalSessions() {
  const db = getDb();
  const { setAuthState, deleteAuthState } = getStmts();
  const rows = db.prepare('SELECT key, value FROM auth_state WHERE key LIKE ?').all(`${SESSION_KEY_PREFIX}%`);

  const summary = {
    scannedRows: rows.length,
    changedRows: 0,
    deletedRows: 0,
    removedSessions: 0,
  };

  const applyChanges = db.transaction((changes) => {
    for (const change of changes) {
      if (change.action === 'delete') {
        deleteAuthState.run(change.key);
      } else if (change.action === 'set') {
        setAuthState.run(change.key, change.value);
      }
    }
  });

  const pendingChanges = [];

  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.value, BufferJSON.reviver);
    } catch {
      continue;
    }

    const pruned = pruneSignalSessionRecord(parsed);
    if (!pruned.changed) continue;

    summary.changedRows += 1;
    summary.removedSessions += Math.max(0, pruned.beforeCount - pruned.afterCount);

    if (!isPlainObject(pruned.record?._sessions) || Object.keys(pruned.record._sessions).length === 0) {
      summary.deletedRows += 1;
      pendingChanges.push({ action: 'delete', key: row.key });
      continue;
    }

    pendingChanges.push({
      action: 'set',
      key: row.key,
      value: JSON.stringify(pruned.record, BufferJSON.replacer),
    });
  }

  if (pendingChanges.length > 0) {
    applyChanges(pendingChanges);
  }

  return summary;
}

export function useSqliteAuthState() {
  const db = getDb();
  const { getAuthState, setAuthState, deleteAuthState } = getStmts();

  const readData = (key) => {
    const row = getAuthState.get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (key, value) => {
    let normalizedValue = value;

    if (String(key).startsWith(SESSION_KEY_PREFIX)) {
      const pruned = pruneSignalSessionRecord(value);
      normalizedValue = pruned.record;

      if (!isPlainObject(normalizedValue?._sessions) || Object.keys(normalizedValue._sessions).length === 0) {
        removeData(key);
        return;
      }
    }

    const serialized = JSON.stringify(normalizedValue, BufferJSON.replacer);
    setAuthState.run(key, serialized);
  };

  const removeData = (key) => {
    deleteAuthState.run(key);
  };

  let creds = readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    writeData('creds', creds);
  }

  // Batch de escritas em transaction para quando Baileys
  // envia múltiplas chaves de uma vez (ex: durante handshake)
  const batchWrite = db.transaction((entries) => {
    for (const { key, value } of entries) {
      if (value) {
        writeData(key, value);
      } else {
        removeData(key);
      }
    }
  });

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const result = {};
        for (const id of ids) {
          const value = readData(`${type}-${id}`);
          if (value) result[id] = value;
        }
        return result;
      },
      set: (data) => {
        const entries = [];
        for (const [type, ids] of Object.entries(data)) {
          for (const [id, value] of Object.entries(ids)) {
            entries.push({ key: `${type}-${id}`, value });
          }
        }
        if (entries.length > 0) {
          batchWrite(entries);
        }
      },
    },
  };

  const saveCreds = () => {
    writeData('creds', state.creds);
  };

  return { state, saveCreds };
}
