import fs from 'fs';
import path from 'path';

export const RUNTIME_MODE = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  RESTRICTED_TEST: 'restricted-test',
};

export const BOT_RUNTIME_MODE = {
  SINGLE_FLOW: 'single-flow',
  MULTI_BOT: 'multi-bot',
};

const MODE_LOG_LEVEL = {
  [RUNTIME_MODE.PRODUCTION]: 'warn',
  [RUNTIME_MODE.DEVELOPMENT]: 'debug',
  [RUNTIME_MODE.RESTRICTED_TEST]: 'info',
};

const VALID_MODES = new Set(Object.values(RUNTIME_MODE));
const VALID_BOT_RUNTIME_MODES = new Set(Object.values(BOT_RUNTIME_MODE));

export const config = {
  botRuntimeMode: BOT_RUNTIME_MODE.SINGLE_FLOW,
  flowPath: './bots/flow.tmb',
  flowPaths: ['./bots/flow.tmb'],
  runtimeMode: RUNTIME_MODE.PRODUCTION,
  testTargetMode: 'contacts-and-groups',
  testJid: '',
  testJids: [],
  groupWhitelistJids: [],
  dashboardHost: '127.0.0.1',
  dashboardPort: 8787,
};

const USER_CONFIG_FILE = path.resolve('./config.user.json');

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

function normalizeRuntimeMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (VALID_MODES.has(mode)) return mode;
  return null;
}

function normalizeBotRuntimeMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (VALID_BOT_RUNTIME_MODES.has(mode)) return mode;
  return null;
}

function deriveRuntimeModeFromLegacy(input) {
  const explicit = normalizeRuntimeMode(input.runtimeMode);
  if (explicit) return explicit;

  if (Boolean(input.testMode)) return RUNTIME_MODE.RESTRICTED_TEST;
  if (Boolean(input.debugMode)) return RUNTIME_MODE.DEVELOPMENT;
  return RUNTIME_MODE.PRODUCTION;
}

function toPortNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0 || n > 65535) return fallback;
  return Math.floor(n);
}

function normalizeFlowPaths(input) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeConfigShape(input) {
  const normalized = { ...input };

  normalized.runtimeMode = deriveRuntimeModeFromLegacy(normalized);
  normalized.botRuntimeMode =
    normalizeBotRuntimeMode(normalized.botRuntimeMode) ??
    (Array.isArray(normalized.flowPaths) && normalized.flowPaths.length > 1
      ? BOT_RUNTIME_MODE.MULTI_BOT
      : BOT_RUNTIME_MODE.SINGLE_FLOW);

  normalized.flowPath = String(normalized.flowPath ?? config.flowPath).trim() || config.flowPath;
  normalized.flowPaths = normalizeFlowPaths(normalized.flowPaths);
  if (!normalized.flowPaths.includes(normalized.flowPath)) {
    normalized.flowPaths = [normalized.flowPath, ...normalized.flowPaths].filter(Boolean);
  }

  if (normalized.botRuntimeMode === BOT_RUNTIME_MODE.SINGLE_FLOW) {
    normalized.flowPaths = [normalized.flowPath];
  } else if (normalized.flowPaths.length === 0) {
    normalized.flowPaths = [normalized.flowPath];
  }

  normalized.flowPath = normalized.flowPaths[0] || config.flowPath;

  normalized.testTargetMode = String(normalized.testTargetMode ?? config.testTargetMode).trim() || config.testTargetMode;
  normalized.testJid = String(normalized.testJid ?? '').trim();
  normalized.testJids = toStringArray(normalized.testJids);
  normalized.groupWhitelistJids = toStringArray(normalized.groupWhitelistJids);

  if (normalized.testJid && !normalized.testJids.includes(normalized.testJid)) {
    normalized.testJids = [normalized.testJid, ...normalized.testJids];
  }

  normalized.dashboardHost = String(normalized.dashboardHost ?? config.dashboardHost).trim() || config.dashboardHost;
  normalized.dashboardPort = toPortNumber(normalized.dashboardPort, config.dashboardPort);

  normalized.testMode = normalized.runtimeMode === RUNTIME_MODE.RESTRICTED_TEST;
  normalized.debugMode = normalized.runtimeMode === RUNTIME_MODE.DEVELOPMENT;
  normalized.logLevel = MODE_LOG_LEVEL[normalized.runtimeMode] ?? MODE_LOG_LEVEL[RUNTIME_MODE.PRODUCTION];
  normalized.prettyLogs = Boolean(process.stdout?.isTTY);

  if (!normalized.testMode) {
    normalized.testJids = [];
    normalized.testJid = '';
  }

  return normalized;
}

function sanitizeConfigForSave(input) {
  const { __startupChoice, ...rest } = input;
  const normalized = normalizeConfigShape(rest);
  return {
    botRuntimeMode: normalized.botRuntimeMode,
    flowPath: normalized.flowPath,
    flowPaths: normalized.flowPaths,
    runtimeMode: normalized.runtimeMode,
    testTargetMode: normalized.testTargetMode,
    testJid: normalized.testJid,
    testJids: normalized.testJids,
    groupWhitelistJids: normalized.groupWhitelistJids,
    dashboardHost: normalized.dashboardHost,
    dashboardPort: normalized.dashboardPort,
  };
}

export function loadSavedUserConfig() {
  if (!fs.existsSync(USER_CONFIG_FILE)) return null;
  try {
    const raw = fs.readFileSync(USER_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeConfigShape(parsed);
  } catch {
    return null;
  }
}

export function saveUserConfig(userConfig) {
  const payload = sanitizeConfigForSave(userConfig);
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function getConfig({ interactive = true } = {}) {
  const saved = loadSavedUserConfig();
  if (saved && !interactive) {
    return normalizeConfigShape({ ...config, ...saved });
  }

  if (!interactive) {
    return normalizeConfigShape({ ...config });
  }

  try {
    const { runConfigWizard } = await import('./configWizard.js');
    const projectRoot = path.resolve('.');

    const chosen = await runConfigWizard({
      projectRoot,
      defaults: normalizeConfigShape({ ...config, ...(saved ?? {}) }),
      hasSavedConfig: Boolean(saved),
      onUseSavedConfig: () => normalizeConfigShape({ ...config, ...saved, __startupChoice: 'use_previous' }),
    });

    if (!chosen) {
      throw new Error('Configuracao cancelada pelo usuario.');
    }

    saveUserConfig(chosen);
    return normalizeConfigShape(chosen);
  } catch (err) {
    console.error('Falha ao obter configuracao interativa:', err);
    throw err;
  }
}
