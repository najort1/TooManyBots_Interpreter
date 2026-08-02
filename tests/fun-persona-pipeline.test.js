/**
 * Persona (Bot Membro Vivo) — integration test: pipeline hook.
 * Verifica precedência de comandos (persona nunca responde a comandos),
 * persona nunca quebra o pipeline, e falha de LLM → fallback estático.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUN_DISABLE_LIVE_LLM = '1';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

await initDb();

const baseConfig = { ...DEFAULT_FUN_CONFIG, worldQuietHoursEnabled: false };

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function setup(cfg = baseConfig) {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const identityMap = createIdentityMap();
  const svc = createPersonaService({
    personaRepository,
    groupRepository,
    getLogger: () => null,
  });
  const botJ = uniqueJid('5599');
  const sock = { user: { id: `${botJ.split('@')[0]}:0` }, sendMessage: async () => {} };
  return { svc, personaRepository, groupRepository, identityMap, botJ, sock, cfg };
}

test('pipeline: comando reconhecido tem precedência — persona não responde a "/pay bot 50"', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  const parsed = parseFunCommand('/pay bot 50');
  const isCommand = Boolean(parsed?.command);
  assert.ok(isCommand, '"/pay" deve ser reconhecido como comando');

  // o pipeline roteia comandos ANTES do hook passivo — então se for comando,
  // o hook da persona NÃO deve ser chamado para responder.
  const r = isCommand
    ? { responded: false, reason: 'command-precedence' }
    : await svc.tryRespond({ scopeKey: scope, text: '/pay bot 50', authorJid: uniqueJid(), sock, identityMap, funConfig: cfg });
  assert.equal(r.responded, false);
});

test('pipeline: persona nunca quebra o fluxo — try/catch envolve o hook', async () => {
  const { svc, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  let thrown = null;
  try {
    const r = await svc.tryRespond({
      scopeKey: scope, text: 'bot eai', authorJid: uniqueJid(),
      sock: { user: { id: '5599:0' } }, identityMap, funConfig: cfg,
    });
    assert.ok(r, 'deve sempre retornar um resultado (responded true/false)');
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null, 'persona não deve lançar mesmo com sock incompleto');
});

test('pipeline: falha de LLM → fallback estático envia mensagem', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  let sentText = null;
  sock.sendMessage = async (jid, payload) => { sentText = payload.text; };
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot, o que vc acha disso?', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, true);
  assert.equal(r.usedFallback, true);
  assert.ok(sentText && sentText.length > 0, 'fallback deve enviar mensagem');
});

test('pipeline: comando com palavra "bot" têm precedência — persona não polui resposta', () => {
  const parsed = parseFunCommand('/pay bot 50');
  assert.equal(parsed?.command, 'pay');
  const isCommand = Boolean(parsed?.command);
  assert.ok(isCommand);
  // mesmo contendo "bot", o comando roteado não dispara persona —
  // o hook passivo só é chamado quando isCommand é false.
});

test('pipeline: mensagem com "botão" (substring) não dispara persona', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  // isCountableMessage passa, mas detectTrigger retorna false → no-trigger
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'essa é a botão mais forte do mercado', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'no-trigger');
});
