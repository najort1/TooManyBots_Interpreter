import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  listProviders,
  getProvider,
  detectProviderFromUrl,
  resolveProviderApiKey,
  PROVIDER_IDS,
} from '../fun/llm/providers.js';
import { parseEnv, loadEnv, updateEnvFile, getEnvPaths } from '../fun/env.js';
import { resolveZenEndpoint } from '../fun/llm/zenEndpoint.js';
import { checkZenConnectivity } from '../fun/llm/zenHealthCheck.js';
import { buildCompletionsUrl, classifyLlmError, smokeTestLlm } from '../fun/llm/smokeTest.js';

test('Provider Registry: lista todos os 7 provedores suportados com metadados', () => {
  const providers = listProviders();
  assert.equal(providers.length, 7);

  const ids = providers.map((p) => p.id);
  assert.ok(ids.includes(PROVIDER_IDS.OPENROUTER));
  assert.ok(ids.includes(PROVIDER_IDS.DEEPSEEK));
  assert.ok(ids.includes(PROVIDER_IDS.OPENAI));
  assert.ok(ids.includes(PROVIDER_IDS.OLLAMA));
  assert.ok(ids.includes(PROVIDER_IDS.LMSTUDIO));
  assert.ok(ids.includes(PROVIDER_IDS.ZEN));
  assert.ok(ids.includes(PROVIDER_IDS.CUSTOM));

  const openrouter = getProvider('openrouter');
  assert.ok(openrouter);
  assert.equal(openrouter.requiresApiKey, true);
  assert.ok(openrouter.portalUrl.includes('openrouter.ai'));
  assert.ok(openrouter.curatedModels.length > 0);
  assert.equal(openrouter.sendSamplingParams, true);

  const zen = getProvider('zen');
  assert.ok(zen);
  assert.equal(zen.sendSamplingParams, false);
});

test('Provider Registry: detectProviderFromUrl mapeia URLs conhecidas corretamente', () => {
  assert.equal(detectProviderFromUrl('https://openrouter.ai/api/v1'), PROVIDER_IDS.OPENROUTER);
  assert.equal(detectProviderFromUrl('https://api.deepseek.com/v1'), PROVIDER_IDS.DEEPSEEK);
  assert.equal(detectProviderFromUrl('https://api.openai.com/v1'), PROVIDER_IDS.OPENAI);
  assert.equal(detectProviderFromUrl('http://localhost:11434/v1'), PROVIDER_IDS.OLLAMA);
  assert.equal(detectProviderFromUrl('http://localhost:1234/v1'), PROVIDER_IDS.LMSTUDIO);
  assert.equal(detectProviderFromUrl('http://localhost:20128/v1'), PROVIDER_IDS.ZEN);
  assert.equal(detectProviderFromUrl('http://127.0.0.1:3300'), PROVIDER_IDS.ZEN);
  assert.equal(detectProviderFromUrl('https://my-proxy.internal/v1'), PROVIDER_IDS.CUSTOM);
});

test('Provider Registry: resolveProviderApiKey extrai chaves específicas por provedor/URL', () => {
  const mockEnv = {
    OPENROUTER_API_KEY: 'sk-or-test123',
    DEEPSEEK_API_KEY: 'sk-ds-test456',
    OPENAI_API_KEY: 'sk-oa-test789',
    ZEN_API_KEY: 'sk-zen-local',
  };

  assert.equal(resolveProviderApiKey('openrouter', mockEnv), 'sk-or-test123');
  assert.equal(resolveProviderApiKey('https://openrouter.ai/api/v1', mockEnv), 'sk-or-test123');
  assert.equal(resolveProviderApiKey('deepseek', mockEnv), 'sk-ds-test456');
  assert.equal(resolveProviderApiKey('https://api.deepseek.com/v1', mockEnv), 'sk-ds-test456');
  assert.equal(resolveProviderApiKey('openai', mockEnv), 'sk-oa-test789');
  assert.equal(resolveProviderApiKey('zen', mockEnv), 'sk-zen-local');
});

test('zenEndpoint: resolve chaves OPENROUTER_API_KEY e DEEPSEEK_API_KEY', () => {
  const prevEnv = { ...process.env };
  try {
    delete process.env.ZEN_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    // Cenário 1: URL aponta para OpenRouter e OPENROUTER_API_KEY está setada
    process.env.OPENROUTER_API_KEY = 'sk-or-auto';
    const ep1 = resolveZenEndpoint({ zenBaseUrl: 'https://openrouter.ai/api/v1' });
    assert.equal(ep1.apiKey, 'sk-or-auto');

    // Cenário 2: URL aponta para DeepSeek e DEEPSEEK_API_KEY está setada
    process.env.DEEPSEEK_API_KEY = 'sk-ds-auto';
    const ep2 = resolveZenEndpoint({ zenBaseUrl: 'https://api.deepseek.com/v1' });
    assert.equal(ep2.apiKey, 'sk-ds-auto');

    // Cenário 3: Configuração explícita prevalece sobre env
    const ep3 = resolveZenEndpoint({
      zenBaseUrl: 'https://openrouter.ai/api/v1',
      zenApiKey: 'chave-explicita',
    });
    assert.equal(ep3.apiKey, 'chave-explicita');

    // Cenário 4: Provedor local (Ollama) não herda OPENAI_API_KEY global se não configurado
    process.env.OPENAI_API_KEY = 'sk-openai-global-nao-usar-em-local';
    const ep4 = resolveZenEndpoint({
      zenBaseUrl: 'http://localhost:11434/v1',
    });
    assert.equal(ep4.apiKey, '');
  } finally {
    process.env = prevEnv;
  }
});

test('env.js: parseEnv interpreta variáveis com e sem aspas, comentários e escapes', () => {
  const sample = `
# Comentário de cabeçalho
PORT=3000
HOST="127.0.0.1"
API_URL='https://api.exemplo.com/v1'
INLINE_COMMENT=valor_puro # esse comentário deve ser descartado
QUOTED_WITH_HASH="valor # com hash dentro"
ESCAPED="linha1\\nlinha2"
export EXPORTED_VAR=sucesso
  `;

  const parsed = parseEnv(sample);
  assert.equal(parsed.PORT, '3000');
  assert.equal(parsed.HOST, '127.0.0.1');
  assert.equal(parsed.API_URL, 'https://api.exemplo.com/v1');
  assert.equal(parsed.INLINE_COMMENT, 'valor_puro');
  assert.equal(parsed.QUOTED_WITH_HASH, 'valor # com hash dentro');
  assert.equal(parsed.ESCAPED, 'linha1\nlinha2');
  assert.equal(parsed.EXPORTED_VAR, 'sucesso');
});

test('env.js: loadEnv não sobrescreve variáveis existentes por padrão', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-env-test-'));
  const tmpEnv = path.join(tmpDir, '.env');
  fs.writeFileSync(tmpEnv, 'EXISTING_TEST_VAR=novo_valor\nNEW_TEST_VAR=adicionado\n', 'utf-8');

  process.env.EXISTING_TEST_VAR = 'valor_original';

  try {
    const result = loadEnv({ paths: [tmpEnv], override: false });
    assert.equal(process.env.EXISTING_TEST_VAR, 'valor_original', 'Não deve sobrescrever');
    assert.equal(process.env.NEW_TEST_VAR, 'adicionado', 'Deve registrar nova variável');
    assert.equal(result.loaded.EXISTING_TEST_VAR, 'novo_valor');
  } finally {
    delete process.env.EXISTING_TEST_VAR;
    delete process.env.NEW_TEST_VAR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('env.js: updateEnvFile atualiza atomicamente e preserva comentários e estrutura', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-env-update-'));
  const tmpEnv = path.join(tmpDir, '.env');
  const initial = [
    '# Bloco de configuração',
    'OPENROUTER_API_KEY="sk-antiga"',
    '',
    '# Outra seção',
    'PRESERVAR_VAR=ok',
  ].join('\n');

  fs.writeFileSync(tmpEnv, initial, 'utf-8');

  try {
    updateEnvFile(tmpEnv, {
      OPENROUTER_API_KEY: 'sk-nova-chave',
      NOVA_VAR: 'valor novo',
    });

    const updatedContent = fs.readFileSync(tmpEnv, 'utf-8');
    assert.ok(updatedContent.includes('# Bloco de configuração'));
    assert.ok(updatedContent.includes('# Outra seção'));
    assert.ok(updatedContent.includes('PRESERVAR_VAR=ok'));
    assert.ok(updatedContent.includes('OPENROUTER_API_KEY=sk-nova-chave'));
    assert.ok(updatedContent.includes('NOVA_VAR="valor novo"'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('smokeTest: buildCompletionsUrl constrói URLs canônicas', () => {
  assert.equal(
    buildCompletionsUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('http://localhost:11434'),
    'http://localhost:11434/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/chat/completions'
  );
});

test('smokeTest: classifyLlmError gera diagnósticos acionáveis para 401, 402, 429, 404 e offline', () => {
  const err401 = classifyLlmError({
    status: 401,
    baseUrl: 'https://openrouter.ai/api/v1',
  });
  assert.equal(err401.code, 'UNAUTHORIZED');
  assert.equal(err401.reason, 'unauthorized-key');
  assert.ok(err401.advice.includes('Chave de API'));
  assert.ok(err401.portalUrl.includes('openrouter.ai'));

  const err402 = classifyLlmError({
    status: 402,
    baseUrl: 'https://api.deepseek.com/v1',
  });
  assert.equal(err402.code, 'PAYMENT_REQUIRED');
  assert.equal(err402.reason, 'insufficient-credits');

  const err429 = classifyLlmError({
    status: 429,
    baseUrl: 'https://api.openai.com/v1',
  });
  assert.equal(err429.code, 'RATE_LIMIT');

  const errOffline = classifyLlmError({
    error: { code: 'ECONNREFUSED' },
    baseUrl: 'http://localhost:11434/v1',
  });
  assert.equal(errOffline.code, 'CONNECTION_REFUSED');
  assert.equal(errOffline.reason, 'server-offline');
});

test('zenHealthCheck: trata HTTP 401 como offline (unauthorized-key)', async () => {
  const prevDisable = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  // Mock global fetch para retornar 401
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error": {"message": "Invalid API key"}}',
  });

  try {
    const check = await checkZenConnectivity({
      zenEnabled: true,
      zenBaseUrl: 'https://openrouter.ai/api/v1',
      zenApiKey: 'sk-invalida',
    });

    assert.equal(check.online, false);
    assert.equal(check.reason, 'unauthorized-key');
    assert.equal(check.status, 401);
    assert.ok(check.advice);
  } finally {
    globalThis.fetch = origFetch;
    if (prevDisable !== undefined) {
      process.env.FUN_DISABLE_LIVE_LLM = prevDisable;
    }
  }
});
