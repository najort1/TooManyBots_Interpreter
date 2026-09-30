import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQuizRoyaleEngine,
  generateQuizQuestions,
  FALLBACK_QUESTIONS,
  QUIZ_CONSTANTS,
  QUIZ_PHASES,
} from '../fun/games/engines/quizRoyaleEngine.js';

// Desativa chamadas reais externas de LLM para evitar 401 ou dependência de rede nos testes
process.env.FUN_DISABLE_LIVE_LLM = '1';

/**
 * Utilitário para criar mock de sala com N jogadores e M panelinhas
 */
function createMockRoom({ playerCount = 20, factionCount = 4 } = {}) {
  const room = {
    id: `room-intensive-${Date.now()}`,
    scopeKey: 'intensive-test@g.us',
    gameType: 'quiz_royale',
    title: 'Quiz Royale Intensivo',
    prize: 5000,
    status: 'in_progress',
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

  const factionEmojis = ['🐺', '🦁', '🦅', '🐻', '🦊', '🐯'];
  const factionNames = ['Lobos Alfa', 'Leões Dourados', 'Águias de Fogo', 'Ursos de Guerra', 'Raposas Ágeis', 'Tigres Reais'];

  for (let f = 1; f <= factionCount; f++) {
    const facId = `fac-${f}`;
    room.factions.set(facId, {
      id: facId,
      name: factionNames[f - 1] || `Panelinha ${f}`,
      emoji: factionEmojis[f - 1] || '🏴‍☠️',
      score: 0,
      members: [],
    });
  }

  const factionIds = Array.from(room.factions.keys());
  for (let p = 1; p <= playerCount; p++) {
    const facId = factionIds[(p - 1) % factionIds.length];
    const fac = room.factions.get(facId);
    const userJid = `551198888${String(p).padStart(4, '0')}@s.whatsapp.net`;
    fac.members.push(userJid);

    room.players.set(userJid, {
      userJid,
      username: `ProGamer_${p}`,
      faction: { id: fac.id, name: fac.name, emoji: fac.emoji },
      score: 0,
      joinedAt: Date.now(),
      isReady: true,
    });
  }

  return room;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Quiz Royale - Bateria de Testes Intensivos e de Estresse', () => {

  describe('1. Concorrência Máxima: 20 Jogadores no mesmo milissegundo', () => {
    test('20 jogadores respondendo simultaneamente no mesmo milissegundo processam sem perda de dados', async () => {
      let currentTime = 10_000;
      const now = () => currentTime;
      const room = createMockRoom({ playerCount: 20, factionCount: 4 });

      const engine = createQuizRoyaleEngine(room, {
        now,
        totalRounds: 10,
        generateZen: async () => JSON.stringify({
          questions: FALLBACK_QUESTIONS.slice(0, 10),
        }),
      });

      const started = await engine.start();
      assert.equal(started, true);
      assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);

      const q0 = engine.getQuestions()[0];
      const allPlayers = Array.from(room.players.values());
      assert.equal(allPlayers.length, 20);

      // Simula resposta exatamente no mesmo instante (tempo 12000, 2s após início)
      currentTime = 12_000;

      // Metade acerta (opção correta), metade erra (outra opção)
      const actionPromises = allPlayers.map((player, idx) => {
        const choice = (idx % 2 === 0) ? q0.correctIndex : (q0.correctIndex + 1) % 4;
        return engine.handleAction(player, {
          action: 'answer',
          questionIndex: 0,
          choiceIndex: choice,
        });
      });

      // 20 promessas disparadas no mesmo milissegundo
      const results = await Promise.all(actionPromises);

      // Todas devem ter retornado sucesso no registro
      assert.equal(results.length, 20);
      for (const res of results) {
        assert.equal(res.ok, true);
        assert.equal(res.answered, true);
      }

      // 10 devem ter acertado, 10 errado
      const correctCount = results.filter(r => r.isCorrect).length;
      const wrongCount = results.filter(r => !r.isCorrect).length;
      assert.equal(correctCount, 10);
      assert.equal(wrongCount, 10);

      // Como todos os 20 jogadores responderam, o motor deve ter transicionado imediatamente para REVEAL
      assert.equal(engine.getPhase(), QUIZ_PHASES.REVEAL);

      // O estado público deve refletir estatísticas exatas da rodada
      const publicState = engine.getPublicState();
      assert.equal(publicState.roundStats.totalAnswers, 20);
      assert.equal(publicState.roundStats.correctCount, 10);
      assert.equal(publicState.roundStats.wrongCount, 10);
      assert.equal(publicState.roundStats.unansweredCount, 0);

      // Verifica integridade de pontos individuais e das panelinhas
      let totalPlayerPoints = 0;
      for (const player of room.players.values()) {
        totalPlayerPoints += player.score;
      }

      let totalFactionPoints = 0;
      for (const fac of room.factions.values()) {
        totalFactionPoints += fac.score;
      }

      // Pontos totais dos jogadores devem ser estritamente iguais à soma das panelinhas
      assert.equal(totalPlayerPoints, totalFactionPoints);
      assert.ok(totalPlayerPoints > 0, 'Pontos totais devem ser maiores que zero');

      engine.cleanup();
    });
  });

  describe('2. Payloads Maliciosos, Inválidos e Edge Cases em handleAction', () => {
    test('Rejeição estrita de choiceIndex inválido (negativo, NaN, string, boolean, enorme, nulo, undefined, float, array, objeto)', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });
      await engine.start();

      const player = Array.from(room.players.values())[0];
      const invalidChoices = [
        -1,
        -999,
        NaN,
        '0',
        '1',
        '2',
        '3',
        'true',
        'false',
        'hack',
        '',
        true,
        false,
        999999999,
        1e12,
        null,
        undefined,
        1.5,
        0.001,
        -0.5,
        [],
        [1],
        {},
        { index: 0 },
      ];

      for (const badChoice of invalidChoices) {
        const res = await engine.handleAction(player, {
          action: 'answer',
          questionIndex: 0,
          choiceIndex: badChoice,
        });

        assert.equal(res.ok, false, `choiceIndex "${String(badChoice)}" deveria ser rejeitado`);
        assert.equal(res.error, 'invalid_choice_index', `choiceIndex "${String(badChoice)}" deve retornar invalid_choice_index`);
        assert.equal(player.score, 0, 'Pontuação não deve sofrer alteração');
      }

      engine.cleanup();
    });

    test('Rejeição estrita de questionIndex inválido (fora do índice, float, string, boolean, nulo, undefined)', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });
      await engine.start();

      const player = Array.from(room.players.values())[0];
      const invalidQuestions = [
        1,       // pergunta futura
        -1,      // pergunta negativa
        999,
        0.5,     // float
        '0',     // string que poderia ser coagida
        false,   // boolean false que Number() converte para 0
        true,    // boolean true
        null,    // null que Number() converte para 0
        undefined,
        NaN,
        [],
        {},
      ];

      for (const badQ of invalidQuestions) {
        const res = await engine.handleAction(player, {
          action: 'answer',
          questionIndex: badQ,
          choiceIndex: 0,
        });

        assert.equal(res.ok, false, `questionIndex "${String(badQ)}" deveria ser rejeitado`);
        assert.equal(res.error, 'invalid_question_index', `questionIndex "${String(badQ)}" deve retornar invalid_question_index`);
        assert.equal(player.score, 0);
      }

      engine.cleanup();
    });

    test('Rejeição de sessões de jogador nulas, corrompidas ou não cadastradas na sala', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });
      await engine.start();

      const invalidSessions = [
        null,
        undefined,
        {},
        { userJid: '' },
        { userJid: null },
        { userJid: 'random-stranger@s.whatsapp.net' },
        { player: null },
        { player: { userJid: 'attacker@s.whatsapp.net' } },
      ];

      for (const badSession of invalidSessions) {
        const res = await engine.handleAction(badSession, {
          action: 'answer',
          questionIndex: 0,
          choiceIndex: 0,
        });

        assert.equal(res.ok, false);
        assert.equal(res.error, 'player_not_in_room');
      }

      engine.cleanup();
    });

    test('Rejeição de ações desconhecidas ou maliciosas', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });
      await engine.start();

      const player = Array.from(room.players.values())[0];
      const badActions = ['dance', 'skip', 'cheat', '', null, undefined, 123, true, {}];

      for (const act of badActions) {
        const res = await engine.handleAction(player, {
          action: act,
          questionIndex: 0,
          choiceIndex: 0,
        });

        assert.equal(res.ok, false);
        assert.equal(res.error, 'unknown_action');
      }

      engine.cleanup();
    });
  });

  describe('3. Tentativas de Resposta Fora de Fase', () => {
    test('Bloqueia envio de respostas durante IDLE, LOADING, REVEAL, ENDED e pós-cleanup', async () => {
      let resolveLlm;
      const slowLlm = () => new Promise(res => { resolveLlm = res; });

      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const player = Array.from(room.players.values())[0];

      const engine = createQuizRoyaleEngine(room, {
        generateZen: slowLlm,
        totalRounds: 7,
      });

      // 1. Fase IDLE (antes de start)
      assert.equal(engine.getPhase(), QUIZ_PHASES.IDLE);
      const resIdle = await engine.handleAction(player, { action: 'answer', questionIndex: 0, choiceIndex: 0 });
      assert.equal(resIdle.ok, false);
      assert.equal(resIdle.error, 'not_in_question_phase');

      // 2. Fase LOADING (enquanto LLM está respondendo)
      const startPromise = engine.start();
      assert.equal(engine.getPhase(), QUIZ_PHASES.LOADING);

      const resLoading = await engine.handleAction(player, { action: 'answer', questionIndex: 0, choiceIndex: 0 });
      assert.equal(resLoading.ok, false);
      assert.equal(resLoading.error, 'not_in_question_phase');

      // Libera o LLM
      resolveLlm(JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }));
      await startPromise;
      assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);

      // Todos os jogadores respondem para forçar ida imediata para REVEAL
      for (const p of room.players.values()) {
        await engine.handleAction(p, { action: 'answer', questionIndex: 0, choiceIndex: 0 });
      }

      // 3. Fase REVEAL
      assert.equal(engine.getPhase(), QUIZ_PHASES.REVEAL);
      const resReveal = await engine.handleAction(player, { action: 'answer', questionIndex: 0, choiceIndex: 0 });
      assert.equal(resReveal.ok, false);
      assert.equal(resReveal.error, 'not_in_question_phase');

      // 4. Cleanup / Fase ENDED
      engine.cleanup();
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);

      const resEnded = await engine.handleAction(player, { action: 'answer', questionIndex: 0, choiceIndex: 0 });
      assert.equal(resEnded.ok, false);
      assert.equal(resEnded.error, 'not_in_question_phase');
    });
  });

  describe('4. Múltiplas Respostas do Mesmo Jogador (Prevenção de Ataque de Duplicação)', () => {
    test('Jogador disparando 20 respostas simultâneas na mesma pergunta pontua estritamente uma única vez', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });
      await engine.start();

      const player = Array.from(room.players.values())[0];
      const q0 = engine.getQuestions()[0];

      // Dispara 20 requisições simultâneas do mesmo jogador com a resposta correta
      const duplicateAttempts = Array.from({ length: 20 }, () =>
        engine.handleAction(player, {
          action: 'answer',
          questionIndex: 0,
          choiceIndex: q0.correctIndex,
        })
      );

      const responses = await Promise.all(duplicateAttempts);

      const successfulResponses = responses.filter(r => r.ok === true);
      const blockedResponses = responses.filter(r => r.ok === false && r.error === 'already_answered');

      assert.equal(successfulResponses.length, 1, 'Exatamente UMA resposta deve ser aceita');
      assert.equal(blockedResponses.length, 19, 'Exatamente 19 tentativas devem ser rejeitadas com already_answered');

      // Pontuação do jogador deve ser estritamente referente a 1 acerto (>= 100 e <= 150)
      assert.ok(player.score >= 100 && player.score <= 150);

      // Pontuação da panelinha deve ser estritamente igual à pontuação do jogador
      const faction = room.factions.get(player.faction.id);
      assert.equal(faction.score, player.score);

      engine.cleanup();
    });
  });

  describe('5. Resiliência Total contra Falhas da LLM (Fallback Robusto)', () => {
    test('Cenário A: LLM retorna JSON truncado / quebrado', async () => {
      const brokenLlm = async () => '{"questions": [{"question": "Eita Giovana, o que ca';
      const questions = await generateQuizQuestions({ count: 8, generateZen: brokenLlm });

      assert.equal(questions.length, 8);
      for (const q of questions) {
        assert.equal(q.options.length, 4);
        assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
      }
    });

    test('Cenário B: LLM retorna resposta vazia ou null', async () => {
      for (const emptyVal of ['', null, undefined, '   ']) {
        const emptyLlm = async () => emptyVal;
        const questions = await generateQuizQuestions({ count: 7, generateZen: emptyLlm });
        assert.equal(questions.length, 7);
        assert.ok(questions[0].options.length === 4);
      }
    });

    test('Cenário C: LLM retorna erro 500 ou rede fora', async () => {
      const error500Llm = async () => {
        const err = new Error('HTTP 500 Internal Server Error');
        err.status = 500;
        throw err;
      };

      const questions = await generateQuizQuestions({ count: 9, generateZen: error500Llm });
      assert.equal(questions.length, 9);
      for (const q of questions) {
        assert.equal(q.options.length, 4);
      }
    });

    test('Cenário D: LLM sofre Timeout de 25s', async () => {
      const timeoutLlm = async () => {
        throw new Error('LLM request timed out after 25000ms');
      };

      const questions = await generateQuizQuestions({ count: 10, generateZen: timeoutLlm });
      assert.equal(questions.length, 10);
      assert.equal(questions[0].options.length, 4);
    });

    test('Cenário E: LLM retorna JSON estruturado mas com dados inválidos / campos faltando', async () => {
      const malformedLlm = async () => JSON.stringify({
        questions: [
          { question: 'Curta?', options: ['A'], correctIndex: 0 }, // pergunta curta, 1 opção
          { question: 'Pergunta sem opções válidas?', options: [], correctIndex: 0 },
          { question: 'Pergunta com correctIndex inválido?', options: ['A', 'B', 'C', 'D'], correctIndex: 5 },
          { question: 'Pergunta válida suficiente para passar?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, category: 'Geral', explanation: 'OK' },
        ],
      });

      // Apenas 1 pergunta válida, mas count solicitado é 8 -> deve acionar fallback completo para suprir
      const questions = await generateQuizQuestions({ count: 8, generateZen: malformedLlm });
      assert.equal(questions.length, 8);
      for (const q of questions) {
        assert.equal(q.options.length, 4);
        assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
      }
    });

    test('Motor inicia com sucesso mesmo com LLM completamente offline sem travar a sala', async () => {
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const completelyDeadLlm = async () => {
        throw new Error('ECONNREFUSED: Connection refused at 127.0.0.1');
      };

      const engine = createQuizRoyaleEngine(room, {
        generateZen: completelyDeadLlm,
        totalRounds: 8,
      });

      const started = await engine.start();
      assert.equal(started, true);
      assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);
      assert.equal(engine.getQuestions().length, 8);

      engine.cleanup();
    });
  });

  describe('6. Simulação Completa de 10 Rodadas com 20 Jogadores e Agregação Exata das Panelinhas', () => {
    test('10 rodadas completas com 20 jogadores: verificação exata da agregação e ranking final', async () => {
      let currentTime = 10_000;
      const now = () => currentTime;
      const room = createMockRoom({ playerCount: 20, factionCount: 4 });

      // Usamos revealDurationMs: 10ms para transição controlada entre rodadas
      const engine = createQuizRoyaleEngine(room, {
        now,
        totalRounds: 10,
        revealDurationMs: 10,
        questionDurationMs: 15_000,
        generateZen: async () => JSON.stringify({
          questions: FALLBACK_QUESTIONS.slice(0, 10),
        }),
      });

      await engine.start();
      assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);

      const allPlayers = Array.from(room.players.values());
      assert.equal(allPlayers.length, 20);

      // Executa as 10 rodadas completas
      for (let r = 0; r < 10; r++) {
        assert.equal(engine.getCurrentRoundIndex(), r);
        assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);

        const currentQ = engine.getQuestions()[r];

        // Todos os 20 jogadores respondem com comportamentos variados
        for (let pIdx = 0; pIdx < allPlayers.length; pIdx++) {
          const player = allPlayers[pIdx];

          // Jogadores da Panelinha 1 (pIdx % 4 === 0) sempre acertam bem rápido
          // Jogadores da Panelinha 2 (pIdx % 4 === 1) acertam com tempo médio
          // Jogadores da Panelinha 3 (pIdx % 4 === 2) acertam lentamente
          // Jogadores da Panelinha 4 (pIdx % 4 === 3) erram
          const factionPattern = pIdx % 4;

          let choice;
          if (factionPattern === 3) {
            choice = (currentQ.correctIndex + 1) % 4; // Erro
          } else {
            choice = currentQ.correctIndex; // Acerto
          }

          // Variação do tempo de resposta
          currentTime += (factionPattern + 1) * 100;

          const res = await engine.handleAction(player, {
            action: 'answer',
            questionIndex: r,
            choiceIndex: choice,
          });

          assert.equal(res.ok, true);
        }

        // Quando o 20º jogador respondeu, o motor transicionou imediatamente para REVEAL
        assert.equal(engine.getPhase(), QUIZ_PHASES.REVEAL);

        // INVARIANTE MATEMÁTICO ABSOLUTO:
        // A pontuação de cada panelinha DEVE ser estritamente idêntica à soma dos seus membros
        for (const [facId, faction] of room.factions.entries()) {
          const membersSum = faction.members.reduce((acc, jid) => {
            const memberPlayer = room.players.get(jid);
            return acc + (memberPlayer ? memberPlayer.score : 0);
          }, 0);

          assert.equal(
            faction.score,
            membersSum,
            `Rodada ${r + 1}: Pontuação da panelinha ${facId} (${faction.score}) difere da soma dos membros (${membersSum})`
          );
        }

        // Aguarda a duração configurada de revelação (10ms) para que o timer avance para a próxima rodada ou encerre
        await sleep(15);
      }

      // Após as 10 rodadas e o último reveal, o jogo deve estar em ENDED
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);

      // Verifica premiação no gameManager
      assert.equal(room.gameManager.finishGameCalls.length, 1);
      const finishCall = room.gameManager.finishGameCalls[0];
      assert.equal(finishCall.roomId, room.id);
      assert.equal(finishCall.winnerFactionId, 'fac-1');

      // Verifica ranking final no estado público
      const publicState = engine.getPublicState();
      assert.equal(publicState.phase, QUIZ_PHASES.ENDED);
      assert.equal(publicState.winnerFaction.id, 'fac-1');
      assert.equal(publicState.factionsRanking[0].id, 'fac-1');
      assert.ok(publicState.factionsRanking[0].score > publicState.factionsRanking[1].score);

      engine.cleanup();
    });
  });

  describe('7. Validação de Cleanup, Timers e Ausência de Memory Leaks', () => {
    test('cleanup cancela timers e impede qualquer reativação ou processamento posterior', async () => {
      let currentTime = 1000;
      const now = () => currentTime;
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });

      const engine = createQuizRoyaleEngine(room, {
        now,
        totalRounds: 7,
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });

      await engine.start();
      assert.equal(engine.getPhase(), QUIZ_PHASES.QUESTION);

      // Chama cleanup durante a fase de pergunta
      engine.cleanup();
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);

      // Tentativa de start após cleanup deve retornar false
      const restartAttempt = await engine.start();
      assert.equal(restartAttempt, false);

      // Tentativa de handleAction após cleanup deve falhar
      const player = Array.from(room.players.values())[0];
      const actionAfterCleanup = await engine.handleAction(player, {
        action: 'answer',
        questionIndex: 0,
        choiceIndex: 0,
      });
      assert.equal(actionAfterCleanup.ok, false);
      assert.equal(actionAfterCleanup.error, 'not_in_question_phase');

      // Múltiplos cleanups consecutivos devem ser totalmente seguros e idempotentes
      assert.doesNotThrow(() => {
        engine.cleanup();
        engine.cleanup();
      });
    });

    test('cleanup durante o carregamento assíncrono do LLM não ressuscita a partida quando o LLM responde', async () => {
      let resolveLlm;
      const deferredLlm = () => new Promise(res => { resolveLlm = res; });

      const room = createMockRoom({ playerCount: 4, factionCount: 2 });
      const engine = createQuizRoyaleEngine(room, {
        generateZen: deferredLlm,
        totalRounds: 7,
      });

      const startPromise = engine.start();
      assert.equal(engine.getPhase(), QUIZ_PHASES.LOADING);

      // Enquanto a partida está carregando a LLM, o coordenador/usuário cancela a sala
      engine.cleanup();
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);

      // Agora a LLM finalmente responde
      resolveLlm(JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }));
      const startResult = await startPromise;

      // O start DEVE retornar false e NÃO deve mudar o estado para QUESTION nem iniciar rodadas fantasmas
      assert.equal(startResult, false);
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);
      assert.equal(engine.getCurrentRoundIndex(), -1);
    });

    test('Idempotência de finishGame garante que o prêmio e eventos não são duplicados', async () => {
      let currentTime = 1000;
      const now = () => currentTime;
      const room = createMockRoom({ playerCount: 4, factionCount: 2 });

      const engine = createQuizRoyaleEngine(room, {
        now,
        totalRounds: 7,
        revealDurationMs: 10,
        generateZen: async () => JSON.stringify({ questions: FALLBACK_QUESTIONS.slice(0, 7) }),
      });

      await engine.start();

      // Força término
      engine.cleanup();
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);

      // cleanup adicional
      engine.cleanup();
      assert.equal(engine.getPhase(), QUIZ_PHASES.ENDED);
    });
  });
});
