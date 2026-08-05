import test from 'node:test';
import assert from 'node:assert/strict';

import { extractQuotedText } from '../fun/runtime.js';

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
