import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRetractionIntent } from '../fun/utils/retractionIntent.js';

test('retraction intent: verbos diretos de remocao e exclusao', () => {
  assert.equal(hasRetractionIntent('tira isso do bot'), true);
  assert.equal(hasRetractionIntent('tira esse fato'), true);
  assert.equal(hasRetractionIntent('por favor tirem essa lore'), true);
  assert.equal(hasRetractionIntent('tire meu nome disso'), true);
  assert.equal(hasRetractionIntent('apaga esse fato pfv'), true);
  assert.equal(hasRetractionIntent('apaguem essa história'), true);
  assert.equal(hasRetractionIntent('deleta isso ai'), true);
  assert.equal(hasRetractionIntent('deletem essa conversa'), true);
  assert.equal(hasRetractionIntent('exclui esse fato'), true);
  assert.equal(hasRetractionIntent('remove essa piada'), true);
  assert.equal(hasRetractionIntent('removam esse relato'), true);
  assert.equal(hasRetractionIntent('esquece isso mano'), true);
  assert.equal(hasRetractionIntent('esqueçam isso'), true);
  assert.equal(hasRetractionIntent('limpa essa memoria'), true);
  assert.equal(hasRetractionIntent('cancela esse fato'), true);
  assert.equal(hasRetractionIntent('some com isso do grupo'), true);
  assert.equal(hasRetractionIntent('arranca esse fato dai'), true);
});

test('retraction intent: expressoes de desgosto, cansaco e incomodo', () => {
  assert.equal(hasRetractionIntent('nao gosto que fiquem falando disso'), true);
  assert.equal(hasRetractionIntent('não gostei dessa piada, apaga'), true);
  assert.equal(hasRetractionIntent('odeio quando lembram disso'), true);
  assert.equal(hasRetractionIntent('detesto essa zoeira'), true);
  assert.equal(hasRetractionIntent('para de falar daquele dia'), true);
  assert.equal(hasRetractionIntent('pare com essa conversa'), true);
  assert.equal(hasRetractionIntent('chega dessa piada chata'), true);
  assert.equal(hasRetractionIntent('chega desse papo'), true);
  assert.equal(hasRetractionIntent('para de zoar com isso'), true);
  assert.equal(hasRetractionIntent('nao aguento mais essa historia'), true);
  assert.equal(hasRetractionIntent('ninguem aguenta mais falar disso'), true);
  assert.equal(hasRetractionIntent('sem graca demais isso'), true);
  assert.equal(hasRetractionIntent('perdeu a graca ja'), true);
  assert.equal(hasRetractionIntent('nao quero mais esse negocio aqui'), true);
  assert.equal(hasRetractionIntent('bagulho chato do caralho, tira'), true);
  assert.equal(hasRetractionIntent('muito constrangedor isso'), true);
});

test('retraction intent: contestacoes, desmentidos e correcoes', () => {
  assert.equal(hasRetractionIntent('isso e mentira deslavada'), true);
  assert.equal(hasRetractionIntent('mentiroso demais isso'), true);
  assert.equal(hasRetractionIntent('isso e fake news pura'), true);
  assert.equal(hasRetractionIntent('fato falso da porra'), true);
  assert.equal(hasRetractionIntent('ele inventou isso aí'), true);
  assert.equal(hasRetractionIntent('historia inventada'), true);
  assert.equal(hasRetractionIntent('viajou legal o bot'), true);
  assert.equal(hasRetractionIntent('nem e verdade isso'), true);
  assert.equal(hasRetractionIntent('nao e verdade nada disso'), true);
  assert.equal(hasRetractionIntent('isso nunca aconteceu na vida'), true);
  assert.equal(hasRetractionIntent('nao aconteceu assim'), true);
  assert.equal(hasRetractionIntent('nada a ver essa historia'), true);
  assert.equal(hasRetractionIntent('nada haver isso aí'), true);
  assert.equal(hasRetractionIntent('ta tudo errado esse fato'), true);
});

test('retraction intent: fatos antigos, desatualizados e superados', () => {
  assert.equal(hasRetractionIntent('esse fato e muito antigo já'), true);
  assert.equal(hasRetractionIntent('historia velha demais'), true);
  assert.equal(hasRetractionIntent('isso ja e passado'), true);
  assert.equal(hasRetractionIntent('isso ja passou faz tempo'), true);
  assert.equal(hasRetractionIntent('ja era essa historia'), true);
  assert.equal(hasRetractionIntent('supera isso gente'), true);
  assert.equal(hasRetractionIntent('superem essa piada'), true);
  assert.equal(hasRetractionIntent('faz anos que isso rolou, apaga'), true);
  assert.equal(hasRetractionIntent('ja mudei de vida, desatualizado'), true);
});

test('retraction intent: respostas curtas em contexto de mensagem citada (quote)', () => {
  assert.equal(hasRetractionIntent('tira', { quotedText: 'Rafa perdeu o ônibus' }), true);
  assert.equal(hasRetractionIntent('apaga', { quotedText: 'Lucas caiu da moto' }), true);
  assert.equal(hasRetractionIntent('mentira', { quotedText: 'Pedro foi corno' }), true);
  assert.equal(hasRetractionIntent('fake', { quotedText: 'Beto comprou um celta' }), true);
  assert.equal(hasRetractionIntent('supera', { quotedText: 'Ana namorou o Carlos' }), true);
  assert.equal(hasRetractionIntent('chega', { quotedText: 'Mariana bebeu demais' }), true);
  assert.equal(hasRetractionIntent('para', { quotedText: 'Piada da piscina' }), true);
  assert.equal(hasRetractionIntent('nada a ver', { quotedText: 'Fato sobre briga' }), true);
});

test('retraction intent: rejeita mensagens casuais e falsos positivos', () => {
  assert.equal(hasRetractionIntent('bom dia galera'), false);
  assert.equal(hasRetractionIntent('kkk pior que e verdade'), false);
  assert.equal(hasRetractionIntent('comprei um carro antigo hoje'), false);
  assert.equal(hasRetractionIntent('ele e velho mas e gente boa'), false);
  assert.equal(hasRetractionIntent('alguem quer jogar bola?'), false);
  assert.equal(hasRetractionIntent('sim com certeza'), false);
  assert.equal(hasRetractionIntent(''), false);
  assert.equal(hasRetractionIntent(null), false);
});
