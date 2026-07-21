import { ollamaGenerate, ollamaWarmup, ollamaTouch } from './ollamaClient.js';
import { openaiChatComplete } from './openaiClient.js';
import {
  resolveZenTaskParams,
  overlapsRecent,
  fingerprintLine,
} from './zenTaskParams.js';
import { recordLlmHit } from './llmMetrics.js';

/**
 * System “ápice” (Zen é o principal e mais capaz — prompt completo).
 * Código = FATOS + lore; modelo inventa tom, humor e texto. Sem few-shots.
 */
const SYSTEM_PROMPT = `Você comenta o que rolou num bot de diversão de WhatsApp BR.

PAPEL
- Você inventa o comentário inteiro: gancho, tom, humor e frase final.
- O user message traz só FATOS (quem, o quê, lore do grupo). Não é roteiro de piada — use como matéria-prima.
- Escreva como alguém do grupo no zap: pt-BR do dia a dia, natural, engraçado quando couber.
- Você escolhe o tipo de humor (seco, absurdo, irônico, épico, maldoso leve, etc.). Varie entre respostas.

FORMA
- 1 a 3 frases COMPLETAS (prefira 1–2). Até o limite de caracteres do user (cabe no WhatsApp).
- Frases fechadas (ponto ou kkk). Máx 3 emojis se quiser.
- Sem markdown de lista, sem aspas envolvendo o texto inteiro.

CONTEXTO DO GRUPO
- Se houver <group_lore> ou fatos de identidade, use para ser específico a ESTE grupo.
- Nunca troque o autor de um fato. Se o lore não encaixar, ignore — não force.

NÃO
- Inventar coins, XP, vencedor, placar, quantia de aposta ou regra de jogo (o bot já mostrou os números).
- Repetir placar / "ganhou X coins" / "perdeu Y".
- Ofensa pesada, preconceito, conteúdo sexual explícito, doxxing.
- Preâmbulo ou meta: "aqui vai", "como pediu", raciocinar em voz alta, "em português", "como IA".
- Frases pela metade. Inglês de assistente.

Só o texto final, pronto pra colar no zap. Comece direto na frase.`;

/** Zen = mesmo system completo (modelo principal). */
const ZEN_SYSTEM_PROMPT = SYSTEM_PROMPT;

/** Quanto de lore/contexto de grupo cabe no prompt. */
const LORE_MAX_FLAVOR = 6000;
const LORE_MAX_CHAOS = 4000;
const FACT_VALUE_MAX = 200;

/**
 * Roteiro de assalto — modelo inventa título, gênero e cenas; código fixa elenco + formato.
 */
const ASSAULT_STORY_SYSTEM = `Você é roteirista criativo de um mini-filme de assalto pro grupo de WhatsApp BR.

Invente TUDO: título, gênero, clima, diálogos, gags, reviravoltas. Use o elenco e o resultado (sucesso/falha) dos FATOS — não invente outro protagonista humano no lugar do attacker.

FORMATO OBRIGATÓRIO (primeira linha já é o título; sem introdução):
🎬 TÍTULO: (nome inventado por você, estilo cartaz)
CENA 1 — PREPARAÇÃO
CENA 2 — AÇÃO
CENA 3 — FUGA / CONSEQUÊNCIA
EPÍLOGO
(1–2 frases de fechamento pro grupo do zap)

TAMANHO: 450–900 caracteres no total. 1–3 frases curtas por cena. Compacto pra WhatsApp.

Diálogos soam como gente de bairro/zap. NPCs de esquina OK (dono, gato, vizinha).

NÃO:
- inventar quantia de coins, saldo, multa, XP, chance % ou placar
- trocar o nome do assaltante (use exatamente o attacker dos fatos)
- gore, ofensa pesada, preconceito, sexual explícito
- preâmbulo ("aqui vai", "roteiro de…"), oferta de variação no final, meta sobre o prompt
- aspas envolvendo o texto inteiro

Só o roteiro final.`;

/** Zen = mesmo system completo. */
const ASSAULT_STORY_ZEN_SYSTEM = ASSAULT_STORY_SYSTEM;

function isAssaultScenario(key) {
  return String(key || '').startsWith('assault_');
}

const CHAOS_SCENARIOS = new Set([
  'cancel_absurd',
  'gossip_fake',
  'oracle_insane',
  'illuminati_theory',
  'russian_click',
  'russian_dead',
  'russian_start',
  'roast_personal',
  'group_times',
]);

function isChaosScenario(key) {
  return CHAOS_SCENARIOS.has(String(key || ''));
}

/**
 * Caos social — um system por tarefa. Sem few-shots; o modelo inventa do zero.
 */
const CHAOS_TASK_SYSTEM = Object.freeze({
  cancel_absurd: `Você inventa UM cancelamento absurdo e engraçado de WhatsApp BR.
A pessoa cancelada é user= nos fatos. Invente um motivo ridículo, específico e único (não genérico).
2–4 frases completas em pt-BR. Só o texto do cancelamento.
NÃO liste opções, NÃO fale de fofoca/oráculo/roleta, NÃO explique o prompt.
Sem preconceito, sem doxxing, sem sexualizar.`,

  gossip_fake: `Você inventa UMA fofoca 100% FALSA e engraçada de WhatsApp BR sobre user=.
Invente detalhes concretos (hábito, objeto, horário, rumor torto) — você cria tudo.
2–4 frases completas. Só a fofoca. Sem ofensa pesada, sem preconceito, sem meta.`,

  oracle_insane: `Você é o oráculo maluco do grupo de WhatsApp BR.
Responda question= com uma profecia absurda e original que VOCÊ inventa do zero (imagens, condições, reviravoltas — livre).
2–4 frases completas. Só a resposta. Sem autoajuda séria, sem listar modos, sem meta.`,

  illuminati_theory: `Você inventa UMA teoria da conspiração engraçada (Illuminati de zoeira) em pt-BR.
A pessoa (user=) é o centro. Invente o dossiê falso inteiro.
2–4 frases COMPLETAS. Só a teoria. NÃO liste outros comandos (cancelamento/fofoca/oráculo).`,

  russian_click: `Comentário sobre roleta russa virtual: câmara vazia / click. pt-BR de zap.
Invente o suspense/humor. 1–3 frases completas. Só o comentário.`,

  russian_dead: `Comentário de "morte" virtual na roleta russa (mico, sem XP). pt-BR de zap.
Invente o tom. 1–3 frases. Sem gore real. Só o comentário.`,

  russian_start: `Abertura da roleta russa virtual no grupo (1 bala). Invente o clima teatral.
1–3 frases completas em pt-BR. Só o texto.`,

  roast_personal: `Faça um ROAST engraçado de user= usando APENAS os facts= fornecidos.
Você inventa o ângulo e as farpas — sem inventar crimes reais nem dados que não estejam nos fatos.
2–4 frases em pt-BR. Sem preconceito, sem ofensa a trauma/identidade. Só o roast final.`,

  group_times: `Você é o editor do jornal do grupo ("The Group Times").
Com base nos events= do dia, invente 3 seções engraçadas e originais.
Formato fixo (rótulos em PT):
MANCHETE: ...
ECONOMIA: ...
FOFOCA: ...
Cada linha: título curto + 1 frase. pt-BR. Só use números/pessoas que estejam nos eventos. Só o texto.`,
});

const CHAOS_SYSTEM_DEFAULT = `Você gera texto cômico original de bot WhatsApp BR. 2–4 frases COMPLETAS em pt-BR.
Invente o conteúdo do zero a partir dos fatos. Só o texto final pro zap. Sem listas de modos, sem meta, sem inglês de assistente.`;

function chaosSystemFor(key) {
  const base = CHAOS_TASK_SYSTEM[key] || CHAOS_SYSTEM_DEFAULT;
  return `${base} PROIBIDO preâmbulo ("aqui vai", "como pediu", descrever a tarefa). Comece no texto final.`;
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
        ? `*${v.name || 'A panelinha'}* acabou. Ficou só o mico e o histórico.`
        : `*${v.user || 'Alguém'}* saiu do *${v.name || 'time'}*. O chat já inventou o motivo.`,
      `Saída confirmada. Às vezes é só “preciso de um tempo”… da panelinha.`,
    ]),
  mission_spawn: () =>
    pick([
      'Squad misto no ar. Ou colaboram, ou viram print de vergonha.',
      'Missão entre panelinhas diferentes. Paz falsa, prêmio real.',
      'Operação Mistura: daily, aposta e ship. Quem falhar, paga o mico.',
    ]),
  event_start: (v) =>
    pick([
      `Trégua falsa por uns *${v.minutes || '?'}* min. Falar com “o inimigo” agora rende.`,
      'Evento: sair da bolha da panelinha tá valendo mais. Coincidência? Não.',
      'Janela cross-panelinha aberta. Isolado perde o meta — e a moral.',
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
  roulette_win: (v) =>
    pick([
      `A bola parou em *${v.ball || '?'}* e te beijou na testa. Casa paga, ego infla.`,
      'Roleta alinhou com a sua aposta. Por um segundo você parece profissional.',
      v.pick
        ? `*${v.pick}* deu certo. O cassino fingiu que não viu.`
        : 'Número certo, bolso feliz. Não se acostuma — a roda tem memória seletiva.',
      'Giro limpo. O grupo já tá pedindo replay… e a próxima aposta.',
    ]),
  roulette_lose: (v) =>
    pick([
      `Apostou em *${v.pick || 'algo'}*, a bola foi em *${v.ball || 'outro lugar'}*. Clássico.`,
      'A roda girou, o saldo encolheu. A roleta não liga pro seu feeling.',
      'Quase… no sentido de “não”. A bola te deu um chapéu vermelho-e-preto.',
      'Mesa fria. Respira, conta até o cooldown e finge que foi estratégia.',
    ]),
  slot_win: () =>
    pick([
      'Os rolos alinharam. A máquina te pagou e ainda fingiu que foi generosa.',
      'Linha premiada. Por um momento o cassino pareceu justo — perigoso.',
      'Bateu o combo. Não diga “sistema” pro grupo, eles vão rir.',
    ]),
  slot_lose: () =>
    pick([
      'Rolos tortos, bolso reto pra baixo. A alavanca ri baixinho.',
      'Quase formou… no seu delírio. No mundo real: zero.',
      'A máquina comeu a ficha com elegância. Até a próxima ilusão.',
    ]),
  crash_win: (v) =>
    pick([
      v.mult
        ? `Desceu em *${v.mult}x* antes do foguete virar fogos. Timing de cobrador de dívidas.`
        : 'Cashout no tempo certo. O foguete explodiu sem você — luxo.',
      'Saiu do voo com grana. Covardia lucrativa é skill.',
      'Paraquedas abriu. O ego também.',
    ]),
  crash_lose: (v) =>
    pick([
      v.mult
        ? `Explodiu em *${v.mult}x* com você ainda a bordo. Turismo espacial caro.`
        : 'Ficou no foguete tempo demais. Agora é cinza e mico.',
      'Crash te levou junto. Ambicioso demais pro multiplicador do dia.',
      'Queria o 10x, levou o 0x. História clássica de /crash.',
    ]),
  bj_win: () =>
    pick([
      'Mão boa, dealer pior. Blackjack com cara de “eu sabia”.',
      'Você fechou a mesa. O dealer contou de novo e ainda perdeu.',
      '21 (ou perto) e o bolso agradece. Não inventa que é card counting.',
    ]),
  bj_lose: () =>
    pick([
      'Dealer mostrou a mão e o seu orgulho sumiu junto com a stake.',
      'Estourou ou perdeu no detalhe — blackjack sem piedade.',
      'A mesa te educou. Hit ou stand: os dois doeram de algum jeito.',
    ]),
  bj_push: () =>
    pick([
      'Empate. Ninguém ri alto, ninguém chora — só devolve e segue.',
      'Push: a casa devolveu a stake e o drama morreu no meio.',
      'Mesma pontuação. Coins de volta, ego em stand-by.',
    ]),
  russian_click: (v) =>
    pick([
      `*${v.user || 'Alguém'}* ouviu o click. O grupo soltou o ar que nem sabia que segurava.`,
      'Câmara vazia. O suspense continua — e o dedo também.',
      v.remaining != null
        ? `Sobrou *${v.remaining}* no tambor. Ainda tem drama pra rolar.`
        : 'Click seco. Quase funeral, quase meme.',
    ]),
  russian_dead: (v) =>
    pick([
      `*${v.user || 'Fulano'}* foi de base (virtual). XP em luto por 15 min.`,
      'BANG. O rank chora, o chat ri, o morto espera o timer.',
      'Morte simbólica confirmada. Sem XP, com mico eterno no histórico do grupo.',
    ]),
  russian_start: (v) =>
    pick([
      `O tambor gira. *${v.chambers || 6}* câmaras, *1* bala. Quem puxar, joga com a sorte (e com o XP).`,
      'Roleta russa virtual na mesa. Suspense barato, mico caro. `/puxar` quando tiver coragem.',
      'Uma bala, vários heróis. O grupo segura o ar — e o cooldown de XP também.',
    ]),
  cancel_absurd: (v) =>
    pick([
      `Tribunal convocou: *${v.user || 'Fulano'}* cancelado(a) por crimes contra o bom senso e o Wi-Fi alheio.`,
      `*${v.user || 'Alguém'}* caiu. Motivo: excesso de “tô chegando” e déficit de vergonha na cara.`,
      `Cancelamento express: *${v.user || 'Fulano'}* por crimes absurdos que só o grupo entende.`,
    ]),
  gossip_fake: (v) =>
    pick([
      `Fofoca mentirosa: *${v.user || 'Fulano'}* treina discurso pro /daily no chuveiro e perde o fio.`,
      `Rumor 0% real: *${v.user || 'Alguém'}* tem um segundo celular só pra figurinha feia.`,
      `Ouvi no vento (mentira): *${v.user || 'Fulano'}* namora o travesseiro e tem ciúmes do carregador.`,
    ]),
  oracle_insane: (v) =>
    pick([
      `Sobre “${v.question || 'isso'}”: sim, porém só depois de três pombos, um Uno azul e uma senhora de milho.`,
      `Oráculo maluco em “${v.question || 'a pergunta'}”: talvez, se o elevador errar o andar e um gato aceitar PIX.`,
      `Visão: “${v.question || 'isso'}” só rola quando o ônibus chegar no horário — ou seja, no multiverso.`,
    ]),
  illuminati_theory: (v) =>
    pick([
      `Existem fortes indícios de que *${v.user || 'Fulano'}* controla o preço do pão francês desde 2009.`,
      `Dossiê: *${v.user || 'Alguém'}* é acionista secreto do atraso coletivo e do Wi-Fi seletivo.`,
      `Conspiração: *${v.user || 'Fulano'}* e os pombos formam o conselho que decide sua produtividade.`,
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
  roast_personal: (v) =>
    pick([
      `${v.user || v.userName || 'Fulano'} é tão previsível no cassino que até o pasteldavizinha já cobrou juros morais. ${v.facts ? 'Os fatos não mentem — o ego sim.' : 'Saldo magro, moral mais magra ainda.'}`,
      `Roast express: ${v.user || 'você'} sobrevive de daily e de desculpa. O grupo agradece o entretenimento barato.`,
    ]),
  group_times: (v) =>
    [
      'MANCHETE: O dia foi mediano. O ego, não.',
      'ECONOMIA: Preços e pastéis no piloto automático.',
      `FOFOCA: ${v.count || 0} eventos no log. Alguém sofreu, alguém lucrou.`,
    ].join('\n'),
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
  // raciocínio em inglês / meta sobre o prompt / prosa em inglês
  if (
    /\b(I need to|we are|the user|therefore|so this is|since I can't|shouldn'?t|compatibility ship|I should|let me|characters|max\s*\d+|in Portuguese|which means|WhatsApp team|disguised as|fans cheering|the pick is|since the)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // inglês puro (sem acento pt-BR) com palavras comuns
  if (
    !/[áàâãéêíóôõúç]/i.test(t) &&
    /\b(the|which|means|since|because|should|would|could|luck|skill|team|fans|cheering|result|pick is|respond in|brazilian|portuguese|sentences|banter|avoid any|mention of)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // eco de instrução do próprio prompt (inglês ou pt)
  if (/\b(respond in|1 to 3 sentences|brazilian portuguese|whatsapp group banter|avoid any mention)\b/i.test(t)) {
    return true;
  }
  if (/\bn[aã]o posso (usar|escrever|dizer|inventar)\b/i.test(t)) return true;
  if (/\best(eja|á)\s+relacionad/i.test(t) && /\b(n[aã]o posso|talvez)\b/i.test(t)) return true;
  // eco de pedido / preâmbulo de assistente
  if (
    /^(aqui vai|segue o|roteiro (besteirol|curto|de)|no tom (que|pastel)|como (voc[eê] )?pediu|conforme (o )?pedido)/i.test(
      t.trim()
    )
  ) {
    return true;
  }
  if (/\bno tom (pastel[aã]o|que voc[eê] pediu|solicitado)\b/i.test(t)) return true;
  if (/\broteiro besteirol de assalto\b/i.test(t) && t.length < 160) return true;
  // fragmento pt incompleto
  if (/\b(é um|é uma|já que é|que é um|já que|mas n[aã]o posso)\s*$/i.test(t)) return true;
  if (/^[a-záàâãéêíóôõúç\s,_]+$/i.test(t) && !/[.!?…]$/.test(t) && t.length < 40 && /\bé um\b/i.test(t)) {
    return true;
  }
  // termina no meio da frase (sem pontuação e corta em preposição/verbo fraco)
  if (t.length < 90 && !/[.!?…)]$|kkk|rs\b/i.test(t) && /\b(usar|mas|then|with a|tone)\s*_?$/i.test(t)) {
    return true;
  }
  // meta em pt-BR (modelo planejando a frase em vez de dizer a frase)
  if (
    /\b(posso brincar|outra ideia|então posso|talvez algo sobre|preciso (criar|escrever|gerar)|vou (escrever|focar|criar)|a frase (poderia|tem que|seria)|algo que brinque|responda somente|só a frase|em português|em portugues|pode ser$|seria algo|tipo assim)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // eco do system prompt de caos (lista de modos)
  if (/\bcen[aá]rios?\s*:/i.test(t)) return true;
  if (
    /cancelamento absurdo/i.test(t) &&
    /fofoca|or[aá]culo|roleta|conspir/i.test(t)
  ) {
    return true;
  }
  if (/fofoca falsa.*or[aá]culo|or[aá]culo insano.*illuminati|roleta russa virtual/i.test(t)) {
    return true;
  }
  if (/^caos c[oô]mico/i.test(t)) return true;
  if (/\b\d\s*[–-]\s*\d\s*frases?\b/i.test(t) && t.length < 80) return true;
  if (/\b(frases?\s+completas?|s[oó]\s+o\s+texto\s+final)\b/i.test(t) && t.length < 100) return true;
  if (/^(contexto|regras?|passo|thinking|racioc|a frase|vou |algo que|preciso |- |mas |assim|então|entao)/i.test(t) && t.length < 60) {
    return true;
  }
  // fragmento incompleto (DeepSeek)
  if (t.length < 18) return true;
  if (/\b(pode ser|seria|talvez)\s*$/i.test(t)) return true;
  const quotes = (t.match(/["“”']/g) || []).length;
  if (quotes % 2 === 1) return true;
  if (/[,:;]\s*$/.test(t) && !/[.!?…)]$/.test(t) && t.length < 90) return true;
  return false;
}

/** Eco de placar — o bot já mostrou coins/XP. */
export function looksLikeScoreboardEcho(text) {
  const t = String(text || '');
  if (/\b\d{2,}\s*(coins?|xp)\b/i.test(t)) return true;
  if (/\b(ganhou|perdeu|pagou|lucrou)\s+\*?\+?-?\d+/i.test(t)) return true;
  if (/\bsaldo\s*(agora|ficou|:\s*\d)/i.test(t)) return true;
  if (/\b(level|nível)\s*\d+\b/i.test(t) && /\bxp\b/i.test(t)) return true;
  return false;
}

export function sanitizeFlavor(raw, maxLen = 160) {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^>\s*/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(thinking|raciocínio|step\s*\d|racioc)/i.test(l));

  // junta até 3 linhas boas; se todas forem meta/rascunho, falha → template
  const good = [];
  for (const line of lines) {
    let cand = line
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .replace(/^(narrador|bot|assistente|resposta|final)\s*:\s*/i, '')
      .trim();
    // meta/preâmbulo no original → descarta (não “salva” só tirando "aqui vai")
    if (cand.length < 12 || looksLikeMetaReasoning(cand)) continue;
    if (looksLikeScoreboardEcho(cand)) continue;
    cand = cand.replace(/^(aqui vai[:\s]*|segue[:\s]*|claro[!.,]?\s*)/i, '').trim();
    if (cand.length < 12 || looksLikeMetaReasoning(cand)) continue;
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
  if (looksLikeScoreboardEcho(s)) return '';
  return s;
}

/**
 * The Group Times: multi-linha (MANCHETE/ECONOMIA/FOFOCA).
 * sanitizeFlavor colapsava tudo e matava a edição.
 */
export function sanitizeGroupTimes(raw, maxLen = 1200) {
  let t = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json|text)?/gi, '')
    .trim();
  if (!t) return '';
  // preâmbulo curto
  t = t.replace(/^(aqui vai[:\s]*|segue[:\s]*|claro[!.,]?\s*)/i, '').trim();
  if (looksLikeMetaReasoning(t) && t.length < 100) return '';

  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(thinking|raciocínio|step\s*\d)/i.test(l))
    .slice(0, 12);
  if (!lines.length) return '';

  let body = lines.join('\n').trim();
  if (body.length < 30) return '';
  if (body.length > maxLen) body = body.slice(0, maxLen).trim();
  // precisa parecer jornal (pelo menos um rótulo ou 2+ linhas)
  if (
    !/manchete|economia|fofoca/i.test(body) &&
    lines.length < 2
  ) {
    return '';
  }
  return body;
}

function buildUserPrompt(scenario, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  const groupLore = String(v.groupLore || '').trim();
  const facts = Object.entries(v)
    .filter(
      ([k, val]) =>
        k !== 'groupLore' &&
        k !== '__angle' &&
        k !== '__genre' &&
        k !== 'scopeKey' &&
        k !== '__scopeKey' &&
        val != null &&
        String(val).trim() !== ''
    )
    .map(([k, val]) => `${k}=${String(val).slice(0, FACT_VALUE_MAX)}`)
    .join('; ');

  // Situação factual só — o modelo inventa tom/humor/título do comentário.
  const scenarioHints = {
    faction_create: 'Panelinha (time) recém-criada no grupo.',
    faction_join: 'Alguém entrou numa panelinha.',
    faction_leave: 'Alguém saiu de uma panelinha (ou ela dissolveu).',
    mission_spawn: 'Missão mista entre panelinhas apareceu.',
    event_start: 'Evento relâmpago cross-panelinha começou.',
    marry_propose: 'Pedido de casamento no bot (zap).',
    marry_accept: 'Casamento aceito no bot.',
    marry_mutual: 'Pedido de casamento mútuo.',
    job_done: 'Alguém terminou um "trabalho" no bot e ganhou coins (não invente o valor).',
    flip_win: 'Ganhou no cara ou coroa.',
    flip_lose: 'Perdeu no cara ou coroa.',
    roulette_win: 'Ganhou na ROLETA (bola/cor). Não confunda com cara ou coroa.',
    roulette_lose: 'Perdeu na ROLETA. Não confunda com cara ou coroa.',
    slot_win: 'Ganhou no SLOT (rolos).',
    slot_lose: 'Perdeu no SLOT.',
    crash_win: 'Cashout a tempo no CRASH (foguete).',
    crash_lose: 'Crash explodiu com o jogador a bordo.',
    bj_win: 'Ganhou no BLACKJACK vs dealer.',
    bj_lose: 'Perdeu no BLACKJACK.',
    bj_push: 'Empate (push) no BLACKJACK.',
    russian_click: 'Roleta russa virtual: click (câmara vazia).',
    russian_dead: 'Roleta russa virtual: bang (morte simbólica, sem XP).',
    cancel_absurd: 'Cancelamento absurdo da pessoa user=.',
    gossip_fake: 'Fofoca falsa sobre user=.',
    oracle_insane: 'Resposta de oráculo maluco à question=.',
    illuminati_theory: 'Teoria Illuminati de zoeira com user= no centro.',
    russian_start: 'Abertura da roleta russa virtual no grupo.',
    bet_result: 'Resultado de aposta PvP (use os nomes; não invente pot/números).',
    ship: 'Ship do grupo (percent/label nos fatos se houver).',
    lucky_hit: 'Deu sorte no comando de sorte.',
    lucky_miss: 'Azar no comando de sorte.',
    level_up: 'Alguém subiu de nível de XP no bot.',
    assault_bank_win: 'Assalto a BANCO que DEU CERTO. Elenco: attacker, weapon.',
    assault_bank_fail: 'Assalto a BANCO que FALHOU. Elenco: attacker, weapon.',
    assault_shop_win: 'Assalto a LOJINHA que DEU CERTO.',
    assault_shop_fail: 'Assalto a LOJINHA que FALHOU.',
    assault_player_win: 'Assalto PvP (attacker vs target) que DEU CERTO.',
    assault_player_fail: 'Assalto PvP (attacker vs target) que FALHOU.',
  };

  const assault = isAssaultScenario(scenario);
  const hint =
    scenarioHints[scenario] ||
    'Algo rolou no bot de diversão do grupo — comente com base nos fatos.';
  const shape = assault
    ? `Escreva o ROTEIRO CURTO (450–900 caracteres). PRIMEIRA LINHA = 🎬 TÍTULO: (invente o título)
CENA 1 — PREPARAÇÃO
CENA 2 — AÇÃO
CENA 3 — FUGA / CONSEQUÊNCIA
EPÍLOGO
1–3 frases por cena. Sem inventar números de coins. Sem preâmbulo:`
    : 'Invente o comentário (1 a 3 frases, pt-BR de zap). Você escolhe o humor. Comece na frase final, sem "aqui vai":';

  const loreBlock = groupLore
    ? `\n${
        String(groupLore).includes('<group_lore>')
          ? groupLore.slice(0, LORE_MAX_FLAVOR)
          : `<group_lore>\nRegras: use para ser específico deste grupo; NUNCA troque o autor do fato; se não encaixar, IGNORE.\n${groupLore.slice(0, LORE_MAX_FLAVOR)}\n</group_lore>`
      }\n`
    : '';

  return `Situação: ${hint}
Fatos do momento (não invente placar/coins além disso): ${facts || 'nenhum'}${loreBlock}
${shape}`;
}

/** Sanitiza roteiro longo de assalto — mantém parágrafos/cenas. */
export function sanitizeAssaultStory(raw, maxLen = 900) {
  let text = String(raw || '')
    .replace(/\r/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '\n')
    .replace(/```[\s\S]*?```/g, '\n')
    .trim();

  // corta preâmbulo de assistente antes do roteiro real
  text = text
    .replace(
      /^(aqui vai[^\n]*\n+|segue (o )?roteiro[^\n]*\n+|roteiro besteirol[^\n]*\n+|no tom (pastel[aã]o|que voc[eê])[^\n]*\n+|conforme (o )?pedido[^\n]*\n+)/i,
      ''
    )
    .trim();

  const scriptStart = text.search(/🎬|T[IÍ]TULO\s*:|CENA\s*1/i);
  if (scriptStart > 0) text = text.slice(scriptStart);
  if (!text || looksLikeMetaReasoning(text.slice(0, 200))) {
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
      if (/^(aqui vai|segue o|roteiro besteirol|no tom que)/i.test(t)) return false;
      if (looksLikeMetaReasoning(t) && t.length < 160) return false;
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

  // corta oferta/meta no final ("Quer que eu escreva uma variação…")
  s = s
    .replace(/\n{0,2}\*{3,}[\s\S]*$/g, '')
    .replace(
      /\n{0,2}(quer que eu|posso (escrever|fazer)|deseja (uma )?varia[cç][aã]o|want me to|shall i)[\s\S]*$/i,
      ''
    )
    .trim();

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
    baseUrl: String(cfg.zenBaseUrl || 'http://127.0.0.1:3300').trim(),
    model: String(cfg.zenModel || 'glm_5_2').trim() || 'glm_5_2',
    timeoutMs: Math.max(500, Math.floor(Number(cfg.zenTimeoutMs) || 20_000)),
    maxTokens: Math.max(64, Math.floor(Number(cfg.zenMaxTokens) || 400)),
    temperature: Number.isFinite(Number(cfg.zenTemperature)) ? Number(cfg.zenTemperature) : 0.85,
    apiKey: String(cfg.zenApiKey || '').trim(),
    // default false: proxy glm com knobs fixos
    sendSamplingParams: cfg.zenSendSamplingParams === true,
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
  /**
   * Anti-repeat por escopo (grupo). Antes era global e vazava
   * "vish paulo…" de um grupo pro prompt do jornal de outro.
   * @type {Map<string, string[]>}
   */
  const recentByScope = new Map();
  const random = typeof deps.random === 'function' ? deps.random : Math.random;

  function scopeKeyOf(vars = {}) {
    const s = String(vars?.scopeKey || vars?.__scopeKey || '').trim();
    return s || '__global__';
  }

  function pushRecent(text, cfg = {}, scopeKey = '__global__') {
    const max = Math.max(0, Math.min(40, Math.floor(Number(cfg.flavorRecentMax) || 10)));
    if (!max || !text) return;
    const key = String(scopeKey || '__global__');
    if (!recentByScope.has(key)) recentByScope.set(key, []);
    const arr = recentByScope.get(key);
    arr.push(String(text).slice(0, 200));
    while (arr.length > max) arr.shift();
  }

  function recentBanList(cfg = {}, scopeKey = '__global__') {
    const max = Math.max(0, Math.min(40, Math.floor(Number(cfg.flavorRecentMax) || 10)));
    if (!max) return [];
    const key = String(scopeKey || '__global__');
    const arr = recentByScope.get(key) || [];
    return arr.slice(-max);
  }

  function acceptOrNull(text, cfg = {}, scopeKey = '__global__', { skipOverlap = false } = {}) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (looksLikeMetaReasoning(t) || looksLikeScoreboardEcho(t)) return '';
    // jornal / formatos fixos: overlap global matava edições parecidas entre grupos
    if (!skipOverlap && overlapsRecent(t, recentBanList(cfg, scopeKey))) return '';
    return t;
  }
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

  function buildPromptParts(
    cfg,
    key,
    vars,
    simple,
    { forZen = false, assault = false, chaos = false } = {}
  ) {
    const maxChars = assault
      ? Math.max(500, Math.min(1200, Math.floor(Number(cfg.assaultStoryMaxChars) || 900)))
      : chaos
        ? Math.max(400, Math.min(900, Math.floor(Number(cfg.chaosMaxChars) || 700)))
        : Math.floor(Number(cfg.ollamaMaxChars) || 1000);

    if (assault) {
      const cast = {
        attacker: String(vars?.attacker || '').trim() || 'O Protagonista',
        target: String(vars?.target || '').trim() || 'o alvo',
        weapon: String(vars?.weapon || '').trim() || 'arma',
        mode: String(vars?.mode || '').trim(),
        success: String(vars?.success || '').trim(),
        gas: String(vars?.gas || '').trim(),
      };
      // nunca manda JID cru pro modelo
      if (/^\d{8,}@|@\d{8,}/.test(cast.attacker) || /^@?\d{10,}$/.test(cast.attacker)) {
        cast.attacker = 'O Protagonista';
      }
      const outcome = /_win$/.test(key) ? 'SUCESSO' : /_fail$/.test(key) ? 'FALHA' : 'resultado';
      const where = key.includes('bank')
        ? 'BANCO'
        : key.includes('shop')
          ? 'LOJINHA'
          : 'JOGADOR (PvP no zap)';
      const castBlock = [
        `ELENCO (obrigatório):`,
        `- Assaltante/protagonista: "${cast.attacker}" ← use ESTE nome em todas as cenas; NÃO invente outro`,
        `- Alvo: "${cast.target}"`,
        `- Arma: "${cast.weapon}"`,
        cast.gas === 'sim' ? '- Fuga com gasolina: sim' : null,
        cast.success ? `- Resultado: ${cast.success === 'sim' ? 'DEU CERTO' : 'FALHOU'}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const prompt = simple
        ? `Roteiro besteirol CURTO (450–900 chars) de assalto a ${where} com ${outcome}.\n${castBlock}\nFormato: 🎬 TÍTULO + CENA 1/2/3 + EPÍLOGO. 1–3 frases/cena. Protagonista = "${cast.attacker}". Só o roteiro:`
        : `${buildUserPrompt(key, { ...vars, attacker: cast.attacker, target: cast.target, weapon: cast.weapon })}\n${castBlock}\nProtagonista = "${cast.attacker}" (não invente Marlison/João/etc). Máx ~900 chars.`;
      return {
        prompt,
        system: forZen ? ASSAULT_STORY_ZEN_SYSTEM : ASSAULT_STORY_SYSTEM,
        maxChars,
        assault: true,
        chaos: false,
        maxTokens: Math.max(350, Math.min(700, Math.floor(Number(cfg.assaultStoryMaxTokens) || 550))),
      };
    }

    if (chaos) {
      const scopeKey = scopeKeyOf(vars);
      const groupLore = String(vars?.groupLore || '').trim();
      const userName = String(vars?.user || '').trim();
      const question = String(vars?.question || '').trim();
      const skipMetaKeys = new Set([
        'groupLore',
        '__angle',
        '__genre',
        'scopeKey',
        '__scopeKey',
      ]);
      const facts = Object.entries(vars || {})
        .filter(
          ([k, v]) =>
            !skipMetaKeys.has(k) && v != null && String(v).trim() !== ''
        )
        .map(([k, v]) => `${k}=${String(v).slice(0, FACT_VALUE_MAX)}`)
        .join('; ');

      // Prompt focado na TAREFA (nunca "lista de cenários")
      const taskLine = {
        cancel_absurd: `Escreva o cancelamento absurdo de *${userName || 'Fulano'}*.`,
        gossip_fake: `Escreva a fofoca falsa sobre *${userName || 'Fulano'}*.`,
        oracle_insane: `Responda como oráculo maluco: “${question || 'a vida'}”.`,
        illuminati_theory: `Escreva a teoria Illuminati com *${userName || 'Fulano'}* no centro. Invente o dossiê.`,
        russian_click: `Comente o click (câmara vazia) da roleta russa. Dados: ${facts || 'nenhum'}.`,
        russian_dead: `Comente a “morte” virtual na roleta. Dados: ${facts || 'nenhum'}.`,
        russian_start: `Abra a roleta russa no grupo. Dados: ${facts || 'nenhum'}.`,
        roast_personal: `Roast de *${userName || 'Fulano'}*. Fatos:\n${String(vars?.facts || facts || 'poucos dados').slice(0, 900)}`,
        group_times: `Jornal The Group Times DESTE grupo. Eventos do dia (só estes):\n${String(vars?.events || 'nenhum').slice(0, 1200)}\nTotal de eventos: ${vars?.count ?? '?'}.`,
      }[key] || `Escreva o texto do comando. Dados: ${facts || 'nenhum'}.`;

      // ban só do MESMO grupo — nunca vazamento cross-grupo
      // jornal: sem ban de flavor de cassino/assalto de outros chats
      const banned = key === 'group_times' ? [] : recentBanList(cfg, scopeKey);
      const banHint =
        banned.length > 0
          ? `NÃO repita ganchos DESTE grupo: ${banned
              .slice(-5)
              .map((b) => fingerprintLine(b))
              .filter(Boolean)
              .join(' | ')}.`
          : '';
      // group_times já embute events no taskLine — não duplicar Contexto
      const prompt = [
        taskLine,
        key !== 'group_times' &&
        facts &&
        key !== 'russian_click' &&
        key !== 'russian_dead' &&
        key !== 'russian_start'
          ? `Contexto: ${facts}.`
          : null,
        key !== 'group_times' && groupLore
          ? String(groupLore).includes('<group_lore>')
            ? groupLore.slice(0, LORE_MAX_CHAOS)
            : `<group_lore>\nUse só se encaixar; NÃO troque autores; NÃO invente.\n${groupLore.slice(0, LORE_MAX_CHAOS)}\n</group_lore>`
          : null,
        banHint || null,
        key === 'group_times'
          ? 'Use APENAS os eventos listados acima. NÃO mencione pessoas/fatos de outros grupos. Responda só o texto do jornal:'
          : 'Responda só com o texto pronto pro zap (sem instruções, sem meta):',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        prompt,
        system: chaosSystemFor(key),
        maxChars: key === 'group_times' ? Math.max(maxChars, 900) : maxChars,
        assault: false,
        chaos: true,
        maxTokens:
          key === 'group_times'
            ? Math.max(400, Math.floor(Number(cfg.chaosMaxTokens) || 500))
            : Math.max(220, Math.floor(Number(cfg.chaosMaxTokens) || 400)),
      };
    }

    let prompt;
    const scopeKey = scopeKeyOf(vars);
    const banned = recentBanList(cfg, scopeKey);
    const banHint =
      banned.length > 0
        ? `NÃO ecoe estes ganchos recentes DESTE grupo: ${banned
            .slice(-5)
            .map((b) => fingerprintLine(b))
            .filter(Boolean)
            .join(' | ')}.`
        : '';
    // Zen e Ollama usam o mesmo user prompt rico (fatos + lore + situação).
    // O modelo inventa humor/ângulo — o código não força catálogo de ângulos.
    if (simple) {
      const facts = Object.entries(vars || {})
        .filter(
          ([k, v]) =>
            k !== '__angle' &&
            k !== '__genre' &&
            k !== 'groupLore' &&
            k !== 'scopeKey' &&
            k !== '__scopeKey' &&
            v != null &&
            String(v).trim() !== ''
        )
        .map(([k, v]) => `${k}=${String(v).slice(0, FACT_VALUE_MAX)}`)
        .join(', ');
      const lore = String(vars?.groupLore || '').trim();
      prompt = [
        `Comente em 1–3 frases (pt-BR de zap, até ${maxChars} chars) a situação "${key}".`,
        `Fatos: ${facts || 'nenhum'}.`,
        lore
          ? String(lore).includes('<group_lore>')
            ? lore.slice(0, LORE_MAX_FLAVOR)
            : `<group_lore>\n${lore.slice(0, LORE_MAX_FLAVOR)}\n</group_lore>`
          : null,
        banHint || null,
        'Invente o comentário. NÃO repita placar/coins. Só o texto final:',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      prompt = `${buildUserPrompt(key, vars)}
${banHint}`.trim();
    }
    // Zen = system completo (ápice). simple = path enxuto só se explicitamente pedido.
    const system = simple
      ? `Responda somente em português brasileiro, 1 a 3 frases (até ${maxChars} caracteres). Sem aspas, sem markdown de lista, sem placar. Só o texto final.`
      : forZen
        ? ZEN_SYSTEM_PROMPT
        : SYSTEM_PROMPT;
    return { prompt, system, maxChars, assault: false, chaos: false, maxTokens: null };
  }

  async function tryZen(cfg, key, vars, { simple = false, assault = false, chaos = false } = {}) {
    if (!zenOn(cfg)) return { ok: false, reason: 'zen-disabled' };
    const taskName = assault ? 'assault' : chaos ? 'chaos' : 'flavor';
    const task = resolveZenTaskParams(taskName, cfg);
    const ep = resolveZenEndpoint(cfg);
    const scopeKey = scopeKeyOf(vars);
    const enriched = { ...vars };
    const { prompt, system, maxChars, maxTokens } = buildPromptParts(cfg, key, enriched, simple, {
      forZen: true,
      assault,
      chaos,
    });
    const scopeBan = recentBanList(cfg, scopeKey);
    const assaultPrompt = assault
      ? `${prompt}
Invente o gênero e o título. NÃO invente coins/saldo/%. ${
          scopeBan.length
            ? `Varie em relação a: ${scopeBan
                .slice(-3)
                .map((b) => fingerprintLine(b))
                .join(' | ')}`
            : ''
        }`
      : prompt;
    const timeoutMs =
      key === 'group_times'
        ? Math.max(ep.timeoutMs, task.timeoutMs, 90_000)
        : Math.max(ep.timeoutMs, task.timeoutMs);
    try {
      const raw = await generateZen({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt: assault ? assaultPrompt : prompt,
        timeoutMs,
        maxTokens: Math.max(
          task.maxTokens,
          assault
            ? maxTokens || 1100
            : key === 'group_times'
              ? maxTokens || 500
              : chaos
                ? maxTokens || 360
                : task.maxTokens
        ),
        temperature: task.temperature,
        apiKey: ep.apiKey,
        sendSamplingParams: ep.sendSamplingParams,
      });
      const clean = assault
        ? sanitizeAssaultStory(raw, maxChars)
        : key === 'group_times'
          ? sanitizeGroupTimes(raw, maxChars)
          : sanitizeFlavor(raw, maxChars);
      const accepted =
        key === 'group_times'
          ? clean
          : acceptOrNull(clean, cfg, scopeKey, {
              skipOverlap: false,
            });
      if (!accepted) return { ok: false, reason: 'zen-empty', model: ep.model };
      return { ok: true, text: accepted, provider: 'zen', model: ep.model };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'zen-fail',
        model: ep.model,
        err,
      };
    }
  }

  async function tryOllama(cfg, key, vars, { simple = false, assault = false, chaos = false } = {}) {
    if (!ollamaOn(cfg)) return { ok: false, reason: 'ollama-disabled' };
    const ep = resolveOllamaEndpoint(cfg);
    const scopeKey = scopeKeyOf(vars);
    const { prompt, system, maxChars, maxTokens } = buildPromptParts(cfg, key, vars, simple, {
      forZen: false,
      assault,
      chaos,
    });
    try {
      const raw = await generateOllama({
        baseUrl: ep.baseUrl,
        model: ep.model,
        system,
        prompt,
        timeoutMs:
          key === 'group_times'
            ? Math.max(ep.timeoutMs, 60_000)
            : assault
              ? Math.max(ep.timeoutMs, Math.floor(Number(cfg.assaultStoryTimeoutMs) || 40_000))
              : chaos
                ? Math.max(ep.timeoutMs, Math.floor(Number(cfg.chaosTimeoutMs) || 28_000))
                : ep.timeoutMs,
        keepAlive: ep.keepAlive,
        think: false,
        numPredict: assault
          ? Math.max(280, Math.min(700, Math.floor(Number(cfg.assaultStoryMaxTokens) || 550)))
          : key === 'group_times'
            ? Math.max(280, Math.floor(Number(cfg.chaosMaxTokens) || maxTokens || 500))
            : chaos
              ? Math.max(180, Math.floor(Number(cfg.chaosMaxTokens) || maxTokens || 360))
              : Math.max(32, Math.floor(Number(cfg.ollamaNumPredict) || 80)),
        temperature: Number.isFinite(Number(cfg.ollamaTemperature))
          ? Math.min(1.1, Number(cfg.ollamaTemperature) + (chaos ? 0.1 : 0))
          : chaos
            ? 0.95
            : 0.85,
      });
      void maxTokens;
      const clean = assault
        ? sanitizeAssaultStory(raw, maxChars)
        : key === 'group_times'
          ? sanitizeGroupTimes(raw, maxChars)
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
   * Budget curto (default ~28s) pra não travar comandos no WhatsApp.
   * Cenários assault_* usam assaultStory (roteiro longo).
   * Cenários de caos (cancel/fofoca/oráculo/illuminati/roleta) usam prompts de caos.
   */
  async function line(scenario, vars = {}) {
    const key = String(scenario || 'default');
    if (isAssaultScenario(key)) {
      return assaultStory(key, vars);
    }
    if (isChaosScenario(key)) {
      return chaosLine(key, vars);
    }

    const cfg = getConfig() || {};
    const scopeKey = scopeKeyOf(vars);
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
        pushRecent(zenResult.text, cfg, scopeKey);
        recordLlmHit('flavor', 'zen', { scenario: key });
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
        const accepted = acceptOrNull(ollamaResult.text, cfg, scopeKey);
        if (accepted) {
          lastProvider = 'ollama';
          pushRecent(accepted, cfg, scopeKey);
          recordLlmHit('flavor', 'ollama', { scenario: key });
          return accepted;
        }
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
      recordLlmHit('flavor', 'template', { scenario: key });
      // flavorAlways false: devolve template mesmo assim (comando espera texto); italicLine pode omitir
      pushRecent(safeFallback, cfg, scopeKey);
      return safeFallback;
    };

    let budgetTimer = null;
    try {
      const result = await Promise.race([
        cascade().finally(() => {
          if (budgetTimer) clearTimeout(budgetTimer);
        }),
        new Promise((resolve) => {
          budgetTimer = setTimeout(() => {
            lastProvider = 'template-timeout';
            recordLlmHit('flavor', 'template-timeout', { scenario: key });
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
      if (budgetTimer) clearTimeout(budgetTimer);
      return result;
    } catch {
      if (budgetTimer) clearTimeout(budgetTimer);
      lastProvider = 'template';
      recordLlmHit('flavor', 'template', { scenario: key });
      return safeFallback;
    }
  }

  /**
   * Caos social: IA principal (Zen → Ollama → template).
   * Budget um pouco maior — o texto *é* o produto do comando.
   */
  async function chaosLine(scenario, vars = {}) {
    const cfg = getConfig() || {};
    const key = String(scenario || 'oracle_insane');
    const scopeKey = scopeKeyOf(vars);
    const safeFallback = fallback(key, vars);

    if (!isEnabled(cfg)) {
      lastProvider = 'template';
      return safeFallback;
    }

    // jornal da madrugada: budget maior (vários grupos em paralelo no tick)
    const budgetMs =
      key === 'group_times'
        ? Math.max(
            45_000,
            Math.min(
              120_000,
              Math.floor(
                Number(cfg.groupNewsTimeoutMs) ||
                  Number(cfg.chaosTimeoutMs) ||
                  Number(cfg.flavorTimeoutMs) ||
                  90_000
              )
            )
          )
        : Math.max(
            8_000,
            Math.min(
              60_000,
              Math.floor(Number(cfg.chaosTimeoutMs) || Number(cfg.flavorTimeoutMs) || 28_000)
            )
          );

    const cascade = async () => {
      // 1) Zen
      let zenResult = await tryZen(cfg, key, vars, { simple: false, chaos: true });
      if (!zenResult.ok && (zenResult.reason === 'zen-empty' || zenResult.reason === 'zen-fail')) {
        zenResult = await tryZen(cfg, key, vars, { simple: true, chaos: true });
      }
      if (zenResult.ok) {
        lastProvider = 'zen';
        pushRecent(zenResult.text, cfg, scopeKey);
        recordLlmHit('chaos', 'zen', { scenario: key, scope: scopeKey.slice(0, 24) });
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
        }, 'Fun chaos');
      }

      // 2) Ollama
      let ollamaResult = await tryOllama(cfg, key, vars, { simple: false, chaos: true });
      if (
        !ollamaResult.ok &&
        (ollamaResult.reason === 'ollama-empty' || ollamaResult.reason === 'ollama-fail')
      ) {
        ollamaResult = await tryOllama(cfg, key, vars, { simple: true, chaos: true });
      }
      if (ollamaResult.ok) {
        const accepted =
          acceptOrNull(ollamaResult.text, cfg, scopeKey, {
            skipOverlap: key === 'group_times',
          }) || ollamaResult.text;
        lastProvider = 'ollama';
        pushRecent(accepted, cfg, scopeKey);
        recordLlmHit('chaos', 'ollama', { scenario: key });
        return accepted;
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
        }, 'Fun chaos');
      }

      lastProvider = 'template';
      recordLlmHit('chaos', 'template', { scenario: key });
      pushRecent(safeFallback, cfg, scopeKey);
      return safeFallback;
    };

    let budgetTimer = null;
    try {
      const result = await Promise.race([
        cascade().finally(() => {
          if (budgetTimer) clearTimeout(budgetTimer);
        }),
        new Promise((resolve) => {
          budgetTimer = setTimeout(() => {
            lastProvider = 'template-timeout';
            recordLlmHit('chaos', 'template-timeout', { scenario: key });
            if (key === 'group_times') {
              console.warn(
                `[fun/news] group_times timeout ${budgetMs}ms scope=${scopeKey.slice(0, 28)} → template`
              );
            }
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
      if (budgetTimer) clearTimeout(budgetTimer);
      return result;
    } catch {
      if (budgetTimer) clearTimeout(budgetTimer);
      lastProvider = 'template';
      recordLlmHit('chaos', 'template', { scenario: key });
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
        pushRecent(zenResult.text.slice(0, 120), cfg);
        recordLlmHit('assault', 'zen', { scenario: key });
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
        pushRecent(String(ollamaResult.text).slice(0, 120), cfg);
        recordLlmHit('assault', 'ollama', { scenario: key });
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
      recordLlmHit('assault', 'template', { scenario: key });
      return safeFallback;
    };

    let budgetTimer = null;
    try {
      const result = await Promise.race([
        cascade().finally(() => {
          if (budgetTimer) clearTimeout(budgetTimer);
        }),
        new Promise((resolve) => {
          budgetTimer = setTimeout(() => {
            lastProvider = 'template-timeout';
            recordLlmHit('assault', 'template-timeout', { scenario: key });
            resolve(safeFallback);
          }, budgetMs);
        }),
      ]);
      if (budgetTimer) clearTimeout(budgetTimer);
      return result;
    } catch {
      if (budgetTimer) clearTimeout(budgetTimer);
      lastProvider = 'template';
      recordLlmHit('assault', 'template', { scenario: key });
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
    // flavorAlways false: se caiu em template genérico e config pede omitir — ainda devolve (template é texto válido)
    // omit só se vazio após sanitize
    if (t.startsWith('_') && t.endsWith('_')) return t;
    return `_${t}_`;
  }

  return {
    line,
    italicLine,
    assaultStory,
    chaosLine,
    fallback,
    sanitizeFlavor,
    sanitizeGroupTimes,
    sanitizeAssaultStory,
    looksLikeScoreboardEcho,
    warmup,
    startKeepAliveLoop,
    stopKeepAliveLoop,
    isWarm: () => warm,
    lastWarmAt: () => lastWarmAt,
    lastProvider: () => lastProvider,
    recentFingerprints: (scopeKey = '__global__') => [
      ...(recentByScope.get(String(scopeKey || '__global__')) || []),
    ],
    isEnabled: () => isEnabled(getConfig() || {}),
  };
}
