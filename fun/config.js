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
    dmCommandsOnly: normalizeBoolean(raw.dmCommandsOnly, DEFAULT_FUN_CONFIG.dmCommandsOnly),
    dmMembershipCacheTtlMs: normalizeInt(
      raw.dmMembershipCacheTtlMs,
      DEFAULT_FUN_CONFIG.dmMembershipCacheTtlMs,
      { min: 0, max: 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    commandExclusive: normalizeBoolean(raw.commandExclusive, DEFAULT_FUN_CONFIG.commandExclusive),
    groupWhitelistJids: toStringArray(raw.groupWhitelistJids),
    debugMode: normalizeBoolean(raw.debugMode, DEFAULT_FUN_CONFIG.debugMode),
    logLevel: toText(raw.logLevel, DEFAULT_FUN_CONFIG.logLevel).toLowerCase() || DEFAULT_FUN_CONFIG.logLevel,
    dataDir: toText(raw.dataDir, '') || '',
    rankCardImage: normalizeBoolean(raw.rankCardImage, DEFAULT_FUN_CONFIG.rankCardImage),
    cardsEnabled: normalizeBoolean(raw.cardsEnabled, DEFAULT_FUN_CONFIG.cardsEnabled),
    cardPackCost: normalizeInt(raw.cardPackCost, DEFAULT_FUN_CONFIG.cardPackCost, {
      min: 1,
      max: 1_000_000,
      rounding: 'floor',
      clamp: true,
    }),
    cardMaxPacksPerOpen: normalizeInt(
      raw.cardMaxPacksPerOpen,
      DEFAULT_FUN_CONFIG.cardMaxPacksPerOpen,
      { min: 1, max: 100, rounding: 'floor', clamp: true }
    ),
    cardTradeTtlMs: normalizeInt(raw.cardTradeTtlMs, DEFAULT_FUN_CONFIG.cardTradeTtlMs, {
      min: 30_000,
      max: 24 * 60 * 60 * 1000,
      rounding: 'floor',
      clamp: true,
    }),
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
    eventAutoSpawn: normalizeBoolean(raw.eventAutoSpawn, DEFAULT_FUN_CONFIG.eventAutoSpawn),
    eventAutoSpawnChance: Number.isFinite(Number(raw.eventAutoSpawnChance))
      ? Math.min(1, Math.max(0, Number(raw.eventAutoSpawnChance)))
      : DEFAULT_FUN_CONFIG.eventAutoSpawnChance,
    eventTickChance: Number.isFinite(Number(raw.eventTickChance))
      ? Math.min(1, Math.max(0, Number(raw.eventTickChance)))
      : DEFAULT_FUN_CONFIG.eventTickChance,
    worldAutonomous: normalizeBoolean(raw.worldAutonomous, DEFAULT_FUN_CONFIG.worldAutonomous),
    worldTickMs: normalizeInt(raw.worldTickMs, DEFAULT_FUN_CONFIG.worldTickMs, {
      min: 15_000,
      max: 30 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    worldQuietHoursEnabled: normalizeBoolean(
      raw.worldQuietHoursEnabled,
      DEFAULT_FUN_CONFIG.worldQuietHoursEnabled
    ),
    worldQuietHourStart: normalizeInt(
      raw.worldQuietHourStart,
      DEFAULT_FUN_CONFIG.worldQuietHourStart,
      { min: 0, max: 23, rounding: 'floor', clamp: true }
    ),
    worldQuietHourEnd: normalizeInt(
      raw.worldQuietHourEnd,
      DEFAULT_FUN_CONFIG.worldQuietHourEnd,
      { min: 0, max: 24, rounding: 'floor', clamp: true }
    ),
    worldTimezone:
      toText(raw.worldTimezone, DEFAULT_FUN_CONFIG.worldTimezone) ||
      DEFAULT_FUN_CONFIG.worldTimezone,
    selfHealEnabled: normalizeBoolean(raw.selfHealEnabled, DEFAULT_FUN_CONFIG.selfHealEnabled),
    selfHealDryRun: normalizeBoolean(raw.selfHealDryRun, DEFAULT_FUN_CONFIG.selfHealDryRun),
    selfHealIntervalMs: normalizeInt(raw.selfHealIntervalMs, DEFAULT_FUN_CONFIG.selfHealIntervalMs, {
      min: 1,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    selfHealEvidenceRetentionDays: normalizeInt(raw.selfHealEvidenceRetentionDays, DEFAULT_FUN_CONFIG.selfHealEvidenceRetentionDays, {
      min: 1,
      max: 365,
      rounding: 'floor',
      clamp: true,
    }),
    selfHealMaxItemsPerRun: normalizeInt(raw.selfHealMaxItemsPerRun, DEFAULT_FUN_CONFIG.selfHealMaxItemsPerRun, {
      min: 1,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    selfHealMaxCallsPerRun: normalizeInt(raw.selfHealMaxCallsPerRun, DEFAULT_FUN_CONFIG.selfHealMaxCallsPerRun, {
      min: 1,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    eventHappyWeight: Number.isFinite(Number(raw.eventHappyWeight))
      ? Math.max(0, Number(raw.eventHappyWeight))
      : DEFAULT_FUN_CONFIG.eventHappyWeight,
    eventCrossWeight: Number.isFinite(Number(raw.eventCrossWeight))
      ? Math.max(0, Number(raw.eventCrossWeight))
      : DEFAULT_FUN_CONFIG.eventCrossWeight,
    zenEnabled: normalizeBoolean(raw.zenEnabled, DEFAULT_FUN_CONFIG.zenEnabled),
    zenBaseUrl: toText(raw.zenBaseUrl, DEFAULT_FUN_CONFIG.zenBaseUrl) || DEFAULT_FUN_CONFIG.zenBaseUrl,
    zenModel: toText(raw.zenModel, DEFAULT_FUN_CONFIG.zenModel) || DEFAULT_FUN_CONFIG.zenModel,
    zenTimeoutMs: normalizeInt(raw.zenTimeoutMs, DEFAULT_FUN_CONFIG.zenTimeoutMs, {
      min: 500,
      max: 300_000,
      rounding: 'floor',
      clamp: true,
    }),
    zenInventTimeoutMs: normalizeInt(
      raw.zenInventTimeoutMs,
      DEFAULT_FUN_CONFIG.zenInventTimeoutMs,
      { min: 5_000, max: 300_000, rounding: 'floor', clamp: true }
    ),
    flavorTimeoutMs: normalizeInt(raw.flavorTimeoutMs, DEFAULT_FUN_CONFIG.flavorTimeoutMs, {
      min: 1000,
      max: 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    zenMaxTokens: normalizeInt(raw.zenMaxTokens, DEFAULT_FUN_CONFIG.zenMaxTokens, {
      min: 16,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    zenTemperature: Number.isFinite(Number(raw.zenTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenTemperature)))
      : DEFAULT_FUN_CONFIG.zenTemperature,
    zenSendSamplingParams: normalizeBoolean(
      raw.zenSendSamplingParams,
      DEFAULT_FUN_CONFIG.zenSendSamplingParams
    ),
    zenApiKey: toText(raw.zenApiKey, DEFAULT_FUN_CONFIG.zenApiKey) || '',
    zenInventTemperature: Number.isFinite(Number(raw.zenInventTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenInventTemperature)))
      : DEFAULT_FUN_CONFIG.zenInventTemperature,
    zenInventMaxTokens: normalizeInt(
      raw.zenInventMaxTokens,
      DEFAULT_FUN_CONFIG.zenInventMaxTokens,
      { min: 64, max: 4000, rounding: 'floor', clamp: true }
    ),
    // zenInventTimeoutMs já normalizado acima (junto de zenTimeoutMs)
    zenExtractTemperature: Number.isFinite(Number(raw.zenExtractTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenExtractTemperature)))
      : DEFAULT_FUN_CONFIG.zenExtractTemperature,
    zenExtractMaxTokens: normalizeInt(
      raw.zenExtractMaxTokens,
      DEFAULT_FUN_CONFIG.zenExtractMaxTokens,
      { min: 64, max: 2000, rounding: 'floor', clamp: true }
    ),
    zenFlavorTemperature: Number.isFinite(Number(raw.zenFlavorTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenFlavorTemperature)))
      : DEFAULT_FUN_CONFIG.zenFlavorTemperature,
    zenFlavorMaxTokens: normalizeInt(
      raw.zenFlavorMaxTokens,
      DEFAULT_FUN_CONFIG.zenFlavorMaxTokens,
      { min: 32, max: 800, rounding: 'floor', clamp: true }
    ),
    zenChaosTemperature: Number.isFinite(Number(raw.zenChaosTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenChaosTemperature)))
      : DEFAULT_FUN_CONFIG.zenChaosTemperature,
    zenChaosMaxTokens: normalizeInt(
      raw.zenChaosMaxTokens,
      DEFAULT_FUN_CONFIG.zenChaosMaxTokens,
      { min: 64, max: 1200, rounding: 'floor', clamp: true }
    ),
    zenAssaultTemperature: Number.isFinite(Number(raw.zenAssaultTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenAssaultTemperature)))
      : DEFAULT_FUN_CONFIG.zenAssaultTemperature,
    zenAssaultMaxTokens: normalizeInt(
      raw.zenAssaultMaxTokens,
      DEFAULT_FUN_CONFIG.zenAssaultMaxTokens,
      { min: 200, max: 1200, rounding: 'floor', clamp: true }
    ),
    assaultStoryMaxChars: normalizeInt(
      raw.assaultStoryMaxChars,
      DEFAULT_FUN_CONFIG.assaultStoryMaxChars,
      { min: 400, max: 1500, rounding: 'floor', clamp: true }
    ),
    assaultStoryMaxTokens: normalizeInt(
      raw.assaultStoryMaxTokens,
      DEFAULT_FUN_CONFIG.assaultStoryMaxTokens,
      { min: 200, max: 1200, rounding: 'floor', clamp: true }
    ),
    zenPersonaTemperature: Number.isFinite(Number(raw.zenPersonaTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenPersonaTemperature)))
      : DEFAULT_FUN_CONFIG.zenPersonaTemperature,
    zenPersonaMaxTokens: normalizeInt(
      raw.zenPersonaMaxTokens,
      DEFAULT_FUN_CONFIG.zenPersonaMaxTokens,
      { min: 64, max: 800, rounding: 'floor', clamp: true }
    ),
    zenDailyGuessTemperature: Number.isFinite(Number(raw.zenDailyGuessTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenDailyGuessTemperature)))
      : DEFAULT_FUN_CONFIG.zenDailyGuessTemperature,
    zenDailyGuessMaxTokens: normalizeInt(
      raw.zenDailyGuessMaxTokens,
      DEFAULT_FUN_CONFIG.zenDailyGuessMaxTokens,
      { min: 64, max: 1200, rounding: 'floor', clamp: true }
    ),
    zenDailyGuessTimeoutMs: normalizeInt(
      raw.zenDailyGuessTimeoutMs,
      DEFAULT_FUN_CONFIG.zenDailyGuessTimeoutMs,
      { min: 5_000, max: 120_000, rounding: 'floor', clamp: true }
    ),
    zenDailyHintTemperature: Number.isFinite(Number(raw.zenDailyHintTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenDailyHintTemperature)))
      : DEFAULT_FUN_CONFIG.zenDailyHintTemperature,
    zenDailyHintMaxTokens: normalizeInt(
      raw.zenDailyHintMaxTokens,
      DEFAULT_FUN_CONFIG.zenDailyHintMaxTokens,
      { min: 64, max: 800, rounding: 'floor', clamp: true }
    ),
    zenDailyHintTimeoutMs: normalizeInt(
      raw.zenDailyHintTimeoutMs,
      DEFAULT_FUN_CONFIG.zenDailyHintTimeoutMs,
      { min: 5_000, max: 120_000, rounding: 'floor', clamp: true }
    ),
    zenQmpTemperature: Number.isFinite(Number(raw.zenQmpTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenQmpTemperature)))
      : DEFAULT_FUN_CONFIG.zenQmpTemperature,
    zenQmpMaxTokens: normalizeInt(
      raw.zenQmpMaxTokens,
      DEFAULT_FUN_CONFIG.zenQmpMaxTokens,
      { min: 64, max: 1200, rounding: 'floor', clamp: true }
    ),
    zenQmpTimeoutMs: normalizeInt(
      raw.zenQmpTimeoutMs,
      DEFAULT_FUN_CONFIG.zenQmpTimeoutMs,
      { min: 3_000, max: 120_000, rounding: 'floor', clamp: true }
    ),
    zenJournalistTemperature: Number.isFinite(Number(raw.zenJournalistTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.zenJournalistTemperature)))
      : DEFAULT_FUN_CONFIG.zenJournalistTemperature,
    zenJournalistMaxTokens: normalizeInt(
      raw.zenJournalistMaxTokens,
      DEFAULT_FUN_CONFIG.zenJournalistMaxTokens,
      { min: 128, max: 2000, rounding: 'floor', clamp: true }
    ),
    marketJournalistEnabled: normalizeBoolean(
      raw.marketJournalistEnabled,
      DEFAULT_FUN_CONFIG.marketJournalistEnabled
    ),
    flavorAlways: normalizeBoolean(raw.flavorAlways, DEFAULT_FUN_CONFIG.flavorAlways),
    flavorRecentMax: normalizeInt(raw.flavorRecentMax, DEFAULT_FUN_CONFIG.flavorRecentMax, {
      min: 0,
      max: 40,
      rounding: 'floor',
      clamp: true,
    }),
    zenTasks:
      raw.zenTasks && typeof raw.zenTasks === 'object' && !Array.isArray(raw.zenTasks)
        ? raw.zenTasks
        : undefined,
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
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    ollamaTemperature: Number.isFinite(Number(raw.ollamaTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.ollamaTemperature)))
      : DEFAULT_FUN_CONFIG.ollamaTemperature,
    ollamaMaxChars: normalizeInt(raw.ollamaMaxChars, DEFAULT_FUN_CONFIG.ollamaMaxChars, {
      min: 40,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    // -1 forever | 0 unload | "30m" | segundos
    ollamaKeepAlive:
      raw.ollamaKeepAlive === undefined || raw.ollamaKeepAlive === null || raw.ollamaKeepAlive === ''
        ? DEFAULT_FUN_CONFIG.ollamaKeepAlive
        : typeof raw.ollamaKeepAlive === 'number'
          ? raw.ollamaKeepAlive
          : /^-?\d+(\.\d+)?$/.test(String(raw.ollamaKeepAlive).trim())
            ? Number(raw.ollamaKeepAlive)
            : String(raw.ollamaKeepAlive).trim(),
    ollamaWarmupOnBoot: normalizeBoolean(raw.ollamaWarmupOnBoot, DEFAULT_FUN_CONFIG.ollamaWarmupOnBoot),
    ollamaWarmupTimeoutMs: normalizeInt(
      raw.ollamaWarmupTimeoutMs,
      DEFAULT_FUN_CONFIG.ollamaWarmupTimeoutMs,
      { min: 5_000, max: 600_000, rounding: 'floor', clamp: true }
    ),
    ollamaKeepAliveRefreshMs: normalizeInt(
      raw.ollamaKeepAliveRefreshMs,
      DEFAULT_FUN_CONFIG.ollamaKeepAliveRefreshMs,
      { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    replyCommandsInPrivate: normalizeBoolean(
      raw.replyCommandsInPrivate,
      DEFAULT_FUN_CONFIG.replyCommandsInPrivate
    ),
    mentionUsers: normalizeBoolean(raw.mentionUsers, DEFAULT_FUN_CONFIG.mentionUsers),
    replyQuoted: normalizeBoolean(raw.replyQuoted, DEFAULT_FUN_CONFIG.replyQuoted),
    reactionsEnabled: normalizeBoolean(raw.reactionsEnabled, DEFAULT_FUN_CONFIG.reactionsEnabled),
    reactionProviderTimeoutMs: normalizeInt(
      raw.reactionProviderTimeoutMs,
      DEFAULT_FUN_CONFIG.reactionProviderTimeoutMs,
      { min: 500, max: 30_000, rounding: 'floor', clamp: true }
    ),
    reactionAnimeProviderOrder: toStringArray(raw.reactionAnimeProviderOrder).length
      ? toStringArray(raw.reactionAnimeProviderOrder)
      : DEFAULT_FUN_CONFIG.reactionAnimeProviderOrder,
    reactionUserAgent:
      toText(raw.reactionUserAgent, DEFAULT_FUN_CONFIG.reactionUserAgent) ||
      DEFAULT_FUN_CONFIG.reactionUserAgent,
    tenorApiKey:
      toText(raw.tenorApiKey, process.env.TENOR_API_KEY || DEFAULT_FUN_CONFIG.tenorApiKey) || '',
    youtubeApiKey:
      toText(raw.youtubeApiKey, process.env.YOUTUBE_API_KEY || DEFAULT_FUN_CONFIG.youtubeApiKey) || '',
    meteredApiKey:
      toText(raw.meteredApiKey, process.env.METERED_API_KEY || '') || '',
    meteredDomain:
      toText(raw.meteredDomain, process.env.METERED_DOMAIN || 'chupebot.metered.live') || 'chupebot.metered.live',
    tenorClientKey:
      toText(raw.tenorClientKey, DEFAULT_FUN_CONFIG.tenorClientKey) ||
      DEFAULT_FUN_CONFIG.tenorClientKey,
    imageGenEnabled: normalizeBoolean(raw.imageGenEnabled, DEFAULT_FUN_CONFIG.imageGenEnabled),
    imageGenBaseUrl:
      toText(raw.imageGenBaseUrl, DEFAULT_FUN_CONFIG.imageGenBaseUrl) ||
      DEFAULT_FUN_CONFIG.imageGenBaseUrl,
    imageGenApiKey: toText(raw.imageGenApiKey, DEFAULT_FUN_CONFIG.imageGenApiKey) || '',
    imageGenModel: toText(raw.imageGenModel, DEFAULT_FUN_CONFIG.imageGenModel) || '',
    imageGenDailyLimit: normalizeInt(raw.imageGenDailyLimit, DEFAULT_FUN_CONFIG.imageGenDailyLimit, {
      min: 1,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    imageGenTimeoutMs: normalizeInt(raw.imageGenTimeoutMs, DEFAULT_FUN_CONFIG.imageGenTimeoutMs, {
      min: 1000,
      max: 10 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    imageGenSize: toText(raw.imageGenSize, DEFAULT_FUN_CONFIG.imageGenSize) || '',
    imageGenQuality: toText(raw.imageGenQuality, DEFAULT_FUN_CONFIG.imageGenQuality) || '',
    imageGenResponseFormat:
      toText(raw.imageGenResponseFormat, DEFAULT_FUN_CONFIG.imageGenResponseFormat)
        .toLowerCase()
        .trim() === 'b64_json'
        ? 'b64_json'
        : 'url',
    imageGenLoreMaxChars: normalizeInt(
      raw.imageGenLoreMaxChars,
      DEFAULT_FUN_CONFIG.imageGenLoreMaxChars,
      { min: 0, max: 10_000, rounding: 'floor', clamp: true }
    ),
    casinoMin: normalizeInt(raw.casinoMin, DEFAULT_FUN_CONFIG.casinoMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    casinoMax: normalizeInt(raw.casinoMax, DEFAULT_FUN_CONFIG.casinoMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    casinoCooldownMs: normalizeInt(raw.casinoCooldownMs, DEFAULT_FUN_CONFIG.casinoCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    casinoHouseEdge: Number.isFinite(Number(raw.casinoHouseEdge))
      ? Math.min(0.2, Math.max(0, Number(raw.casinoHouseEdge)))
      : DEFAULT_FUN_CONFIG.casinoHouseEdge,
    jackpotRate: Number.isFinite(Number(raw.jackpotRate))
      ? Math.min(0.05, Math.max(0, Number(raw.jackpotRate)))
      : DEFAULT_FUN_CONFIG.jackpotRate,
    jackpotMinHit: normalizeInt(raw.jackpotMinHit, DEFAULT_FUN_CONFIG.jackpotMinHit, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    rouletteCooldownMs: normalizeInt(raw.rouletteCooldownMs, DEFAULT_FUN_CONFIG.rouletteCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    slotCooldownMs: normalizeInt(raw.slotCooldownMs, DEFAULT_FUN_CONFIG.slotCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    crashMin: normalizeInt(raw.crashMin, DEFAULT_FUN_CONFIG.crashMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    crashMax: normalizeInt(raw.crashMax, DEFAULT_FUN_CONFIG.crashMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    crashCooldownMs: normalizeInt(raw.crashCooldownMs, DEFAULT_FUN_CONFIG.crashCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    crashMaxMult: Number.isFinite(Number(raw.crashMaxMult))
      ? Math.min(50, Math.max(2, Number(raw.crashMaxMult)))
      : DEFAULT_FUN_CONFIG.crashMaxMult,
    crashGrowthPerSec: Number.isFinite(Number(raw.crashGrowthPerSec))
      ? Math.min(1, Math.max(0.05, Number(raw.crashGrowthPerSec)))
      : DEFAULT_FUN_CONFIG.crashGrowthPerSec,
    crashTtlMs: normalizeInt(raw.crashTtlMs, DEFAULT_FUN_CONFIG.crashTtlMs, { min: 10_000, max: 120_000, rounding: 'floor', clamp: true }),
    blackjackMin: normalizeInt(raw.blackjackMin, DEFAULT_FUN_CONFIG.blackjackMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    blackjackMax: normalizeInt(raw.blackjackMax, DEFAULT_FUN_CONFIG.blackjackMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    blackjackCooldownMs: normalizeInt(raw.blackjackCooldownMs, DEFAULT_FUN_CONFIG.blackjackCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    diceDuelMin: normalizeInt(raw.diceDuelMin, DEFAULT_FUN_CONFIG.diceDuelMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    diceDuelMax: normalizeInt(raw.diceDuelMax, DEFAULT_FUN_CONFIG.diceDuelMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    tournamentEntryMin: normalizeInt(raw.tournamentEntryMin, DEFAULT_FUN_CONFIG.tournamentEntryMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    tournamentEntryMax: normalizeInt(raw.tournamentEntryMax, DEFAULT_FUN_CONFIG.tournamentEntryMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    tournamentSize: normalizeInt(raw.tournamentSize, DEFAULT_FUN_CONFIG.tournamentSize, { min: 4, max: 4, rounding: 'floor', clamp: true }),
    bingoMin: normalizeInt(raw.bingoMin, DEFAULT_FUN_CONFIG.bingoMin, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    bingoMax: normalizeInt(raw.bingoMax, DEFAULT_FUN_CONFIG.bingoMax, { min: 1, max: 1_000_000, rounding: 'floor', clamp: true }),
    bingoCooldownMs: normalizeInt(raw.bingoCooldownMs, DEFAULT_FUN_CONFIG.bingoCooldownMs, { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    bingoSize: normalizeInt(raw.bingoSize, DEFAULT_FUN_CONFIG.bingoSize, { min: 2, max: 8, rounding: 'floor', clamp: true }),
    bingoMinPlayers: normalizeInt(raw.bingoMinPlayers, DEFAULT_FUN_CONFIG.bingoMinPlayers, { min: 2, max: 8, rounding: 'floor', clamp: true }),
    bingoLobbyTtlMs: normalizeInt(raw.bingoLobbyTtlMs, DEFAULT_FUN_CONFIG.bingoLobbyTtlMs, { min: 60_000, max: 30 * 60_000, rounding: 'floor', clamp: true }),
    bingoPoolMax: normalizeInt(raw.bingoPoolMax, DEFAULT_FUN_CONFIG.bingoPoolMax, { min: 9, max: 75, rounding: 'floor', clamp: true }),
    bingoDrawCount: normalizeInt(raw.bingoDrawCount, DEFAULT_FUN_CONFIG.bingoDrawCount, { min: 5, max: 40, rounding: 'floor', clamp: true }),
    bingoHouseEdge: Number.isFinite(Number(raw.bingoHouseEdge))
      ? Math.min(0.2, Math.max(0, Number(raw.bingoHouseEdge)))
      : DEFAULT_FUN_CONFIG.bingoHouseEdge,
    bingoSoloLineMult: Number.isFinite(Number(raw.bingoSoloLineMult))
      ? Math.min(20, Math.max(1.1, Number(raw.bingoSoloLineMult)))
      : DEFAULT_FUN_CONFIG.bingoSoloLineMult,
    bingoSoloFullMult: Number.isFinite(Number(raw.bingoSoloFullMult))
      ? Math.min(50, Math.max(2, Number(raw.bingoSoloFullMult)))
      : DEFAULT_FUN_CONFIG.bingoSoloFullMult,
    // clássico depreciado — sempre fast
    bingoDefaultMode: 'fast',
    marketEnabled: normalizeBoolean(raw.marketEnabled, DEFAULT_FUN_CONFIG.marketEnabled),
    marketEventMinMs: normalizeInt(raw.marketEventMinMs, DEFAULT_FUN_CONFIG.marketEventMinMs, {
      min: 30 * 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    marketEventMaxMs: normalizeInt(raw.marketEventMaxMs, DEFAULT_FUN_CONFIG.marketEventMaxMs, {
      min: 45 * 60_000,
      max: 48 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    marketBreakChance: Number.isFinite(Number(raw.marketBreakChance))
      ? Math.min(0.35, Math.max(0, Number(raw.marketBreakChance)))
      : DEFAULT_FUN_CONFIG.marketBreakChance,
    marketRepairRate: Number.isFinite(Number(raw.marketRepairRate))
      ? Math.min(0.6, Math.max(0.05, Number(raw.marketRepairRate)))
      : DEFAULT_FUN_CONFIG.marketRepairRate,
    marketAnnounce: normalizeBoolean(raw.marketAnnounce, DEFAULT_FUN_CONFIG.marketAnnounce),
    marketRestockMs: normalizeInt(raw.marketRestockMs, DEFAULT_FUN_CONFIG.marketRestockMs, {
      min: 60 * 60_000,
      max: 30 * 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    economyEnabled: normalizeBoolean(raw.economyEnabled, DEFAULT_FUN_CONFIG.economyEnabled),
    economyTickMs: normalizeInt(raw.economyTickMs, DEFAULT_FUN_CONFIG.economyTickMs, {
      min: 60_000,
      max: 6 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    economyRegulateMs: normalizeInt(
      raw.economyRegulateMs,
      DEFAULT_FUN_CONFIG.economyRegulateMs,
      {
        min: 60_000,
        max: 12 * 60 * 60_000,
        rounding: 'floor',
        clamp: true,
      }
    ),
    bolsaEnabled: normalizeBoolean(raw.bolsaEnabled, DEFAULT_FUN_CONFIG.bolsaEnabled),
    bolsaTradeCooldownMs: normalizeInt(
      raw.bolsaTradeCooldownMs,
      DEFAULT_FUN_CONFIG.bolsaTradeCooldownMs,
      { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    bolsaMaxQtyPerTicker: normalizeInt(
      raw.bolsaMaxQtyPerTicker,
      DEFAULT_FUN_CONFIG.bolsaMaxQtyPerTicker,
      { min: 1, max: 10_000, rounding: 'floor', clamp: true }
    ),
    bolsaMaxPositionCoins: normalizeInt(
      raw.bolsaMaxPositionCoins,
      DEFAULT_FUN_CONFIG.bolsaMaxPositionCoins,
      { min: 50, max: 1_000_000, rounding: 'floor', clamp: true }
    ),
    bolsaMinQty: normalizeInt(raw.bolsaMinQty, DEFAULT_FUN_CONFIG.bolsaMinQty, {
      min: 1,
      max: 1000,
      rounding: 'floor',
      clamp: true,
    }),
    bolsaDividendPeriodMs: normalizeInt(
      raw.bolsaDividendPeriodMs,
      DEFAULT_FUN_CONFIG.bolsaDividendPeriodMs,
      { min: 60_000, max: 30 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    bolsaDividendCapPerTick: normalizeInt(
      raw.bolsaDividendCapPerTick,
      DEFAULT_FUN_CONFIG.bolsaDividendCapPerTick,
      { min: 0, max: 100_000, rounding: 'floor', clamp: true }
    ),
    assaultCooldownMs: normalizeInt(raw.assaultCooldownMs, DEFAULT_FUN_CONFIG.assaultCooldownMs, {
      min: 0,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    assaultMinSteal: normalizeInt(raw.assaultMinSteal, DEFAULT_FUN_CONFIG.assaultMinSteal, {
      min: 1,
      max: 10_000,
      rounding: 'floor',
      clamp: true,
    }),
    assaultMaxStealRatio: Number.isFinite(Number(raw.assaultMaxStealRatio))
      ? Math.min(0.5, Math.max(0.05, Number(raw.assaultMaxStealRatio)))
      : DEFAULT_FUN_CONFIG.assaultMaxStealRatio,
    assaultBaseChance: Number.isFinite(Number(raw.assaultBaseChance))
      ? Math.min(0.9, Math.max(0.05, Number(raw.assaultBaseChance)))
      : DEFAULT_FUN_CONFIG.assaultBaseChance,
    publicBaseUrl: toText(raw.publicBaseUrl, DEFAULT_FUN_CONFIG.publicBaseUrl || ''),
    jobTestPath: toText(raw.jobTestPath, DEFAULT_FUN_CONFIG.jobTestPath || '/job/play') || '/job/play',
    jobTokenSecret: toText(raw.jobTokenSecret, DEFAULT_FUN_CONFIG.jobTokenSecret || ''),
    jobLinkTtlMs: normalizeInt(raw.jobLinkTtlMs, DEFAULT_FUN_CONFIG.jobLinkTtlMs, {
      min: 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    dashboardUiPort: normalizeInt(raw.dashboardUiPort, DEFAULT_FUN_CONFIG.dashboardUiPort || 3001, {
      min: 1,
      max: 65535,
      rounding: 'floor',
      clamp: true,
    }),
    dashboardAllowedOrigins: Array.isArray(raw.dashboardAllowedOrigins)
      ? raw.dashboardAllowedOrigins.map((v) => String(v || '').trim()).filter(Boolean)
      : (DEFAULT_FUN_CONFIG.dashboardAllowedOrigins || []),
    assaultFailFinePct: Number.isFinite(Number(raw.assaultFailFinePct))
      ? Math.min(0.1, Math.max(0, Number(raw.assaultFailFinePct)))
      : DEFAULT_FUN_CONFIG.assaultFailFinePct,
    assaultFailFineMin: normalizeInt(raw.assaultFailFineMin, DEFAULT_FUN_CONFIG.assaultFailFineMin, {
      min: 0,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    assaultFailFineMax: normalizeInt(raw.assaultFailFineMax, DEFAULT_FUN_CONFIG.assaultFailFineMax, {
      min: 1,
      max: 5000,
      rounding: 'floor',
      clamp: true,
    }),
    /**
     * Multas de heist (NPC) calibradas por modo:
     * - loja (5%): crime menor, perda leve.
     * - banco (10%): crime grave, perda moderada.
     * Teto por modo é o mesmo `assaultFailFineMax` para não fragmentar clamping.
     */
    heistShopFailFinePct: Number.isFinite(Number(raw.heistShopFailFinePct))
      ? Math.min(0.5, Math.max(0, Number(raw.heistShopFailFinePct)))
      : DEFAULT_FUN_CONFIG.heistShopFailFinePct,
    heistBankFailFinePct: Number.isFinite(Number(raw.heistBankFailFinePct))
      ? Math.min(0.5, Math.max(0, Number(raw.heistBankFailFinePct)))
      : DEFAULT_FUN_CONFIG.heistBankFailFinePct,
    heistShopMin: normalizeInt(raw.heistShopMin, DEFAULT_FUN_CONFIG.heistShopMin, {
      min: 1,
      max: 50_000,
      rounding: 'floor',
      clamp: true,
    }),
    heistShopMax: normalizeInt(raw.heistShopMax, DEFAULT_FUN_CONFIG.heistShopMax, {
      min: 1,
      max: 100_000,
      rounding: 'floor',
      clamp: true,
    }),
    heistShopBaseChance: Number.isFinite(Number(raw.heistShopBaseChance))
      ? Math.min(0.9, Math.max(0.05, Number(raw.heistShopBaseChance)))
      : DEFAULT_FUN_CONFIG.heistShopBaseChance,
    heistBankMin: normalizeInt(raw.heistBankMin, DEFAULT_FUN_CONFIG.heistBankMin, {
      min: 1,
      max: 100_000,
      rounding: 'floor',
      clamp: true,
    }),
    heistBankMax: normalizeInt(raw.heistBankMax, DEFAULT_FUN_CONFIG.heistBankMax, {
      min: 1,
      max: 200_000,
      rounding: 'floor',
      clamp: true,
    }),
    heistBankBaseChance: Number.isFinite(Number(raw.heistBankBaseChance))
      ? Math.min(0.9, Math.max(0.05, Number(raw.heistBankBaseChance)))
      : DEFAULT_FUN_CONFIG.heistBankBaseChance,
    heistBankCooldownMs: normalizeInt(raw.heistBankCooldownMs, DEFAULT_FUN_CONFIG.heistBankCooldownMs, {
      min: 0,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    heistShopCooldownMs: normalizeInt(raw.heistShopCooldownMs, DEFAULT_FUN_CONFIG.heistShopCooldownMs, {
      min: 0,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    tarotEnabled: normalizeBoolean(raw.tarotEnabled, DEFAULT_FUN_CONFIG.tarotEnabled),
    tarotCooldownMs: normalizeInt(raw.tarotCooldownMs, DEFAULT_FUN_CONFIG.tarotCooldownMs, {
      min: 0,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    tarotMaxChars: normalizeInt(raw.tarotMaxChars, DEFAULT_FUN_CONFIG.tarotMaxChars, {
      min: 400,
      max: 3000,
      rounding: 'floor',
      clamp: true,
    }),
    tarotCardCount: normalizeInt(raw.tarotCardCount, DEFAULT_FUN_CONFIG.tarotCardCount, {
      min: 1,
      max: 5,
      rounding: 'floor',
      clamp: true,
    }),
    tarotTimeoutMs: normalizeInt(raw.tarotTimeoutMs, DEFAULT_FUN_CONFIG.tarotTimeoutMs, {
      min: 3000,
      max: 120_000,
      rounding: 'floor',
      clamp: true,
    }),
    tarotMaxTokens: normalizeInt(raw.tarotMaxTokens, DEFAULT_FUN_CONFIG.tarotMaxTokens, {
      min: 64,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    tarotTemperature: Number.isFinite(Number(raw.tarotTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.tarotTemperature)))
      : DEFAULT_FUN_CONFIG.tarotTemperature,
    qmpEnabled: normalizeBoolean(raw.qmpEnabled, DEFAULT_FUN_CONFIG.qmpEnabled),
    qmpAutoTriggerChance: (() => {
      const envRaw = process.env.QMP_AUTO_TRIGGER_CHANCE;
      const fromEnv = envRaw != null && envRaw !== '' ? Number(envRaw) : NaN;
      const rawVal = Number.isFinite(fromEnv)
        ? fromEnv
        : Number.isFinite(Number(raw.qmpAutoTriggerChance))
          ? Number(raw.qmpAutoTriggerChance)
          : DEFAULT_FUN_CONFIG.qmpAutoTriggerChance;
      return Math.min(1, Math.max(0, rawVal));
    })(),
    qmpAutoTriggerCooldownMs: normalizeInt(
      raw.qmpAutoTriggerCooldownMs,
      DEFAULT_FUN_CONFIG.qmpAutoTriggerCooldownMs,
      { min: 0, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    qmpRoundDurationMs: normalizeInt(
      raw.qmpRoundDurationMs,
      DEFAULT_FUN_CONFIG.qmpRoundDurationMs,
      { min: 60_000, max: 2 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    qmpCooldownMs: normalizeInt(raw.qmpCooldownMs, DEFAULT_FUN_CONFIG.qmpCooldownMs, {
      min: 0,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    qmpMaxPromptLen: normalizeInt(raw.qmpMaxPromptLen, DEFAULT_FUN_CONFIG.qmpMaxPromptLen, {
      min: 40,
      max: 300,
      rounding: 'floor',
      clamp: true,
    }),
    qmpRankLimit: normalizeInt(raw.qmpRankLimit, DEFAULT_FUN_CONFIG.qmpRankLimit, {
      min: 3,
      max: 50,
      rounding: 'floor',
      clamp: true,
    }),
    qmpHistoryLimit: normalizeInt(raw.qmpHistoryLimit, DEFAULT_FUN_CONFIG.qmpHistoryLimit, {
      min: 3,
      max: 20,
      rounding: 'floor',
      clamp: true,
    }),
    qmpHeavyEvery: normalizeInt(raw.qmpHeavyEvery, DEFAULT_FUN_CONFIG.qmpHeavyEvery, {
      min: 2,
      max: 20,
      rounding: 'floor',
      clamp: true,
    }),
    qmpHeavyEnabled: normalizeBoolean(raw.qmpHeavyEnabled, DEFAULT_FUN_CONFIG.qmpHeavyEnabled),
    qmpAntiEchoLimit: normalizeInt(
      raw.qmpAntiEchoLimit,
      DEFAULT_FUN_CONFIG.qmpAntiEchoLimit,
      { min: 4, max: 40, rounding: 'floor', clamp: true }
    ),
    qmpAntiEchoMaxOverlap: Number.isFinite(Number(raw.qmpAntiEchoMaxOverlap))
      ? Math.min(0.9, Math.max(0.2, Number(raw.qmpAntiEchoMaxOverlap)))
      : DEFAULT_FUN_CONFIG.qmpAntiEchoMaxOverlap,
    qmpInventRetries: normalizeInt(
      raw.qmpInventRetries,
      DEFAULT_FUN_CONFIG.qmpInventRetries,
      { min: 1, max: 4, rounding: 'floor', clamp: true }
    ),
    qmpTimeoutMs: normalizeInt(raw.qmpTimeoutMs, DEFAULT_FUN_CONFIG.qmpTimeoutMs, {
      min: 3000,
      max: 90_000,
      rounding: 'floor',
      clamp: true,
    }),
    qmpMaxTokens: normalizeInt(raw.qmpMaxTokens, DEFAULT_FUN_CONFIG.qmpMaxTokens, {
      min: 64,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    qmpTemperature: Number.isFinite(Number(raw.qmpTemperature))
      ? Math.min(1.5, Math.max(0, Number(raw.qmpTemperature)))
      : DEFAULT_FUN_CONFIG.qmpTemperature,
    qmpZenModel:
      toText(raw.qmpZenModel, DEFAULT_FUN_CONFIG.qmpZenModel) ||
      DEFAULT_FUN_CONFIG.qmpZenModel ||
      '',
    happyHourDurationMs: normalizeInt(raw.happyHourDurationMs, DEFAULT_FUN_CONFIG.happyHourDurationMs, { min: 60_000, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    happyHourPayoutMult: Number.isFinite(Number(raw.happyHourPayoutMult))
      ? Math.min(2, Math.max(1, Number(raw.happyHourPayoutMult)))
      : DEFAULT_FUN_CONFIG.happyHourPayoutMult,
    happyHourCooldownMs: normalizeInt(raw.happyHourCooldownMs, DEFAULT_FUN_CONFIG.happyHourCooldownMs, { min: 0, max: 7 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    russianChambers: normalizeInt(raw.russianChambers, DEFAULT_FUN_CONFIG.russianChambers, {
      min: 2,
      max: 12,
      rounding: 'floor',
      clamp: true,
    }),
    russianDeathMs: normalizeInt(raw.russianDeathMs, DEFAULT_FUN_CONFIG.russianDeathMs, {
      min: 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    russianIdleMs: normalizeInt(raw.russianIdleMs, DEFAULT_FUN_CONFIG.russianIdleMs, {
      min: 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    chaosCooldownMs: normalizeInt(raw.chaosCooldownMs, DEFAULT_FUN_CONFIG.chaosCooldownMs, {
      min: 5_000,
      max: 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    chaosTimeoutMs: normalizeInt(raw.chaosTimeoutMs, DEFAULT_FUN_CONFIG.chaosTimeoutMs, {
      min: 5_000,
      max: 90_000,
      rounding: 'floor',
      clamp: true,
    }),
    chaosMaxChars: normalizeInt(raw.chaosMaxChars, DEFAULT_FUN_CONFIG.chaosMaxChars, {
      min: 200,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    chaosMaxTokens: normalizeInt(raw.chaosMaxTokens, DEFAULT_FUN_CONFIG.chaosMaxTokens, {
      min: 80,
      max: 1200,
      rounding: 'floor',
      clamp: true,
    }),
    propertiesEnabled: normalizeBoolean(
      raw.propertiesEnabled,
      DEFAULT_FUN_CONFIG.propertiesEnabled
    ),
    housesEnabled: normalizeBoolean(raw.housesEnabled, DEFAULT_FUN_CONFIG.housesEnabled),
    avatarEnabled: normalizeBoolean(raw.avatarEnabled, DEFAULT_FUN_CONFIG.avatarEnabled),
    visitsEnabled: normalizeBoolean(raw.visitsEnabled, DEFAULT_FUN_CONFIG.visitsEnabled),
    giftsEnabled: normalizeBoolean(raw.giftsEnabled, DEFAULT_FUN_CONFIG.giftsEnabled),
    robberyEnabled: normalizeBoolean(raw.robberyEnabled, DEFAULT_FUN_CONFIG.robberyEnabled),
    houseDailyCollectMax: normalizeInt(raw.houseDailyCollectMax, DEFAULT_FUN_CONFIG.houseDailyCollectMax, { min: 1, max: 5, rounding: 'floor', clamp: true }),
    houseMaxItems: normalizeInt(raw.houseMaxItems, DEFAULT_FUN_CONFIG.houseMaxItems, { min: 1, max: 48, rounding: 'floor', clamp: true }),
    houseCellGrid: toText(raw.houseCellGrid, DEFAULT_FUN_CONFIG.houseCellGrid) || DEFAULT_FUN_CONFIG.houseCellGrid,
    houseSecurityMaxLevel: normalizeInt(raw.houseSecurityMaxLevel, DEFAULT_FUN_CONFIG.houseSecurityMaxLevel, { min: 0, max: 6, rounding: 'floor', clamp: true }),
    houseRobberyCooldownMs: normalizeInt(raw.houseRobberyCooldownMs, DEFAULT_FUN_CONFIG.houseRobberyCooldownMs, { min: 0, max: 7 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    houseRobberyDailyMax: normalizeInt(raw.houseRobberyDailyMax, DEFAULT_FUN_CONFIG.houseRobberyDailyMax, { min: 0, max: 10, rounding: 'floor', clamp: true }),
    avatarShopRotationMs: normalizeInt(raw.avatarShopRotationMs, DEFAULT_FUN_CONFIG.avatarShopRotationMs, { min: 60_000, max: 30 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    houseVisitDailyMax: normalizeInt(raw.houseVisitDailyMax, DEFAULT_FUN_CONFIG.houseVisitDailyMax, { min: 1, max: 50, rounding: 'floor', clamp: true }),
    houseGiftDailyMax: normalizeInt(raw.houseGiftDailyMax, DEFAULT_FUN_CONFIG.houseGiftDailyMax, { min: 1, max: 20, rounding: 'floor', clamp: true }),
    propertyMaxOwned: normalizeInt(raw.propertyMaxOwned, DEFAULT_FUN_CONFIG.propertyMaxOwned, {
      min: 1,
      max: 6,
      rounding: 'floor',
      clamp: true,
    }),
    propertyTickMs: normalizeInt(raw.propertyTickMs, DEFAULT_FUN_CONFIG.propertyTickMs, {
      min: 60_000,
      max: 6 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    propertyMinHealthToEarn: normalizeInt(
      raw.propertyMinHealthToEarn,
      DEFAULT_FUN_CONFIG.propertyMinHealthToEarn,
      { min: 0, max: 100, rounding: 'floor', clamp: true }
    ),
    roastEnabled: normalizeBoolean(raw.roastEnabled, DEFAULT_FUN_CONFIG.roastEnabled),
    roastCooldownMs: normalizeInt(raw.roastCooldownMs, DEFAULT_FUN_CONFIG.roastCooldownMs, {
      min: 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    roastMaxChars: normalizeInt(raw.roastMaxChars, DEFAULT_FUN_CONFIG.roastMaxChars, {
      min: 200,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    groupNewsEnabled: normalizeBoolean(
      raw.groupNewsEnabled,
      DEFAULT_FUN_CONFIG.groupNewsEnabled
    ),
    groupNewsHour: normalizeInt(raw.groupNewsHour, DEFAULT_FUN_CONFIG.groupNewsHour, {
      min: 0,
      max: 23,
      rounding: 'floor',
      clamp: true,
    }),
    groupNewsMinute: normalizeInt(raw.groupNewsMinute, DEFAULT_FUN_CONFIG.groupNewsMinute, {
      min: 0,
      max: 59,
      rounding: 'floor',
      clamp: true,
    }),
    achievementsEnabled: normalizeBoolean(
      raw.achievementsEnabled,
      DEFAULT_FUN_CONFIG.achievementsEnabled
    ),
    memoryEnabled: normalizeBoolean(raw.memoryEnabled, DEFAULT_FUN_CONFIG.memoryEnabled),
    memoryMaxFacts: normalizeInt(raw.memoryMaxFacts, DEFAULT_FUN_CONFIG.memoryMaxFacts, {
      min: 10,
      max: 120,
      rounding: 'floor',
      clamp: true,
    }),
    memorySummaryMaxChars: normalizeInt(
      raw.memorySummaryMaxChars,
      DEFAULT_FUN_CONFIG.memorySummaryMaxChars,
      { min: 80, max: 200, rounding: 'floor', clamp: true }
    ),
    memoryPersonaMaxChars: normalizeInt(
      raw.memoryPersonaMaxChars,
      DEFAULT_FUN_CONFIG.memoryPersonaMaxChars,
      { min: 200, max: 800, rounding: 'floor', clamp: true }
    ),
    memoryPersonaBullets: normalizeInt(
      raw.memoryPersonaBullets,
      DEFAULT_FUN_CONFIG.memoryPersonaBullets,
      { min: 3, max: 15, rounding: 'floor', clamp: true }
    ),
    memoryBufferSize: normalizeInt(raw.memoryBufferSize, DEFAULT_FUN_CONFIG.memoryBufferSize, {
      min: 8,
      max: 200,
      rounding: 'floor',
      clamp: true,
    }),
    memoryFlushMinMessages: normalizeInt(
      raw.memoryFlushMinMessages,
      DEFAULT_FUN_CONFIG.memoryFlushMinMessages,
      { min: 3, max: 120, rounding: 'floor', clamp: true }
    ),
    memoryMinMsgChars: normalizeInt(raw.memoryMinMsgChars, DEFAULT_FUN_CONFIG.memoryMinMsgChars, {
      min: 6,
      max: 80,
      rounding: 'floor',
      clamp: true,
    }),
    memoryExtractTimeoutMs: normalizeInt(
      raw.memoryExtractTimeoutMs,
      DEFAULT_FUN_CONFIG.memoryExtractTimeoutMs,
      { min: 5_000, max: 120_000, rounding: 'floor', clamp: true }
    ),
    memoryTtlDays: normalizeInt(raw.memoryTtlDays, DEFAULT_FUN_CONFIG.memoryTtlDays, {
      min: 7,
      max: 365,
      rounding: 'floor',
      clamp: true,
    }),
    memoryMinScore: normalizeInt(raw.memoryMinScore, DEFAULT_FUN_CONFIG.memoryMinScore, {
      min: 0,
      max: 80,
      rounding: 'floor',
      clamp: true,
    }),
    memoryExtractMaxChars: normalizeInt(
      raw.memoryExtractMaxChars,
      DEFAULT_FUN_CONFIG.memoryExtractMaxChars,
      { min: 4_000, max: 40_000, rounding: 'floor', clamp: true }
    ),
    memoryKnownFactsInPrompt: normalizeInt(
      raw.memoryKnownFactsInPrompt,
      DEFAULT_FUN_CONFIG.memoryKnownFactsInPrompt,
      { min: 4, max: 40, rounding: 'floor', clamp: true }
    ),
    memoryMsgMaxChars: normalizeInt(
      raw.memoryMsgMaxChars,
      DEFAULT_FUN_CONFIG.memoryMsgMaxChars,
      { min: 80, max: 800, rounding: 'floor', clamp: true }
    ),
    profileEnabled: normalizeBoolean(raw.profileEnabled, DEFAULT_FUN_CONFIG.profileEnabled),
    profileNicknameMax: normalizeInt(
      raw.profileNicknameMax,
      DEFAULT_FUN_CONFIG.profileNicknameMax,
      { min: 4, max: 32, rounding: 'floor', clamp: true }
    ),
    profileBioMax: normalizeInt(raw.profileBioMax, DEFAULT_FUN_CONFIG.profileBioMax, {
      min: 40,
      max: 240,
      rounding: 'floor',
      clamp: true,
    }),
    profileTitleMax: normalizeInt(
      raw.profileTitleMax ?? raw.titleMaxLen,
      DEFAULT_FUN_CONFIG.profileTitleMax,
      { min: 4, max: 32, rounding: 'floor', clamp: true }
    ),
    profileExtrasMax: normalizeInt(raw.profileExtrasMax, DEFAULT_FUN_CONFIG.profileExtrasMax, {
      min: 40,
      max: 500,
      rounding: 'floor',
      clamp: true,
    }),
    profileBirthdayAnnounce: normalizeBoolean(
      raw.profileBirthdayAnnounce,
      DEFAULT_FUN_CONFIG.profileBirthdayAnnounce
    ),
    profileBirthdayTz: String(raw.profileBirthdayTz || DEFAULT_FUN_CONFIG.profileBirthdayTz || '')
      .trim()
      .slice(0, 64) || DEFAULT_FUN_CONFIG.profileBirthdayTz,
    profileBlocklist: Array.isArray(raw.profileBlocklist)
      ? raw.profileBlocklist.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80)
      : DEFAULT_FUN_CONFIG.profileBlocklist,
    profileAiExtract: normalizeBoolean(raw.profileAiExtract, DEFAULT_FUN_CONFIG.profileAiExtract),
    profileExtractTimeoutMs: normalizeInt(
      raw.profileExtractTimeoutMs,
      DEFAULT_FUN_CONFIG.profileExtractTimeoutMs,
      { min: 5_000, max: 90_000, rounding: 'floor', clamp: true }
    ),
    personaEnabled: normalizeBoolean(raw.personaEnabled, DEFAULT_FUN_CONFIG.personaEnabled),
    personaToolsEnabled: normalizeBoolean(raw.personaToolsEnabled, DEFAULT_FUN_CONFIG.personaToolsEnabled),
    personaToolCooldownMs: normalizeInt(
      raw.personaToolCooldownMs,
      DEFAULT_FUN_CONFIG.personaToolCooldownMs,
      { min: 5_000, max: 30 * 60_000, rounding: 'floor', clamp: true }
    ),
    loreReconciliationEnabled: normalizeBoolean(
      raw.loreReconciliationEnabled,
      DEFAULT_FUN_CONFIG.loreReconciliationEnabled
    ),
    loreReconciliationCooldownMs: normalizeInt(
      raw.loreReconciliationCooldownMs,
      DEFAULT_FUN_CONFIG.loreReconciliationCooldownMs,
      { min: 5_000, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    loreReconciliationMaxCandidates: normalizeInt(
      raw.loreReconciliationMaxCandidates,
      DEFAULT_FUN_CONFIG.loreReconciliationMaxCandidates,
      { min: 1, max: 100, rounding: 'floor', clamp: true }
    ),
    loreReconciliationTimeoutMs: normalizeInt(
      raw.loreReconciliationTimeoutMs,
      DEFAULT_FUN_CONFIG.loreReconciliationTimeoutMs,
      { min: 5_000, max: 90_000, rounding: 'floor', clamp: true }
    ),
    personaMemoryEnabled: normalizeBoolean(raw.personaMemoryEnabled, DEFAULT_FUN_CONFIG.personaMemoryEnabled),
    personaSocialHintsEnabled: normalizeBoolean(raw.personaSocialHintsEnabled, DEFAULT_FUN_CONFIG.personaSocialHintsEnabled),
    personaSocialHintsBatchSize: normalizeInt(raw.personaSocialHintsBatchSize, DEFAULT_FUN_CONFIG.personaSocialHintsBatchSize, {
      min: 8, max: 200, rounding: 'floor', clamp: true,
    }),
    personaSocialHintsFlushIntervalMs: normalizeInt(
      raw.personaSocialHintsFlushIntervalMs,
      DEFAULT_FUN_CONFIG.personaSocialHintsFlushIntervalMs,
      { min: 60_000, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    personaSocialHintsMinMessages: normalizeInt(raw.personaSocialHintsMinMessages, DEFAULT_FUN_CONFIG.personaSocialHintsMinMessages, {
      min: 3, max: 100, rounding: 'floor', clamp: true,
    }),
    personaSocialHintsMaxChars: normalizeInt(raw.personaSocialHintsMaxChars, DEFAULT_FUN_CONFIG.personaSocialHintsMaxChars, {
      min: 120, max: 2000, rounding: 'floor', clamp: true,
    }),
    personaSocialHintsMinConfidence: normalizeInt(
      raw.personaSocialHintsMinConfidence,
      DEFAULT_FUN_CONFIG.personaSocialHintsMinConfidence,
      { min: 0, max: 100, rounding: 'floor', clamp: true }
    ),
    personaTokenHalfLifeMs: normalizeInt(
      raw.personaTokenHalfLifeMs,
      DEFAULT_FUN_CONFIG.personaTokenHalfLifeMs,
      { min: 60 * 60_000, max: 365 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    personaTopTokens: normalizeInt(raw.personaTopTokens, DEFAULT_FUN_CONFIG.personaTopTokens, {
      min: 10, max: 120, rounding: 'floor', clamp: true,
    }),
    personaMemoryMaxContextItems: normalizeInt(raw.personaMemoryMaxContextItems, DEFAULT_FUN_CONFIG.personaMemoryMaxContextItems, {
      min: 1, max: 20, rounding: 'floor', clamp: true,
    }),
    personaCooldownMs: normalizeInt(
      raw.personaCooldownMs,
      DEFAULT_FUN_CONFIG.personaCooldownMs,
      { min: 0, max: 600_000, rounding: 'floor', clamp: true }
    ),
    // 0 = sem limite de turnos (chat infinito); valores positivos mantêm teto 2-4.
    personaMaxTurns: normalizeInt(raw.personaMaxTurns, DEFAULT_FUN_CONFIG.personaMaxTurns, {
      min: 0,
      max: 4,
      rounding: 'floor',
      clamp: true,
    }),
    personaThreadTtlMs: normalizeInt(
      raw.personaThreadTtlMs,
      DEFAULT_FUN_CONFIG.personaThreadTtlMs,
      { min: 60_000, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    personaWindowSize: normalizeInt(
      raw.personaWindowSize,
      DEFAULT_FUN_CONFIG.personaWindowSize,
      { min: 10, max: 500, rounding: 'floor', clamp: true }
    ),
    // Entradas de "Últimas trocas" no prompt da persona — 2 entries por troca (membro+bot).
    personaContextTurns: normalizeInt(
      raw.personaContextTurns,
      DEFAULT_FUN_CONFIG.personaContextTurns,
      { min: 4, max: 60, rounding: 'floor', clamp: true }
    ),
    personaWindowMs: normalizeInt(
      raw.personaWindowMs,
      DEFAULT_FUN_CONFIG.personaWindowMs,
      { min: 60 * 60_000, max: 7 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    personaTimeoutMs: normalizeInt(
      raw.personaTimeoutMs,
      DEFAULT_FUN_CONFIG.personaTimeoutMs,
      { min: 5_000, max: 15_000, rounding: 'floor', clamp: true }
    ),
    personaMaxChars: normalizeInt(raw.personaMaxChars, DEFAULT_FUN_CONFIG.personaMaxChars, {
      min: 80,
      max: 1_000,
      rounding: 'floor',
      clamp: true,
    }),
    chaosEventEnabled: normalizeBoolean(
      raw.chaosEventEnabled,
      DEFAULT_FUN_CONFIG.chaosEventEnabled
    ),
    chaosEventHour: normalizeInt(raw.chaosEventHour, DEFAULT_FUN_CONFIG.chaosEventHour, {
      min: 0,
      max: 23,
      rounding: 'floor',
      clamp: true,
    }),
    chaosEventMinute: normalizeInt(raw.chaosEventMinute, DEFAULT_FUN_CONFIG.chaosEventMinute, {
      min: 0,
      max: 59,
      rounding: 'floor',
      clamp: true,
    }),
    chaosEventWeekendHour: normalizeInt(raw.chaosEventWeekendHour, DEFAULT_FUN_CONFIG.chaosEventWeekendHour, {
      min: 0,
      max: 23,
      rounding: 'floor',
      clamp: true,
    }),
    chaosEventWeekendMinute: normalizeInt(raw.chaosEventWeekendMinute, DEFAULT_FUN_CONFIG.chaosEventWeekendMinute, {
      min: 0,
      max: 59,
      rounding: 'floor',
      clamp: true,
    }),
    chaosEventDurationMs: normalizeInt(
      raw.chaosEventDurationMs,
      DEFAULT_FUN_CONFIG.chaosEventDurationMs,
      { min: 60_000, max: 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    chaosEventNoWeaponSuccess: Number.isFinite(Number(raw.chaosEventNoWeaponSuccess))
      ? Math.min(0.75, Math.max(0.1, Number(raw.chaosEventNoWeaponSuccess)))
      : DEFAULT_FUN_CONFIG.chaosEventNoWeaponSuccess,
    chaosEventWeaponBaseChance: Number.isFinite(Number(raw.chaosEventWeaponBaseChance))
      ? Math.min(0.85, Math.max(0.1, Number(raw.chaosEventWeaponBaseChance)))
      : DEFAULT_FUN_CONFIG.chaosEventWeaponBaseChance,
    chaosEventMaxStealAmount: normalizeInt(
      raw.chaosEventMaxStealAmount,
      DEFAULT_FUN_CONFIG.chaosEventMaxStealAmount,
      { min: 1, max: 10_000_000, rounding: 'floor', clamp: true }
    ),
    chaosEventMaxDebt: normalizeInt(
      raw.chaosEventMaxDebt,
      DEFAULT_FUN_CONFIG.chaosEventMaxDebt,
      { min: 0, max: 1_000_000, rounding: 'floor', clamp: true }
    ),
    chaosEventDefenseEnabled: normalizeBoolean(
      raw.chaosEventDefenseEnabled,
      DEFAULT_FUN_CONFIG.chaosEventDefenseEnabled
    ),
    chaosEventDefenseTimeoutMs: normalizeInt(
      raw.chaosEventDefenseTimeoutMs,
      DEFAULT_FUN_CONFIG.chaosEventDefenseTimeoutMs,
      { min: 1000, max: 30_000, rounding: 'floor', clamp: true }
    ),
    chaosEventDefenseDeliveryGraceMs: normalizeInt(
      raw.chaosEventDefenseDeliveryGraceMs,
      DEFAULT_FUN_CONFIG.chaosEventDefenseDeliveryGraceMs,
      { min: 0, max: 120_000, rounding: 'floor', clamp: true }
    ),
    chaosEventAssaultCooldownMs: normalizeInt(
      raw.chaosEventAssaultCooldownMs,
      DEFAULT_FUN_CONFIG.chaosEventAssaultCooldownMs,
      { min: 0, max: 10 * 60_000, rounding: 'floor', clamp: true }
    ),
    chaosEventActivityWindowMs: normalizeInt(
      raw.chaosEventActivityWindowMs,
      DEFAULT_FUN_CONFIG.chaosEventActivityWindowMs,
      { min: 60_000, max: 60 * 60_000, rounding: 'floor', clamp: true }
    ),
    // TUI (painel full-screen de auditoria)
    tuiEnabled: normalizeBoolean(raw.tuiEnabled, DEFAULT_FUN_CONFIG.tuiEnabled),
    tuiRefreshMs: normalizeInt(raw.tuiRefreshMs, DEFAULT_FUN_CONFIG.tuiRefreshMs, {
      min: 200,
      max: 10_000,
      rounding: 'floor',
      clamp: true,
    }),
    tuiMaxHistory: normalizeInt(raw.tuiMaxHistory, DEFAULT_FUN_CONFIG.tuiMaxHistory, {
      min: 20,
      max: 2000,
      rounding: 'floor',
      clamp: true,
    }),
    // Filas de processamento
    commandMaxConcurrency: normalizeInt(
      raw.commandMaxConcurrency,
      DEFAULT_FUN_CONFIG.commandMaxConcurrency,
      { min: 1, max: 64, rounding: 'floor', clamp: true }
    ),
    commandFastConcurrency: normalizeInt(
      raw.commandFastConcurrency,
      DEFAULT_FUN_CONFIG.commandFastConcurrency,
      { min: 1, max: 32, rounding: 'floor', clamp: true }
    ),
    commandStateConcurrency: normalizeInt(
      raw.commandStateConcurrency,
      DEFAULT_FUN_CONFIG.commandStateConcurrency,
      { min: 1, max: 16, rounding: 'floor', clamp: true }
    ),
    commandHeavyConcurrency: normalizeInt(
      raw.commandHeavyConcurrency,
      DEFAULT_FUN_CONFIG.commandHeavyConcurrency,
      { min: 1, max: 8, rounding: 'floor', clamp: true }
    ),
    commandQueueMax: normalizeInt(
      raw.commandQueueMax,
      DEFAULT_FUN_CONFIG.commandQueueMax,
      { min: 100, max: 50000, rounding: 'floor', clamp: true }
    ),
    commandQueueWarnThreshold: normalizeInt(
      raw.commandQueueWarnThreshold,
      DEFAULT_FUN_CONFIG.commandQueueWarnThreshold,
      { min: 10, max: 50000, rounding: 'floor', clamp: true }
    ),
    outputConcurrency: normalizeInt(
      raw.outputConcurrency,
      DEFAULT_FUN_CONFIG.outputConcurrency,
      { min: 1, max: 32, rounding: 'floor', clamp: true }
    ),
    outputJidGapMs: normalizeInt(
      raw.outputJidGapMs,
      DEFAULT_FUN_CONFIG.outputJidGapMs,
      { min: 0, max: 10000, rounding: 'floor', clamp: true }
    ),
    outputCoalesceDelayMs: normalizeInt(
      raw.outputCoalesceDelayMs,
      DEFAULT_FUN_CONFIG.outputCoalesceDelayMs,
      { min: 0, max: 30000, rounding: 'floor', clamp: true }
    ),
    outputQueueMax: normalizeInt(
      raw.outputQueueMax,
      DEFAULT_FUN_CONFIG.outputQueueMax,
      { min: 100, max: 50000, rounding: 'floor', clamp: true }
    ),
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
    cardsEnabled: normalized.cardsEnabled,
    cardPackCost: normalized.cardPackCost,
    cardMaxPacksPerOpen: normalized.cardMaxPacksPerOpen,
    cardTradeTtlMs: normalized.cardTradeTtlMs,
    dashboardEnabled: normalized.dashboardEnabled,
    dashboardHost: normalized.dashboardHost,
    dashboardPort: normalized.dashboardPort,
    zenEnabled: normalized.zenEnabled,
    zenBaseUrl: normalized.zenBaseUrl,
    zenModel: normalized.zenModel,
    zenTimeoutMs: normalized.zenTimeoutMs,
    zenMaxTokens: normalized.zenMaxTokens,
    zenTemperature: normalized.zenTemperature,
    zenSendSamplingParams: normalized.zenSendSamplingParams,
    zenApiKey: normalized.zenApiKey,
    flavorTimeoutMs: normalized.flavorTimeoutMs,
    ollamaEnabled: normalized.ollamaEnabled,
    ollamaBaseUrl: normalized.ollamaBaseUrl,
    ollamaModel: normalized.ollamaModel,
    ollamaTimeoutMs: normalized.ollamaTimeoutMs,
    ollamaNumPredict: normalized.ollamaNumPredict,
    ollamaTemperature: normalized.ollamaTemperature,
    ollamaMaxChars: normalized.ollamaMaxChars,
    ollamaKeepAlive: normalized.ollamaKeepAlive,
    ollamaWarmupOnBoot: normalized.ollamaWarmupOnBoot,
    ollamaWarmupTimeoutMs: normalized.ollamaWarmupTimeoutMs,
    ollamaKeepAliveRefreshMs: normalized.ollamaKeepAliveRefreshMs,
    replyCommandsInPrivate: normalized.replyCommandsInPrivate,
    mentionUsers: normalized.mentionUsers,
    replyQuoted: normalized.replyQuoted,
    reactionsEnabled: normalized.reactionsEnabled,
    reactionProviderTimeoutMs: normalized.reactionProviderTimeoutMs,
    reactionAnimeProviderOrder: normalized.reactionAnimeProviderOrder,
    reactionUserAgent: normalized.reactionUserAgent,
    tenorApiKey: normalized.tenorApiKey,
    tenorClientKey: normalized.tenorClientKey,
    selfHealEnabled: normalized.selfHealEnabled,
    selfHealDryRun: normalized.selfHealDryRun,
    selfHealIntervalMs: normalized.selfHealIntervalMs,
    selfHealEvidenceRetentionDays: normalized.selfHealEvidenceRetentionDays,
    selfHealMaxItemsPerRun: normalized.selfHealMaxItemsPerRun,
    selfHealMaxCallsPerRun: normalized.selfHealMaxCallsPerRun,
    // TUI (painel full-screen de auditoria)
    tuiEnabled: normalized.tuiEnabled,
    tuiRefreshMs: normalized.tuiRefreshMs,
    tuiMaxHistory: normalized.tuiMaxHistory,
  };
  fs.writeFileSync(FUN_USER_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  return normalizeFunConfig(payload);
}
