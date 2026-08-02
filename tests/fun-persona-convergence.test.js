import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUN_DISABLE_LIVE_LLM = '1';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('perfil: pode ser persistido automaticamente e reutilizado após reinício', () => {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const svc = createPersonaService({ personaRepository, groupRepository, getLogger: () => null });
  const cfg = { personaEnabled: true, personaWindowSize: 100, personaWindowMs: 24 * 60 * 60 * 1000 };
  const scope = uniqueGroup();

  for (let i = 0; i < 6; i++) {
    svc.observeMessage({
      scopeKey: scope,
      userJid: uniqueJid(),
      text: `giria${i} kkk 🔥`,
      messageType: 'text',
      funConfig: cfg,
      now: Date.now() + i,
    });
  }

  const result = svc.deriveAndPersistProfile(scope, cfg);
  assert.equal(result.ok, true);

  const svc2 = createPersonaService({ personaRepository, groupRepository, getLogger: () => null });
  const style = svc2.buildStyleBlock(scope, cfg);
  assert.ok(style.includes('Vocabulário frequente'));
});
