import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { handleDataProcessor } from '../handlers/integrationHandlers.js';
import { evaluateSingleCondition } from '../handlers/shared.js';

await initDb();

function createCtx(config, variables = {}) {
  const sentMessages = [];
  const sock = {
    sendMessage: async (_jid, payload) => {
      sentMessages.push(payload);
      return { ok: true };
    },
  };

  return {
    sentMessages,
    payload: {
      block: { id: 'dp-block', type: 'data-processor', config },
      session: {
        jid: 'test@s.whatsapp.net',
        blockIndex: 0,
        variables: { ...variables },
        status: 'active',
      },
      sock,
      jid: 'test@s.whatsapp.net',
      flow: { flowPath: '/tmp/test-flow.tmb' },
      runtime: {},
    },
  };
}

test('data-processor array_map supports jsonPath projection', async () => {
  const { payload } = createCtx(
    {
      operation: 'array_map',
      sourceVariable: 'foods_results',
      outputVariable: 'lista_alimentos_texto',
      transformType: 'array_map',
      jsonPath: 'descrição',
      onError: 'stop',
    },
    {
      foods_results: [
        { descrição: 'ovo cozido' },
        { descrição: 'ovo mexido' },
      ],
    }
  );

  const result = await handleDataProcessor(payload);
  assert.equal(result.done, false);
  assert.equal(result.nextBlockIndex, 1);
  assert.deepEqual(result.sessionPatch.variables.lista_alimentos_texto, ['ovo cozido', 'ovo mexido']);
});

test('data-processor jsonPath is accent-insensitive for object keys', async () => {
  const { payload } = createCtx(
    {
      operation: 'array_map',
      sourceVariable: 'foods_results',
      outputVariable: 'lista_alimentos_texto',
      transformType: 'array_map',
      jsonPath: 'descrição',
      onError: 'stop',
    },
    {
      foods_results: [
        { descricao: 'ovo cozido' },
        { descricao: 'ovo mexido' },
      ],
    }
  );

  const mapResult = await handleDataProcessor(payload);
  assert.equal(mapResult.done, false);
  assert.deepEqual(mapResult.sessionPatch.variables.lista_alimentos_texto, ['ovo cozido', 'ovo mexido']);

  const { payload: extractPayload } = createCtx(
    {
      operation: 'extract_field',
      sourceVariable: 'foods_results',
      outputVariable: 'codigo_alimento',
      transformType: 'extract_field',
      jsonPath: '[1].código',
      onError: 'stop',
    },
    {
      foods_results: [
        { codigo: 8 },
        { codigo: 10 },
      ],
    }
  );

  const extractResult = await handleDataProcessor(extractPayload);
  assert.equal(extractResult.done, false);
  assert.equal(extractResult.sessionPatch.variables.codigo_alimento, 10);
});

test('data-processor extract_field interpolates jsonPath with variables', async () => {
  const { payload } = createCtx(
    {
      operation: 'extract_field',
      sourceVariable: 'foods_results',
      outputVariable: 'codigo_alimento',
      transformType: 'extract_field',
      jsonPath: '[{{$index_alimento}}].código',
      onError: 'stop',
    },
    {
      index_alimento: '1',
      foods_results: [
        { código: 'abc' },
        { código: 'xyz' },
      ],
    }
  );

  const result = await handleDataProcessor(payload);
  assert.equal(result.done, false);
  assert.equal(result.nextBlockIndex, 1);
  assert.equal(result.sessionPatch.variables.codigo_alimento, 'xyz');
});

test('evaluateSingleCondition supports is_number and is_null operators', () => {
  const numberCheck = evaluateSingleCondition(
    { conditionType: 'variable', variable: 'value', operator: 'is_number' },
    { variables: { value: '123.5' } }
  );

  const notNumberCheck = evaluateSingleCondition(
    { conditionType: 'variable', variable: 'value', operator: 'is_number' },
    { variables: { value: 'abc' } }
  );

  const nullCheck = evaluateSingleCondition(
    { conditionType: 'variable', variable: 'value', operator: 'is_null' },
    { variables: { value: null } }
  );

  const notNullCheck = evaluateSingleCondition(
    { conditionType: 'variable', variable: 'value', operator: 'is_not_null' },
    { variables: { value: 'ok' } }
  );

  assert.equal(numberCheck, true);
  assert.equal(notNumberCheck, false);
  assert.equal(nullCheck, true);
  assert.equal(notNullCheck, true);
});
