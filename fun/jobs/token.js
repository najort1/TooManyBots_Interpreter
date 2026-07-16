/**
 * Token assinado HMAC-SHA256 para testes de emprego (URL).
 * Formato: base64url(payloadJson).base64url(sig)
 */

import crypto from 'crypto';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signJobToken(payload, secret) {
  const body = b64urlJson(payload);
  const sig = crypto
    .createHmac('sha256', String(secret || 'fun-job-dev-secret'))
    .update(body)
    .digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyJobToken(token, secret, now = Date.now()) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', String(secret || 'fun-job-dev-secret'))
    .update(body)
    .digest();
  let got;
  try {
    got = fromB64url(sig);
  } catch {
    return { ok: false, reason: 'bad-sig' };
  }
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return { ok: false, reason: 'bad-sig' };
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad-payload' };
  }
  const exp = Number(payload.exp) || 0;
  if (exp > 0 && now > exp) {
    return { ok: false, reason: 'expired', payload };
  }
  return { ok: true, payload };
}

export function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
