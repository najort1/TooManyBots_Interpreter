import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  COMMAND_CATEGORIES,
  COMMAND_CATALOG,
  COMMAND_DISABLED_MESSAGE,
  checkCommandAccess,
  getAllCommandIds,
  getDefaultDisabledCommandIds,
} from '../fun/commands/catalog.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunNsfwVoteRepository } from '../fun/db/funNsfwVoteRepository.js';
import { routeFunCommand, parseFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS, FUN_COMMAND_ALIASES } from '../fun/constants.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

// ─── 1. Catálogo de Comandos ──────────────────────────────────────────────────

test('catalog: categorias e comandos registrados', () => {
  assert.ok(COMMAND_CATEGORIES.length >= 10, 'Deve conter pelo menos 10 categorias');
  assert.ok(COMMAND_CATALOG.length >= 40, 'Deve conter pelo menos 40 comandos mapeados');

  const allIds = getAllCommandIds();
  assert.ok(allIds.includes(FUN_COMMANDS.XP));
  assert.ok(allIds.includes(FUN_COMMANDS.FLIP));
  assert.ok(allIds.includes(FUN_COMMANDS.ROULETTE));
  assert.ok(allIds.includes(FUN_COMMANDS.NSFW_FORCE));
  assert.ok(allIds.includes('nsfw_reaction'));

  const defaultDisabled = getDefaultDisabledCommandIds();
  assert.ok(defaultDisabled.includes('nsfw_reaction'));
  assert.ok(defaultDisabled.includes(FUN_COMMANDS.NSFW_ENABLE));
  assert.ok(defaultDisabled.includes(FUN_COMMANDS.NSFW_FORCE));
  // Comandos normais NÃO devem vir desabilitados por padrão
  assert.ok(!defaultDisabled.includes(FUN_COMMANDS.XP));
  assert.ok(!defaultDisabled.includes(FUN_COMMANDS.FLIP));
});

test('catalog: aliases de force_nsfw registrados', () => {
  assert.equal(FUN_COMMAND_ALIASES.force_nsfw, FUN_COMMANDS.NSFW_FORCE);
  assert.equal(FUN_COMMAND_ALIASES.forcensfw, FUN_COMMANDS.NSFW_FORCE);
  assert.equal(FUN_COMMAND_ALIASES.nsfw_force, FUN_COMMANDS.NSFW_FORCE);

  const parsed1 = parseFunCommand('/force_nsfw');
  assert.equal(parsed1?.command, FUN_COMMANDS.NSFW_FORCE);

  const parsed2 = parseFunCommand('/forcensfw');
  assert.equal(parsed2?.command, FUN_COMMANDS.NSFW_FORCE);
});

test('catalog: checkCommandAccess para comandos padrão', () => {
  // Comando habilitado
  const res1 = checkCommandAccess({
    command: FUN_COMMANDS.FLIP,
    disabledCommands: [],
    permitirNsfw: false,
  });
  assert.equal(res1.disabled, false);

  // Comando explicitamente desabilitado
  const res2 = checkCommandAccess({
    command: FUN_COMMANDS.FLIP,
    disabledCommands: [FUN_COMMANDS.FLIP],
    permitirNsfw: false,
  });
  assert.equal(res2.disabled, true);
  assert.equal(res2.reason, 'dashboard-disabled');

  // Reação SFW
  const res3 = checkCommandAccess({
    command: FUN_COMMANDS.REACTION,
    action: 'kiss',
    isNsfwAction: false,
    disabledCommands: [],
    permitirNsfw: false,
  });
  assert.equal(res3.disabled, false);

  // Reação NSFW sem force_nsfw
  const res4 = checkCommandAccess({
    command: FUN_COMMANDS.REACTION,
    action: 'blowjob',
    isNsfwAction: true,
    disabledCommands: [],
    permitirNsfw: false,
  });
  assert.equal(res4.disabled, true);
  assert.equal(res4.reason, 'nsfw-not-forced');

  // Reação NSFW com force_nsfw ativo
  const res5 = checkCommandAccess({
    command: FUN_COMMANDS.REACTION,
    action: 'blowjob',
    isNsfwAction: true,
    disabledCommands: [],
    permitirNsfw: true,
  });
  assert.equal(res5.disabled, false);

  // Reação NSFW desabilitada no dashboard (mesmo se permitirNsfw for true)
  const res6 = checkCommandAccess({
    command: FUN_COMMANDS.REACTION,
    action: 'blowjob',
    isNsfwAction: true,
    disabledCommands: ['nsfw_reaction'],
    permitirNsfw: true,
  });
  assert.equal(res6.disabled, true);
  assert.equal(res6.reason, 'dashboard-disabled');

  // Comando NSFW desabilitado no dashboard
  const res7 = checkCommandAccess({
    command: FUN_COMMANDS.NSFW_FORCE,
    disabledCommands: [FUN_COMMANDS.NSFW_FORCE],
    permitirNsfw: false,
  });
  assert.equal(res7.disabled, true);
  assert.equal(res7.reason, 'dashboard-disabled');
});

// ─── 2. Persistência no Repositório de Grupos ────────────────────────────────

test('groupRepository: persiste e resolve disabledCommands', () => {
  const groupRepo = createFunGroupRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();

  // Sem override: resolve defaults
  const def = groupRepo.resolveEffectiveRates(groupJid);
  assert.deepEqual(def.disabledCommands, []);
  assert.equal(def.permitirNsfw, false);

  // Salva lista de comandos desabilitados
  const saved = groupRepo.upsertGroupSettings({
    groupJid,
    disabledCommands: ['flip', 'roulette', 'nsfw_reaction'],
    permitirNsfw: true,
  });

  assert.deepEqual(saved.disabledCommands, ['flip', 'roulette', 'nsfw_reaction']);
  assert.equal(saved.permitirNsfw, true);

  // Leitura direta
  const loaded = groupRepo.getGroupSettings(groupJid);
  assert.deepEqual(loaded.disabledCommands, ['flip', 'roulette', 'nsfw_reaction']);
  assert.equal(loaded.permitirNsfw, true);

  // Efetivo
  const eff = groupRepo.resolveEffectiveRates(groupJid);
  assert.deepEqual(eff.disabledCommands, ['flip', 'roulette', 'nsfw_reaction']);
  assert.equal(eff.permitirNsfw, true);
});

// ─── 3. Interceptação e Enforcement no Router ────────────────────────────────

test('router: comando desabilitado responde mensagem genérica', async () => {
  const groupJid = uniqueGroup();
  const replies = [];
  const fakeReply = async (msg) => {
    replies.push(String(msg || ''));
  };

  const ctx = {
    text: '/flip cara 10',
    chatJid: groupJid,
    scopeKey: groupJid,
    userJid: '5511999990001@s.whatsapp.net',
    isGroup: true,
    funConfig: { prefix: '/' },
    effectiveRates: {
      enabled: true,
      disabledCommands: ['flip'],
      permitirNsfw: false,
    },
    reply: fakeReply,
  };

  const res = await routeFunCommand(ctx);
  assert.equal(res.handled, true);
  assert.equal(res.reason, 'dashboard-disabled');
  assert.equal(replies.length, 1);
  assert.equal(replies[0], COMMAND_DISABLED_MESSAGE);
  assert.equal(COMMAND_DISABLED_MESSAGE, 'este comando não foi habilitado para este grupo');
});

test('router: comando habilitado executa normalmente', async () => {
  const groupJid = uniqueGroup();
  let executedHandler = false;
  const fakeReply = async () => {};

  const ctx = {
    text: '/xp',
    chatJid: groupJid,
    scopeKey: groupJid,
    userJid: '5511999990002@s.whatsapp.net',
    isGroup: true,
    funConfig: { prefix: '/' },
    effectiveRates: {
      enabled: true,
      disabledCommands: ['flip'], // xp está habilitado
      permitirNsfw: false,
    },
    reply: fakeReply,
    rankService: {
      getProfile: async () => ({
        xp: 100,
        level: 2,
        coins: 50,
        nextLevelXp: 200,
        progressPct: 50,
      }),
    },
    getContactDisplayName: () => 'Jogador',
  };

  const res = await routeFunCommand(ctx);
  assert.equal(res.handled, true);
  assert.notEqual(res.reason, 'dashboard-disabled');
});

test('router: reação NSFW desabilitada no dashboard responde mensagem genérica', async () => {
  const groupJid = uniqueGroup();
  const replies = [];
  const fakeReply = async (msg) => {
    replies.push(String(msg || ''));
  };

  const ctx = {
    text: '/blowjob @5511999990003',
    chatJid: groupJid,
    scopeKey: groupJid,
    userJid: '5511999990004@s.whatsapp.net',
    isGroup: true,
    funConfig: { prefix: '/' },
    effectiveRates: {
      enabled: true,
      disabledCommands: ['nsfw_reaction'], // desabilitado no dashboard
      permitirNsfw: true,
    },
    reply: fakeReply,
  };

  const res = await routeFunCommand(ctx);
  assert.equal(res.handled, true);
  assert.equal(res.reason, 'dashboard-disabled');
  assert.equal(replies.length, 1);
  assert.equal(replies[0], COMMAND_DISABLED_MESSAGE);
});

test('router: reação NSFW habilitada no dashboard mas sem force_nsfw orienta comando', async () => {
  const groupJid = uniqueGroup();
  const replies = [];
  const fakeReply = async (msg) => {
    replies.push(String(msg || ''));
  };

  const ctx = {
    text: '/blowjob @5511999990003',
    chatJid: groupJid,
    scopeKey: groupJid,
    userJid: '5511999990004@s.whatsapp.net',
    isGroup: true,
    funConfig: { prefix: '/' },
    effectiveRates: {
      enabled: true,
      disabledCommands: [], // não está desabilitado no dashboard
      permitirNsfw: false,  // mas não foi forçado no grupo
    },
    reply: fakeReply,
  };

  const res = await routeFunCommand(ctx);
  assert.equal(res.handled, true);
  assert.equal(res.reason, 'nsfw-not-forced');
  assert.equal(replies.length, 1);
  assert.ok(replies[0].includes('/force_nsfw'));
});

test('router: comando /force_nsfw ativa e desativa NSFW no grupo', async () => {
  const nsfwVoteRepo = createFunNsfwVoteRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();
  const replies = [];
  const fakeReply = async (msg) => {
    replies.push(String(msg || ''));
  };

  assert.equal(nsfwVoteRepo.getPermitirNsfw(groupJid), false);

  const ctx = {
    text: '/force_nsfw',
    chatJid: groupJid,
    scopeKey: groupJid,
    userJid: '5511999990005@s.whatsapp.net',
    isGroup: true,
    funConfig: { prefix: '/' },
    effectiveRates: {
      enabled: true,
      disabledCommands: [],
      permitirNsfw: false,
    },
    reply: fakeReply,
    nsfwVoteRepository: nsfwVoteRepo,
  };

  // Primeira execução: ativa
  const res1 = await routeFunCommand(ctx);
  assert.equal(res1.handled, true);
  assert.equal(nsfwVoteRepo.getPermitirNsfw(groupJid), true);
  assert.ok(replies[0].includes('ativado'));

  // Segunda execução: desativa
  const res2 = await routeFunCommand(ctx);
  assert.equal(res2.handled, true);
  assert.equal(nsfwVoteRepo.getPermitirNsfw(groupJid), false);
  assert.ok(replies[1].includes('desativado'));
});
