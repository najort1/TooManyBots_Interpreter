/**
 * Parâmetros Zen por tarefa (invent / extract / flavor / chaos / tarot / assault / persona).
 * Evita um único temperature/maxTokens para tudo.
 */

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Defaults por tarefa (sobrescrevíveis via funConfig.zenTasks[task] ou zenTask* flat). */
export const ZEN_TASK_DEFAULTS = Object.freeze({
  invent: Object.freeze({
    temperature: 0.75,
    maxTokens: 1600,
    timeoutMs: 45_000,
    jsonMode: true,
    jsonOnly: true,
  }),
  extract: Object.freeze({
    temperature: 0.3,
    maxTokens: 400,
    timeoutMs: 22_000,
    jsonMode: true,
    jsonOnly: true,
  }),
  flavor: Object.freeze({
    temperature: 0.95,
    maxTokens: 220,
    timeoutMs: 20_000,
    jsonMode: false,
    jsonOnly: false,
  }),
  chaos: Object.freeze({
    temperature: 1.0,
    maxTokens: 400,
    timeoutMs: 28_000,
    jsonMode: false,
    jsonOnly: false,
  }),
  tarot: Object.freeze({
    temperature: 0.9,
    maxTokens: 1000,
    timeoutMs: 35_000,
    jsonMode: false,
    jsonOnly: false,
  }),
  assault: Object.freeze({
    temperature: 0.95,
    maxTokens: 550,
    timeoutMs: 35_000,
    jsonMode: false,
    jsonOnly: false,
  }),
  persona: Object.freeze({
    temperature: 0.7,
    maxTokens: 280,
    timeoutMs: 22_000,
    jsonMode: false,
    jsonOnly: false,
  }),
  journalist: Object.freeze({
    temperature: 0.7,
    maxTokens: 700,
    timeoutMs: 25_000,
    jsonMode: true,
    jsonOnly: true,
  }),
});

/**
 * @param {string} task
 * @param {object} [funConfig]
 * @returns {{ temperature: number, maxTokens: number, timeoutMs: number, jsonMode: boolean, jsonOnly: boolean }}
 */
export function resolveZenTaskParams(task, funConfig = {}) {
  const key = String(task || 'flavor').toLowerCase();
  const base = ZEN_TASK_DEFAULTS[key] || ZEN_TASK_DEFAULTS.flavor;
  const nested =
    funConfig?.zenTasks && typeof funConfig.zenTasks === 'object'
      ? funConfig.zenTasks[key] || {}
      : {};

  // flat overrides legados + por tarefa
  const globalTemp = num(funConfig.zenTemperature, base.temperature);
  const globalTok = num(funConfig.zenMaxTokens, base.maxTokens);
  const globalTo = num(funConfig.zenTimeoutMs, base.timeoutMs);

  const flatKey = {
    invent: {
      temperature: funConfig.zenInventTemperature,
      maxTokens: funConfig.zenInventMaxTokens,
      timeoutMs: funConfig.zenInventTimeoutMs,
    },
    extract: {
      temperature: funConfig.zenExtractTemperature,
      maxTokens: funConfig.zenExtractMaxTokens,
      timeoutMs: funConfig.zenExtractTimeoutMs,
    },
    flavor: {
      temperature: funConfig.zenFlavorTemperature,
      maxTokens: funConfig.zenFlavorMaxTokens,
      timeoutMs: funConfig.zenFlavorTimeoutMs,
    },
    chaos: {
      temperature: funConfig.zenChaosTemperature,
      maxTokens: funConfig.zenChaosMaxTokens,
      timeoutMs: funConfig.zenChaosTimeoutMs ?? funConfig.chaosTimeoutMs,
    },
    tarot: {
      temperature: funConfig.tarotTemperature ?? funConfig.zenTarotTemperature,
      maxTokens: funConfig.tarotMaxTokens ?? funConfig.zenTarotMaxTokens,
      timeoutMs: funConfig.tarotTimeoutMs ?? funConfig.zenTarotTimeoutMs,
    },
    assault: {
      temperature: funConfig.zenAssaultTemperature,
      maxTokens: funConfig.zenAssaultMaxTokens,
      timeoutMs: funConfig.assaultStoryTimeoutMs ?? funConfig.zenAssaultTimeoutMs,
    },
    persona: {
      temperature: funConfig.zenPersonaTemperature,
      maxTokens: funConfig.zenPersonaMaxTokens,
      timeoutMs: funConfig.zenPersonaTimeoutMs,
    },
    journalist: {
      temperature: funConfig.zenJournalistTemperature,
      maxTokens: funConfig.zenJournalistMaxTokens,
      timeoutMs: funConfig.zenJournalistTimeoutMs,
    },
  }[key] || {};

  const temperature = clamp(
    num(nested.temperature, num(flatKey.temperature, globalTemp)),
    0,
    1.5
  );
  const maxTokens = Math.floor(
    clamp(num(nested.maxTokens, num(flatKey.maxTokens, key === 'invent' ? Math.max(globalTok, 1600) : globalTok)), 32, 4000)
  );
  const timeoutMs = Math.floor(
    clamp(num(nested.timeoutMs, num(flatKey.timeoutMs, globalTo)), 500, 120_000)
  );
  const jsonMode =
    nested.jsonMode !== undefined
      ? Boolean(nested.jsonMode)
      : base.jsonMode;
  const jsonOnly =
    nested.jsonOnly !== undefined
      ? Boolean(nested.jsonOnly)
      : base.jsonOnly;

  return { temperature, maxTokens, timeoutMs, jsonMode, jsonOnly, task: key };
}

/**
 * Ângulos de zoação — diversifica flavor sem alongar o texto.
 */
export const FLAVOR_ANGLES = Object.freeze([
  'inveja do grupo',
  'azar cósmico',
  'humildade falsa',
  'torcida do zap',
  'vergonha alheia carinhosa',
  'sorte com cara de skill',
  'mico elegante',
  'deboche leve',
]);

export function pickFlavorAngle(random = Math.random) {
  const i = Math.floor(random() * FLAVOR_ANGLES.length);
  return FLAVOR_ANGLES[i] || FLAVOR_ANGLES[0];
}

export const ASSAULT_GENRES = Object.freeze([
  'comédia de ação barata de bairro',
  'policial de TV aberta',
  'heist de comédia pastelão',
  'filme B de assalto no interior',
]);

export function pickAssaultGenre(random = Math.random) {
  const i = Math.floor(random() * ASSAULT_GENRES.length);
  return ASSAULT_GENRES[i] || ASSAULT_GENRES[0];
}

/**
 * Fingerprint curto p/ anti-repetição (8 chars).
 */
export function fingerprintLine(text) {
  const s = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 8) return s;
  // palavras-chave + tamanho
  const words = s.split(' ').filter((w) => w.length > 3).slice(0, 6);
  return (words.join(' ') || s).slice(0, 48);
}

export function overlapsRecent(text, recent = []) {
  const fp = fingerprintLine(text);
  if (!fp) return false;
  return (recent || []).some((r) => {
    const o = fingerprintLine(r);
    if (!o) return false;
    if (fp === o) return true;
    if (fp.length >= 12 && o.includes(fp.slice(0, 12))) return true;
    if (o.length >= 12 && fp.includes(o.slice(0, 12))) return true;
    return false;
  });
}
