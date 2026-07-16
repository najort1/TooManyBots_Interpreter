import { ollamaGenerate, ollamaWarmup, ollamaTouch } from './ollamaClient.js';
import { openaiChatComplete } from './openaiClient.js';

const SYSTEM_PROMPT = `Você é o narrador de um bot de diversão de WhatsApp BR (pt-BR do dia a dia, não de livro).

Voz: grupo de amigos zoando. Natural, irônico, carinhoso na sacanagem. Pode ter piada leve e duplo sentido de vez em quando — sem forçar, sem cringe, sem soar IA genérica.

Escreva 1 a 3 frases (até ~1000 caracteres).

Pode: gíria BR leve (pô, mano, né, viu, kkk, meteu o louco, pagou mico, se lascou).
Pode: humor seco, indireta, "olha o casal", "foi de base", "hoje não é o dia".

NÃO:
- inventar coins, XP, vencedor, placar ou regra de jogo (o bot já mostrou)
- inglês, tom de anúncio, "seamless/unlock/vibes"
- ofensa pesada, preconceito, puteiro explícito
- markdown, lista, aspas no começo/fim
- explicar o que vai fazer — só manda o comentário

No máximo 3 emojis. Só o texto final.`;

/** System enxuto pro Zen (modelos free se perdem com prompt longo). */
const ZEN_SYSTEM_PROMPT = `Narrador de zap BR. Só pt-BR de verdade (1–3 frases, até 1000 chars). Tom: zoação de grupo, ironia leve, às vezes um duplo sentido sutil — nunca forçado nem IA genérica. Sem markdown, sem aspas, sem inglês, sem ofensa pesada. Não invente números de jogo. Máx 3 emojis. Só o texto final.`;

/**
 * Roteiro besteirol de assalto — história LONGA (não uma frase).
 * Usado só nos cenários assault_*.
 */
const ASSAULT_STORY_SYSTEM = `Você é roteirista de FILME BESTEIROL brasileiro de assalto (tipo comédia de ação barata de bairro).

Escreva um ROTEIRO CURTO DE CINEMA, em português do Brasil, bem narrado, engraçado e cinematográfico.

FORMATO OBRIGATÓRIO (use exatamente estes marcadores de cena):
🎬 TÍTULO: (nome inventado do filme, em caps ou estilo cartaz)
CENA 1 — PREPARAÇÃO
(parágrafo: o plano, o nervoso, a arma, o clima)
CENA 2 — AÇÃO
(parágrafo: a entrada, o caos, diálogos curtos entre aspas se quiser)
CENA 3 — FUGA / CONSEQUÊNCIA
(parágrafo: fuga, mico ou vitória, sirene, vizinho, etc.)
EPÍLOGO
(1–2 frases de fechamento irônico pro grupo do zap)

TAMANHO: entre 900 e 1800 caracteres. Várias frases por cena. NÃO seja curto. NÃO resuma em 2 linhas.

TOM: besteirol, exagerado, gíria BR, vergonha alheia carinhosa. Pode ter diálogos.

NÃO:
- inventar quantia de coins, saldo, multa, XP, chance % ou placar (o bot já mostra os números)
- gore, ofensa pesada, preconceito, conteúdo sexual explícito
- inglês, lista com bullets, "como IA", meta sobre o prompt
- aspas envolvendo o texto inteiro

Só o roteiro final.`;

const ASSAULT_STORY_ZEN_SYSTEM = `Roteirista de filme besteirol BR de assalto. Escreva ROTEIRO LONGO (900–1800 chars) com:
🎬 TÍTULO:
CENA 1 — PREPARAÇÃO
CENA 2 — AÇÃO
CENA 3 — FUGA / CONSEQUÊNCIA
EPÍLOGO
Várias frases por cena, humor de bairro, diálogos ok. pt-BR. NÃO invente coins/saldo/multa/%. Sem gore nem ofensa pesada. Só o roteiro.`;

function isAssaultScenario(key) {
  return String(key || '').startsWith('assault_');
}

/** Fallbacks estáticos — sempre seguros se LLM falhar. */
const FALLBACKS = {
  faction_create: (v) =>
    pick([
      `*${v.name || 'A panelinha'}* saiu do papel. Agora é oficial… e o drama também.`,
      `Registrou *${v.name || 'o time'}*. Se der ruim, a culpa é coletiva, viu.`,
      `*${v.name || 'Eles'}* abriram a firma. Só falta alguém trair o líder no primeiro daily.`,
    ]),
  faction_join: (v) =>
    pick([
      `*${v.user || 'Fulano'}* entrou no *${v.name || 'time'}*. Bem-vindo(a) ao caos organizado.`,
      `Mais um no *${v.name || 'clã'}*. A panelinha engrossou… o contador, né.`,
      `*${v.user || 'Alguém'}* assinou a carteira do *${v.name || 'grupo'}*. Holerite: zero.`,
    ]),
  faction_leave: (v) =>
    pick([
      `*${v.user || 'Fulano'}* largou o *${v.name || 'barco'}*. Porta bateu, ego não.`,
      v.dissolved
        ? `*${v.name || 'A facção'}* acabou. Ficou só o mico e o histórico.`
        : `*${v.user || 'Alguém'}* saiu do *${v.name || 'time'}*. O chat já inventou o motivo.`,
      `Saída confirmada. Às vezes é só “preciso de um tempo”… da panelinha.`,
    ]),
  mission_spawn: () =>
    pick([
      'Squad misto no ar. Ou colaboram, ou viram print de vergonha.',
      'Missão entre facções diferentes. Paz falsa, prêmio real.',
      'Operação Mistura: daily, aposta e ship. Quem falhar, paga o mico.',
    ]),
  event_start: (v) =>
    pick([
      `Trégua falsa por uns *${v.minutes || '?'}* min. Falar com “o inimigo” agora rende.`,
      'Evento: sair da bolha da panelinha tá valendo mais. Coincidência? Não.',
      'Janela cross-facção aberta. Isolado perde o meta — e a moral.',
    ]),
  marry_propose: (v) =>
    pick([
      `*${v.me || 'Alguém'}* foi de joelho (digital) pra *${v.other || 'alguém'}*. O grupo já tá no cinema.`,
      'Pedido mandado. Agora é coragem… ou recusar e virar lore.',
      `*${v.me || 'Fulano'}* botou o relacionamento em votação pública. Classicamente BR.`,
    ]),
  marry_accept: (v) =>
    pick([
      `*${v.a || 'A'}* e *${v.b || 'B'}* casaram no zap. Parabéns — e boa sorte no divórcio free.`,
      'Aliança confirmada. Já tem enquete de “quanto tempo dura?”.',
      'Casamento selado. O daily agora é a dois… ou a treta fica a dois.',
    ]),
  marry_mutual: (v) =>
    pick([
      `Pedido mútuo: *${v.a || 'A'}* e *${v.b || 'B'}* se acharam. Raro, quase assustador.`,
      'Os dois pediram ao mesmo tempo. Destino ou desespero coletivo? Os dois.',
    ]),
  job_done: (v) =>
    pick([
      v.flavor
        ? `${v.flavor} — suou a camisa (ou o teclado) e saiu com coins.`
        : 'Trabalhou no grupo. Honestidade duvidosa, pagamento real.',
      'Expediente fechado. Até o próximo turno de exploração assalariada.',
      'Bateu ponto no chat. CLT emocional, PJ de coins.',
    ]),
  flip_win: () =>
    pick([
      'A moeda te escolheu hoje. Aproveita antes dela te trair de novo.',
      'Caiu do seu lado. Sorte ou o universo de mau humor com o outro?',
      'Acertou. Agora finge que foi skill.',
      'Vitória limpa… se a gente ignorar que é 50/50.',
    ]),
  flip_lose: () =>
    pick([
      'A moeda te deu um chapéu. Clássico nacional.',
      'Errou o lado. O chat ri, o saldo chora.',
      'Hoje a coroa (ou a cara) não tava pra você.',
      'Foi de base na moeda. Respira e tenta depois do cooldown.',
    ]),
  bet_result: (v) =>
    pick([
      v.winner
        ? `*${v.winner}* levou o pot. *${v.loser || 'O outro'}* ficou com a moral e o mico.`
        : 'Aposta resolvida. Um ri agora, o outro jura que “era só brincadeira”.',
      'Duelo de moeda fechado. Drama entregue, recibo em emoji.',
      v.winner
        ? `*${v.winner}* saiu com o bolo. *${v.loser || 'Perdedor'}* que pague o café da vergonha.`
        : 'Fim da aposta. Próximo round é orgulho ferido.',
    ]),
  ship: (v) => {
    const p = Number(v.percent) || 0;
    if (p >= 80) {
      return pick([
        'Química absurda. Já pode abrir a fanfic no grupo.',
        'Ship alto desse jeito… alguém vai ter que assumir ou fugir do país.',
        'Tá quase oficial. Falta só o /marry e a coragem.',
      ]);
    }
    if (p >= 50) {
      return pick([
        'Tem potencial. Falta um daily juntos e menos vergonha na cara.',
        'Meio a meio: nem namoro, nem só amizade — o pior dos mundos.',
        'Dá pra forçar o destino… ou deixar o clima estranho no ar.',
      ]);
    }
    return pick([
      'Ship gelado. Amizade talvez — ou rivalidade com zero intenção.',
      'Percentual tímido. O universo deu um “hmm” e mudou de assunto.',
      'Frio demais. Melhor não forçar… a não ser que o grupo force por vocês.',
    ]);
  },
  lucky_hit: () =>
    pick([
      'Sorte bateu na porta. Raro, gostoso e sem explicação.',
      'O RNG te beijou na testa. Não se acostuma.',
      'Caiu um dinheirinho do céu. Ou do bot. Mesma coisa.',
    ]),
  lucky_miss: () =>
    pick([
      'Azar puro. O universo tirou férias e te esqueceu na fila.',
      'Saiu nada. Clássico: esperança alta, retorno zero.',
      'Hoje não. Volta daqui a umas horas e finge que confia de novo.',
    ]),
  level_up: (v) =>
    pick([
      `Subiu pro level *${v.level || '?'}*. O rank tremeu — ou fingiu que tremeu.`,
      'Level up no chat. XP bem gasto zoando os outros.',
      `Nível *${v.level || '?'}*. Continua mandando mensagem, campeão da atividade.`,
    ]),
  // Assaltos — roteiro besteirol LONGO (fallback se LLM cair)
  assault_bank_win: (v) => {
    const a = v.attacker || 'O Protagonista';
    const w = v.weapon || 'uma arma de respeito';
    return pick([
      [
        `🎬 TÍTULO: "${a.toUpperCase()} CONTRA O CAIXA ELETRÔNICO"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `${a} ensaiava o plano no espelho do banheiro do posto: voz grave, queixo pra cima, *${w}* escondida num saco de pão. "Hoje o banco paga o almoço de todo mundo", murmurou, como se o destino tivesse ouvido. O destino, claro, tava ocupado.`,
        ``,
        `CENA 2 — AÇÃO`,
        `A porta giratória engasgou. ${a} entrou devagar, estilo filme dos anos 90, e gritou "é um saque… digamos, acelerado!". O segurança olhou o relógio (intervalo do café). A gerente ergueu as mãos com um "aí não, gente". *${w}* fez o discurso. O caixa abriu. Alguém pediu pra não sujar o chão com o extrato.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `Sirene atrasada, típica. ${a} saiu correndo como quem perdeu o ônibus, saco na mão, coração a mil. Um idoso na fila comentou: "na minha época o assalto tinha educação". A câmera do banco pegou o melhor ângulo — o do mico e o da vitória ao mesmo tempo.`,
        ``,
        `EPÍLOGO`,
        `Corte pro grupo do zap: ${a} rico de moral (e de loot). Créditos com funk baixo. Continua… se o cooldown deixar.`,
      ].join('\n'),
      [
        `🎬 TÍTULO: "O ASSALTO QUE DEU CERTO (MILAGRE BRASILEIRO)"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `No estacionamento, ${a} respirava fundo e contava até três errado. *${w}* pesava mais na consciência do que na mão. O plano cabia num post-it: entrar, assustar, sair, não tropeçar.`,
        ``,
        `CENA 2 — AÇÃO`,
        `Dentro do banco o ar-condicionado gelava o drama. "${a} não veio pagar boleto!", ecoou. Clientes no chão (metade por medo, metade por dor nas costas). O caixa tremeu, a gaveta abriu, e o universo — por uma vez — colaborou com o bandido.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `Fuga de cinema B: porta, sol na cara, possível moto, possível Uber do crime. O alarme tocou quando ${a} já tava na esquina inventando álibi. Sucesso bagunçado, mas sucesso.`,
        ``,
        `EPÍLOGO`,
        `Fim… por enquanto. ${a} entra pra história do grupo como "aquele que meteu o louco no banco e voltou pra contar".`,
      ].join('\n'),
    ]);
  },
  assault_bank_fail: (v) => {
    const a = v.attacker || 'O Protagonista';
    const w = v.weapon || 'a arma';
    return pick([
      [
        `🎬 TÍTULO: "${a.toUpperCase()} E O BANCO QUE NÃO COLABOROU"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `${a} passou a manhã no YouTube de "como assaltar sem assaltar de verdade". Imprimiu um mapa torto, escondeu *${w}* e jurou que seria "rápido e limpo". Spoiler: não foi.`,
        ``,
        `CENA 2 — AÇÃO`,
        `Entrou no banco com confiança de comercial de perfume. "Todo mundo quieto!" — a senha do caixa não quietou. A porta trancou do jeito errado, o segurança voltou do café cedo, e *${w}* parecia mais envergonhada que o dono. Alguém filmou. Claro que filmou.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `A "fuga" foi um tropeço na esteira de publicidade do banco. Sirene, gritaria, e ${a} inventando "era performance de arte urbana". Multa de vergonha no bolso, moral no chão encerado.`,
        ``,
        `EPÍLOGO`,
        `Créditos: ${a} 0 × Banco 1. O grupo já tem o meme pronto. Continua no próximo cooldown… se tiver coragem.`,
      ].join('\n'),
    ]);
  },
  assault_shop_win: (v) => {
    const a = v.attacker || 'O Protagonista';
    const w = v.weapon || 'uma arma';
    return pick([
      [
        `🎬 TÍTULO: "A LOJINHA E O CLIENTE ESPECIAL"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `${a} estudou a lojinha da esquina como se fosse Fort Knox: horário do pão quente, gato no balcão, ventilador barulhento. *${w}* foi de "argumento de venda". O plano: entrar, convencer, sair com o caixa do dia.`,
        ``,
        `CENA 2 — AÇÃO`,
        `"Boa tarde, é um assalto educado", anunciou ${a}. O dono largou o pão de forma. A balança tremeu. *${w}* fez o comercial. Em trinta segundos de caos besteirol, a gaveta abriu e o troco do bairro mudou de dono.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `${a} saiu com pressa de quem esqueceu o leite na lista. O gato miou julgamento. Um vizinho gritou "é o ${a} de novo?" — fama local conquistada. Sirene? Talvez amanhã.`,
        ``,
        `EPÍLOGO`,
        `Vitória de mercearia, glória de filme B. ${a} volta pro zap como lenda do quarteirão. Fim (até a próxima lojinha).`,
      ].join('\n'),
    ]);
  },
  assault_shop_fail: (v) => {
    const a = v.attacker || 'O Protagonista';
    const w = v.weapon || 'a arma';
    return pick([
      [
        `🎬 TÍTULO: "O DONO DA LOJA ERA MAIS MALANDRO"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `${a} treinou o grito no chuveiro. *${w}* brilhava de expectativa. A lojinha parecia fácil: uma porta, um caixa, zero orçamento de Hollywood.`,
        ``,
        `CENA 2 — AÇÃO`,
        `"É um assalto!" — "Aceita cartão de fidelidade?", respondeu o dono, sem piscar. ${a} perdeu o timing. *${w}* não intimidou nem o saco de arroz. O botão de pânico ganhou a cena. Clientes aplaudiram o plot twist.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `Fuga de comédia: esbarrou na prateleira de biscoito, derrubou o varal de panfleto, saiu com a dignidade em promoção. Multinha de mico no bolso. O dono acenou: "volta pra comprar, viu".`,
        ``,
        `EPÍLOGO`,
        `${a} 0 × Lojinha 1. O bairro ri. O zap também. Roteiro arquivado sob "nunca mais… até amanhã".`,
      ].join('\n'),
    ]);
  },
  assault_player_win: (v) => {
    const a = v.attacker || 'Fulano';
    const t = v.target || 'Beltrano';
    const w = v.weapon || 'a arma';
    return pick([
      [
        `🎬 TÍTULO: "${a.toUpperCase()} VS ${t.toUpperCase()}: AMIZADE COM JUROS"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `No grupo, o clima tava de paz. ${a} via o perfil de ${t} e pensava em "redistribuição de renda improvisada". *${w}* saiu do inventário como coadjuvante estrela. For fun — mas o bolso não sabe o que é brincadeira.`,
        ``,
        `CENA 2 — AÇÃO`,
        `Emboscada digital-cinematográfica: ${a} aparece, ${t} nem processa. "Passa o que tem no bolso virtual!" *${w}* convence mais que argumento. ${t} resiste um frame… e cede. O chat é a plateia; alguém já mandou kkkkk.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `${a} some no cooldown com a moral alta. ${t} conta os coins que faltam e jura vingança no próximo daily. Amizade? Em manutenção. Loot? Real.`,
        ``,
        `EPÍLOGO`,
        `PvP com gosto de novela. ${a} ganhou a rodada. ${t} ganhou material pra reclamar no grupo. Continua…`,
      ].join('\n'),
    ]);
  },
  assault_player_fail: (v) => {
    const a = v.attacker || 'Fulano';
    const t = v.target || 'Beltrano';
    const w = v.weapon || 'a arma';
    return pick([
      [
        `🎬 TÍTULO: "O ASSALTO ENTRE AMIGOS QUE VIROU MICO"`,
        ``,
        `CENA 1 — PREPARAÇÃO`,
        `${a} planejou o golpe em ${t} com a seriedade de um final de campeonato. *${w}* carregada de esperança. O grupo mal sabia que ia ganhar conteúdo grátis.`,
        ``,
        `CENA 2 — AÇÃO`,
        `Chegou a hora: ${a} avança, ${t} desvia (ou a sorte desvia por ele). *${w}* falha no carisma. O plano desmonta em público. Alguém manda "KKKK fraco". ${a} tenta improvisar um "era brincadeira" — tarde demais.`,
        ``,
        `CENA 3 — FUGA / CONSEQUÊNCIA`,
        `Fuga constrangedora pro cooldown. Multa de vergonha. ${t} intacto, talvez até rindo. ${a} revisa a carreira de vilão.`,
        ``,
        `EPÍLOGO`,
        `Placar: ${t} defendeu o bolso. ${a} defendeu… nada. O zap arquiva o episódio em "clássicos do mico".`,
      ].join('\n'),
    ]);
  },
  default: () =>
    pick([
      'O chat reage em silêncio… por enquanto.',
      'Situação processada. Opiniões no privado, mico no grupo.',
      'Anotado. O grupo já tá criando a narrativa.',
    ]),
};

function pick(list) {
  if (!Array.isArray(list) || list.length === 0) return FALLBACKS.default();
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

function looksLikeMetaReasoning(s) {
  const t = String(s || '');
  if (!t) return true;
  // raciocínio em inglês / meta sobre o prompt
  if (
    /\b(I need to|we are|the user|therefore|so this is|since I can't|shouldn'?t|compatibility ship|I should|let me|characters|max\s*\d+)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // meta em pt-BR (modelo planejando a frase em vez de dizer a frase)
  if (
    /\b(posso brincar|outra ideia|então posso|talvez algo sobre|preciso (criar|escrever|gerar)|vou (escrever|focar|criar)|a frase (poderia|tem que)|algo que brinque|responda somente|só a frase)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^(contexto|regras?|passo|thinking|racioc|a frase|vou |algo que|preciso |- )/i.test(t)) return true;
  return false;
}

function sanitizeFlavor(raw, maxLen = 160) {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(thinking|raciocínio|step\s*\d)/i.test(l));

  // junta até 3 linhas boas (mini-histórias de assalto etc.); se todas forem meta, falha
  const good = [];
  for (const line of lines) {
    let cand = line
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .replace(/^(narrador|bot|assistente|resposta|final)\s*:\s*/i, '')
      .trim();
    if (cand.length < 6 || looksLikeMetaReasoning(cand)) continue;
    good.push(cand);
    if (good.length >= 3) break;
  }
  if (!good.length) return '';
  let s = good.join(' ').replace(/\s+/g, ' ').trim();

  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
  }
  if (/^\d+$/.test(s)) return '';
  if (looksLikeMetaReasoning(s)) return '';
  return s;
}

function buildUserPrompt(scenario, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  const facts = Object.entries(v)
    .filter(([, val]) => val != null && String(val).trim() !== '')
    .map(([k, val]) => `${k}=${String(val).slice(0, 80)}`)
    .join('; ');

  const scenarioHints = {
    faction_create: 'Zoação leve sobre panelinha/facção recém-criada no grupo.',
    faction_join: 'Comente alguém entrando na facção — tom de “bem-vindo ao caos”.',
    faction_leave: 'Comente saída de facção sem ser cruel de verdade.',
    mission_spawn: 'Missão mista entre facções: cooperação forçada, prêmio real.',
    event_start: 'Evento relâmpago (trégua falsa / cross-facção) — sai da bolha.',
    marry_propose: 'Pedido de casamento no zap: vergonha alheia e torcida do grupo.',
    marry_accept: 'Casamento aceito: parabéns com pitada de deboche carinhoso.',
    marry_mutual: 'Pedido mútuo: raro, quase assustador, engraçado.',
    job_done: 'Alguém “trabalhou” no bot e ganhou coins (não invente o valor).',
    flip_win: 'Ganhou no cara ou coroa — sorte com cara de skill (sem inventar valor).',
    flip_lose: 'Perdeu no cara ou coroa — mico leve, sem humilhar de graça.',
    bet_result: 'Resultado de aposta PvP: use os nomes; não invente pot/números.',
    ship: 'Ship do grupo: use o clima do percent se tiver; pode ser safado de leve.',
    lucky_hit: 'Deu sorte no comando de sorte — raro e gostoso.',
    lucky_miss: 'Azar no comando de sorte — clássico, sem drama falso.',
    level_up: 'Level up de XP — orgulho irônico de ranqueiro de grupo.',
    assault_bank_win:
      'ROTEIRO BESTEIROL LONGO: assalto a BANCO que DEU CERTO. Elenco: attacker, weapon. Várias cenas, diálogos, exagero cômico. NÃO invente coins/saldo/chance%.',
    assault_bank_fail:
      'ROTEIRO BESTEIROL LONGO: assalto a BANCO que FALHOU. Mico épico, fuga torta. NÃO invente multa/coins.',
    assault_shop_win:
      'ROTEIRO BESTEIROL LONGO: assalto a LOJINHA que DEU CERTO. Humor de bairro, dono, gato no balcão. NÃO invente coins.',
    assault_shop_fail:
      'ROTEIRO BESTEIROL LONGO: assalto a LOJINHA que FALHOU. Dono mais malandro. NÃO invente coins.',
    assault_player_win:
      'ROTEIRO BESTEIROL LONGO: assalto PvP entre amigos (attacker vs target) que DEU CERTO. For fun no zap. NÃO invente quantias. Sem bullying pesado.',
    assault_player_fail:
      'ROTEIRO BESTEIROL LONGO: assalto PvP que FALHOU (attacker vs target). Mico de grupo. NÃO invente multa/coins.',
  };

  const assault = isAssaultScenario(scenario);
  const hint =
    scenarioHints[scenario] || 'Comentário de narrador de grupo BR sobre o que rolou.';
  const shape = assault
    ? `Escreva o ROTEIRO COMPLETO (900–1800 caracteres) com:
🎬 TÍTULO:
CENA 1 — PREPARAÇÃO
CENA 2 — AÇÃO
CENA 3 — FUGA / CONSEQUÊNCIA
EPÍLOGO
Várias frases por cena. NÃO encurte. Sem inventar números de jogo:`
    : 'Texto (1 a 3 frases, pt-BR de zap):';
  return `${hint}\nContexto fixo (não invente além disso): ${facts || 'nenhum'}\n${shape}`;
}

/** Sanitiza roteiro longo de assalto — mantém parágrafos/cenas. */
function sanitizeAssaultStory(raw, maxLen = 2200) {
  let text = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '\n')
    .replace(/```[\s\S]*?```/g, '\n')
    .trim();
  if (!text || looksLikeMetaReasoning(text.slice(0, 200))) {
    // tenta achar o começo do roteiro
    const idx = text.search(/🎬|T[IÍ]TULO|CENA\s*1/i);
    if (idx > 0) text = text.slice(idx);
  }

  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return true; // keep blank for paragraph breaks
      if (/^(thinking|raciocínio|step\s*\d|contexto:|regras?:)/i.test(t)) return false;
      if (looksLikeMetaReasoning(t) && t.length < 120) return false;
      return true;
    });

  // colapsa 3+ linhas em branco
  const cleaned = [];
  let blanks = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blanks += 1;
      if (blanks <= 1) cleaned.push('');
      continue;
    }
    blanks = 0;
    let cand = line
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .replace(/^(narrador|bot|assistente|roteiro|resposta|final)\s*:\s*/i, '')
      .trimEnd();
    cleaned.push(cand);
  }

  let s = cleaned.join('\n').trim();
  if (s.length < 80) return ''; // curto demais = falhou (preferir fallback longo)

  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const sp = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
    s = `${(sp > 200 ? cut.slice(0, sp) : cut).trim()}…`;
  }
  if (looksLikeMetaReasoning(s.slice(0, 120))) return '';
  return s;
}

function resolveOllamaEndpoint(cfg) {
  return {
    baseUrl: String(cfg.ollamaBaseUrl || 'http://127.0.0.1:11434').trim(),
    model: String(cfg.ollamaModel || 'gemma4:latest').trim() || 'gemma4:latest',
    keepAlive:
      cfg.ollamaKeepAlive === undefined || cfg.ollamaKeepAlive === null || cfg.ollamaKeepAlive === ''
        ? -1
        : cfg.ollamaKeepAlive,
    timeoutMs: Math.max(500, Math.floor(Number(cfg.ollamaTimeoutMs) || 25_000)),
    warmupTimeoutMs: Math.max(5_000, Math.floor(Number(cfg.ollamaWarmupTimeoutMs) || 120_000)),
    refreshMs: Math.max(0, Math.floor(Number(cfg.ollamaKeepAliveRefreshMs) || 0)),
  };
}

function resolveZenEndpoint(cfg) {
  return {
    baseUrl: String(cfg.zenBaseUrl || 'http://127.0.0.1:3000').trim(),
    model: String(cfg.zenModel || 'mimo-v2.5-free').trim() || 'mimo-v2.5-free',
    timeoutMs: Math.max(500, Math.floor(Number(cfg.zenTimeoutMs) || 20_000)),
    maxTokens: Math.max(16, Math.floor(Number(cfg.zenMaxTokens) || 400)),
    temperature: Number.isFinite(Number(cfg.zenTemperature)) ? Number(cfg.zenTemperature) : 0.85,
    apiKey: String(cfg.zenApiKey || '').trim(),
  };
}

function logFlavor(getLogger, payload, tag = 'Fun flavor') {
  const logger = typeof getLogger === 'function' ? getLogger() : null;
  try {
    logger?.warn?.(payload, tag);
  } catch {
    // ignore
  }
  try {
    const reason = payload?.reason || payload?.err?.message || 'unknown';
    const provider = payload?.provider || '?';
    console.warn(
      `[fun/llm] ${provider} scenario=${payload?.scenario || '?'} reason=${reason}`
    );
  } catch {
    // ignore
  }
}

/**
 * @param {object} deps
 * @param {() => object} [deps.getConfig]
 * @param {() => object|null} [deps.getLogger]
 * @param {typeof ollamaGenerate} [deps.generate] — ollama (ou mock)
 * @param {typeof openaiChatComplete} [deps.zenGenerate] — zen/openai (ou mock)
 * @param {typeof ollamaWarmup} [deps.warmup]
 * @param {typeof ollamaTouch} [deps.touch]
 */
export function createFlavorService(deps = {}) {
  const getConfig = deps.getConfig || (() => ({}));
  const getLogger = deps.getLogger || (() => null);
  const generateOllama = deps.generate || ollamaGenerate;
  const generateZen = deps.zenGenerate || openaiChatComplete;
  const warmupFn = deps.warmup || ollamaWarmup;
  const touchFn = deps.touch || ollamaTouch;

  /** @type {ReturnType<typeof setInterval> | null} */
  let keepAliveTimer = null;
  let warm = false;
  let lastWarmAt = 0;
  let lastProvider = '';

  // testes setam FUN_DISABLE_LIVE_LLM=1; mocks injetados ainda funcionam
  const liveLlmAllowed =
    process.env.FUN_DISABLE_LIVE_LLM !== '1' || Boolean(deps.allowLiveLlm);

  function zenOn(cfg) {
    if (!liveLlmAllowed && generateZen === openaiChatComplete) return false;
    return cfg?.zenEnabled !== false;
  }

  function ollamaOn(cfg) {
    if (!liveLlmAllowed && generateOllama === ollamaGenerate) return false;
    return cfg?.ollamaEnabled !== false;
  }

  function isEnabled(cfg) {
    return zenOn(cfg) || ollamaOn(cfg);
  }

  function fallback(scenario, vars) {
    const fn = FALLBACKS[scenario] || FALLBACKS.default;
    try {
      return fn(vars || {}) || FALLBACKS.default();
    } catch {
      return FALLBACKS.default();
    }
  }

  function buildPromptParts(cfg, key, vars, simple, { forZen = false, assault = false } = {}) {
    const maxChars = assault
      ? Math.max(1800, Math.floor(Number(cfg.assaultStoryMaxChars) || 2200))
      : Math.floor(Number(cfg.ollamaMaxChars) || 1000);

    if (assault) {
      const facts = Object.entries(vars || {})
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => `${k}=${String(v).slice(0, 100)}`)
        .join('; ');
      const outcome = /_win$/.test(key) ? 'SUCESSO' : /_fail$/.test(key) ? 'FALHA' : 'resultado';
      const where = key.includes('bank')
        ? 'BANCO'
        : key.includes('shop')
          ? 'LOJINHA'
          : 'JOGADOR (PvP no zap)';
      const prompt = simple
        ? `Roteiro besteirol LONGO (900–1800 chars) de assalto a ${where} com ${outcome}. Dados: ${facts}. Formato: 🎬 TÍTULO + CENA 1/2/3 + EPÍLOGO. Só o roteiro:`
        : buildUserPrompt(key, vars);
      return {
        prompt,
        system: forZen ? ASSAULT_STORY_ZEN_SYSTEM : ASSAULT_STORY_SYSTEM,
        maxChars,
        assault: true,
        maxTokens: Math.max(700, Math.floor(Number(cfg.assaultStoryMaxTokens) || 1100)),
      };
    }

    let prompt;
    if (forZen) {
      // prompt curto funciona melhor nos free models do Zen
      const facts = Object.entries(vars || {})
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
        .join(', ');
      prompt = simple
        ? `Texto de grupo WhatsApp (pt-BR, até ${maxChars} chars) sobre ${key}. ${facts}. Só o texto final:`
        : `Comente em 1 a 3 frases (pt-BR, tom de zap, até ${maxChars} chars) o cenário "${key}". Dados: ${facts || 'nenhum'}. Só o texto final:`;
    } else {
      prompt = simple
        ? `Texto em pt-BR (até ${maxChars} chars), tom de grupo WhatsApp, cenário=${key}. Contexto: ${JSON.stringify(vars || {}).slice(0, 300)}. Só o texto:`
        : buildUserPrompt(key, vars);
    }
    const system = simple
      ? `Responda somente em português brasileiro, 1 a 3 frases (até ${maxChars} caracteres). Sem aspas, sem markdown, sem listas. Só o texto final.`
      : forZen
        ? ZEN_SYSTEM_PROMPT
        : SYSTEM_PROMPT;
    return { prompt, system, maxChars, assault: false, maxTokens: null };
  }

  async function tryZen(cfg, key, vars, { simple = false, assault = false } = {}) {
    if (!zenOn(cfg)) return { ok: false, reason: 'zen-disabled' };
    const ep = resolveZenEndpoint(cfg);
    const { prompt, system, maxChars, maxTokens } = buildPromptParts(cfg, key, vars, simple, {
      forZen: true,
      assault,
    });
    try {
      const raw = await generateZen({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt,
        timeoutMs: assault
          ? Math.max(ep.timeoutMs, Math.floor(Number(cfg.assaultStoryTimeoutMs) || 35_000))
          : ep.timeoutMs,
        maxTokens: assault ? maxTokens || 1100 : ep.maxTokens,
        temperature: assault ? Math.min(1, (ep.temperature || 0.85) + 0.05) : ep.temperature,
        apiKey: ep.apiKey,
      });
      const clean = assault
        ? sanitizeAssaultStory(raw, maxChars)
        : sanitizeFlavor(raw, maxChars);
      if (!clean) return { ok: false, reason: 'zen-empty', model: ep.model };
      return { ok: true, text: clean, provider: 'zen', model: ep.model };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'zen-fail',
        model: ep.model,
        err,
      };
    }
  }

  async function tryOllama(cfg, key, vars, { simple = false, assault = false } = {}) {
    if (!ollamaOn(cfg)) return { ok: false, reason: 'ollama-disabled' };
    const ep = resolveOllamaEndpoint(cfg);
    const { prompt, system, maxChars, maxTokens } = buildPromptParts(cfg, key, vars, simple, {
      forZen: false,
      assault,
    });
    try {
      const raw = await generateOllama({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt,
        timeoutMs: assault
          ? Math.max(ep.timeoutMs, Math.floor(Number(cfg.assaultStoryTimeoutMs) || 40_000))
          : ep.timeoutMs,
        keepAlive: ep.keepAlive,
        think: false,
        numPredict: assault
          ? Math.max(600, Math.floor(Number(cfg.assaultStoryMaxTokens) || 1100))
          : Math.max(32, Math.floor(Number(cfg.ollamaNumPredict) || 80)),
        temperature: Number.isFinite(Number(cfg.ollamaTemperature))
          ? Number(cfg.ollamaTemperature)
          : 0.85,
      });
      void maxTokens;
      const clean = assault
        ? sanitizeAssaultStory(raw, maxChars)
        : sanitizeFlavor(raw, maxChars);
      if (!clean) return { ok: false, reason: 'ollama-empty', model: ep.model };
      warm = true;
      lastWarmAt = Date.now();
      return { ok: true, text: clean, provider: 'ollama', model: ep.model };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'ollama-fail',
        model: ep.model,
        err,
      };
    }
  }

  /**
   * Pré-carrega Ollama (fallback local). Zen não precisa de warmup de VRAM.
   */
  async function warmup() {
    const cfg = getConfig() || {};
    if (!ollamaOn(cfg)) {
      return { ok: false, reason: ollamaOn(cfg) ? 'skip' : 'ollama-disabled', ms: 0 };
    }
    const ep = resolveOllamaEndpoint(cfg);
    const result = await warmupFn({
      baseUrl: ep.baseUrl,
      model: ep.model,
      keepAlive: ep.keepAlive,
      timeoutMs: ep.warmupTimeoutMs,
    });
    if (result.ok) {
      warm = true;
      lastWarmAt = Date.now();
      getLogger?.()?.info?.(
        { model: result.model, ms: result.ms },
        'Fun Ollama: modelo aquecido e residente'
      );
    } else {
      warm = false;
      getLogger?.()?.warn?.(
        { model: result.model, ms: result.ms, reason: result.reason },
        'Fun Ollama: warmup falhou — ainda tenta sob demanda como fallback'
      );
    }
    return result;
  }

  function startKeepAliveLoop() {
    stopKeepAliveLoop();
    const cfg = getConfig() || {};
    if (!ollamaOn(cfg)) return { started: false, reason: 'ollama-disabled' };

    const ep = resolveOllamaEndpoint(cfg);
    const refreshMs =
      cfg.ollamaKeepAliveRefreshMs === 0 ? 0 : ep.refreshMs || 10 * 60_000;

    if (refreshMs <= 0) return { started: false, reason: 'refresh-disabled' };

    keepAliveTimer = setInterval(() => {
      const live = getConfig() || {};
      if (!ollamaOn(live)) return;
      const e = resolveOllamaEndpoint(live);
      touchFn({
        baseUrl: e.baseUrl,
        model: e.model,
        keepAlive: e.keepAlive,
        timeoutMs: Math.min(e.warmupTimeoutMs, 60_000),
      })
        .then((r) => {
          if (r.ok) {
            warm = true;
            lastWarmAt = Date.now();
          }
        })
        .catch(() => {});
    }, refreshMs);

    if (typeof keepAliveTimer.unref === 'function') {
      keepAliveTimer.unref();
    }

    return { started: true, refreshMs };
  }

  function stopKeepAliveLoop() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  /**
   * Cascata: Zen → Ollama → template estático.
   * Budget curto (default 6s) pra não travar /sorte /trabalhar /ship no WhatsApp.
   * Cenários assault_* usam assaultStory (roteiro longo).
   */
  async function line(scenario, vars = {}) {
    const key = String(scenario || 'default');
    if (isAssaultScenario(key)) {
      return assaultStory(key, vars);
    }

    const cfg = getConfig() || {};
    const safeFallback = fallback(key, vars);

    if (!isEnabled(cfg)) {
      return safeFallback;
    }

    // Cap alinhado com normalizeFunConfig (flavorTimeoutMs max 60s)
    const budgetMs = Math.max(
      1500,
      Math.min(60_000, Math.floor(Number(cfg.flavorTimeoutMs) || 28_000))
    );

    const cascade = async () => {
      // 1) OpenCode Zen (principal)
      let zenResult = await tryZen(cfg, key, vars, { simple: false });
      if (!zenResult.ok && zenResult.reason === 'zen-empty') {
        zenResult = await tryZen(cfg, key, vars, { simple: true });
      }
      if (zenResult.ok) {
        lastProvider = 'zen';
        return zenResult.text;
      }
      if (zenOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'zen',
          reason: zenResult.reason,
          model: zenResult.model,
          err: zenResult.err
            ? { message: zenResult.err.message, name: zenResult.err.name }
            : undefined,
        });
      }

      // 2) Ollama local (fallback)
      let ollamaResult = await tryOllama(cfg, key, vars, { simple: false });
      if (!ollamaResult.ok && ollamaResult.reason === 'ollama-empty') {
        ollamaResult = await tryOllama(cfg, key, vars, { simple: true });
      }
      if (ollamaResult.ok) {
        lastProvider = 'ollama';
        return ollamaResult.text;
      }
      if (ollamaOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'ollama',
          reason: ollamaResult.reason,
          model: ollamaResult.model,
          warm,
          err: ollamaResult.err
            ? { message: ollamaResult.err.message, name: ollamaResult.err.name }
            : undefined,
        });
      }

      lastProvider = 'template';
      return safeFallback;
    };

    try {
      return await Promise.race([
        cascade(),
        new Promise((resolve) => {
          setTimeout(() => {
            lastProvider = 'template-timeout';
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
    } catch {
      lastProvider = 'template';
      return safeFallback;
    }
  }

  /**
   * Roteiro besteirol LONGO de assalto (não frase curta).
   * Zen → Ollama → template multi-cena. Budget maior que flavor normal.
   */
  async function assaultStory(scenario, vars = {}) {
    const cfg = getConfig() || {};
    const key = String(scenario || 'assault_bank_win');
    const safeFallback = fallback(key, vars);

    if (!isEnabled(cfg)) {
      return safeFallback;
    }

    const budgetMs = Math.max(
      8_000,
      Math.min(
        90_000,
        Math.floor(Number(cfg.assaultStoryTimeoutMs) || Number(cfg.flavorTimeoutMs) || 45_000)
      )
    );

    const cascade = async () => {
      let zenResult = await tryZen(cfg, key, vars, { simple: false, assault: true });
      // se veio curto/vazio, tenta prompt “simple” ainda no modo assault (não o de 1–3 frases)
      if (!zenResult.ok && zenResult.reason === 'zen-empty') {
        zenResult = await tryZen(cfg, key, vars, { simple: true, assault: true });
      }
      if (zenResult.ok) {
        lastProvider = 'zen';
        return zenResult.text;
      }
      if (zenOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'zen',
          reason: zenResult.reason,
          model: zenResult.model,
          err: zenResult.err
            ? { message: zenResult.err.message, name: zenResult.err.name }
            : undefined,
        });
      }

      let ollamaResult = await tryOllama(cfg, key, vars, { simple: false, assault: true });
      if (!ollamaResult.ok && ollamaResult.reason === 'ollama-empty') {
        ollamaResult = await tryOllama(cfg, key, vars, { simple: true, assault: true });
      }
      if (ollamaResult.ok) {
        lastProvider = 'ollama';
        return ollamaResult.text;
      }
      if (ollamaOn(cfg)) {
        logFlavor(getLogger, {
          scenario: key,
          provider: 'ollama',
          reason: ollamaResult.reason,
          model: ollamaResult.model,
          warm,
          err: ollamaResult.err
            ? { message: ollamaResult.err.message, name: ollamaResult.err.name }
            : undefined,
        });
      }

      lastProvider = 'template';
      return safeFallback;
    };

    try {
      return await Promise.race([
        cascade(),
        new Promise((resolve) => {
          setTimeout(() => {
            lastProvider = 'template-timeout';
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
    } catch {
      lastProvider = 'template';
      return safeFallback;
    }
  }

  async function italicLine(scenario, vars = {}) {
    // assalto: não envolve o roteiro inteiro em itálico (fica ilegível)
    if (isAssaultScenario(scenario)) {
      return assaultStory(scenario, vars);
    }
    const text = await line(scenario, vars);
    const t = String(text || '').trim();
    if (!t) return '';
    if (t.startsWith('_') && t.endsWith('_')) return t;
    return `_${t}_`;
  }

  return {
    line,
    italicLine,
    assaultStory,
    fallback,
    sanitizeFlavor,
    sanitizeAssaultStory,
    warmup,
    startKeepAliveLoop,
    stopKeepAliveLoop,
    isWarm: () => warm,
    lastWarmAt: () => lastWarmAt,
    lastProvider: () => lastProvider,
    isEnabled: () => isEnabled(getConfig() || {}),
  };
}
