/**
 * Live probe: Zen + dados reais do analytics.db (lore, stats, casamentos, cassino).
 * node fun/scripts/probe-live-real-data.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveFunConfig } from '../config.js';
import { createFlavorService } from '../llm/flavorService.js';
import { openaiChatComplete } from '../llm/openaiClient.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
const cfg = resolveFunConfig(raw);
const dataDir = cfg.dataDir || path.join(root, 'data', 'fun');
const analyticsPath = path.join(dataDir, 'analytics.db');

console.log('=== LIVE PROBE (dados reais analytics.db) ===');
console.log({
  zenBaseUrl: cfg.zenBaseUrl,
  zenModel: cfg.zenModel,
  analyticsPath,
  exists: fs.existsSync(analyticsPath),
});

try {
  const t0 = Date.now();
  const ping = await openaiChatComplete({
    baseUrl: cfg.zenBaseUrl,
    model: cfg.zenModel,
    system: 'Responda só a palavra ok',
    prompt: 'ping',
    timeoutMs: 45_000,
    maxTokens: 32,
    sendSamplingParams: false,
  });
  console.log('zen ping', Date.now() - t0 + 'ms', JSON.stringify(String(ping).slice(0, 80)));
} catch (e) {
  console.error('ZEN OFFLINE:', e.message);
  process.exit(1);
}

const db = new Database(analyticsPath, { readonly: true, fileMustExist: true });

const topScopes = db
  .prepare(
    `SELECT scope_key, COUNT(*) AS c FROM fun_group_memories
     GROUP BY scope_key ORDER BY c DESC LIMIT 8`
  )
  .all();
console.log('\n--- memory by scope ---');
console.log(topScopes);

const scopeKey = topScopes[0]?.scope_key || raw.groupWhitelistJids?.[0];
if (!scopeKey) {
  console.error('sem scope');
  process.exit(1);
}

const facts = db
  .prepare(
    `SELECT kind, summary, subjects_json, score, hits
     FROM fun_group_memories WHERE scope_key = ?
     ORDER BY score DESC, hits DESC, last_seen_at DESC LIMIT 40`
  )
  .all(scopeKey);

const persona = db
  .prepare(`SELECT persona_text, fact_count FROM fun_group_persona WHERE scope_key = ?`)
  .get(scopeKey);

const users = db
  .prepare(
    `SELECT user_jid, level, xp, coins, message_count
     FROM fun_user_stats WHERE scope_key = ?
     ORDER BY xp DESC LIMIT 15`
  )
  .all(scopeKey);

const profiles = db
  .prepare(
    `SELECT user_jid, nickname, bio, title, raw_note
     FROM fun_user_profiles WHERE scope_key = ? LIMIT 20`
  )
  .all(scopeKey);

// marriages may be bidirectional rows
const marriages = db
  .prepare(
    `SELECT user_jid, partner_jid FROM fun_marriages WHERE scope_key = ? LIMIT 12`
  )
  .all(scopeKey);

const casino = db
  .prepare(
    `SELECT user_jid, wagered, won, lost, games
     FROM fun_casino_stats WHERE scope_key = ?
     ORDER BY lost DESC LIMIT 10`
  )
  .all(scopeKey);

const nameMap = new Map();
for (const c of db.prepare(`SELECT jid, display_name FROM contact_profiles`).all()) {
  if (c.display_name) nameMap.set(c.jid, c.display_name);
}
for (const p of profiles) {
  if (p.nickname) nameMap.set(p.user_jid, p.nickname);
}

function nameOf(jid) {
  return nameMap.get(jid) || String(jid || '').split('@')[0]?.slice(-8) || '?';
}

function parseSubjects(rawJson) {
  try {
    const a = JSON.parse(rawJson || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** A = produção (limit 4 facts). B = mid 12. C = fat 24 + persona cheia + identidades. */
function buildLore({ limit, personaMax = 280, includeIdentity = false, includeCasino = false }) {
  const lines = [
    '<group_lore>',
    'Regras: use só se encaixar; NUNCA troque autor; se não encaixar IGNORE.',
  ];
  if (persona?.persona_text) {
    lines.push(
      '',
      `Clima: ${String(persona.persona_text).replace(/\n+/g, ' · ').slice(0, personaMax)}`
    );
  }
  if (facts.length) {
    lines.push('', 'Fatos:');
    for (const f of facts.slice(0, limit)) {
      const who = parseSubjects(f.subjects_json)
        .map(nameOf)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      lines.push(`- [${f.kind}] (Autor: ${who || '?'}): ${String(f.summary).slice(0, 180)}`);
    }
  }
  if (includeIdentity) {
    if (profiles.length) {
      lines.push('', 'Identidades:');
      for (const p of profiles.slice(0, 10)) {
        const bits = [
          nameOf(p.user_jid),
          p.bio ? `bio=${p.bio}` : null,
          p.title ? `title=${p.title}` : null,
          p.raw_note ? `nota=${String(p.raw_note).slice(0, 100)}` : null,
        ].filter(Boolean);
        lines.push(`- ${bits.join(' · ')}`);
      }
    }
    // also dump top users levels as soft context (no coin numbers for the model to echo)
    if (users.length) {
      lines.push('', 'Níveis (só tom):');
      for (const u of users.slice(0, 8)) {
        lines.push(`- ${nameOf(u.user_jid)} nível ~${u.level}`);
      }
    }
    const seen = new Set();
    const pairs = [];
    for (const m of marriages) {
      const a = nameOf(m.user_jid);
      const b = nameOf(m.partner_jid);
      const k = [a, b].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push(`${a} ⚭ ${b}`);
    }
    if (pairs.length) {
      lines.push('', 'Casamentos:', ...pairs.map((p) => `- ${p}`));
    }
  }
  if (includeCasino && casino.length) {
    lines.push('', 'Cassino (só tom — NÃO cite números de saldo/aposta no texto):');
    for (const c of casino.slice(0, 6)) {
      const net = Number(c.won) - Number(c.lost);
      lines.push(
        `- ${nameOf(c.user_jid)}: ${net >= 0 ? 'mais no azul que no vermelho' : 'sangrando no cassino'} (${c.games} jogos)`
      );
    }
  }
  lines.push('</group_lore>');
  return lines.join('\n');
}

console.log('\n--- chosen scope ---', {
  scopeKey,
  facts: facts.length,
  personaChars: persona?.persona_text?.length || 0,
  users: users.length,
  profiles: profiles.length,
  marriages: marriages.length,
  casino: casino.length,
});
console.log('\n--- top facts ---');
for (const f of facts.slice(0, 8)) {
  const who = parseSubjects(f.subjects_json).map(nameOf).join(', ');
  console.log(`  [${f.kind}] ${who}: ${f.summary}`);
}
if (persona?.persona_text) {
  console.log('\n--- persona ---\n' + persona.persona_text.slice(0, 400));
}

const topUser = users[0];
const topUserName = topUser ? nameOf(topUser.user_jid) : nameOf(parseSubjects(facts[0]?.subjects_json)[0]) || 'Fulano';
const shipA = users[0] ? nameOf(users[0].user_jid) : 'Eduardo';
const shipB = users[1] ? nameOf(users[1].user_jid) : nameMap.get('558293639334@s.whatsapp.net') || 'lucy';

// Pick a known-real person from facts if better
const factAuthor = parseSubjects(facts[0]?.subjects_json)[0];
const focusName = factAuthor ? nameOf(factAuthor) : topUserName;

const loreA = buildLore({ limit: 4, personaMax: 280 }); // ~prod level_up
const loreB = buildLore({ limit: 12, personaMax: 450 });
const loreC = buildLore({
  limit: 24,
  personaMax: 900,
  includeIdentity: true,
  includeCasino: true,
});

console.log('\n--- lore sizes ---', {
  A_prod4: loreA.length,
  B_mid12: loreB.length,
  C_fat24: loreC.length,
});

const flavor = createFlavorService({
  getConfig: () => cfg,
  allowLiveLlm: true,
});

const scenarios = [
  {
    key: 'level_up',
    varsBase: {
      level: topUser?.level || 7,
      user: focusName,
      scopeKey,
    },
  },
  {
    key: 'ship',
    varsBase: {
      a: shipA,
      b: shipB,
      percent: 73,
      label: 'Tá rolando algo',
      scopeKey,
    },
  },
  {
    key: 'roulette_win',
    varsBase: {
      user: focusName,
      pick: 'vermelho',
      ball: 19,
      scopeKey,
    },
  },
  {
    key: 'roast_personal',
    chaos: true,
    varsBase: {
      user: focusName,
      facts: [
        `Apelido/nome: ${focusName}`,
        `Nível ${topUser?.level || '?'}, coins no sistema (não invente valor no roast se não souber)`,
        casino.find((c) => nameOf(c.user_jid) === focusName)
          ? 'Tem histórico de cassino no grupo'
          : 'Sem grande marca no cassino',
        marriages.some((m) => nameOf(m.user_jid) === focusName || nameOf(m.partner_jid) === focusName)
          ? 'Casado(a) no bot'
          : 'Solteiro(a) no sistema',
      ].join('\n'),
      scopeKey,
    },
  },
  {
    key: 'cancel_absurd',
    chaos: true,
    varsBase: { user: focusName, scopeKey },
  },
  {
    key: 'gossip_fake',
    chaos: true,
    varsBase: { user: focusName, scopeKey },
  },
  {
    key: 'oracle_insane',
    chaos: true,
    varsBase: {
      question: `${focusName} vai parar de pagar mico essa semana?`,
      user: focusName,
      scopeKey,
    },
  },
];

const variants = [
  { name: 'A_prod4', lore: loreA },
  { name: 'B_mid12', lore: loreB },
  { name: 'C_fat24', lore: loreC },
];

console.log('\n=== A/B live Zen ===\n');
const results = [];

for (const sc of scenarios) {
  for (const cv of variants) {
    const vars = { ...sc.varsBase, groupLore: cv.lore };
    const t0 = Date.now();
    let text = '';
    try {
      text =
        sc.chaos && flavor.chaosLine
          ? await flavor.chaosLine(sc.key, vars)
          : await flavor.italicLine(sc.key, vars);
    } catch (e) {
      text = `ERR ${e.message}`;
    }
    const ms = Date.now() - t0;
    const provider = flavor.lastProvider?.() || '?';
    const meta = /aqui vai|como pediu|no tom que|as an AI|em português/i.test(String(text));
    const t = String(text);
    const usesFocus = t.toLowerCase().includes(String(focusName).toLowerCase().slice(0, 4));
    // lore specificity: any distinctive token from top facts
    const tokens = facts
      .slice(0, 15)
      .flatMap((f) =>
        String(f.summary || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 6)
      );
    const uniq = [...new Set(tokens)].slice(0, 40);
    const loreHits = uniq.filter((w) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(w)
    );

    const row = {
      scenario: sc.key,
      ctx: cv.name,
      provider,
      ms,
      len: t.length,
      meta,
      usesFocus,
      loreHits: loreHits.length,
      loreSample: loreHits.slice(0, 4),
      text: t.replace(/\n/g, ' ⏎ ').slice(0, 320),
    };
    results.push(row);
    console.log(
      `${meta ? '✗' : '✓'} ${sc.key.padEnd(16)} ${cv.name.padEnd(10)} ${String(provider).padEnd(8)} ${String(ms).padStart(5)}ms len=${row.len} focus=${usesFocus} loreTok=${row.loreHits}`
    );
    if (row.loreSample.length) console.log(`   lore→ ${row.loreSample.join(', ')}`);
    console.log(`   ${row.text}`);
    console.log('');
  }
}

// Assault with real name + mid lore
console.log('=== ASSAULT live ===');
{
  const t0 = Date.now();
  const out = await flavor.assaultStory('assault_shop_fail', {
    attacker: focusName,
    target: 'lojinha',
    weapon: 'faca',
    success: 'não',
    scopeKey,
    groupLore: loreB,
  });
  console.log(flavor.lastProvider?.(), Date.now() - t0 + 'ms');
  console.log(String(out || '').slice(0, 900));
}

console.log('\n=== SUMMARY ===');
for (const name of variants.map((v) => v.name)) {
  const rows = results.filter((r) => r.ctx === name);
  const n = rows.length || 1;
  console.log(name, {
    meta: rows.filter((r) => r.meta).length,
    focus: `${rows.filter((r) => r.usesFocus).length}/${rows.length}`,
    avgLoreTok: (rows.reduce((s, r) => s + r.loreHits, 0) / n).toFixed(2),
    avgMs: Math.round(rows.reduce((s, r) => s + r.ms, 0) / n),
    avgLen: Math.round(rows.reduce((s, r) => s + r.len, 0) / n),
    zenRate: `${rows.filter((r) => r.provider === 'zen').length}/${rows.length}`,
  });
}

// Side-by-side level_up for human read
console.log('\n=== SIDE-BY-SIDE level_up ===');
for (const r of results.filter((x) => x.scenario === 'level_up')) {
  console.log(`\n[${r.ctx}] (${r.provider})\n${r.text}`);
}

db.close();
console.log('\nDONE');
