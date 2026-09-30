import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQuizRoyaleEngine,
  generateQuizQuestions,
  FALLBACK_QUESTIONS,
  QUIZ_CONSTANTS,
  QUIZ_PHASES,
} from '../fun/games/engines/quizRoyaleEngine.js';
import { createGameManager, GAME_TYPES, ROOM_STATUS } from '../fun/games/gameManager.js';

describe('Quiz Royale das Panelinhas (Engine & Integration)', () => {
  // Mock utilitário de sala para os testes de unidade do motor
  function createMockRoom({ playerCount = 4, factionCount = 2 } = {}) {
    const room = {
      id: 'room-test-123',
      scopeKey: 'group-zap-123',
      gameType: GAME_TYPES.QUIZ_ROYALE,
      title: 'Quiz Royale das Panelinhas',
      prize: 1500,
      status: ROOM_STATUS.IN_PROGRESS,
      players: new Map(),
      factions: new Map(),
      clients: new Set(),
      gameManager: {
        broadcastCalls: [],
        finishGameCalls: [],
        broadcast(r, eventName, payload) {
          this.broadcastCalls.push({ eventName, payload });
        },
        async finishGame(roomId, winnerFactionId, stats) {
          this.finishGameCalls.push({ roomId, winnerFactionId, stats });
        },
      },
    };

    // Cria panelinhas
    for (let f = 1; f <= factionCount; f++) {
      const facId = `fac-${f}`;
      room.factions.set(facId, {
        id: facId,
        name: `Panelinha ${f}`,
        emoji: f === 1 ? '🦅' : '🦁',
        score: 0,
        members: [],
      });
    }

    // Cria jogadores distribuídos nas panelinhas
    const factionIds = Array.from(room.factions.keys());
    for (let p = 1; p <= playerCount; p++) {
      const facId = factionIds[(p - 1) % factionIds.length];
      const fac = room.factions.get(facId);
      const userJid = `55119999000${p}@s.whatsapp.net`;
      fac.members.push(userJid);

      room.players.set(userJid, {
        userJid,
        username: `Jogador_${p}`,
        faction: { id: fac.id, name: fac.name, emoji: fac.emoji },
        score: 0,
        joinedAt: Date.now(),
        isReady: true,
      });
    }

    return room;
  }

  test('Fallback Questions Bank possui estrutura válida e temas diversificados', () => {
    assert.ok(Array.isArray(FALLBACK_QUESTIONS));
    assert.ok(FALLBACK_QUESTIONS.length >= 20, 'Deve possuir pelo menos 20 perguntas de fallback');

    const categories = new Set();
    for (const q of FALLBACK_QUESTIONS) {
      assert.ok(typeof q.question === 'string' && q.question.length > 5, 'Pergunta deve ter texto válido');
      assert.ok(Array.isArray(q.options) && q.options.length === 4, 'Deve conter exatamente 4 alternativas');
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3, 'correctIndex deve estar entre 0 e 3');
      assert.ok(typeof q.category === 'string' && q.category.length > 0, 'Deve ter categoria');
      assert.ok(typeof q.explanation === 'string', 'Deve ter explicação');
      categories.add(q.category);
    }

    // Verifica presença de temas requeridos
    assert.ok(categories.has('Memes Brasileiros'), 'Deve ter categoria Memes Brasileiros');
    assert.ok(categories.has('Tecnologia'), 'Deve ter categoria Tecnologia');
    assert.ok(categories.has('Games'), 'Deve ter categoria Games');
    assert.ok(categories.has('História Bizarra'), 'Deve ter categoria História Bizarra');
    assert.ok(categories.has('Cultura Pop'), 'Deve ter categoria Cultura Pop');
  });

  test('generateQuizQuestions usa fallback quando LLM está indisponível ou falha', async () => {
    // LLM que lança exceção (simulando timeout ou erro de rede)
    const failingLlm = async () => {
      throw new Error('LLM timeout 25000ms');
    };

    const questions = await generateQuizQuestions({
      count: 8,
      generateZen: failingLlm,
    });

    assert.equal(questions.length, 8);
    for (const q of questions) {
      assert.equal(q.options.length, 4);
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
    }
  });

  test('generateQuizQuestions consome e valida JSON estruturado do LLM', async () => {
    const mockLlm = async () => {
      return JSON.stringify({
        questions: [
          {
            question: 'Qual é o sistema operacional de código aberto mais famoso?',
            options: ['Linux', 'Windows', 'MacOS', 'DOS'],
            correctIndex: 0,
            category: 'Tecnologia',
            explanation: 'Criado por Linus Torvalds em 1991.',
          },
          {
            question: 'Qual meme imortalizou o "Olha eleeees!" no BBB?',
            options: ['Ana Paula Renault', 'Gil do Vigor', 'Babu Santana', 'Prior'],
            correctIndex: 0,
            category: 'Memes Brasileiros',
            explanation: 'Ana Paula gritou voltando do paredão falso.',
          },
          {
            question: 'Em que jogo você constrói com blocos cúbicos?',
            options: ['Minecraft', 'Tetris', 'Roblox', 'Terraria'],
            correctIndex: 0,
            category: 'Games',
            explanation: 'Minecraft é o jogo de blocos mais vendido.',
          },
          {
            question: 'Qual imperador teria nomeado seu cavalo cônsul?',
            options: ['Calígula', 'Nero', 'César', 'Augusto'],
            correctIndex: 0,
            category: 'História Bizarra',
            explanation: 'Calígula e seu cavalo Incitatus.',
          },
          {
            question: 'Qual o nome do protagonista de Matrix?',
            options: ['Neo', 'Morpheus', 'Trinity', 'Smith'],
            correctIndex: 0,
            category: 'Cultura Pop',
            explanation: 'Neo, o Escolhido.',
          },
          {
            question: 'O que o alho tem?',
            options: ['Dentes', 'Braços', 'Pernas', 'Olhos'],
            correctIndex: 0,
            category: 'Enigmas',
            explanation: 'Dente de alho.',
          },
          {
            question: 'Quantos corações tem um polvo?',
            options: ['3', '1', '2', '4'],
            correctIndex: 0,
            category: 'Ciência Curiosa',
            explanation: 'Polvos têm 3 corações.',
          },
        ],
      });
    };

    const questions = await generateQuizQuestions({
      count: 7,
      generateZen: mockLlm,
      random: () => 0.5,
    });

    assert.equal(questions.length, 7);
    assert.equal(questions[0].options.length, 4);
    assert.ok(questions[0].correctIndex >= 0 && questions[0].correctIndex <= 3);
  });

  test('Ciclo completo: início, fase de pergunta, bloqueio de resposta dupla e pontuação com bônus de velocidade', async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const room = createMockRoom({ playerCount: 4, factionCount: 2 });

    const engine = createQuizRoyaleEngine(room, {
      now,
      totalRounds: 7,
      generateZen: async () => JSON.stringify({
        questions: FALLBACK_QUESTIONS.slice(0, 7),
      }),
    });

    // 1. Inicia o jogo
    const started = await engine.start();
    assert.equal(started, true);
    assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);
    assert.equal(engine.getCurrentRoundIndex(), 0);

    // 2. Verifica estado público durante a pergunta (resposta correta DEVE estar oculta!)
    const publicState = engine.getPublicState();
    assert.equal(publicState.phase, QUIZ_PHASES.QUESTION);
    assert.equal(publicState.round, 1);
    assert.equal(publicState.totalRounds, 7);
    assert.ok(publicState.question, 'Deve ter objeto da pergunta');
    assert.equal(publicState.question.options.length, 4);
    assert.equal(publicState.question.correctIndex, undefined, 'correctIndex DEVE ser secreto na fase de pergunta!');

    // 3. Jogador 1 responde corretamente nos primeiros segundos (ganha bônus alto)
    const q0 = engine.getQuestions()[0];
    const player1 = Array.from(room.players.values())[0];
    const player1Session = { userJid: player1.userJid, username: player1.username, faction: player1.faction };

    // Responde no segundo 1 (restam 14 segundos de 15)
    currentTime = 2000;
    const res1 = await engine.handleAction(player1Session, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: q0.correctIndex,
    });

    assert.equal(res1.ok, true);
    assert.equal(res1.isCorrect, true);
    // Pontos = 100 base + bônus velocidade (14/15 * 50 = 47)
    assert.ok(res1.pointsEarned >= 140, `Pontos com bônus devem ser >= 140, recebido: ${res1.pointsEarned}`);
    assert.equal(player1.score, res1.pointsEarned);

    // Verifica agregação na panelinha do jogador 1
    const fac1 = room.factions.get(player1.faction.id);
    assert.equal(fac1.score, res1.pointsEarned);

    // 4. Jogador 1 tenta responder de novo na mesma pergunta -> DEVE ser bloqueado
    const resDuplicate = await engine.handleAction(player1Session, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: q0.correctIndex,
    });
    assert.equal(resDuplicate.ok, false);
    assert.equal(resDuplicate.error, 'already_answered');

    // 5. Jogador 2 responde errado
    const player2 = Array.from(room.players.values())[1];
    const player2Session = { userJid: player2.userJid, username: player2.username, faction: player2.faction };
    const wrongChoice = (q0.correctIndex + 1) % 4;

    const res2 = await engine.handleAction(player2Session, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: wrongChoice,
    });

    assert.equal(res2.ok, true);
    assert.equal(res2.isCorrect, false);
    assert.equal(res2.pointsEarned, 0);
    assert.equal(player2.score, 0);

    engine.cleanup();
  });

  test('Fase de Revelação: exibe resposta correta, estatísticas e placar atualizado das panelinhas', async () => {
    let currentTime = 1000;
    const now = () => currentTime;
    const room = createMockRoom({ playerCount: 2, factionCount: 2 });

    const engine = createQuizRoyaleEngine(room, {
      now,
      totalRounds: 7,
      generateZen: async () => JSON.stringify({
        questions: FALLBACK_QUESTIONS.slice(0, 7),
      }),
    });

    await engine.start();

    const q0 = engine.getQuestions()[0];
    const players = Array.from(room.players.values());

    // Jogador 1 acerta
    await engine.handleAction(players[0], {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: q0.correctIndex,
    });

    // Jogador 2 erra
    await engine.handleAction(players[1], {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: (q0.correctIndex + 2) % 4,
    });

    // Como ambos os jogadores na sala responderam, transiciona automaticamente para a Fase de Revelação
    assert.equal(engine.getPhase(), QUIZ_PHASES.REVEAL);

    const revealState = engine.getPublicState();
    assert.equal(revealState.phase, QUIZ_PHASES.REVEAL);
    assert.equal(revealState.question.correctIndex, q0.correctIndex, 'Deve revelar o correctIndex na fase de revelação');
    assert.ok(revealState.roundStats, 'Deve conter roundStats');
    assert.equal(revealState.roundStats.correctCount, 1);
    assert.equal(revealState.roundStats.wrongCount, 1);
    assert.equal(revealState.factionsRanking.length, 2);

    engine.cleanup();
  });

  test('Validações de segurança em handleAction', async () => {
    const room = createMockRoom({ playerCount: 4, factionCount: 2 });
    const engine = createQuizRoyaleEngine(room, {
      generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
    });

    // Ação antes do start -> fase IDLE
    const p1 = Array.from(room.players.values())[0];
    const resBeforeStart = await engine.handleAction(p1, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: 1,
    });
    assert.equal(resBeforeStart.ok, false);
    assert.equal(resBeforeStart.error, 'not_in_question_phase');

    await engine.start();

    // Ação de jogador não cadastrado na sala
    const imposterSession = { userJid: 'imposter@s.whatsapp.net', username: 'Impostor' };
    const resImposter = await engine.handleAction(imposterSession, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: 1,
    });
    assert.equal(resImposter.ok, false);
    assert.equal(resImposter.error, 'player_not_in_room');

    // Índice de pergunta incorreto
    const resWrongQ = await engine.handleAction(p1, {
      action: 'answer',
      questionIndex: 99,
      choiceIndex: 1,
    });
    assert.equal(resWrongQ.ok, false);
    assert.equal(resWrongQ.error, 'invalid_question_index');

    // Alternativa fora da faixa 0..3
    const resInvalidChoice = await engine.handleAction(p1, {
      action: 'answer',
      questionIndex: 0,
      choiceIndex: 5,
    });
    assert.equal(resInvalidChoice.ok, false);
    assert.equal(resInvalidChoice.error, 'invalid_choice_index');

    // Ação desconhecida
    const resUnknown = await engine.handleAction(p1, {
      action: 'dance',
      questionIndex: 0,
      choiceIndex: 1,
    });
    assert.equal(resUnknown.ok, false);
    assert.equal(resUnknown.error, 'unknown_action');

    engine.cleanup();
  });

  test('Integração com GameManager: criação da sala, start e finalização premiando a panelinha vencedora', async () => {
    let mockVaultCoins = 0;
    const mockFactionRepo = {
      getDatabase() {
        return {
          prepare(sql) {
            return {
              run(amount) {
                mockVaultCoins += amount;
              },
            };
          },
        };
      },
    };

    const manager = createGameManager({
      factionRepository: mockFactionRepo,
      sendGroupMessage: async () => {},
    });

    const createResult = await manager.createRoom({
      scopeKey: 'test-group@g.us',
      gameType: GAME_TYPES.QUIZ_ROYALE,
      prize: 2000,
      startInMinutes: 1,
    });

    assert.equal(createResult.ok, true);
    const room = manager.getRoom(createResult.room.id);
    assert.ok(room);
    assert.ok(room.engine, 'Motor deve ter sido instanciado pelo GameManager');

    // Adiciona 4 jogadores (2 panelinhas)
    const fac1 = { id: 'f1', name: 'Alpha', emoji: '🐺' };
    const fac2 = { id: 'f2', name: 'Beta', emoji: '🦊' };

    manager.joinRoom(room.id, { userJid: 'user1@s.whatsapp.net', username: 'User1', faction: fac1 });
    manager.joinRoom(room.id, { userJid: 'user2@s.whatsapp.net', username: 'User2', faction: fac1 });
    manager.joinRoom(room.id, { userJid: 'user3@s.whatsapp.net', username: 'User3', faction: fac2 });
    manager.joinRoom(room.id, { userJid: 'user4@s.whatsapp.net', username: 'User4', faction: fac2 });

    assert.equal(room.players.size, 4);
    assert.equal(room.factions.size, 2);

    // Inicia a partida via GameManager
    const started = await manager.startGame(room.id);
    assert.equal(started, true);
    assert.equal(room.status, ROOM_STATUS.IN_PROGRESS);

    // Finaliza a partida chamando finishGame com a panelinha Alpha vencedora
    await manager.finishGame(room.id, fac1.id, { finalTest: true });

    assert.equal(room.status, ROOM_STATUS.FINISHED);
    assert.equal(room.winnerFaction.id, fac1.id);
    assert.equal(mockVaultCoins, 2000, 'Cofre da panelinha vencedora deve receber o prêmio de 2000');
  });
});
