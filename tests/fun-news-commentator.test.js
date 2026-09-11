import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import {
  createNewsCommentatorService,
  deriveCommentatorMoodProfile,
} from '../fun/services/news/newsCommentatorService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('newsCommentatorService: resolve e persiste comentarista mantendo consistência no mesmo grupo', () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const commentatorService = createNewsCommentatorService({ newsRepository });

  // 1ª chamada: gera e salva
  const first = commentatorService.resolveCommentator(scope);
  assert.ok(first.name);
  assert.ok(first.title);
  assert.ok(first.catchphrase);

  // Consulta direta ao banco
  const inDb = newsRepository.getCommentator(scope);
  assert.equal(inDb.name, first.name);
  assert.equal(inDb.title, first.title);
  assert.equal(inDb.catchphrase, first.catchphrase);

  // 2ª chamada: deve recuperar EXATAMENTE o mesmo comentarista (consistência entre edições)
  const second = commentatorService.resolveCommentator(scope);
  assert.equal(second.name, first.name);
  assert.equal(second.title, first.title);
  assert.equal(second.catchphrase, first.catchphrase);
});

test('newsCommentatorService: renderCommentatorFallback gera texto opinativo com nome e bordão', () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const commentatorService = createNewsCommentatorService({ newsRepository });

  const commentator = {
    name: 'Cachorro Chupetinha',
    title: 'fiscal de vergonha alheia',
    catchphrase: 'Au au au, essa vergonha eu não passo nem de coleira!',
    style: 'sarcástico',
  };

  const conversation = {
    mood: 'zoeiro',
    timeline: [{ participants: ['Eduardo'] }],
  };

  const fallback = commentatorService.renderCommentatorFallback(commentator, conversation);
  assert.equal(fallback.name, 'Cachorro Chupetinha');
  assert.match(fallback.text, /Eduardo/);
  assert.match(fallback.text, /Au au au, essa vergonha eu não passo nem de coleira!/);
  assert.match(fallback.formatted, /CACHORRO CHUPETINHA/);
});

test('deriveCommentatorMoodProfile: modula humor e tom cênico preservando a voz-base Gemini', () => {
  const base = {
    name: 'Doutor Fuxico',
    title: 'psicanalista de boteco',
    voiceName: 'Kore',
    voiceTone: 'Pompous, pseudo-intellectual',
    style: 'pseudointelectual e zombeteiro',
    catchphrase: 'Falta lote pra capinar.',
  };

  // 1. Clima zoeiro
  const zoeiro = deriveCommentatorMoodProfile(base, 'zoeiro');
  assert.equal(zoeiro.voiceName, 'Kore', 'Voz base deve permanecer intacta');
  assert.equal(zoeiro.actingTone, 'debochado e gargalhando');
  assert.match(zoeiro.voiceTone, /giggling/i);
  assert.match(zoeiro.style, /deboche total/i);

  // 2. Clima movimentado
  const movimentado = deriveCommentatorMoodProfile(base, 'movimentado');
  assert.equal(movimentado.voiceName, 'Kore');
  assert.equal(movimentado.actingTone, 'agitado e histriônico');
  assert.match(movimentado.voiceTone, /fast-paced/i);

  // 3. Clima conversado
  const conversado = deriveCommentatorMoodProfile(base, 'conversado');
  assert.equal(conversado.voiceName, 'Kore');
  assert.equal(conversado.actingTone, 'relaxado e irônico');
  assert.match(conversado.voiceTone, /relaxed/i);

  // 4. Clima silencioso
  const silencioso = deriveCommentatorMoodProfile(base, 'silencioso');
  assert.equal(silencioso.voiceName, 'Kore');
  assert.equal(silencioso.actingTone, 'indignado com o marasmo');
  assert.match(silencioso.voiceTone, /yawning/i);
});

test('newsCommentatorService: enriquece e persiste registro legado que não possuía voz gravada', () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const commentatorService = createNewsCommentatorService({ newsRepository });

  // Insere manualmente um comentarista legado sem voiceName
  newsRepository.saveCommentator(scope, {
    name: 'Craque Neto do Zap',
    title: 'comentarista indignado',
    personality: 'grita muito',
    catchphrase: 'É uma barbaridade!',
    style: 'explosivo',
    voiceName: null,
    voiceTone: null,
  });

  const resolved = commentatorService.resolveCommentator(scope);
  assert.equal(resolved.name, 'Craque Neto do Zap');
  assert.equal(resolved.voiceName, 'Fenrir', 'Deveria inferir a voz Fenrir do arquétipo Craque Neto');
  assert.ok(resolved.voiceTone);

  // Consulta novamente no banco para certificar que a persistência foi consolidada
  const inDb = newsRepository.getCommentator(scope);
  assert.equal(inDb.voiceName, 'Fenrir');
  assert.ok(inDb.voiceTone);
});
