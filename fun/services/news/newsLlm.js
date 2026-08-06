export async function composeLlmBits(
  facts,
  flavorService,
  scopeKey,
  random = Math.random,
  groupMemoryService = null,
  funConfig = {}
) {
  const out = { capa: null, intro: null, foreshadow: null };
  if (!flavorService || typeof flavorService.line !== 'function') return out;

  const ctx = buildLlmContext(facts);
  let groupLore = '';
  try {
    groupLore = groupMemoryService?.buildLoreContext?.(scopeKey, {
      limit: 8,
      funConfig,
    }) || '';
  } catch {
    groupLore = '';
  }
  const vars = {
    mood: ctx.mood,
    totals: ctx.totals,
    destaques: ctx.destaques,
    recordes: ctx.recordes,
    personalidade: ctx.personalidade,
    events: ctx.events,
    count: facts.eventsCount || 0,
    scopeKey: String(scopeKey || ''),
    groupLore,
  };

  try {
    const result = await flavorService.line('group_times', vars);
    const raw = typeof result === 'string' ? result : result?.text || null;
    if (!raw || String(raw).trim().length < 30) return out;
    const provider = typeof flavorService.lastProvider === 'function' ? flavorService.lastProvider() : null;
    if (provider && String(provider).includes('template')) return out;

    const text = String(raw).trim();
    out.capa = extractLabel(text, 'CAPA');
    out.intro = extractLabel(text, 'INTRO');
    out.foreshadow = extractLabel(text, 'FORESHADOW');
  } catch {}

  return out;
}

function extractLabel(text, label) {
  const re = new RegExp(`${label}[:\\s]+([^\\n]*(?:\\n(?!\\w+:)[^\\n]*)*)`, 'i');
  const match = text.match(re);
  if (!match) return null;
  const val = match[1].trim();
  return val.length >= 10 ? val : null;
}

function fmt(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}mi`;
  if (v >= 1000) return `${Math.round(v / 1000)}mil`;
  return String(v);
}

function buildLlmContext(facts) {
  const mood = facts.mood || 'medio';
  const t = facts.totals || {};
  const e = facts.economy || {};
  const p = facts.police || {};
  const c = facts.casino || {};
  const s = facts.society || {};

  const totLines = [];
  if (t.crimes) totLines.push(`${t.crimes} crime${t.crimes !== 1 ? 's' : ''}`);
  if (t.bets) totLines.push(`${t.bets} aposta${t.bets !== 1 ? 's' : ''}`);
  if (t.marriages) totLines.push(`${t.marriages} casamento${t.marriages !== 1 ? 's' : ''}`);
  if (t.divorces) totLines.push(`${t.divorces} divórcio${t.divorces !== 1 ? 's' : ''}`);
  if (t.achievements) totLines.push(`${t.achievements} conquista${t.achievements !== 1 ? 's' : ''}`);
  if (t.propertiesBought) totLines.push(`${t.propertiesBought} propriedade${t.propertiesBought !== 1 ? 's' : ''}`);
  const totals = totLines.length ? totLines.join(' · ') : 'atividade abaixo do normal';

  const destaques = [];
  if (p.assaultsCount > 0) {
    destaques.push(`${p.assaultsCount} assalto${p.assaultsCount !== 1 ? 's' : ''} (${fmt(p.assaultsTotal)}c)`);
  }
  if (p.biggestAssaultEvent?.payload?.amount) {
    destaques.push(`maior roubo: ${fmt(p.biggestAssaultEvent.payload.amount)}c`);
  }
  if (c.volume > 0) {
    const casaVenceu = c.lost > c.gained;
    destaques.push(`cassino: ${fmt(c.volume)}c (casa ${casaVenceu ? 'venceu' : 'perdeu'})`);
  }
  if (c.biggestCrashLossEvent?.payload?.amount) {
    destaques.push(`maior crash: ${fmt(c.biggestCrashLossEvent.payload.amount)}c`);
  }
  if (s.marriages > 0) {
    destaques.push(`${s.marriages} novo${s.marriages > 1 ? 's' : ''} casal${s.marriages > 1 ? 'is' : ''}`);
  }
  if (p.propertyRobs > 0) {
    destaques.push(`${p.propertyRobs} propriedade${p.propertyRobs !== 1 ? 's' : ''} invadida${p.propertyRobs !== 1 ? 's' : ''}`);
  }
  if (e.circulating > 0) {
    destaques.push(`${fmt(e.circulating)}c em circulação`);
  }
  const q = facts.quotes;
  if (q?.count > 0 && q.list[0]?.quote) {
    destaques.push(`frase do dia: "${q.list[0].quote}"`);
  }
  const destaquesStr = destaques.length ? destaques.join(' · ') : 'nada digno de nota';

  const recordes = (facts.memory || []).map((m) => m.text).join(' | ');

  const personalidade = facts.personality?.line || null;

  const events = buildEventsSummary(facts);

  return { mood, totals, destaques: destaquesStr, recordes: recordes || null, personalidade, events };
}

function buildEventsSummary(facts) {
  const lines = [];
  const b = facts.buckets || {};
  for (const [type, events] of Object.entries(b)) {
    for (const e of (events || []).slice(0, 3)) {
      const p = e.payload || {};
      const parts = [type];
      if (p.amount != null) parts.push(`${p.amount}c`);
      if (p.name) parts.push(p.name);
      if (p.target) parts.push(`→${p.target}`);
      if (p.deltaPct != null) parts.push(`${p.deltaPct}%`);
      lines.push(parts.join(' '));
    }
  }
  return lines.slice(0, 40).join('\n') || 'poucos eventos';
}
