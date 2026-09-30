import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * Gera salt aleatório em hexadecimal.
 * @param {number} [bytes=16]
 * @returns {string}
 */
export function generateSalt(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

/**
 * Cria hash scrypt para segredos (senhas ou PINs).
 * Retorna no formato "salt:hashHex".
 * @param {string} secret
 * @param {string} [salt]
 * @returns {string}
 */
export function hashSecret(secret, salt = generateSalt()) {
  const s = String(salt || '');
  const buf = scryptSync(String(secret || ''), s, 32);
  return `${s}:${buf.toString('hex')}`;
}

/**
 * Verifica timing-safe se o segredo fornecido confere com o formato "salt:hashHex".
 * @param {string} secret
 * @param {string} storedHash
 * @returns {boolean}
 */
export function verifySecret(secret, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const candidateBuf = scryptSync(String(secret || ''), salt, 32);
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Normaliza o nome de usuário (trim e minúsculas para checagens).
 * @param {string} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  return String(username || '').trim();
}

/**
 * Repositório de contas de usuário (armazenamento seguro em SQLite).
 */
export function createFunAccountRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getByUserJid(userJid) {
    ensureSchema();
    const u = String(userJid || '').trim();
    if (!u) return null;
    const row = getDatabase()
      .prepare(
        `SELECT id, user_jid, username, password_hash, pin_hash, status, created_at, updated_at
         FROM ${ANALYTICS_SCHEMA}.fun_user_accounts
         WHERE user_jid = ?`
      )
      .get(u);
    if (!row) return null;
    return {
      id: Number(row.id),
      userJid: String(row.user_jid),
      username: String(row.username),
      passwordHash: String(row.password_hash),
      pinHash: String(row.pin_hash),
      status: String(row.status || 'active'),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  function getByUsername(username) {
    ensureSchema();
    const norm = normalizeUsername(username);
    if (!norm) return null;
    const row = getDatabase()
      .prepare(
        `SELECT id, user_jid, username, password_hash, pin_hash, status, created_at, updated_at
         FROM ${ANALYTICS_SCHEMA}.fun_user_accounts
         WHERE username = ? COLLATE NOCASE`
      )
      .get(norm);
    if (!row) return null;
    return {
      id: Number(row.id),
      userJid: String(row.user_jid),
      username: String(row.username),
      passwordHash: String(row.password_hash),
      pinHash: String(row.pin_hash),
      status: String(row.status || 'active'),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  function usernameExists(username, excludeUserJid = '') {
    ensureSchema();
    const norm = normalizeUsername(username);
    if (!norm) return false;
    const excl = String(excludeUserJid || '').trim();
    if (excl) {
      const row = getDatabase()
        .prepare(
          `SELECT 1 FROM ${ANALYTICS_SCHEMA}.fun_user_accounts
           WHERE username = ? COLLATE NOCASE AND user_jid != ? LIMIT 1`
        )
        .get(norm, excl);
      return Boolean(row);
    }
    const row = getDatabase()
      .prepare(
        `SELECT 1 FROM ${ANALYTICS_SCHEMA}.fun_user_accounts
         WHERE username = ? COLLATE NOCASE LIMIT 1`
      )
      .get(norm);
    return Boolean(row);
  }

  function createAccount({ userJid, username, password, pin, now = Date.now() }) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const name = normalizeUsername(username);
    const pass = String(password || '');
    const pinStr = String(pin || '').trim();
    const ts = Number(now) || Date.now();

    if (!u) throw new Error('userJid obrigatório');
    if (!name) throw new Error('username obrigatório');
    if (!pass) throw new Error('password obrigatório');
    if (!pinStr) throw new Error('pin obrigatório');

    const passwordHash = hashSecret(pass);
    const pinHash = hashSecret(pinStr);

    const info = getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_accounts
         (user_jid, username, password_hash, pin_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(u, name, passwordHash, pinHash, ts, ts);

    return {
      id: Number(info.lastInsertRowid),
      userJid: u,
      username: name,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    };
  }

  function updatePassword(userJid, newPassword, now = Date.now()) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const pass = String(newPassword || '');
    const ts = Number(now) || Date.now();
    if (!u || !pass) return false;

    const passwordHash = hashSecret(pass);
    const result = getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_accounts
         SET password_hash = ?, updated_at = ?
         WHERE user_jid = ?`
      )
      .run(passwordHash, ts, u);

    return result.changes > 0;
  }

  function updatePin(userJid, newPin, now = Date.now()) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const pinStr = String(newPin || '').trim();
    const ts = Number(now) || Date.now();
    if (!u || !pinStr) return false;

    const pinHash = hashSecret(pinStr);
    const result = getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_accounts
         SET pin_hash = ?, updated_at = ?
         WHERE user_jid = ?`
      )
      .run(pinHash, ts, u);

    return result.changes > 0;
  }

  function verifyAccountPassword(account, password) {
    if (!account?.passwordHash) return false;
    return verifySecret(password, account.passwordHash);
  }

  function verifyAccountPin(account, pin) {
    if (!account?.pinHash) return false;
    return verifySecret(pin, account.pinHash);
  }

  function deleteAccount(userJid) {
    ensureSchema();
    const u = String(userJid || '').trim();
    if (!u) return false;
    const result = getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_accounts WHERE user_jid = ?`)
      .run(u);
    return result.changes > 0;
  }

  return {
    ensureSchema,
    getByUserJid,
    getByUsername,
    usernameExists,
    createAccount,
    updatePassword,
    updatePin,
    verifyPassword: verifyAccountPassword,
    verifyPin: verifyAccountPin,
    deleteAccount,
  };
}
