/**
 * Catálogo da loja Fun (/loja) — buffs + chave de armas.
 * Itens utilitários/armas com estoque dinâmico ficam em /mercado e /armas.
 */

export const SHOP_ITEMS = Object.freeze([
  {
    id: 'chave_armas',
    name: 'Chave da loja de armas',
    emoji: '🔑',
    price: 220,
    description:
      'Só pra você: libera /armas na sua conta neste grupo. Não compartilha com o resto — quem não compra fica de fora',
    kind: 'permanent',
    effectKey: 'weapons_license',
    payload: { permanent: true },
  },
  {
    id: 'boost_xp',
    name: 'Boost de XP',
    emoji: '⚡',
    price: 120,
    description: 'XP passivo 2x por 1 hora',
    kind: 'timed',
    effectKey: 'xp_boost',
    durationMs: 60 * 60 * 1000,
    payload: { multiplier: 2 },
  },
  {
    id: 'daily_plus',
    name: 'Daily turbinado',
    emoji: '🎁',
    price: 90,
    description: 'Próximo /daily com coins em dobro',
    kind: 'charge',
    effectKey: 'daily_double',
    charges: 1,
    payload: {},
  },
  {
    id: 'flip_lucky',
    name: 'Amuleto do flip',
    emoji: '🔮',
    price: 70,
    description: 'Próximo /cf com 65% de chance de ganhar',
    kind: 'charge',
    effectKey: 'flip_lucky',
    charges: 1,
    payload: { winChance: 0.65 },
  },
  {
    id: 'bet_shield',
    name: 'Escudo de aposta',
    emoji: '🛡️',
    price: 100,
    description: 'Se perder a próxima /aposta, recupera metade da stake',
    kind: 'charge',
    effectKey: 'bet_shield',
    charges: 1,
    payload: { refundRatio: 0.5 },
  },
  {
    id: 'title',
    name: 'Título custom',
    emoji: '🏷️',
    price: 150,
    description: 'Define um título (até 16 chars) no /perfil e ranks',
    kind: 'title',
    effectKey: 'title',
    payload: {},
  },
  {
    id: 'crime_immunity_pass',
    name: 'Crime Immunity Pass',
    emoji: '🕶️',
    // Comparável aos colecionáveis caros (rifle/carro); 1 por semana no servidor
    price: 900,
    description:
      '3 dias ou 20 crimes: polícia não bloqueia, Heat zera geração. Wanted ainda sobe devagar. Estoque: 1/semana.',
    kind: 'timed_charges',
    effectKey: 'police_immunity',
    durationMs: 3 * 24 * 60 * 60 * 1000,
    charges: 20,
    weeklyGlobalStock: 1,
    replaceOnRepurchase: true,
    payload: { useCharges: true, policeImmunity: true },
  },
  {
    id: 'alvara_holding',
    name: 'Alvará de Holding Empresarial',
    emoji: '📜',
    price: 25000,
    description: 'Autorização comercial que permite comprar +1 negócio (máximo de 4 propriedades no total).',
    kind: 'charge',
    effectKey: 'holding_license',
    charges: 1,
    payload: { bonusSlots: 1 },
  },
  {
    id: 'seguro_empresarial',
    name: 'Seguro Patrimonial BombaTech',
    emoji: '📑',
    price: 8000,
    description: '5 assaltos: se roubarem seu negócio, a seguradora te devolve 80% do buffer levado!',
    kind: 'charge',
    effectKey: 'business_insurance',
    charges: 5,
    payload: { refundRatio: 0.8 },
  },
  {
    id: 'advogado_supremo',
    name: 'Doutor Habeas Corpus VIP',
    emoji: '⚖️',
    price: 10000,
    description: '3 flagrantes: anula 100% da multa policial se você for pego assaltando no grupo!',
    kind: 'charge',
    effectKey: 'supreme_lawyer',
    charges: 3,
    payload: { waiveFine: true },
  },
  {
    id: 'iate_dourado',
    name: 'Iate Dourado de Ostentação',
    emoji: '🛥️',
    price: 150000,
    description: 'Puro luxo e flex no grupo. Título [Magnata] no perfil e +10% de bônus diário no /daily.',
    kind: 'permanent',
    effectKey: 'golden_yacht',
    payload: { permanent: true, dailyBonusPct: 10, title: 'Magnata' },
  },
]);

export function getShopItem(id) {
  const key = String(id || '').trim().toLowerCase();
  return SHOP_ITEMS.find((i) => i.id === key) || null;
}

export function listShopItems() {
  return SHOP_ITEMS.slice();
}
