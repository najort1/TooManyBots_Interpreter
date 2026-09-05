import { isFunCommandText, parseFunCommand, routeFunCommand } from '../commands/router.js';
import { formatLevelUp } from '../formatters/rankCard.js';
import { isUserJid } from '../../runtime/contactUtils.js';
import { getFunGroupWhitelistSet } from '../config.js';
import { FUN_PUBLIC_GROUP_COMMANDS } from '../constants.js';
import { isWorldQuietHours } from '../utils/worldQuietHours.js';
import {
  createUserFormatter,
  runWithUserLabels,
  nameOf as labelUser,
  displayNameOnly,
  ensureActorMention,
} from '../utils/userLabel.js';
import { tryPassiveQmpVote } from '../commands/handlers/qmp.js';
import { listCanonicalGroupParticipantJids } from '../utils/identity.js';

const reportDebug = (hypothesisId, location, msg, data = {}) => { void Promise.resolve().then(() => fetch(process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: process.env.DEBUG_SESSION_ID || 'persona-runtime-signals', runId: 'pre-fix', hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }) })).catch(() => {}); };
const jidDomain = (jid) => String(jid || '').includes('@') ? `@${String(jid).split('@').pop()}` : '';

/**
 * Respostas no privado desabilitadas por padrão (ban/spam do WhatsApp).
 * Mesmo com replyCommandsInPrivate=true no config, o pipeline NÃO envia DM —
 * tudo cai no chat atual (grupo). Flag mantida só por compat de testes legados.
 *
 * @param {string|null|undefined} command
 * @param {object} funConfig
 * @param {boolean} isGroup
 */
export function shouldReplyCommandInPrivate(command, funConfig, isGroup) {
  void command;
  void funConfig;
  void isGroup;
  // Hard-off: DM do bot = risco alto de restrição WhatsApp
  return false;
}

/**
 * Elegibilidade de escopo.
 * - Grupo: whitelist.
 * - DM: allowDm; scope real resolvido depois (membership + preferred group).
 */
export function resolveFunScope({
  chatJid,
  isGroup,
  funConfig,
  groupWhitelist,
}) {
  if (!funConfig?.enabled) {
    return { eligible: false, reason: 'disabled' };
  }

  if (!isGroup) {
    if (funConfig.allowDm === false) {
      return { eligible: false, reason: 'dm-disabled' };
    }
    // scopeKey preenchido após validar membership
    return { eligible: true, scopeKey: '', reason: 'dm-pending', isDm: true };
  }

  const jid = String(chatJid || '');
  if (!jid.endsWith('@g.us')) {
    return { eligible: false, reason: 'not-group' };
  }

  if (funConfig.requireGroupWhitelist) {
    const set =
      groupWhitelist instanceof Set
        ? groupWhitelist
        : getFunGroupWhitelistSet({ groupWhitelistJids: groupWhitelist || [] });
    if (set.size === 0 || !set.has(jid)) {
      return { eligible: false, reason: 'not-whitelisted' };
    }
  }

  return { eligible: true, scopeKey: jid, reason: 'group', isDm: false };
}

function isCountableMessage({ text, messageType }) {
  const t = String(text ?? '').trim();
  if (t) return true;
  const type = String(messageType || '').toLowerCase();
  if (!type || type === 'unknown' || type === 'text') return false;
  return ['image', 'video', 'audio', 'document', 'sticker', 'ptt', 'album'].includes(type);
}

function extractPreferenceMemory(text) {
  const body = String(text || '').trim();
  if (!body) return null;

  const m = body.match(/\beu\s+(?:adoro|gosto\s+de|curto)\s+(.+?)\??$/iu);
  if (!m) return null;

  const subject = String(m[1] || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/^o\s+/iu, 'o ')
    .slice(0, 120);

  if (!subject || subject.length < 3) return null;

  return {
    extras: `adora ${subject}`,
    lore: `curte ${subject}`,
    keywords: ['gosto', 'preferencia', ...subject.toLowerCase().split(/\s+/).slice(0, 4)],
  };
}

/**
 * @returns {Promise<{ handled: boolean, skipFlows: boolean, passiveXp?: object|null }>}
 */
export async function handleFunIncomingMessage(deps, ctx) {
  const {
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
    eventAggregationService,
    groupEventRepository,
    eventService,
    casinoService,
    tarotService,
    marketService,
    stockService,
    jobService,
    chaosService,
    chaosEventService,
    propertyService,
    houseService,
    houseLinkService,
    avatarService,
    visitService,
    giftService,
    robberyService,
    roastService,
    newsService,
    journalMessageRepository,
    personaRecentMessageRepository,
    personaFollowupService,
    achievementService,
    cardService,
    qmpService,
    casinoRepository,
    groupMemoryService,
    personaSocialHintService,
    personaService,
    personaContextService,
    loreReconciliationService,
    threadContextService,
    memoryIngestionService,
    memoryDecayService,
    personaIdentityService,
    socialMemoryService,
    profileService,
    socialHooks,
    flavorService,
    reactionMediaService,
    getContactDisplayName,
    listContacts,
    sendText,
    sendImage,
    sendSticker,
    getGroupWhitelistJids,
    getLogger,
    identityMap,
    membershipService,
    prefsRepository,
    nsfwVoteRepository,
    nsfwService,
    dailyChallengeService,
    imageGenerationService,
    farewellService,
  } = deps;

  const {
    sock,
    chatJid,
    actorJid,
    isGroup,
    text,
    messageType,
    mediaMimeType = '',
    appConfig,
    mentionedJids = [],
    rawMentionedJids = [],
    quotedParticipant = '',
    quotedMessageId = '',
    quotedText = '',
    messageId = '',
    rawMessage = null,
  } = ctx;

  // Timestamp real da mensagem (enviada pelo usuário, não processada pelo bot)
  const rawTs = rawMessage?.messageTimestamp;
  const msgTimeMs = rawTs
    ? (typeof rawTs === 'number' ? rawTs : Number(rawTs)) * 1000
    : Date.now();

  if (!funConfig?.enabled) {
    return { handled: false, skipFlows: false };
  }

  const groupWhitelist =
    typeof getGroupWhitelistJids === 'function'
      ? getGroupWhitelistJids(appConfig || funConfig)
      : getFunGroupWhitelistSet(funConfig);

  const scope = resolveFunScope({
    chatJid,
    isGroup,
    funConfig,
    groupWhitelist,
  });

  if (!scope.eligible) {
    return { handled: false, skipFlows: false, reason: scope.reason };
  }

  let userJid = String(actorJid || '').trim();
  // Em DM o actor pode ser o remoteJid se actorJid vazio
  if ((!userJid || !isUserJid(userJid)) && !isGroup && isUserJid(chatJid)) {
    userJid = String(chatJid).trim();
  }
  if (!userJid || !isUserJid(userJid)) {
    return { handled: false, skipFlows: false, reason: 'no-actor' };
  }
  // Prefer PN canônico para DM (mapa lid→pn se existir)
  if (identityMap?.resolve) {
    const resolved = String(identityMap.resolve(userJid) || '').trim();
    if (resolved && isUserJid(resolved)) userJid = resolved;
  }

  const prefix = funConfig.prefix || '/';
  const parsedCommand = parseFunCommand(text, prefix);
  const isCommand = parsedCommand != null;
  const isDm = Boolean(scope.isDm);

  // O jornal mantém sua própria fonte por grupo: texto bruto de retenção curta,
  // escrito de forma observacional para nunca atrasar o caminho crítico.
  if (isGroup && scope.scopeKey && funConfig.groupNewsMessageHistoryEnabled !== false) {
    try {
      journalMessageRepository?.recordMessage?.({
        scopeKey: scope.scopeKey,
        messageId,
        authorJid: userJid,
        source: 'human',
        messageType,
        text,
        quotedText,
        mentionedJids,
        now: msgTimeMs,
        prefix,
      });
    } catch {
      // captura do jornal nunca quebra a mensagem, comando ou persona
    }
  }

  // DM: só comandos (jogos com continuidade, saldo, etc.) — sem XP passivo
  if (isDm && funConfig.dmCommandsOnly !== false && !isCommand) {
    return { handled: false, skipFlows: false, reason: 'dm-commands-only' };
  }

  // Resolve escopo real no privado (membership whitelist)
  if (isDm) {
    const replyDmEarly = async (body) => {
      if (typeof sendText !== 'function') return;
      const content = String(body || '').trim();
      if (!content) return;
      await sendText(sock, userJid, content);
    };

    if (parsedCommand?.command === 'group_scope') {
      // /grupo funciona mesmo sem preferred (lista memberships)
      // scope placeholder; handler resolve membership
      scope.scopeKey = '';
      scope.reason = 'dm-group-pick';
    } else if (membershipService?.resolveDmScope && prefsRepository) {
      const prefs = prefsRepository.get(userJid);
      const dm = await membershipService.resolveDmScope({
        sock,
        userJid,
        funConfig,
        preferredScopeKey: prefs.preferredScopeKey,
        lastGroupJid: prefs.lastGroupJid,
      });

      if (!dm.ok) {
        if (dm.reason === 'need-group-pick') {
          const lines = [
            'Você está em *vários* grupos liberados.',
            'Escolha o escopo pro privado com `/grupo`:',
            '',
          ];
          (dm.groups || []).forEach((g, i) => {
            lines.push(`${i + 1}. *${g.name || 'Grupo'}*`);
          });
          lines.push('', 'Ex.: `/grupo 1`');
          await replyDmEarly(lines.join('\n'));
          return {
            handled: true,
            skipFlows: true,
            reason: 'need-group-pick',
            isDm: true,
          };
        }
        if (dm.reason === 'not-member' || dm.reason === 'no-whitelist' || dm.reason === 'dm-needs-whitelist') {
          await replyDmEarly(
            [
              'Privado só funciona se você for *membro de um grupo liberado* deste bot.',
              'Entre no grupo da whitelist e use os comandos no privado de novo.',
            ].join('\n')
          );
          return {
            handled: true,
            skipFlows: true,
            reason: dm.reason,
            isDm: true,
          };
        }
        return { handled: false, skipFlows: false, reason: dm.reason || 'dm-scope-fail' };
      }

      scope.scopeKey = dm.scopeKey;
      scope.reason = `dm:${dm.source}`;
      scope.dmGroups = dm.groups;
      // grava preferred se veio de single/last
      if (dm.source === 'single' || dm.source === 'last-group') {
        prefsRepository.setPreferredScope?.(userJid, dm.scopeKey);
      }
    } else {
      // fallback sem membership service (testes legados): não aceita DM
      return { handled: false, skipFlows: false, reason: 'dm-membership-unavailable' };
    }
  }

  if (!scope.scopeKey && parsedCommand?.command !== 'group_scope') {
    return { handled: false, skipFlows: false, reason: 'no-scope' };
  }

  // Purga: registra atividade de chat do jogador no escopo.
  // Fonte canônica do chaosEventService — independe do TMB.
  // Cobertura: toda mensagem recebida (comando ou não), em grupo ou DM com scope.
  if (scope.scopeKey && userJid) {
    try {
      chaosEventService?.registerActivity?.(scope.scopeKey, userJid, msgTimeMs);
    } catch {
      // tracker nunca pode derrubar o pipeline
    }
  }

  // Em grupo: memoriza last group pro DM
  if (!isDm && scope.scopeKey?.endsWith?.('@g.us') && prefsRepository?.touchLastGroup) {
    try {
      prefsRepository.touchLastGroup(userJid, scope.scopeKey);
    } catch {
      // ignore
    }
  }

  const effectiveRates =
    typeof groupRepository?.resolveEffectiveRates === 'function' && scope.scopeKey
      ? groupRepository.resolveEffectiveRates(scope.scopeKey, funConfig)
      : {
          enabled: true,
          xpMin: funConfig.xpMin,
          xpMax: funConfig.xpMax,
          cooldownMs: funConfig.cooldownMs,
          levelUpAnnounce: funConfig.announceLevelUp !== false,
          dailyXp: funConfig.dailyXp,
          dailyCoins: funConfig.dailyCoins,
          rankLimit: funConfig.rankLimit,
          worldEventsEnabled: true,
          source: 'global',
        };

  if (effectiveRates.enabled === false) {
    return { handled: false, skipFlows: false, reason: 'group-disabled' };
  }

  // No DM a resposta já é privada (chatJid = user)
  const preferPrivate = shouldReplyCommandInPrivate(
    parsedCommand?.command,
    funConfig,
    isGroup
  );

  const userFmt = createUserFormatter({
    getContactDisplayName,
    mentionUsers: funConfig.mentionUsers !== false,
    resolveNickname: (jid) => {
      if (!profileService?.getNickname || !scope?.scopeKey) return '';
      try {
        return profileService.getNickname(jid, scope.scopeKey) || '';
      } catch {
        return '';
      }
    },
  });
  const formatUser = (jid) => userFmt.formatUser(jid);

  // Mensagem original (WAMessage) para reply/citação no WhatsApp
  const quoteSource =
    rawMessage && typeof rawMessage === 'object' && rawMessage.key ? rawMessage : null;
  const useQuoted = funConfig.replyQuoted !== false && Boolean(quoteSource);

  /**
   * Toda resposta em grupo marca o autor do comando (quem disparou),
   * para não se perder com várias pessoas jogando ao mesmo tempo.
   */
  const withActorTag = (body) =>
    ensureActorMention(body, userJid, {
      mentionUsers: funConfig.mentionUsers !== false,
      isGroup,
      track: (j) => userFmt.trackMention(j),
    });

  const buildSendOpts = (mentions = []) => {
    const opts = {};
    if (mentions.length) opts.mentions = mentions;
    if (useQuoted) opts.quoted = quoteSource;
    return Object.keys(opts).length ? opts : undefined;
  };

  const recordJournalBotMessage = (sent, content) => {
    if (!isGroup || funConfig.groupNewsMessageHistoryEnabled === false) return;
    const messageId = String(sent?.key?.id || '').trim();
    if (!messageId) return;
    try {
      journalMessageRepository?.recordMessage?.({
        scopeKey: scope.scopeKey,
        messageId,
        source: 'bot',
        messageType: 'text',
        text: content,
        now: Date.now(),
        prefix,
      });
    } catch {
      // registro conversacional não pode afetar a resposta já entregue
    }
  };

  const replyToChat = async (body) => {
    if (typeof sendText !== 'function') return;
    const content = withActorTag(String(body || '').trim());
    if (!content) return;
    const mentions = userFmt.takeMentions();
    const sent = await sendText(sock, chatJid, content, buildSendOpts(mentions));
    recordJournalBotMessage(sent, content);
  };

  /**
   * Legado: handlers que pediam “privado” agora vão pro MESMO chat (grupo).
   * Nunca envia 1:1 — evita ban por spam do WhatsApp.
   */
  const replyPrivate = async (body) => {
    await replyToChat(body);
  };

  /** Sempre no chat atual (grupo ou DM se o user escreveu no PV). */
  const reply = async (body) => {
    await replyToChat(body);
  };

  const replyImage = async (imageBuffer, caption = '') => {
    if (typeof sendImage !== 'function') return;
    // caption também identifica o autor no grupo
    const cap = withActorTag(String(caption || '').trim());
    const mentions = userFmt.takeMentions();
    const sendOpts = buildSendOpts(mentions);
    await sendImage(
      sock,
      chatJid,
      {
        imageBuffer,
        caption: cap,
        mimeType: 'image/png',
        mentions,
      },
      sendOpts
    );
  };

  const replyImageUrl = async (imageUrl, caption = '', mimeType = '') => {
    if (typeof sendImage !== 'function') return;
    const url = String(imageUrl || '').trim();
    if (!url) return;
    const cap = withActorTag(String(caption || '').trim());
    const mentions = userFmt.takeMentions();
    const sendOpts = buildSendOpts(mentions);

    const ua = 'TooManyBots-Fun/1.0 (https://github.com/anomalyco/TooManyBots_Interpreter)';

    let imageBuffer;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': ua },
      });
      if (!response.ok) throw new Error(`fetch-${response.status}`);
      imageBuffer = Buffer.from(await response.arrayBuffer());
    } catch {
      await sendImage(sock, chatJid, { imageUrl: url, caption: cap, mimeType, mentions }, sendOpts);
      return;
    }

    await sendImage(
      sock,
      chatJid,
      { imageBuffer, caption: cap, mimeType, mentions },
      sendOpts
    );
  };

  /** Figurinha sempre no chat atual (grupo ou DM), não no “modo privado de rank”. */
  const replySticker = async (stickerBuffer) => {
    if (typeof sendSticker !== 'function') {
      throw new Error('sticker-sender-unavailable');
    }
    await sendSticker(sock, chatJid, stickerBuffer, useQuoted ? { quoted: quoteSource } : undefined);
  };

  const worldEventsOn = effectiveRates?.worldEventsEnabled !== false;

  /** Sorteio de evento pelo bot — anúncio sempre no grupo.
   *  world events off → só happy hour (trégua e mercado auto ficam off).
   *  happyHourAutoEnabled=false no grupo → happy hour nunca dispara
   *  (mesma semântica granular do relógio do mundo, fun/index.js).
   */
  async function maybeAutoEvent(now = Date.now()) {
    if (!isGroup || !eventService?.tryAutoSpawn) return null;
    if (isWorldQuietHours(funConfig, now)) return null;
    if (
      typeof groupRepository?.isGranularEventEnabled === 'function' &&
      groupRepository.isGranularEventEnabled(scope.scopeKey, 'happyHour', funConfig) === false
    ) {
      return null; // grupo desativou happy hour — não sorteia
    }
    try {
      const spawned = eventService.tryAutoSpawn({
        scopeKey: scope.scopeKey,
        funConfig,
        now,
        happyOnly: !worldEventsOn,
      });
      if (!spawned?.ok) return null;
      const msg =
        typeof eventService.formatAnnouncement === 'function'
          ? eventService.formatAnnouncement(spawned)
          : '';
      if (msg) await replyToChat(msg);
      return spawned;
    } catch (err) {
      getLogger?.()?.debug?.(
        { err: { message: err?.message || 'auto-event' } },
        'Fun auto-event failed'
      );
      return null;
    }
  }

  /** Evento de mercado de arte (preços da galeria). */
  async function maybeAutoMarket(now = Date.now()) {
    if (!isGroup || !marketService?.tryAutoMarketEvent) return null;
    if (!worldEventsOn) return null;
    if (isWorldQuietHours(funConfig, now)) return null;
    if (
      typeof groupRepository?.isGranularEventEnabled === 'function' &&
      groupRepository.isGranularEventEnabled(scope.scopeKey, 'market', funConfig) === false
    ) {
      return null; // grupo desativou mercado auto — não anuncia
    }
    try {
      const hit = await marketService.tryAutoMarketEvent({
        scopeKey: scope.scopeKey,
        funConfig,
        now,
      });
      if (!hit?.ok || !hit.announce) return hit;
      const msg = marketService.formatEventAnnouncement(hit, getContactDisplayName);
      if (msg) await replyToChat(msg);
      // se quebrou item, tenta avisar o dono no PV
      if (hit.broken?.userJid && typeof sendText === 'function') {
        try {
          await sendText(
            sock,
            hit.broken.userJid,
            [
              '💥 *Sua peça quebrou no ateliê!*',
              `*${hit.broken.itemName}* precisa de conserto (*${hit.broken.repairCost}* coins).`,
              `\`/consertar ${String(hit.broken.inventoryId).slice(0, 8)}\` · \`/inventario\``,
            ].join('\n')
          );
        } catch {
          // ignore DM fail
        }
      }
      return hit;
    } catch (err) {
      getLogger?.()?.debug?.(
        { err: { message: err?.message || 'auto-market' } },
        'Fun auto-market failed'
      );
      return null;
    }
  }

  /** Quem é Mais Provável? — chance pequena por mensagem normal do grupo. */
  async function maybeAutoQmp(now = Date.now()) {
    if (!isGroup || !qmpService?.tryAutoTrigger) return null;
    if (funConfig.qmpEnabled === false) return null;
    if (isWorldQuietHours(funConfig, now)) return null;
    try {
      const hit = await qmpService.tryAutoTrigger({
        scopeKey: scope.scopeKey,
        funConfig,
        now,
        getParticipantJids: async () => {
          const members = await listCanonicalGroupParticipantJids(
            sock,
            scope.scopeKey,
            identityMap
          );
          return [...new Set([...members, userJid])];
        },
      });
      if (!hit?.ok || !hit.question) return hit;
      const msg = qmpService.formatQuestionAnnouncement(hit.question, {
        voteCount: 0,
        auto: true,
      });
      if (msg) await replyToChat(msg);
      return hit;
    } catch (err) {
      getLogger?.()?.debug?.(
        { err: { message: err?.message || 'auto-qmp' } },
        'Fun auto-QMP failed'
      );
      return null;
    }
  }

  // Buffer próprio da persona: contexto conversacional curto e persistente.
  // Não é o jornal diário e nunca afeta o fluxo principal se a gravação falhar.
  if (isGroup && scope.scopeKey && funConfig.personaImmediateContextEnabled !== false) {
    try {
      personaRecentMessageRepository?.recordMessage?.({
        scopeKey: scope.scopeKey,
        messageId,
        authorJid: userJid,
        authorLabel: displayNameOnly(getContactDisplayName, userJid),
        source: 'human',
        messageType,
        text,
        quotedText,
        mentionedJids,
        now: msgTimeMs,
      });
      personaFollowupService?.observeHumanMessage?.({
        scopeKey: scope.scopeKey,
        messageId,
        now: Date.now(),
      });
      if (Math.random() < 0.01) {
        personaRecentMessageRepository?.pruneOlderThan?.(
          scope.scopeKey,
          msgTimeMs - (Number(funConfig.personaImmediateContextRetentionMs) || 24 * 60 * 60_000)
        );
      }
    } catch {
      // contexto imediato nunca quebra comando, XP ou persona
    }
  }

  // Lore seletiva: observa chat do grupo (async extract em batch; ignora comandos)
  if (isGroup && groupMemoryService?.observeMessage && scope.scopeKey) {
    try {
      groupMemoryService.observeMessage({
        scopeKey: scope.scopeKey,
        userJid,
        text,
        messageType,
        messageId,
        quotedText,
        quotedParticipant,
        quotedParticipantName: quotedParticipant && typeof getContactDisplayName === 'function'
          ? getContactDisplayName(quotedParticipant)
          : '',
        mentionedJids: Array.isArray(mentionedJids) ? mentionedJids : [],
        funConfig,
        now: Date.now(),
        isGroup: true,
      });
    } catch {
      // memória nunca quebra o fluxo
    }
  }

  const preferenceMemory = isGroup && scope.scopeKey ? extractPreferenceMemory(text) : null;
  if (preferenceMemory) {
    try {
      profileService?.appendPreference?.({
        userJid,
        scopeKey: scope.scopeKey,
        preference: preferenceMemory.extras,
        funConfig,
        now: Date.now(),
      });
    } catch {
      // perfil nunca quebra o fluxo
    }
    try {
      groupMemoryService?._pushRaw?.(scope.scopeKey, {
        userJid,
        name: displayNameOnly(getContactDisplayName, userJid),
        text: preferenceMemory.lore,
        at: Date.now(),
      });
    } catch {
      // lore nunca quebra o fluxo
    }
  }

  // Eventos de grupo são observacionais: a extração pode usar LLM, mas nunca atrasa
  // comandos, XP ou a persona. `msgTimeMs` mantém "amanhã" ancorado no envio real.
  if (isGroup && eventAggregationService?.observeMessage && scope.scopeKey) {
    void eventAggregationService.observeMessage({
      scopeKey: scope.scopeKey,
      userJid,
      text,
      messageId,
      quotedText,
      mentionedJids,
      msgTimeMs,
      funConfig,
      getContactDisplayName,
      isGroup: true,
    }).catch((err) => {
      getLogger?.()?.debug?.('[fun/events] observação falhou: %s', String(err?.message || err));
    });
  }

  // Inferência social roda em lote e nunca aguarda o LLM no caminho da mensagem.
  if (isGroup && personaSocialHintService?.observeMessage && scope.scopeKey) {
    try {
      personaSocialHintService.observeMessage({
        scopeKey: scope.scopeKey, userJid, text, messageType, funConfig, now: Date.now(), isGroup: true,
      });
    } catch {
      // pistas sociais nunca quebram o fluxo
    }
  }

  // Persona (Bot Membro Vivo): observa estilo do grupo e tenta responder passivamente
  // após o roteamento de comandos. Nunca quebra o pipeline.
  if (isGroup && personaService && scope.scopeKey) {
    try {
      // Pedido explícito para esquecer/corrigir lore é reconciliado fora do
      // caminho crítico da mensagem. A LLM só escolhe IDs da lore deste grupo.
      if (!isCommand && loreReconciliationService?.observe) {
        void loreReconciliationService.observe({
          scopeKey: scope.scopeKey,
          text,
          funConfig,
          now: msgTimeMs,
        }).catch(() => {});
      }
      if (personaService.observeMessage) {
        personaService.observeMessage({
          scopeKey: scope.scopeKey,
          userJid,
          text,
          messageType,
          funConfig,
          now: Date.now(),
        });
        // Deriva/persiste o perfil de voz do grupo com debounce interno (não grava a cada msg).
        personaService.maybeDeriveProfile?.(scope.scopeKey, funConfig, Date.now());
      }
      const memoryEvent = {
        scopeKey: scope.scopeKey, authorJid: userJid, text, messageId, quotedMessageId,
        mentionedJids, occurredAt: msgTimeMs, threadTtlMs: funConfig.personaThreadTtlMs,
        maxContextItems: funConfig.personaMemoryMaxContextItems, funConfig,
      };
      const resolvedThread = funConfig.personaMemoryEnabled !== false && threadContextService
        ? threadContextService.resolve(memoryEvent).thread
        : null;
      if (funConfig.personaMemoryEnabled !== false) {
        try {
          const ingestion = memoryIngestionService?.observe?.({ ...memoryEvent, threadKey: resolvedThread?.threadKey || '' });
          const memory = ingestion?.ok !== false ? ingestion?.memory : null;
          if (memory?.factKey && memory?.subjectUserJid) {
            memoryDecayService?.reconcile?.({
              scopeKey: memory.scopeKey,
              subjectUserJid: memory.subjectUserJid,
              factKey: memory.factKey,
              now: msgTimeMs,
            });
          }
          threadContextService?.observe?.(memoryEvent, resolvedThread);
          memoryDecayService?.expireScope?.(scope.scopeKey, msgTimeMs);
          const socialSignal = socialMemoryService?.observe?.(memoryEvent);
          personaIdentityService?.refresh?.({
            scopeKey: scope.scopeKey,
            ...socialMemoryService?.toIdentityInput?.(socialSignal),
            now: msgTimeMs,
          });
        } catch { /* memória observacional não interrompe o pipeline */ }
      }
      if (personaService.tryRespond && !isCommand) {
        const responseContextPack = funConfig.personaMemoryEnabled !== false && personaContextService
          ? personaContextService.build(memoryEvent)
          : null;
        const groupSettings = groupRepository?.getGroupSettings
          ? groupRepository.getGroupSettings(scope.scopeKey)
          : null;
        getLogger?.()?.info?.(
          '[persona-debug] tryRespond chamado scope=%s text=%j mentionedJids=%j quoted=%j msgType=%s settingsPersona=%s',
          scope.scopeKey, String(text || '').slice(0, 80), mentionedJids, quotedParticipant, messageType, groupSettings?.personaEnabled
        );
        // #region debug-point persona-runtime-D
        reportDebug('D', 'pipeline.before-personaService.tryRespond', 'tentativa de persona', { isGroup: Boolean(isGroup), scopeDomain: jidDomain(scope.scopeKey), isCommand: Boolean(isCommand), messageType: String(messageType || ''), mentionedCount: mentionedJids.length, mentionedDomains: [...new Set(mentionedJids.map(jidDomain).filter(Boolean))], hasQuotedParticipant: Boolean(quotedParticipant), quotedDomain: jidDomain(quotedParticipant), hasQuotedMessageId: Boolean(quotedMessageId), groupPersonaEnabled: groupSettings?.personaEnabled, sockUser: { id: Boolean(sock?.user?.id), lid: Boolean(sock?.user?.lid), pn: Boolean(sock?.user?.pn), jid: Boolean(sock?.user?.jid) } });
        // #endregion
        void personaService.tryRespond({
          scopeKey: scope.scopeKey,
          text,
          mentionedJids,
          rawMentionedJids,
          quotedParticipant,
          quotedMessageId,
          quotedText,
          quoteSource,
          rawMessage: rawMessage || ctx.rawMessage || quoteSource,
          responseContextPack,
          authorJid: userJid,
          messageType,
          sock,
          identityMap,
          groupSettings,
          funConfig,
          replyImageUrl,
          replySticker,
          now: Date.now(),
        }).then((r) => {
          if (r?.responded) {
            personaFollowupService?.observePersonaResponse?.({
              scopeKey: scope.scopeKey,
              responseMessageIds: r.responseMessageIds,
              trigger: r.trigger,
              now: Date.now(),
            });
          }
          // #region debug-point persona-runtime-D-result
          reportDebug('D', 'pipeline.personaService.tryRespond.result', 'resultado da persona', { responded: Boolean(r?.responded), reason: String(r?.reason || ''), usedFallback: Boolean(r?.usedFallback) });
          // #endregion
          getLogger?.()?.info?.(
            '[persona-debug] tryRespond resultado responded=%s reason=%s usedFallback=%s',
            r?.responded, r?.reason, r?.usedFallback
          );
        }).catch((err) => {
          // #region debug-point persona-runtime-E-result-error
          reportDebug('E', 'pipeline.personaService.tryRespond.error', 'erro da persona', { errorName: String(err?.name || 'Error') });
          // #endregion
          getLogger?.()?.warn?.('[persona-debug] tryRespond erro: %s', String(err?.message || err));
          // persona nunca quebra o pipeline
        });
      }
    } catch {
      // persona nunca quebra o pipeline
    }
  } else {
    getLogger?.()?.debug?.(
      '[persona-debug] skip isGroup=%s personaService=%s scopeKey=%s',
      isGroup, Boolean(personaService), scope.scopeKey
    );
  }

  // Purga: resposta de defesa — usa msgTimeMs (hora enviada no WhatsApp), não Date.now().
  // Baileys pode entregar com atraso; o prazo é justo com o timestamp da mensagem.
  if (chaosEventService?.checkMessageForChallenge) {
    try {
      const challengeText = String(text || '').replace(/^[/\\]/, '').trim();
      const challengeResult = chaosEventService.checkMessageForChallenge(
        scope.scopeKey,
        userJid,
        challengeText,
        msgTimeMs || Date.now()
      );
      if (challengeResult?.matched) {
        const r = challengeResult.result;
        if (r?.attackerJid && r.attackerJid !== userJid) {
          userFmt.trackMention(r.attackerJid);
        }
        if (r?.defended) {
          await reply('🧮 *Conta certa!* Você se defendeu e o assalto foi bloqueado.');
        } else if (r?.timedOut) {
          await reply(
            `⏰ *Tempo esgotou!* Perdeu *${r.stolen ?? 0}* coins.` +
            (r.expression != null ? ` (A conta era: ${r.expression} = ${r.correctAnswer})` : '')
          );
        } else if (r?.defended === false) {
          await reply(
            `❌ *Conta errada.* Perdeu *${r.stolen ?? 0}* coins.` +
            (r.expression != null ? ` (A conta era: ${r.expression} = ${r.correctAnswer})` : '')
          );
        }
        return { handled: true, skipFlows: true, reason: 'challenge-answered' };
      }
    } catch {
      // Defesa nunca pode derrubar o pipeline sob carga
    }
  }

  if (isCommand) {
    try {
      return await runWithUserLabels(userFmt, async () => {
        // Comandos de mesa/social só no grupo
        if (
          isDm &&
          parsedCommand?.command &&
          FUN_PUBLIC_GROUP_COMMANDS.has(parsedCommand.command) &&
          parsedCommand.command !== 'group_scope'
        ) {
          await reply(
            [
              'Esse comando é *só no grupo* (duelo, panelinha, social…).',
              'No privado: jogos solo (`/bj`, `/crash`, `/roleta`, `/slot`), saldo, daily, rank…',
              'Escolher grupo: `/grupo`',
            ].join('\n')
          );
          return { handled: true, skipFlows: true, reason: 'dm-group-only-command' };
        }

        const result = await routeFunCommand({
          text,
          funConfig,
          userJid,
          chatJid,
          isGroup,
          scopeKey: scope.scopeKey,
          rankService,
          dailyService,
          coinsService,
          relationshipService,
          gameService,
          shopService,
          effectsRepository,
          repository,
          factionService,
          bridgeService,
          missionService,
          eventService,
          groupEventRepository,
          casinoService,
          tarotService,
          marketService,
          stockService,
          jobService,
          chaosService,
          chaosEventService,
          propertyService,
          houseService,
          houseLinkService,
          avatarService,
          visitService,
          giftService,
          robberyService,
          roastService,
          newsService,
          achievementService,
          cardService,
          qmpService,
          casinoRepository,
          groupMemoryService,
          profileService,
          socialHooks,
          flavorService,
          reactionMediaService,
          getContactDisplayName,
          formatUser,
          listContacts,
          reply,
          replyPrivate,
          replyToChat,
          replyImage,
          replyImageUrl,
          replySticker,
          mentionedJids,
          quotedParticipant,
          effectiveRates,
          sock,
          identityMap,
          preferPrivate,
          membershipService,
          prefsRepository,
          nsfwVoteRepository,
          nsfwService,
          dailyChallengeService,
          imageGenerationService,
          farewellService,
          dmGroups: scope.dmGroups || null,
          rawMessage,
          messageType,
          mediaMimeType: mediaMimeType || ctx.mediaMimeType || '',
          getLogger,
          msgTimeMs,
          messageId,
          messageKey: rawMessage?.key || null,
        });

        // evento surpresa + mercado de arte só em grupo
        if (!isDm) {
          await maybeAutoEvent(Date.now());
          await maybeAutoMarket(Date.now());
        }

        const skipFlows = Boolean(funConfig.commandExclusive && result?.handled);
        return {
          handled: Boolean(result?.handled),
          skipFlows,
          isCommand: true,
        };
      });
    } catch (error) {
      getLogger?.()?.error?.(
        {
          err: {
            name: error?.name || 'Error',
            message: error?.message || 'fun-command-failed',
          },
          chatJid,
          userJid,
        },
        'Fun command failed'
      );
      return { handled: false, skipFlows: false, isCommand: true, error: true };
    }
  }

  if (!isCountableMessage({ text, messageType })) {
    return { handled: false, skipFlows: false, reason: 'not-countable' };
  }

  // QMP: menção em mensagem normal conta como voto se houver rodada ativa
  if (isGroup && mentionedJids?.length && qmpService) {
    try {
      const passiveVote = await runWithUserLabels(userFmt, async () =>
        tryPassiveQmpVote({
          userJid,
          scopeKey: scope.scopeKey,
          isGroup,
          funConfig,
          qmpService,
          text,
          mentionedJids,
          getContactDisplayName,
          listContacts,
          reply,
          sock,
          identityMap,
        })
      );
      if (passiveVote?.voted) {
        // ainda deixa XP passivo seguir; voto não engole a mensagem
      }
    } catch {
      // voto passivo nunca quebra o pipeline
    }
  }

  try {
    const now = Date.now();
    // Roleta russa: morto virtualmente não ganha XP passivo
    if (effectsRepository?.isXpBlocked) {
      const dead = effectsRepository.isXpBlocked(userJid, scope.scopeKey, now);
      if (dead.blocked) {
        return {
          handled: false,
          skipFlows: false,
          reason: 'xp-morto',
          xpBlockedUntil: dead.expiresAt,
        };
      }
    }

    let xpMin = effectiveRates.xpMin;
    let xpMax = effectiveRates.xpMax;
    if (effectsRepository) {
      const boost = effectsRepository.isXpBoostActive(userJid, scope.scopeKey, now);
      if (boost.active) {
        const m = Number(boost.multiplier) || 2;
        xpMin = Math.floor(xpMin * m);
        xpMax = Math.floor(xpMax * m);
      }
    }

    const award = xpService.awardXp({
      userJid,
      scopeKey: scope.scopeKey,
      now,
      cooldownMs: effectiveRates.cooldownMs,
      xpMin,
      xpMax,
    });

    if (award.applied && award.leveledUp && effectiveRates.levelUpAnnounce) {
      await runWithUserLabels(userFmt, async () => {
        const name = labelUser(getContactDisplayName, userJid);
        let text = formatLevelUp({
          displayName: name,
          userJid,
          previousLevel: award.previousLevel,
          level: award.level,
          xp: award.xp,
          mentionUsers: funConfig.mentionUsers !== false,
        });
        if (flavorService?.italicLine) {
          try {
            let groupLore = '';
            if (groupMemoryService?.buildLoreContext) {
              try {
                groupLore = groupMemoryService.buildLoreContext(scope.scopeKey, {
                  userJids: [userJid],
                  limit: Infinity,
                  funConfig,
                });
              } catch {
                groupLore = '';
              }
            }
            if (profileService?.buildIdentityBlock) {
              try {
                const idBlock = profileService.buildIdentityBlock(
                  scope.scopeKey,
                  [userJid],
                  funConfig
                );
                if (idBlock) {
                  groupLore = groupLore ? `${groupLore}\n${idBlock}` : idBlock;
                }
              } catch {
                // ignore
              }
            }
            // LLM: nome legível / nick, sem @ (evita ruído no prompt)
            const plain = displayNameOnly(getContactDisplayName, userJid);
            const fl = await flavorService.italicLine('level_up', {
              level: award.level,
              user: plain || userJid?.split?.('@')?.[0] || '',
              groupLore,
            });
            if (fl) text = `${text}\n${fl}`;
          } catch {
            // flavor opcional
          }
        }
        await reply(text);
      });
    }

    // evento surpresa + mercado + QMP em mensagem normal do grupo
    if (award.applied) {
      await runWithUserLabels(userFmt, async () => {
        await maybeAutoEvent(now);
        await maybeAutoMarket(now);
        await maybeAutoQmp(now);
      });
    }

    return {
      handled: false,
      skipFlows: false,
      passiveXp: award,
    };
  } catch (error) {
    getLogger?.()?.error?.(
      {
        err: {
          name: error?.name || 'Error',
          message: error?.message || 'fun-xp-failed',
        },
        chatJid,
        userJid,
      },
      'Fun passive XP failed'
    );
    return { handled: false, skipFlows: false, error: true };
  }
}
