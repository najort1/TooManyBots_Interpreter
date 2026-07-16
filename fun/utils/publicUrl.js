/**
 * URL pública (cloudflared etc.) com hot-reload — sem reiniciar o bot.
 *
 * Ordem de resolução:
 * 1. fun/config.public.json → { "publicBaseUrl": "https://...." }
 * 2. env FUN_PUBLIC_BASE_URL
 * 3. funConfig.publicBaseUrl
 * 4. http://127.0.0.1:{dashboardUiPort}
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FUN_PUBLIC_CONFIG_PATH = path.resolve(__dirname, '..', 'config.public.json');

let cache = { url: '', mtimeMs: 0, readAt: 0 };

function stripSlash(u) {
  return String(u || '')
    .trim()
    .replace(/\/+$/, '');
}

function readPublicFile() {
  try {
    if (!fs.existsSync(FUN_PUBLIC_CONFIG_PATH)) {
      return { url: '', mtimeMs: 0 };
    }
    const st = fs.statSync(FUN_PUBLIC_CONFIG_PATH);
    // se o arquivo mudou, invalida cache de URL
    if (cache.mtimeMs && st.mtimeMs !== cache.mtimeMs) {
      cache = { url: '', mtimeMs: st.mtimeMs, readAt: 0 };
    }
    const raw = fs.readFileSync(FUN_PUBLIC_CONFIG_PATH, 'utf8');
    const j = JSON.parse(raw);
    const url = stripSlash(j.publicBaseUrl || j.url || j.baseUrl || '');
    return { url, mtimeMs: st.mtimeMs };
  } catch {
    return { url: '', mtimeMs: 0 };
  }
}

/**
 * Hot-reload: re-lê `config.public.json` a cada ≤5s (ou se mtime mudar).
 * Sem fs.watch — não prende o process nem exige restart do bot.
 *
 * @param {object} [funConfig]
 * @param {{ force?: boolean }} [opts]
 */
export function getPublicBaseUrl(funConfig = {}, opts = {}) {
  const now = Date.now();
  const ttl = 5_000;

  if (!opts.force && cache.url && now - cache.readAt < ttl) {
    // ainda assim checa mtime barato
    try {
      if (fs.existsSync(FUN_PUBLIC_CONFIG_PATH)) {
        const st = fs.statSync(FUN_PUBLIC_CONFIG_PATH);
        if (cache.mtimeMs && st.mtimeMs !== cache.mtimeMs) {
          // cai pro re-read abaixo
        } else {
          return cache.url;
        }
      } else {
        return cache.url;
      }
    } catch {
      return cache.url;
    }
  }

  const file = readPublicFile();
  if (file.url) {
    cache = { url: file.url, mtimeMs: file.mtimeMs, readAt: now };
    return file.url;
  }

  const envUrl = stripSlash(process.env.FUN_PUBLIC_BASE_URL || '');
  if (envUrl) {
    cache = { url: envUrl, mtimeMs: 0, readAt: now };
    return envUrl;
  }

  const cfgUrl = stripSlash(funConfig.publicBaseUrl || '');
  if (cfgUrl) {
    cache = { url: cfgUrl, mtimeMs: 0, readAt: now };
    return cfgUrl;
  }

  const uiPort = Number(funConfig.dashboardUiPort || process.env.FUN_DASHBOARD_UI_PORT || 3001);
  const fallback = `http://127.0.0.1:${uiPort}`;
  cache = { url: fallback, mtimeMs: 0, readAt: now };
  return fallback;
}

/** Invalida cache (útil em testes). */
export function clearPublicUrlCache() {
  cache = { url: '', mtimeMs: 0, readAt: 0 };
}

export function writePublicBaseUrl(url) {
  const u = stripSlash(url);
  fs.writeFileSync(
    FUN_PUBLIC_CONFIG_PATH,
    JSON.stringify({ publicBaseUrl: u, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  clearPublicUrlCache();
  return u;
}
