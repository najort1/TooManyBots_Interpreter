/**
 * Roast personalizado — dossiê SQLite + LLM (flavor) + template.
 */

const DAY_MS = 24 * 60 * 60_000;

const FALLBACKS = [
  'Você é tão azarado no cassino que a BombaTech te cataloga como *ativo tóxico*. Saldo sumindo, moral sumindo — clássico.',
  'Patrimônio emocional: zero. Patrimônio em coins: quase zero. Continua tentando, campeão do prejuízo.',
  'Se o rank fosse por vergonha alheia, você tava no pódio com folga. O grupo agradece o conteúdo grátis.',
];

export function createRoastService({
  repository,
  jobService = null,
  relationshipService = null,
  factionService = null,
  casinoRepository = null,
  flavorService = null,
  random = Math.random,
} = {}) {
  function enabled(funConfig = {}) {
    return funConfig.roastEnabled !== false;
  }

  function buildDossier({ userJid, scopeKey, now = Date.now(), getContactDisplayName }) {
    const stats =
      repository.getUserStats(userJid, scopeKey) ||
      repository.ensureUserRow(userJid, scopeKey, now);
    const name =
      (typeof getContactDisplayName === 'function'
        ? getContactDisplayName(userJid)
        : '') || userJid.slice(0, 18);

    const job =
      jobService?.getEmployment?.(userJid, scopeKey) ||
      jobService?.getUserJob?.(userJid, scopeKey) ||
      null;
    const marriage = relationshipService?.getMarriage?.(userJid, scopeKey) || null;
    const faction = factionService?.getUserFaction?.(scopeKey, userJid) || null;
    const casino = casinoRepository?.getStats?.(userJid, scopeKey) || null;

    let biggestLoss = null;
    if (typeof repository.biggestLossSince === 'function') {
      biggestLoss = repository.biggestLossSince({
        userJid,
        scopeKey,
        since: now - DAY_MS,
      });
    }

    const rank =
      typeof repository.getUserRankPosition === 'function'
        ? repository.getUserRankPosition(userJid, scopeKey)
        : null;

    return {
      name,
      userJid,
      level: Number(stats.level) || 1,
      xp: Number(stats.xp) || 0,
      coins: Number(stats.coins) || 0,
      rank: rank?.position || null,
      jobName: job?.job?.name || job?.name || null,
      married: Boolean(marriage),
      partnerJid: marriage?.partnerJid || marriage?.partner_jid || null,
      factionName: faction?.faction?.name || null,
      casinoLost: Number(casino?.lost) || 0,
      casinoWagered: Number(casino?.wagered) || 0,
      casinoGames: Number(casino?.games) || 0,
      biggestLoss24h: biggestLoss,
    };
  }

  function factsLines(dossier, getContactDisplayName) {
    const lines = [];
    lines.push(`Apelido/nome: ${dossier.name}`);
    lines.push(`Nível ${dossier.level}, ${dossier.coins} coins`);
    if (dossier.rank) lines.push(`Rank XP #${dossier.rank}`);
    if (dossier.jobName) lines.push(`Emprego: ${dossier.jobName}`);
    else lines.push('Sem emprego CLT');
    if (dossier.married && dossier.partnerJid) {
      const p =
        (typeof getContactDisplayName === 'function'
          ? getContactDisplayName(dossier.partnerJid)
          : '') || 'alguém';
      lines.push(`Casado(a) com ${p}`);
    } else {
      lines.push('Solteiro(a) no sistema');
    }
    if (dossier.factionName) lines.push(`Panelinha: ${dossier.factionName}`);
    if (dossier.biggestLoss24h) {
      lines.push(
        `Maior perda 24h: ${dossier.biggestLoss24h.amount}c (${dossier.biggestLoss24h.reason})`
      );
    } else if (dossier.casinoLost > 0) {
      lines.push(
        `Cassino lifetime: perdeu ${dossier.casinoLost}c em ${dossier.casinoGames} jogos`
      );
    } else {
      lines.push('Sem perda grande recente no ledger');
    }
    return lines;
  }

  function templateRoast(dossier) {
    const pick = FALLBACKS[Math.floor(random() * FALLBACKS.length)];
    const jobBit = dossier.jobName
      ? ` *${dossier.jobName}*`
      : ' desempregado de carteira assinada no fracasso';
    const loss = dossier.biggestLoss24h
      ? ` Ontem queimou *${dossier.biggestLoss24h.amount}c* e ainda culpa o bug.`
      : '';
    return `${dossier.name},${jobBit}. ${pick}${loss}`.slice(0, 700);
  }

  async function roast({
    userJid,
    scopeKey,
    funConfig = {},
    now = Date.now(),
    getContactDisplayName,
  }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };

    const dossier = buildDossier({
      userJid,
      scopeKey,
      now,
      getContactDisplayName,
    });
    const facts = factsLines(dossier, getContactDisplayName).join('\n');

    let text = '';
    let provider = 'template';

    if (flavorService && typeof flavorService.line === 'function') {
      try {
        const out = await flavorService.line('roast_personal', {
          user: dossier.name,
          userName: dossier.name,
          facts,
        });
        const raw = typeof out === 'string' ? out : out?.text;
        if (raw && String(raw).trim().length > 20) {
          text = String(raw).trim().slice(0, funConfig.roastMaxChars || 700);
          provider = flavorService.lastProvider?.() || 'llm';
        }
      } catch {
        // fallthrough
      }
    }

    if (!text) {
      text = templateRoast(dossier);
      provider = 'template';
    }

    return { ok: true, text, provider, dossier };
  }

  return {
    enabled,
    buildDossier,
    roast,
    templateRoast,
  };
}
