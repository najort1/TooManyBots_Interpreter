import { isFunCommandText, routeFunCommand } from '../commands/router.js';
import { formatLevelUp } from '../formatters/rankCard.js';
import { isUserJid } from '../../runtime/contactUtils.js';
import { getFunGroupWhitelistSet } from '../config.js';

/**
 * Elegibilidade de escopo (MVP: só grupos na whitelist do Fun; sem DM).
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
    if (!funConfig.allowDm) {
      return { eligible: false, reason: 'dm-disabled' };
    }
    return { eligible: true, scopeKey: '*', reason: 'dm' };
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

  return { eligible: true, scopeKey: jid, reason: 'group' };
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
    getContactDisplayName,
    listContacts,
    sendText,
    sendImage,
    getGroupWhitelistJids,
    getLogger,
    identityMap,
  } = deps;

  const {
    sock,
    chatJid,
    actorJid,
    isGroup,
    text,
    messageType,
    appConfig,
    mentionedJids = [],
    quotedParticipant = '',
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

  const userJid = String(actorJid || '').trim();
  if (!userJid || !isUserJid(userJid)) {
    return { handled: false, skipFlows: false, reason: 'no-actor' };
  }

  const effectiveRates =
    typeof groupRepository?.resolveEffectiveRates === 'function'
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

  const prefix = funConfig.prefix || '/';
  const isCommand = isFunCommandText(text, prefix);

  const reply = async (body) => {
    if (typeof sendText !== 'function') return;
    const content = String(body || '').trim();
    if (!content) return;
    await sendText(sock, chatJid, content);
  };

  const replyImage = async (imageBuffer, caption = '') => {
    if (typeof sendImage !== 'function') return;
    await sendImage(sock, chatJid, {
      imageBuffer,
      caption: String(caption || ''),
      mimeType: 'image/png',
    });
  };

  if (isCommand) {
    try {
      const result = await routeFunCommand({
        text,
        funConfig,
        userJid,
        scopeKey: scope.scopeKey,
        rankService,
        dailyService,
        coinsService,
        relationshipService,
        gameService,
        shopService,
        effectsRepository,
        repository,
        getContactDisplayName,
        listContacts,
        reply,
        replyImage,
        mentionedJids,
        quotedParticipant,
        effectiveRates,
        sock,
        identityMap,
      });

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
      await reply(
        formatLevelUp({
          displayName: name,
          userJid,
          previousLevel: award.previousLevel,
          level: award.level,
          xp: award.xp,
        })
      );
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
