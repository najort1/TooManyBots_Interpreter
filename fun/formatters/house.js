export function formatHouseLink({ groupName = '', url, coins = 0 }) {
  return ['🏠 *Sua casa' + (groupName ? ' — ' + groupName : '') + '*', 'Link: ' + url, 'Coins: *' + coins + '*'].join('\n');
}

export function formatAvatarSummary(state) {
  return ['🧍 *Seu avatar*', 'Base: ' + (state.slots?.body || 'corpo_beco'), 'Rosto: ' + (state.slots?.hair_face || 'base_face'), 'Roupa: ' + (state.slots?.outfit || 'camiseta_beco'), 'Acessório: ' + (state.slots?.optional_accessory || 'sem_acessorio')].join('\n');
}
