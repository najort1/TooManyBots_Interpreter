/**
 * Extração de content DeepSeek / sanitize de flavor — rejeita rascunho.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractChatText,
  extractJsonBlob,
  extractJsonFromChat,
  looksLikeIncompleteOrMeta,
} from '../fun/llm/openaiClient.js';
import { createFlavorService } from '../fun/llm/flavorService.js';

test('looksLikeIncompleteOrMeta pega rascunhos do DeepSeek', () => {
  assert.equal(looksLikeIncompleteOrMeta('Mas "cair duro" pode ser'), true);
  assert.equal(looksLikeIncompleteOrMeta('Assim, em português'), true);
  assert.equal(looksLikeIncompleteOrMeta('em português'), true);
  assert.equal(looksLikeIncompleteOrMeta('outra ideia'), true);
  assert.equal(
    looksLikeIncompleteOrMeta('A moeda te escolheu hoje. Aproveita antes dela te trair.'),
    false
  );
});

test('extractChatText: content bom vence', () => {
  const t = extractChatText({
    choices: [
      {
        message: {
          content: 'A moeda te deu um chapéu. Clássico nacional.',
          reasoning_content: 'thinking about how to write...',
        },
      },
    ],
  });
  assert.match(t, /chapéu|Clássico/i);
});

test('extractChatText: content lixo + reasoning rascunho → vazio', () => {
  const t = extractChatText({
    choices: [
      {
        message: {
          content: '',
          reasoning_content: [
            'The user won the coin flip.',
            'I need a funny line.',
            'Mas "cair duro" pode ser',
          ].join('\n'),
        },
      },
    ],
  });
  assert.equal(t, '');
});

test('extractChatText: reasoning com frase final boa', () => {
  const t = extractChatText({
    choices: [
      {
        message: {
          content: 'Assim, em português',
          reasoning_content: [
            'thinking...',
            'Resposta: A moeda te escolheu hoje. Aproveita antes dela te trair de novo.',
          ].join('\n'),
        },
      },
    ],
  });
  assert.match(t, /moeda te escolheu|Aproveita/i);
});

test('extractJsonBlob / invent: JSON no reasoning do DeepSeek thinking', () => {
  const blob = extractJsonBlob(
    'thinking about market...\nfinal: {"archetype":"scandal","category":"tech","companyId":"bombatech","title":"BombaTech explode","body":"ação sobe"}'
  );
  assert.match(blob, /BombaTech explode/);
  const t = extractChatText({
    choices: [
      {
        message: {
          content: '',
          reasoning_content:
            'raciocínio longo...\n{"archetype":"scandal","category":"tech","companyId":"bombatech","title":"BombaTech explode","body":"ação sobe"}',
        },
      },
    ],
  });
  assert.match(t, /"title"\s*:\s*"BombaTech explode"/);
});

test('extractChatText: content inglês lixo não bloqueia JSON no reasoning', () => {
  const t = extractChatText({
    choices: [
      {
        message: {
          content: 'exactly as listed? The list shows',
          reasoning_content:
            'We need to generate JSON.\n{"archetype":"demand_slump","category":"arma","companyId":"bombatech","title":"Blitze esfria o aço","body":"Centro lotado de blitze e ninguém compra peixeira hoje."}',
        },
      },
    ],
  });
  assert.match(t, /Blitze esfria o aço/);
  assert.equal(looksLikeIncompleteOrMeta('exactly as listed? The list shows'), true);
});

test('extractJsonFromChat: content vazio + eco no reasoning → vazio (sem prosa)', () => {
  const t = extractJsonFromChat({
    choices: [
      {
        message: {
          content: '',
          reasoning_content:
            'category uma das: combustivel, municao, arma, veiculo, defesa — e coerente com a empresa. Peixaria is odd.',
        },
      },
    ],
  });
  assert.equal(t, '');
  assert.equal(looksLikeIncompleteOrMeta('itself? Actually'), true);
  assert.equal(
    looksLikeIncompleteOrMeta(
      'category uma das: combustivel, municao, arma — e coerente com a empresa'
    ),
    true
  );
});

test('looksLikeIncompleteOrMeta rejeita eco de lista de cenários (illuminati bug)', () => {
  const leak =
    'Cenários: cancelamento absurdo, fofoca falsa, oráculo insano, conspiração illuminati, roleta russa virtual.';
  assert.equal(looksLikeIncompleteOrMeta(leak), true);
  assert.equal(looksLikeIncompleteOrMeta('2–4 frases COMPLETAS'), true);
});

test('chaosLine: eco de system prompt → template illuminati real', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const flavor = createFlavorService({
      getConfig: () => ({
        zenEnabled: true,
        ollamaEnabled: false,
        chaosTimeoutMs: 5_000,
        flavorTimeoutMs: 5_000,
      }),
      zenGenerate: async () =>
        'Cenários: cancelamento absurdo, fofoca falsa, oráculo insano, conspiração illuminati, roleta russa virtual.',
      generate: async () => {
        throw new Error('no-ollama');
      },
      allowLiveLlm: true,
    });
    const text = await flavor.chaosLine('illuminati_theory', { user: 'Eduardo' });
    assert.ok(text.length > 30);
    assert.ok(!/cen[aá]rios?\s*:/i.test(text));
    assert.ok(!/cancelamento absurdo.*fofoca/i.test(text));
    assert.match(text, /Eduardo|pão|Wi-Fi|conspir|indícios|controla|dossiê|pombos/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('flavor sanitize rejeita rascunho e usa template no cascade', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const flavor = createFlavorService({
      getConfig: () => ({
        zenEnabled: true,
        ollamaEnabled: false,
        flavorTimeoutMs: 5_000,
        zenMaxTokens: 700,
      }),
      zenGenerate: async () => 'Mas "cair duro" pode ser',
      generate: async () => {
        throw new Error('no-ollama');
      },
      allowLiveLlm: true,
    });
    const text = await flavor.line('flip_win', { pick: 'cara', side: 'cara' });
    // template fallback — frase completa de flip_win
    assert.ok(text.length > 20);
    assert.ok(!/pode ser$|em português/i.test(text));
    assert.ok(
      /moeda|lado|sorte|skill|escolheu|Acertou|Vitória|base/i.test(text),
      `template esperado, got: ${text}`
    );
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});
