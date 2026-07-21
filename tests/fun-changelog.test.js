import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatChangelogMessage,
  createChangelogService,
} from '../fun/services/changelogService.js';
import { initDb } from '../db/index.js';

test('formatChangelogMessage: cabeçalho + corpo livre (sem bullet forçado)', () => {
  const r = formatChangelogMessage({
    title: 'Novidades',
    version: 'v2.1',
    body: [
      '**Bolsa**',
      'Agora dá pra comprar ações no grupo.',
      '',
      '- /bolsa — cotações',
      '- /carteira — suas ações',
      '',
      '3) ajuste de prompts',
    ].join('\n'),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /📢 \*Atualização\*/);
  assert.match(r.text, /\*Novidades\*/);
  assert.match(r.text, /v2\.1/);
  // ** → *negrito WA*
  assert.match(r.text, /\*Bolsa\*/);
  // parágrafo sem bullet
  assert.match(r.text, /Agora dá pra comprar ações no grupo\./);
  assert.doesNotMatch(r.text, /• Agora dá pra comprar/);
  // lista intencional
  assert.match(r.text, /• \/bolsa/);
  assert.match(r.text, /• \/carteira/);
  assert.match(r.text, /3\) ajuste de prompts/);
  assert.doesNotMatch(r.text, /manda no grupo se tiver/);
});

test('formatChangelogBody: markdown leve e listas', async () => {
  const { formatChangelogBody } = await import('../fun/services/changelogService.js');
  const body = formatChangelogBody(
    '## Seção\nTexto longo **importante** e ~~velho~~.\n\n- item md\n• outro'
  );
  assert.match(body, /\*Seção\*/);
  assert.match(body, /\*importante\*/);
  assert.match(body, /~velho~/);
  assert.match(body, /• item md/);
  assert.match(body, /• outro/);
  assert.doesNotMatch(body, /• Texto longo/);
});

test('formatChangelogMessage: caso real do editor (negrito + parágrafo)', async () => {
  const { formatChangelogMessage } = await import('../fun/services/changelogService.js');
  const r = formatChangelogMessage({
    title: 'Novidades do bot',
    body: [
      '*Novo sistema de mensagens mais dinâmicas e personalizadas*',
      '',
      'Os comandos agora geram textos mais dinâmicos, inteligentes e engraçados — adaptados ao perfil e contexto de cada grupo.',
    ].join('\n'),
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /\*Novo sistema de mensagens mais dinâmicas e personalizadas\*/);
  assert.match(
    r.text,
    /Os comandos agora geram textos mais dinâmicos/
  );
  // nenhuma linha de conteúdo com bullet forçado
  assert.doesNotMatch(r.text, /• \*Novo sistema/);
  assert.doesNotMatch(r.text, /• Os comandos agora/);
});

test('formatChangelogMessage: body vazio falha', () => {
  const r = formatChangelogMessage({ title: 'X', body: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-body');
});

test('changelog resolveTargets só whitelist e @g.us', () => {
  const svc = createChangelogService({
    getConfig: () => ({}),
    getSock: () => null,
    sendText: async () => {},
  });
  const targets = svc.resolveTargets(
    { groupWhitelistJids: ['120363IN@g.us', '120363OUT@g.us', 'user@s.whatsapp.net'] },
    ['120363IN@g.us', '120363HACKER@g.us']
  );
  assert.deepEqual(targets, ['120363IN@g.us']);
});

test('changelog dryRun e broadcast real com DB', async () => {
  await initDb();
  const sent = [];
  const sleeps = [];
  const svc = createChangelogService({
    getConfig: () => ({
      groupWhitelistJids: ['120363AAA@g.us', '120363BBB@g.us'],
    }),
    getSock: () => ({ user: { id: 'bot' } }),
    sendText: async (_sock, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: (jid) => (jid.includes('AAA') ? 'Grupo A' : 'Grupo B'),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    randomId: () => `chg-${Date.now()}`,
  });

  const dry = await svc.broadcast({
    body: 'Item um\nItem dois',
    title: 'Update',
    version: '1.0',
    dryRun: true,
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.targetCount, 2);
  assert.equal(dry.okCount, 2);
  assert.equal(sent.length, 0);
  assert.match(dry.text, /Item um/);

  const live = await svc.broadcast({
    body: 'Correção X\nFeature Y',
    title: 'Patch',
    version: '1.0.1',
    dryRun: false,
  });
  assert.equal(live.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].jid, '120363AAA@g.us');
  assert.equal(sent[1].jid, '120363BBB@g.us');
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 1000);

  const history = svc.listHistory({ limit: 5 });
  assert.ok(history.length >= 1);
  assert.ok(history.some((h) => h.title === 'Patch' || h.title === 'Update'));
});

test('changelog whatsapp-offline quando sem sock', async () => {
  const svc = createChangelogService({
    getConfig: () => ({ groupWhitelistJids: ['120363A@g.us'] }),
    getSock: () => null,
    sendText: async () => {},
    sleep: async () => {},
  });
  const result = await svc.broadcast({
    body: 'hello change',
    dryRun: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'whatsapp-offline');
  assert.match(result.text, /hello change/);
});
