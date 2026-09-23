/**
 * Catálogo de Presets do TooManyBots Fun.
 *
 * Oferece perfis pré-calibrados para diferentes públicos e tipos de grupos:
 * - Grupo de Amigos & Zoeira (Caos, Memes e alta interação social)
 * - RPG, Cassino & Economia (Competitivo, gacha, bolsa e progressão)
 * - Comunidade / Grupo Grande (Anti-spam, moderação e baixo ruído)
 * - Modo Leve & 100% Offline (Sem IA, econômico, baixo consumo de RAM/CPU)
 * - Membro Vivo & IA Suprema (Experiência máxima com Zen LLM, Imagens e Áudio)
 * - Personalizado (Controle granular)
 */

export const FUN_PRESET_IDS = Object.freeze({
  FRIENDS_CHAOS: 'friends_chaos',
  RPG_ECONOMY: 'rpg_economy',
  COMMUNITY_QUIET: 'community_quiet',
  OFFLINE_ESSENTIAL: 'offline_essential',
  FULL_AI_LIVING_MEMBER: 'full_ai_living_member',
  CUSTOM: 'custom',
});

export const FUN_PRESETS = Object.freeze({
  [FUN_PRESET_IDS.FRIENDS_CHAOS]: Object.freeze({
    id: FUN_PRESET_IDS.FRIENDS_CHAOS,
    name: '🎭 Grupo de Amigos & Zoeira (Caos e Memes)',
    shortName: 'Zoeira & Amigos',
    badge: 'Popular',
    description: 'Foco em humor, memes, roleta russa, fofocas, quem é mais provável e zoeira social em grupo.',
    highlights: [
      'Comandos com resposta direta no grupo (todos riem juntos)',
      'Cooldown curto (25s) para interações dinâmicas',
      'QMP frequente com perguntas polêmicas liberadas',
      'Persona viva com reações, figurinhas e comentários',
      'Eventos de Caos diários (10 Minutos de Crime)',
    ],
    requiresAi: false,
    defaultAiMode: 'ai',
    configOverrides: Object.freeze({
      cooldownMs: 25_000,
      replyCommandsInPrivate: false,
      mentionUsers: true,
      replyQuoted: true,
      qmpEnabled: true,
      qmpAutoTriggerChance: 0.04,
      qmpAutoTriggerCooldownMs: 15 * 60_000,
      qmpHeavyEnabled: true,
      roastEnabled: true,
      chaosEventEnabled: true,
      personaEnabled: true,
      personaAutonomyEnabled: true,
      personaAutonomyAllowedActions: ['react', 'sticker', 'comment'],
      personaAutonomyMaxPerHour: 3,
      personaAutonomyMaxPerDay: 12,
      personaAutonomyCooldownMs: 10 * 60_000,
      assaultCooldownMs: 3 * 60_000,
      heistShopCooldownMs: 15 * 60_000,
      heistBankCooldownMs: 30 * 60_000,
    }),
  }),

  [FUN_PRESET_IDS.RPG_ECONOMY]: Object.freeze({
    id: FUN_PRESET_IDS.RPG_ECONOMY,
    name: '💎 RPG, Cassino & Economia (Competitivo & Gamers)',
    shortName: 'RPG & Economia',
    badge: 'Competitivo',
    description: 'Foco em jogatina, cassino, heists de bancos, bolsa de valores, gacha de cartas e progressão de nível.',
    highlights: [
      'Cassino completo (Blackjack, Crash, Roleta, Slots, Bingo e D20)',
      'Bolsa de valores com dividendos diários e mercado de colecionáveis',
      'Cards visuais de ranking para disputar o topo do grupo',
      'Heists em lojas e bancos com armas e recompensas calibradas',
      'Cooldown balanceado (40s) para valorizar as moedas',
    ],
    requiresAi: false,
    defaultAiMode: 'ai',
    configOverrides: Object.freeze({
      cooldownMs: 40_000,
      replyCommandsInPrivate: false,
      cardsEnabled: true,
      cardPackCost: 30,
      rankCardImage: true,
      rankLimit: 15,
      casinoCooldownMs: 15_000,
      blackjackCooldownMs: 20_000,
      crashCooldownMs: 20_000,
      rouletteCooldownMs: 15_000,
      slotCooldownMs: 15_000,
      bingoCooldownMs: 15_000,
      bolsaEnabled: true,
      bolsaTradeCooldownMs: 20_000,
      marketEnabled: true,
      marketEventMinMs: 90 * 60_000,
      marketEventMaxMs: 3 * 60 * 60_000,
      propertiesEnabled: true,
      housesEnabled: true,
      carEnabled: true,
      heistShopCooldownMs: 20 * 60_000,
      heistBankCooldownMs: 45 * 60_000,
      heistShopBaseChance: 0.52,
      heistBankBaseChance: 0.36,
      qmpAutoTriggerChance: 0.015,
      personaAutonomyMaxPerHour: 1,
      personaAutonomyMaxPerDay: 4,
    }),
  }),

  [FUN_PRESET_IDS.COMMUNITY_QUIET]: Object.freeze({
    id: FUN_PRESET_IDS.COMMUNITY_QUIET,
    name: '🛡️ Comunidade / Grupo Grande (Anti-Spam & Moderado)',
    shortName: 'Comunidade & Anti-Spam',
    badge: 'Organizado',
    description: 'Foco em baixo ruído, respeito ao feed principal, moderação, notícias diárias e desafios saudáveis.',
    highlights: [
      'Cooldown anti-flood estendido (90s) contra poluição de comandos',
      'Sem avisos barulhentos de level-up no meio do chat',
      'Sem eventos de purga de assaltos ou perguntas pesadas',
      'Persona sutil (intervém apenas com reações de emoji silenciosas)',
      'Jornal diário às 23:59 e Desafios Diários mantidos',
    ],
    requiresAi: false,
    defaultAiMode: 'ai',
    configOverrides: Object.freeze({
      cooldownMs: 90_000,
      replyCommandsInPrivate: false,
      announceLevelUp: false,
      qmpAutoTriggerChance: 0.005,
      qmpAutoTriggerCooldownMs: 60 * 60_000,
      qmpHeavyEnabled: false,
      chaosEventEnabled: false,
      assaultCooldownMs: 30 * 60_000,
      roastEnabled: false,
      personaAutonomyEnabled: true,
      personaAutonomyAllowedActions: ['react'],
      personaAutonomyMaxPerHour: 1,
      personaAutonomyMaxPerDay: 3,
      personaAutonomyCooldownMs: 30 * 60_000,
      dailyChallengeEnabled: true,
      groupNewsEnabled: true,
    }),
  }),

  [FUN_PRESET_IDS.OFFLINE_ESSENTIAL]: Object.freeze({
    id: FUN_PRESET_IDS.OFFLINE_ESSENTIAL,
    name: '⚡ Modo Leve & 100% Offline (Econômico / Sem IA)',
    shortName: 'Leve / Sem IA',
    badge: '100% Gratuito',
    description: '100% gratuito e offline. Todos os jogos, cassino, banco e comandos funcionam sem IA e com consumo mínimo.',
    highlights: [
      'Zero custo de API e zero dependências de IA externa',
      'Consumo mínimo de RAM (< 100MB) e inicialização ultrarrápida',
      'Jogos determinísticos (cassino, economia, cartas, banco) 100% funcionais',
    ],
    requiresAi: false,
    defaultAiMode: 'economic',
    configOverrides: Object.freeze({
      zenEnabled: false,
      imageGenEnabled: false,
      ollamaEnabled: false,
      selfHealEnabled: false,
      personaSocialHintsEnabled: false,
      groupEventsEnabled: false,
      cooldownMs: 45_000,
      replyCommandsInPrivate: false,
    }),
  }),

  [FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER]: Object.freeze({
    id: FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER,
    name: '🤖 Membro Vivo & IA Suprema (Máxima Inteligência)',
    shortName: 'Membro Vivo IA',
    badge: 'Premium / Full IA',
    description: 'A experiência definitiva com IA: OpenCode Zen LLM, memória viva, imagens e podcast diário.',
    highlights: [
      'Memória persistente por grupo (o bot aprende hábitos e piadas internas)',
      'Geração de imagens por IA (/gerar e /imaginar)',
      'Jornal noturno narrado em áudio com vozes neurais via Gemini TTS',
      'Persona agentiva capaz de consultar banco e agir no chat',
    ],
    requiresAi: true,
    defaultAiMode: 'ai',
    configOverrides: Object.freeze({
      zenEnabled: true,
      imageGenEnabled: true,
      memoryEnabled: true,
      personaEnabled: true,
      personaMemoryEnabled: true,
      personaToolsEnabled: true,
      personaAutonomyEnabled: true,
      personaAutonomyLlmEnabled: true,
      personaAutonomyAllowedActions: ['react', 'sticker', 'comment'],
      personaFollowupEnabled: true,
      groupNewsEnabled: true,
      groupNewsAudioEnabled: true,
      cooldownMs: 30_000,
      replyCommandsInPrivate: false,
    }),
  }),

  [FUN_PRESET_IDS.CUSTOM]: Object.freeze({
    id: FUN_PRESET_IDS.CUSTOM,
    name: '⚙️ Personalizado (Configuração Manual Passo a Passo)',
    shortName: 'Personalizado',
    badge: 'Avançado',
    description: 'Escolha manualmente cada opção do bot passo a passo.',
    highlights: [
      'Controle total de cada funcionalidade',
      'Escolha livre entre Econômico e IA',
    ],
    requiresAi: false,
    defaultAiMode: 'economic',
    configOverrides: Object.freeze({}),
  }),
});

/**
 * Retorna o preset correspondente ou lança erro se não existir.
 * @param {string} presetId
 * @returns {typeof FUN_PRESETS[keyof typeof FUN_PRESETS]}
 */
export function getFunPreset(presetId) {
  const preset = FUN_PRESETS[presetId];
  if (!preset) {
    throw new Error(`Preset desconhecido: "${presetId}". Opções válidas: ${Object.keys(FUN_PRESETS).join(', ')}`);
  }
  return preset;
}

/**
 * Retorna todos os presets como array ordenado para apresentação.
 * @returns {Array<typeof FUN_PRESETS[keyof typeof FUN_PRESETS]>}
 */
export function listFunPresets() {
  return [
    FUN_PRESETS[FUN_PRESET_IDS.FRIENDS_CHAOS],
    FUN_PRESETS[FUN_PRESET_IDS.RPG_ECONOMY],
    FUN_PRESETS[FUN_PRESET_IDS.COMMUNITY_QUIET],
    FUN_PRESETS[FUN_PRESET_IDS.OFFLINE_ESSENTIAL],
    FUN_PRESETS[FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER],
    FUN_PRESETS[FUN_PRESET_IDS.CUSTOM],
  ];
}

/**
 * Formata os presets para uso direto em menus do Inquirer.
 * @returns {Array<{ name: string, value: string, short: string }>}
 */
export function getPresetInquirerChoices() {
  return listFunPresets().map((p, index) => ({
    name: `${index + 1}) ${p.name}\n      ${p.description}`,
    value: p.id,
    short: p.shortName,
  }));
}

/**
 * Constrói e aplica a configuração a partir de um preset e overrides opcionais.
 *
 * @param {object} params
 * @param {string} [params.presetId] ID do preset selecionado (padrão: FRIENDS_CHAOS)
 * @param {object} [params.currentConfig] Configuração atual persistida
 * @param {boolean} [params.zenEnabled] Se a IA Zen deve estar ativa
 * @param {string} [params.zenBaseUrl] URL base da API OpenAI-compatível
 * @param {string} [params.zenModel] Nome do modelo da LLM
 * @param {string} [params.zenApiKey] Chave de API da LLM
 * @param {string} [params.prefix] Prefixo de comando (padrão: '/')
 * @param {boolean} [params.dashboardEnabled] Se o Dashboard Web 3D está ativo
 * @param {object} [params.extraOverrides] Quaisquer outros overrides específicos
 * @returns {object} Configuração mesclada e pronta para persistência
 */
export function applyFunPreset({
  presetId = FUN_PRESET_IDS.FRIENDS_CHAOS,
  currentConfig = {},
  zenEnabled = null,
  zenBaseUrl = '',
  zenModel = '',
  zenApiKey = '',
  prefix = '/',
  dashboardEnabled = true,
  extraOverrides = {},
} = {}) {
  const preset = getFunPreset(presetId);

  // Determina se IA está ativa: se informado explicitamente usa o valor; caso contrário usa o default do preset
  let isZen = zenEnabled !== null && zenEnabled !== undefined ? Boolean(zenEnabled) : preset.defaultAiMode === 'ai';

  // Se o preset é OFFLINE_ESSENTIAL, força IA desligada
  if (presetId === FUN_PRESET_IDS.OFFLINE_ESSENTIAL) {
    isZen = false;
  } else if (presetId === FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER) {
    isZen = true;
  }

  // Módulos base da IA conforme ativação
  const aiModules = isZen
    ? {
        imageGenEnabled: true,
        ollamaEnabled: false,
        selfHealEnabled: true,
        personaSocialHintsEnabled: true,
        groupEventsEnabled: true,
      }
    : {
        imageGenEnabled: false,
        ollamaEnabled: false,
        selfHealEnabled: false,
        personaSocialHintsEnabled: false,
        groupEventsEnabled: false,
      };

  const resolvedBaseUrl = String(zenBaseUrl || '').trim() || currentConfig.zenBaseUrl || 'http://localhost:20128/v1';
  const resolvedModel = String(zenModel || '').trim() || currentConfig.zenModel || 'bot-zap';
  const resolvedApiKey = String(zenApiKey ?? currentConfig.zenApiKey ?? '').trim();

  return {
    ...currentConfig,
    prefix: String(prefix || currentConfig.prefix || '/').trim(),
    dashboardEnabled: Boolean(dashboardEnabled),
    zenEnabled: isZen,
    zenBaseUrl: resolvedBaseUrl,
    zenModel: resolvedModel,
    zenApiKey: resolvedApiKey,
    // Aplica módulos da IA
    ...aiModules,
    // Aplica overrides específicos do preset selecionado
    ...preset.configOverrides,
    // Quaisquer overrides manuais extras passados pelo chamador
    ...extraOverrides,
    preset: presetId,
    groupWhitelistJids:
      Array.isArray(currentConfig.groupWhitelistJids) && currentConfig.groupWhitelistJids.length
        ? currentConfig.groupWhitelistJids
        : [],
  };
}
