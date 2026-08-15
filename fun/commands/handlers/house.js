import { HOUSE_MESSAGES } from '../../messages/house.js';
import { formatHouseLink } from '../../formatters/house.js';

function publicBaseUrl(funConfig = {}) {
  return String(funConfig.publicBaseUrl || '').replace(/\/$/, '') || 'http://localhost:' + (Number(funConfig.dashboardUiPort) || 3001);
}

export async function handleHouseCommand({ isGroup, scopeKey, userJid, houseService, houseLinkService, repository, funConfig, reply, args = [] }) {
  if (funConfig.housesEnabled === false) { await reply(HOUSE_MESSAGES.disabled); return { handled: true }; }
  if (isGroup) { await reply(HOUSE_MESSAGES.groupDmHint); return { handled: true }; }
  if (!houseService || !houseLinkService) { await reply(HOUSE_MESSAGES.disabled); return { handled: true }; }
  const sub = String(args[0] || 'link').trim().toLowerCase();
  if (sub === 'revogar' || sub === 'revogar-link') {
    houseLinkService.revoke({ scopeKey, userJid });
    await reply('🔐 Link da casa revogado. Use /casa link para gerar outro.');
    return { handled: true };
  }
  const provisioned = houseService.provision({ scopeKey, userJid });
  const link = await houseLinkService.generate({ scopeKey, userJid });
  const coins = repository?.getUserStats(userJid, scopeKey)?.coins || 0;
  await reply(formatHouseLink({ url: publicBaseUrl(funConfig) + '/casas/' + link.token, coins, groupName: scopeKey }));
  return { handled: true, house: provisioned.house };
}
