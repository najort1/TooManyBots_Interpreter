import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { loadEnv, updateEnvFile, parseEnv, getEnvPaths } from '../fun/env.js';
import {
  PROVIDER_IDS,
  PROVIDERS,
  listProviders,
  getProvider,
  detectProviderFromUrl,
  resolveProviderApiKey,
} from '../fun/llm/providers.js';
import {
  smokeTestLlm,
  classifyLlmError,
  buildCompletionsUrl,
} from '../fun/llm/smokeTest.js';
import { buildFunUserConfig } from '../fun/scripts/setupWizard.js';
import { FUN_PRESET_IDS } from '../fun/presets.js';

// ============================================================================
// 1. TESTES DE LOAD_ENV (Não sobrescrever process.env existente)
// ============================================================================

test('loadEnv() carrega novas variáveis sem sobrescrever variáveis já existentes em process.env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-env-test-'));
  const tempEnvPath = path.join(tempDir, '.env');

  const keyExisting = 'TMB_TEST_EXISTING_VAR_' + Date.now();
  const keyNew = 'TMB_TEST_NEW_VAR_' + Date.now();

  try {
    // 1. Pré-define uma variável no processo
    process.env[keyExisting] = 'pre_existing_value';

    // 2. Grava um arquivo .env contendo a mesma chave e uma nova
    fs.writeFileSync(
      tempEnvPath,
      `${keyExisting}=value_from_file\n${keyNew}=new_value_from_file\n`,
      'utf-8'
    );

    // 3. Executa loadEnv com override: false (padrão seguro)
    const result = loadEnv({ paths: [tempEnvPath], override: false });

    // Verifica que a variável pré-existente NÃO foi sobrescrita
    assert.equal(
      process.env[keyExisting],
      'pre_existing_value',
      'process.env existente não deve ser sobrescrito por padrão'
    );

    // Verifica que a nova variável foi carregada
    assert.equal(
      process.env[keyNew],
      'new_value_from_file',
      'Nova variável deve ser carregada no process.env'
    );

    // Verifica que o retorno do loadEnv reporta os dados lidos
    assert.equal(result.loaded[keyExisting], 'value_from_file');
    assert.equal(result.loaded[keyNew], 'new_value_from_file');
    assert.ok(result.pathsLoaded.includes(tempEnvPath));

    // 4. Executa loadEnv com override: true e verifica que agora sim sobrescreve
    loadEnv({ paths: [tempEnvPath], override: true });
    assert.equal(
      process.env[keyExisting],
      'value_from_file',
      'Com override: true, variável existente deve ser atualizada'
    );
  } finally {
    delete process.env[keyExisting];
    delete process.env[keyNew];
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignora limpeza temporária
    }
  }
});

// ============================================================================
// 2. TESTES DE UPDATE_ENV_FILE (Preservar comentários, espaços e formatação)
// ============================================================================

test('updateEnvFile() atualiza chaves existentes preservando comentários, linhas em branco e formatação', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-env-update-'));
  const tempEnvPath = path.join(tempDir, '.env');

  const initialContent = [
    '# ============================================================',
    '# Arquivo de configuração de teste TooManyBots',
    '# Autor: Equipe de Engenharia',
    '# ============================================================',
    '',
    '# Configurações do Provedor de IA',
    'OPENROUTER_API_KEY=old-key-123',
    'DEEPSEEK_API_KEY=sk-ds-original',
    '',
    '# Outras preferências',
    'FUN_THEME=cyberpunk',
    'DEBUG=true',
    '',
    '# Comentário no rodapé',
  ].join('\n') + '\n';

  try {
    fs.writeFileSync(tempEnvPath, initialContent, 'utf-8');

    // Executa atualização atômica
    const updateResult = updateEnvFile(tempEnvPath, {
      OPENROUTER_API_KEY: 'sk-or-v1-new-updated-key',
      NEW_CONFIG_KEY: 'nova_configuracao_valor',
      SPACED_VALUE_KEY: 'texto com espacos e pontuacao!',
    });

    assert.equal(updateResult.ok, true);
    assert.ok(updateResult.updatedKeys.includes('OPENROUTER_API_KEY'));
    assert.ok(updateResult.updatedKeys.includes('NEW_CONFIG_KEY'));

    const updatedContent = fs.readFileSync(tempEnvPath, 'utf-8');

    // 1. Preservação de comentários do cabeçalho
    assert.ok(
      updatedContent.includes('# Arquivo de configuração de teste TooManyBots'),
      'Comentário de cabeçalho deve ser preservado'
    );
    assert.ok(
      updatedContent.includes('# Configurações do Provedor de IA'),
      'Comentários de seção devem ser preservados'
    );
    assert.ok(
      updatedContent.includes('# Comentário no rodapé'),
      'Comentário de rodapé deve ser preservado'
    );

    // 2. Chave atualizada no lugar correto
    assert.ok(
      updatedContent.includes('OPENROUTER_API_KEY=sk-or-v1-new-updated-key'),
      'Chave existente deve ter seu valor atualizado'
    );
    assert.ok(
      !updatedContent.includes('old-key-123'),
      'Valor antigo não deve mais estar presente'
    );

    // 3. Chave inalterada intacta
    assert.ok(
      updatedContent.includes('DEEPSEEK_API_KEY=sk-ds-original'),
      'Chaves não modificadas devem permanecer inalteradas'
    );
    assert.ok(
      updatedContent.includes('FUN_THEME=cyberpunk'),
      'Outras configurações devem permanecer'
    );

    // 4. Novas chaves anexadas
    assert.ok(
      updatedContent.includes('NEW_CONFIG_KEY=nova_configuracao_valor'),
      'Nova chave deve ser adicionada ao arquivo'
    );

    // 5. Aspas automáticas para valores com espaços
    assert.ok(
      updatedContent.includes('SPACED_VALUE_KEY="texto com espacos e pontuacao!"'),
      'Valores com espaços devem receber aspas seguras'
    );

    // 6. Teste de parseEnv sobre o arquivo atualizado
    const parsed = parseEnv(updatedContent);
    assert.equal(parsed.OPENROUTER_API_KEY, 'sk-or-v1-new-updated-key');
    assert.equal(parsed.DEEPSEEK_API_KEY, 'sk-ds-original');
    assert.equal(parsed.NEW_CONFIG_KEY, 'nova_configuracao_valor');
    assert.equal(parsed.SPACED_VALUE_KEY, 'texto com espacos e pontuacao!');
    assert.equal(parsed.FUN_THEME, 'cyberpunk');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignora
    }
  }
});

test('updateEnvFile() cria novo arquivo se ele não existir', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-env-create-'));
  const tempEnvPath = path.join(tempDir, 'subfolder', '.env');

  try {
    const res = updateEnvFile(tempEnvPath, {
      INITIAL_VAR: 'hello',
    });

    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(tempEnvPath));
    const content = fs.readFileSync(tempEnvPath, 'utf-8');
    assert.ok(content.includes('INITIAL_VAR=hello'));
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignora
    }
  }
});

// ============================================================================
// 3. TESTES DO PROVIDER REGISTRY (Schemas, endpoints, chaves)
// ============================================================================

test('Provider Registry: esquemas e metadados completos para todos os provedores principais', () => {
  const providers = listProviders();
  assert.equal(providers.length, 7, 'Deve listar exatamente 7 provedores');

  // OpenRouter
  const openrouter = getProvider(PROVIDER_IDS.OPENROUTER);
  assert.ok(openrouter, 'OpenRouter deve estar registrado');
  assert.equal(openrouter.name, 'OpenRouter');
  assert.equal(openrouter.defaultBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(openrouter.envKey, 'OPENROUTER_API_KEY');
  assert.equal(openrouter.requiresApiKey, true);
  assert.equal(openrouter.supportsModelDiscovery, false);
  assert.equal(openrouter.sendSamplingParams, true);
  assert.ok(openrouter.portalUrl.includes('openrouter.ai/keys'));
  assert.ok(openrouter.curatedModels.length >= 3);
  assert.ok(openrouter.curatedModels.some((m) => m.id === 'deepseek/deepseek-chat'));

  // DeepSeek
  const deepseek = getProvider(PROVIDER_IDS.DEEPSEEK);
  assert.ok(deepseek, 'DeepSeek deve estar registrado');
  assert.equal(deepseek.name, 'DeepSeek');
  assert.equal(deepseek.defaultBaseUrl, 'https://api.deepseek.com/v1');
  assert.equal(deepseek.envKey, 'DEEPSEEK_API_KEY');
  assert.equal(deepseek.requiresApiKey, true);
  assert.equal(deepseek.supportsModelDiscovery, false);
  assert.equal(deepseek.defaultModel, 'deepseek-chat');
  assert.ok(deepseek.portalUrl.includes('platform.deepseek.com'));
  assert.ok(deepseek.curatedModels.some((m) => m.id === 'deepseek-chat'));

  // OpenAI
  const openai = getProvider(PROVIDER_IDS.OPENAI);
  assert.ok(openai, 'OpenAI deve estar registrado');
  assert.equal(openai.name, 'OpenAI');
  assert.equal(openai.defaultBaseUrl, 'https://api.openai.com/v1');
  assert.equal(openai.envKey, 'OPENAI_API_KEY');
  assert.equal(openai.requiresApiKey, true);
  assert.equal(openai.defaultModel, 'gpt-4o-mini');
  assert.ok(openai.portalUrl.includes('platform.openai.com'));
  assert.ok(openai.curatedModels.some((m) => m.id === 'gpt-4o-mini'));

  // Ollama
  const ollama = getProvider(PROVIDER_IDS.OLLAMA);
  assert.ok(ollama, 'Ollama deve estar registrado');
  assert.equal(ollama.name, 'Ollama');
  assert.equal(ollama.defaultBaseUrl, 'http://localhost:11434/v1');
  assert.equal(ollama.requiresApiKey, false);
  assert.equal(ollama.supportsModelDiscovery, true);
  assert.equal(ollama.discoveryEndpoint, 'http://localhost:11434/api/tags');
  assert.ok(ollama.curatedModels.length >= 2);

  // LM Studio
  const lmstudio = getProvider(PROVIDER_IDS.LMSTUDIO);
  assert.ok(lmstudio, 'LM Studio deve estar registrado');
  assert.equal(lmstudio.name, 'LM Studio');
  assert.equal(lmstudio.defaultBaseUrl, 'http://localhost:1234/v1');
  assert.equal(lmstudio.requiresApiKey, false);
  assert.equal(lmstudio.supportsModelDiscovery, true);
  assert.equal(lmstudio.discoveryEndpoint, 'http://localhost:1234/v1/models');
  assert.equal(lmstudio.defaultModel, 'local-model');

  // Custom
  const custom = getProvider(PROVIDER_IDS.CUSTOM);
  assert.ok(custom, 'Custom deve estar registrado');
  assert.equal(custom.requiresApiKey, false);
  assert.equal(custom.supportsModelDiscovery, false);
});

test('Provider Registry: detectProviderFromUrl mapeia URLs para os provedores corretos', () => {
  assert.equal(detectProviderFromUrl('https://openrouter.ai/api/v1'), PROVIDER_IDS.OPENROUTER);
  assert.equal(detectProviderFromUrl('https://openrouter.ai/api/v1/chat/completions'), PROVIDER_IDS.OPENROUTER);
  assert.equal(detectProviderFromUrl('https://api.deepseek.com/v1'), PROVIDER_IDS.DEEPSEEK);
  assert.equal(detectProviderFromUrl('https://api.deepseek.com'), PROVIDER_IDS.DEEPSEEK);
  assert.equal(detectProviderFromUrl('https://api.openai.com/v1'), PROVIDER_IDS.OPENAI);
  assert.equal(detectProviderFromUrl('http://localhost:11434/v1'), PROVIDER_IDS.OLLAMA);
  assert.equal(detectProviderFromUrl('http://127.0.0.1:11434'), PROVIDER_IDS.OLLAMA);
  assert.equal(detectProviderFromUrl('http://localhost:1234/v1'), PROVIDER_IDS.LMSTUDIO);
  assert.equal(detectProviderFromUrl('http://192.168.1.5:1234'), PROVIDER_IDS.LMSTUDIO);
  assert.equal(detectProviderFromUrl('http://localhost:20128/v1'), PROVIDER_IDS.ZEN);
  assert.equal(detectProviderFromUrl('http://127.0.0.1:3300'), PROVIDER_IDS.ZEN);
  assert.equal(detectProviderFromUrl('https://custom-ai-gateway.me/v1'), PROVIDER_IDS.CUSTOM);
  assert.equal(detectProviderFromUrl(''), PROVIDER_IDS.CUSTOM);
  assert.equal(detectProviderFromUrl(null), PROVIDER_IDS.CUSTOM);
});

test('Provider Registry: resolveProviderApiKey extrai e respeita precedência de chaves de API', () => {
  // 1. OpenRouter com OPENROUTER_API_KEY
  assert.equal(
    resolveProviderApiKey('openrouter', {
      OPENROUTER_API_KEY: 'sk-or-real',
      OPENAI_API_KEY: 'sk-oa-other',
    }),
    'sk-or-real'
  );

  // 2. OpenRouter fallback para ZEN_API_KEY
  assert.equal(
    resolveProviderApiKey('openrouter', {
      ZEN_API_KEY: 'sk-zen-fallback',
    }),
    'sk-zen-fallback'
  );

  // 3. DeepSeek com DEEPSEEK_API_KEY
  assert.equal(
    resolveProviderApiKey('deepseek', {
      DEEPSEEK_API_KEY: 'sk-ds-key',
      OPENAI_API_KEY: 'sk-oa-key',
    }),
    'sk-ds-key'
  );

  // 4. DeepSeek fallback para ZEN_API_KEY
  assert.equal(
    resolveProviderApiKey('deepseek', {
      ZEN_API_KEY: 'sk-zen-ds-fallback',
    }),
    'sk-zen-ds-fallback'
  );

  // 5. OpenAI com OPENAI_API_KEY
  assert.equal(
    resolveProviderApiKey('openai', {
      OPENAI_API_KEY: 'sk-oa-direct',
    }),
    'sk-oa-direct'
  );

  // 6. Ollama e LM Studio (sem chaves obrigatórias, mas suportam variáveis de ambiente dedicadas)
  assert.equal(
    resolveProviderApiKey('ollama', {
      OLLAMA_API_KEY: 'ollama-token',
    }),
    'ollama-token'
  );
  assert.equal(
    resolveProviderApiKey('lmstudio', {
      LMSTUDIO_API_KEY: 'lmstudio-token',
    }),
    'lmstudio-token'
  );
  assert.equal(
    resolveProviderApiKey('ollama', {}),
    ''
  );

  // 7. Resolução automática através da URL base
  assert.equal(
    resolveProviderApiKey('https://openrouter.ai/api/v1', {
      OPENROUTER_API_KEY: 'sk-from-url',
    }),
    'sk-from-url'
  );
  assert.equal(
    resolveProviderApiKey('https://api.deepseek.com/v1', {
      DEEPSEEK_API_KEY: 'sk-from-url-ds',
    }),
    'sk-from-url-ds'
  );
});

test('buildCompletionsUrl normaliza corretamente rotas para /chat/completions', () => {
  assert.equal(
    buildCompletionsUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('https://openrouter.ai/api/v1/chat/completions'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('http://localhost:11434'),
    'http://localhost:11434/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('http://localhost:1234'),
    'http://localhost:1234/v1/chat/completions'
  );
  assert.equal(
    buildCompletionsUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/chat/completions'
  );
});

// ============================================================================
// 4. TESTES DE SMOKE_TEST_LLM (Mock de fetch: OK, 401, 402, 429, 404, ECONNREFUSED, timeout)
// ============================================================================

test('smokeTestLlm: diagnóstico com mock de fetch para 200 OK', async () => {
  const origFetch = globalThis.fetch;
  let receivedUrl = '';
  let receivedHeaders = {};
  let receivedBody = {};

  try {
    globalThis.fetch = async (url, options) => {
      receivedUrl = String(url);
      receivedHeaders = options?.headers || {};
      receivedBody = JSON.parse(options?.body || '{}');

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'chatcmpl-test-123',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'OK',
                },
              },
            ],
          };
        },
      };
    };

    const res = await smokeTestLlm({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      apiKey: 'sk-or-valid-key',
      timeoutMs: 3000,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.reply, 'OK');
    assert.equal(res.model, 'deepseek/deepseek-chat');
    assert.ok(res.latencyMs >= 0);
    assert.equal(res.provider, PROVIDER_IDS.OPENROUTER);

    // Valida payload e headers enviados
    assert.equal(receivedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(receivedHeaders.Authorization, 'Bearer sk-or-valid-key');
    assert.equal(receivedHeaders['Content-Type'], 'application/json');
    assert.equal(receivedBody.model, 'deepseek/deepseek-chat');
    assert.equal(receivedBody.messages[0].role, 'user');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com mock de fetch para 401 (INVALID_API_KEY)', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({
          error: {
            message: 'Invalid API key provided: sk-invalid',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
      },
    });

    const res = await smokeTestLlm({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      apiKey: 'sk-invalid',
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.equal(res.code, 'UNAUTHORIZED');
    assert.equal(res.reason, 'unauthorized-key');
    assert.ok(res.advice.includes('Chave de API inválida'));
    assert.ok(res.portalUrl.includes('openrouter.ai/keys'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com mock de fetch para 402 (INSUFFICIENT_CREDITS)', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 402,
      async text() {
        return JSON.stringify({
          error: {
            message: 'Your credit balance is too low to access the OpenRouter API.',
            code: 'insufficient_quota',
          },
        });
      },
    });

    const res = await smokeTestLlm({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      apiKey: 'sk-or-no-credits',
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 402);
    assert.equal(res.code, 'PAYMENT_REQUIRED');
    assert.equal(res.reason, 'insufficient-credits');
    assert.ok(res.advice.includes('Créditos esgotados ou saldo insuficiente'));
    assert.ok(res.portalUrl.includes('openrouter.ai/keys'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com mock de fetch para 429 (RATE_LIMITED)', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      async text() {
        return JSON.stringify({
          error: {
            message: 'Rate limit exceeded: 60 requests per minute allowed.',
            code: 'rate_limit_exceeded',
          },
        });
      },
    });

    const res = await smokeTestLlm({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-ds-key',
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.equal(res.code, 'RATE_LIMIT');
    assert.equal(res.reason, 'rate-limit-exceeded');
    assert.ok(res.advice.includes('Limite de taxa por minuto (RPM)'));
    assert.ok(res.portalUrl.includes('platform.deepseek.com'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com mock de fetch para 404 (MODEL_NOT_FOUND)', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({
          error: {
            message: 'The model `modelo-inexistente` does not exist or you do not have access to it.',
            code: 'model_not_found',
          },
        });
      },
    });

    const res = await smokeTestLlm({
      baseUrl: 'https://api.openai.com/v1',
      model: 'modelo-inexistente',
      apiKey: 'sk-oa-key',
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(res.code, 'NOT_FOUND');
    assert.equal(res.reason, 'model-or-endpoint-not-found');
    assert.ok(res.advice.includes("Modelo 'modelo-inexistente' não encontrado"));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com falha de rede ECONNREFUSED', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      const err = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
      err.code = 'ECONNREFUSED';
      throw err;
    };

    const res = await smokeTestLlm({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, 'CONNECTION_REFUSED');
    assert.equal(res.reason, 'server-offline');
    assert.ok(res.advice.includes('conexão recusada'));
    assert.ok(res.advice.includes('Ollama'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('smokeTestLlm: diagnóstico com timeout (AbortError)', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    };

    const res = await smokeTestLlm({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      timeoutMs: 100,
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, 'TIMEOUT');
    assert.equal(res.reason, 'timeout');
    assert.ok(res.advice.includes('Tempo limite de conexão esgotado'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('classifyLlmError: classificação direta de status codes e mensagens de erro', () => {
  // 401
  const c401 = classifyLlmError({ status: 401, baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(c401.code, 'UNAUTHORIZED');
  assert.equal(c401.reason, 'unauthorized-key');

  // 402 por corpo de mensagem
  const c402 = classifyLlmError({
    status: 400,
    responseBody: '{"error": "credit_balance_too_low"}',
    baseUrl: 'https://openrouter.ai/api/v1',
  });
  assert.equal(c402.code, 'PAYMENT_REQUIRED');
  assert.equal(c402.reason, 'insufficient-credits');

  // 429
  const c429 = classifyLlmError({ status: 429, baseUrl: 'https://api.deepseek.com/v1' });
  assert.equal(c429.code, 'RATE_LIMIT');
  assert.equal(c429.reason, 'rate-limit-exceeded');

  // 404
  const c404 = classifyLlmError({
    status: 404,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-fake',
  });
  assert.equal(c404.code, 'NOT_FOUND');
  assert.equal(c404.reason, 'model-or-endpoint-not-found');

  // 500
  const c500 = classifyLlmError({ status: 500, baseUrl: 'https://api.deepseek.com/v1' });
  assert.equal(c500.code, 'SERVER_ERROR');
  assert.equal(c500.reason, 'provider-server-error');

  // ECONNREFUSED
  const cRefused = classifyLlmError({
    error: { code: 'ECONNREFUSED', message: 'connection refused' },
    baseUrl: 'http://localhost:11434/v1',
  });
  assert.equal(cRefused.code, 'CONNECTION_REFUSED');
  assert.equal(cRefused.reason, 'server-offline');

  // ENOTFOUND
  const cNotFound = classifyLlmError({
    error: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND invalid.host' },
    baseUrl: 'https://invalid.host/v1',
  });
  assert.equal(cNotFound.code, 'DNS_ERROR');
  assert.equal(cNotFound.reason, 'host-not-found');
});

// ============================================================================
// 5. TESTES DE BUILD_FUN_USER_CONFIG (Retrocompatibilidade)
// ============================================================================

test('buildFunUserConfig() mantém total retrocompatibilidade e aplica defaults adequados', () => {
  // 1. Chamada sem parâmetros (padrão absoluto)
  const defaultCfg = buildFunUserConfig();
  assert.equal(defaultCfg.prefix, '/');
  assert.equal(defaultCfg.dashboardEnabled, true);
  assert.equal(defaultCfg.zenEnabled, false);
  assert.equal(defaultCfg.zenBaseUrl, 'http://localhost:20128/v1');
  assert.equal(defaultCfg.zenModel, 'bot-zap');
  assert.equal(defaultCfg.zenApiKey, '');
  assert.equal(defaultCfg.imageGenEnabled, false, 'Modo sem IA deve desligar gerador de imagens');
  assert.equal(defaultCfg.selfHealEnabled, false, 'Modo sem IA deve desligar self heal');
  assert.equal(defaultCfg.personaChemistryEnabled, false);
  assert.deepEqual(defaultCfg.groupWhitelistJids, []);

  // 2. Chamada legada ativando IA e especificando endpoint customizado
  const aiCfg = buildFunUserConfig({
    zenEnabled: true,
    zenBaseUrl: 'https://openrouter.ai/api/v1',
    zenModel: 'deepseek/deepseek-chat',
    zenApiKey: 'sk-or-legado',
    prefix: '!',
    dashboardEnabled: false,
  });

  assert.equal(aiCfg.zenEnabled, true);
  assert.equal(aiCfg.zenBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(aiCfg.zenModel, 'deepseek/deepseek-chat');
  assert.equal(aiCfg.zenApiKey, 'sk-or-legado');
  assert.equal(aiCfg.prefix, '!');
  assert.equal(aiCfg.dashboardEnabled, false);
  assert.equal(aiCfg.imageGenEnabled, true, 'Modo IA ativo deve ligar gerador de imagens');
  assert.equal(aiCfg.selfHealEnabled, true, 'Modo IA ativo deve ligar self heal');
  assert.equal(aiCfg.personaChemistryEnabled, true);
  assert.equal(aiCfg.groupEventsEnabled, true);

  // 3. Chamada com extraOverrides
  const overriddenCfg = buildFunUserConfig({
    zenEnabled: false,
    extraOverrides: {
      customParamA: 42,
      customParamB: 'ativo',
    },
  });
  assert.equal(overriddenCfg.customParamA, 42);
  assert.equal(overriddenCfg.customParamB, 'ativo');

  // 4. Chamada com preset específico (ex: FRIENDS_CHAOS)
  const presetCfg = buildFunUserConfig({
    presetId: FUN_PRESET_IDS.FRIENDS_CHAOS,
    zenEnabled: true,
    zenBaseUrl: 'https://api.deepseek.com/v1',
    zenModel: 'deepseek-chat',
    zenApiKey: 'sk-ds-key',
  });

  assert.equal(presetCfg.preset, FUN_PRESET_IDS.FRIENDS_CHAOS);
  assert.equal(presetCfg.zenEnabled, true);
  assert.equal(presetCfg.zenBaseUrl, 'https://api.deepseek.com/v1');
  assert.equal(presetCfg.zenModel, 'deepseek-chat');
  assert.equal(presetCfg.zenApiKey, 'sk-ds-key');
  assert.equal(presetCfg.qmpEnabled, true, 'Preset amigos/caos ativa QMP');
  assert.equal(presetCfg.chaosEventEnabled, true, 'Preset amigos/caos ativa evento do caos');

  // 5. Preservação de configurações existentes (currentConfig)
  const preservedCfg = buildFunUserConfig({
    currentConfig: {
      botName: 'ZapBot',
      groupWhitelistJids: ['123@g.us', '456@g.us'],
      customAdminList: ['admin1'],
    },
    zenEnabled: true,
  });

  assert.equal(preservedCfg.botName, 'ZapBot');
  assert.deepEqual(preservedCfg.groupWhitelistJids, ['123@g.us', '456@g.us']);
  assert.deepEqual(preservedCfg.customAdminList, ['admin1']);
});
