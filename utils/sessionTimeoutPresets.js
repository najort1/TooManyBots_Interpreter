import { normalizeInt } from './normalization.js';

/**
 * Canonical timeout presets and their equivalent duration in minutes.
 */
export const SESSION_TIMEOUT_PRESET_MINUTES = Object.freeze({
  'quick-30m': 30,
  'business-8h': 8 * 60,
  'support-24h': 24 * 60,
});

const SESSION_TIMEOUT_PRESET_NAMES = new Set([
  ...Object.keys(SESSION_TIMEOUT_PRESET_MINUTES),
  'custom',
]);

/**
 * Normalizes the configured preset key.
 *
 * @param {unknown} value
 * @returns {'quick-30m' | 'business-8h' | 'support-24h' | 'custom'}
 */
export function normalizeSessionTimeoutPreset(value) {
  const normalized = String(value ?? 'custom').trim().toLowerCase();
  if (SESSION_TIMEOUT_PRESET_NAMES.has(normalized)) {
    return /** @type {'quick-30m' | 'business-8h' | 'support-24h' | 'custom'} */ (normalized);
  }
  return 'custom';
}

/**
 * Resolves the effective timeout settings from a sessionLimits object.
 * When preset != custom, sessionTimeoutMinutes is automatically overridden.
 *
 * @param {Record<string, unknown>} [sessionLimits={}]
 * @param {number} [fallbackMinutes=0]
 * @returns {{
 *   sessionTimeoutPreset: 'quick-30m' | 'business-8h' | 'support-24h' | 'custom',
 *   sessionTimeoutMinutes: number,
 *   usedPreset: boolean
 * }}
 */
export function resolveSessionTimeoutConfig(sessionLimits = {}, fallbackMinutes = 0) {
  const limits = sessionLimits && typeof sessionLimits === 'object' ? sessionLimits : {};
  const sessionTimeoutPreset = normalizeSessionTimeoutPreset(limits.sessionTimeoutPreset);

  const fallback = Math.max(0, Math.floor(Number(fallbackMinutes) || 0));
  const customMinutes = normalizeInt(limits.sessionTimeoutMinutes, fallback, {
    min: 0,
    rounding: 'floor',
  });

  if (sessionTimeoutPreset !== 'custom') {
    return {
      sessionTimeoutPreset,
      sessionTimeoutMinutes: SESSION_TIMEOUT_PRESET_MINUTES[sessionTimeoutPreset],
      usedPreset: true,
    };
  }

  return {
    sessionTimeoutPreset,
    sessionTimeoutMinutes: customMinutes,
    usedPreset: false,
  };
}
