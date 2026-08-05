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
import { createFunPropertyRepository } from './db/funPropertyRepository.js';
import { createFunNewsRepository } from './db/funNewsRepository.js';
import { createFunAchievementRepository } from './db/funAchievementRepository.js';
import { createFunSnapshotRepository } from './db/funSnapshotRepository.js';
import { createGroupMembershipService } from './utils/groupMembership.js';
import { createSocialHooks } from './services/socialHooks.js';
import { createFlavorService } from './llm/flavorService.js';
import { openaiChatComplete } from './llm/openaiClient.js';
import { createReactionMediaService } from './services/reactionMediaService.js';
import { createChaosService } from './services/chaosService.js';
import { createChaosEventService } from './services/chaosEventService.js';
import { createPropertyService } from './services/propertyService.js';
import { createRoastService } from './services/roastService.js';
import { createNewsService } from './services/newsService.js';
import { createChangelogService } from './services/changelogService.js';
import { createAchievementService } from './services/achievementService.js';
import { createFunNsfwVoteRepository } from './db/funNsfwVoteRepository.js';
import { createFunNsfwService } from './services/funNsfwService.js';
import { createFunMemoryRepository } from './db/funMemoryRepository.js';
import { createFunEvidenceRepository } from './db/funEvidenceRepository.js';
import { createFunSelfHealRepository } from './db/funSelfHealRepository.js';
import { createSelfHealingService } from './services/selfHealingService.js';
import { createFunPersonaRepository } from './db/funPersonaRepository.js';
import { createFunPersonaSocialHintRepository } from './db/funPersonaSocialHintRepository.js';
import { createFunProfileRepository } from './db/funProfileRepository.js';
import { createFunCardRepository } from './db/funCardRepository.js';
import { createFunQmpRepository } from './db/funQmpRepository.js';
import { createFunDailyChallengeRepository } from './db/funDailyChallengeRepository.js';
import { createDailyChallengeService } from './services/dailyChallengeService.js';
import { createGroupMemoryService } from './services/groupMemoryService.js';
import { createPersonaService } from './services/personaService.js';
import { createPersonaSocialHintService } from './services/personaSocialHintService.js';
import { createFunConversationMemoryRepository } from './db/funConversationMemoryRepository.js';
import { createFunThreadContextRepository } from './db/funThreadContextRepository.js';
import { createFunPersonaIdentityRepository } from './db/funPersonaIdentityRepository.js';
import { createThreadContextService } from './services/threadContextService.js';
import { createMemoryRetrievalService } from './services/memoryRetrievalService.js';
import { createMemoryIngestionService } from './services/memoryIngestionService.js';
import { createMemoryDecayService } from './services/memoryDecayService.js';
import { createPersonaIdentityService } from './services/personaIdentityService.js';
import { createSocialMemoryService } from './services/socialMemoryService.js';
import { createPersonaContextService } from './services/personaContextService.js';
import { createProfileService } from './services/profileService.js';
import { createCardService } from './services/cardService.js';
import { createQmpService } from './services/qmpService.js';
import { createFunImageGenerationRepository } from './db/funImageGenerationRepository.js';
import { createImageGenerationService } from './services/imageGenerationService.js';
import { createFunFarewellRepository } from './db/funFarewellRepository.js';
import { createFarewellService } from './services/farewellService.js';
import { handleFunIncomingMessage } from './pipeline/onIncomingMessage.js';
import { nameOf } from './utils/userLabel.js';
import { getDb } from '../db/context.js';
import { sendTextMessage as sendTextMessageOriginal, sendImageMessage as sendImageMessageOriginal, sendStickerMessage as sendStickerMessageOriginal } from '../engine/sender.js';

// Wrappers que desabilitam o rate limit para o bot fun
async function sendTextMessage(sock, jid, text, options = {}) {
  return sendTextMessageOriginal(sock, jid, text, { ...options, skipGuard: true });
}

async function sendImageMessage(sock, jid, payload, options = {}) {
  return sendImageMessageOriginal(sock, jid, payload, { ...options, skipGuard: true });
}

async function sendStickerMessage(sock, jid, buffer, options = {}) {
  return sendStickerMessageOriginal(sock, jid, buffer, { ...options, skipGuard: true });
}
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
  const getSock = typeof deps.getSock === 'function' ? deps.getSock : () => null;
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
  const propertyRepository =
    deps.propertyRepository || createFunPropertyRepository({ getDatabase });
  const newsRepository =
    deps.newsRepository || createFunNewsRepository({ getDatabase });
  const achievementRepository =
    deps.achievementRepository || createFunAchievementRepository({ getDatabase });
  const snapshotRepository =
    deps.snapshotRepository || createFunSnapshotRepository({ getDatabase });
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
    getDatabase,
  });
  const tarotService =
    deps.tarotService ||
    createTarotService({
      casinoRepository,
      getLogger,
      generateZen: deps.openaiChatComplete,
      generateOllama: deps.ollamaGenerate,
    });
  const profileRepository =
    deps.profileRepository || createFunProfileRepository({ getDatabase });
  const profileService =
    deps.profileService ||
    createProfileService({
      profileRepository,
      statsRepository: repository,
      getContactDisplayName: resolveContactName,
      getLogger,
      generateZen: deps.openaiChatComplete || deps.zenGenerate,
      generateOllama: deps.ollamaGenerate || deps.generate,
    });
  const cardRepository =
    deps.cardRepository || createFunCardRepository({ getDatabase });
  const cardService =
    deps.cardService ||
    createCardService({
      repository,
      cardRepository,
      actionRepository,
    });
  const qmpRepository =
    deps.qmpRepository || createFunQmpRepository({ getDatabase });
  const qmpService =
    deps.qmpService ||
    createQmpService({
      qmpRepository,
      getLogger,
      generateZen: deps.openaiChatComplete || deps.zenGenerate,
      generateOllama: deps.ollamaGenerate || deps.generate,
    });
  const shopService = createShopService({
    repository,
    effectsRepository,
    profileService,
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
  const propertyService =
    deps.propertyService ||
    createPropertyService({
      repository,
      propertyRepository,
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
      propertyService,
      achievementRepository,
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
  const chaosEventService =
    deps.chaosEventService ||
    createChaosEventService({
      repository,
      eventRepository,
      getMarketService: () => marketService,
      random: Math.random,
      getNewsService: () => newsService,
    });
  const socialHooks = createSocialHooks({ bridgeService, missionService });
  const chaosService =
    deps.chaosService ||
    createChaosService({
      repository,
      effectsRepository,
    });
  const memoryRepository =
    deps.memoryRepository || createFunMemoryRepository({ getDatabase });
  const evidenceRepository =
    deps.evidenceRepository || createFunEvidenceRepository({ getDatabase });
  const selfHealRepository =
    deps.selfHealRepository || createFunSelfHealRepository({ getDatabase });
  const generateSelfHealingZen =
    deps.openaiChatComplete ||
    deps.zenGenerate ||
    (async (params) => {
      const config = resolveFunConfig(getConfig() || {});
      if (config.zenEnabled === false || process.env.FUN_DISABLE_LIVE_LLM === '1') {
        throw new Error('llm-disabled');
      }
      return openaiChatComplete({
        ...params,
        baseUrl: config.zenBaseUrl,
        model: config.zenModel,
        apiKey: config.zenApiKey,
        sendSamplingParams: config.zenSendSamplingParams,
      });
    });
  const selfHealingService =
    deps.selfHealingService ||
    createSelfHealingService({
      selfHealRepository,
      evidenceRepository,
      memoryRepository,
      getLogger,
      generateZen: generateSelfHealingZen,
      getConfig: () => resolveFunConfig(getConfig() || {}),
    });
  const personaRepository =
    deps.personaRepository || createFunPersonaRepository({ getDatabase });
  const groupMemoryService =
    deps.groupMemoryService ||
    createGroupMemoryService({
      memoryRepository,
      getContactDisplayName: resolveContactName,
      getLogger,
      generateZen: deps.openaiChatComplete || deps.zenGenerate,
      generateOllama: deps.ollamaGenerate || deps.generate,
      getNewsService: () => newsService,
      evidenceRepository,
    });
  const personaSocialHintRepository = deps.personaSocialHintRepository || createFunPersonaSocialHintRepository({ getDatabase });
  const personaSocialHintService = deps.personaSocialHintService || createPersonaSocialHintService({
    repository: personaSocialHintRepository,
    getContactDisplayName: resolveContactName,
    getLogger,
    generateZen: deps.openaiChatComplete || deps.zenGenerate,
  });
  const conversationMemoryRepository = deps.conversationMemoryRepository || createFunConversationMemoryRepository({ getDatabase });
  const threadContextRepository = deps.threadContextRepository || createFunThreadContextRepository({ getDatabase });
  const personaIdentityRepository = deps.personaIdentityRepository || createFunPersonaIdentityRepository({ getDatabase });
  const threadContextService = deps.threadContextService || createThreadContextService({ threadContextRepository });
  const memoryRetrievalService = deps.memoryRetrievalService || createMemoryRetrievalService({ conversationMemoryRepository, getLogger });
  const memoryIngestionService = deps.memoryIngestionService || createMemoryIngestionService({ conversationMemoryRepository, getLogger });
  const memoryDecayService = deps.memoryDecayService || createMemoryDecayService({ conversationMemoryRepository });
  const personaIdentityService = deps.personaIdentityService || createPersonaIdentityService({ personaIdentityRepository });
  const socialMemoryService = deps.socialMemoryService || createSocialMemoryService();
  const personaContextService = deps.personaContextService || createPersonaContextService({ threadContextService, memoryRetrievalService, personaIdentityService, getLogger });
  const personaService =
    deps.personaService ||
    createPersonaService({
      personaRepository,
      groupRepository,
      threadContextService,
      personaSocialHintService,
      getLogger,
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
  const reactionMediaService =
    deps.reactionMediaService ||
    createReactionMediaService({
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getLogger,
    });
  const achievementService =
    deps.achievementService ||
    createAchievementService({
      achievementRepository,
      repository,
    });
  const roastService =
    deps.roastService ||
    createRoastService({
      repository,
      jobService,
      relationshipService,
      factionService,
      casinoRepository,
      flavorService,
      groupMemoryService,
      profileService,
    });
  const nsfwVoteRepository =
    deps.nsfwVoteRepository || createFunNsfwVoteRepository({ getDatabase });
  const nsfwService =
    deps.nsfwService || createFunNsfwService({ nsfwVoteRepository, groupRepository });

  // Desafio Diário
  const dailyChallengeRepository =
    deps.dailyChallengeRepository ||
    createFunDailyChallengeRepository({ getDatabase });
  const dailyChallengeService =
    deps.dailyChallengeService ||
    createDailyChallengeService({
      repository: dailyChallengeRepository,
      statsRepository: repository,
      effectsRepository,
      flavorService,
      getContactDisplayName: resolveContactName,
      generateZen: deps.openaiChatComplete || deps.zenGenerate,
      generateOllama: deps.ollamaGenerate || deps.generate,
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getLogger,
    });

  const imageGenerationRepository =
    deps.imageGenerationRepository ||
    createFunImageGenerationRepository({ getDatabase });
  const imageGenerationService =
    deps.imageGenerationService ||
    createImageGenerationService({
      repository: imageGenerationRepository,
      groupMemoryService,
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getLogger,
    });

  const newsService =
    deps.newsService ||
    createNewsService({
      newsRepository,
      snapshotRepository,
      statsRepository: repository,
      achievementRepository,
      relationshipRepository,
      casinoRepository,
      marketRepository,
      stockRepository,
      rouletteHistory: casinoRepository?.rouletteHistory || null,
      marketService,
      flavorService,
      dailyChallengeService,
      getContactDisplayName: resolveContactName,
    });

  const farewellRepository =
    deps.farewellRepository || createFunFarewellRepository({ getDatabase });
  const farewellService =
    deps.farewellService ||
    createFarewellService({
      farewellRepository,
      newsService,
      getContactDisplayName: resolveContactName,
    });

  const changelogService =
    deps.changelogService ||
    createChangelogService({
      getDatabase,
      getConfig: () => resolveFunConfig(getConfig() || {}),
      getSock,
      sendText,
      getContactDisplayName: resolveContactName,
      getLogger,
    });

  let initialized = false;
  let lastSelfHealAt = 0;

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
      chaosEventService,
        propertyService,
        roastService,
        newsService,
        achievementService,
        cardService,
        qmpService,
        casinoRepository,
        groupMemoryService,
        personaSocialHintService,
        personaService,
        personaContextService,
        threadContextService,
        memoryIngestionService,
        memoryDecayService,
        personaIdentityService,
        socialMemoryService,
        profileService,
        socialHooks,
        flavorService,
        reactionMediaService,
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
        nsfwVoteRepository,
        nsfwService,
        dailyChallengeService,
        imageGenerationService,
        farewellService,
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
        quotedMessageId: ctx.quotedMessageId ?? '',
        mentionedJids: ctx.mentionedJids || ctx.parsed?.mentionedJids || [],
        quotedParticipant: ctx.quotedParticipant || '',
        rawMessage: ctx.rawMessage || ctx.msg || null,
        appConfig: funConfig,
      }
    );
  }

  /**
   * DEPRECATED — Ollama fallback foi descontinuado. warmupLlm agora é noop.
   * Mantido como stub p/ compat de callers; Zen não exige warmup (proxy stateless).
   */
  async function warmupLlm() {
    return { ok: false, reason: 'deprecated' };
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

    const groups = [...getFunGroupWhitelistSet(funConfig)];
    if (!groups.length) {
      return { ok: false, reason: 'no-whitelist', results: [] };
    }

    const post = sendFn || sendText;
    const nameResolver = nameFn || resolveContactName;
    const results = [];
    const quiet = isWorldQuietHours(funConfig, now);

    if (funConfig.selfHealEnabled && !quiet && now - lastSelfHealAt >= funConfig.selfHealIntervalMs) {
      lastSelfHealAt = now;
      const maxCalls = Math.min(groups.length, funConfig.selfHealMaxCallsPerRun);
      for (const scopeKey of groups.slice(0, maxCalls)) {
        try {
          results.push(await selfHealingService.runSweep({ scopeKey, now }));
        } catch (error) {
          results.push({ kind: 'self-heal', ok: false, reason: error?.message || 'self-heal-error' });
        }
      }
    }

    // Memória seletiva: flush por timer do mundo (não depende de “bater 40 msgs”
    // no mesmo processo). Roda mesmo em quiet hours — só extrai buffer em RAM.
    if (groupMemoryService?.flushDueScopes) {
      try {
        const mem = await groupMemoryService.flushDueScopes(funConfig, now);
        if (mem?.results?.length) {
          for (const r of mem.results) results.push(r);
          if (mem.flushed > 0) {
            console.log(
              `[fun/memory] extract tick: ${mem.flushed} grupo(s) · ` +
                mem.results
                  .filter((r) => r.ok)
                  .map(
                    (r) =>
                      `${String(r.scopeKey).slice(0, 18)} +${r.inserted || 0}/~${r.reinforced || 0} (n=${r.batchSize || 0})`
                  )
                  .join(' · ')
            );
          }
        }
      } catch (err) {
        results.push({
          kind: 'memory-extract',
          ok: false,
          reason: err?.message || 'memory-tick-error',
        });
      }
    }

    if (personaSocialHintService?.flushDueScopes) {
      try {
        const socialHints = await personaSocialHintService.flushDueScopes(funConfig, now);
        if (socialHints?.results?.length) results.push(...socialHints.results);
      } catch (err) {
        results.push({ kind: 'persona-social-hints', ok: false, reason: err?.message || 'persona-social-hints-tick-error' });
      }
    }

    const postWithMentions = async (toJid, msg, userFmt) => {
      if (!msg || !post || !sock) return;
      const mentions = userFmt?.takeMentions?.() || [];
      await post(sock, toJid, msg, mentions.length ? { mentions } : undefined);
    };

    // The Group Times: 23:59 — mesmo em quiet hours (exceção do relógio)
    // Em paralelo por grupo: serial + timeout curto fazia só o 1º levar LLM e o resto template.
    if (newsService?.tryPublish && funConfig.groupNewsEnabled !== false) {
      const newsScopes = groups.filter((s) => s && String(s).endsWith('@g.us'));
      const newsJobs = newsScopes.map(async (scopeKey) => {
        // Verifica flag granular por grupo
        const journalOn =
          typeof groupRepository?.isGranularEventEnabled === 'function'
            ? groupRepository.isGranularEventEnabled(scopeKey, 'journal', funConfig)
            : true;
        if (!journalOn) {
          return { scopeKey, kind: 'group-news', ok: false, reason: 'journal-auto-disabled' };
        }
        try {
          const edition = await newsService.tryPublish(scopeKey, funConfig, now);
          if (edition?.ok && edition.text) {
            await post(sock, scopeKey, edition.text);
            return {
              scopeKey,
              kind: 'group-news',
              ok: true,
              newsDay: edition.newsDay,
              provider: edition.provider || null,
              eventCount: edition.eventCount ?? null,
            };
          }
          return {
            scopeKey,
            kind: 'group-news',
            ok: false,
            reason: edition?.reason || 'skip',
          };
        } catch (err) {
          return {
            scopeKey,
            kind: 'group-news',
            ok: false,
            reason: err?.message || 'news-error',
          };
        }
      });
      const newsResults = await Promise.all(newsJobs);
      for (const r of newsResults) {
        results.push(r);
        if (r.ok) {
          console.log(
            `[fun/news] published ${String(r.scopeKey).slice(0, 28)} provider=${r.provider} events=${r.eventCount}`
          );
        }
      }
    }

    // 01:00–05:59: sem mercado/eventos aleatórios (jornal já rodou acima se aplicável)
    if (quiet) {
      return {
        ok: true,
        reason: 'quiet-hours',
        results,
        fired: results.filter((r) => r.ok).length,
      };
    }

    for (const scopeKey of groups) {
      if (!scopeKey || !String(scopeKey).endsWith('@g.us')) continue;

      const userFmt = createUserFormatter({
        getContactDisplayName: nameResolver,
        mentionUsers: funConfig.mentionUsers !== false,
        resolveNickname: (jid) =>
          profileService?.getNickname?.(jid, scopeKey) || '',
      });

      await runWithUserLabels(userFmt, async () => {
        // Desafio diário: processa expirados antes de tudo
        if (
          dailyChallengeService?.processExpired &&
          funConfig.dailyChallengeEnabled !== false
        ) {
          try {
            const exp = await dailyChallengeService.processExpired({
              scopeKey,
              now,
              sendText: async (to, msg) => postWithMentions(to, msg, userFmt),
              sendImage: async (to, image, opts) => sendImage(sock, to, image, opts?.caption || ''),
              sharp: await import('sharp').then((m) => m.default || m).catch(() => null),
            });
            if (exp?.ok) {
              results.push({
                scopeKey,
                kind: 'challenge-expired',
                ok: true,
                announced: Boolean(exp.announced),
              });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'challenge-expired',
              ok: false,
              reason: err?.message || 'challenge-expired-error',
            });
          }
        }

        // Aniversários do dia (1x/ano/user) — independente de world events de mercado
        if (
          profileService?.listBirthdayAnnouncements &&
          funConfig.profileBirthdayAnnounce !== false &&
          funConfig.profileEnabled !== false
        ) {
          try {
            const bdays = profileService.listBirthdayAnnouncements(
              scopeKey,
              funConfig,
              now
            );
            for (const b of bdays) {
              const nick = b.nickname || nameResolver?.(b.userJid) || '';
              const tag = nameOf(nameResolver, b.userJid);
              const msg = [
                '🎂 *Aniversário no grupo!*',
                nick
                  ? `Hoje é aniversário de ${tag} (*${nick}*)!`
                  : `Hoje é aniversário de ${tag}!`,
                '_Parabéns da galera do bot._',
              ].join('\n');
              await postWithMentions(scopeKey, msg, userFmt);
              profileService.markBirthdayAnnounced(
                scopeKey,
                b.userJid,
                b.year,
                now
              );
              results.push({
                scopeKey,
                kind: 'birthday',
                ok: true,
                userJid: b.userJid,
              });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'birthday',
              ok: false,
              reason: err?.message || 'birthday-error',
            });
          }
        }

        const granularEvents =
          typeof groupRepository?.getGranularWorldEvents === 'function'
            ? groupRepository.getGranularWorldEvents(scopeKey, funConfig)
            : {
                journalAutoEnabled: true,
                marketAutoEnabled: true,
                happyHourAutoEnabled: true,
                chaosAutoEnabled: true,
                weeklyRestockAutoEnabled: true,
              };

        // tick de preços / regulador (silencioso) — independente de anúncios
        if (marketService?.tickEconomy && funConfig.economyEnabled !== false) {
          try {
            const econTick = marketService.tickEconomy(scopeKey, funConfig, now);
            // Captura resultado do tick de economia para a TUI (FR-017 US3)
            if (econTick && typeof econTick === 'object') {
              results.push({
                scopeKey,
                kind: 'economy-tick',
                ok: econTick.ok !== false,
                reason: econTick.ok === false ? econTick.reason : null,
                changed: Array.isArray(econTick.changed) ? econTick.changed.length : 0,
                stockChanged: Array.isArray(econTick.stockChanged) ? econTick.stockChanged.length : 0,
                scheduledApplied: Number(econTick.scheduledApplied) || 0,
                nextInMs: econTick.nextInMs || null,
                propertyTick: econTick.propertyTick || null,
              });
            }
          } catch {
            /* ignore tick errors */
          }
        }

        // Mercado auto + trégua: só se marketAutoEnabled
        if (granularEvents.marketAutoEnabled && marketService?.tryAutoMarketEvent) {
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
              const text = String(msg || '').trim();
              if (text) {
                await postWithMentions(scopeKey, text, userFmt);
                results.push({
                  scopeKey,
                  kind: 'market',
                  ok: true,
                  sent: true,
                  source: hit.source || hit.event?.source || null,
                });
              } else {
                console.warn(
                  `[fun/market] evento ok em ${scopeKey} mas anúncio vazio (source=${hit.source || hit.event?.source || '?'}) — não enviou`
                );
                results.push({
                  scopeKey,
                  kind: 'market',
                  ok: false,
                  reason: 'empty-announce',
                  source: hit.source || hit.event?.source || null,
                });
              }
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
        } else if (!granularEvents.marketAutoEnabled) {
          results.push({ scopeKey, kind: 'market', ok: false, reason: 'market-auto-disabled' });
        }

        // Happy hour: só se happyHourAutoEnabled
        if (granularEvents.happyHourAutoEnabled && eventService?.tryAutoSpawn) {
          try {
            const spawned = eventService.tryAutoSpawn({
              scopeKey,
              funConfig,
              now,
              tick: true,
              happyOnly: !granularEvents.marketAutoEnabled,
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

        // Chaos/PURGA: só se chaosAutoEnabled
        if (granularEvents.chaosAutoEnabled && chaosEventService?.tryStartEvent) {
          try {
            const chaosNow = Date.now();
            if (chaosEventService.shouldSendWarning?.(scopeKey, chaosNow)) {
              const rem = chaosEventService.getTimeRemaining(scopeKey, chaosNow);
              const warn = chaosEventService.formatWarningAnnouncement(rem);
              if (warn) {
                await postWithMentions(scopeKey, warn, userFmt);
                results.push({ scopeKey, kind: 'chaos-event-warning', ok: true });
              }
            }

            if (chaosEventService.shouldSendEnd?.(scopeKey, chaosNow)) {
              const endMsg = chaosEventService.formatEndAnnouncement(scopeKey, nameResolver);
              if (endMsg) {
                await postWithMentions(scopeKey, endMsg, userFmt);
                chaosEventService.resetWarning(scopeKey);
                results.push({ scopeKey, kind: 'chaos-event-end', ok: true });
              }
            }

            const started = chaosEventService.tryStartEvent(scopeKey, funConfig, chaosNow);
            if (started?.ok) {
              const msg = chaosEventService.formatStartAnnouncement(started, funConfig);
              if (msg) {
                await postWithMentions(scopeKey, msg, userFmt);
                results.push({
                  scopeKey,
                  kind: 'chaos-event',
                  ok: true,
                  eventType: 'crime_chaos',
                });
              }
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'chaos-event',
              ok: false,
              reason: err?.message || 'chaos-event-error',
            });
          }
        }

        // Limpa desafios expirados do /crime (executa transferências pendentes)
        if (chaosEventService?.processExpiredChallenges) {
          try {
            const expired = chaosEventService.processExpiredChallenges(scopeKey, now);
            for (const exp of expired) {
              const vTag = nameOf(nameResolver, exp.targetJid);
              const aTag = nameOf(nameResolver, exp.attackerJid);
              const msg = [
                `⏰ *Tempo esgotou!* ${vTag} não respondeu ao desafio.`,
                `${aTag} levou *${exp.stolen}* coins. (Conta: ${exp.expression} = ${exp.correctAnswer})`,
              ].join('\n');
              await postWithMentions(scopeKey, msg, userFmt);
              results.push({
                scopeKey,
                kind: 'challenge-expired',
                ok: true,
                stolen: exp.stolen,
              });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'challenge-expired',
              ok: false,
              reason: err?.message || 'challenge-timeout-error',
            });
          }
        }

        // Restock semanal: só se weeklyRestockAutoEnabled
        if (granularEvents.weeklyRestockAutoEnabled && marketService?.maybeWeeklyRestock) {
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

        // Desafio diário: tenta lançar o desafio de hoje se for a hora certa
        if (
          dailyChallengeService?.tryLaunchToday &&
          funConfig.dailyChallengeEnabled !== false
        ) {
          try {
            let sharpFn = null;
            try {
              const m = await import('sharp');
              sharpFn = m.default || m;
            } catch {
              // sharp indisponível — pokémon será pulado, mas guess_game/riddle funcionam
            }
            const sendTextFn = async (to, msg) => postWithMentions(to, msg, userFmt);
            const sendImageFn = async (to, buf, opts) =>
              sendImage(sock, to, buf, opts?.caption || '');
            const launched = await dailyChallengeService.tryLaunchToday({
              scopeKey,
              now,
              sendText: sendTextFn,
              sendImage: sendImageFn,
              sharp: sharpFn,
            });
            if (launched?.ok) {
              results.push({
                scopeKey,
                kind: 'challenge-launched',
                ok: true,
                challengeType: launched.challenge?.challengeType || null,
              });
            } else if (launched && !launched.ok && launched.reason !== 'not-window' && launched.reason !== 'already-launched' && launched.reason !== 'exists' && launched.reason !== 'disabled') {
              results.push({
                scopeKey,
                kind: 'challenge-launched',
                ok: false,
                reason: launched.reason || 'skip',
              });
            }
          } catch (err) {
            results.push({
              scopeKey,
              kind: 'challenge-launched',
              ok: false,
              reason: err?.message || 'challenge-launch-error',
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

  /**
   * Admin: lança changelog nos grupos da whitelist (via dashboard).
   */
  async function broadcastChangelog(opts = {}) {
    ensureInit();
    return changelogService.broadcast({
      ...opts,
      funConfig: resolveFunConfig(getConfig() || {}),
      sock: opts.sock || getSock?.(),
      sendText: opts.sendText || sendText,
    });
  }

  function listChangelogHistory(opts = {}) {
    ensureInit();
    return changelogService.listHistory(opts);
  }

  async function launchDailyChallengeForWhitelist(opts = {}) {
    const type = String(opts.type || '').trim();
    if (!['guess_game', 'riddle', 'pokemon'].includes(type)) {
      return { ok: false, reason: 'invalid-type' };
    }

    const funConfig = resolveFunConfig(getConfig() || {});
    const targets = [...getFunGroupWhitelistSet(funConfig)].filter((jid) => jid.endsWith('@g.us'));
    if (targets.length === 0) return { ok: false, reason: 'no-groups' };
    if (funConfig.dailyChallengeEnabled === false) {
      return { ok: false, reason: 'daily-challenge-disabled' };
    }
    if (!dailyChallengeService?.launchChallenge || !dailyChallengeService?.processExpired) {
      return { ok: false, reason: 'daily-challenge-unavailable' };
    }

    const sock = opts.sock || getSock?.();
    const sendTextFn = opts.sendText || sendText;
    const sendImageFn = opts.sendImage || sendImage;
    if (!sock || typeof sendTextFn !== 'function' || typeof sendImageFn !== 'function') {
      return { ok: false, reason: 'whatsapp-offline' };
    }

    ensureInit();
    const now = Number(opts.now) || Date.now();
    let sharpFn = opts.sharp || null;
    if (type === 'pokemon' && !sharpFn) {
      try {
        const sharpModule = await import('sharp');
        sharpFn = sharpModule.default || sharpModule;
      } catch {
        sharpFn = null;
      }
    }

    const results = [];
    for (const jid of targets) {
      try {
        const active = dailyChallengeRepository.getActiveChallenge(jid);
        await dailyChallengeService.processExpired({
          scopeKey: jid,
          now: now + 9e15,
          sendText: async () => {},
        });
        const challenge = await dailyChallengeService.launchChallenge({
          scopeKey: jid,
          type,
          now,
          sendText: async (to, message) => sendTextFn(sock, to, message),
          sendImage: async (to, image, imageOpts) =>
            sendImageFn(sock, to, image, imageOpts?.caption || ''),
          sharp: sharpFn,
        });
        if (challenge?.ok) {
          results.push({
            jid,
            ok: true,
            ...(active?.id ? { replacedChallengeId: active.id } : {}),
            challenge: challenge.challenge,
          });
        } else {
          results.push({ jid, ok: false, ...(active?.id ? { replacedChallengeId: active.id } : {}), reason: challenge?.reason || 'launch-failed' });
        }
      } catch (err) {
        results.push({ jid, ok: false, reason: err?.message || 'launch-failed' });
      }
    }
    const okCount = results.filter((result) => result.ok).length;
    return {
      ok: okCount === results.length,
      type,
      targetCount: targets.length,
      okCount,
      failCount: targets.length - okCount,
      results,
    };
  }

  return {
    init,
    onIncomingMessage,
    tickWorldEvents,
    broadcastChangelog,
    listChangelogHistory,
    launchDailyChallengeForWhitelist,
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
      propertyService,
      roastService,
      newsService,
      snapshotRepository,
      changelogService,
      achievementService,
      cardService,
      cardRepository,
      qmpService,
      qmpRepository,
      casinoRepository,
      stockRepository,
      jobService,
      jobRepository,
      casinoRepository,
      chaosService,
      chaosEventService,
      groupMemoryService,
      memoryRepository,
      evidenceRepository,
      selfHealRepository,
      selfHealingService,
      profileService,
      profileRepository,
      socialHooks,
      flavorService,
      reactionMediaService,
      identityMap,
      membershipService,
      prefsRepository,
      nsfwVoteRepository,
      nsfwService,
      dailyChallengeService,
      dailyChallengeRepository,
      imageGenerationService,
      imageGenerationRepository,
      farewellRepository,
      farewellService,
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
export { resolveZenTaskParams, ZEN_TASK_DEFAULTS } from './llm/zenTaskParams.js';
export {
  recordLlmHit,
  getLlmMetrics,
  resetLlmMetrics,
  inventTemplateAlert,
} from './llm/llmMetrics.js';
