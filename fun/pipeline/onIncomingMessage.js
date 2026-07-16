import { isFunCommandText, parseFunCommand, routeFunCommand } from '../commands/router.js';
import { formatLevelUp } from '../formatters/rankCard.js';
import { isUserJid } from '../../runtime/contactUtils.js';
import { getFunGroupWhitelistSet } from '../config.js';
import { FUN_PUBLIC_GROUP_COMMANDS } from '../constants.js';

/**
 * Com replyCommandsInPrivate: manda no DM, exceto duelo/aposta/facção/social.
 * @param {string|null|undefined} command
 * @param {object} funConfig
 * @param {boolean} isGroup
 */
export function shouldReplyCommandInPrivate(command, funConfig, isGroup) {
  if (!isGroup) return false;
  if (!funConfig?.replyCommandsInPrivate) return false;
  const cmd = String(command || '').trim();
  if (!cmd) return false;
  if (FUN_PUBLIC_GROUP_COMMANDS.has(cmd)) return false;
  return true;
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

  const replyToChat = async (body) => {
    if (typeof sendText !== 'function') return;
    const content = String(body || '').trim();
    if (!content) return;
    await sendText(sock, chatJid, content);
  };

  /** Envia no privado do autor (útil em grupo para não poluir o chat). */
  const replyPrivate = async (body) => {
    if (typeof sendText !== 'function') throw new Error('sendText-unavailable');
    const content = String(body || '').trim();
    if (!content) return;
    const target = userJid || chatJid;
    if (!target || target === chatJid || String(target).endsWith('@g.us')) {
      throw new Error('no-private-target');
    }
    // timeout: Baileys às vezes trava no DM
    await Promise.race([
      sendText(sock, target, content),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('dm-timeout')), 8_000);
      }),
    ]);
  };

  /**
   * Resposta de comando:
   * - preferPrivate: tenta DM; se falhar/timeout → SEMPRE cai no chat onde o comando foi digitado.
   *   (WhatsApp muitas vezes “aceita” o send sem entregar se a pessoa nunca abriu o PV do bot.)
   * - senão: responde no chat atual.
   */
  const reply = async (body) => {
    if (!preferPrivate) {
      await replyToChat(body);
      return;
    }
    try {
      await replyPrivate(body);
    } catch (err) {
      console.warn(
        `[fun] DM falhou (${err?.message || 'erro'}) → respondendo no chat. cmd=${parsedCommand?.command || '?'}`
      );
      getLogger?.()?.warn?.(
        {
          err: { message: err?.message || 'dm-failed' },
          userJid,
          chatJid,
          command: parsedCommand?.command,
        },
        'Fun: falha no DM — caindo pro grupo'
      );
      await replyToChat(body);
    }
  };

  const replyImage = async (imageBuffer, caption = '') => {
    if (typeof sendImage !== 'function') return;
    const target = preferPrivate ? userJid || chatJid : chatJid;
    try {
      await sendImage(sock, target, {
        imageBuffer,
        caption: String(caption || ''),
        mimeType: 'image/png',
      });
    } catch {
      if (preferPrivate && target !== chatJid) {
        await sendImage(sock, chatJid, {
          imageBuffer,
          caption: String(caption || ''),
          mimeType: 'image/png',
        });
      } else {
        throw new Error('reply-image-failed');
      }
    }
  };

  /** Figurinha sempre no chat atual (grupo ou DM), não no “modo privado de rank”. */
  const replySticker = async (stickerBuffer) => {
    if (typeof sendSticker !== 'function') {
      throw new Error('sticker-sender-unavailable');
    }
    await sendSticker(sock, chatJid, stickerBuffer);
  };

  /** Sorteio de evento pelo bot — anúncio sempre no grupo. */
  async function maybeAutoEvent(now = Date.now()) {
    if (!isGroup || !eventService?.tryAutoSpawn) return null;
    try {
      const spawned = eventService.tryAutoSpawn({
        scopeKey: scope.scopeKey,
        funConfig,
        now,
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

  if (isCommand) {
    try {
      // Comandos de mesa/social só no grupo
      if (
        isDm &&
        parsedCommand?.command &&
        FUN_PUBLIC_GROUP_COMMANDS.has(parsedCommand.command) &&
        parsedCommand.command !== 'group_scope'
      ) {
        await reply(
          [
            'Esse comando é *só no grupo* (duelo, facção, social…).',
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
        socialHooks,
        flavorService,
        getContactDisplayName,
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

      // evento surpresa só em grupo
      if (!isDm) await maybeAutoEvent(Date.now());

      const skipFlows = Boolean(funConfig.commandExclusive && result?.handled);
      return {
        handled: Boolean(result?.handled),
        skipFlows,
        isCommand: true,
      };
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
      const name =
        typeof getContactDisplayName === 'function'
          ? getContactDisplayName(userJid)
          : '';
      let text = formatLevelUp({
        displayName: name,
        userJid,
        previousLevel: award.previousLevel,
        level: award.level,
        xp: award.xp,
      });
      if (flavorService?.italicLine) {
        try {
          const fl = await flavorService.italicLine('level_up', {
            level: award.level,
            user: name || userJid?.split?.('@')?.[0] || '',
          });
          if (fl) text = `${text}\n${fl}`;
        } catch {
          // flavor opcional
        }
      }
      await reply(text);
    }

    // evento surpresa em mensagem normal do grupo (baixa chance + cooldown)
    if (award.applied) {
      await maybeAutoEvent(now);
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
