/**
 * Economia utilitária Fun — itens com dependência entre si.
 *
 * Regras de design:
 * - Nenhuma peça é “só coleção”: tudo tem uso (assalto, defesa, panelinha, combustível).
 * - Armas exigem licença individual (chave_armas na /loja, por usuário) e munição (exceto faca).
 * - Veículos exigem gasolina pra fuga no assalto / vantagem.
 * - Estoque do bot é finito por grupo (market stock).
 */

export const ITEM_CATEGORIES = Object.freeze([
  'licenca',
  'combustivel',
  'municao',
  'arma',
  'veiculo',
  'defesa',
]);

/**
 * @typedef {object} GameItem
 * @property {string} id
 * @property {string} name
 * @property {string} emoji
 * @property {string} category
 * @property {number} basePrice
 * @property {string} rarity
 * @property {string} description
 * @property {string} benefit — o que o item faz (humano)
 * @property {string|null} requires — id de consumível necessário no uso
 * @property {number} stockMax — estoque máximo da loja do bot por grupo
 * @property {number} uses — usos ao adquirir (-1 = n/a / stack consumível unitário)
 * @property {boolean} weaponShop — só na /armas
 * @property {boolean} utilityShop — na /mercado (galeria utilitária)
 * @property {number} [assaultPower] — poder no assalto
 * @property {number} [defensePower] — defesa passiva
 * @property {boolean} [factionTrophy] — conta no arsenal da panelinha
 */

/** @type {ReadonlyArray<GameItem>} */
export const COLLECTIBLES = Object.freeze([
  {
    id: 'gasolina',
    name: 'Galão de gasolina',
    emoji: '⛽',
    category: 'combustivel',
    basePrice: 45,
    rarity: 'comum',
    description: 'Combustível de rua. Escasso quando a malha aperta.',
    benefit: 'Precisa ter pra carros/motos darem fuga no /assaltar (+sucesso).',
    requires: null,
    stockMax: 14,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'municao',
    name: 'Caixa de munição',
    emoji: '🔫',
    category: 'municao',
    basePrice: 38,
    rarity: 'comum',
    description: 'Cartuchos genéricos. Sem isso, pistola e rifle não disparam.',
    benefit: 'Cada caixa dá 3 tiros em armas de fogo no assalto.',
    requires: null,
    stockMax: 16,
    uses: 3,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'moto',
    name: 'Moto roubada',
    emoji: '🏍️',
    category: 'veiculo',
    basePrice: 420,
    rarity: 'rara',
    description: 'Rápida e barulhenta. Sem gasolina é sucata.',
    benefit: 'Com gasolina: +fuga no assalto. Sem gasolina: quase inútil.',
    requires: 'gasolina',
    stockMax: 4,
    uses: -1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'carro',
    name: 'Carro de fuga',
    emoji: '🚗',
    category: 'veiculo',
    basePrice: 680,
    rarity: 'rara',
    description: 'Porta-malas grande, placa raspada.',
    benefit: 'Com gasolina: +fuga forte no assalto e carrega mais risco.',
    requires: 'gasolina',
    stockMax: 3,
    uses: -1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'lockpick',
    name: 'Kit de lockpick',
    emoji: '🔧',
    category: 'licenca',
    basePrice: 50,
    rarity: 'comum',
    description: 'Ferramentas de arrombamento descartáveis. Essencial pra assalto a banco.',
    benefit: '1 uso. Sem lockpick, o cofre não abre.',
    requires: null,
    stockMax: 20,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'colete',
    name: 'Colete tático',
    emoji: '🦺',
    category: 'defesa',
    basePrice: 160,
    rarity: 'rara',
    description: 'Absorve o pior do tiroteio.',
    benefit: 'Reduz chance de ser assaltado com sucesso (consome usos).',
    requires: null,
    stockMax: 6,
    uses: 8,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 18,
    factionTrophy: false,
  },
  {
    id: 'faca',
    name: 'Faca de rua',
    emoji: '🔪',
    category: 'arma',
    basePrice: 90,
    rarity: 'comum',
    description: 'Silenciosa. Não gasta munição.',
    benefit: 'Assalto fraco/médio. Ideal pra quem não tem munição.',
    requires: null,
    stockMax: 8,
    uses: 12,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 22,
    defensePower: 4,
    factionTrophy: true,
  },
  {
    id: 'pistola',
    name: 'Pistola 9mm',
    emoji: '🔫',
    category: 'arma',
    basePrice: 260,
    rarity: 'rara',
    description: 'Padrão de bairro. Exige munição.',
    benefit: 'Assalto forte. Consome 1 munição por uso.',
    requires: 'municao',
    stockMax: 5,
    uses: 15,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 40,
    defensePower: 8,
    factionTrophy: true,
  },
  {
    id: 'rifle',
    name: 'Rifle serrado',
    emoji: '💥',
    category: 'arma',
    basePrice: 480,
    rarity: 'epica',
    description: 'Barulho de filme. Munição some rápido.',
    benefit: 'Assalto máximo. Consome 1 munição. Panelinha valoriza no arsenal.',
    requires: 'municao',
    stockMax: 2,
    uses: 10,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 58,
    defensePower: 10,
    factionTrophy: true,
  },
  {
    id: 'bazuca',
    name: 'Bazuca RPG-7',
    emoji: '🚀',
    category: 'arma',
    basePrice: 2800,
    rarity: 'epica',
    description: 'Lança-foguetes anti-blindagem. Faz tremer as paredes dos negócios.',
    benefit: 'Assalto pesado (+90 poder). Consome 1 foguete. Dano massivo no caixa e estrutura de negócios.',
    requires: 'foguete',
    stockMax: 2,
    uses: 6,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 90,
    defensePower: 15,
    factionTrophy: true,
  },
  {
    id: 'drone_kamikaze',
    name: 'Drone Kamikaze FPV',
    emoji: '🛰️',
    category: 'arma',
    basePrice: 6500,
    rarity: 'lendaria',
    description: 'Drone tático com carga explosiva. Ataque aéreo remoto e cirúrgico.',
    benefit: 'Assalto cirúrgico (+110 poder). Consome bateria_drone. Ignora fuga de veículo e gera 50% menos Heat.',
    requires: 'bateria_drone',
    stockMax: 2,
    uses: 4,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 110,
    defensePower: 10,
    factionTrophy: true,
  },
  {
    id: 'ogiva_nuclear',
    name: 'Ogiva Nuclear BombaTech',
    emoji: '☢️',
    category: 'arma',
    basePrice: 35000,
    rarity: 'mitica',
    description: 'Armamento de destruição em massa. Cogumelo atômico no grupo.',
    benefit: 'Assalto absoluto (100% chance). Consome codigo_nuclear e 1 uso. Zera a vida do negócio e rouba o teto!',
    requires: 'codigo_nuclear',
    stockMax: 1,
    uses: 1,
    weaponShop: true,
    utilityShop: false,
    assaultPower: 999,
    defensePower: 0,
    factionTrophy: true,
  },
  {
    id: 'foguete',
    name: 'Projétil de RPG',
    emoji: '🧨',
    category: 'municao',
    basePrice: 150,
    rarity: 'rara',
    description: 'Munição pesada explosiva para Bazuca RPG-7.',
    benefit: 'Consumível: 1 disparo de bazuca no assalto.',
    requires: null,
    stockMax: 8,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'bateria_drone',
    name: 'Bateria de alta densidade',
    emoji: '🔋',
    category: 'municao',
    basePrice: 280,
    rarity: 'rara',
    description: 'Célula de energia potente para voo de alta velocidade.',
    benefit: 'Consumível: 1 voo de drone kamikaze no assalto.',
    requires: null,
    stockMax: 6,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'codigo_nuclear',
    name: 'Código de Lançamento Nuclear',
    emoji: '💼',
    category: 'licenca',
    basePrice: 2500,
    rarity: 'lendaria',
    description: 'Chave criptográfica militar para autorizar o lançamento da ogiva.',
    benefit: 'Consumível: autoriza 1 detonação de ogiva nuclear no assalto.',
    requires: null,
    stockMax: 2,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'querosene_aviacao',
    name: 'Querosene de aviação',
    emoji: '🛢️',
    category: 'combustivel',
    basePrice: 350,
    rarity: 'rara',
    description: 'Combustível refinado JET-A1 para turbinas executivas.',
    benefit: 'Consumível: combustível de alta octanagem para o Jatinho.',
    requires: null,
    stockMax: 6,
    uses: 1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'blindado',
    name: 'Carro-Forte Caveirão VIP',
    emoji: '🚐',
    category: 'veiculo',
    basePrice: 4800,
    rarity: 'epica',
    description: 'Chapas de aço duplo e vidros blindados.',
    benefit: 'Com gasolina: +22 de fuga no assalto e concede +15 de defesa passiva.',
    requires: 'gasolina',
    stockMax: 2,
    uses: -1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 15,
    factionTrophy: false,
  },
  {
    id: 'jatinho',
    name: 'Jatinho Executivo Offshore',
    emoji: '✈️',
    category: 'veiculo',
    basePrice: 25000,
    rarity: 'lendaria',
    description: 'Aeronave particular com rota direta para ilhas caribenhas.',
    benefit: 'Com querosene_aviacao: +35 de fuga no assalto e acelera a limpeza de Wanted.',
    requires: 'querosene_aviacao',
    stockMax: 1,
    uses: -1,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 0,
    factionTrophy: false,
  },
  {
    id: 'cupula_ferro',
    name: 'Sistema Cúpula de Ferro',
    emoji: '🛡️',
    category: 'defesa',
    basePrice: 14000,
    rarity: 'lendaria',
    description: 'Bateria anti-aérea com radar doppler. Protege seu patrimônio dos céus.',
    benefit: 'Defesa extrema (+45). 70% de chance de abater ogivas nucleares e 50% em bazucas (consome 1 uso).',
    requires: null,
    stockMax: 2,
    uses: 5,
    weaponShop: false,
    utilityShop: true,
    assaultPower: 0,
    defensePower: 45,
    factionTrophy: false,
  },
]);

export function getCollectible(id) {
  const key = String(id || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
  return (
    COLLECTIBLES.find(
      (i) =>
        i.id === key ||
        i.id.replace(/_/g, '') === key.replace(/_/g, '') ||
        i.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '_') === key
    ) || null
  );
}

export function listCollectibles(category = '') {
  const cat = String(category || '')
    .trim()
    .toLowerCase();
  if (!cat) return COLLECTIBLES.slice();
  return COLLECTIBLES.filter((i) => i.category === cat);
}

export function listUtilityShop() {
  return COLLECTIBLES.filter((i) => i.utilityShop);
}

export function listWeaponShop() {
  return COLLECTIBLES.filter((i) => i.weaponShop);
}

export function listCategories() {
  return ITEM_CATEGORIES.slice();
}

/** Compat: categorias de mercado que a IA/eventos podem afetar */
export const COLLECTIBLE_CATEGORIES = ITEM_CATEGORIES;
