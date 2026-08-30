import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPromptText,
  buildTemporalBlock,
  buildToneBlock,
  buildPersonaSystemPrompt,
  buildPersonaUserPrompt,
  buildSocialHintBlock,
  memorySignalText,
} from '../fun/services/personaPromptBuilder.js';
import {
  detectTrigger,
  normalizeJid,
  resolveJid,
  collectBotJids,
  isThreadContinuation,
} from '../fun/services/personaTriggerDetector.js';
import {
  extractTokens,
  extractEmojis,
  normalizeToken,
  toneScore,
  isNoiseToneLine,
  pickToneSamples,
  deriveGroupStyle,
} from '../fun/services/personaStyleDeriver.js';

test('[personaPromptBuilder] buildPersonaSystemPrompt monta prompt com primeira pessoa e diretrizes de humor', () => {
  const prompt = buildPersonaSystemPrompt({
    styleBlock: 'Vocabulário frequente: mano, zoeira.',
    threadContext: [{ role: 'membro', name: 'Lucas', text: 'e aí bot' }],
    maxChars: 280,
    contextTurns: 4,
  });

  assert.match(prompt, /Você é um membro comum de um grupo de WhatsApp/i);
  assert.match(prompt, /Fale SEMPRE em primeira pessoa/i);
  assert.match(prompt, /Vocabulário frequente: mano, zoeira/);
  assert.match(prompt, /Lucas: "e aí bot"/);
});

test('[personaPromptBuilder] buildTemporalBlock retorna horário e dia formatados sem erro', () => {
  const block = buildTemporalBlock(Date.now(), 'America/Sao_Paulo');
  assert.ok(block.length > 0);
  assert.match(block, /Agora é/i);
});

test('[personaPromptBuilder] buildSocialHintBlock organiza pistas por tipo de sinal', () => {
  const hints = [
    { confidence: 80, socialSignal: 'positive', hintText: 'gosta de zoeira com futebol', updatedAt: 100 },
    { confidence: 70, socialSignal: 'negative', hintText: 'não gosta de piadas sobre carro', updatedAt: 200 },
    { confidence: 30, socialSignal: 'positive', hintText: 'confiança baixa descartada', updatedAt: 300 },
  ];
  const block = buildSocialHintBlock(hints, 50);
  assert.match(block, /positive · confiança 80/);
  assert.match(block, /negative · confiança 70/);
  assert.doesNotMatch(block, /confiança baixa descartada/);
});

test('[personaTriggerDetector] detectTrigger detecta vocativo, apelidos customizados e menções', () => {
  // Vocativo no início com saudações comuns
  assert.equal(detectTrigger({ text: 'bot tudo bem?' }).mention, true);
  assert.equal(detectTrigger({ text: 'ei bot me ajuda' }).mention, true);
  assert.equal(detectTrigger({ text: 'Eae bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'eae, bot como tá?' }).mention, true);
  assert.equal(detectTrigger({ text: 'E aí bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'fala bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'fala aí bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'salve bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'opa bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'oi bot' }).mention, true);
  assert.equal(detectTrigger({ text: 'coé bot' }).mention, true);

  // Palavras que começam com bot mas não são o bot
  assert.equal(detectTrigger({ text: 'botão grande' }).mention, false);
  assert.equal(detectTrigger({ text: 'botox' }).mention, false);
  assert.equal(detectTrigger({ text: 'bota isso ali' }).mention, false);

  // Referências em 3ª pessoa continuam falsas para evitar falso positivo
  assert.equal(detectTrigger({ text: 'esse bot travou' }).mention, false);
  assert.equal(detectTrigger({ text: 'o bot respondeu' }).mention, false);

  // Apelidos customizados
  assert.equal(detectTrigger({ text: 'fala zezinho show', customAliases: ['zezinho'] }).mention, true);
  assert.equal(detectTrigger({ text: 'olha o jarvis aí', customAliases: ['jarvis'] }).mention, true);

  // Menção no meio se permitida
  assert.equal(detectTrigger({ text: 'qual é a boa, bot?', allowNaturalMentions: true }).mention, true);
  assert.equal(detectTrigger({ text: 'qual é a boa, bot?', allowNaturalMentions: false }).mention, false);

  // @Menção
  assert.equal(detectTrigger({ mentionedJids: ['5511999990000@s.whatsapp.net'], botJid: '5511999990000@s.whatsapp.net' }).atMention, true);
});

test('[personaStyleDeriver] deriveGroupStyle calcula tokens e média de tamanho com decaimento', () => {
  const msgs = [
    { text: 'mano do céu kkkk', userJid: 'user1' },
    { text: 'mano muito bom isso kkkk', userJid: 'user2' },
    { text: 'mano que zoeira 😂', userJid: 'user3' },
  ];
  const result = deriveGroupStyle({
    msgs,
    prevCounts: new Map(),
    prevAvgLen: 0,
    dtMs: 0,
    halfLifeMs: 86400000,
    topTokensCap: 10,
  });

  assert.ok(result.topTokens.includes('mano'));
  assert.ok(result.emojis.some((e) => e.emoji === '😂'));
  assert.ok(result.avgLen > 10);
});
