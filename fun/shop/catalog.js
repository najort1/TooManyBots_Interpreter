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
]);

export function getShopItem(id) {
  const key = String(id || '').trim().toLowerCase();
  return SHOP_ITEMS.find((i) => i.id === key) || null;
}

export function listShopItems() {
  return SHOP_ITEMS.slice();
}
