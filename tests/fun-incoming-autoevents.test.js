/**
 * Eventos surpresa no path de mensagem — respeitam flags granulares do grupo
 * (happyHourAutoEnabled / marketAutoEnabled). Regressão: happy hour disparava
 * via onIncomingMessage mesmo com a flag desligada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, resolveFunConfig } from '../fun/index.js';
import { _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  const rnd = Math.floor(Math.random() * 90000) + 10000;
  return `120363${Date.now()}${rnd}@g.us`;
}

/**
 * Roda uma mensagem de usuário no grupo e retorna o que o bot enviou.
 * eventTickChance=0 → happy hour só pode vir do path de mensagem (não do tick).
 */
async function sendUserMessage({ mod, group, user }) {
  const sent = [];
  await mod.onIncomingMessage({
    sock: {},
    chatJid: group,
    actorJid: user,
    isGroup: true,
    text: 'oi',
    messageType: 'text',
  });
  return sent;
}

test('onIncomingMessage: happyHourAutoEnabled=false bloqueia happy hour no path de msg', async () => {
  const scope = uniqueGroup();
  const user = `5511999888${String(Date.now()).slice(-6)}@s.whatsapp.net`;
  const sent = [];

  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        requireGroupWhitelist: true,
        groupWhitelistJids: [scope],
        marketEnabled: true,
        eventAutoSpawn: true,
        eventAutoSpawnChance: 1,
        eventTickChance: 0,
        eventCooldownMs: 0,
        worldQuietHoursEnabled: false,
        qmpEnabled: false,
      }),
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, _jid, text) => sent.push(String(text)),
  });
  mod.init();

  // mundo ligado, mas happy hour desativado → exatamente o cenário real do grupo
  mod._services.groupRepository.upsertGroupSettings({
    groupJid: scope,
    worldEventsEnabled: true,
    marketAutoEnabled: false,
    happyHourAutoEnabled: false,
  });

  // pré-condição: eventService disponível e sorteio forçado passaria
  assert.ok(mod._services.eventService?.tryAutoSpawn, 'eventService presente');

  // 1ª mensagem: sem cooldown prévio, chance 1 → sem o gate, happy hour dispararia
  await mod.onIncomingMessage({
    sock: {},
    chatJid: scope,
    actorJid: user,
    isGroup: true,
    text: 'oi',
    messageType: 'text',
  });

  assert.ok(
    !sent.some((t) => /HAPPY HOUR/i.test(String(t))),
    `happy hour NÃO deve disparar com happyHourAutoEnabled=false; sent: ${JSON.stringify(sent)}`
  );
});

test('onIncomingMessage: happyHourAutoEnabled=true mantém happy hour no path de msg', async () => {
  const scope = uniqueGroup();
  const user = `5511999777${String(Date.now()).slice(-6)}@s.whatsapp.net`;
  const sent = [];

  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        requireGroupWhitelist: true,
        groupWhitelistJids: [scope],
        eventAutoSpawn: true,
        eventAutoSpawnChance: 1,
        eventTickChance: 0,
        eventCooldownMs: 0,
        worldQuietHoursEnabled: false,
        qmpEnabled: false,
      }),
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, _jid, text) => sent.push(String(text)),
  });
  mod.init();

  // happy hour ligado explicitamente
  mod._services.groupRepository.upsertGroupSettings({
    groupJid: scope,
    worldEventsEnabled: true,
    happyHourAutoEnabled: true,
  });

  await mod.onIncomingMessage({
    sock: {},
    chatJid: scope,
    actorJid: user,
    isGroup: true,
    text: 'oi',
    messageType: 'text',
  });

  assert.ok(
    sent.some((t) => /HAPPY HOUR/i.test(String(t))),
    `happy hour deve disparar com happyHourAutoEnabled=true; sent: ${JSON.stringify(sent)}`
  );
});