const ANIME_ACTIONS = Object.freeze([
  'kiss',
  'hug',
  'pat',
  'slap',
  'cuddle',
  'bite',
  'lick',
  'poke',
  'handhold',
  'highfive',
  'wave',
  'nom',
]);

const MEME_ACTIONS = Object.freeze(['happy', 'cry', 'laugh', 'bruh', 'sus']);

const ACTION_ALIASES = Object.freeze({
  beijo: 'kiss',
  beijar: 'kiss',
  kiss: 'kiss',
  abraco: 'hug',
  hug: 'hug',
  carinho: 'pat',
  pat: 'pat',
  tapa: 'slap',
  slap: 'slap',
  cuddle: 'cuddle',
  cafune: 'cuddle',
  bite: 'bite',
  morder: 'bite',
  lick: 'lick',
  lamber: 'lick',
  poke: 'poke',
  cutucar: 'poke',
  handhold: 'handhold',
  maosdadas: 'handhold',
  maos: 'handhold',
  highfive: 'highfive',
  tocaqui: 'highfive',
  wave: 'wave',
  acenar: 'wave',
  nom: 'nom',
  comer: 'nom',
  happy: 'happy',
  feliz: 'happy',
  cry: 'cry',
  chorar: 'cry',
  laugh: 'laugh',
  rir: 'laugh',
  bruh: 'bruh',
  sus: 'sus',
});

const NEKOS_BEST_ACTIONS = new Set([
  'hug',
  'kiss',
  'pat',
  'slap',
  'bite',
  'cuddle',
  'wave',
  'highfive',
  'poke',
  'handhold',
  'nom',
  'cry',
  'happy',
  'laugh',
]);

const WAIFU_PICS_ACTIONS = new Set([
  'hug',
  'kiss',
  'slap',
  'cuddle',
  'pat',
  'cry',
  'smile',
  'dance',
  'poke',
  'bite',
  'blush',
  'lick',
  'wave',
  'highfive',
  'handhold',
  'nom',
]);

const PURRBOT_ACTIONS = new Set([
  'hug',
  'kiss',
  'pat',
  'slap',
  'bite',
  'cuddle',
  'lick',
  'poke',
  'cry',
]);

const NEKOBOT_ACTIONS = new Set(['hug', 'kiss', 'pat', 'slap', 'bite', 'cuddle', 'poke']);

const TENOR_QUERIES = Object.freeze({
  happy: 'feliz meme reacao',
  cry: 'chorando meme reacao',
  laugh: 'rindo meme reacao',
  bruh: 'bruh meme reacao',
  sus: 'sus meme reacao',
});

function stripDiacritics(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeReactionAction(value) {
  const key = stripDiacritics(value).replace(/[^a-z0-9_]/g, '');
  return ACTION_ALIASES[key] || '';
}

export function getReactionKind(action) {
  if (MEME_ACTIONS.includes(action)) return 'meme';
  if (ANIME_ACTIONS.includes(action)) return 'anime';
  return '';
}

export function getReactionProviderOrder(action, funConfig = {}) {
  const kind = getReactionKind(action);
  if (kind === 'meme') return ['nekos_best', 'tenor', 'waifu_pics', 'purrbot'];
  if (kind !== 'anime') return [];

  const configured = Array.isArray(funConfig.reactionAnimeProviderOrder)
    ? funConfig.reactionAnimeProviderOrder
    : [];
  const order = configured.length
    ? configured
    : ['nekos_best', 'waifu_pics', 'nekobot', 'purrbot'];
  return order.map((p) => String(p || '').trim()).filter(Boolean);
}

function isSafeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function guessMimeType(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.png')) return 'image/png';
  return '';
}

async function fetchJson(fetchImpl, url, { timeoutMs, headers } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch-unavailable');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`http-${response?.status || 'failed'}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function resultFromUrl({ url, provider, action }) {
  if (!isSafeUrl(url)) return null;
  return {
    ok: true,
    action,
    provider,
    url,
    mimeType: guessMimeType(url),
  };
}

function enforceNekosBestUserAgent(userAgent) {
  const ua = String(userAgent || '').trim();
  if (/^[^\s(]/.test(ua) && /\([^)]+\)/.test(ua)) return ua;
  return 'TooManyBots-Fun/1.0 (https://github.com/anomalyco/TooManyBots_Interpreter)';
}

async function fetchNekosBest({ action, fetchImpl, timeoutMs, userAgent }) {
  if (!NEKOS_BEST_ACTIONS.has(action)) return null;
  const url = `https://nekos.best/api/v2/${encodeURIComponent(action)}`;
  const data = await fetchJson(fetchImpl, url, {
    timeoutMs,
    headers: {
      'User-Agent': enforceNekosBestUserAgent(userAgent),
      Accept: 'application/json',
    },
  });
  return resultFromUrl({
    url: data?.results?.[0]?.url,
    provider: 'nekos.best',
    action,
  });
}

async function fetchWaifuPics({ action, fetchImpl, timeoutMs, userAgent }) {
  if (!WAIFU_PICS_ACTIONS.has(action)) return null;
  const url = `https://api.waifu.pics/sfw/${encodeURIComponent(action)}`;
  const data = await fetchJson(fetchImpl, url, {
    timeoutMs,
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  });
  return resultFromUrl({
    url: data?.url,
    provider: 'waifu.pics',
    action,
  });
}

async function fetchNekoBot({ action, fetchImpl, timeoutMs, userAgent }) {
  if (!NEKOBOT_ACTIONS.has(action)) return null;
  const url = `https://nekobot.xyz/api/image?type=${encodeURIComponent(action)}`;
  const data = await fetchJson(fetchImpl, url, {
    timeoutMs,
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  });
  return resultFromUrl({
    url: data?.message || data?.url,
    provider: 'nekobot',
    action,
  });
}

async function fetchPurrbot({ action, fetchImpl, timeoutMs, userAgent }) {
  if (!PURRBOT_ACTIONS.has(action)) return null;
  const url = `https://api.purrbot.site/v2/img/sfw/${encodeURIComponent(action)}/gif`;
  const data = await fetchJson(fetchImpl, url, {
    timeoutMs,
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  });
  if (data?.error) return null;
  return resultFromUrl({
    url: data?.link,
    provider: 'purrbot',
    action,
  });
}

function pickTenorUrl(result) {
  const formats = result?.media_formats || {};
  return (
    formats.tinygif?.url ||
    formats.gif?.url ||
    formats.nanogif?.url ||
    formats.tinymp4?.url ||
    formats.mp4?.url ||
    ''
  );
}

async function fetchTenor({ action, fetchImpl, timeoutMs, funConfig, random }) {
  const key = String(funConfig?.tenorApiKey || process.env.TENOR_API_KEY || '').trim();
  if (!key || !TENOR_QUERIES[action]) return null;

  const clientKey = String(funConfig?.tenorClientKey || 'toomanybots_fun').trim();
  const params = new URLSearchParams({
    key,
    client_key: clientKey,
    q: TENOR_QUERIES[action],
    locale: 'pt_BR',
    country: 'BR',
    media_filter: 'minimal',
    contentfilter: 'medium',
    limit: '8',
  });
  const data = await fetchJson(fetchImpl, `https://tenor.googleapis.com/v2/search?${params}`, {
    timeoutMs,
    headers: { Accept: 'application/json' },
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;
  const index = Math.min(results.length - 1, Math.floor((random?.() || 0) * results.length));
  return resultFromUrl({
    url: pickTenorUrl(results[index]),
    provider: 'tenor',
    action,
  });
}

const PROVIDERS = Object.freeze({
  tenor: fetchTenor,
  nekos_best: fetchNekosBest,
  waifu_pics: fetchWaifuPics,
  nekobot: fetchNekoBot,
  purrbot: fetchPurrbot,
});

export function createReactionMediaService({
  fetchImpl = globalThis.fetch,
  random = Math.random,
  getConfig = () => ({}),
  getLogger = () => null,
} = {}) {
  async function getReaction(actionInput, opts = {}) {
    const action = normalizeReactionAction(actionInput);
    if (!action) {
      return { ok: false, reason: 'unknown-action' };
    }

    const kind = getReactionKind(action);
    if (!kind) {
      return { ok: false, reason: 'unsupported-action', action };
    }

    const funConfig = opts.funConfig || getConfig() || {};
    if (funConfig.reactionsEnabled === false) {
      return { ok: false, reason: 'disabled', action };
    }

    const timeoutMs = Math.max(500, Number(funConfig.reactionProviderTimeoutMs) || 4500);
    const userAgent = String(funConfig.reactionUserAgent || 'TooManyBots-Fun/1.0 (https://github.com/anomalyco/TooManyBots_Interpreter)').trim();
    const attempts = [];

    for (const providerName of getReactionProviderOrder(action, funConfig)) {
      const provider = PROVIDERS[providerName];
      if (!provider) continue;
      try {
        const media = await provider({
          action,
          fetchImpl,
          random,
          timeoutMs,
          userAgent,
          funConfig,
        });
        if (media?.ok) {
          return { ...media, kind };
        }
        attempts.push({ provider: providerName, skipped: true });
      } catch (error) {
        attempts.push({ provider: providerName, error: error?.message || 'provider-error' });
        getLogger?.()?.debug?.(
          { err: { message: error?.message || 'provider-error' }, provider: providerName, action },
          'Reaction media provider failed'
        );
      }
    }

    return { ok: false, reason: 'no-media', action, kind, attempts };
  }

  return { getReaction };
}

export const REACTION_ACTIONS = Object.freeze([...ANIME_ACTIONS, ...MEME_ACTIONS]);
