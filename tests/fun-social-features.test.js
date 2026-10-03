import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunRelationshipRepository } from '../fun/db/funRelationshipRepository.js';
import { createFunActionRepository } from '../fun/db/funActionRepository.js';
import { createFunBondRepository } from '../fun/db/funBondRepository.js';
import { createBondService } from '../fun/services/bondService.js';
import { createRelationshipService } from '../fun/services/relationshipService.js';
import { handleReactionCommand } from '../fun/commands/handlers/reaction.js';
import { handleShipCommand } from '../fun/commands/handlers/ship.js';
import { handleRelacaoCommand } from '../fun/commands/handlers/relacao.js';
import { handleDivorceCommand } from '../fun/commands/handlers/marry.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

let counter = 1000;
function uniqueJid() {
  counter += 1;
  return `551199${String(Date.now()).slice(-6)}${String(counter).padStart(4, '0')}@s.whatsapp.net`;
}

test('handleReactionCommand: registra ação no bondService e aciona socialHooks.onSocialPair', async () => {
  const bondRepo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: bondRepo });

  const scopeKey = uniqueGroup();
  const a = uniqueJid();
  const b = uniqueJid();

  const hooked = [];
  const socialHooks = {
    onSocialPair: (data) => {
      hooked.push(data);
    },
  };

  const replied = [];
  const reply = async (msg) => { replied.push(msg); };

  const mediaService = {
    getReaction: async () => ({ ok: true, url: 'https://media.example/kiss.gif', provider: 'test' }),
  };

  const res = await handleReactionCommand({
    text: `/kiss @${b.split('@')[0]}`,
    args: [`@${b.split('@')[0]}`],
    userJid: a,
    scopeKey,
    reply,
    replyImageUrl: async (url, caption) => { replied.push({ url, caption }); },
    mentionedJids: [b],
    reactionMediaService: mediaService,
    bondService,
    socialHooks,
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });

  assert.equal(res.handled, true);
  assert.equal(hooked.length, 1);
  assert.equal(hooked[0].fromJid, a);
  assert.equal(hooked[0].toJid, b);
  assert.equal(hooked[0].kind, 'kiss');

  // Verifica que o vínculo foi atualizado
  const bond = bondRepo.getBond(scopeKey, a, b);
  assert.ok(bond.affection > 0);
  assert.ok(bond.intimacy > 0);
  assert.equal(bond.interactionsCount, 1);
});

test('handleReactionCommand: detecta contra-tapa em janela de revide de 45s', async () => {
  const bondRepo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: bondRepo });

  const scopeKey = uniqueGroup();
  const a = uniqueJid();
  const b = uniqueJid();

  const mediaService = {
    getReaction: async () => ({ ok: true, url: 'https://media.example/slap.gif', provider: 'test' }),
  };

  const replies = [];
  const captureReply = async (url, caption) => { replies.push(caption); };

  // 1. A dá um tapa em B
  await handleReactionCommand({
    text: `/slap @${b.split('@')[0]}`,
    args: [`@${b.split('@')[0]}`],
    userJid: a,
    scopeKey,
    replyImageUrl: captureReply,
    mentionedJids: [b],
    reactionMediaService: mediaService,
    bondService,
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });

  // 2. B revida com outro /slap em A dentro dos 45s
  await handleReactionCommand({
    text: `/slap @${a.split('@')[0]}`,
    args: [`@${a.split('@')[0]}`],
    userJid: b,
    scopeKey,
    replyImageUrl: captureReply,
    mentionedJids: [a],
    reactionMediaService: mediaService,
    bondService,
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });

  assert.equal(replies.length, 2);
  assert.match(replies[1], /revidou/i, 'Segunda mensagem deve indicar revide de bofetada');
});

test('handleShipCommand: calcula ship dinâmico a partir do histórico e laços 4D reais', async () => {
  const bondRepo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: bondRepo });

  const scopeKey = uniqueGroup();
  const a = uniqueJid();
  const b = uniqueJid();

  // Inicialmente sem histórico: deve retornar potencial neutro
  const messagesInitial = [];
  await handleShipCommand({
    userJid: a,
    scopeKey,
    relationshipService: { ship: () => ({ ok: true, percent: 50 }) },
    bondService,
    args: [`@${b.split('@')[0]}`],
    mentionedJids: [b],
    reply: async (msg) => { messagesInitial.push(msg); },
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });
  assert.match(messagesInitial[0], /folha em branco|incógnita/i);

  // Agora acumula histórico de afeto intenso entre A e B nos últimos dias
  const now = Date.now();
  const baseT = now - 5 * 24 * 60 * 60 * 1000;
  for (let i = 0; i <= 5; i++) {
    const dayMs = baseT + i * 24 * 60 * 60 * 1000;
    bondService.recordAction({ scopeKey, actorJid: a, targetJid: b, action: 'kiss', now: dayMs });
    bondService.recordAction({ scopeKey, actorJid: b, targetJid: a, action: 'cuddle', now: dayMs + 1000 });
  }

  const messagesTrained = [];
  await handleShipCommand({
    userJid: a,
    scopeKey,
    relationshipService: { ship: () => ({ ok: true, percent: 50 }) },
    bondService,
    args: [`@${b.split('@')[0]}`],
    mentionedJids: [b],
    reply: async (msg) => { messagesTrained.push(msg); },
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });

  assert.ok(messagesTrained.length > 0);
  assert.match(messagesTrained[0], /Chamego Doce|Inseparáveis|Sintonia/i);
});

test('handleRelacaoCommand: exibe status do vínculo 4D com barras visuais e arquétipo', async () => {
  const bondRepo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: bondRepo });

  const scopeKey = uniqueGroup();
  const a = uniqueJid();
  const b = uniqueJid();

  // Adiciona algumas interações
  bondService.recordAction({ scopeKey, actorJid: a, targetJid: b, action: 'kiss' });
  bondService.recordAction({ scopeKey, actorJid: a, targetJid: b, action: 'slap' });

  const messages = [];
  await handleRelacaoCommand({
    userJid: a,
    scopeKey,
    bondService,
    args: [`@${b.split('@')[0]}`],
    mentionedJids: [b],
    reply: async (msg) => { messages.push(msg); },
    getContactDisplayName: (j) => (j === a ? 'Alice' : 'Bob'),
  });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /Química & Relação/i);
  assert.match(messages[0], /Afeto:/);
  assert.match(messages[0], /Rivalidade:/);
  assert.match(messages[0], /Intimidade:/);
  assert.match(messages[0], /Caos:/);
  assert.match(messages[0], /Arquétipo:/);
});

test('handleDivorceCommand: aplica indenização de divórcio litigioso se houver infidelidade flagrada recente', async () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const relRepo = createFunRelationshipRepository({ getDatabase: getDb });
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const bondRepo = createFunBondRepository({ getDatabase: getDb });
  const relService = createRelationshipService({
    relationshipRepository: relRepo,
    actionRepository: actionRepo,
  });
  const bondService = createBondService({
    bondRepository: bondRepo,
    relationshipRepository: relRepo,
  });

  const scopeKey = uniqueGroup();
  const spouseA = uniqueJid();
  const spouseB = uniqueJid();
  const thirdParty = uniqueJid();

  // Casa A e B
  relRepo.marry({ userJid: spouseA, partnerJid: spouseB, scopeKey });

  // Dá 1000 coins para o cônjuge A (que cometerá adultério)
  statsRepo.addCoins({ userJid: spouseA, scopeKey, amount: 1000, reason: 'seed' });
  statsRepo.addCoins({ userJid: spouseB, scopeKey, amount: 100, reason: 'seed' });

  // A beija C (terceiro) -> registra flagrante de infidelidade
  bondService.recordAction({
    scopeKey,
    actorJid: spouseA,
    targetJid: thirdParty,
    action: 'kiss',
    now: Date.now(),
  });

  const messages = [];
  // B pede divórcio após a traição flagrada
  const res = await handleDivorceCommand({
    userJid: spouseB,
    scopeKey,
    relationshipService: relService,
    bondService,
    repository: statsRepo,
    getContactDisplayName: (j) => (j === spouseA ? 'Alice' : j === spouseB ? 'Bob' : 'Charlie'),
    reply: async (msg) => { messages.push(msg); },
    funConfig: { divorceCost: 40 },
  });

  assert.equal(res.handled, true);
  assert.match(messages[0], /Litigioso|Indenização|Pensão/i);

  // A deve ter perdido 20% do saldo (200 coins) repassados para B
  const balA = statsRepo.getUserStats(spouseA, scopeKey).coins;
  const balB = statsRepo.getUserStats(spouseB, scopeKey).coins;

  assert.equal(balA, 800, 'Traidor deve perder 20% em pensão/indenização');
  assert.equal(balB, 300, 'Traído deve receber a indenização de 200 coins');
});
