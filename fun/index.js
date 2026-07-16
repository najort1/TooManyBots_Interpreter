import { resolveFunConfig, getFunGroupWhitelistSet } from './config.js';
import { createFunStatsRepository } from './db/funStatsRepository.js';
import { createFunGroupRepository } from './db/funGroupRepository.js';
import { createFunRelationshipRepository } from './db/funRelationshipRepository.js';
import { createFunActionRepository } from './db/funActionRepository.js';
import { createFunEffectsRepository } from './db/funEffectsRepository.js';
import { createFunFactionRepository } from './db/funFactionRepository.js';
import { createFunSocialRepository } from './db/funSocialRepository.js';
import { createFunMissionRepository } from './db/funMissionRepository.js';
import { createFunEventRepository } from './db/funEventRepository.js';
import { createXpService } from './services/xpService.js';
import { createRankService } from './services/rankService.js';
import { createDailyService } from './services/dailyService.js';
import { createCoinsService } from './services/coinsService.js';
import { createRelationshipService } from './services/relationshipService.js';
import { createGameService } from './services/gameService.js';
import { createShopService } from './services/shopService.js';
import { createBridgeService } from './services/bridgeService.js';
import { createFactionService } from './services/factionService.js';
import { createMissionService } from './services/missionService.js';
import { createEventService } from './services/eventService.js';
import { createCasinoService } from './services/casinoService.js';
import { createTarotService } from './services/tarotService.js';
import { createFunCasinoRepository } from './db/funCasinoRepository.js';
import { createFunUserPrefsRepository } from './db/funUserPrefsRepository.js';
import { createGroupMembershipService } from './utils/groupMembership.js';
import { createSocialHooks } from './services/socialHooks.js';
import { createFlavorService } from './llm/flavorService.js';
import { handleFunIncomingMessage } from './pipeline/onIncomingMessage.js';
import { getDb } from '../db/context.js';
import { sendTextMessage, sendImageMessage, sendStickerMessage } from '../engine/sender.js';
import { getContactDisplayName, listContactDisplayNames } from '../db/index.js';
import { createIdentityMap } from './utils/identity.js';

/**
 * Facade pública do módulo Fun (lógica de jogo).
 * Runtime standalone: fun/start.js
 */
export function createFunModule(deps = {}) {
  const getConfig = deps.getConfig || (() => ({}));
  const getLogger = deps.getLogger || (() => null);
  const getDatabase = deps.getDatabase || getDb;
  const sendText = deps.sendText || sendTextMessage;
  const sendImage = deps.sendImage || sendImageMessage;
  const sendSticker = deps.sendSticker || sendStickerMessage;
  const resolveContactName = deps.getContactDisplayName || getContactDisplayName;
  const resolveContactList = deps.listContacts || (() => listContactDisplayNames(5000));
  const resolveWhitelist =
    deps.getGroupWhitelistJids ||
    ((cfg) => getFunGroupWhitelistSet(cfg));
  const identityMap = deps.identityMap || createIdentityMap();

  const repository = createFunStatsRepository({ getDatabase });
  const groupRepository = createFunGroupRepository({ getDatabase });
  const relationshipRepository = createFunRelationshipRepository({ getDatabase });
  const actionRepository = createFunActionRepository({ getDatabase });
  const effectsRepository = createFunEffectsRepository({ getDatabase });
  const factionRepository = createFunFactionRepository({ getDatabase });
  const socialRepository = createFunSocialRepository({ getDatabase });
  const missionRepository = createFunMissionRepository({ getDatabase });
  const eventRepository = createFunEventRepository({ getDatabase });
  const casinoRepository = createFunCasinoRepository({ getDatabase });
  const prefsRepository = deps.prefsRepository || createFunUserPrefsRepository({ getDatabase });
  const membershipService =
    deps.membershipService ||
    createGroupMembershipService({
      ttlMs: 5 * 60_000,
    });

  const xpService = createXpService({ repository });
  const rankService = createRankService({ repository });
  const dailyService = createDailyService({ repository });
  const coinsService = createCoinsService({ repository });
  const relationshipService = createRelationshipService({
    relationshipRepository,
    actionRepository,
  });
  const gameService = createGameService({
    repository,
    actionRepository,
    effectsRepository,
  });
  const casinoService = createCasinoService({
    repository,
    actionRepository,
    casinoRepository,
    effectsRepository,
    eventRepository,
  });
  const tarotService =
    deps.tarotService ||
    createTarotService({
      casinoRepository,
      getLogger,
      generateZen: deps.openaiChatComplete,
      generateOllama: deps.ollamaGenerate,
    });
  const shopService = createShopService({
    repository,
    effectsRepository,
  });
  const bridgeService = createBridgeService({
    socialRepository,
    factionRepository,
    effectsRepository,
  });
  const factionService = createFactionService({
    factionRepository,
    repository,
    bridgeService,
  });
  const missionService = createMissionService({
    missionRepository,
    factionRepository,
    repository,
    bridgeService,
  });
  const eventService = createEventService({ eventRepository });
  const socialHooks = createSocialHooks({
    bridgeService,
    missionService,
    eventService,
    factionService,
    repository,
  });
  const flavorService =
    deps.flavorService ||
    createFlavorService({
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getLogger,
      generate: deps.ollamaGenerate,
    });

  let initialized = false;

  function init() {
    repository.ensureFunSchema();
    initialized = true;
    return { ok: true };
  }

  function ensureInit() {
    if (!initialized) init();
  }

  async function onIncomingMessage(ctx = {}) {
    const funRuntimeConfig = getConfig() || {};
    const funConfig = resolveFunConfig(funRuntimeConfig);

    if (!funConfig.enabled) {
      return { handled: false, skipFlows: false, reason: 'disabled' };
    }

    ensureInit();

    if (ctx.messageKey || ctx.parsed?.messageKey) {
      identityMap.learnFromMessageKey(
        ctx.messageKey || ctx.parsed?.messageKey,
        ctx.actorJid || ''
      );
    }

    return handleFunIncomingMessage(
      {
        funConfig,
        xpService,
        rankService,
        dailyService,
        coinsService,
        relationshipService,
        gameService,
        shopService,
        effectsRepository,
        repository,
        groupRepository,
        factionService,
        bridgeService,
        missionService,
        eventService,
        casinoService,
        tarotService,
        socialHooks,
        flavorService,
        getContactDisplayName: resolveContactName,
        listContacts: resolveContactList,
        sendText,
        sendImage,
        sendSticker,
        getGroupWhitelistJids: resolveWhitelist,
        getLogger,
        identityMap,
        membershipService,
        prefsRepository,
      },
      {
        sock: ctx.sock,
        chatJid: ctx.chatJid || ctx.parsed?.jid || '',
        actorJid: ctx.actorJid || '',
        isGroup: Boolean(ctx.isGroup ?? ctx.parsed?.isGroup),
        text: ctx.text ?? ctx.parsed?.text ?? '',
        messageType: ctx.messageType ?? ctx.parsed?.messageType ?? '',
        mediaMimeType: ctx.mediaMimeType ?? ctx.parsed?.mediaMimeType ?? '',
        messageId: ctx.messageId ?? ctx.parsed?.id ?? '',
        messageKey: ctx.messageKey ?? ctx.parsed?.messageKey,
        mentionedJids: ctx.mentionedJids || ctx.parsed?.mentionedJids || [],
        quotedParticipant: ctx.quotedParticipant || '',
        rawMessage: ctx.rawMessage || ctx.msg || null,
        appConfig: funConfig,
      }
    );
  }

  /**
   * Carrega gemma (ou modelo configurado) na memória do Ollama e inicia refresh.
   * Custo no boot; comandos só geram texto (sem cold start).
   */
  async function warmupLlm() {
    const funConfig = resolveFunConfig(getConfig() || {});
    if (!funConfig.ollamaEnabled) {
      return { ok: false, reason: 'disabled' };
    }
    const result = await flavorService.warmup();
    if (result?.ok !== false) {
      flavorService.startKeepAliveLoop?.();
    } else {
      // mesmo com falha, tenta loop — pode recuperar depois
      flavorService.startKeepAliveLoop?.();
    }
    return result;
  }

  function stopLlmKeepAlive() {
    flavorService.stopKeepAliveLoop?.();
  }

  return {
    init,
    onIncomingMessage,
    warmupLlm,
    stopLlmKeepAlive,
    identityMap,
    _services: {
      repository,
      groupRepository,
      relationshipRepository,
      actionRepository,
      xpService,
      rankService,
      dailyService,
      coinsService,
      relationshipService,
      gameService,
      shopService,
      effectsRepository,
      factionService,
      bridgeService,
      missionService,
      eventService,
      casinoService,
      tarotService,
      casinoRepository,
      socialHooks,
      flavorService,
      identityMap,
      membershipService,
      prefsRepository,
    },
  };
}

export {
  resolveFunConfig,
  normalizeFunConfig,
  loadFunUserConfig,
  saveFunUserConfig,
  getFunGroupWhitelistSet,
  FUN_USER_CONFIG_PATH,
  FUN_DEFAULT_DATA_DIR,
} from './config.js';
export { parseFunCommand, isFunCommandText } from './commands/router.js';
export {
  xpToNext,
  totalXpForLevel,
  levelFromTotalXp,
  progressInLevel,
} from './services/levelCurve.js';
export { createFlavorService } from './llm/flavorService.js';
export { ollamaGenerate, ollamaPing, ollamaWarmup, ollamaTouch } from './llm/ollamaClient.js';
export { openaiChatComplete, openaiPing } from './llm/openaiClient.js';
