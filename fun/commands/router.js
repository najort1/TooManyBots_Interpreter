import { FUN_COMMAND_ALIASES, FUN_COMMANDS } from '../constants.js';
import { handleXpCommand } from './handlers/xp.js';
import { handleRankCommand } from './handlers/rank.js';
import { handleRankCoinsCommand } from './handlers/rankCoins.js';
import { handleDailyCommand } from './handlers/daily.js';
import { handleHelpCommand } from './handlers/help.js';
import { handlePayCommand } from './handlers/pay.js';
import { handleCoinsCommand } from './handlers/coins.js';
import { handleMarryCommand, handleDivorceCommand } from './handlers/marry.js';
import { handleShipCommand } from './handlers/ship.js';
import { handleAcceptCommand, handleDeclineCommand } from './handlers/accept.js';
import {
  handleFlipCommand,
  handleJobCommand,
  handleLuckyCommand,
  handleBetCommand,
} from './handlers/games.js';
import {
  handleShopCommand,
  handleBuyCommand,
  handleTitleCommand,
} from './handlers/shop.js';
import {
  handleFactionCommand,
  handlePanelinhaCommand,
  handlePanelinhaGuideCommand,
  handlePonteCommand,
} from './handlers/faction.js';
import {
  handleMissionCommand,
  handleSquadCommand,
  handleEventCommand,
} from './handlers/mission.js';

/**
 * @returns {{ command: string, args: string[] } | null}
 */
export function parseFunCommand(text, prefix = '/') {
  const raw = String(text ?? '').trim();
  const p = String(prefix || '/');
  if (!raw || !raw.startsWith(p)) return null;

  const body = raw.slice(p.length).trim();
  if (!body) return null;

  const parts = body.split(/\s+/);
  const head = String(parts[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');
  if (!head) return null;

  const command = FUN_COMMAND_ALIASES[head];
  if (!command) return null;

  return {
    command,
    args: parts.slice(1),
  };
}

export function isFunCommandText(text, prefix = '/') {
  return parseFunCommand(text, prefix) != null;
}

export async function routeFunCommand(ctx) {
  const {
    text,
    funConfig,
    userJid,
    scopeKey,
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
    socialHooks,
    flavorService,
    getContactDisplayName,
    listContacts,
    reply,
    replyPrivate,
    replyImage,
    mentionedJids,
    quotedParticipant,
    effectiveRates,
    sock,
    identityMap,
    chatJid,
    isGroup,
  } = ctx;

  const parsed = parseFunCommand(text, funConfig.prefix);
  if (!parsed) return { handled: false };

  const base = {
    userJid,
    chatJid,
    isGroup,
    scopeKey,
    funConfig,
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
    socialHooks,
    flavorService,
    getContactDisplayName,
    listContacts,
    reply,
    replyPrivate: replyPrivate || reply,
    replyImage,
    args: parsed.args,
    mentionedJids: mentionedJids || [],
    quotedParticipant: quotedParticipant || '',
    effectiveRates,
    sock,
    identityMap,
  };

  switch (parsed.command) {
    case FUN_COMMANDS.XP:
    case FUN_COMMANDS.PERFIL:
      return handleXpCommand(base);
    case FUN_COMMANDS.RANK:
      return handleRankCommand(base);
    case FUN_COMMANDS.RANK_COINS:
      return handleRankCoinsCommand(base);
    case FUN_COMMANDS.DAILY:
      return handleDailyCommand(base);
    case FUN_COMMANDS.HELP:
      return handleHelpCommand(base);
    case FUN_COMMANDS.PAY:
      return handlePayCommand(base);
    case FUN_COMMANDS.COINS:
      return handleCoinsCommand(base);
    case FUN_COMMANDS.MARRY:
      return handleMarryCommand(base);
    case FUN_COMMANDS.DIVORCE:
      return handleDivorceCommand(base);
    case FUN_COMMANDS.SHIP:
      return handleShipCommand(base);
    case FUN_COMMANDS.ACCEPT:
      return handleAcceptCommand(base);
    case FUN_COMMANDS.DECLINE:
      return handleDeclineCommand(base);
    case FUN_COMMANDS.FLIP:
      return handleFlipCommand(base);
    case FUN_COMMANDS.JOB:
      return handleJobCommand(base);
    case FUN_COMMANDS.LUCKY:
      return handleLuckyCommand(base);
    case FUN_COMMANDS.BET:
      return handleBetCommand(base);
    case FUN_COMMANDS.SHOP:
      return handleShopCommand(base);
    case FUN_COMMANDS.BUY:
      return handleBuyCommand(base);
    case FUN_COMMANDS.TITLE:
      return handleTitleCommand(base);
    case FUN_COMMANDS.FACTION:
      return handleFactionCommand(base);
    case FUN_COMMANDS.PANELINHA:
      return handlePanelinhaCommand(base);
    case FUN_COMMANDS.PANELINHA_GUIDE:
      return handlePanelinhaGuideCommand(base);
    case FUN_COMMANDS.PONTE:
      return handlePonteCommand(base);
    case FUN_COMMANDS.MISSION:
      return handleMissionCommand(base);
    case FUN_COMMANDS.SQUAD:
      return handleSquadCommand(base);
    case FUN_COMMANDS.EVENT:
      return handleEventCommand(base);
    default:
      return { handled: false };
  }
}
