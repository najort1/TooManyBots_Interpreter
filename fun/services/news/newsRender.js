/**
 * newsRender.js — renderização determinística do jornal "The Group Times".
 *
 * Recebe DayFacts (de newsFacts.collectDayFacts) + LLM bits (capa, abertura,
 * foreshadow de newsLlm.composeLlmBits) e monta o texto final em WhatsApp markdown.
 *
 * Tudo aqui é determinístico: mesmos facts → mesmo texto. LLM é só tempero opcional.
 *
 * Seções (cada uma só aparece se tiver dados relevantes):
 *  - Cabeçalho + capa (LLM ou fallback estático por mood)
 *  - Manchetes chamativas por categoria (req 3)
 *  - Categorias: Economia 💰 / Sociedade 💍 / Polícia 🚔 / Cassino 🎰 / Bolsa 📈 (req 1)
 *  - Stats do grupo 📊 (req 4)
 *  - Rankings 🏆 (req 2)
 *  - Prêmio do dia 🏅 (req 7)
 *  - Memória histórica 📜 (req 9)
 *  - Personalidade do grupo (req 6)
 *  - Foreshadow 👀 (req 8, LLM ou fallback)
 *
 * Edições especiais (req 5) mudam o cabeçalho/capa conforme o mood detectado.
 */

// ── Helpers ─────────────────────────────────────────────────────────

function fmtCoins(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}mi`;
  if (v >= 1000) return `${Math.round(v / 1000)}mil`;
  return String(v);
}
function fmtSigned(n) {
  const v = Math.floor(Number(n) || 0);
  return v >= 0 ? `+${v}` : `${v}`;
}
function nameOf(jid, getContactDisplayName) {
  if (!jid) return '?';
  try {
    if (typeof getContactDisplayName === 'function') {
      const n = getContactDisplayName(jid);
      if (n && String(n).trim()) return String(n).trim();
    }
  } catch {
    /* ignore */
  }
  return String(jid).split('@')[0];
}
function firstOf(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

// ── Capa: manchetes chamativas (req 3) ──────────────────────────────

/** Fallbacks estáticos por mood — usados se LLM não retornar capa. */
const CAPA_FALLBACKS = {
  calmo: [
    'Hoje não aconteceu absolutamente nada',
    'A cidade respirou. Ninguém mereceu manchete',
    'Dia tão parado que o estagiário do jornal dormiu',
  ],
  caotico: [
    '🚨 CIDADE EM COLAPSO',
    'A lei foi só uma sugestão hoje',
    'Especialistas não comentam. Estão ocupados chorando',
  ],
  apostador: [
    '💸 A economia gira graças a decisões questionáveis',
    'Cassino fatura. Grupo agradece a emoção',
    'Investir? Aqui a gente aposta',
  ],
  romantico: [
    'O amor (ainda) não morreu',
    'Cartório teve dia lucrativo',
    'Cupid ganhou comissão hoje',
  ],
  medio: [
    'Um dia como outro qualquer (só que menos)',
    'O equivalente a uma segunda-feira existencial',
    'Nada de extraordinário. Mas olha, tentaram',
  ],
};

function pickCapaFallback(mood, random) {
  const list = CAPA_FALLBACKS[mood] || CAPA_FALLBACKS.medio;
  return list[Math.floor(random() * list.length)];
}

// ── Edições especiais (req 5) ────────────────────────────────────────

function detectSpecialEdition(facts) {
  // dia absolutamente parado
  if (facts.eventsCount === 0 && facts.totals.crimes === 0 && facts.totals.bets === 0) {
    return 'parado';
  }
  // caos extremo
  if (facts.totals.crimes >= 50 || facts.mood === 'caotico') {
    return 'caotico';
  }
  // só amor
  if (facts.totals.marriages >= 2 && facts.totals.crimes === 0 && facts.totals.bets < 10) {
    return 'romantico';
  }
  // só cassino
  if (facts.totals.bets >= 30 && facts.totals.marriages === 0 && facts.totals.crimes === 0) {
    return 'apostador';
  }
  return null;
}

const SPECIAL_BANNERS = {
  parado: '📰 *EDIÇÃO TRANQUILA*',
  caotico: '🚨 *EDIÇÃO EXTRA*',
  romantico: '💕 *EDIÇÃO ROMÂNTICA*',
  apostador: '🎰 *EDIÇÃO ECONÔMICA*',
};

const SPECIAL_INTROS = {
  parado: 'Hoje não aconteceu absolutamente nada.\nNossa equipe passou o dia jogando dominó.',
  caotico: 'A cidade entrou oficialmente em colapso.\nA polícia emitiu nota dizendo "tudo bem, desistimos".',
  romantico: 'O amor reinou hoje. Uma raridade neste grupo.',
  apostador: 'Dinheiro virou fumaça, esperança virou estratégia.\nA casa agradece.',
};

// ── Micro-headlines por categoria (req 3) ───────────────────────────

const CATEGORY_HEADERS = {
  economia: ['💰 *ECONOMIA*', '📈 *ECONOMIA*', '💵 *BOLSO GRUPAL*'],
  sociedade: ['💍 *SOCIEDADE*', '❤️ *VIDA SOCIAL*', '💕 *CORAÇÕES*'],
  policia: ['🚔 *POLÍCIA*', '🚨 *DIÁRIO POLICIAL*', '🔫 *CRIMES*'],
  cassino: ['🎰 *CASSINO*', '🎲 *MESA DE APOSTAS*', '🃏 *RODADA*'],
  bolsa: ['📈 *BOLSA DE VALORES*', '📊 *MERCADO*'],
  desafio: ['🎯 *DESAFIO DO DIA*', '🧠 *DESAFIO DO DIA*'],
  stats: ['📊 *HOJE NO GRUPO*', '📋 *BALANÇO*'],
  rankings: ['🏆 *RANKINGS*', '🥇 *TOPS DO DIA*'],
  premio: ['🏅 *PRÊMIO DO DIA*', '🎬 *OSCAR DA ZOEIRA*'],
  memoria: ['📜 *ARQUIVO*', '📚 *MEMÓRIA HISTÓRICA*'],
};

function headerFor(cat, random) {
  const list = CATEGORY_HEADERS[cat] || ['*SEÇÃO*'];
  return list[Math.floor(random() * list.length)];
}

// ── Categorias (req 1) ───────────────────────────────────────────────

function renderEconomy(facts, getName, random) {
  const e = facts.economy;
  const lines = [];
  if (e.casinoVolume > 0) {
    lines.push(`• Cassino movimentou *${fmtCoins(e.casinoVolume)}c* hoje. A casa venceu novamente.`);
  }
  if (e.moneyDestroyed > 0) {
    lines.push(`• *${fmtCoins(e.moneyDestroyed)}c* transformados em fumaça no cassino.`);
  }
  if (e.rentKing) {
    lines.push(
      `• *${nameOf(e.rentKing, getName)}* levou *${fmtCoins(e.rentCollected)}c* em aluguel — quem mais arrecadou.`
    );
  }
  if (e.circulating > 0) {
    const desigualdade = e.gini > 0.6 ? 'desigualdade gritante' : e.gini > 0.4 ? 'desigualdade moderada' : 'distribuição quase saudável';
    lines.push(`• *${fmtCoins(e.circulating)}c* em circulação · ${desigualdade} (Gini ${e.gini.toFixed(2)}).`);
  }
  if (e.jobVolume > 0) {
    lines.push(`• Salários pagos: *${fmtCoins(e.jobVolume)}c*. O trabalho ainda existe, dizem.`);
  }
  if (lines.length === 0) return null;
  return [headerFor('economia', random), ...lines].join('\n');
}

function renderSociety(facts, getName, random) {
  const s = facts.society;
  const lines = [];
  if (s.marriages > 0) {
    lines.push(`• *${s.marriages}* casamento${s.marriages > 1 ? 's' : ''} registrado${s.marriages > 1 ? 's' : ''}. Apostas de divórcio abertas.`);
    const last = firstOf(s.marryEvents);
    if (last?.payload?.a && last?.payload?.b) {
      lines.push(
        `• *${nameOf(last.payload.a, getName)}* e *${nameOf(last.payload.b, getName)}* insistem no amor. A população torce contra.`
      );
    }
  }
  if (s.divorces > 0) {
    lines.push(`• *${s.divorces}* divórcio${s.divorces > 1 ? 's' : ''}. O cartório já considera filial fixa.`);
  }
  if (s.couplesActive > 0 && s.longestMarriage) {
    const days = Math.floor((facts.now - (s.longestMarriage.marriedAt || facts.now)) / (24 * 60 * 60 * 1000));
    lines.push(
      `• *${s.couplesActive}* casal${s.couplesActive > 1 ? 'is' : ''} ainda resistindo. Casal veterano: *${days}* dias.`
    );
  }
  if (s.achievementsUnlocked > 0) {
    lines.push(`• *${s.achievementsUnlocked}* conquista${s.achievementsUnlocked > 1 ? 's' : ''} desbloqueada${s.achievementsUnlocked > 1 ? 's' : ''}. A vaidade agradece.`);
  }
  if (s.despedidas > 0) {
    lines.push(`• *${s.despedidas}* despedida${s.despedidas > 1 ? 's' : ''} solene${s.despedidas > 1 ? 's' : ''} (\`/despedir\`).`);
    const top = firstOf(s.topFarewellUsers);
    if (top) {
      lines.push(`• Quem mais se despediu: *${nameOf(top.jid, getName)}* (${top.count}×). Insistente.`);
    }
  }
  if (lines.length === 0) return null;
  return [headerFor('sociedade', random), ...lines].join('\n');
}

function renderPolice(facts, getName, random) {
  const p = facts.police;
  const lines = [];
  if (p.assaultsCount > 0) {
    lines.push(
      `• Foram registrados *${p.assaultsCount}* assalto${p.assaultsCount > 1 ? 's' : ''}. A polícia continua recebendo salário pra absolutamente nada.`
    );
  }
  if (p.assaultsTotal > 0) {
    lines.push(`• *${fmtCoins(p.assaultsTotal)}c* roubados no total. A justiça sonha em acordar.`);
  }
  if (p.biggestAssaultEvent?.payload) {
    const amt = p.biggestAssaultEvent.payload.amount || 0;
    const rawTarget = p.biggestAssaultEvent.payload.target;
    const target = rawTarget ? nameOf(rawTarget, getName) : 'alguém';
    lines.push(`• Maior golpe do dia: *${fmtCoins(amt)}c* tirados de *${target}*. Quase romântico.`);
  }
  if (p.propertyRobs > 0) {
    lines.push(`• *${p.propertyRobs}* propriedade${p.propertyRobs > 1 ? 's' : ''} saqueada${p.propertyRobs > 1 ? 's' : ''} (*${fmtCoins(p.propertyRobsTotal)}c*).`);
  }
  if (p.purgaHappened) {
    lines.push('• 🔥 *A PURGA* aconteceu. Por 10 minutos, a lei foi uma ficção.');
    const top = firstOf(p.topCrims);
    if (top) {
      lines.push(`• Criminoso do dia: *${nameOf(top.jid, getName)}* com *${fmtCoins(top.total)}c* roubados.`);
    }
    const victim = firstOf(p.topVictims);
    if (victim) {
      lines.push(`• Vítima do dia: *${nameOf(victim.jid, getName)}* perdeu *${fmtCoins(victim.total)}c*. Condolências.`);
    }
  }
  if (lines.length === 0) return null;
  return [headerFor('policia', random), ...lines].join('\n');
}

function renderCasino(facts, getName, random) {
  const c = facts.casino;
  const lines = [];
  if (c.volume > 0) {
    const casaVenceu = c.lost > c.gained;
    lines.push(
      `• Volume apostado: *${fmtCoins(c.volume)}c*. A casa ${casaVenceu ? 'venceu. De novo.' : 'perdeu hoje. Suspeito.'}`
    );
  }
  if (c.biggestCrashLossEvent?.payload) {
    const amt = c.biggestCrashLossEvent.payload.amount || 0;
    lines.push(`• Maior crash: *${fmtCoins(amt)}c* virou pó em segundos.`);
  }
  const topGambler = firstOf(c.leaderboard);
  if (topGambler && topGambler.games > 0) {
    const veredito = topGambler.profit >= 0 ? 'no azul' : 'no vermelho profundo';
    lines.push(`• Jogador mais viciado: *${nameOf(topGambler.jid, getName)}* (${topGambler.games} partidas, ${veredito}).`);
  }
  if (c.rouletteStreak?.count >= 3) {
    const colorMap = { red: 'vermelho', black: 'preto', green: 'verde' };
    const cor = colorMap[c.rouletteStreak.color] || c.rouletteStreak.color;
    lines.push(`• Roleta: *${c.rouletteStreak.count}* vezes seguidas no ${cor}. Estatística chorando no canto.`);
  }
  if (c.casinoWinEvents.length > 0) {
    const best = c.casinoWinEvents.reduce((m, e) =>
      !m || (e.payload?.amount || 0) > (m.payload?.amount || 0) ? e : m
    );
    lines.push(`• Maior premiação: *${fmtCoins(best.payload?.amount || 0)}c*. O apostador jurou que era "estratégia".`);
  }
  if (lines.length === 0) return null;
  return [headerFor('cassino', random), ...lines].join('\n');
}

function renderStocks(facts, getName, random) {
  const st = facts.stocks;
  const lines = [];
  if (st.moverUp) {
    lines.push(`• Maior alta: *${st.moverUp.companyId}* ${fmtSigned(st.moverUp.deltaPct.toFixed(1))}%. Quem comprou ontem é gênio agora.`);
  }
  if (st.moverDown) {
    lines.push(`• Maior queda: *${st.moverDown.companyId}* ${fmtSigned(st.moverDown.deltaPct.toFixed(1))}%. "Era só correção", dirão.`);
  }
  if (lines.length === 0) return null;
  return [headerFor('bolsa', random), ...lines].join('\n');
}

// ── Stats do grupo (req 4) ───────────────────────────────────────────

function renderChallenge(facts, getName, random) {
  const c = facts.challenge;
  if (!c) return null;
  const fmtMin = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m} min${s % 60 > 0 ? ` ${s % 60}s` : ''}`;
  };
  const lines = [];
  if (c.solved && c.winnerJid) {
    const winner = c.winnerName || nameOf(c.winnerJid, getName);
    lines.push(`🏆 *${winner}* resolveu em *${fmtMin(c.solveTimeSec)}*!`);
    lines.push('Foi o mais rapido do dia.');
    lines.push('');
    lines.push(`📊 *Historico do grupo:*`);
    lines.push(`✔ ${c.totalSolved || 0} desafios resolvidos`);
    if (Array.isArray(c.fastest) && c.fastest[0]?.jid) {
      const fastest = c.fastest[0];
      lines.push(`⚡ Mais rapido: ${nameOf(fastest.jid, getName)} — ${fmtMin(fastest.best)}`);
    }
  } else {
    lines.push('😢 Ninguem conseguiu resolver hoje.');
    if (c.answer) lines.push(`A resposta era: *${c.answer}*`);
    lines.push('');
    lines.push('Tentem novamente amanha!');
  }
  if (lines.length === 0) return null;
  return [headerFor('desafio', random), ...lines].join('\n');
}

function renderStats(facts, random) {
  const t = facts.totals;
  const parts = [];
  if (t.marriages) parts.push(`${t.marriages} casamento${t.marriages > 1 ? 's' : ''}`);
  if (t.divorces) parts.push(`${t.divorces} divórcio${t.divorces > 1 ? 's' : ''}`);
  if (t.crimes) parts.push(`${t.crimes} roubo${t.crimes > 1 ? 's' : ''}`);
  if (t.bets) parts.push(`${t.bets} aposta${t.bets > 1 ? 's' : ''}`);
  if (t.propertiesBought) parts.push(`${t.propertiesBought} propriedade${t.propertiesBought > 1 ? 's' : ''} comprada${t.propertiesBought > 1 ? 's' : ''}`);
  if (t.coinsDestroyed) parts.push(`${fmtCoins(t.coinsDestroyed)} moedas destruídas`);
  if (t.achievements) parts.push(`${t.achievements} conquista${t.achievements > 1 ? 's' : ''}`);
  if (t.despedidas) parts.push(`${t.despedidas} despedida${t.despedidas > 1 ? 's' : ''}`);
  if (parts.length === 0) return null;
  return [
    headerFor('stats', random),
    parts.join(' · '),
    `• 1 pessoa chorando (estimativa)`,
  ].join('\n');
}

// ── Rankings (req 2) ─────────────────────────────────────────────────

function renderRankings(facts, getName, random) {
  const medals = ['🥇', '🥈', '🥉'];
  const blocks = [];

  if (facts.rankings.topCoins.length > 0) {
    const lines = facts.rankings.topCoins.map((u, i) => `${medals[i] || '▪'} ${nameOf(u.jid, getName)} — *${fmtCoins(u.coins)}c*`);
    blocks.push(['*Top Ricos*', ...lines].join('\n'));
  }
  if (facts.rankings.topCrims.length > 0) {
    const lines = facts.rankings.topCrims.map((u, i) => `${medals[i] || '▪'} ${nameOf(u.jid, getName)} — *${fmtCoins(u.total)}c* roubados`);
    blocks.push(['*Top Criminosos*', ...lines].join('\n'));
  }
  if (facts.rankings.topUnlucky.length > 0) {
    const lines = facts.rankings.topUnlucky.map((u, i) => `${medals[i] || '▪'} ${nameOf(u.jid, getName)} — *${fmtCoins(u.total)}c* perdidos`);
    blocks.push(['*Top Azarados*', ...lines].join('\n'));
  }
  if (blocks.length === 0) return null;
  return [headerFor('rankings', random), '', ...blocks].join('\n');
}

// ── Prêmio do dia (req 7) ────────────────────────────────────────────

function pickAwards(facts, getName, random) {
  const awards = [];
  const t = facts.totals;
  const e = facts.economy;
  const c = facts.casino;
  const p = facts.police;

  if (e.rentKing && e.rentCollected > 0) {
    awards.push({
      icon: '🏆',
      title: 'Empresário do Dia',
      who: nameOf(e.rentKing, getName),
      why: `${fmtCoins(e.rentCollected)}c em aluguel arrecadado`,
    });
  }
  if (facts.society.marriages > 0 && facts.society.marryEvents[0]?.payload) {
    const m = facts.society.marryEvents[0].payload;
    awards.push({
      icon: '💕',
      title: 'Casal do Dia',
      who: `${nameOf(m.a, getName)} + ${nameOf(m.b, getName)}`,
      why: 'disseram sim no zap',
    });
  }
  if (p.topCrims[0]) {
    awards.push({
      icon: '🎭',
      title: 'Golpista do Dia',
      who: nameOf(p.topCrims[0].jid, getName),
      why: `${fmtCoins(p.topCrims[0].total)}c em golpes`,
    });
  }
  if (c.biggestCrashLossEvent?.payload?.amount >= 50) {
    awards.push({
      icon: '💸',
      title: 'Pior Decisão Financeira',
      who: nameOf(c.biggestCrashLossEvent.userJid, getName),
      why: `${fmtCoins(c.biggestCrashLossEvent.payload.amount)}c no crash`,
    });
  }
  if (p.topVictims[0] && p.topVictims[0].total > 0) {
    awards.push({
      icon: '😭',
      title: 'Vítima Preferida',
      who: nameOf(p.topVictims[0].jid, getName),
      why: `${fmtCoins(p.topVictims[0].total)}c doados involuntariamente`,
    });
  }
  if (c.casinoWinEvents.length > 0 && c.casinoWinEvents[0]?.payload?.amount >= 100) {
    const w = c.casinoWinEvents[0];
    awards.push({
      icon: '🎲',
      title: 'Aposta Mais Questionável',
      who: nameOf(w.userJid, getName),
      why: `${fmtCoins(w.payload.amount)}c que provavelmente vão voltar pra casa`,
    });
  }
  // coragem inexplicável: alguém casado que também apostou muito
  if (facts.society.marriages > 0 && t.bets > 20) {
    awards.push({
      icon: '🦁',
      title: 'Coragem Inexplicável',
      who: '(consenso grupal)',
      why: 'apaixonar e apostar no mesmo dia',
    });
  }
  return awards;
}

function renderAwards(facts, getName, random) {
  const awards = pickAwards(facts, getName, random);
  if (awards.length === 0) return null;
  const lines = awards.map(
    (a) => `${a.icon} *${a.title}*\n   ${a.who} — _${a.why}_`
  );
  return [headerFor('premio', random), '', ...lines].join('\n');
}

// ── Memória histórica (req 9) ────────────────────────────────────────

function renderMemory(facts, random) {
  const mems = facts.memory || [];
  if (mems.length === 0) return null;
  const lines = mems.map((m) => `• ${m.text}`);
  return [headerFor('memoria', random), ...lines].join('\n');
}

// ── Personalidade do grupo (req 6) ───────────────────────────────────

function renderPersonality(facts) {
  if (!facts.personality?.line) return null;
  return `🧠 *Perfil do grupo*\n• _${facts.personality.line}_`;
}

// ── Frases do dia (notable_quote) ────────────────────────────────────

function renderQuotes(facts, getName) {
  const q = facts.quotes;
  if (!q || !q.count) return null;
  const lines = q.list.map((e) => {
    const who = nameOf(e.userJid, getName);
    return `• *${who}*: "${e.quote}"`;
  });
  return ['💬 *FRASES DO DIA*', ...lines].join('\n');
}

// ── Render principal ─────────────────────────────────────────────────

/**
 * Monta o texto completo do jornal.
 * @param {object} facts — DayFacts de collectDayFacts
 * @param {object} llmBits — { capa?: string, intro?: string, foreshadow?: string } (opcionais, de composeLlmBits)
 * @param {object} opts — { getContactDisplayName, random, dayLabel }
 */
export function renderEdition(facts, llmBits = {}, opts = {}) {
  const getName = opts.getContactDisplayName;
  const random = opts.random || Math.random;
  const dayLabel = opts.dayLabel;
  const special = detectSpecialEdition(facts);
  const banner = special ? SPECIAL_BANNERS[special] : '📰 *THE GROUP TIMES*';
  const intro =
    llmBits?.intro?.trim() ||
    SPECIAL_INTROS[special] ||
    'Edição da madrugada. As notícias que ninguém pediu, mas todos merecem.';

  const sections = [];

  // Cabeçalho + capa
  sections.push(banner);
  if (dayLabel) sections.push(`_${dayLabel}_`);
  sections.push('');
  const capa = (llmBits?.capa?.trim() || '').slice(0, 200) || pickCapaFallback(facts.mood, random);
  sections.push(`*${capa}*`);
  sections.push('');
  sections.push(intro);
  sections.push('');

  // Personalidade do grupo (logo após capa)
  const personality = renderPersonality(facts);
  if (personality) {
    sections.push(personality);
    sections.push('');
  }

  // Categorias (em ordem de relevância)
  const catRenderers = [
    () => renderEconomy(facts, getName, random),
    () => renderPolice(facts, getName, random),
    () => renderCasino(facts, getName, random),
    () => renderSociety(facts, getName, random),
    () => renderStocks(facts, getName, random),
    () => renderChallenge(facts, getName, random),
  ];
  for (const render of catRenderers) {
    const block = render();
    if (block) {
      sections.push(block);
      sections.push('');
    }
  }

  // Stats do grupo
  const stats = renderStats(facts, random);
  if (stats) {
    sections.push(stats);
    sections.push('');
  }

  // Rankings
  const rankings = renderRankings(facts, getName, random);
  if (rankings) {
    sections.push(rankings);
    sections.push('');
  }

  // Prêmio do dia
  const awards = renderAwards(facts, getName, random);
  if (awards) {
    sections.push(awards);
    sections.push('');
  }

  // Frases do dia
  const quotes = renderQuotes(facts, getName);
  if (quotes) {
    sections.push(quotes);
    sections.push('');
  }

  // Memória histórica
  const memory = renderMemory(facts, random);
  if (memory) {
    sections.push(memory);
    sections.push('');
  }

  // Foreshadow (req 8) — LLM ou fallback por mood
  const foreshadow = (llmBits?.foreshadow?.trim() || '').slice(0, 240) || pickForeshadowFallback(facts, random);
  sections.push(`👀 *AMANHÃ*`);
  sections.push(foreshadow);

  let text = sections.join('\n');
  if (text.length > 3600) text = text.slice(0, 3590) + '…';
  return text;
}

const FORESHADOW_FALLBACKS = {
  caotico: 'Nossa equipe continuará investigando os crimes de hoje. A cena não promete melhorar.',
  apostador: 'Especialistas apostam que amanhã o cassino fatura de novo. As probabilidades são... óbvias.',
  romantico: 'Rumores dizem que mais declarações estão a caminho. O cartório já separou caneta nova.',
  calmo: 'Rumores apontam que amanhã pode acontecer alguma coisa. Ou não. Estamos de olho.',
  medio: 'A redação segue monitorando. Se algo digno de nota acontecer, alguém vai inventar.',
};
function pickForeshadowFallback(facts, random) {
  const list = FORESHADOW_FALLBACKS[facts.mood] || FORESHADOW_FALLBACKS.medio;
  return list;
}
