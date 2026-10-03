const ACTION_DELTAS = Object.freeze({
  kiss: { affection: 5, rivalry: -2, intimacy: 4, chaos: 1 },
  cuddle: { affection: 5, rivalry: -2, intimacy: 4, chaos: 1 },
  hug: { affection: 3, rivalry: -1, intimacy: 3, chaos: 0 },
  pat: { affection: 3, rivalry: -1, intimacy: 3, chaos: 0 },
  handhold: { affection: 4, rivalry: -1, intimacy: 3, chaos: 0 },
  slap: { affection: -3, rivalry: 6, intimacy: 1, chaos: 5 },
  bite: { affection: 2, rivalry: 3, intimacy: 3, chaos: 6 },
  lick: { affection: 2, rivalry: 3, intimacy: 3, chaos: 6 },
  poke: { affection: 1, rivalry: 1, intimacy: 2, chaos: 2 },
  nom: { affection: 1, rivalry: 1, intimacy: 2, chaos: 2 },
  highfive: { affection: 2, rivalry: 0, intimacy: 2, chaos: 1 },
  wave: { affection: 1, rivalry: 0, intimacy: 1, chaos: 0 },
  assault: { affection: -12, rivalry: 15, intimacy: 2, chaos: 10 },
  house_robbery: { affection: -10, rivalry: 14, intimacy: 2, chaos: 8 },
  pay: { affection: 6, rivalry: -3, intimacy: 4, chaos: 0 },
  house_gift: { affection: 12, rivalry: -5, intimacy: 8, chaos: 0 },
  dice_duel: { affection: 0, rivalry: 5, intimacy: 3, chaos: 4 },
  roulette_pull: { affection: 0, rivalry: 2, intimacy: 4, chaos: 15 },
  qmp_vote: { affection: -3, rivalry: 5, intimacy: 1, chaos: 4 },
});

export function classifyBond({ affection = 0, rivalry = 0, intimacy = 0, chaos = 0 } = {}) {
  const A = Number(affection) || 0;
  const R = Number(rivalry) || 0;
  const I = Number(intimacy) || 0;
  const C = Number(chaos) || 0;

  if (I < 8 && A < 12 && R < 12) {
    return { key: 'strangers', label: 'Desconhecidos', desc: 'Duas almas que mal se cruzam no grupo.' };
  }
  if (A >= 50 && R >= 35) {
    return { key: 'love_hate', label: 'Tapas e Beijos', desc: 'Entre xingamentos e carinhos, ninguém entende mas funciona.' };
  }
  if (A >= 70 && I >= 45 && R < 25) {
    return { key: 'soulmates', label: 'Inseparáveis', desc: 'Sintonia pura e fidelidade incondicional.' };
  }
  if (R >= 55 && C >= 40 && A < 25) {
    return { key: 'archnemesis', label: 'Arqui-inimigos', desc: 'Sangue nos olhos. Se um cair, o outro comemora.' };
  }
  if (I >= 40 && C >= 45 && R < 35) {
    return { key: 'partners_in_crime', label: 'Cúmplices de Crime', desc: 'A mente por trás das maiores loucuras do grupo.' };
  }
  if (R >= 45 && I < 30) {
    return { key: 'bitter_rivals', label: 'Treta Declarada', desc: 'A faísca tá solta, qualquer comando vira guerra.' };
  }
  if (A >= 40 && R < 20) {
    return { key: 'sweethearts', label: 'Chamego Doce', desc: 'Amizade fofa cheia de carinhos e mimos.' };
  }
  if (C >= 50 && A < 40 && R < 40) {
    return { key: 'chaos_agents', label: 'Agentes do Caos', desc: 'Só interagem pra causar confusão e rir da cara do grupo.' };
  }
  return { key: 'acquaintances', label: 'Conhecidos', desc: 'Uma convivência pacífica com interações esporádicas.' };
}

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, val));
}

function dayKey(timestamp) {
  const d = new Date(Number(timestamp) || Date.now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function createBondService({
  bondRepository,
  relationshipRepository = null,
  random = Math.random,
} = {}) {
  if (!bondRepository) {
    throw new Error('[fun/bondService] bondRepository obrigatório');
  }

  // Janelas ativas de contra-tapa em memória: `${scopeKey}:${victimJid}:${attackerJid}` -> expiresAt
  const counterSlapWindows = new Map();

  function applyDecay(bond, now = Date.now()) {
    const last = bond.lastDecayAt || bond.lastInteractionAt;
    if (!last || now <= last) return bond;

    const msPerDay = 24 * 60 * 60 * 1000;
    const elapsedDays = Math.floor((now - last) / msPerDay);
    if (elapsedDays <= 0) return bond;

    let A = bond.affection;
    let R = bond.rivalry;
    let I = bond.intimacy;
    let C = bond.chaos;

    for (let day = 0; day < elapsedDays; day++) {
      A = clamp(A - Math.max(1, Math.floor(0.05 * A)));
      R = clamp(R - Math.max(2, Math.floor(0.10 * R)));
      C = clamp(C - Math.max(2, Math.floor(0.15 * C)));
      I = clamp(I - Math.max(1, Math.floor(0.03 * I)));
    }

    const updated = {
      ...bond,
      affection: A,
      rivalry: R,
      intimacy: I,
      chaos: C,
      archetype: classifyBond({ affection: A, rivalry: R, intimacy: I, chaos: C }).key,
      lastDecayAt: now,
      updatedAt: now,
    };

    return bondRepository.saveBond(updated);
  }

  function getBondWithDecay(scopeKey, u1, u2, now = Date.now()) {
    const raw = bondRepository.getBond(scopeKey, u1, u2);
    if (!raw || raw.isNew) return raw;
    return applyDecay(raw, now);
  }

  function recordAction({
    scopeKey,
    actorJid,
    targetJid,
    action,
    now = Date.now(),
  }) {
    const s = String(scopeKey || '').trim();
    const a = String(actorJid || '').trim();
    const b = String(targetJid || '').trim();
    if (!s || !a || !b || a === b) {
      return { ok: false, reason: 'invalid-participants' };
    }

    let bond = getBondWithDecay(s, a, b, now);

    // Gestão do soft-cap diário
    const today = dayKey(now);
    const lastDay = bond.flags?.lastDayKey || '';
    let dailyAcc = bond.dailyPointsAcc || 0;
    if (lastDay !== today) {
      dailyAcc = 0;
    }

    let multiplier = 1.0;
    if (dailyAcc === 0) multiplier = 1.0;
    else if (dailyAcc === 1) multiplier = 0.6;
    else if (dailyAcc === 2) multiplier = 0.3;
    else multiplier = 0.0;

    const saturated = multiplier === 0.0;

    // Reciprocidade: interação em vaivém fortalece intimidade; repetição unilateral sobe caos
    const isReciprocal = bond.lastActorJid && bond.lastActorJid !== a;
    const baseDeltas = ACTION_DELTAS[action] || { affection: 1, rivalry: 0, intimacy: 1, chaos: 0 };

    let dA = (baseDeltas.affection || 0) * multiplier;
    let dR = (baseDeltas.rivalry || 0) * multiplier;
    let dI = (baseDeltas.intimacy || 0) * multiplier;
    let dC = (baseDeltas.chaos || 0) * multiplier;

    if (!saturated) {
      if (isReciprocal && dI > 0) {
        dI += 1.5; // bônus de reciprocidade mútua
      } else if (!isReciprocal && bond.lastActorJid === a) {
        dC += 1.0; // insistência unilateral gera caos/implicância
      }
    }

    const newA = clamp(bond.affection + dA);
    const newR = clamp(bond.rivalry + dR);
    const newI = clamp(bond.intimacy + dI);
    const newC = clamp(bond.chaos + dC);

    const archetypeInfo = classifyBond({ affection: newA, rivalry: newR, intimacy: newI, chaos: newC });

    const newFlags = {
      ...(bond.flags || {}),
      lastDayKey: today,
    };

    // Tracking de flagrante de infidelidade (se ator casado fizer ação afetuosa com terceiro)
    if (relationshipRepository && ['kiss', 'cuddle', 'bite', 'handhold'].includes(action)) {
      const marriage = relationshipRepository.getMarriage(a, s);
      if (marriage && marriage.partnerJid && marriage.partnerJid !== b) {
        const infData = {
          adultererJid: a,
          thirdPartyJid: b,
          spouseJid: marriage.partnerJid,
          action,
          at: now,
        };
        newFlags.lastInfidelity = infData;

        // Marca imediatamente o vínculo conjugal direto entre os esposos
        const marriageBond = bondRepository.getBond(s, a, marriage.partnerJid);
        if (marriageBond) {
          marriageBond.flags = {
            ...(marriageBond.flags || {}),
            lastInfidelity: infData,
          };
          bondRepository.saveBond(marriageBond);
        }
      }
    }

    // Se for slap, ativa janela de contra-tapa para o alvo (45s)
    if (action === 'slap') {
      const windowKey = `${s}:${b}:${a}`;
      counterSlapWindows.set(windowKey, now + 45_000);
    }

    const saved = bondRepository.saveBond({
      scopeKey: s,
      userA: bond.userA,
      userB: bond.userB,
      affection: newA,
      rivalry: newR,
      intimacy: newI,
      chaos: newC,
      archetype: archetypeInfo.key,
      lastAction: action,
      lastActorJid: a,
      dailyPointsAcc: dailyAcc + 1,
      lastInteractionAt: now,
      lastDecayAt: now,
      interactionsCount: (bond.interactionsCount || 0) + 1,
      flags: newFlags,
      updatedAt: now,
    });

    return {
      ok: true,
      bond: saved,
      archetype: archetypeInfo,
      multiplier,
      saturated,
      isReciprocal,
    };
  }

  function getCounterSlapWindow(scopeKey, victimJid, attackerJid, now = Date.now()) {
    const windowKey = `${scopeKey}:${victimJid}:${attackerJid}`;
    const expiresAt = counterSlapWindows.get(windowKey) || 0;
    if (expiresAt > now) {
      return { active: true, remainingMs: expiresAt - now };
    }
    counterSlapWindows.delete(windowKey);
    return { active: false, remainingMs: 0 };
  }

  function checkReactionProc({ scopeKey, actorJid, targetJid, action, bond = null }) {
    const currentBond = bond || getBondWithDecay(scopeKey, actorJid, targetJid);
    if (!currentBond) return { procType: 'none' };

    const A = currentBond.affection || 0;
    const R = currentBond.rivalry || 0;
    const I = currentBond.intimacy || 0;

    // 1. Esquiva Cômica (Climão): Rivalidade alta e baixo afeto tentando beijo/chamego
    if (['kiss', 'cuddle', 'handhold'].includes(action) && R >= 40 && A <= 25) {
      return {
        procType: 'comedic_dodge',
        blocked: true,
        message: 'desviou agilmente fingindo olhar o relógio! Ficou aquele climão no ar...',
      };
    }

    // 2. Reação Crítica: Alta afinidade e intimidade geram proc crítico com recompensa
    if (['kiss', 'hug', 'cuddle', 'pat'].includes(action)) {
      const critChance = Math.min(0.35, 0.05 + 0.003 * I);
      if (Number(random()) < critChance) {
        return {
          procType: 'critical_reaction',
          blocked: false,
          bonusXp: 15,
          bonusCoins: 5,
          flavor: '✨ *REVOLUÇÃO SOCIAL!* O momento teve uma química tão intensa que contagiou todo o grupo!',
        };
      }
    }

    return { procType: 'none', blocked: false };
  }

  function calculateShipCompatibility(scopeKey, u1, u2, now = Date.now()) {
    const bond = getBondWithDecay(scopeKey, u1, u2, now);
    if (!bond || bond.isNew || bond.interactionsCount === 0) {
      // Sem histórico: compatibilidade inicial baseada em potencial neutro
      return {
        percent: 50,
        archetype: classifyBond({ affection: 0, rivalry: 0, intimacy: 0, chaos: 0 }),
        bond: null,
        hasHistory: false,
        diagnosis: 'Duas incógnitas. Uma folha em branco esperando a primeira fagulha.',
      };
    }

    const A = bond.affection;
    const R = bond.rivalry;
    const I = bond.intimacy;
    const C = bond.chaos;

    // Fórmula 4D: Afeto pesa 40%, Intimidade 30%, Baixa Rivalidade 20%, Caos tempera 10%
    const score = (0.40 * A) + (0.30 * I) + (0.20 * (100 - R)) + (0.10 * C);
    const percent = Math.max(1, Math.min(99, Math.round(score)));
    const archetype = classifyBond({ affection: A, rivalry: R, intimacy: I, chaos: C });

    let diagnosis = archetype.desc;
    if (bond.archetype === 'love_hate') {
      diagnosis = 'Química perigosa! Vocês passam metade do tempo se alfinetando e a outra metade disfarçando o interesse.';
    } else if (bond.archetype === 'soulmates') {
      diagnosis = 'Sintonia absurda. Se colocarem os dois numa sala, o resto do grupo vira plateia.';
    } else if (bond.archetype === 'archnemesis') {
      diagnosis = 'Incompatibilidade letal! O amor aqui só existiria num filme de tragédia shakespeariana.';
    }

    return {
      percent,
      archetype,
      bond,
      hasHistory: true,
      diagnosis,
    };
  }

  return {
    classifyBond,
    getBondWithDecay,
    recordAction,
    getCounterSlapWindow,
    checkReactionProc,
    calculateShipCompatibility,
  };
}
