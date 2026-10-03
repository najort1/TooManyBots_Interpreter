import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule } from '../fun/index.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

let userCounter = 5000;
function uniqueJid() {
  userCounter += 1;
  return `551197${String(Date.now()).slice(-6)}${String(userCounter).padStart(4, '0')}@s.whatsapp.net`;
}

test('integração social: fluxo completo via onIncomingMessage (/kiss, /relacao, /ship, /bounty, /tribunal)', async () => {
  const scopeKey = uniqueGroup();
  const alice = uniqueJid();
  const bob = uniqueJid();
  const charlie = uniqueJid();

  const sentMessages = [];
  const sendText = async (sock, to, text) => {
    sentMessages.push({ to, text: String(text || '') });
    return { key: { id: `msg_${Date.now()}_${Math.random()}` } };
  };

  const sendImage = async (sock, to, payload) => {
    sentMessages.push({ to, caption: payload.caption, url: payload.imageUrl });
    return { key: { id: `img_${Date.now()}_${Math.random()}` } };
  };

  const contactNames = new Map([
    [alice, 'Alice'],
    [bob, 'Bob'],
    [charlie, 'Charlie'],
  ]);

  const module = createFunModule({
    getDatabase: getDb,
    sendText,
    sendImage,
    getContactDisplayName: (j) => contactNames.get(j) || String(j).split('@')[0],
    getConfig: () => ({
      enabled: true,
      requireGroupWhitelist: false,
      worldQuietHoursEnabled: false,
      dailyChallengeEnabled: false,
    }),
  });

  module.init();
  const statsRepo = module._services.repository;

  // Dá moedas iniciais para os participantes
  statsRepo.addCoins({ userJid: alice, scopeKey, amount: 1000, reason: 'seed' });
  statsRepo.addCoins({ userJid: bob, scopeKey, amount: 500, reason: 'seed' });
  statsRepo.addCoins({ userJid: charlie, scopeKey, amount: 200, reason: 'seed' });

  // 1. Alice beija Bob (/kiss @Bob)
  const resKiss = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: `/kiss @${bob.split('@')[0]}`,
    mentionedJids: [bob],
  });

  assert.equal(resKiss.handled, true);
  const bondAB = module._services.bondRepository.getBond(scopeKey, alice, bob);
  assert.ok(bondAB.affection > 0);
  assert.ok(bondAB.intimacy > 0);

  // 2. Consulta de relação (/relacao @Bob)
  sentMessages.length = 0;
  const resRel = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: `/relacao @${bob.split('@')[0]}`,
    mentionedJids: [bob],
  });

  assert.equal(resRel.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /Química & Relação/i);
  assert.match(sentMessages[0].text, /Afeto:/);
  assert.match(sentMessages[0].text, /Intimidade:/);

  // 3. Calculadora de Ship dinâmico (/ship @Bob)
  sentMessages.length = 0;
  const resShip = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: `/ship @${bob.split('@')[0]}`,
    mentionedJids: [bob],
  });

  assert.equal(resShip.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /Ship/i);
  assert.match(sentMessages[0].text, /Arquétipo:/i);

  // 4. Bob coloca um bounty na cabeça de Charlie (/bounty @Charlie 100 Caloteiro)
  sentMessages.length = 0;
  const resBounty = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: bob,
    isGroup: true,
    text: `/bounty @${charlie.split('@')[0]} 100 Caloteiro`,
    mentionedJids: [charlie],
  });

  assert.equal(resBounty.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /CONTRATO DE CAÇA/i);
  assert.match(sentMessages[0].text, /80/); // 100 - 20% taxa = 80 líquido

  // 5. Lista de Bounties (/bounty lista)
  sentMessages.length = 0;
  const resBountyList = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: '/bounty lista',
  });

  assert.equal(resBountyList.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /Mural de Recompensas/i);
  assert.match(sentMessages[0].text, new RegExp(charlie.split('@')[0]));

  // 6. Alice abre Tribunal contra Charlie (/tribunal @Charlie Xingou no grupo)
  sentMessages.length = 0;
  const resTribunal = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: `/tribunal @${charlie.split('@')[0]} Xingou no grupo`,
    mentionedJids: [charlie],
  });

  assert.equal(resTribunal.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /TRIBUNAL DO POVO/i);

  // 7. Bob vota no Tribunal (/voto culpado)
  sentMessages.length = 0;
  const resVoto = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: bob,
    isGroup: true,
    text: '/voto culpado',
  });

  assert.equal(resVoto.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /CULPADO/i);

  // 8. Resolução do Tribunal (/tribunal resolver)
  sentMessages.length = 0;
  const resResolve = await module.onIncomingMessage({
    chatJid: scopeKey,
    actorJid: alice,
    isGroup: true,
    text: '/tribunal resolver',
  });

  assert.equal(resResolve.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[0].text, /VEREDITO: RÉU CONDENADO/i);
});
