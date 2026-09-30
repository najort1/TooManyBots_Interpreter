/**
 * Jogo 1: Quiz Royale das Panelinhas (4–20 jogadores)
 *
 * Motor de jogo de perguntas e respostas com temas dinâmicos gerados por IA (OpenCode Zen / OpenAI-compatible),
 * rodadas com tempo cronometrado (15s por pergunta, 4s de revelação), pontuação com bônus de velocidade,
 * suporte para 4 a 20 jogadores distribuídos em panelinhas (factions), e banco de backup resiliente.
 */

import { resolveZenEndpoint } from '../../llm/zenEndpoint.js';
import { openaiChatComplete } from '../../llm/openaiClient.js';
import { isLlmFeatureEnabled } from '../../llm/llmGovernance.js';

export const QUIZ_PHASES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  QUESTION: 'question',
  REVEAL: 'reveal',
  ENDED: 'ended',
});

export const QUIZ_CONSTANTS = Object.freeze({
  DEFAULT_TOTAL_ROUNDS: 8,
  MIN_ROUNDS: 7,
  MAX_ROUNDS: 10,
  QUESTION_DURATION_MS: 15_000, // 15 segundos para responder
  REVEAL_DURATION_MS: 4_000,    // 4 segundos para exibir resposta e placar
  BASE_SCORE: 100,              // Pontos base por acerto
  MAX_SPEED_BONUS: 50,          // Bônus máximo de velocidade
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 20,
});

/**
 * Banco robusto de perguntas de fallback categorizadas.
 * Garante que a partida nunca trave caso a LLM esteja indisponível, sem rede ou com timeout.
 */
export const FALLBACK_QUESTIONS = Object.freeze([
  {
    question: 'No meme clássico do YouTube brasileiro, qual eletrodoméstico caiu enquanto a menina dançava?',
    options: ['O forninho', 'A geladeira', 'O micro-ondas', 'A televisão'],
    correctIndex: 0,
    category: 'Memes Brasileiros',
    explanation: '"Eita Giovana, o forninho caiu!" é um dos marcos eternos da internet brasileira.',
  },
  {
    question: 'No viral "Acorda Pedrinho", o que a letra da música diz que Pedrinho tem que fazer hoje?',
    options: ['Lavar a louça', 'Vencer o campeonato', 'Dançar no pagode', 'Ir trabalhar cedo'],
    correctIndex: 1,
    category: 'Memes Brasileiros',
    explanation: '"Acorda Pedrinho, que hoje tem campeonato!" da banda Jovem Dionisio.',
  },
  {
    question: 'Qual é o nome do icônico personagem que dizia "Sabe de nada, inocente!" no comercial de TV?',
    options: ['Compadre Washington', 'Belo', 'Tiririca', 'Faustão'],
    correctIndex: 0,
    category: 'Memes Brasileiros',
    explanation: 'Bordão consagrado pelo Compadre Washington do É o Tchan.',
  },
  {
    question: 'Qual destas frases icônicas ficou famosa na voz de Inês Brasil em seu vídeo viral?',
    options: ['Alô alô, graças a Deus!', 'É sobre isso e tá tudo bem', 'Segura esse forninho', 'Errou feio, errou rude'],
    correctIndex: 0,
    category: 'Memes Brasileiros',
    explanation: '"Alô alô, graças a Deus!" é uma das marcas registradas de Inês Brasil.',
  },
  {
    question: 'No clássico meme "Já acabou, Jéssica?", qual foi a postura da garota ao fazer a pergunta?',
    options: ['Cruzou os braços em pé desafiando', 'Saiu correndo chorando', 'Tirou uma selfie rindo', 'Pediu desculpas de joelhos'],
    correctIndex: 0,
    category: 'Memes Brasileiros',
    explanation: 'A garota se levantou do chão, arrumou o uniforme e perguntou cruzando os braços com ironia.',
  },
  {
    question: 'Qual foi a primeira linguagem de programação de alto nível amplamente utilizada, criada pela IBM em 1957?',
    options: ['Fortran', 'COBOL', 'Assembly', 'C'],
    correctIndex: 0,
    category: 'Tecnologia',
    explanation: 'Fortran (Formula Translation) revolucionou a programação científica em 1957.',
  },
  {
    question: 'Qual animal é a mascote oficial do kernel Linux, batizado carinhosamente de Tux?',
    options: ['Um pinguim', 'Uma raposa', 'Um urso polar', 'Um golfinho'],
    correctIndex: 0,
    category: 'Tecnologia',
    explanation: 'Tux é o simpático pinguim criado por Larry Ewing em 1996.',
  },
  {
    question: 'Em que ano Steve Jobs subiu ao palco para apresentar o primeiro modelo do iPhone?',
    options: ['2007', '2005', '2009', '2010'],
    correctIndex: 0,
    category: 'Tecnologia',
    explanation: 'O primeiro iPhone foi apresentado em janeiro de 2007 na Macworld.',
  },
  {
    question: 'Qual protocolo de rede é encarregado de traduzir nomes de domínio como "google.com" em endereços IP?',
    options: ['DNS', 'DHCP', 'HTTP', 'SMTP'],
    correctIndex: 0,
    category: 'Tecnologia',
    explanation: 'DNS (Domain Name System) atua como o catálogo telefônico da internet.',
  },
  {
    question: 'Quantos dias o desenvolvedor Brendan Eich levou para criar a primeira versão do JavaScript em 1995?',
    options: ['10 dias', '30 dias', '6 meses', '1 ano'],
    correctIndex: 0,
    category: 'Tecnologia',
    explanation: 'Brendan Eich escreveu a versão inicial da linguagem em apenas 10 dias na Netscape.',
  },
  {
    question: 'Na franquia de jogos "The Legend of Zelda", qual é o nome do herói protagonista?',
    options: ['Link', 'Zelda', 'Ganon', 'Epona'],
    correctIndex: 0,
    category: 'Games',
    explanation: 'O herói de túnica verde é o Link; Zelda é a princesa do reino de Hyrule.',
  },
  {
    question: 'Em qual jogo clássico de tiro tático multiplayer surgiu a lendária expressão "Rush B"?',
    options: ['Counter-Strike', 'Call of Duty', 'Battlefield', 'Overwatch'],
    correctIndex: 0,
    category: 'Games',
    explanation: '"Rush B, não para!" é o chamado de guerra dos jogadores de Counter-Strike (Dust 2).',
  },
  {
    question: 'No universo de Minecraft, qual é a criatura verde e silenciosa que chia e explode perto do jogador?',
    options: ['Creeper', 'Enderman', 'Zombie Pigman', 'Ghast'],
    correctIndex: 0,
    category: 'Games',
    explanation: 'O Creeper nasceu de um erro de modelagem de um porco e virou o monstro mais famoso do jogo.',
  },
  {
    question: 'No jogo Dark Souls, qual cavaleiro solar ensina o famoso gesto e lema "Praise the Sun!"?',
    options: ['Solaire de Astora', 'Siegmeyer de Catarina', 'Lautrec de Carim', 'Artorias'],
    correctIndex: 0,
    category: 'Games',
    explanation: 'Solaire de Astora é o leal guerreiro da luz solar que busca seu próprio sol.',
  },
  {
    question: 'Qual estúdio de jogos polonês desenvolveu a aclamada trilogia The Witcher e Cyberpunk 2077?',
    options: ['CD Projekt Red', 'FromSoftware', 'Ubisoft', 'Bethesda'],
    correctIndex: 0,
    category: 'Games',
    explanation: 'CD Projekt Red foi fundada na Polônia e criou The Witcher com base nos livros de Andrzej Sapkowski.',
  },
  {
    question: 'Em 1932, a Austrália mobilizou soldados com metralhadoras em uma guerra oficial contra qual animal?',
    options: ['Emas (Emus)', 'Cangurus', 'Dingoes', 'Coelhos'],
    correctIndex: 0,
    category: 'História Bizarra',
    explanation: 'A "Guerra das Emus" terminou com a vitória estratégica das aves sobre o exército australiano.',
  },
  {
    question: 'Qual imperador romano é famoso pelo boato histórico de querer nomear seu cavalo Incitatus como cônsul?',
    options: ['Calígula', 'Nero', 'Júlio César', 'Cláudio'],
    correctIndex: 0,
    category: 'História Bizarra',
    explanation: 'Calígula demonstrava profundo desdém pelo senado romano mimando seu cavalo Incitatus.',
  },
  {
    question: 'Em 1518, na cidade de Estrasburgo, centenas de pessoas foram tomadas por uma epidemia misteriosa que as fazia:',
    options: ['Dançar sem parar por dias', 'Rir descontroladamente', 'Dormir por semanas', 'Cantar em coro'],
    correctIndex: 0,
    category: 'História Bizarra',
    explanation: 'A Epidemia de Dança de 1518 fez dezenas de cidadãos dançarem compulsivamente até o esgotamento.',
  },
  {
    question: 'Qual conflito medieval italiano entre Bolonha e Modena em 1325 ficou conhecido por ter sido motivado por um balde roubado?',
    options: ['Guerra do Balde de Carvalho', 'Guerra do Vinho', 'Batalha do Queijo', 'Cruzada da Água Doce'],
    correctIndex: 0,
    category: 'História Bizarra',
    explanation: 'A Guerra da Secchia Rapita (Guerra do Balde) ocorreu após soldados de Modena levarem um balde de um poço de Bolonha.',
  },
  {
    question: 'Em Matrix (1999), qual pílula Neo engole para acordar da simulação e ver a realidade?',
    options: ['A pílula vermelha', 'A pílula azul', 'A pílula verde', 'A pílula preta'],
    correctIndex: 0,
    category: 'Cultura Pop',
    explanation: 'Morpheus oferece a escolha: a azul para esquecer tudo ou a vermelha para ver até onde vai a toca do coelho.',
  },
  {
    question: 'Na série Breaking Bad, qual pseudônimo o professor Walter White adota ao entrar no submundo do crime?',
    options: ['Heisenberg', 'Schrödinger', 'Oppenheimer', 'Einstein'],
    correctIndex: 0,
    category: 'Cultura Pop',
    explanation: 'Walter escolhe o nome do físico alemão Werner Heisenberg, criador do princípio da incerteza.',
  },
  {
    question: 'No mundo mágico de Harry Potter, qual artefato falante determina a casa dos novos alunos em Hogwarts?',
    options: ['Chapéu Seletor', 'Espelho de Ojesed', 'Diário de Riddle', 'Cálice de Fogo'],
    correctIndex: 0,
    category: 'Cultura Pop',
    explanation: 'O Chapéu Seletor lê as mentes dos alunos e decide entre Grifinória, Sonserina, Corvinal e Lufa-Lufa.',
  },
  {
    question: 'O que tem cabeça, dentes, casca, não morde, não pensa e serve para temperar comida?',
    options: ['Alho', 'Cebola', 'Pente', 'Milho'],
    correctIndex: 0,
    category: 'Enigmas',
    explanation: 'Uma cabeça de alho tem dentes de alho e casca!',
  },
  {
    question: 'Qual é o único mamífero capaz de voar de verdade com asas autênticas?',
    options: ['Morcego', 'Esquilo-voador', 'Pato', 'Lêmure'],
    correctIndex: 0,
    category: 'Ciência Curiosa',
    explanation: 'Os morcegos são os únicos mamíferos com capacidade de voo propulsionado ativo.',
  },
  {
    question: 'Quantos corações possui um polvo comum para bombear sangue em seu corpo?',
    options: ['3 corações', '1 coração', '2 corações', '4 corações'],
    correctIndex: 0,
    category: 'Ciência Curiosa',
    explanation: 'Polvos têm 3 corações: dois bombeiam sangue para as brânquias e um para o resto do corpo.',
  },
  {
    question: 'Qual planeta do Sistema Solar gira tão devagar que o seu dia é mais longo que o seu ano?',
    options: ['Vênus', 'Marte', 'Mercúrio', 'Júpiter'],
    correctIndex: 0,
    category: 'Ciência Curiosa',
    explanation: 'Vênus leva 243 dias terrestres para dar uma volta sobre si mesmo e 225 dias para orbitar o Sol.',
  },
  {
    question: 'O que pode percorrer o mundo inteiro e atravessar fronteiras ficando parado no mesmo cantinho?',
    options: ['O selo postal', 'O mapa', 'A bússola', 'O passaporte'],
    correctIndex: 0,
    category: 'Enigmas',
    explanation: 'O selo postal fica colado no canto da carta enquanto ela viaja pelo planeta.',
  },
]);

/**
 * Embaralha um array usando o algoritmo Fisher-Yates com função de aleatoriedade configurável.
 */
function shuffleArray(arr, random = Math.random) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Embaralha as alternativas de uma pergunta preservando a resposta correta.
 */
function shuffleQuestionOptions(question, random = Math.random) {
  const originalOptions = question.options || [];
  const correctOptionText = originalOptions[question.correctIndex];
  const shuffledOptions = shuffleArray(originalOptions, random);
  const newCorrectIndex = shuffledOptions.indexOf(correctOptionText);

  return {
    ...question,
    options: shuffledOptions,
    correctIndex: newCorrectIndex >= 0 ? newCorrectIndex : 0,
  };
}

/**
 * Sanitiza e valida o array de perguntas retornado pelo LLM.
 */
function sanitizeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return [];
  const valid = [];

  for (const item of rawQuestions) {
    if (!item || typeof item !== 'object') continue;
    const questionText = String(item.question || '').trim();
    const options = Array.isArray(item.options) ? item.options.map(o => String(o || '').trim()) : [];
    const correctIndex = Number(item.correctIndex);
    const category = String(item.category || 'Conhecimentos Gerais').trim();
    const explanation = String(item.explanation || '').trim();

    if (questionText.length < 6) continue;
    if (options.length !== 4 || options.some(o => o.length === 0)) continue;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;

    valid.push({
      question: questionText,
      options,
      correctIndex,
      category,
      explanation,
    });
  }

  return valid;
}

/**
 * Gera perguntas dinâmicas usando OpenAI/Zen com fallback imediato em caso de erro ou timeout.
 */
export async function generateQuizQuestions({
  count = QUIZ_CONSTANTS.DEFAULT_TOTAL_ROUNDS,
  funConfig = {},
  generateZen = openaiChatComplete,
  random = Math.random,
} = {}) {
  const targetCount = Math.min(
    QUIZ_CONSTANTS.MAX_ROUNDS,
    Math.max(QUIZ_CONSTANTS.MIN_ROUNDS, Math.floor(Number(count) || QUIZ_CONSTANTS.DEFAULT_TOTAL_ROUNDS))
  );

  // Se o LLM estiver desativado pelo master/feature ou no ambiente de teste, usa fallback
  const isLlmDisabled = !isLlmFeatureEnabled(funConfig, 'quizRoyale') || (process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete);

  if (!isLlmDisabled && typeof generateZen === 'function') {
    const { baseUrl, model, apiKey } = resolveZenEndpoint(funConfig);

    const systemPrompt = [
      'Você é o mestre de quiz supremo de um bot de WhatsApp brasileiro altamente animado e divertido.',
      'Sua missão é gerar perguntas de múltipla escolha inéditas, instigantes e hilárias.',
      'Temas variados: cultura pop, curiosidades de tecnologia, games, história bizarra, memes brasileiros e enigmas.',
      'Responda ESTRITAMENTE em formato JSON.',
    ].join(' ');

    const userPrompt = [
      `Gere exatamente ${targetCount} perguntas criativas de múltipla escolha para uma competição de quiz royale.`,
      'Cada pergunta DEVE ter:',
      '- question: texto da pergunta claro e bem formulado em português do Brasil.',
      '- options: lista com exatamente 4 opções de resposta plausíveis.',
      '- correctIndex: número inteiro de 0 a 3 indicando a opção correta.',
      '- category: nome da categoria (ex: "Memes BR", "Cultura Pop", "Games", "Tecnologia", "História Bizarra").',
      '- explanation: breve explicação divertida e curiosa sobre a resposta certa.',
      'Formato JSON obrigatório:',
      '{"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0,"category":"...","explanation":"..."}]}',
    ].join('\n');

    try {
      const rawResponse = await generateZen({
        baseUrl,
        model,
        apiKey,
        system: systemPrompt,
        prompt: userPrompt,
        timeoutMs: 25_000,
        maxTokens: 2000,
        temperature: 0.9,
        jsonMode: true,
        jsonOnly: true,
        sendSamplingParams: funConfig?.zenSendSamplingParams === true,
      });

      if (rawResponse) {
        let parsed = null;
        try {
          parsed = typeof rawResponse === 'object' ? rawResponse : JSON.parse(rawResponse);
        } catch {
          const match = String(rawResponse).match(/\{[\s\S]*\}/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch {
              parsed = null;
            }
          }
        }

        const candidateQuestions = parsed?.questions || (Array.isArray(parsed) ? parsed : []);
        const sanitized = sanitizeQuestions(candidateQuestions);

        if (sanitized.length >= targetCount) {
          return sanitized.slice(0, targetCount).map(q => shuffleQuestionOptions(q, random));
        }
      }
    } catch (err) {
      console.warn('[quizRoyaleEngine] Falha na geração via LLM, acionando fallback robusto:', err?.message || err);
    }
  }

  // Fallback garantido: embaralha e seleciona perguntas do banco local
  const shuffledFallback = shuffleArray(FALLBACK_QUESTIONS, random);
  const selected = shuffledFallback.slice(0, targetCount);

  return selected.map(q => shuffleQuestionOptions(q, random));
}

/**
 * Cria a instância do motor de jogo Quiz Royale.
 *
 * @param {object} room Sala criada pelo GameManager
 * @param {object} [options]
 * @param {object} [options.funConfig] Configuração do bot / Zen LLM
 * @param {Function} [options.now] Provedor de timestamp atual
 * @param {Function} [options.generateZen] Injeção de cliente LLM
 * @param {Function} [options.random] Gerador de aleatoriedade
 * @param {object} [options.gameManager] Instância do GameManager caso passada explicitamente
 * @param {number} [options.totalRounds] Total de rodadas (7 a 10)
 * @returns {object} QuizRoyaleEngine instance
 */
export function createQuizRoyaleEngine(room, {
  funConfig = {},
  now = Date.now,
  generateZen = openaiChatComplete,
  random = Math.random,
  gameManager = null,
  totalRounds = QUIZ_CONSTANTS.DEFAULT_TOTAL_ROUNDS,
  questionDurationMs = QUIZ_CONSTANTS.QUESTION_DURATION_MS,
  revealDurationMs = QUIZ_CONSTANTS.REVEAL_DURATION_MS,
} = {}) {
  if (!room) {
    throw new Error('[quizRoyaleEngine] Objeto room é obrigatório');
  }

  const gm = gameManager || room.gameManager || null;
  const targetRounds = Math.min(
    QUIZ_CONSTANTS.MAX_ROUNDS,
    Math.max(QUIZ_CONSTANTS.MIN_ROUNDS, Math.floor(Number(totalRounds) || QUIZ_CONSTANTS.DEFAULT_TOTAL_ROUNDS))
  );

  // Estado interno do motor
  let phase = QUIZ_PHASES.IDLE;
  let questions = [];
  let currentRoundIndex = -1;
  let phaseStartedAt = 0;
  let phaseEndsAt = 0;

  /**
   * Respostas da rodada atual
   * Map<userJid, { userJid, username, factionId, choiceIndex, isCorrect, pointsEarned, answeredAt }>
   */
  let currentAnswers = new Map();

  /**
   * Estatísticas da última rodada revelada
   */
  let lastRoundStats = null;

  // Timers e estado final
  let phaseTimeout = null;
  let finalGameStats = null;

  /**
   * Broadcast seguro via GameManager ou clientes da sala.
   */
  function broadcast(eventName, payload) {
    if (gm?.broadcast) {
      gm.broadcast(room, eventName, payload);
    } else if (room.clients) {
      const dataStr = JSON.stringify(payload);
      const message = `event: ${eventName}\ndata: ${dataStr}\n\n`;
      for (const res of room.clients) {
        try {
          res.write(message);
        } catch {
          room.clients.delete(res);
        }
      }
    }
  }

  function clearAllTimers() {
    if (phaseTimeout) {
      clearTimeout(phaseTimeout);
      phaseTimeout = null;
    }
  }

  /**
   * Retorna o ranking consolidado das panelinhas ordenado por pontos.
   */
  function getFactionsRanking() {
    return Array.from(room.factions.values())
      .map(fac => ({
        id: fac.id,
        name: fac.name,
        emoji: fac.emoji || '🏴‍☠️',
        score: Number(fac.score) || 0,
        playerCount: Array.isArray(fac.members) ? fac.members.length : 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Retorna o ranking individual dos jogadores ordenado por pontos.
   */
  function getPlayersRanking() {
    return Array.from(room.players.values())
      .map(p => ({
        userJid: p.userJid,
        username: p.username,
        faction: p.faction,
        score: Number(p.score) || 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Identifica a panelinha que está na liderança.
   */
  function getWinningFaction() {
    const sorted = getFactionsRanking();
    return sorted.length > 0 ? sorted[0] : null;
  }

  /**
   * Inicia o carregamento das perguntas e a primeira rodada.
   */
  async function start() {
    if (phase !== QUIZ_PHASES.IDLE) {
      return false;
    }

    phase = QUIZ_PHASES.LOADING;
    broadcast('quiz_loading', { message: 'A IA está formulando as perguntas da partida...' });

    try {
      questions = await generateQuizQuestions({
        count: targetRounds,
        funConfig,
        generateZen,
        random,
      });
    } catch (err) {
      console.error('[quizRoyaleEngine] Erro crítico ao carregar perguntas:', err);
      // Fallback de emergência absoluto
      questions = FALLBACK_QUESTIONS.slice(0, targetRounds).map(q => shuffleQuestionOptions(q, random));
    }

    // Se a partida foi cancelada ou limpa durante o carregamento assíncrono do LLM, aborta
    if (phase !== QUIZ_PHASES.LOADING) {
      return false;
    }

    if (!questions || questions.length === 0) {
      questions = FALLBACK_QUESTIONS.slice(0, targetRounds).map(q => shuffleQuestionOptions(q, random));
    }

    // Inicia a primeira rodada
    startRound(0);
    return true;
  }

  /**
   * Inicia a rodada especificada na Fase de Pergunta (15s).
   */
  function startRound(roundIndex) {
    clearAllTimers();

    if (roundIndex >= questions.length) {
      finishGame();
      return;
    }

    currentRoundIndex = roundIndex;
    phase = QUIZ_PHASES.QUESTION;
    phaseStartedAt = now();
    phaseEndsAt = phaseStartedAt + questionDurationMs;
    currentAnswers.clear();

    const currentQ = questions[currentRoundIndex];

    // Transmite a nova pergunta sem revelar a resposta correta
    broadcast('round_question', {
      round: currentRoundIndex + 1,
      totalRounds: questions.length,
      timeRemainingMs: questionDurationMs,
      remainingSeconds: Math.ceil(questionDurationMs / 1000),
      question: {
        index: currentRoundIndex,
        prompt: currentQ.question,
        category: currentQ.category,
        options: currentQ.options,
      },
      factionsRanking: getFactionsRanking(),
      totalPlayers: room.players.size,
    });

    // Encerra a pergunta quando os segundos expirarem
    phaseTimeout = setTimeout(() => {
      endQuestionPhase();
    }, questionDurationMs);
  }

  /**
   * Encerra a fase de pergunta e inicia a Fase de Revelação (4s).
   */
  function endQuestionPhase() {
    clearAllTimers();

    if (phase !== QUIZ_PHASES.QUESTION) {
      return;
    }

    phase = QUIZ_PHASES.REVEAL;
    phaseStartedAt = now();
    phaseEndsAt = phaseStartedAt + revealDurationMs;

    const currentQ = questions[currentRoundIndex];
    const answersList = Array.from(currentAnswers.values());

    const correctAnswers = answersList.filter(a => a.isCorrect);
    const wrongAnswers = answersList.filter(a => !a.isCorrect);

    // Identifica jogadores que não responderam a tempo
    const unansweredPlayers = [];
    for (const [jid, player] of room.players.entries()) {
      if (!currentAnswers.has(jid)) {
        unansweredPlayers.push({
          userJid: jid,
          username: player.username,
          factionId: player.faction?.id || null,
        });
      }
    }

    lastRoundStats = {
      round: currentRoundIndex + 1,
      totalRounds: questions.length,
      correctIndex: currentQ.correctIndex,
      correctOption: currentQ.options[currentQ.correctIndex],
      explanation: currentQ.explanation,
      totalAnswers: answersList.length,
      correctCount: correctAnswers.length,
      wrongCount: wrongAnswers.length,
      unansweredCount: unansweredPlayers.length,
      answers: answersList.map(a => ({
        userJid: a.userJid,
        username: a.username,
        factionId: a.factionId,
        choiceIndex: a.choiceIndex,
        isCorrect: a.isCorrect,
        pointsEarned: a.pointsEarned,
      })),
      factionsRanking: getFactionsRanking(),
    };

    // Transmite os resultados da rodada para todos os clientes
    broadcast('round_reveal', {
      round: currentRoundIndex + 1,
      totalRounds: questions.length,
      timeRemainingMs: revealDurationMs,
      remainingSeconds: Math.ceil(revealDurationMs / 1000),
      question: {
        index: currentRoundIndex,
        prompt: currentQ.question,
        category: currentQ.category,
        options: currentQ.options,
        correctIndex: currentQ.correctIndex,
        explanation: currentQ.explanation,
      },
      stats: lastRoundStats,
      factionsRanking: getFactionsRanking(),
      playersRanking: getPlayersRanking(),
    });

    // Aguarda a duração de revelação antes de ir para a próxima rodada ou finalizar
    phaseTimeout = setTimeout(() => {
      const nextIndex = currentRoundIndex + 1;
      if (nextIndex < questions.length) {
        startRound(nextIndex);
      } else {
        finishGame();
      }
    }, revealDurationMs);
  }

  /**
   * Finaliza a partida e aciona a premiação no GameManager.
   */
  async function finishGame() {
    clearAllTimers();
    if (phase === QUIZ_PHASES.ENDED) {
      return;
    }
    phase = QUIZ_PHASES.ENDED;

    const winningFaction = getWinningFaction();
    const winningFactionId = winningFaction ? winningFaction.id : null;

    const finalStats = {
      gameType: room.gameType,
      totalRounds: questions.length,
      totalPlayers: room.players.size,
      winningFaction,
      factionsRanking: getFactionsRanking(),
      playersRanking: getPlayersRanking(),
      completedAt: now(),
    };

    finalGameStats = finalStats;

    broadcast('quiz_ended', finalStats);

    const activeGm = gm || room.gameManager;
    if (activeGm?.finishGame) {
      try {
        await activeGm.finishGame(room.id, winningFactionId, finalStats);
      } catch (err) {
        console.error('[quizRoyaleEngine] Erro ao invocar gameManager.finishGame:', err);
      }
    }
  }

  /**
   * Trata a ação de resposta enviada por um jogador.
   *
   * Formato esperado:
   * actionData: { action: 'answer', questionIndex: number, choiceIndex: number }
   */
  async function handleAction(playerSession, actionData) {
    if (phase !== QUIZ_PHASES.QUESTION) {
      return {
        ok: false,
        error: 'not_in_question_phase',
        message: 'Respostas só podem ser enviadas durante a fase de pergunta.',
      };
    }

    const userJid = playerSession?.userJid || playerSession?.player?.userJid;
    if (!userJid || !room.players.has(userJid)) {
      return {
        ok: false,
        error: 'player_not_in_room',
        message: 'Você não está registrado nesta partida.',
      };
    }

    const actionType = String(actionData?.action || '').trim().toLowerCase();
    if (actionType !== 'answer') {
      return {
        ok: false,
        error: 'unknown_action',
        message: `Ação "${actionType}" não é reconhecida pelo Quiz Royale.`,
      };
    }

    const rawQIdx = actionData?.questionIndex;
    if (typeof rawQIdx !== 'number' || !Number.isInteger(rawQIdx) || rawQIdx !== currentRoundIndex) {
      return {
        ok: false,
        error: 'invalid_question_index',
        message: 'Esta resposta se refere a uma pergunta diferente da atual.',
      };
    }

    const rawChoiceIdx = actionData?.choiceIndex;
    if (typeof rawChoiceIdx !== 'number' || !Number.isInteger(rawChoiceIdx) || rawChoiceIdx < 0 || rawChoiceIdx > 3) {
      return {
        ok: false,
        error: 'invalid_choice_index',
        message: 'A alternativa escolhida deve ser um número entre 0 e 3 (A, B, C ou D).',
      };
    }

    // Impede múltiplas respostas na mesma pergunta
    if (currentAnswers.has(userJid)) {
      return {
        ok: false,
        error: 'already_answered',
        message: 'Você já respondeu a pergunta desta rodada!',
      };
    }

    const currentQ = questions[currentRoundIndex];
    const isCorrect = rawChoiceIdx === currentQ.correctIndex;
    const answeredAt = now();

    // Cálculo da pontuação:
    // Acerto base: 100 pontos
    // Bônus de velocidade: até +50 pontos proporcional ao tempo restante
    let pointsEarned = 0;
    if (isCorrect) {
      const remainingMs = Math.max(0, phaseEndsAt - answeredAt);
      const speedBonus = Math.min(
        QUIZ_CONSTANTS.MAX_SPEED_BONUS,
        Math.max(0, Math.round((remainingMs / questionDurationMs) * QUIZ_CONSTANTS.MAX_SPEED_BONUS))
      );
      pointsEarned = QUIZ_CONSTANTS.BASE_SCORE + speedBonus;
    }

    const player = room.players.get(userJid);
    player.score = (Number(player.score) || 0) + pointsEarned;

    const factionId = playerSession?.faction?.id || player.faction?.id;
    if (factionId && room.factions.has(factionId)) {
      const faction = room.factions.get(factionId);
      faction.score = (Number(faction.score) || 0) + pointsEarned;
    }

    const answerRecord = {
      userJid,
      username: player.username,
      factionId: factionId || null,
      choiceIndex: rawChoiceIdx,
      isCorrect,
      pointsEarned,
      answeredAt,
    };
    currentAnswers.set(userJid, answerRecord);

    // Notifica que o jogador respondeu (sem revelar se acertou ou qual escolheu para evitar cola)
    broadcast('player_answered', {
      userJid,
      username: player.username,
      factionId,
      answeredCount: currentAnswers.size,
      totalPlayers: room.players.size,
    });

    // Se todos os jogadores na sala responderam antes dos 15s, avança imediatamente para a revelação
    if (room.players.size > 0 && currentAnswers.size >= room.players.size) {
      endQuestionPhase();
    }

    return {
      ok: true,
      answered: true,
      pointsEarned,
      isCorrect,
      message: isCorrect ? 'Resposta correta registrada!' : 'Resposta incorreta registrada!',
    };
  }

  /**
   * Retorna o estado público para sincronização com o frontend.
   * Não expõe a resposta correta enquanto a rodada estiver em fase de pergunta.
   */
  function getPublicState() {
    const currentTime = now();
    const remainingMs = Math.max(0, phaseEndsAt - currentTime);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    const baseState = {
      phase,
      round: currentRoundIndex >= 0 ? currentRoundIndex + 1 : 0,
      currentRound: currentRoundIndex,
      totalRounds: questions.length || targetRounds,
      remainingSeconds,
      timeRemainingMs: remainingMs,
      timeRemainingSeconds: remainingSeconds,
      factionsRanking: getFactionsRanking(),
      playersRanking: getPlayersRanking(),
      answeredCount: currentAnswers.size,
      totalPlayers: room.players.size,
    };

    if (phase === QUIZ_PHASES.QUESTION && questions[currentRoundIndex]) {
      const q = questions[currentRoundIndex];
      const questionObj = {
        index: currentRoundIndex,
        prompt: q.question,
        question: q.question,
        category: q.category,
        options: q.options,
        // correctIndex omitido deliberadamente
      };
      return {
        ...baseState,
        question: questionObj,
        currentQuestion: questionObj,
      };
    }

    if (phase === QUIZ_PHASES.REVEAL && questions[currentRoundIndex]) {
      const q = questions[currentRoundIndex];
      const questionObj = {
        index: currentRoundIndex,
        prompt: q.question,
        question: q.question,
        category: q.category,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      };
      return {
        ...baseState,
        question: questionObj,
        currentQuestion: questionObj,
        roundStats: lastRoundStats,
      };
    }

    if (phase === QUIZ_PHASES.ENDED) {
      return {
        ...baseState,
        winnerFaction: getWinningFaction(),
        finalStats: finalGameStats || lastRoundStats,
      };
    }

    return baseState;
  }

  /**
   * Limpa todos os timers e recursos pendentes do motor.
   */
  function cleanup() {
    clearAllTimers();
    phase = QUIZ_PHASES.ENDED;
    currentAnswers.clear();
  }

  return {
    start,
    handleAction,
    getPublicState,
    cleanup,
    // Acesso seguro para inspeção/testes
    getQuestions: () => [...questions],
    getCurrentRoundIndex: () => currentRoundIndex,
    getPhase: () => phase,
  };
}

export default createQuizRoyaleEngine;
