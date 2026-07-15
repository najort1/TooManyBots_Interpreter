/**
 * Catálogo da loja Fun — sinks de coins com benefício real.
 * Preços em coins; ids estáveis usados em /comprar <id>
 */

export const SHOP_ITEMS = Object.freeze([
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
    id: 'xp_pack',
    name: 'Pacote de XP',
    emoji: '📘',
    price: 80,
    description: '+200 XP na hora',
    kind: 'instant',
    effectKey: null,
    payload: { xp: 200 },
  },
  {
    id: 'title',
    name: 'Título custom',
    emoji: '🏷️',
    price: 150,
    description: 'Define um título (até 16 chars) no /xp e ranks',
    kind: 'title',
    effectKey: 'title',
    payload: {},
  },
]);

export function getShopItem(id) {
  const key = String(id || '').trim().toLowerCase();
  return SHOP_ITEMS.find(i => i.id === key) || null;
}

export function listShopItems() {
  return SHOP_ITEMS.slice();
}
