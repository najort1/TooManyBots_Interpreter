import { GAME_TYPES, GAME_METADATA } from '../../games/gameManager.js';

/**
 * Handler para o comando /jogododia e /iniciar_jogo.
 * Permite agendar ou iniciar um dos 3 jogos multiplayer de panelinhas no grupo.
 */
export async function handleGameEventCommand({
  scopeKey,
  isGroup,
  args = [],
  gameManager,
  reply,
}) {
  if (!isGroup) {
    await reply('⚠️ Os eventos diários de jogos multiplayer só podem ser iniciados dentro de grupos com panelinhas ativas!');
    return { handled: true, error: 'group_only' };
  }

  if (!gameManager) {
    await reply('❌ O gerenciador de jogos não está disponível no momento.');
    return { handled: true, error: 'service_unavailable' };
  }

  // Verifica se já existe sala ativa no grupo
  const activeRoom = gameManager.getActiveRoomByScope(scopeKey);
  if (activeRoom) {
    const meta = GAME_METADATA[activeRoom.gameType] || {};
    await reply(
      `⚠️ *Já existe uma partida de ${meta.name || activeRoom.title} ativa neste grupo!*\n\n` +
      `👥 Jogadores inscritos: ${activeRoom.players.size}\n` +
      `📊 Status: ${activeRoom.status === 'waiting' ? 'Aguardando início' : 'Em andamento'}\n\n` +
      `Acesse a sala para participar ou acompanhar:\n` +
      `👉 Entre pelo link enviado anteriormente no grupo!`
    );
    return { handled: true, room: activeRoom };
  }

  // Parser dos argumentos: /jogododia [quiz|ctf|hill] [minutos]
  const modeArg = String(args[0] || '').toLowerCase().trim();
  let chosenGameType = null;

  if (['quiz', 'quiz_royale', 'trivia', 'perguntas'].includes(modeArg)) {
    chosenGameType = GAME_TYPES.QUIZ_ROYALE;
  } else if (['ctf', 'bandeira', 'grid', 'grid_ctf'].includes(modeArg)) {
    chosenGameType = GAME_TYPES.GRID_CTF;
  } else if (['hill', 'king', 'dominio', 'koth', 'king_of_the_hill'].includes(modeArg)) {
    chosenGameType = GAME_TYPES.KING_OF_THE_HILL;
  } else {
    // Rotação diária padrão: sorteia entre os 3 modos caso não especificado
    const availableModes = [
      GAME_TYPES.QUIZ_ROYALE,
      GAME_TYPES.GRID_CTF,
      GAME_TYPES.KING_OF_THE_HILL,
    ];
    const randomIndex = Math.floor(Math.random() * availableModes.length);
    chosenGameType = availableModes[randomIndex];
  }

  const minutesArg = parseInt(args[1], 10);
  const startInMinutes = Number.isInteger(minutesArg) && minutesArg >= 1 && minutesArg <= 15 ? minutesArg : 3;

  const result = await gameManager.createRoom({
    scopeKey,
    gameType: chosenGameType,
    prize: 1000,
    startInMinutes,
  });

  if (!result.ok) {
    await reply('❌ Não foi possível criar a sala do evento no momento.');
    return { handled: true, error: result.reason };
  }

  // O createRoom já envia o anúncio com o link e regras no grupo
  return {
    handled: true,
    room: result.room,
    gameLink: result.gameLink,
  };
}
