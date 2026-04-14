import test from 'node:test';
import assert from 'node:assert/strict';

import { interpolate, interpolateForDisplay } from '../engine/utils.js';

test('interpolateForDisplay renders arrays as numbered lines', () => {
  const text = interpolateForDisplay('Itens:\n{{$lista}}', {
    lista: ['ovo cozido', 'ovo mexido', 'ovo frito'],
  });

  assert.equal(
    text,
    'Itens:\n1. ovo cozido\n2. ovo mexido\n3. ovo frito'
  );
});

test('interpolate keeps technical interpolation behavior unchanged', () => {
  const text = interpolate('{{$lista}}', {
    lista: ['a', 'b', 'c'],
  });

  assert.equal(text, 'a,b,c');
});
