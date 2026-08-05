import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';
import { createDailyChallengeService } from '../fun/services/dailyChallengeService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function createService({ config = {}, generateZen, groupMemoryService = null, random = () => 0 } = {}) {
  const repository = createFunDailyChallengeRepository({ getDatabase: getDb });
  const service = createDailyChallengeService({
    repository,
    generateZen,
    groupMemoryService,
    random,
    getConfig: () => ({
      ...DEFAULT_FUN_CONFIG,
      dailyChallengePokemonMaxGen: 25,
      ...config,
    }),
    getLogger: () => null,
  });
  return { service, repository };
}

test('dailyGuess usa task dedicada, anti-variedade e lore do grupo', async () => {
  const calls = [];
  const { service, repository } = createService({
    config: {
      zenDailyGuessTemperature: 0.61,
      zenDailyGuessMaxTokens: 444,
      zenDailyGuessTimeoutMs: 46_000,
    },
    generateZen: async (input) => {
      calls.push(input);
      return JSON.stringify({
        game: 'Celeste',
        aliases: ['celeste'],
        hints: ['Uma escalada muda tudo.', 'A montanha cobra precisão.', 'Madeline sobe um pico gelado.'],
      });
    },
    groupMemoryService: {
      buildLoreContext: () => '<group_lore>o grupo curte jogo retrô</group_lore>',
    },
  });
  const scope = uniqueGroup();
  repository.recordContent(scope, 'game', 'Need for Speed');

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'guess_game',
    now: Date.now(),
    sendText: async () => ({}),
  });

  assert.equal(launched.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxTokens, 444);
  assert.equal(calls[0].temperature, 0.61);
  assert.equal(calls[0].timeoutMs, 46_000);
  assert.equal(calls[0].jsonMode, true);
  assert.equal(calls[0].jsonOnly, true);
  assert.match(calls[0].system, /corrida/i);
  assert.match(calls[0].prompt, /grupo curte jogo retrô/i);
});

test('Pokemon busca metadados reais, os persiste e usa dailyHint', async () => {
  const previousFetch = global.fetch;
  try {
    const calls = [];
    global.fetch = async (url) => {
      const target = String(url);
      if (/sprites\/pokemon\/25\.png/.test(target)) {
        return { ok: true, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
      }
      if (/pokemon-species\/25/.test(target)) {
        return {
          ok: true,
          async json() {
            return {
              generation: { name: 'generation-i' },
              habitat: { name: 'forest' },
              color: { name: 'yellow' },
            };
          },
        };
      }
      if (/api\/v2\/pokemon\/25/.test(target)) {
        return {
          ok: true,
          async json() {
            return {
              name: 'pikachu',
              types: [{ slot: 1, type: { name: 'electric' } }],
              species: { url: 'https://pokeapi.co/api/v2/pokemon-species/25/' },
            };
          },
        };
      }
      throw new Error(`URL inesperada: ${target}`);
    };

    const { service, repository } = createService({
      config: {
        zenDailyHintTemperature: 0.71,
        zenDailyHintMaxTokens: 222,
        zenDailyHintTimeoutMs: 31_000,
      },
      generateZen: async (input) => {
        calls.push(input);
        return 'Uma faísca costuma anunciar sua chegada.';
      },
      random: () => 0.96,
    });
    const scope = uniqueGroup();
    const now = Date.now();
    const launched = await service.launchChallenge({
      scopeKey: scope,
      type: 'pokemon',
      now,
      sendText: async () => ({}),
      sendImage: null,
      sharp: null,
    });

    assert.equal(launched.ok, true);
    const active = repository.getActiveChallenge(scope);
    assert.deepEqual(active.challengeData.types, ['elétrico']);
    assert.equal(active.challengeData.generation, 'Geração I');
    assert.equal(active.challengeData.habitat, 'floresta');
    assert.equal(active.challengeData.color, 'amarelo');

    const hint = await service.handleHint({ scopeKey: scope, now: now + 1_000 });
    assert.equal(hint.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].maxTokens, 222);
    assert.equal(calls[0].temperature, 0.71);
    assert.equal(calls[0].timeoutMs, 31_000);
    assert.match(calls[0].prompt, /Tipos reais: elétrico/);
    assert.match(calls[0].prompt, /Geração: Geração I/);
    assert.match(calls[0].prompt, /Habitat: floresta/);
    assert.match(calls[0].prompt, /Cor registrada: amarelo/);
  } finally {
    global.fetch = previousFetch;
  }
});
