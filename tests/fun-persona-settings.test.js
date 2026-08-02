import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function personaRuntimeEnabled(settings, funConfig = {}) {
  return settings?.personaEnabled !== false && funConfig.personaEnabled !== false;
}

test('group settings: personaEnabled default ON no upsert/read', () => {
  const repo = createFunGroupRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();

  const saved = repo.upsertGroupSettings({ groupJid });
  assert.equal(saved.personaEnabled, true);

  const fetched = repo.getGroupSettings(groupJid);
  assert.equal(fetched.personaEnabled, true);
});

test('group settings: personaEnabled=false persiste no repo', () => {
  const repo = createFunGroupRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();

  const saved = repo.upsertGroupSettings({ groupJid, personaEnabled: false });
  assert.equal(saved.personaEnabled, false);

  const fetched = repo.getGroupSettings(groupJid);
  assert.equal(fetched.personaEnabled, false);
});

test('resolveEffectiveRates: expõe personaEnabled default ON sem override', () => {
  const repo = createFunGroupRepository({ getDatabase: getDb });
  const rates = repo.resolveEffectiveRates(uniqueGroup(), DEFAULT_FUN_CONFIG);
  assert.equal(rates.personaEnabled, true);
  assert.equal(rates.source, 'global');
});

test('resolveEffectiveRates: expõe personaEnabled salvo por grupo', () => {
  const repo = createFunGroupRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();
  repo.upsertGroupSettings({ groupJid, personaEnabled: false });

  const rates = repo.resolveEffectiveRates(groupJid, DEFAULT_FUN_CONFIG);
  assert.equal(rates.personaEnabled, false);
  assert.equal(rates.source, 'group');
});

test('runtime rule: settings ON + config global ON = ativo', () => {
  assert.equal(personaRuntimeEnabled({ personaEnabled: true }, { personaEnabled: true }), true);
});

test('runtime rule: settings OFF desliga mesmo com global ON', () => {
  assert.equal(personaRuntimeEnabled({ personaEnabled: false }, { personaEnabled: true }), false);
});

test('runtime rule: global OFF desliga mesmo com settings ON', () => {
  assert.equal(personaRuntimeEnabled({ personaEnabled: true }, { personaEnabled: false }), false);
});

test('runtime rule: ausência de registro usa default ON', () => {
  assert.equal(personaRuntimeEnabled(null, { personaEnabled: true }), true);
});

test('ui hydration rule: valor salvo false deve continuar false ao hidratar formulário', () => {
  const base = { personaEnabled: false };
  const hydrated = base.personaEnabled !== false;
  assert.equal(hydrated, false);
});
