export async function handleCoinsCommand({
  userJid,
  scopeKey,
  coinsService,
  reply,
}) {
  const balance = coinsService.getBalance(userJid, scopeKey);
  await reply(`🪙 Seu saldo: *${balance}* coins`);
  return { handled: true };
}
