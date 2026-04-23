import { normalizeBoolean } from './normalization.js';

const VARIABLE_PERSISTENCE_POLICIES = new Set(['never', '7-days', 'indefinitely']);

/**
 * Normalizes persistence policy labels.
 *
 * @param {unknown} value
 * @returns {'never' | '7-days' | 'indefinitely'}
 */
export function normalizeVariablePersistence(value) {
  const normalized = String(value ?? 'never').trim().toLowerCase();
  if (VARIABLE_PERSISTENCE_POLICIES.has(normalized)) {
    return /** @type {'never' | '7-days' | 'indefinitely'} */ (normalized);
  }
  return 'never';
}

/**
 * Sanitizes global variable names configured for cross-session memory.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeGlobalVariableList(value) {
  if (!Array.isArray(value)) return [];
  const dedup = new Set();
  const result = [];
  for (const item of value) {
    const normalized = String(item ?? '').trim();
    if (!normalized || dedup.has(normalized)) continue;
    dedup.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * Returns the canonical context-persistence configuration.
 *
 * @param {Record<string, unknown>} [rawConfig={}]
 * @returns {{
 *   variablePersistence: 'never' | '7-days' | 'indefinitely',
 *   globalVariables: string[],
 *   memoryModeEnabled: boolean
 * }}
 */
export function normalizeContextPersistenceConfig(rawConfig = {}) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    variablePersistence: normalizeVariablePersistence(config.variablePersistence),
    globalVariables: normalizeGlobalVariableList(config.globalVariables),
    memoryModeEnabled: normalizeBoolean(config.memoryModeEnabled, false),
  };
}

/**
 * Computes the expiration timestamp for persisted variables.
 * - `null` means no expiration (indefinite)
 * - `undefined` means "do not persist"
 *
 * @param {'never' | '7-days' | 'indefinitely' | string} policy
 * @param {number} [nowTs=Date.now()]
 * @returns {number | null | undefined}
 */
export function getContextPersistenceExpiryTs(policy, nowTs = Date.now()) {
  const normalizedPolicy = normalizeVariablePersistence(policy);
  const baseTs = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();

  if (normalizedPolicy === 'never') {
    return undefined;
  }

  if (normalizedPolicy === '7-days') {
    return baseTs + (7 * 24 * 60 * 60 * 1000);
  }

  return null;
}
