/**
 * Chaos social Fun — roleta russa, cancelamento, fofoca, oráculo maluco, illuminati.
 */

const XP_DEAD_KEY = 'xp_morto';

const CANCEL_REASONS = [
  (n) =>
    `*${n}* foi cancelado(a) por roubar o Wi-Fi do vizinho e usar pra baixar vídeo de gato em 4K sem compartilhar o link.`,
  (n) =>
    `*${n}* cancelado(a): confessou em voz alta que gosta de pizza com ketchup e ainda defendeu a escolha com PowerPoint.`,
  (n) =>
    `Tribunal do grupo: *${n}* deve 47 “bom dia” sem emoji e um “kkk” seco em funeral de áudio de 3 min.`,
  (n) =>
    `*${n}* cancelado(a) por fazer fila no caixa preferencial com cesta cheia e cara de “é rapidinho”.`,
  (n) =>
    `Motivo oficial: *${n}* deu spoiler do final de novela de 2003 e ainda riu.`,
  (n) =>
    `*${n}* foi cancelado(a) por deixar o microfone aberto no call e mastigar bolacha como se fosse ASMR proibido.`,
  (n) =>
    `Acusação grave: *${n}* responde “kkk” pra mensagem séria e “ok” pra piada. Inaceitável.`,
  (n) =>
    `*${n}* cancelado(a) por estacionar no fantasma, pagar com PIX errado e culpar o algoritmo.`,
  (n) =>
    `O povo descobriu que *${n}* salva figurinha feia e reenvia 6 meses depois como se fosse original.`,
  (n) =>
    `*${n}* cancelado(a) por dizer “só mais um episódio” às 2h e aparecer no daily com cara de NPC.`,
  (n) =>
    `Crime: *${n}* usa modo escuro no sol e reclama que não enxerga. Sociedade em colapso.`,
  (n) =>
    `*${n}* foi cancelado(a) por inventar “tô chegando” a 40 minutos de distância real.`,
];

const GOSSIP_LINES = [
  (n) =>
    `Fofoca quente (100% inventada): *${n}* tem um álbum secreto só de prints de “ok” passivo-agressivo.`,
  (n) =>
    `Ouvi no vento: *${n}* ensaiou pedido de desculpas no espelho… pro boleto, não pra pessoa.`,
  (n) =>
    `Rumor falso certificado: *${n}* é dono(a) de três grupos de figurinha e um de “reclamar do clima”.`,
  (n) =>
    `Segundo fontes que não existem, *${n}* quase casou com o Wi-Fi do shopping por estabilidade emocional.`,
  (n) =>
    `Fofoca fabricada: *${n}* grita com a impressora em casa e pede desculpas depois em voz baixa.`,
  (n) =>
    `Boato oficialmente mentiroso: *${n}* tem um nome falso no iFood só pra não ter vergonha do pedido das 3h.`,
  (n) =>
    `Dizem (mentira) que *${n}* treina discurso motivacional pra si no banheiro antes do /daily.`,
  (n) =>
    `Fofoca mentira: *${n}* e o travesseiro estão em união estável desde 2019, com direito a ciúmes do celular.`,
  (n) =>
    `Fonte anônima inventada: *${n}* tem playlist “pra chorar no ônibus” e outra “pra fingir que não chorou”.`,
  (n) =>
    `Rumor 0% real: *${n}* já discutiu com o GPS e ganhou — parou no lugar errado de propósito por orgulho.`,
  (n) =>
    `Fofoca mentirosa do dia: *${n}* guarda screenshot de vitória no cassino e esconde as 40 derrotas.`,
  (n) =>
    `Ouvi falar (mentira branca de luxo) que *${n}* responde áudio com texto e texto com áudio, por pura bagunça espiritual.`,
];

const ORACLE_LINES = [
  (q) =>
    `Sobre “${q}”: sim, porém apenas depois de ser perseguido(a) por três pombos, um Uno azul e uma senhora vendendo milho.`,
  (q) =>
    `Oráculo diz sobre “${q}”: não… a menos que um gato preto aceite PIX e o elevador pare no andar errado duas vezes.`,
  (q) =>
    `Resposta cósmica pra “${q}”: talvez. O universo tá indeciso e pediu pra você olhar debaixo do sofá primeiro.`,
  (q) =>
    `“${q}” → confirmado, mas só se você cumprimentar um poste, evitar a cor amarela por 11 minutos e não responder “kk”.`,
  (q) =>
    `Visão sagrada: “${q}” vai dar certo depois que um entregador errar o endereço e te entregar um lanche de outra pessoa.`,
  (q) =>
    `O oráculo maluco ouviu “${q}” e respondeu: depende se a geladeira open de madrugada e se o Wi-Fi perdoar seus pecados de streaming.`,
  (q) =>
    `Profecia absurda: “${q}” só se concretiza após você perder a chave, achar a chave e perder de novo com estilo.`,
  (q) =>
    `Sobre “${q}”: os astros formam a letra “K”. Interpretação: kkk, se vira — mas com fé e hidratação.`,
  (q) =>
    `Resposta insana: “${q}” sim, no dia em que o ônibus passar no horário e ninguém mandar áudio de 4 minutos.`,
  (q) =>
    `Oráculo em crise: “${q}” está escrito nas estrelas… e no fundo de um copo de café frio de ontem.`,
  (q) =>
    `“${q}” → só depois de três sinais: notificação fantasma, meia sumida e um “oi” sem contexto no zap.`,
  (q) =>
    `O além respondeu “${q}” com: *talvez se você parar de perguntar e começar a temer pombos*. Confia.`,
];

const ILLUMINATI_LINES = [
  (n) =>
    `Existem fortes indícios de que *${n}* controla o preço do pão francês desde 2009.`,
  (n) =>
    `Documentos “vazados” (Word de 2007) apontam *${n}* como acionista secreto do atraso do ônibus da linha 42.`,
  (n) =>
    `Teoria: *${n}* inventou o “tô chegando” pra manipular o mercado de paciência humana.`,
  (n) =>
    `Conspiração nível ouro: *${n}* decide sozinho(a) quando o Wi-Fi cai — sempre no clutch.`,
  (n) =>
    `Fontes do porão afirmam que *${n}* coordena o lobby mundial do “só mais cinco minutinhos”.`,
  (n) =>
    `Mapa da sociedade secreta: *${n}* no centro, pombos como mensageiros, padaria como QG.`,
  (n) =>
    `Há evidências (nenhuma) de que *${n}* financia a inflação do lanche da madrugada desde o ensino médio.`,
  (n) =>
    `Dossiê Illuminati: *${n}* e o algoritmo do Instagram se reúnem toda terça pra arruinar sua produtividade.`,
  (n) =>
    `Teoria da semana: *${n}* esconde a fórmula do café perfeito e libera só em dias de reunião chata.`,
  (n) =>
    `Vazamento: *${n}* é o verdadeiro dono do copyright do silêncio constrangedor em call.`,
  (n) =>
    `Iluminati confirma: *${n}* regula a temperatura do ar-condicionado de todos os shoppings do hemisfério.`,
  (n) =>
    `Relatório confidencial: *${n}* inventou o “depois a gente vê” e lucra royalties em stress coletivo.`,
];

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pick(arr, random) {
  if (!arr?.length) return null;
  return arr[Math.floor(random() * arr.length)];
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function createChaosService({
  repository,
  effectsRepository,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/chaosService] repository required');

  /** @type {Map<string, { chambers: number, remaining: number, startedBy: string, startedAt: number, pulls: string[], lastPullAt: number }>} */
  const russianGames = new Map();
  /** @type {Map<string, number>} */
  const cooldowns = new Map();

  function opts(funConfig = {}) {
    return {
      chambers: Math.max(2, Math.min(12, Math.floor(numOr(funConfig.russianChambers, 6)))),
      deathMs: Math.max(60_000, Math.floor(numOr(funConfig.russianDeathMs, 15 * 60_000))),
      idleMs: Math.max(60_000, Math.floor(numOr(funConfig.russianIdleMs, 10 * 60_000))),
      chaosCd: Math.max(5_000, Math.floor(numOr(funConfig.chaosCooldownMs, 25_000))),
    };
  }

  function cdKey(kind, userJid, scopeKey) {
    return `${kind}:${scopeKey}:${userJid}`;
  }

  function checkCooldown(kind, userJid, scopeKey, funConfig, now = Date.now()) {
    const o = opts(funConfig);
    const key = cdKey(kind, userJid, scopeKey);
    const until = cooldowns.get(key) || 0;
    if (until > now) {
      return { ok: false, reason: 'cooldown', retryIn: formatRetry(until - now), retryInMs: until - now };
    }
    cooldowns.set(key, now + o.chaosCd);
    return { ok: true };
  }

  function getRussian(scopeKey, funConfig, now = Date.now()) {
    const g = russianGames.get(String(scopeKey || ''));
    if (!g) return null;
    const o = opts(funConfig);
    if (now - (g.lastPullAt || g.startedAt) > o.idleMs) {
      russianGames.delete(String(scopeKey || ''));
      return null;
    }
    return g;
  }

  function startRussian({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    const existing = getRussian(scopeKey, funConfig, now);
    if (existing) {
      return {
        ok: false,
        reason: 'already-running',
        remaining: existing.remaining,
        chambers: existing.chambers,
      };
    }
    const game = {
      chambers: o.chambers,
      remaining: o.chambers,
      startedBy: String(userJid || ''),
      startedAt: now,
      lastPullAt: now,
      pulls: [],
    };
    russianGames.set(String(scopeKey || ''), game);
    return {
      ok: true,
      chambers: game.chambers,
      remaining: game.remaining,
      deathMs: o.deathMs,
    };
  }

  function pullTrigger({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    const game = getRussian(scopeKey, funConfig, now);
    if (!game) {
      return { ok: false, reason: 'no-game' };
    }
    // anti double-tap do mesmo dedo
    if (game.lastPullAt && now - game.lastPullAt < 1500 && game.pulls[game.pulls.length - 1] === userJid) {
      return { ok: false, reason: 'too-fast' };
    }

    const chance = 1 / Math.max(1, game.remaining);
    const dies = random() < chance;
    game.pulls.push(String(userJid || ''));
    game.lastPullAt = now;

    if (dies) {
      russianGames.delete(String(scopeKey || ''));
      if (effectsRepository?.setTimedEffect) {
        effectsRepository.setTimedEffect({
          userJid,
          scopeKey,
          effectKey: XP_DEAD_KEY,
          durationMs: o.deathMs,
          payload: { source: 'russian', reason: 'morto na roleta russa' },
          now,
        });
      }
      return {
        ok: true,
        died: true,
        remaining: 0,
        chambers: game.chambers,
        deathMs: o.deathMs,
        deathLabel: formatRetry(o.deathMs),
        pulls: game.pulls.length,
      };
    }

    game.remaining = Math.max(0, game.remaining - 1);
    if (game.remaining <= 0) {
      // safety: shouldn't happen if chance math is right, but close game
      russianGames.delete(String(scopeKey || ''));
    }
    return {
      ok: true,
      died: false,
      remaining: game.remaining,
      chambers: game.chambers,
      pulls: game.pulls.length,
    };
  }

  function cancelAbsurd(name) {
    const n = String(name || 'Fulano').trim() || 'Fulano';
    const fn = pick(CANCEL_REASONS, random);
    return fn(n);
  }

  function gossipFake(name) {
    const n = String(name || 'Fulano').trim() || 'Fulano';
    const fn = pick(GOSSIP_LINES, random);
    return fn(n);
  }

  function oracleInsane(question) {
    const q = String(question || '').trim().slice(0, 180) || 'a vida';
    const fn = pick(ORACLE_LINES, random);
    return fn(q);
  }

  function illuminatiTheory(name) {
    const n = String(name || 'Fulano').trim() || 'Fulano';
    const fn = pick(ILLUMINATI_LINES, random);
    return fn(n);
  }

  function pickRandomMember({ scopeKey, excludeJid = '', limit = 30 } = {}) {
    const board = repository.getLeaderboard?.(scopeKey, limit) || [];
    const pool = board
      .map((e) => e.userJid || e.user_jid)
      .filter((j) => j && j !== excludeJid);
    if (!pool.length) return null;
    return pick(pool, random);
  }

  function isXpDead(userJid, scopeKey, now = Date.now()) {
    if (!effectsRepository?.getEffect) return { blocked: false };
    const e = effectsRepository.getEffect(userJid, scopeKey, XP_DEAD_KEY, now);
    if (!e || !(e.expiresAt > now)) return { blocked: false };
    return {
      blocked: true,
      expiresAt: e.expiresAt,
      retryIn: formatRetry(e.expiresAt - now),
      effectKey: XP_DEAD_KEY,
    };
  }

  return {
    XP_DEAD_KEY,
    startRussian,
    pullTrigger,
    getRussian,
    cancelAbsurd,
    gossipFake,
    oracleInsane,
    illuminatiTheory,
    pickRandomMember,
    checkCooldown,
    isXpDead,
    formatRetry,
  };
}

export { XP_DEAD_KEY };
