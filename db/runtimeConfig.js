import { normalizeBoolean, normalizeInt } from '../utils/normalization.js';

const DEFAULT_DB_RUNTIME_CONFIG = {
  splitDatabases: true,
  eventBatchingEnabled: true,
  eventBatchFlushMs: 1000,
  eventBatchSize: 200,
  retentionDays: 30,
  retentionArchiveEnabled: true,
  maintenanceEnabled: true,
  maintenanceIntervalMinutes: 30,
  maintenanceCheckpointMode: 'TRUNCATE',
  maintenanceAnalyzeIntervalHours: 24,
  maintenanceVacuumIntervalHours: 168,
  maintenanceIntegrityCheckIntervalHours: 24,
  pragmaBusyTimeoutMs: 5000,
  pragmaWalAutoCheckpointPages: 1000,
  pragmaTempStoreMemory: true,
  pragmaCacheSizeKb: 65536,
  pragmaMmapSizeMb: 256,
  pragmaRuntimeSynchronous: 'NORMAL',
  pragmaAnalyticsSynchronous: 'NORMAL',
  maxVariablesBytesWarn: 524288,
};

const DEFAULT_DB_MAINTENANCE_STATE = {
  inProgress: false,
  lastRunAt: 0,
  lastRunReason: '',
  lastDurationMs: 0,
  lastStatus: 'never',
  lastError: '',
  lastSummary: null,
  lastRetentionAt: 0,
  lastAnalyzeAt: 0,
  lastVacuumAt: 0,
  lastIntegrityCheckAt: 0,
};

function normalizeSynchronous(value, fallback = 'NORMAL') {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  if (normalized === 'OFF' || normalized === 'NORMAL' || normalized === 'FULL' || normalized === 'EXTRA') {
    return normalized;
  }
  return fallback;
}

function normalizeCheckpointMode(value, fallback = 'TRUNCATE') {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  if (normalized === 'PASSIVE' || normalized === 'FULL' || normalized === 'RESTART' || normalized === 'TRUNCATE') {
    return normalized;
  }
  return fallback;
}

export function createDbRuntimeState() {
  return {
    config: { ...DEFAULT_DB_RUNTIME_CONFIG },
    maintenance: { ...DEFAULT_DB_MAINTENANCE_STATE },
  };
}

export function normalizeDbRuntimeConfig(input = {}, baseConfig = DEFAULT_DB_RUNTIME_CONFIG) {
  const base = baseConfig && typeof baseConfig === 'object'
    ? { ...DEFAULT_DB_RUNTIME_CONFIG, ...baseConfig }
    : { ...DEFAULT_DB_RUNTIME_CONFIG };
  const cfg = { ...base, ...(input && typeof input === 'object' ? input : {}) };

  return {
    splitDatabases: normalizeBoolean(cfg.splitDatabases, true),
    eventBatchingEnabled: normalizeBoolean(cfg.eventBatchingEnabled, true),
    eventBatchFlushMs: normalizeInt(cfg.eventBatchFlushMs, base.eventBatchFlushMs, { min: 100, max: 60000 }),
    eventBatchSize: normalizeInt(cfg.eventBatchSize, base.eventBatchSize, { min: 10, max: 5000 }),
    retentionDays: normalizeInt(cfg.retentionDays, base.retentionDays, { min: 1, max: 3650 }),
    retentionArchiveEnabled: normalizeBoolean(cfg.retentionArchiveEnabled, true),
    maintenanceEnabled: normalizeBoolean(cfg.maintenanceEnabled, true),
    maintenanceIntervalMinutes: normalizeInt(cfg.maintenanceIntervalMinutes, base.maintenanceIntervalMinutes, { min: 5, max: 1440 }),
    maintenanceCheckpointMode: normalizeCheckpointMode(cfg.maintenanceCheckpointMode, base.maintenanceCheckpointMode),
    maintenanceAnalyzeIntervalHours: normalizeInt(cfg.maintenanceAnalyzeIntervalHours, base.maintenanceAnalyzeIntervalHours, { min: 1, max: 720 }),
    maintenanceVacuumIntervalHours: normalizeInt(cfg.maintenanceVacuumIntervalHours, base.maintenanceVacuumIntervalHours, { min: 6, max: 2160 }),
    maintenanceIntegrityCheckIntervalHours: normalizeInt(cfg.maintenanceIntegrityCheckIntervalHours, base.maintenanceIntegrityCheckIntervalHours, { min: 1, max: 720 }),
    pragmaBusyTimeoutMs: normalizeInt(cfg.pragmaBusyTimeoutMs, base.pragmaBusyTimeoutMs, { min: 0, max: 120000 }),
    pragmaWalAutoCheckpointPages: normalizeInt(cfg.pragmaWalAutoCheckpointPages, base.pragmaWalAutoCheckpointPages, { min: 100, max: 200000 }),
    pragmaTempStoreMemory: normalizeBoolean(cfg.pragmaTempStoreMemory, true),
    pragmaCacheSizeKb: normalizeInt(cfg.pragmaCacheSizeKb, base.pragmaCacheSizeKb, { min: 4096, max: 1048576 }),
    pragmaMmapSizeMb: normalizeInt(cfg.pragmaMmapSizeMb, base.pragmaMmapSizeMb, { min: 0, max: 4096 }),
    pragmaRuntimeSynchronous: normalizeSynchronous(cfg.pragmaRuntimeSynchronous, base.pragmaRuntimeSynchronous),
    pragmaAnalyticsSynchronous: normalizeSynchronous(cfg.pragmaAnalyticsSynchronous, base.pragmaAnalyticsSynchronous),
    maxVariablesBytesWarn: normalizeInt(cfg.maxVariablesBytesWarn, base.maxVariablesBytesWarn, { min: 65536, max: 10485760 }),
  };
}
