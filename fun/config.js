import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeBoolean, normalizeInt, toText } from '../utils/normalization.js';
import { DEFAULT_FUN_CONFIG } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Config exclusiva do bot Fun — nunca lê `config.user.json` do TMB. */
export const FUN_USER_CONFIG_PATH = path.resolve(__dirname, 'config.user.json');
export const FUN_DEFAULT_DATA_DIR = path.resolve(__dirname, '..', 'data', 'fun');

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

/**
 * Normaliza regras de jogo do bot Fun (config flat, própria).
 */
export function normalizeFunConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  let xpMin = normalizeInt(raw.xpMin, DEFAULT_FUN_CONFIG.xpMin, {
    min: 1,
    max: 10_000,
    rounding: 'floor',
    clamp: true,
  });
  let xpMax = normalizeInt(raw.xpMax, DEFAULT_FUN_CONFIG.xpMax, {
    min: 1,
    max: 10_000,
    rounding: 'floor',
    clamp: true,
  });
  if (xpMax < xpMin) {
    const swap = xpMin;
    xpMin = xpMax;
    xpMax = swap;
  }

  const prefixRaw = toText(raw.prefix, DEFAULT_FUN_CONFIG.prefix);
  const prefix = prefixRaw.slice(0, 3) || DEFAULT_FUN_CONFIG.prefix;

  return {
    enabled: normalizeBoolean(raw.enabled, DEFAULT_FUN_CONFIG.enabled),
    prefix,
    cooldownMs: normalizeInt(raw.cooldownMs, DEFAULT_FUN_CONFIG.cooldownMs, {
      min: 0,
      max: 24 * 60 * 60 * 1000,
      rounding: 'floor',
      clamp: true,
    }),
    xpMin,
    xpMax,
    dailyXp: normalizeInt(raw.dailyXp, DEFAULT_FUN_CONFIG.dailyXp, {
      min: 0,
      max: 1_000_000,
      rounding: 'floor',
      clamp: true,
    }),
    dailyCoins: normalizeInt(raw.dailyCoins, DEFAULT_FUN_CONFIG.dailyCoins, {
      min: 0,
      max: 1_000_000,
      rounding: 'floor',
      clamp: true,
    }),
    rankLimit: normalizeInt(raw.rankLimit, DEFAULT_FUN_CONFIG.rankLimit, {
      min: 1,
      max: 50,
      rounding: 'floor',
      clamp: true,
    }),
    announceLevelUp: normalizeBoolean(raw.announceLevelUp, DEFAULT_FUN_CONFIG.announceLevelUp),
    requireGroupWhitelist: normalizeBoolean(
      raw.requireGroupWhitelist,
      DEFAULT_FUN_CONFIG.requireGroupWhitelist
    ),
    allowDm: normalizeBoolean(raw.allowDm, DEFAULT_FUN_CONFIG.allowDm),
    commandExclusive: normalizeBoolean(raw.commandExclusive, DEFAULT_FUN_CONFIG.commandExclusive),
    groupWhitelistJids: toStringArray(raw.groupWhitelistJids),
    debugMode: normalizeBoolean(raw.debugMode, DEFAULT_FUN_CONFIG.debugMode),
    logLevel: toText(raw.logLevel, DEFAULT_FUN_CONFIG.logLevel).toLowerCase() || DEFAULT_FUN_CONFIG.logLevel,
    dataDir: toText(raw.dataDir, '') || '',
    rankCardImage: normalizeBoolean(raw.rankCardImage, DEFAULT_FUN_CONFIG.rankCardImage),
    dashboardEnabled: normalizeBoolean(raw.dashboardEnabled, DEFAULT_FUN_CONFIG.dashboardEnabled),
    dashboardHost: toText(raw.dashboardHost, DEFAULT_FUN_CONFIG.dashboardHost) || DEFAULT_FUN_CONFIG.dashboardHost,
    dashboardPort: normalizeInt(raw.dashboardPort, DEFAULT_FUN_CONFIG.dashboardPort, {
      min: 1,
      max: 65535,
      rounding: 'floor',
      clamp: true,
    }),
    flipMin: normalizeInt(raw.flipMin, DEFAULT_FUN_CONFIG.flipMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    flipMax: normalizeInt(raw.flipMax, DEFAULT_FUN_CONFIG.flipMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    flipCooldownMs: normalizeInt(raw.flipCooldownMs, DEFAULT_FUN_CONFIG.flipCooldownMs, { min: 0, max: 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    jobMin: normalizeInt(raw.jobMin, DEFAULT_FUN_CONFIG.jobMin, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    jobMax: normalizeInt(raw.jobMax, DEFAULT_FUN_CONFIG.jobMax, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    jobCooldownMs: normalizeInt(raw.jobCooldownMs, DEFAULT_FUN_CONFIG.jobCooldownMs, { min: 0, max: 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    luckyMin: normalizeInt(raw.luckyMin, DEFAULT_FUN_CONFIG.luckyMin, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    luckyMax: normalizeInt(raw.luckyMax, DEFAULT_FUN_CONFIG.luckyMax, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    luckyCooldownMs: normalizeInt(raw.luckyCooldownMs, DEFAULT_FUN_CONFIG.luckyCooldownMs, { min: 0, max: 7 * 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    betMin: normalizeInt(raw.betMin, DEFAULT_FUN_CONFIG.betMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    betMax: normalizeInt(raw.betMax, DEFAULT_FUN_CONFIG.betMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    divorceCost: normalizeInt(raw.divorceCost, DEFAULT_FUN_CONFIG.divorceCost, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    titleMaxLen: normalizeInt(raw.titleMaxLen, DEFAULT_FUN_CONFIG.titleMaxLen, { min: 4, max: 32, rounding: 'floor', clamp: true }),
    factionsEnabled: normalizeBoolean(raw.factionsEnabled, DEFAULT_FUN_CONFIG.factionsEnabled),
    factionMaxMembers: normalizeInt(raw.factionMaxMembers, DEFAULT_FUN_CONFIG.factionMaxMembers, { min: 2, max: 50, rounding: 'floor', clamp: true }),
    factionLeaveCost: normalizeInt(raw.factionLeaveCost, DEFAULT_FUN_CONFIG.factionLeaveCost, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    factionCreateCost: normalizeInt(raw.factionCreateCost, DEFAULT_FUN_CONFIG.factionCreateCost, { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }),
    bridgeMinActions: normalizeInt(raw.bridgeMinActions, DEFAULT_FUN_CONFIG.bridgeMinActions, { min: 1, max: 1000, rounding: 'floor', clamp: true }),
    bridgeDebuffThreshold: Number.isFinite(Number(raw.bridgeDebuffThreshold))
      ? Math.min(1, Math.max(0, Number(raw.bridgeDebuffThreshold)))
      : DEFAULT_FUN_CONFIG.bridgeDebuffThreshold,
    bridgeDebuffXpMult: Number.isFinite(Number(raw.bridgeDebuffXpMult))
      ? Math.min(1, Math.max(0.1, Number(raw.bridgeDebuffXpMult)))
      : DEFAULT_FUN_CONFIG.bridgeDebuffXpMult,
    missionSquadSize: normalizeInt(raw.missionSquadSize, DEFAULT_FUN_CONFIG.missionSquadSize, { min: 2, max: 6, rounding: 'floor', clamp: true }),
    missionRewardPerMember: normalizeInt(raw.missionRewardPerMember, DEFAULT_FUN_CONFIG.missionRewardPerMember, { min: 0, max: 10000, rounding: 'floor', clamp: true }),
    missionDurationMs: normalizeInt(raw.missionDurationMs, DEFAULT_FUN_CONFIG.missionDurationMs, { min: 60000, max: 7 * 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    missionAutoSpawn: normalizeBoolean(raw.missionAutoSpawn, DEFAULT_FUN_CONFIG.missionAutoSpawn),
    eventDurationMs: normalizeInt(raw.eventDurationMs, DEFAULT_FUN_CONFIG.eventDurationMs, { min: 60000, max: 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    eventCrossMultiplier: Number.isFinite(Number(raw.eventCrossMultiplier))
      ? Math.min(5, Math.max(1, Number(raw.eventCrossMultiplier)))
      : DEFAULT_FUN_CONFIG.eventCrossMultiplier,
    eventCooldownMs: normalizeInt(raw.eventCooldownMs, DEFAULT_FUN_CONFIG.eventCooldownMs, { min: 0, max: 7 * 24 * 60 * 60 * 1000, rounding: 'floor', clamp: true }),
    ollamaEnabled: normalizeBoolean(raw.ollamaEnabled, DEFAULT_FUN_CONFIG.ollamaEnabled),
    ollamaBaseUrl:
      toText(raw.ollamaBaseUrl, DEFAULT_FUN_CONFIG.ollamaBaseUrl) || DEFAULT_FUN_CONFIG.ollamaBaseUrl,
    ollamaModel: toText(raw.ollamaModel, DEFAULT_FUN_CONFIG.ollamaModel) || DEFAULT_FUN_CONFIG.ollamaModel,
    ollamaTimeoutMs: normalizeInt(raw.ollamaTimeoutMs, DEFAULT_FUN_CONFIG.ollamaTimeoutMs, {
      min: 500,
      max: 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    ollamaNumPredict: normalizeInt(raw.ollamaNumPredict, DEFAULT_FUN_CONFIG.ollamaNumPredict, {
      min: 16,
      max: 200,
      rounding: 'floor',
      clamp: true,
    }),
    ollamaTemperature: Number.isFinite(Number(raw.ollamaTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.ollamaTemperature)))
      : DEFAULT_FUN_CONFIG.ollamaTemperature,
    ollamaMaxChars: normalizeInt(raw.ollamaMaxChars, DEFAULT_FUN_CONFIG.ollamaMaxChars, {
      min: 40,
      max: 280,
      rounding: 'floor',
      clamp: true,
    }),
  };
}

export function resolveFunConfig(funRuntimeConfig) {
  return normalizeFunConfig(funRuntimeConfig);
}

export function getFunGroupWhitelistSet(funConfig) {
  const list = Array.isArray(funConfig?.groupWhitelistJids) ? funConfig.groupWhitelistJids : [];
  return new Set(list.map(j => String(j ?? '').trim()).filter(Boolean));
}

export function peekFunDataDirFromDisk() {
  if (process.env.TMB_DATA_DIR) {
    return path.resolve(String(process.env.TMB_DATA_DIR).trim());
  }
  if (!fs.existsSync(FUN_USER_CONFIG_PATH)) {
    return FUN_DEFAULT_DATA_DIR;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(FUN_USER_CONFIG_PATH, 'utf-8'));
    const custom = String(parsed?.dataDir ?? '').trim();
    if (custom) return path.resolve(custom);
  } catch {
    // ignore
  }
  return FUN_DEFAULT_DATA_DIR;
}

export function loadFunUserConfig() {
  if (!fs.existsSync(FUN_USER_CONFIG_PATH)) {
    return normalizeFunConfig({
      dataDir: FUN_DEFAULT_DATA_DIR,
    });
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FUN_USER_CONFIG_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') {
      return normalizeFunConfig({ dataDir: FUN_DEFAULT_DATA_DIR });
    }
    return normalizeFunConfig({
      ...raw,
      dataDir: String(raw.dataDir ?? '').trim() || FUN_DEFAULT_DATA_DIR,
    });
  } catch {
    return normalizeFunConfig({ dataDir: FUN_DEFAULT_DATA_DIR });
  }
}

export function saveFunUserConfig(input) {
  const normalized = normalizeFunConfig(input);
  const payload = {
    prefix: normalized.prefix,
    cooldownMs: normalized.cooldownMs,
    xpMin: normalized.xpMin,
    xpMax: normalized.xpMax,
    dailyXp: normalized.dailyXp,
    dailyCoins: normalized.dailyCoins,
    rankLimit: normalized.rankLimit,
    announceLevelUp: normalized.announceLevelUp,
    requireGroupWhitelist: normalized.requireGroupWhitelist,
    allowDm: normalized.allowDm,
    groupWhitelistJids: normalized.groupWhitelistJids,
    debugMode: normalized.debugMode,
    logLevel: normalized.logLevel,
    dataDir: normalized.dataDir || FUN_DEFAULT_DATA_DIR,
    rankCardImage: normalized.rankCardImage,
    dashboardEnabled: normalized.dashboardEnabled,
    dashboardHost: normalized.dashboardHost,
    dashboardPort: normalized.dashboardPort,
    ollamaEnabled: normalized.ollamaEnabled,
    ollamaBaseUrl: normalized.ollamaBaseUrl,
    ollamaModel: normalized.ollamaModel,
    ollamaTimeoutMs: normalized.ollamaTimeoutMs,
    ollamaNumPredict: normalized.ollamaNumPredict,
    ollamaTemperature: normalized.ollamaTemperature,
    ollamaMaxChars: normalized.ollamaMaxChars,
  };
  fs.writeFileSync(FUN_USER_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  return normalizeFunConfig(payload);
}
