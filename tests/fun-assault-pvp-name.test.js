/**
 * Regressão: prompt LLM de assalto PvP deve usar pvpName (resolvido pelo
 * pipeline via nameOf/createUserFormatter) quando o displayName do alvo é
 * desconhecido, NÃO o JID local-part devolvido por displayNameOnly.
 *
 * Bug original em fun/commands/handlers/market.js:
 *   : displayNameOnly(getContactDisplayName, result.targetJid || '') || pvpName;
 * displayNameOnly sempre retorna truthy (cai em jidLocalPart quando o nome
 * não existe), então pvpName nunca era usado → LLM recebia número cru do JID
 * como "target" e inventava nome genérico.
 *
 * Fix: priorizar pvpName; displayNameOnly só se pvpName for vazio.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAssaultCommand } from '../fun/commands/handlers/market.js';
import {
  createUserFormatter,
  runWithUserLabels,
} from '../fun/utils/userLabel.js';

function makeSock(userJid = '5511000000001@s.whatsapp.net') {
  return { user: { id: userJid.split(':')[0] } };
}

async function runAssaultScenario({
  attackerJid,
  targetJid,
  attackerName = 'Lucas Santos',
  // Quando o contato alvo tem display name amigável armazenado:
  targetDisplayName = '',
  // Quando o grupo tem nickname customizado para o alvo:
  targetNickname = '',
  // Mention on/off no formatter do request:
  mentionUsers = true,
}) {
  const capturedVars = {};
  const calls = { story: 0 };

  const marketService = {
    assault: () => ({
      ok: true,
      success: false,
      mode: 'player',
      targetJid,
      chance: 0.42,
      weapon: { emoji: '💥', name: 'Rifle serrado', id: 'rifle' },
      usedGas: false,
      fine: 0,
      finePct: 0,
      heat: 0,
      wantedLevel: 0,
      suspicion: 0,
      immune: false,
      coins: 100,
    }),
    formatAssaultHelp: () => 'help',
  };

  const flavorService = {
    assaultStory: async (_scenario, vars) => {
      calls.story += 1;
      Object.assign(capturedVars, vars);
      return null;
    },
  };

  const getContactDisplayName = (jid) => {
    if (jid === attackerJid) return attackerName;
    return targetDisplayName;
  };

  const resolveNickname = (jid) => {
    if (jid === targetJid) return targetNickname;
    return '';
  };

  const formatter = createUserFormatter({
    getContactDisplayName,
    resolveNickname,
    mentionUsers,
  });

  const reply = async () => {};

  await runWithUserLabels(formatter, () =>
    handleAssaultCommand({
      userJid: attackerJid,
      scopeKey: '120363000000000000@g.us',
      marketService,
      funConfig: { marketEnabled: true, weaponsLicenseRequired: true },
      getContactDisplayName,
      listContacts: () => [],
      reply,
      flavorService,
      args: [`@${targetJid}`],
      mentionedJids: [targetJid],
      quotedParticipant: '',
      sock: makeSock(attackerJid),
      identityMap: null,
      chaosEventService: null,
      msgTimeMs: Date.now(),
    })
  );

  return { capturedVars, calls };
}

test('PvP assault: alvo SEM display name nem nickname → pvpName prioriza @menção do pipeline', async () => {
  const attacker = '5511000000010@s.whatsapp.net';
  const target = '5511999888777@s.whatsapp.net';

  const { capturedVars } = await runAssaultScenario({
    attackerJid: attacker,
    targetJid: target,
    mentionUsers: true, // pipeline real: pvpName = @menção
  });

  // pvpName (via nameOf com mentionUsers=true) = '@5511999888777'
  // displayNameOnly(targetJid) (ignorando pvpName) = '5511999888777' (jidLocalPart)
  // Fix prioriza pvpName → output deve conter '@' na frente do número.
  assert.match(capturedVars.target, /^@5511999888777$/);
});

test('PvP assault: alvo COM displayName → displayName vence (contato salvo)', async () => {
  const attacker = '5511000000020@s.whatsapp.net';
  const target = '5511888777666@s.whatsapp.net';

  const { capturedVars } = await runAssaultScenario({
    attackerJid: attacker,
    targetJid: target,
    targetDisplayName: 'Maria Silva',
    mentionUsers: false,
  });

  // nameOf com mentionUsers=false cai em displayNameOnly → contact name.
  assert.equal(capturedVars.target, 'Maria Silva');
});

test('PvP assault: alvo COM nickname de grupo → nickname vence (perfil custom)', async () => {
  const attacker = '5511000000030@s.whatsapp.net';
  const target = '5511777666555@s.whatsapp.net';

  const { capturedVars } = await runAssaultScenario({
    attackerJid: attacker,
    targetJid: target,
    targetNickname: 'Coelho',
    targetDisplayName: 'João da Silva',
    mentionUsers: false,
  });

  // nameOf → resolveNickname tem prioridade (definido no store ALS).
  assert.equal(capturedVars.target, 'Coelho');
});

test('PvP assault: attacker sempre usa nome do contact (não JID cru)', async () => {
  const attacker = '5511000000050@s.whatsapp.net';
  const target = '5511555444333@s.whatsapp.net';

  const { capturedVars } = await runAssaultScenario({
    attackerJid: attacker,
    targetJid: target,
    mentionUsers: true,
  });

  // attacker também passa pelo mesmo caminho do pipeline.
  assert.equal(capturedVars.attacker, 'Lucas Santos');
});
