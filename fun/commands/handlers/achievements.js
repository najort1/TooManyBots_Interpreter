export async function handleAchievementsCommand({
  userJid,
  scopeKey,
  achievementService,
  funConfig,
  reply,
}) {
  if (!achievementService || funConfig.achievementsEnabled === false) {
    await reply('Conquistas desligadas.');
    return { handled: true };
  }
  await reply(achievementService.formatList(scopeKey, userJid));
  return { handled: true };
}
