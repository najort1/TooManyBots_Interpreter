import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUN_PRESET_IDS,
  FUN_PRESETS,
  getFunPreset,
  listFunPresets,
  getPresetInquirerChoices,
  applyFunPreset,
} from '../fun/presets.js';
import { buildFunUserConfig } from '../fun/scripts/setupWizard.js';
import { normalizeFunConfig } from '../fun/config.js';

test('listFunPresets retorna todos os 6 presets esperados', () => {
  const presets = listFunPresets();
  assert.equal(presets.length, 6);

  const ids = presets.map((p) => p.id);
  assert.deepEqual(ids, [
    FUN_PRESET_IDS.FRIENDS_CHAOS,
    FUN_PRESET_IDS.RPG_ECONOMY,
    FUN_PRESET_IDS.COMMUNITY_QUIET,
    FUN_PRESET_IDS.OFFLINE_ESSENTIAL,
    FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER,
    FUN_PRESET_IDS.CUSTOM,
  ]);
});

test('cada preset possui metadados completos e válidos', () => {
  const presets = listFunPresets();
  for (const preset of presets) {
    assert.ok(preset.id, 'id obrigatório');
    assert.ok(preset.name, 'name obrigatório');
    assert.ok(preset.shortName, 'shortName obrigatório');
    assert.ok(preset.description, 'description obrigatória');
    assert.ok(Array.isArray(preset.highlights), 'highlights deve ser array');
    assert.ok(preset.highlights.length > 0, 'highlights não pode ser vazio');
    assert.equal(typeof preset.requiresAi, 'boolean');
    assert.ok(['ai', 'economic'].includes(preset.defaultAiMode));
    assert.equal(typeof preset.configOverrides, 'object');
  }
});

test('getFunPreset retorna o preset correto e lança para id desconhecido', () => {
  const chaos = getFunPreset(FUN_PRESET_IDS.FRIENDS_CHAOS);
  assert.equal(chaos.id, FUN_PRESET_IDS.FRIENDS_CHAOS);

  assert.throws(() => {
    getFunPreset('preset_inexistente');
  }, /Preset desconhecido/);
});

test('getPresetInquirerChoices formata opções legíveis com nome e descrição', () => {
  const choices = getPresetInquirerChoices();
  assert.equal(choices.length, 6);
  assert.ok(choices[0].name.includes('Grupo de Amigos & Zoeira'));
  assert.equal(choices[0].value, FUN_PRESET_IDS.FRIENDS_CHAOS);
  assert.equal(choices[0].short, 'Zoeira & Amigos');
});

test('applyFunPreset (friends_chaos) calibra para dinamismo e zoeira social', () => {
  const config = applyFunPreset({
    presetId: FUN_PRESET_IDS.FRIENDS_CHAOS,
    zenEnabled: true,
    prefix: '!',
  });

  assert.equal(config.preset, FUN_PRESET_IDS.FRIENDS_CHAOS);
  assert.equal(config.prefix, '!');
  assert.equal(config.cooldownMs, 25_000);
  assert.equal(config.replyCommandsInPrivate, false);
  assert.equal(config.qmpEnabled, true);
  assert.equal(config.qmpAutoTriggerChance, 0.04);
  assert.equal(config.roastEnabled, true);
  assert.equal(config.chaosEventEnabled, true);
  assert.deepEqual(config.personaAutonomyAllowedActions, ['react', 'sticker', 'comment']);
});

test('applyFunPreset (rpg_economy) calibra para competitividade e cassino', () => {
  const config = applyFunPreset({
    presetId: FUN_PRESET_IDS.RPG_ECONOMY,
    zenEnabled: true,
  });

  assert.equal(config.preset, FUN_PRESET_IDS.RPG_ECONOMY);
  assert.equal(config.cooldownMs, 40_000);
  assert.equal(config.cardsEnabled, true);
  assert.equal(config.rankCardImage, true);
  assert.equal(config.rankLimit, 15);
  assert.equal(config.bolsaEnabled, true);
  assert.equal(config.heistShopBaseChance, 0.52);
  assert.equal(config.heistBankBaseChance, 0.36);
});

test('applyFunPreset (community_quiet) calibra para moderação e anti-spam', () => {
  const config = applyFunPreset({
    presetId: FUN_PRESET_IDS.COMMUNITY_QUIET,
    zenEnabled: true,
  });

  assert.equal(config.preset, FUN_PRESET_IDS.COMMUNITY_QUIET);
  assert.equal(config.cooldownMs, 90_000);
  assert.equal(config.announceLevelUp, false);
  assert.equal(config.chaosEventEnabled, false);
  assert.equal(config.roastEnabled, false);
  // Persona sutil: apenas reações de emoji
  assert.deepEqual(config.personaAutonomyAllowedActions, ['react']);
  assert.equal(config.personaAutonomyMaxPerHour, 1);
});

test('applyFunPreset (offline_essential) garante IA 100% desligada', () => {
  const config = applyFunPreset({
    presetId: FUN_PRESET_IDS.OFFLINE_ESSENTIAL,
    zenEnabled: true, // Tenta forçar ligar, mas o preset offline garante que fica falso
  });

  assert.equal(config.preset, FUN_PRESET_IDS.OFFLINE_ESSENTIAL);
  assert.equal(config.zenEnabled, false);
  assert.equal(config.imageGenEnabled, false);
  assert.equal(config.selfHealEnabled, false);
  assert.equal(config.personaSocialHintsEnabled, false);
  assert.equal(config.groupEventsEnabled, false);
});

test('applyFunPreset (full_ai_living_member) garante IA ativa', () => {
  const config = applyFunPreset({
    presetId: FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER,
    zenBaseUrl: 'http://localhost:20128/v1',
    zenModel: 'bot-zap',
  });

  assert.equal(config.preset, FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER);
  assert.equal(config.zenEnabled, true);
  assert.equal(config.imageGenEnabled, true);
  assert.equal(config.memoryEnabled, true);
  assert.equal(config.groupNewsAudioEnabled, true);
});

test('buildFunUserConfig integra com presets e preserva retrocompatibilidade', () => {
  // Com preset explícito
  const presetConfig = buildFunUserConfig({
    presetId: FUN_PRESET_IDS.FRIENDS_CHAOS,
    zenEnabled: true,
    prefix: '$',
  });
  assert.equal(presetConfig.preset, FUN_PRESET_IDS.FRIENDS_CHAOS);
  assert.equal(presetConfig.prefix, '$');
  assert.equal(presetConfig.cooldownMs, 25_000);

  // Chamada legada sem presetId (Modo Econômico)
  const legacyEconomic = buildFunUserConfig({
    zenEnabled: false,
    prefix: '/',
  });
  assert.equal(legacyEconomic.zenEnabled, false);
  assert.equal(legacyEconomic.imageGenEnabled, false);

  // Chamada legada sem presetId (Modo IA)
  const legacyAi = buildFunUserConfig({
    currentConfig: legacyEconomic,
    zenEnabled: true,
    prefix: '/',
  });
  assert.equal(legacyAi.zenEnabled, true);
  assert.equal(legacyAi.imageGenEnabled, true);
});

test('normalizeFunConfig preserva a propriedade preset', () => {
  const normalized = normalizeFunConfig({
    preset: 'friends_chaos',
    prefix: '/',
  });
  assert.equal(normalized.preset, 'friends_chaos');
});
