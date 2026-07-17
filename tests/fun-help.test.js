import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatHelp,
  resolveHelpTopic,
  listHelpTopicIds,
  HELP_TOPICS,
} from '../fun/formatters/helpGuide.js';

test('help índice é curto e aponta temas', () => {
  const text = formatHelp('/');
  assert.ok(text.includes('Fun — ajuda'));
  assert.ok(text.includes('/ajuda economia'));
  assert.ok(text.includes('/ajuda cassino'));
  assert.ok(text.includes('/daily'));
  // não é mais a parede monstro
  const lines = text.split('\n').length;
  assert.ok(lines <= 22, `índice com ${lines} linhas`);
});

test('help por tema resolve aliases', () => {
  assert.equal(resolveHelpTopic('bolsa'), 'economia');
  assert.equal(resolveHelpTopic('cassino'), 'cassino');
  assert.equal(resolveHelpTopic('faccao'), 'faccoes');
  assert.equal(resolveHelpTopic('panelinha'), 'faccoes');
  assert.equal(resolveHelpTopic('fig'), 'midia');
  assert.equal(resolveHelpTopic('xyz'), null);
});

test('help temas renderizam comandos-chave', () => {
  const eco = formatHelp('/', 'bolsa');
  assert.ok(eco.includes('Bolsa') || eco.includes('bolsa'));
  assert.ok(eco.includes('/carteira') || eco.includes('carteira'));

  const cas = formatHelp('/', 'cassino');
  assert.ok(cas.includes('bingo') || cas.includes('Bingo') || cas.includes('/bj'));

  const fac = formatHelp('/', 'faccoes');
  assert.ok(fac.includes('panelinha'));
});

test('help tema desconhecido volta pro índice', () => {
  const text = formatHelp('/', 'xyzinexistente');
  assert.ok(text.includes('Não achei'));
  assert.ok(text.includes('Fun — ajuda'));
});

test('todos os topics do catálogo têm id único', () => {
  const ids = listHelpTopicIds();
  assert.equal(ids.length, HELP_TOPICS.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    const page = formatHelp('/', id);
    assert.ok(page.length > 40, id);
    assert.ok(page.includes('/ajuda') || page.includes('Voltar'));
  }
});
