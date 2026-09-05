import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';

await initDb();

function uniqueGroup() {
  return `loop-${Date.now()}-${Math.floor(Math.random() * 1e6)}@g.us`;
}

function createPersonaLoopContext(scopeKey) {
  const sent = [];
  return {
    sent,
    ctx: {
      scopeKey,
      authorJid: '5511999999999@s.whatsapp.net',
      text: 'bot, me atualiza',
      messageType: 'text',
      sock: {
        user: { id: '5511888888888:0@s.whatsapp.net' },
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `loop-${sent.length}` } };
        },
      },
      identityMap: createIdentityMap(),
      now: 1_000_000,
    },
  };
}

test('persona agent loop can chain read tools before producing final reply', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const calls = [];
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return { ok: true, text: 'identidade real do grupo consultada', summary: 'identidade real do grupo consultada' };
        },
      },
      generateZen: async () => {
        calls.push('generation');
        if (calls.length === 1) return '{"type":"tool_call","name":"group_identity","arguments":{}}';
        if (calls.length === 2) return '{"type":"tool_call","name":"group_status","arguments":{}}';
        return '{"type":"reply","text":"pronto, consultei tudo"}';
      },
    });
    const sent = [];
    const result = await persona.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '5511999999999@s.whatsapp.net',
      text: 'bot, me atualiza',
      messageType: 'text',
      sock: {
        user: { id: '5511888888888:0@s.whatsapp.net' },
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `loop-${sent.length}` } };
        },
      },
      identityMap: createIdentityMap(),
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 4 },
      now: 1_000_000,
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['group_identity']);
    assert.equal(calls.length, 2);
    assert.equal(sent[0].text, 'identidade real do grupo consultada');
    assert.doesNotMatch(sent[0].text, /group_status/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent executes group status to demonstrate a tool safely', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const calls = [];
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return { ok: true, text: 'status real da ferramenta', summary: 'status real da ferramenta' };
        },
      },
      generateZen: async () => {
        calls.push('generation');
        return calls.length === 1
          ? '{"type":"tool_call","name":"group_status","arguments":{}}'
          : '{"type":"reply","text":"aí, consultei de verdade"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, usa uma tool call e vamos verificar se seu sistema funciona',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['group_status']);
    assert.equal(calls.length, 2);
    assert.match(sent[0].text, /status real da ferramenta/);
    assert.match(sent[0].text, /consultei de verdade/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent sends a copied tool result only once', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const sent = [];
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          text: 'fofoca real sobre o wi-fi do shopping',
          summary: 'fofoca real sobre o wi-fi do shopping',
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"gossip","arguments":{"target":"author"}}'
        : JSON.stringify({
            type: 'actions',
            actions: [
              { type: 'text', text: 'fofoca real sobre o wi-fi do shopping' },
              { type: 'text', text: 'agora aguenta essa kk' },
            ],
          }),
    });
    const { ctx } = createPersonaLoopContext(uniqueGroup());
    const response = await persona.tryRespond({
      ...ctx,
      text: 'bot, usa o gossip em mim',
      funConfig: { ...DEFAULT_FUN_CONFIG },
      sock: {
        ...ctx.sock,
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `duplicate-${sent.length}` } };
        },
      },
    });

    assert.equal(response.responded, true);
    assert.deepEqual(sent.map((message) => message.text), [
      'fofoca real sobre o wi-fi do shopping',
      'agora aguenta essa kk',
    ]);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent strips echoed tool result prefix and normalizes quotes', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const sent = [];
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          text: '👁️ Illuminati Teoria da semana: Eduardo esconde a fórmula do café perfeito e libera só em reuniões chatas. Teoria aleatória. Nenhuma prova.',
          summary: 'Teoria da semana',
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"illuminati","arguments":{"target":"author"}}'
        : JSON.stringify({
            type: 'reply',
            text: '👁️ Illuminati Teoria da semana: Eduardo esconde a fórmula do café perfeito e libera só em reuniões chatas. Teoria aleatória. Nenhuma prova. aê, funcionou! kk você guardando a fórmula do café perfeito pra si, gente boa',
          }),
    });
    const { ctx } = createPersonaLoopContext(uniqueGroup());
    const response = await persona.tryRespond({
      ...ctx,
      text: 'bot, tenta usar o iluminatti',
      funConfig: { ...DEFAULT_FUN_CONFIG },
      sock: {
        ...ctx.sock,
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `echo-${sent.length}` } };
        },
      },
    });

    assert.equal(response.responded, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /aê, funcionou!/);
    const count = (sent[0].text.match(/Teoria da semana/g) || []).length;
    assert.equal(count, 1, 'Não pode repetir o texto da tool no mesmo balão');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent validates a continued gossip request against recent context', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call, context) => {
          executions.push({ name: call.name, toolContextText: context.toolContextText });
          return { ok: true, text: 'fofoca real da ferramenta', summary: 'fofoca real da ferramenta' };
        },
      },
      generateZen: async () =>
        '{"type":"tool_call","name":"gossip","arguments":{"target":"author"}}',
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, tenta uma última vez',
      responseContextPack: {
        immediateContext: [{ text: 'usa o gossip em mim de novo' }],
      },
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions.map((execution) => execution.name), ['gossip']);
    assert.match(executions[0].toolContextText, /gossip/i);
    assert.equal(sent[0].text, 'fofoca real da ferramenta');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent loop keeps follow-up after a slow tool within its deadline', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let clockNow = 0;
    const calls = [];
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      clock: () => clockNow,
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          clockNow += 26_000;
          return { ok: true, text: 'tarot result', summary: 'tarot result' };
        },
      },
      generateZen: async () => {
        calls.push('generation');
        return calls.length === 1
          ? '{"type":"tool_call","name":"tarot","arguments":{"question":"vai dar certo?"}}'
          : '{"type":"reply","text":"a leitura foi essa"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, faz uma tiragem de tarot?',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['tarot']);
    assert.equal(calls.length, 2);
    assert.match(sent[0].text, /tarot result/);
    assert.match(sent[0].text, /a leitura foi essa/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent loop sends completed tool result when its deadline expires', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let clockNow = 0;
    const calls = [];
    const executions = [];
    const scopeKey = uniqueGroup();
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      clock: () => clockNow,
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          clockNow += 6_000;
          return {
            ok: true,
            text: 'a tiragem saiu muito positiva',
            summary: 'a tiragem saiu muito positiva',
          };
        },
      },
      generateZen: async () => {
        calls.push('generation');
        return '{"type":"tool_call","name":"tarot","arguments":{"question":"vai dar certo?"}}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(scopeKey);
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, faz uma tiragem de tarot?',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentDeadlineMs: 5_000 },
    });

    assert.equal(result.responded, true);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(executions, ['tarot']);
    assert.equal(calls.length, 1);
    assert.equal(sent[0].text, 'a tiragem saiu muito positiva');
    assert.equal(persona._inFlightScopes.has(scopeKey), false);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent loop does not prefix raw tool error message when llm comments failure', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: false,
          reason: 'cooldown',
          text: 'Vou segurar a onda por mais 29s.',
          summary: 'Vou segurar a onda por mais 29s.',
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"reaction","arguments":{"action":"hug"}}'
        : '{"type":"reply","text":"calma aí, tô segurando a onda mais uns segundos kk o abraço vem"}',
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, você não usou a tool',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'calma aí, tô segurando a onda mais uns segundos kk o abraço vem');
    assert.doesNotMatch(sent[0].text, /Vou segurar a onda por mais 29s\./);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

