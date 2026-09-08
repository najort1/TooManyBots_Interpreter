import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createNewsCommentatorService } from '../fun/services/news/newsCommentatorService.js';

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
