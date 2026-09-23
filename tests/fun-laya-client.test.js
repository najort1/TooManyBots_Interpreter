import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayaEndpoint } from '../fun/llm/layaEndpoint.js';
import { createLayaClient, CIRCUIT_STATE } from '../fun/llm/layaClient.js';

test('resolveLayaEndpoint: defaults e overrides', () => {
  const def = resolveLayaEndpoint({});
  assert.equal(def.baseUrl, 'http://127.0.0.1:20129');
  assert.equal(def.model, 'aac6fef/laya-mlx');
  assert.equal(def.timeoutMs, 250);

  const custom = resolveLayaEndpoint({
    layaBaseUrl: 'http://localhost:30000///',
    layaModel: 'custom/model',
    layaTimeoutMs: 500,
  });
  assert.equal(custom.baseUrl, 'http://localhost:30000');
  assert.equal(custom.model, 'custom/model');
  assert.equal(custom.timeoutMs, 500);
});

test('layaClient.predict: sucesso retorna formato estruturado', async () => {
  const mockFetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:20129/predict');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.task, 'opportunity');
    assert.equal(body.state, 'hello world');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        model: 'aac6fef/laya-mlx',
        answers: {
          action: { type: 'choice', choice: 'pass', confidence: 0.95 },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    };
  };

  const client = createLayaClient({
    getConfig: () => ({ layaBaseUrl: 'http://127.0.0.1:20129' }),
    fetchImpl: mockFetch,
  });

  const res = await client.predict({
    task: 'opportunity',
    state: 'hello world',
    questions: { action: { type: 'choice' } },
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider, 'laya');
  assert.equal(res.fallback, false);
  assert.equal(res.answers.action.choice, 'pass');
  assert.equal(client.getCircuitState().state, CIRCUIT_STATE.CLOSED);
});

test('layaClient.predict: erro HTTP ativa fallback', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'Model loading' }),
  });

  const client = createLayaClient({
    getConfig: () => ({ layaCircuitFailureThreshold: 5 }),
    fetchImpl: mockFetch,
  });

  const res = await client.predict({
    task: 'test',
    state: 'test',
    questions: {},
  });

  assert.equal(res.ok, false);
  assert.equal(res.fallback, true);
  assert.equal(res.reason, 'http-503');
  assert.equal(client.getCircuitState().failures, 1);
});

test('layaClient: transições do Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)', async () => {
  let fail = true;
  let callCount = 0;
  let simulatedTime = 1000;

  const mockFetch = async () => {
    callCount += 1;
    if (fail) throw new Error('connection refused');
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', answers: {} }),
    };
  };

  const client = createLayaClient({
    getConfig: () => ({
      layaCircuitFailureThreshold: 2,
      layaCircuitCooldownMs: 5000,
    }),
    fetchImpl: mockFetch,
    clock: () => simulatedTime,
  });

  // 1ª falha
  await client.predict({ task: 't', state: 's', questions: {} });
  assert.equal(client.getCircuitState().state, CIRCUIT_STATE.CLOSED);
  assert.equal(client.getCircuitState().failures, 1);
  assert.equal(callCount, 1);

  // 2ª falha -> atinge threshold de 2 falhas, abre o circuito!
  await client.predict({ task: 't', state: 's', questions: {} });
  assert.equal(client.getCircuitState().state, CIRCUIT_STATE.OPEN);
  assert.equal(client.getCircuitState().failures, 2);
  assert.equal(callCount, 2);

  // 3ª chamada dentro do cooldown -> rejeição imediata SEM chamar fetch!
  simulatedTime += 2000; // apenas 2s se passaram (cooldown é 5s)
  const rejected = await client.predict({ task: 't', state: 's', questions: {} });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'circuit-open');
  assert.equal(rejected.fallback, true);
  assert.equal(callCount, 2); // Não chamou fetch!

  // Avança o tempo além do cooldown (5s)
  simulatedTime += 4000; // agora 6s desde a falha
  fail = false; // serviço se recuperou

  // Próxima chamada entra em HALF_OPEN e tenta probe
  const probe = await client.predict({ task: 't', state: 's', questions: {} });
  assert.equal(probe.ok, true);
  assert.equal(callCount, 3); // chamou fetch probe!

  // Sucesso restaura o circuito para CLOSED
  assert.equal(client.getCircuitState().state, CIRCUIT_STATE.CLOSED);
  assert.equal(client.getCircuitState().failures, 0);
});

test('layaClient.health: consulta /health com sucesso', async () => {
  const mockFetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:20129/health');
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', model_loaded: true }),
    };
  };

  const client = createLayaClient({
    getConfig: () => ({ layaBaseUrl: 'http://127.0.0.1:20129' }),
    fetchImpl: mockFetch,
  });

  const res = await client.health();
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'ok');
  assert.equal(res.data.model_loaded, true);
});
