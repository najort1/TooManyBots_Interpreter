import { HOUSE_MESSAGES } from '../../messages/house.js';
import { formatAvatarSummary } from '../../formatters/house.js';

function publicBaseUrl(funConfig = {}) { return String(funConfig.publicBaseUrl || '').replace(/\/$/, '') || 'http://localhost:' + (Number(funConfig.dashboardUiPort) || 3001); }

export async function handleAvatarCommand({ isGroup, scopeKey, userJid, avatarService, houseLinkService, funConfig, reply }) {
  if (funConfig.avatarEnabled === false) { await reply('Avatares estão desligados neste bot.'); return { handled: true }; }
  if (isGroup) { await reply(HOUSE_MESSAGES.avatarGroupDmHint); return { handled: true }; }
  if (!avatarService || !houseLinkService) { await reply('Avatares estão desligados neste bot.'); return { handled: true }; }
  const state = avatarService.get({ scopeKey, userJid });
  const link = await houseLinkService.generate({ scopeKey, userJid });
  await reply(formatAvatarSummary(state) + '\nEditar: ' + publicBaseUrl(funConfig) + '/casas/' + link.token + '/avatar');
  return { handled: true };
}
