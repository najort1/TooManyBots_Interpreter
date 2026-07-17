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
import { createMarketService } from './services/marketService.js';
import { createJobService } from './services/jobService.js';
import { createFunCasinoRepository } from './db/funCasinoRepository.js';
import { createFunMarketRepository } from './db/funMarketRepository.js';
import { createFunStockRepository } from './db/funStockRepository.js';
import { createStockService } from './services/stockService.js';
import { createFunJobRepository } from './db/funJobRepository.js';
import { createFunUserPrefsRepository } from './db/funUserPrefsRepository.js';
import { createGroupMembershipService } from './utils/groupMembership.js';
import { createSocialHooks } from './services/socialHooks.js';
import { createFlavorService } from './llm/flavorService.js';
import { createChaosService } from './services/chaosService.js';
import { createFunMemoryRepository } from './db/funMemoryRepository.js';
import { createGroupMemoryService } from './services/groupMemoryService.js';
import { handleFunIncomingMessage } from './pipeline/onIncomingMessage.js';
import { getDb } from '../db/context.js';
import { sendTextMessage, sendImageMessage, sendStickerMessage } from '../engine/sender.js';
import { getContactDisplayName, listContactDisplayNames } from '../db/index.js';
import { createIdentityMap } from './utils/identity.js';
import { isWorldQuietHours } from './utils/worldQuietHours.js';
import { createUserFormatter, runWithUserLabels } from './utils/userLabel.js';

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
  const marketRepository =
    deps.marketRepository || createFunMarketRepository({ getDatabase });
  const stockRepository =
    deps.stockRepository || createFunStockRepository({ getDatabase });
  const jobRepository =
    deps.jobRepository || createFunJobRepository({ getDatabase });
  const prefsRepository = deps.prefsRepository || createFunUserPrefsRepository({ getDatabase });
  const membershipService =
    deps.membershipService ||
    createGroupMembershipService({
      ttlMs: 5 * 60_000,
    });

  const xpService = createXpService({ repository, effectsRepository });
  const rankService = createRankService({ repository });
  const dailyService = createDailyService({ repository });
  const coinsService = createCoinsService({ repository });
  const stockService =
    deps.stockService ||
    createStockService({
      repository,
      stockRepository,
    });
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
  const marketService =
    deps.marketService ||
    createMarketService({
      repository,
      marketRepository,
      effectsRepository,
      factionService,
      casinoRepository,
      stockService,
      getLogger,
      generateZen: deps.openaiChatComplete,
      generateOllama: deps.ollamaGenerate,
    });
  const missionService = createMissionService({
    missionRepository,
    factionRepository,
    repository,
    bridgeService,
  });
  const jobService =
    deps.jobService ||
    createJobService({
      repository,
      jobRepository,
    });
  const eventService = createEventService({ eventRepository });
  const socialHooks = createSocialHooks({
    bridgeService,
    missionService,
    eventService,
    factionService,
    repository,
  });
  const chaosService =
    deps.chaosService ||
    createChaosService({
      repository,
      effectsRepository,
    });
  const memoryRepository =
    deps.memoryRepository || createFunMemoryRepository({ getDatabase });
  const groupMemoryService =
    deps.groupMemoryService ||
    createGroupMemoryService({
      memoryRepository,
      getContactDisplayName: resolveContactName,
      getLogger,
      generateZen: deps.openaiChatComplete || deps.zenGenerate,
      generateOllama: deps.ollamaGenerate || deps.generate,
    });
  const flavorService =
    deps.flavorService ||
    createFlavorService({
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getLogger,
      // Zen principal · Ollama fallback · template no fim
      zenGenerate: deps.openaiChatComplete || deps.zenGenerate,
      generate: deps.ollamaGenerate || deps.generate,
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
        marketService,
        stockService,
        jobService,
        chaosService,
        groupMemoryService,
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

  /**
   * Relógio do mundo — timer no runtime (não depende de msg de usuário).
   * Dispara mercado, eventos surpresa e restock nos grupos whitelist.
   */
  async function tickWorldEvents({
    sock = null,
    sendText: sendFn = null,
    now = Date.now(),
    getContactDisplayName: nameFn = null,
  } = {}) {
    ensureInit();
    const funConfig = resolveFunConfig(getConfig() || {});
    if (funConfig.enabled === false) {
      return { ok: false, reason: 'disabled' };
    }
    if (funConfig.worldAutonomous === false) {
      return { ok: false, reason: 'world-autonomous-off' };
    }
    // 01:00–05:59 (default): sem eventos aleatórios na vida real
    if (isWorldQuietHours(funConfig, now)) {
      return { ok: false, reason: 'quiet-hours', results: [] };
    }

    const groups = [...getFunGroupWhitelistSet(funConfig)];
    if (!groups.length) {
      return { ok: false, reason: 'no-whitelist', results: [] };
    }

    const post = sendFn || sendText;
    const nameResolver = nameFn || resolveContactName;
    const results = [];

    const postWithMentions = async (toJid, msg, userFmt) => {
      if (!msg || !post || !sock) return;
      const mentions = userFmt?.takeMentions?.() || [];
      await post(sock, toJid, msg, mentions.length ? { mentions } : undefined);
    };

    for (const scopeKey of groups) {
      if (!scopeKey || !String(scopeKey).endsWith('@g.us')) continue;

      const userFmt = createUserFormatter({
        getContactDisplayName: nameResolver,
        mentionUsers: funConfig.mentionUsers !== false,
      });

      await runWithUserLabels(userFmt, async () => {
        const worldEventsOn =
          typeof groupRepository?.isWorldEventsEnabled === 'function'
            ? groupRepository.isWorldEventsEnabled(scopeKey, funConfig)
            : groupRepository?.resolveEffectiveRates?.(scopeKey, funConfig)
                ?.worldEventsEnabled !== false;

        // tick de preços / regulador (silencioso) — independente de anúncios
        if (marketService?.tickEconomy && funConfig.economyEnabled !== false) {
          try {
            marketService.tickEconomy(scopeKey, funConfig, now);
          } catch {
            /* ignore tick errors */
          }
        }

        // Mercado auto + trégua: só se world events ON
        // Happy hour: sempre pode anunciar (mesmo com world events off)
        if (worldEventsOn && marketService?.tryAutoMarketEvent) {
          try {
            const hit = await marketService.tryAutoMarketEvent({
              scopeKey,
              funConfig,
              now,
              autonomous: true,
            });
            if (hit?.ok && hit.announce !== false) {
              const msg =
                typeof marketService.formatEventAnnouncement === 'function'
                  ? marketService.formatEventAnnouncement(hit, nameResolver)
                  : '';
              await postWithMentions(scopeKey, msg, userFmt);
              results.push({ scopeKey, kind: 'market', ok: true });
            } else if (hit && !hit.ok) {
              results.push({ scopeKey, kind: 'market', ok: false, reason: hit.reason });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'market',
              ok: false,
              reason: err?.message || 'market-error',
            });
          }
        } else if (!worldEventsOn) {
          results.push({ scopeKey, kind: 'market', ok: false, reason: 'world-events-off' });
        }

        if (eventService?.tryAutoSpawn) {
          try {
            const spawned = eventService.tryAutoSpawn({
              scopeKey,
              funConfig,
              now,
              tick: true,
              happyOnly: !worldEventsOn,
            });
            if (spawned?.ok) {
              const msg =
                typeof eventService.formatAnnouncement === 'function'
                  ? eventService.formatAnnouncement(spawned)
                  : '';
              await postWithMentions(scopeKey, msg, userFmt);
              results.push({
                scopeKey,
                kind: 'event',
                ok: true,
                eventType: spawned.eventType,
              });
            } else if (spawned && !spawned.ok) {
              results.push({
                scopeKey,
                kind: 'event',
                ok: false,
                reason: spawned.reason,
              });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'event',
              ok: false,
              reason: err?.message || 'event-error',
            });
          }
        }

        if (marketService?.maybeWeeklyRestock) {
          try {
            const restock = marketService.maybeWeeklyRestock(scopeKey, funConfig, now);
            if (restock?.restocked) {
              const msg = [
                '📦 *Reposição no mercado de rua*',
                'Estoque da loja voltou ao máximo.',
                '_/mercado · /armas · /bazar_',
              ].join('\n');
              await postWithMentions(scopeKey, msg, userFmt);
              results.push({ scopeKey, kind: 'restock', ok: true });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'restock',
              ok: false,
              reason: err?.message || 'restock-error',
            });
          }
        }
      });
    }

    return {
      ok: true,
      results,
      fired: results.filter((r) => r.ok).length,
    };
  }

  return {
    init,
    onIncomingMessage,
    tickWorldEvents,
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
      marketService,
      marketRepository,
      stockService,
      stockRepository,
      jobService,
      jobRepository,
      casinoRepository,
      chaosService,
      groupMemoryService,
      memoryRepository,
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
