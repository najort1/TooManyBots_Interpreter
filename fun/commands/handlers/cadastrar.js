/**
 * Handler do comando /cadastrar
 */

export async function handleCadastrarCommand({
  userJid,
  isGroup,
  registrationService,
  reply,
}) {
  if (!registrationService) {
    await reply('❌ O serviço de cadastro não está disponível no momento.');
    return { handled: true, error: 'service_unavailable' };
  }

  const result = await registrationService.startRegistration({
    userJid,
    isGroup: Boolean(isGroup),
  });

  if (result?.message) {
    await reply(result.message);
  }

  return {
    handled: true,
    ...result,
  };
}
