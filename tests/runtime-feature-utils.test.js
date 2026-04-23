import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSlidingPeriodWindow, getSlidingPeriodStartTs } from '../utils/slidingPeriod.js';
import { resolveSessionTimeoutConfig } from '../utils/sessionTimeoutPresets.js';
import { evaluateAvailability, getBrazilNationalHolidaysByYear } from '../utils/availability.js';

test('session timeout preset overrides custom minutes when preset is not custom', () => {
  const presetConfig = resolveSessionTimeoutConfig({
    sessionTimeoutPreset: 'quick-30m',
    sessionTimeoutMinutes: 999,
  });
  assert.equal(presetConfig.sessionTimeoutMinutes, 30);
  assert.equal(presetConfig.usedPreset, true);

  const customConfig = resolveSessionTimeoutConfig({
    sessionTimeoutPreset: 'custom',
    sessionTimeoutMinutes: 45,
  });
  assert.equal(customConfig.sessionTimeoutMinutes, 45);
  assert.equal(customConfig.usedPreset, false);
});

test('sliding window utility returns valid ranges for day/week/month', () => {
  const nowTs = Date.parse('2026-04-23T12:00:00.000Z');
  const dayWindow = buildSlidingPeriodWindow('day', nowTs);
  const weekWindow = buildSlidingPeriodWindow('week', nowTs);
  const monthStart = getSlidingPeriodStartTs('month', nowTs);

  assert.equal(dayWindow.endTs, nowTs);
  assert.equal(dayWindow.startTs, nowTs - (24 * 60 * 60 * 1000));
  assert.equal(weekWindow.startTs, nowTs - (7 * 24 * 60 * 60 * 1000));
  assert.ok(monthStart < nowTs);
});

test('availability blocks Brazilian national holidays when enabled', () => {
  const holidays = getBrazilNationalHolidaysByYear(2026);
  assert.equal(holidays.has('2026-12-25'), true);

  const decision = evaluateAvailability({
    restrictBySchedule: true,
    allowedDays: ['friday'],
    timeRangeStart: '08:00',
    timeRangeEnd: '18:00',
    includeBrazilNationalHolidays: true,
    timezone: 'America/Sao_Paulo',
  }, {
    nowTs: Date.parse('2026-12-25T15:00:00.000Z'),
  });

  assert.equal(decision.available, false);
  assert.equal(decision.reason, 'holiday');
});

test('availability supports overnight time ranges with timezone-aware clock', () => {
  const allowed = evaluateAvailability({
    restrictBySchedule: true,
    allowedDays: ['thursday'],
    timeRangeStart: '22:00',
    timeRangeEnd: '06:00',
    includeBrazilNationalHolidays: false,
    timezone: 'UTC',
  }, {
    nowTs: Date.parse('2026-04-23T23:30:00.000Z'),
  });

  const blocked = evaluateAvailability({
    restrictBySchedule: true,
    allowedDays: ['thursday'],
    timeRangeStart: '22:00',
    timeRangeEnd: '06:00',
    includeBrazilNationalHolidays: false,
    timezone: 'UTC',
  }, {
    nowTs: Date.parse('2026-04-23T12:30:00.000Z'),
  });

  assert.equal(allowed.available, true);
  assert.equal(blocked.available, false);
  assert.equal(blocked.reason, 'time');
});
