import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpandedPromptContext } from '../fun/services/extractionAdapters/promptContextBuilder.js';

test('promptContextBuilder: constrói bloco completo com perfil, clima, tópicos e fatos sem limites artificiais', () => {
  const context = buildExpandedPromptContext({
    scopeKey: '12345@g.us',
    authorJid: '5511999999999@s.whatsapp.net',
    authorProfile: {
      nickname: 'Betão do Crash',
      title: 'O Apostador Falido',
      bio: 'Sempre perde tudo no cassino às 2 da manhã',
      extras: 'torce pro Vasco e odeia quando o bot zoa a aposta dele',
    },
    activePersonaSummary: 'O grupo está em clima de festa e zoando o Betão pelas perdas no jogo',
    recentTopics: ['festa junina', 'crash', 'apostas'],
    confirmedFacts: [
      'Beto perdeu 1000 coins no crash ontem',
      'Lucas pagou a rodada de pizza para a galera',
    ],
  });

  assert.ok(context.includes('Betão do Crash'));
  assert.ok(context.includes('O Apostador Falido'));
  assert.ok(context.includes('Sempre perde tudo no cassino'));
  assert.ok(context.includes('torce pro Vasco'));
  assert.ok(context.includes('Clima e Lore ativa do grupo'));
  assert.ok(context.includes('Assuntos recentes comentados no grupo: festa junina, crash, apostas'));
  assert.ok(context.includes('Lucas pagou a rodada de pizza'));
});

test('promptContextBuilder: fatos estruturados incluem a data de criação', () => {
  const context = buildExpandedPromptContext({
    timeZone: 'UTC',
    confirmedFacts: [
      {
        factText: 'Max aceitou enfrentar Jonas no vôlei amanhã',
        firstSeenAt: Date.UTC(2026, 7, 28),
      },
    ],
  });

  assert.match(context, /data_do_fato=2026-08-28/);
  assert.match(context, /Max aceitou enfrentar Jonas no vôlei amanhã/);
});

test('promptContextBuilder: lida graciosamente com perfil ausente', () => {
  const context = buildExpandedPromptContext({
    scopeKey: '12345@g.us',
    activePersonaSummary: 'Clima calmo',
  });

  assert.ok(context.includes('Clima e Lore ativa do grupo:\nClima calmo'));
  assert.ok(!context.includes('Perfil de quem falou'));
});

test('promptContextBuilder: filtra fatos corrompidos ou com placeholders', () => {
  const context = buildExpandedPromptContext({
    confirmedFacts: [
      'Beto venceu o torneio',
      'Adora comer ? e não informa quem adora', // Deve ser filtrado por isUsablePromptFact
    ],
  });

  assert.ok(context.includes('Beto venceu o torneio'));
  assert.ok(!context.includes('não informa'));
});
