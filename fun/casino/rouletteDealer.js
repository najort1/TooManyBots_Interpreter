const DEALER_PERSONAS = [
  {
    id: 'pierre',
    name: 'Pierre',
    title: '🎩 Croupier',
    moodTags: ['elegant', 'dry', 'playful'],
    greetings: [
      'Bem-vindos à mesa. A roleta está girando.',
      'As apostas estão abertas. Boa sorte.',
      'Aguardando a bola. Quem arrisca?',
    ],
    phrases: {
      win: [
        'Acertou. A banca paga.',
        'Boa leitura da mesa.',
        'O número estava quente.',
        'Pagamento confirmado.',
      ],
      lose: [
        'A casa agradece.',
        'Não foi desta vez.',
        'A roleta não liga para palpites.',
        'A sorte não soprou pro seu lado.',
      ],
      zero: [
        'Zero. Verde. A casa leva.',
        'O zero aparece. Respeitem.',
        'Verde na mesa. Ninguém leva.',
      ],
      bigWin: [
        'Isso é raro. Pagamento excepcional.',
        'A mesa se curva. Grande acerto.',
        'Isso não acontece todo dia.',
      ],
      streak: [
        'Sequência impressionante.',
        'O padrão está se formando.',
        'A mesa está esquentando.',
      ],
      cold: [
        'Esse número está frio há muito tempo.',
        'O relógio não favorece esse número.',
        'Sessenta giros sem aparecer.',
      ],
      hot: [
        'Esse número aparece com frequência.',
        'A roda está tendenciosa hoje.',
      ],
      greedy: [
        'A banca agradece a colaboração.',
        'Continue apostando. A casa é paciente.',
        'Mais uma rodada? A casa espera.',
      ],
      shocked: [
        'Isso... não costuma acontecer.',
        'Impressionante. Raríssimo.',
        'Testemunhas disso? Eu não acreditaria.',
      ],
      firstBet: [
        'Primeira aposta? Vamos ver.',
        'Iniciante com sorte? Vamos descobrir.',
      ],
    },
  },
  {
    id: 'jack',
    name: 'Jack',
    title: '🤠 Croupier',
    moodTags: ['sarcastic', 'loud', 'competitive'],
    greetings: [
      'Roda girando, dinheiro mudando de mão.',
      'Quem tem coragem aposta. Quem não tem, observa.',
      'Bem-vindo ao jogo. Não culpe a casa depois.',
    ],
    phrases: {
      win: [
        'Pois é. Pagando o sortudo.',
        'Acertou! Não vai querer parar agora, vai?',
        'Boa! Um desses por hora e você quebra a banca.',
      ],
      lose: [
        'Perdeu. Achou que ia ser fácil?',
        'A casa não perde. Nunca.',
        'Tenta de novo. Talvez na próxima.',
        'Você sabia que 97% dos jogadores desistem antes de ganhar?',
      ],
      zero: [
        'Zero! A casa leva tudo.',
        'Verde. A roleta adora uma tragédia.',
        'Zero na mesa. Quem apostou no verde levantava.',
      ],
      bigWin: [
        'CARAMBA! Quem viu isso?!',
        'ISSO! Pagamento GIGANTE!',
        'A MESA PAGOU! INACREDITÁVEL!',
      ],
      streak: [
        'TÁ PEGANDO FOGO!',
        'Sequência dos deuses!',
        'Não para mais!',
      ],
      cold: [
        'Esse número existe? Porque não cai nunca.',
        'Já faz séculos que esse número não aparece.',
      ],
      hot: [
        'Esse número é o queridinho da roleta hoje.',
        'Só sai esse número, impressionante.',
      ],
      greedy: [
        'Isso mesmo, continuem apostando. Adoro ver isso.',
        'A banca está sorrindo hoje. Obrigado a todos.',
      ],
      shocked: [
        'NÃO ACREDITO! ISSO É LOUCURA!',
        'Mano... isso é pra ter acontecido?',
      ],
      firstBet: [
        'Um novato! Vamos ver se tem estrela.',
        'Sangue novo na mesa. Perigo ou oportunidade?',
      ],
    },
  },
  {
    id: 'ia',
    name: 'IA',
    title: '🎲 Croupier IA',
    moodTags: ['analytical', 'calm', 'robotic'],
    greetings: [
      'Processando. Roleta ativada. Apostas detectadas.',
      'Sistema de roleta online. Boa sorte, jogador.',
      'Inicializando giro. Probabilidades calculadas.',
    ],
    phrases: {
      win: [
        'Resultado positivo. Pagamento processado.',
        'Acerto confirmado. Crédito liberado.',
        'Vitória registrada. Parabéns.',
      ],
      lose: [
        'Resultado negativo. Tente novamente.',
        'Derrota registrada. A casa vence.',
        'Estatisticamente esperado. Próxima rodada.',
      ],
      zero: [
        'Zero. Casa vence. Estatística mantida.',
        'Zero detectado. Vantagem da casa aplicada.',
      ],
      bigWin: [
        'Anomalia estatística detectada. Pagamento excepcional.',
        'Evento de baixa probabilidade confirmado. Crédito máximo.',
      ],
      streak: [
        'Sequência acima da média detectada.',
        'Desvio padrão significativo observado.',
      ],
      cold: [
        'Número com frequência abaixo do esperado.',
        'Baixa probabilidade condicional observada.',
      ],
      hot: [
        'Número com frequência acima do esperado.',
        'Viés temporário detectado.',
      ],
      greedy: [
        'Margem da casa expandindo. Lucro projetado positivo.',
        'A casa opera com vantagem estatística.',
      ],
      shocked: [
        'ERRO: Probabilidade fora da faixa esperada. Recalculando...',
        'INCONSISTÊNCIA PROBABILÍSTICA DETECTADA.',
      ],
      firstBet: [
        'Novo jogador detectado. Iniciando registro.',
        'Primeira aposta registrada no sistema.',
      ],
    },
  },
  {
    id: 'carlotta',
    name: 'Carlotta',
    title: '💃 Croupier',
    moodTags: ['warm', 'charming', 'teasing'],
    greetings: [
      'Prontos para mais uma rodada? A roleta está esperando.',
      'Minha mesa está aberta. Quem senta?',
      'Vamos ver o que a sorte reservou hoje.',
    ],
    phrases: {
      win: [
        'Lindinho, você tem sorte.',
        'Acertou! Sabia que você ia gostar dessa.',
        'Parabéns, querido. A roleta sorriu pra você.',
      ],
      lose: [
        'Ah, que pena. A sorte estava distraída.',
        'Não foi agora. Mas você é persistente, gosto disso.',
        'Relaxa, a próxima é sua.',
      ],
      zero: [
        'Zero! O verde é traiçoeiro.',
        'O zero adora estragar surpresas.',
      ],
      bigWin: [
        'UAU! Isso é enorme! Que maravilha!',
        'MEU DEUS! Que acerto lindo!',
      ],
      streak: [
        'Você está on fire hoje!',
        'Só acertando! Continua assim!',
      ],
      cold: [
        'Esse número está tão frio quanto meu coração.',
        'Coitado desse número, ninguém lembra mais dele.',
      ],
      hot: [
        'Esse número não sai da roda!',
        'Quente, quente, quente!',
      ],
      greedy: [
        'Apostem mais, meus amores. A casa adora generosidade.',
        'Que noite lucrativa... pra casa.',
      ],
      shocked: [
        'NUNCA VI ISSO EM TODOS MEUS ANOS DE MESA!',
        'ISSO É HISTÓRICO!',
      ],
      firstBet: [
        'Uma carinha nova na mesa. Vamos ver no que dá.',
        'Que bom te ver por aqui. Aposta com confiança?',
      ],
    },
  },
];

function dealerSeed(scopeKey) {
  let h = 0;
  const s = String(scopeKey || '');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function pickDealer(scopeKey) {
  const seed = dealerSeed(scopeKey);
  return DEALER_PERSONAS[seed % DEALER_PERSONAS.length];
}

export function createDealerMood() {
  return {
    value: 'neutral',
    intensity: 1,
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getDealerPhrase(dealer, mood, event, _ctx = {}) {
  const pool = dealer.phrases[event];
  if (!pool || !pool.length) return null;
  return pickRandom(pool);
}

export function getDealerGreeting(dealer) {
  return pickRandom(dealer.greetings);
}

export function evolveMood(current, event) {
  const mood = { ...current };
  switch (event) {
    case 'bigWin':
    case 'streak':
      mood.value = 'excited';
      mood.intensity = Math.min(3, (mood.intensity || 1) + 1);
      break;
    case 'lose':
    case 'zero':
      if (current.value === 'excited') {
        mood.value = 'neutral';
        mood.intensity = 1;
      } else {
        mood.value = 'neutral';
      }
      break;
    case 'greedy':
      mood.value = 'sarcastic';
      mood.intensity = Math.min(2, (mood.intensity || 1) + 0.5);
      break;
    case 'shocked':
      mood.value = 'shocked';
      mood.intensity = 3;
      break;
    default:
      mood.value = 'neutral';
      mood.intensity = Math.max(0.5, (mood.intensity || 1) - 0.2);
  }
  return mood;
}
