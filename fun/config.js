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
      max: 120_000,
      rounding: 'floor',
      clamp: true,
    }),
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
    zenApiKey: toText(raw.zenApiKey, DEFAULT_FUN_CONFIG.zenApiKey) || '',
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
      min: 5 * 60_000,
      max: 24 * 60 * 60_000,
      rounding: 'floor',
      clamp: true,
    }),
    marketEventMaxMs: normalizeInt(raw.marketEventMaxMs, DEFAULT_FUN_CONFIG.marketEventMaxMs, {
      min: 10 * 60_000,
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
    happyHourDurationMs: normalizeInt(raw.happyHourDurationMs, DEFAULT_FUN_CONFIG.happyHourDurationMs, { min: 60_000, max: 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
    happyHourPayoutMult: Number.isFinite(Number(raw.happyHourPayoutMult))
      ? Math.min(2, Math.max(1, Number(raw.happyHourPayoutMult)))
      : DEFAULT_FUN_CONFIG.happyHourPayoutMult,
    happyHourCooldownMs: normalizeInt(raw.happyHourCooldownMs, DEFAULT_FUN_CONFIG.happyHourCooldownMs, { min: 0, max: 7 * 24 * 60 * 60_000, rounding: 'floor', clamp: true }),
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
    zenEnabled: normalized.zenEnabled,
    zenBaseUrl: normalized.zenBaseUrl,
    zenModel: normalized.zenModel,
    zenTimeoutMs: normalized.zenTimeoutMs,
    zenMaxTokens: normalized.zenMaxTokens,
    zenTemperature: normalized.zenTemperature,
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
  };
  fs.writeFileSync(FUN_USER_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  return normalizeFunConfig(payload);
}
