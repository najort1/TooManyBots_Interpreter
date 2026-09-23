/**
 * Catálogo centralizado de funções e comandos do bot Fun.
 * Utilizado para:
 * - Controle granular no Dashboard (ativar/desativar por grupo)
 * - Validação e interceptação no roteador de comandos
 * - Observabilidade e listagem unificada
 */

import { FUN_COMMANDS } from '../constants.js';

export const COMMAND_CATEGORIES = Object.freeze([
  {
    id: 'perfil',
    name: 'Perfil & Nível',
    emoji: '👤',
    description: 'Estatísticas do jogador, XP, níveis e rankings gerais',
  },
  {
    id: 'economia',
    name: 'Economia & Emprego',
    emoji: '💰',
    description: 'Moedas, salário diário, transferências, trabalhos e bolsa de valores',
  },
  {
    id: 'jogos',
    name: 'Jogos & Apostas',
    emoji: '🎲',
    description: 'Cara ou coroa, duelos de aposta, desafios diários de lógica e sorte',
  },
  {
    id: 'cassino',
    name: 'Cassino',
    emoji: '🎰',
    description: 'Roleta, caça-níqueis, jackpot, 21 (blackjack), crash e torneios',
  },
  {
    id: 'social',
    name: 'Social & Relacionamentos',
    emoji: '💍',
    description: 'Casamentos, divórcios, ships, despedidas poéticas e rolês do grupo',
  },
  {
    id: 'faccoes',
    name: 'Panelinhas & Facções',
    emoji: '🏴‍☠️',
    description: 'Criação e gestão de panelinhas, missões conjuntas e eventos de grupo',
  },
  {
    id: 'mercado',
    name: 'Mercado, Itens & Cartas',
    emoji: '🛍️',
    description: 'Loja oficial, bazar entre jogadores, colecionáveis, armas e cartas gacha',
  },
  {
    id: 'casas',
    name: 'Casas & Avatares',
    emoji: '🏠',
    description: 'Habbo dos membros, decoração 2D/3D, mobis, visitas e customização',
  },
  {
    id: 'caos',
    name: 'Caos & Zoeira',
    emoji: '🃏',
    description: 'Roleta russa, fofocas aleatórias, oráculo, tarô, memórias e roasts',
  },
  {
    id: 'midia',
    name: 'Mídia & Reações',
    emoji: '🎭',
    description: 'Criação de figurinhas e reações interativas de anime (abraço, beijo, etc)',
  },
  {
    id: 'ia',
    name: 'Inteligência Artificial',
    emoji: '✨',
    description: 'Geração de imagens por IA',
  },
  {
    id: 'admin',
    name: 'Administração do Grupo',
    emoji: '🛡️',
    description: 'Moderação de membros, trancar/abrir grupo e escopos',
  },
  {
    id: 'nsfw',
    name: 'Conteúdo Adulto (NSFW)',
    emoji: '🔞',
    description: 'Reações e comandos adultos (desabilitado por padrão, requer /force_nsfw)',
  },
]);

export const COMMAND_CATALOG = Object.freeze([
  // Perfil & Nível
  {
    id: FUN_COMMANDS.XP,
    name: 'Perfil e XP',
    description: 'Exibe perfil, nível, moedas e barra de progresso do jogador',
    category: 'perfil',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/xp', '/perfil'],
  },
  {
    id: FUN_COMMANDS.RANK,
    name: 'Ranking de XP',
    description: 'Exibe o placar de líderes de nível e experiência do grupo',
    category: 'perfil',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/rank', '/top'],
  },
  {
    id: FUN_COMMANDS.RANK_COINS,
    name: 'Ranking de Moedas',
    description: 'Exibe os membros mais ricos do grupo',
    category: 'perfil',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/rankcoins', '/topcoins'],
  },
  {
    id: FUN_COMMANDS.RANK_MESSAGES,
    name: 'Ranking de Mensagens',
    description: 'Exibe os membros mais participativos do chat',
    category: 'perfil',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/rankmessages', '/topchat'],
  },
  {
    id: FUN_COMMANDS.ACHIEVEMENTS,
    name: 'Conquistas (Badges)',
    description: 'Lista as conquistas desbloqueadas pelo jogador no bot',
    category: 'perfil',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/conquistas', '/achievements'],
  },

  // Economia & Emprego
  {
    id: FUN_COMMANDS.COINS,
    name: 'Saldo de Moedas',
    description: 'Consulta o saldo de coins da conta do jogador',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/coins', '/saldo', '/moedas'],
  },
  {
    id: FUN_COMMANDS.DAILY,
    name: 'Recompensa Diária (Daily)',
    description: 'Coleta a recompensa diária de XP e moedas (com bônus de streak)',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/daily', '/diario'],
  },
  {
    id: FUN_COMMANDS.PAY,
    name: 'Transferência de Moedas (Pay)',
    description: 'Transfere moedas para outro membro do grupo',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/pay @user 100', '/pagar @user 50'],
  },
  {
    id: FUN_COMMANDS.JOB,
    name: 'Trabalho Autônomo (Freela)',
    description: 'Realiza minijogos e trabalhos rápidos para faturar moedas',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/job', '/trabalhar'],
  },
  {
    id: FUN_COMMANDS.EMPLOYMENT,
    name: 'Profissão CLT',
    description: 'Concorre e atua em profissões formais com salário recorrente',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/emprego', '/employment'],
  },
  {
    id: FUN_COMMANDS.RESIGN,
    name: 'Demissão',
    description: 'Pede demissão do cargo atual para escolher outra carreira',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/resign', '/demissao'],
  },
  {
    id: FUN_COMMANDS.PROPERTY,
    name: 'Negócios e Propriedades',
    description: 'Compra e administra empresas e pontos comerciais no grupo',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/propriedades', '/negocios'],
  },
  {
    id: FUN_COMMANDS.COLLECT,
    name: 'Coletar Rendimentos',
    description: 'Recolhe o lucro acumulado das propriedades do jogador',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/coletar', '/sacar'],
  },
  {
    id: FUN_COMMANDS.BOLSA,
    name: 'Bolsa de Valores',
    description: 'Acompanha cotações e negocia ações das empresas do ecossistema',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/bolsa', '/bolsa comprar TCK 5'],
  },
  {
    id: FUN_COMMANDS.CARTEIRA,
    name: 'Carteira de Investimentos',
    description: 'Exibe as ações e investimentos em custódia do jogador',
    category: 'economia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/carteira', '/portfolio'],
  },

  // Jogos & Apostas
  {
    id: FUN_COMMANDS.FLIP,
    name: 'Cara ou Coroa',
    description: 'Aposta rápida em cara ou coroa contra a máquina',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/flip cara 50', '/caraoucoroa coroa 100'],
  },
  {
    id: FUN_COMMANDS.LUCKY,
    name: 'Teste de Sorte',
    description: 'Gira a roda da sorte para tentar multiplicar o investimento',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/lucky 50', '/sorte 100'],
  },
  {
    id: FUN_COMMANDS.BET,
    name: 'Duelo de Aposta',
    description: 'Desafia outro membro para um duelo de moedas no grupo',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/bet @user 100', '/aposta @user 50'],
  },
  {
    id: FUN_COMMANDS.DESAFIO,
    name: 'Desafio Diário',
    description: 'Verifica e responde o enigma ou quiz diário de inteligência',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/desafio', '/responder 42', '/dica'],
  },
  {
    id: FUN_COMMANDS.RESPONDER,
    name: 'Responder Desafio',
    description: 'Envia resposta para a charada do desafio diário',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/responder resposta'],
  },
  {
    id: FUN_COMMANDS.DICA,
    name: 'Dica do Desafio',
    description: 'Solicita uma dica para o desafio ativo',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/dica'],
  },
  {
    id: FUN_COMMANDS.TROCAR_DESAFIO,
    name: 'Trocar Desafio Diário',
    description: 'Pula ou troca o desafio diário ativo',
    category: 'jogos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/trocardesafio', '/skip'],
  },

  // Cassino
  {
    id: FUN_COMMANDS.ROULETTE,
    name: 'Roleta Francesa',
    description: 'Aposta em números, cores (vermelho/preto) ou paridades na roleta',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/roleta vermelho 100', '/roleta 17 50'],
  },
  {
    id: FUN_COMMANDS.SLOT,
    name: 'Caça-Níqueis (Slot Machine)',
    description: 'Puxa a alavanca do caça-níqueis para combinar emojis',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/slot 50', '/cacaniqueis 100'],
  },
  {
    id: FUN_COMMANDS.JACKPOT,
    name: 'Acumulado (Jackpot)',
    description: 'Consulta ou aposta no prêmio acumulado global do cassino',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/jackpot', '/acumulado 100'],
  },
  {
    id: FUN_COMMANDS.DICE_DUEL,
    name: 'Duelo de Dados',
    description: 'Duelo de dados com apostas entre jogadores',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/dados @user 100', '/dado @user 50'],
  },
  {
    id: FUN_COMMANDS.CRASH,
    name: 'Crash (Foguetinho)',
    description: 'Jogo de multiplicador ascendente onde é preciso retirar antes de explodir',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/crash 100', '/cashout'],
  },
  {
    id: FUN_COMMANDS.CASHOUT,
    name: 'Retirar Crash (Cashout)',
    description: 'Interrompe a rodada de crash e resgata os ganhos',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/cashout', '/parar'],
  },
  {
    id: FUN_COMMANDS.BLACKJACK,
    name: 'Blackjack (21)',
    description: 'Mesa clássica de 21 contra o crupiê do bot',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/bj 100', '/blackjack 50', '/hit', '/stand'],
  },
  {
    id: FUN_COMMANDS.HIT,
    name: 'Pedir Carta (Hit)',
    description: 'Solicita outra carta na rodada ativa de blackjack',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/hit', '/pedir'],
  },
  {
    id: FUN_COMMANDS.STAND,
    name: 'Manter Mão (Stand)',
    description: 'Encerra sua jogada no blackjack e passa a vez ao crupiê',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/stand', '/manter'],
  },
  {
    id: FUN_COMMANDS.TOURNAMENT,
    name: 'Torneio de Cassino',
    description: 'Participa de torneios periódicos de apostas entre membros',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/torneio entrar', '/torneio'],
  },
  {
    id: FUN_COMMANDS.RANK_CASINO,
    name: 'Ranking do Cassino',
    description: 'Placar dos maiores ganhadores de apostas do grupo',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/rankcassino', '/topcassino'],
  },
  {
    id: FUN_COMMANDS.BINGO,
    name: 'Bingo Rápido',
    description: 'Rodadas de bingo com cartelas numéricas',
    category: 'cassino',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/bingo', '/bingo comprar'],
  },

  // Social & Relacionamentos
  {
    id: FUN_COMMANDS.MARRY,
    name: 'Pedido de Casamento',
    description: 'Pede outro membro do grupo em casamento formal',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/casar @user', '/marry @user'],
  },
  {
    id: FUN_COMMANDS.DIVORCE,
    name: 'Divórcio',
    description: 'Encerra o casamento atual com o cônjuge',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/divorciar', '/divorce'],
  },
  {
    id: FUN_COMMANDS.SHIP,
    name: 'Calculadora de Ship',
    description: 'Calcula a afinidade amorosa entre dois membros do grupo',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/ship @user1 @user2', '/ship'],
  },
  {
    id: FUN_COMMANDS.ACCEPT,
    name: 'Aceitar Proposta / Desafio',
    description: 'Aceita propostas de casamento, apostas ou convites pendentes',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/aceitar', '/sim'],
  },
  {
    id: FUN_COMMANDS.DECLINE,
    name: 'Recusar Proposta / Desafio',
    description: 'Recusa pedidos de casamento, apostas ou duelos',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/recusar', '/nao'],
  },
  {
    id: FUN_COMMANDS.DESPEDIR,
    name: 'Despedida Poética',
    description: 'Gera um poema satírico de despedida para um membro que saiu',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/despedir @user'],
  },
  {
    id: FUN_COMMANDS.DESPEDIDA_RANK,
    name: 'Ranking de Despedidas',
    description: 'Exibe os membros que mais se despediram no grupo',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/despedida rank'],
  },
  {
    id: FUN_COMMANDS.ROLES,
    name: 'Rolês do Grupo',
    description: 'Mapeia e lista os encontros e rolês combinados nas conversas',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/roles'],
  },
  {
    id: FUN_COMMANDS.REMOVE_ROLE,
    name: 'Remover Rolê',
    description: 'Exclui um rolê agendado da lista',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/removerole 1'],
  },
  {
    id: FUN_COMMANDS.QMP,
    name: 'Quem é Mais Provável? (QMP)',
    description: 'Enquetes espontâneas de votação social entre membros',
    category: 'social',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/qmp', '/qmp votar @user'],
  },

  // Panelinhas & Facções
  {
    id: FUN_COMMANDS.FACTION,
    name: 'Gestão de Panelinha / Facção',
    description: 'Cria, entra, visualiza membros ou gerencia sua facção',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/panelinha criar Nome', '/panelinha info'],
  },
  {
    id: FUN_COMMANDS.PANELINHA_GUIDE,
    name: 'Guia de Panelinhas',
    description: 'Manual de instruções sobre como funcionam as facções',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/guiapanelinha'],
  },
  {
    id: FUN_COMMANDS.PONTE,
    name: 'Ponte de Aliança',
    description: 'Gerencia pontes de amizade e alianças entre panelinhas rivais',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/ponte'],
  },
  {
    id: FUN_COMMANDS.MISSION,
    name: 'Missões Coletivas',
    description: 'Missões cooperativas para squads de jogadores',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/missao', '/squad'],
  },
  {
    id: FUN_COMMANDS.SQUAD,
    name: 'Gestão de Squad',
    description: 'Monta esquadrões para cumprir missões',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/squad convidar @user'],
  },
  {
    id: FUN_COMMANDS.EVENT,
    name: 'Eventos de Facção',
    description: 'Consulta eventos e guerras territoriais entre panelinhas',
    category: 'faccoes',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/evento'],
  },

  // Mercado, Itens & Cartas
  {
    id: FUN_COMMANDS.SHOP,
    name: 'Loja Oficial',
    description: 'Exibe os itens, títulos e utilitários à venda no bot',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/loja', '/shop'],
  },
  {
    id: FUN_COMMANDS.BUY,
    name: 'Comprar Item da Loja',
    description: 'Adquire itens ou títulos cosméticos',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/comprar item_id'],
  },
  {
    id: FUN_COMMANDS.TITLE,
    name: 'Equipar Título',
    description: 'Equipa títulos honorários adquiridos no perfil',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/titulo 1'],
  },
  {
    id: FUN_COMMANDS.CARTAS,
    name: 'Cartas Colecionáveis (Gacha)',
    description: 'Coleciona cartas de animais/personagens, abre packs e monta deck',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/cartas', '/cartas comprar', '/cartas deck'],
  },
  {
    id: FUN_COMMANDS.GALLERY,
    name: 'Galeria de Arte',
    description: 'Exibe obras de arte e relíquias raras do mercado',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/galeria', '/mercado'],
  },
  {
    id: FUN_COMMANDS.WEAPONS,
    name: 'Armaria',
    description: 'Equipa e gerencia armas de defesa e ataque',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/armas', '/armamento'],
  },
  {
    id: FUN_COMMANDS.INVENTORY,
    name: 'Inventário de Itens',
    description: 'Visualiza itens, mobis e peças guardadas na mochila',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/inventario', '/bag'],
  },
  {
    id: FUN_COMMANDS.BAZAAR,
    name: 'Bazar (Mercado dos Jogadores)',
    description: 'Anúncios e negociações de itens diretamente entre jogadores',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/bazar', '/feira'],
  },
  {
    id: FUN_COMMANDS.SELL_ITEM,
    name: 'Vender Item no Bazar',
    description: 'Coloca um item pessoal à venda no mercado',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/vender item_id 500'],
  },
  {
    id: FUN_COMMANDS.BUY_COLLECTIBLE,
    name: 'Comprar do Bazar',
    description: 'Adquire itens anunciados por outros membros',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/adquirir item_id'],
  },
  {
    id: FUN_COMMANDS.REPAIR_ITEM,
    name: 'Consertar Item Quebrado',
    description: 'Repara itens danificados durante eventos de choque',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/consertar item_id'],
  },
  {
    id: FUN_COMMANDS.MARKET_EVENT,
    name: 'Notícias do Mercado',
    description: 'Últimos fatos e rumores que afetam os preços dos colecionáveis',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/mercadoevento'],
  },
  {
    id: FUN_COMMANDS.ASSAULT,
    name: 'Assalto Clandestino',
    description: 'Tenta realizar pequenos furtos com risco de multa e confronto',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/assaltar @user', '/roubar @user'],
  },

  // Casas & Avatares
  {
    id: FUN_COMMANDS.HOUSE,
    name: 'Casa Virtual',
    description: 'Acessa e decora sua residência virtual no bairro',
    category: 'casas',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/casa', '/house'],
  },
  {
    id: FUN_COMMANDS.AVATAR,
    name: 'Avatar Personalizável',
    description: 'Customiza roupas, estilo e aparência do boneco no dashboard 3D',
    category: 'casas',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/avatar', '/boneco'],
  },
  {
    id: FUN_COMMANDS.CAR,
    name: 'Garagem de Carro 3D',
    description: 'Acessa a oficina 3D para customizar seu carro comprado na loja',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/carro', '/carros', '/garagem', '/car'],
  },
  {
    id: FUN_COMMANDS.MY_CAR,
    name: 'Meu Carro Customizado',
    description: 'Envia a foto do seu carro customizado no WhatsApp',
    category: 'mercado',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['meu_carro', '/meu_carro', '/meucarro'],
  },

  // Caos & Zoeira
  {
    id: FUN_COMMANDS.RUSSIAN,
    name: 'Roleta Russa',
    description: 'Inicia uma rodada de roleta russa onde quem puxar o gatilho pode perder',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/roletarussa', '/puxar'],
  },
  {
    id: FUN_COMMANDS.PULL,
    name: 'Puxar Gatilho',
    description: 'Puxa o gatilho do revólver na roleta russa ativa',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/puxar', '/gatilho'],
  },
  {
    id: FUN_COMMANDS.CANCEL,
    name: 'Cancelar Ação',
    description: 'Cancela ações pendentes ou convites abertos',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/cancelar'],
  },
  {
    id: FUN_COMMANDS.GOSSIP,
    name: 'Fofoca Aleatória',
    description: 'Pede ao bot uma fofoca cômica gerada com dados do grupo',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/fofoca', '/rumor'],
  },
  {
    id: FUN_COMMANDS.ORACLE,
    name: 'Oráculo Místico',
    description: 'Faz perguntas de sim ou não para o oráculo do bot',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/oraculo o sol vai brilhar amanhã?'],
  },
  {
    id: FUN_COMMANDS.ILLUMINATI,
    name: 'Teoria da Conspiração',
    description: 'Gera uma teoria conspiratória absurda envolvendo dois membros',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/illuminati @user1 @user2'],
  },
  {
    id: FUN_COMMANDS.LORE,
    name: 'Memórias do Grupo (Lore)',
    description: 'Consulta as histórias e memórias registradas pelo bot sobre o grupo',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/lore', '/memoria'],
  },
  {
    id: FUN_COMMANDS.FORGET_LORE,
    name: 'Esquecer Memória',
    description: 'Solicita ao bot apagar memórias obsoletas da lore do grupo',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/esquecerlore 1'],
  },
  {
    id: FUN_COMMANDS.ROAST,
    name: 'Roast / Zoar Membro',
    description: 'Gera uma zoação ou tirada bem-humorada com o alvo marcado',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/roast @user', '/zoar @user'],
  },
  {
    id: FUN_COMMANDS.TAROT,
    name: 'Tarô Místico',
    description: 'Tira cartas de tarô com interpretação mística gerada por IA',
    category: 'caos',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/tarot', '/tarot amor'],
  },

  // Mídia & Reações
  {
    id: FUN_COMMANDS.STICKER,
    name: 'Criador de Figurinhas',
    description: 'Transforma imagens e vídeos marcados em figurinhas animadas ou estáticas',
    category: 'midia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/figurinha', '/s', '/fig'],
  },
  {
    id: FUN_COMMANDS.REACTION,
    name: 'Reações Interativas (SFW)',
    description: 'Envia reações animadas de anime (beijo, abraço, carinho, tapa, cafune)',
    category: 'midia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/kiss @user', '/hug @user', '/slap @user', '/pat @user'],
  },
  {
    id: FUN_COMMANDS.HELP,
    name: 'Menu de Ajuda',
    description: 'Exibe a lista de comandos e guia geral do bot',
    category: 'midia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/ajuda', '/help'],
  },

  // Inteligência Artificial
  {
    id: FUN_COMMANDS.GERAR,
    name: 'Gerador de Imagens por IA',
    description: 'Gera ilustrações e fotos a partir de um prompt em texto',
    category: 'ia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/gerar um gato astronauta em marte'],
  },
  {
    id: FUN_COMMANDS.IMAGINAR,
    name: 'Imaginar Imagem (Prompt Criativo)',
    description: 'Variação criativa de geração de imagem com estilo artístico',
    category: 'ia',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/imaginar castelo cyberpunk sob chuva'],
  },

  // Administração de Grupo
  {
    id: FUN_COMMANDS.GROUP_SCOPE,
    name: 'Definir Escopo do Privado',
    description: 'Permite escolher qual grupo o usuário quer sincronizar no privado',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/grupo', '/grupo 1'],
  },
  {
    id: FUN_COMMANDS.GROUP_BAN,
    name: 'Banir Membro',
    description: 'Remove um membro infrator do grupo via bot (requer permissão de admin)',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/ban @user'],
  },
  {
    id: FUN_COMMANDS.GROUP_PROMOTE,
    name: 'Promover a Admin',
    description: 'Promove um membro a administrador do grupo',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/promover @user'],
  },
  {
    id: FUN_COMMANDS.GROUP_DEMOTE,
    name: 'Rebaixar Admin',
    description: 'Remove os privilégios de administrador de um membro',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/rebaixar @user'],
  },
  {
    id: FUN_COMMANDS.GROUP_ADD,
    name: 'Adicionar Membro',
    description: 'Adiciona um número de WhatsApp ao grupo',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/adicionar 5511999999999'],
  },
  {
    id: FUN_COMMANDS.GROUP_CLOSE,
    name: 'Fechar Grupo (Somente Admins)',
    description: 'Altera o grupo para que somente administradores possam enviar mensagens',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/fechar'],
  },
  {
    id: FUN_COMMANDS.GROUP_OPEN,
    name: 'Abrir Grupo (Todos os Membros)',
    description: 'Permite que todos os participantes voltem a enviar mensagens',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/abrir'],
  },
  {
    id: FUN_COMMANDS.GROUP_LOCK,
    name: 'Trancar Dados do Grupo',
    description: 'Bloqueia edição de foto, nome e descrição para não-admins',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/trancar'],
  },
  {
    id: FUN_COMMANDS.GROUP_UNLOCK,
    name: 'Destrancar Dados do Grupo',
    description: 'Libera edição de dados do grupo para todos',
    category: 'admin',
    defaultEnabled: true,
    isNsfw: false,
    examples: ['/destrancar'],
  },

  // NSFW (Adulto) — Desabilitado por padrão
  {
    id: 'nsfw_reaction',
    name: 'Reações Adultas (NSFW)',
    description: 'Reações explícitas (/anal, /blowjob, /cum, /fuck, /neko, etc). Requer /force_nsfw',
    category: 'nsfw',
    defaultEnabled: false,
    isNsfw: true,
    examples: ['/anal @user', '/blowjob @user', '/fuck @user'],
  },
  {
    id: FUN_COMMANDS.NSFW_ENABLE,
    name: 'Votação NSFW',
    description: 'Abre ou vota em enquete para liberar conteúdo adulto no grupo',
    category: 'nsfw',
    defaultEnabled: false,
    isNsfw: true,
    examples: ['/nsfw', '/liberarnsfw'],
  },
  {
    id: FUN_COMMANDS.NSFW_REJECT,
    name: 'Votar Contra NSFW',
    description: 'Vota contra a liberação de conteúdo adulto na votação ativa',
    category: 'nsfw',
    defaultEnabled: false,
    isNsfw: true,
    examples: ['/rejeitarnsfw'],
  },
  {
    id: FUN_COMMANDS.NSFW_FORCE,
    name: 'Forçar Liberação NSFW (force_nsfw)',
    description: 'Ativa/desativa comandos NSFW imediatamente sem necessidade de votação',
    category: 'nsfw',
    defaultEnabled: false,
    isNsfw: true,
    examples: ['/force_nsfw', '/nsfw_force'],
  },
]);

/** Mensagem padrão emitida quando um comando estiver desativado no grupo */
export const COMMAND_DISABLED_MESSAGE = 'este comando não foi habilitado para este grupo';

/**
 * Retorna todos os IDs válidos de comandos cadastrados no catálogo.
 * @returns {string[]}
 */
export function getAllCommandIds() {
  return COMMAND_CATALOG.map((c) => c.id);
}

/**
 * Retorna a lista de comandos que por padrão vêm desabilitados (NSFW).
 * @returns {string[]}
 */
export function getDefaultDisabledCommandIds() {
  return COMMAND_CATALOG.filter((c) => !c.defaultEnabled).map((c) => c.id);
}

/**
 * Verifica se um comando está desabilitado com base na lista de disabledCommands do grupo.
 *
 * @param {object} params
 * @param {string} params.command - ID do comando (ex: 'flip', 'roulette', 'reaction')
 * @param {string} [params.action] - Ação específica (ex: 'anal' para reaction nsfw, ou 'kiss' para sfw)
 * @param {boolean} [params.isNsfwAction] - Se a ação atual é classificada como NSFW
 * @param {string[]} [params.disabledCommands] - Lista de comandos desabilitados no grupo
 * @param {boolean} [params.permitirNsfw] - Se NSFW foi explicitamente liberado (/force_nsfw ou dashboard)
 * @returns {{ disabled: boolean, reason?: string, isNsfw?: boolean }}
 */
export function checkCommandAccess({
  command,
  action = '',
  isNsfwAction = false,
  disabledCommands = [],
  permitirNsfw = false,
}) {
  const disabledSet = new Set(Array.isArray(disabledCommands) ? disabledCommands : []);

  // 1. Se o comando pai está explicitamente na lista de desativados pelo dashboard
  if (disabledSet.has(command)) {
    return { disabled: true, reason: 'dashboard-disabled' };
  }

  // 2. Se for uma reação específica
  if (command === FUN_COMMANDS.REACTION) {
    if (isNsfwAction) {
      // Reação adulta: se nsfw ou nsfw_reaction estiver desativado pelo dashboard
      if (disabledSet.has('nsfw') || disabledSet.has('nsfw_reaction')) {
        return { disabled: true, reason: 'dashboard-disabled', isNsfw: true };
      }
      // Se não foi ativado via force_nsfw / permitirNsfw
      if (!permitirNsfw) {
        return { disabled: true, reason: 'nsfw-not-forced', isNsfw: true };
      }
    }
    return { disabled: false };
  }

  // 3. Se for comando da categoria NSFW (/nsfw, /nsfw_enable, /nsfw_reject, /nsfw_force)
  if (
    command === FUN_COMMANDS.NSFW_ENABLE ||
    command === FUN_COMMANDS.NSFW_REJECT ||
    command === FUN_COMMANDS.NSFW_FORCE
  ) {
    if (disabledSet.has('nsfw') || disabledSet.has(command)) {
      return { disabled: true, reason: 'dashboard-disabled', isNsfw: true };
    }
    return { disabled: false, isNsfw: true };
  }

  return { disabled: false };
}
