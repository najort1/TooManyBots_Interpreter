import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { openaiChatComplete } from '../fun/llm/openaiClient.js';
import { ollamaGenerate } from '../fun/llm/ollamaClient.js';
import {
  isLlmDebugActive,
  logLlmCallStart,
  logLlmCallSuccess,
  logLlmCallError,
  clearLlmDebugConfigCache,
} from '../fun/llm/llmLogger.js';

test('isLlmDebugActive: respeita flag explícita debugMode/debug nos options', () => {
  assert.equal(isLlmDebugActive({ debugMode: true }), true);
  assert.equal(isLlmDebugActive({ debugMode: false }), false);
  assert.equal(isLlmDebugActive({ debug: true }), true);
  assert.equal(isLlmDebugActive({ debug: false }), false);
  assert.equal(isLlmDebugActive({ config: { debugMode: true } }), true);
  assert.equal(isLlmDebugActive({ config: { debugMode: false } }), false);
});

test('openaiChatComplete: emite log de início e sucesso quando debugMode está ativo', async () => {
  const logs = [];
  const logFn = (line, meta) => logs.push({ line, meta });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Resposta simulada da IA.' } }],
    }),
  });

  const out = await openaiChatComplete({
    model: 'model-teste-debug',
    prompt: 'Qual a capital do Brasil?',
    debugMode: true,
    logFn,
    fetchImpl,
  });

  assert.equal(out, 'Resposta simulada da IA.');
  assert.equal(logs.length, 2, 'deve emitir exatamente 2 logs (início e sucesso)');

  const [startLog, successLog] = logs;
  assert.equal(startLog.meta.type, 'start');
  assert.match(startLog.line, /\[LLM:DEBUG\] \[openai\] Chamada iniciada/);
  assert.match(startLog.line, /model: model-teste-debug/);
  assert.match(startLog.line, /Qual a capital do Brasil\?/);

  assert.equal(successLog.meta.type, 'success');
  assert.match(successLog.line, /\[LLM:DEBUG\] \[openai\] Resposta recebida/);
  assert.match(successLog.line, /status: 200/);
  assert.match(successLog.line, /Resposta simulada da IA\./);
  assert.ok(typeof successLog.meta.durationMs === 'number');
});

test('openaiChatComplete: emite log de erro com duração e motivo quando falha e debugMode está ativo', async () => {
  const logs = [];
  const logFn = (line, meta) => logs.push({ line, meta });

  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });

  await assert.rejects(
    async () => {
      await openaiChatComplete({
        model: 'model-fail',
        prompt: 'Gerar algo',
        debugMode: true,
        logFn,
        fetchImpl,
      });
    },
    /openai-http-500/
  );

  assert.equal(logs.length, 2, 'deve emitir log de início e log de falha');
  const [startLog, errorLog] = logs;
  assert.equal(startLog.meta.type, 'start');
  assert.equal(errorLog.meta.type, 'error');
  assert.match(errorLog.line, /\[LLM:DEBUG\] \[openai\] Falha na chamada/);
  assert.match(errorLog.line, /openai-http-500/);
  assert.ok(typeof errorLog.meta.durationMs === 'number');
});

test('openaiChatComplete: NÃO emite nenhum log quando debugMode está inativo', async () => {
  const logs = [];
  const logFn = (line, meta) => logs.push({ line, meta });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Sem log' } }],
    }),
  });

  await openaiChatComplete({
    model: 'model-quiet',
    prompt: 'Silencioso',
    debugMode: false,
    logFn,
    fetchImpl,
  });

  assert.equal(logs.length, 0, 'não deve emitir logs quando debugMode é false');
});

test('openaiChatComplete: NUNCA expõe apiKey ou Authorization nos logs de debug', async () => {
  const logs = [];
  const logFn = (line) => logs.push(line);

  const secretApiKey = 'sk-secret-token-super-confidential-12345';
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Ok seguro' } }],
    }),
  });

  await openaiChatComplete({
    model: 'model-secure',
    prompt: 'Verificar segurança',
    apiKey: secretApiKey,
    debugMode: true,
    logFn,
    fetchImpl,
  });

  for (const line of logs) {
    assert.equal(line.includes(secretApiKey), false, 'log não pode conter apiKey secreta');
    assert.equal(line.includes('Bearer'), false, 'log não pode conter header Bearer');
  }
});

test('ollamaGenerate: emite log de início e sucesso quando debugMode está ativo', async () => {
  const logs = [];
  const logFn = (line, meta) => logs.push({ line, meta });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      response: 'Resposta do Ollama local.',
    }),
  });

  const out = await ollamaGenerate({
    model: 'gemma4:test',
    prompt: 'Olá Ollama',
    debugMode: true,
    logFn,
    fetchImpl,
    serialize: false,
  });

  assert.equal(out, 'Resposta do Ollama local.');
  assert.equal(logs.length, 2, 'deve emitir 2 logs no Ollama');
  assert.match(logs[0].line, /\[LLM:DEBUG\] \[ollama\] Chamada iniciada/);
  assert.match(logs[0].line, /gemma4:test/);
  assert.match(logs[1].line, /\[LLM:DEBUG\] \[ollama\] Resposta recebida/);
  assert.match(logs[1].line, /Resposta do Ollama local\./);
});

test('ollamaGenerate: NÃO emite nenhum log quando debugMode está inativo', async () => {
  const logs = [];
  const logFn = (line, meta) => logs.push({ line, meta });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      response: 'Silêncio',
    }),
  });

  await ollamaGenerate({
    model: 'gemma4:test',
    prompt: 'Quiet',
    debugMode: false,
    logFn,
    fetchImpl,
    serialize: false,
  });

  assert.equal(logs.length, 0);
});

test('isLlmDebugActive: detecta debug ativo via arquivo config.user.json temporário', () => {
  clearLlmDebugConfigCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-dbg-test-'));
  const tmpConfigFile = path.join(tmpDir, 'config.user.json');

  try {
    fs.writeFileSync(tmpConfigFile, JSON.stringify({ debugMode: true }), 'utf-8');
    assert.equal(isLlmDebugActive({ configPath: tmpConfigFile }), true);

    fs.writeFileSync(tmpConfigFile, JSON.stringify({ debugMode: false }), 'utf-8');
    clearLlmDebugConfigCache();
    assert.equal(isLlmDebugActive({ configPath: tmpConfigFile }), false);

    fs.writeFileSync(tmpConfigFile, JSON.stringify({ logLevel: 'debug' }), 'utf-8');
    clearLlmDebugConfigCache();
    assert.equal(isLlmDebugActive({ configPath: tmpConfigFile }), true);

    fs.writeFileSync(tmpConfigFile, JSON.stringify({ debug: true }), 'utf-8');
    clearLlmDebugConfigCache();
    assert.equal(isLlmDebugActive({ configPath: tmpConfigFile }), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearLlmDebugConfigCache();
  }
});
