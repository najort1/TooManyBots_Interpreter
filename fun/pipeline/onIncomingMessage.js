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
  ensureActorMention,
} from '../utils/userLabel.js';

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
  return ['image', 'video', 'audio', 'document', 'sticker', 'ptt'].includes(type);
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
    quotedParticipant = '',
    rawMessage = null,
  } = ctx;

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

  const replyToChat = async (body) => {
    if (typeof sendText !== 'function') return;
    const content = withActorTag(String(body || '').trim());
    if (!content) return;
    const mentions = userFmt.takeMentions();
    await sendText(sock, chatJid, content, buildSendOpts(mentions));
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
   */
  async function maybeAutoEvent(now = Date.now()) {
    if (!isGroup || !eventService?.tryAutoSpawn) return null;
    if (isWorldQuietHours(funConfig, now)) return null;
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

  // Lore seletiva: observa chat do grupo (async extract em batch; ignora comandos)
  if (isGroup && groupMemoryService?.observeMessage && scope.scopeKey) {
    try {
      groupMemoryService.observeMessage({
        scopeKey: scope.scopeKey,
        userJid,
        text,
        messageType,
        funConfig,
        now: Date.now(),
        isGroup: true,
      });
    } catch {
      // memória nunca quebra o fluxo
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
          casinoService,
          tarotService,
          marketService,
          stockService,
          jobService,
          chaosService,
          groupMemoryService,
          socialHooks,
          flavorService,
          getContactDisplayName,
          formatUser,
          listContacts,
          reply,
          replyPrivate,
          replyToChat,
          replyImage,
          replySticker,
          mentionedJids,
          quotedParticipant,
          effectiveRates,
          sock,
          identityMap,
          preferPrivate,
          membershipService,
          prefsRepository,
          dmGroups: scope.dmGroups || null,
          rawMessage,
          messageType,
          mediaMimeType: mediaMimeType || ctx.mediaMimeType || '',
          getLogger,
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
                  limit: 4,
                  funConfig,
                });
              } catch {
                groupLore = '';
              }
            }
            // LLM: nome legível, sem @ (evita ruído no prompt)
            const plain =
              typeof getContactDisplayName === 'function'
                ? getContactDisplayName(userJid)
                : '';
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

    // evento surpresa + mercado em mensagem normal do grupo
    if (award.applied) {
      await runWithUserLabels(userFmt, async () => {
        await maybeAutoEvent(now);
        await maybeAutoMarket(now);
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
