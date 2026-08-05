import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveZenEndpoint } from '../fun/llm/zenEndpoint.js';

test('resolveZenEndpoint aplica os defaults Zen para config ausente', () => {
  assert.deepEqual(resolveZenEndpoint({}), {
    baseUrl: 'http://localhost:20128/v1',
    model: 'bot-zap',
    apiKey: '',
  });
});

test('resolveZenEndpoint respeita overrides de endpoint, modelo e chave', () => {
  assert.deepEqual(
    resolveZenEndpoint({
      zenBaseUrl: ' http://zen.interno/v1/ ',
      zenModel: ' modelo-especial ',
      zenApiKey: ' chave ',
    }),
    {
      baseUrl: 'http://zen.interno/v1/',
      model: 'modelo-especial',
      apiKey: 'chave',
    }
  );
});

test('resolveZenEndpoint não aceita override de modelo específico de tarefa', () => {
  const endpoint = resolveZenEndpoint({ qmpZenModel: 'grok45medium' });
  assert.equal(endpoint.model, 'bot-zap');
});
