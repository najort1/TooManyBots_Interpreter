import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractQuotedText,
  persistFunContactIdentity,
  persistFunMessageIdentity,
  resolveBaileysLidMappings,
} from '../fun/runtime.js';
import { createIdentityMap } from '../fun/utils/identity.js';
import { initDb } from '../db/index.js';
import { useSqliteAuthState } from '../db/authState.js';

test('extractQuotedText lê conversation, texto e legendas da mensagem citada', () => {
  assert.equal(
    extractQuotedText({
      message: {
        extendedTextMessage: {
          contextInfo: { quotedMessage: { conversation: 'texto original' } },
        },
      },
    }),
    'texto original'
  );
  assert.equal(
    extractQuotedText({
      message: {
        imageMessage: {
          contextInfo: { quotedMessage: { imageMessage: { caption: 'legenda da foto' } } },
        },
      },
    }),
    'legenda da foto'
  );
  assert.equal(extractQuotedText({ message: { stickerMessage: {} } }), '');
});

test('persistFunContactIdentity guarda o nome de contato Baileys sob o LID primário', () => {
  const identityMap = createIdentityMap();
  const saved = [];
  const result = persistFunContactIdentity({
    id: '281350775005409@lid',
    phoneNumber: '558199999888@s.whatsapp.net',
    name: 'Outra Pessoa',
  }, {
    identityMap,
    source: 'contacts.upsert',
    now: 123,
    upsert: (entry) => {
      saved.push(entry);
      return true;
    },
  });

  assert.deepEqual(result, {
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    persisted: true,
  });
  assert.deepEqual(saved, [{
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    source: 'contacts.upsert',
    updatedAt: 123,
  }]);
  assert.equal(identityMap.resolve('281350775005409@lid'), '281350775005409@lid');
  assert.equal(identityMap.getPn('281350775005409@lid'), '558199999888@s.whatsapp.net');
});

test('persistFunContactIdentity mantém nome quando o contato Baileys só informa LID', () => {
  const saved = [];
  const result = persistFunContactIdentity({
    id: '281350775005409@lid',
    notify: 'Outra Pessoa',
  }, {
    source: 'messaging-history.set',
    now: 456,
    upsert: (entry) => {
      saved.push(entry);
      return true;
    },
  });

  assert.deepEqual(result, {
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    persisted: true,
  });
  assert.deepEqual(saved, [{
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    source: 'messaging-history.set',
    updatedAt: 456,
  }]);
});

test('persistFunMessageIdentity salva o pushName de mensagem histórica pelo LID do participante', () => {
  const saved = [];
  const result = persistFunMessageIdentity({
    key: {
      remoteJid: '120363000000000000@g.us',
      participant: '281350775005409@s.whatsapp.net',
    },
    pushName: 'Outra Pessoa',
  }, {
    source: 'fun-runtime-history-message',
    now: 789,
    upsert: (entry) => {
      saved.push(entry);
      return true;
    },
  });

  assert.deepEqual(result, {
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    persisted: true,
  });
  assert.deepEqual(saved, [{
    jid: '281350775005409@lid',
    displayName: 'Outra Pessoa',
    source: 'fun-runtime-history-message',
    updatedAt: 789,
  }]);
});

test('persistFunMessageIdentity nunca atribui o pushName próprio ao contato da conversa', () => {
  const saved = [];
  const result = persistFunMessageIdentity({
    key: { fromMe: true, remoteJid: '558199999888@s.whatsapp.net' },
    pushName: 'Dudu Bot',
  }, {
    upsert: (entry) => {
      saved.push(entry);
      return true;
    },
  });

  assert.deepEqual(result, { jid: '', displayName: '', persisted: false });
  assert.deepEqual(saved, []);
});

test('resolveBaileysLidMappings mantém LID e registra PN como alias de migração', async () => {
  const identityMap = createIdentityMap();
  const requestedLids = [];
  const sock = {
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => {
          requestedLids.push(lid);
          return '558293639334:0@s.whatsapp.net';
        },
      },
    },
  };

  const mappings = await resolveBaileysLidMappings(
    sock,
    ['281350775005409@s.whatsapp.net'],
    identityMap
  );

  assert.deepEqual(requestedLids, ['281350775005409@lid']);
  assert.deepEqual(mappings, [{
    lid: '281350775005409@lid',
    pn: '558293639334@s.whatsapp.net',
  }]);
  assert.equal(identityMap.resolve('281350775005409@s.whatsapp.net'), '281350775005409@lid');
  assert.equal(identityMap.getPn('281350775005409@lid'), '558293639334@s.whatsapp.net');
});

test('auth state SQLite aceita as chaves obrigatórias do Baileys v7', async () => {
  await initDb();
  const { state } = useSqliteAuthState();
  const id = `v7-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await state.keys.set({
      'lid-mapping': { [id]: '281350775005409' },
      'device-list': { [id]: ['281350775005409:0@lid'] },
      tctoken: { [id]: { token: Buffer.from('v7-token'), timestamp: '123' } },
    });

    assert.equal((await state.keys.get('lid-mapping', [id]))[id], '281350775005409');
    assert.deepEqual((await state.keys.get('device-list', [id]))[id], ['281350775005409:0@lid']);
    assert.deepEqual((await state.keys.get('tctoken', [id]))[id], {
      token: Buffer.from('v7-token'),
      timestamp: '123',
    });
  } finally {
    await state.keys.set({
      'lid-mapping': { [id]: null },
      'device-list': { [id]: null },
      tctoken: { [id]: null },
    });
  }
});
