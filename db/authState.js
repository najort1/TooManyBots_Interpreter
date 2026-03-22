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
    const serialized = JSON.stringify(value, BufferJSON.replacer);
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
