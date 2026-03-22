/**
 * db/authState.js
 *
 * Baileys auth state adapter backed by SQLite.
 * Replaces the default file-based useMultiFileAuthState.
 */

import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { getDb, writeToDisk } from './index.js';

export function useSqliteAuthState() {
  const db = getDb();

  const readData = (key) => {
    const result = db.exec('SELECT value FROM auth_state WHERE key = ?', [key]);
    if (!result.length || !result[0].values.length) return null;
    try {
      return JSON.parse(result[0].values[0][0], BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (key, value) => {
    const serialized = JSON.stringify(value, BufferJSON.replacer);
    db.run(
      `INSERT INTO auth_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, serialized]
    );
    writeToDisk();
  };

  const removeData = (key) => {
    db.run('DELETE FROM auth_state WHERE key = ?', [key]);
    writeToDisk();
  };

  let creds = readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    writeData('creds', creds);
  }

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
        for (const [type, ids] of Object.entries(data)) {
          for (const [id, value] of Object.entries(ids)) {
            if (value) {
              writeData(`${type}-${id}`, value);
            } else {
              removeData(`${type}-${id}`);
            }
          }
        }
      },
    },
  };

  const saveCreds = () => {
    writeData('creds', state.creds);
  };

  return { state, saveCreds };
}
