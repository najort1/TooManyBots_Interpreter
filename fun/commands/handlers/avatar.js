import { HOUSE_MESSAGES } from '../../messages/house.js';
import { formatAvatarSummary } from '../../formatters/house.js';
import { getPublicBaseUrl } from '../../utils/publicUrl.js';

export async function handleAvatarCommand({ isGroup, scopeKey, userJid, avatarService, houseLinkService, funConfig, reply }) {
  if (funConfig.avatarEnabled === false) { await reply('Avatares estão desligados neste bot.'); return { handled: true }; }
  if (isGroup) { await reply(HOUSE_MESSAGES.avatarGroupDmHint); return { handled: true }; }
  if (!avatarService || !houseLinkService) { await reply('Avatares estão desligados neste bot.'); return { handled: true }; }
  const state = avatarService.get({ scopeKey, userJid });
  const link = await houseLinkService.generate({ scopeKey, userJid });
  await reply(formatAvatarSummary(state) + '\nEditar: ' + getPublicBaseUrl(funConfig) + '/casas/' + link.token + '/avatar');
  return { handled: true };
}
