import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createChaosService } from '../fun/services/chaosService.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createPersonaToolExecutor } from '../fun/services/personaToolExecutor.js';
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

test('persona agent loop chains read tools before producing final reply', async () => {
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
          return call.name === 'group_identity'
            ? { ok: true, text: 'identidade real do grupo consultada', summary: 'identidade real do grupo consultada' }
            : { ok: true, text: 'status real do grupo consultado', summary: 'status real do grupo consultado' };
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
    assert.deepEqual(executions, ['group_identity', 'group_status']);
    assert.equal(calls.length, 3);
    assert.match(sent[0].text, /status real do grupo consultado/);
    assert.match(sent[0].text, /pronto, consultei tudo/);
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

test('persona agent blocks a repeated tool call and returns only confirmed output', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return { ok: true, text: 'identidade confirmada', summary: 'identidade confirmada' };
        },
      },
      generateZen: async () => '{"type":"tool_call","name":"group_identity","arguments":{}}',
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['group_identity']);
    assert.equal(sent[0].text, 'Usou (group_identity) 1 vez');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent does not leak silent tool raw database text or IDs into chat on timeout or loop break', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return {
            ok: true,
            text: 'Fato adicionado à lore do grupo (id: 42-secret-id): "segredo interno"',
            summary: 'Adicionou à lore',
          };
        },
      },
      generateZen: async () => '{"type":"tool_call","name":"lore_add","arguments":{"summary":"segredo interno"}}',
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['lore_add']);
    assert.doesNotMatch(sent[0].text, /42-secret-id/);
    assert.doesNotMatch(sent[0].text, /Fato adicionado à lore/);
    assert.match(sent[0].text, /^Usou \(lore_add\) 1 vez/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent suppresses an unverified action claim after a failed tool', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({ ok: false, reason: 'unavailable', text: 'Não consegui preparar o abraço.', summary: 'Reação indisponível.' }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"reaction","arguments":{"action":"hug","target":"author"}}'
        : '{"type":"reply","text":"pronto, te abracei"}',
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({ ...ctx, text: 'bot me abraça', funConfig: { ...DEFAULT_FUN_CONFIG } });

    assert.equal(result.responded, true);
    assert.equal(sent[0].text, 'Não consegui confirmar essa ação agora.');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent dispatches prepared media once before the verified final claim', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const sent = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          summary: 'Abraço preparado.',
          dispatchActions: [{
            type: 'image_url',
            imageUrl: 'https://media.example/hug.gif',
            mimeType: 'image/gif',
            caption: '*Eu* mandei hug para *você*.',
            claimTokens: ['reaction:hug'],
          }],
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"reaction","arguments":{"action":"hug","target":"author"}}'
        : '{"type":"reply","text":"pronto, te abracei"}',
    });
    const { ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot me abraça',
      funConfig: { ...DEFAULT_FUN_CONFIG },
      replyImageUrl: async (...args) => {
        sent.push({ kind: 'image', args });
        return { key: { id: 'media-1' } };
      },
      sock: {
        ...ctx.sock,
        sendMessage: async (_jid, content) => {
          sent.push({ kind: 'socket', content });
          return { key: { id: `message-${sent.length}` } };
        },
      },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(sent.map((item) => item.kind), ['image', 'socket']);
    assert.match(sent[1].content.text, /te abracei/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent replaces a verified-claim response when media delivery fails', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const sent = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          summary: 'Beijo preparado.',
          dispatchActions: [{
            type: 'image_url',
            imageUrl: 'https://media.example/kiss.gif',
            mimeType: 'image/gif',
            caption: '*Eu* mandei kiss para *você*.',
            claimTokens: ['reaction:kiss'],
          }],
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"reaction","arguments":{"action":"kiss","target":"author"}}'
        : '{"type":"reply","text":"pronto, te beijei"}',
    });
    const { ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot me beija',
      funConfig: { ...DEFAULT_FUN_CONFIG },
      replyImageUrl: async () => { throw new Error('media-down'); },
      sock: {
        ...ctx.sock,
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `message-${sent.length}` } };
        },
      },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(sent.map((message) => message.text), ['Não consegui confirmar essa ação agora.']);
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

test('persona agent: tool lore exibe apenas "Usou (lore) 1 vez" em vez de despejar o texto bruto da lore', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const rawLoreOutput = [
      '🧠 *Lore lembrada*',
      '• [data_do_fato=2026-08-16] Max teve que pedir perdão publicamente por dizer que HxH era ruim.',
      '• [data_do_fato=2026-07-24] Jonas resolveu que Lucas é o maior raparigueiro de São Lourenço.',
    ].join('\n');

    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          text: rawLoreOutput,
          summary: '2 fatos lembrados da lore.',
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"lore","arguments":{"query":"Jonas"}}'
        : '{"type":"reply","text":"mano tu literalmente acabou de falar que vai de Graves KKKKKK"}'
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot quem é o mais louco do grupo?',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.equal(sent.length, 1);
    // NÃO deve conter o texto bruto de lore
    assert.doesNotMatch(sent[0].text, /🧠 \*Lore lembrada\*/);
    assert.doesNotMatch(sent[0].text, /Max teve que pedir perdão/);
    // DEVE começar com "Usou (lore) 1 vez"
    assert.match(sent[0].text, /^Usou \(lore\) 1 vez/);
    // DEVE conter a resposta real da persona
    assert.match(sent[0].text, /mano tu literalmente acabou de falar que vai de Graves KKKKKK/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: múltiplas tools de contexto silenciosas exibem "Usou (lore) 1 vez, (recent_conversation) 1 vez"', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return {
            ok: true,
            text: `resultado bruto da tool ${call.name}`,
            summary: `resumo ${call.name}`,
          };
        },
      },
      generateZen: async () => {
        generations += 1;
        if (generations === 1) return '{"type":"tool_call","name":"lore","arguments":{"query":"fatos"}}';
        if (generations === 2) return '{"type":"tool_call","name":"recent_conversation","arguments":{"query":"conversa"}}';
        return '{"type":"reply","text":"agora sim entendi o contexto todo"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot me explica isso aí',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['lore', 'recent_conversation']);
    assert.equal(sent.length, 1);
    // Deve exibir "Usou (lore) 1 vez, (recent_conversation) 1 vez"
    assert.match(sent[0].text, /^Usou \(lore\) 1 vez, \(recent_conversation\) 1 vez/);
    assert.doesNotMatch(sent[0].text, /resultado bruto/);
    assert.match(sent[0].text, /agora sim entendi o contexto todo/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: tool com full output (oracle) continua exibindo o output completo sem prefixo silencioso', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({
          ok: true,
          text: '🔮 *Oráculo maluco*\nVocê vai encontrar um pastel na esquina.',
          summary: 'Resposta do oráculo.',
        }),
      },
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"oracle","arguments":{"question":"o que vai acontecer?"}}'
        : '{"type":"reply","text":"o oráculo nunca erra kk"}'
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot consulta o oraculo',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.equal(sent.length, 1);
    // DEVE exibir o output completo do oráculo
    assert.match(sent[0].text, /🔮 \*Oráculo maluco\*/);
    assert.match(sent[0].text, /Você vai encontrar um pastel na esquina\./);
    // NÃO deve ter "Usou" pois oracle já é de exibição completa
    assert.doesNotMatch(sent[0].text, /Usou/);
    assert.match(sent[0].text, /o oráculo nunca erra kk/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: combina tool silenciosa e tool com full output', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          if (call.name === 'lore') {
            return {
              ok: true,
              text: '🧠 *Lore lembrada*\n• fato confidencial da lore',
              summary: '1 fato de lore.',
            };
          }
          return {
            ok: true,
            text: '🔮 *Tiragem*\nCarta: O Mago\n✨ *Leitura*\nCaminhos abertos.',
            summary: 'Tiragem de tarô.',
          };
        },
      },
      generateZen: async () => {
        generations += 1;
        if (generations === 1) return '{"type":"tool_call","name":"lore","arguments":{"query":"sorte"}}';
        if (generations === 2) return '{"type":"tool_call","name":"tarot","arguments":{"question":"como vai meu dia?"}}';
        return '{"type":"reply","text":"as cartas não mentem jamais kk"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot tira uma carta lembrando do meu histórico',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.equal(sent.length, 1);
    // Contém o aviso da tool silenciosa com nome
    assert.match(sent[0].text, /Usou \(lore\) 1 vez/);
    // Contém o output completo do tarô
    assert.match(sent[0].text, /🔮 \*Tiragem\*/);
    assert.match(sent[0].text, /Caminhos abertos\./);
    // NÃO vaza o texto bruto da lore
    assert.doesNotMatch(sent[0].text, /fato confidencial da lore/);
    // Contém a fala da persona
    assert.match(sent[0].text, /as cartas não mentem jamais kk/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: tool lore_add exibe apenas "Usou (lore_add) 1 vez" em vez de despejar o texto bruto', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return {
            ok: true,
            text: 'Fato adicionado à lore do grupo (id: 12345): "Lucas esqueceu a pizza no forno"',
            summary: 'Adicionou à lore: "Lucas esqueceu a pizza no forno"',
            data: { id: '12345', summary: 'Lucas esqueceu a pizza no forno' },
          };
        },
      },
      generateZen: async () => {
        generations += 1;
        if (generations === 1) return '{"type":"tool_call","name":"lore_add","arguments":{"summary":"Lucas esqueceu a pizza no forno"}}';
        return '{"type":"reply","text":"já anotei na história do grupo kkkk"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot anota aí que o Lucas esqueceu a pizza no forno',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['lore_add']);
    assert.equal(sent.length, 1);
    // Contém o aviso da tool silenciosa com nome
    assert.match(sent[0].text, /Usou \(lore_add\) 1 vez/);
    // Resposta final da persona
    assert.match(sent[0].text, /já anotei na história do grupo kkkk/);
    // NÃO vaza o dump bruto da tool
    assert.doesNotMatch(sent[0].text, /Fato adicionado à lore do grupo \(id: 12345\)/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: tool lore_remove exibe apenas "Usou (lore_remove) 1 vez" em vez de despejar o texto bruto', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let generations = 0;
    const executions = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executions.push(call.name);
          return {
            ok: true,
            text: 'Removido(s) 1 fato(s) da lore.',
            summary: 'Removeu 1 fato(s) da lore',
          };
        },
      },
      generateZen: async () => {
        generations += 1;
        if (generations === 1) return '{"type":"tool_call","name":"lore_remove","arguments":{"query":"pizza"}}';
        return '{"type":"reply","text":"apagado da memória, nunca aconteceu"}';
      },
    });
    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot apaga a parada da pizza aí',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 3 },
    });

    assert.equal(result.responded, true);
    assert.deepEqual(executions, ['lore_remove']);
    assert.equal(sent.length, 1);
    // Contém o aviso da tool silenciosa com nome
    assert.match(sent[0].text, /Usou \(lore_remove\) 1 vez/);
    // Resposta final da persona
    assert.match(sent[0].text, /apagado da memória, nunca aconteceu/);
    // NÃO vaza o dump bruto da tool
    assert.doesNotMatch(sent[0].text, /Removido\(s\) 1 fato\(s\) da lore\./);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent loop: lore trace visibility expõe IDs e LLM encadeia lore_update por ID', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const calls = [];
    const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
    const groupMemoryService = {
      memoryRepository,
      invalidatePersonaCache: () => {},
    };
    const scopeKey = uniqueGroup();

    // Insere um fato na lore antes
    const initialFact = memoryRepository.insertFact({
      scopeKey,
      summary: 'João perdeu o celular no ônibus ontem à noite',
      kind: 'event',
    });

    const executor = createPersonaToolExecutor({
      chaosService: createChaosService({
        repository: { getLeaderboard: () => [] },
      }),
      memoryRepository,
      groupMemoryService,
    });

    let receivedPrompts = [];
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: executor,
      generateZen: async ({ prompt }) => {
        calls.push('generation');
        receivedPrompts.push(prompt);
        if (calls.length === 1) {
          // Passo 1: LLM busca a lore sobre joao
          return '{"type":"tool_call","name":"lore","arguments":{"query":"joao"}}';
        }
        if (calls.length === 2) {
          // Passo 2: LLM viu o trace contendo o ID e chama lore_update com esse ID
          return JSON.stringify({
            type: 'tool_call',
            name: 'lore_update',
            arguments: {
              id: initialFact.id,
              summary: 'João achou o celular no bolso da calça afinal',
            },
          });
        }
        // Passo 3: resposta final
        return '{"type":"reply","text":"já corrigi a história do João!"}';
      },
    });

    const { sent, ctx } = createPersonaLoopContext(scopeKey);
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, corrige aquela história do João',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaAgentMaxToolCalls: 4 },
    });

    assert.equal(result.responded, true);
    assert.equal(calls.length, 3);

    // No segundo prompt, o trace deve conter o ID do fato e o resumo retornado pela tool lore
    assert.match(receivedPrompts[1], new RegExp(`\\[id: ${initialFact.id}\\]`));
    assert.match(receivedPrompts[1], /João perdeu o celular/);

    // O banco de dados deve ter sido atualizado com o novo resumo
    const updatedFact = memoryRepository.getFact(initialFact.id);
    assert.equal(updatedFact.summary, 'João achou o celular no bolso da calça afinal');

    // Mensagem final enviada
    assert.match(sent[0].text, /já corrigi a história do João!/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent loop: executa rodadas ilimitadas de tools sem ser truncado por teto fixo', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const executed = [];
    let generations = 0;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async (call) => {
          executed.push(`${call.name}-${JSON.stringify(call.arguments || {})}`);
          return { ok: true, text: `resultado de ${call.name}`, summary: `resultado de ${call.name}` };
        },
      },
      generateZen: async () => {
        generations += 1;
        if (generations === 1) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 1"}}';
        if (generations === 2) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 2"}}';
        if (generations === 3) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 3"}}';
        if (generations === 4) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 4"}}';
        if (generations === 5) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 5"}}';
        if (generations === 6) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 6"}}';
        if (generations === 7) return '{"type":"tool_call","name":"lore","arguments":{"query":"termo 7"}}';
        return '{"type":"reply","text":"consultei todas as 7 rodadas e aqui está a resposta final!"}';
      },
    });

    const { sent, ctx } = createPersonaLoopContext(uniqueGroup());
    const result = await persona.tryRespond({
      ...ctx,
      text: 'bot, faz uma pesquisa profunda de lore com 7 termos',
      funConfig: { ...DEFAULT_FUN_CONFIG },
    });

    assert.equal(result.responded, true);
    assert.equal(executed.length, 7);
    assert.equal(generations, 8);
    assert.match(sent[0].text, /consultei todas as 7 rodadas e aqui está a resposta final!/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

