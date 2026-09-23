import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export function createCarLinkService({ carRepository, random = randomBytes } = {}) {
  if (!carRepository) throw new Error('[fun/car-link] carRepository obrigatório');

  async function hash(token, salt) {
    return (await scryptAsync(String(token), String(salt), 32)).toString('hex');
  }

  async function generate({ scopeKey, userJid, now = Date.now(), revokeExisting = false } = {}) {
    if (revokeExisting) carRepository.revokeTokens(scopeKey, userJid, now);
    const token = Buffer.from(random(24)).toString('base64url');
    const salt = Buffer.from(random(16)).toString('base64url');
    const tokenHash = await hash(token, salt);
    carRepository.addToken({ scopeKey, userJid, tokenHash, salt, now });
    return { token, scopeKey: String(scopeKey), userJid: String(userJid) };
  }

  async function resolve(token) {
    const input = String(token || '').trim();
    if (!input) return null;
    const tokens = carRepository.listActiveTokens();
    for (const row of tokens) {
      const candidate = Buffer.from(await hash(input, row.salt), 'hex');
      const expected = Buffer.from(row.tokenHash, 'hex');
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
        return { scopeKey: row.scopeKey, userJid: row.userJid, tokenId: row.id };
      }
    }
    return null;
  }

  function revoke({ scopeKey, userJid, now = Date.now() } = {}) {
    return carRepository.revokeTokens(scopeKey, userJid, now);
  }

  return { generate, resolve, revoke };
}
