import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceOfferInitiator } from '../fun_dashboard/src/lib/houseVoicePolicy.js';

test('voice: somente um participante inicia a oferta para cada par', () => {
  assert.equal(isVoiceOfferInitiator('alice.session-a', 'bruno.session-b'), true);
  assert.equal(isVoiceOfferInitiator('bruno.session-b', 'alice.session-a'), false);
  assert.equal(isVoiceOfferInitiator('', 'bruno.session-b'), false);
});
