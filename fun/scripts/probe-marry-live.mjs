/**
 * Live: marry_propose / marry_accept / marry_mutual com lore real do analytics.db
 * node fun/scripts/probe-marry-live.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveFunConfig } from '../config.js';
import { createFlavorService } from '../llm/flavorService.js';
import { withGroupLore } from '../utils/flavorLore.js';
import { openaiChatComplete } from '../llm/openaiClient.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
const cfg = resolveFunConfig(raw);
const analyticsPath = path.join(cfg.dataDir || path.join(root, 'data', 'fun'), 'analytics.db');

console.log('=== MARRY LIVE PROBE ===', {
  model: cfg.zenModel,
  base: cfg.zenBaseUrl,
  db: analyticsPath,
});

try {
  const t0 = Date.now();
  const p = await openaiChatComplete({
    baseUrl: cfg.zenBaseUrl,
    model: cfg.zenModel,
    system: 'Responda só: ok',
    prompt: 'ping',
    timeoutMs: 30_000,
    maxTokens: 16,
    sendSamplingParams: false,
  });
  console.log('zen ping', Date.now() - t0 + 'ms', JSON.stringify(String(p).slice(0, 40)));
} catch (e) {
  console.error('ZEN OFFLINE', e.message);
  process.exit(1);
}

const db = new Database(analyticsPath, { readonly: true });

// Prefer scope with marriages + memory
const scopes = db
  .prepare(
    `SELECT m.scope_key,
            (SELECT COUNT(*) FROM fun_group_memories g WHERE g.scope_key = m.scope_key) AS facts,
            COUNT(*) AS marriage_rows
     FROM fun_marriages m
     GROUP BY m.scope_key
     ORDER BY facts DESC, marriage_rows DESC
     LIMIT 5`
  )
  .all();
console.log('scopes', scopes);

const scopeKey =
  scopes.find((s) => s.facts > 0)?.scope_key ||
  db
    .prepare(
      `SELECT scope_key, COUNT(*) c FROM fun_group_memories GROUP BY scope_key ORDER BY c DESC LIMIT 1`
    )
    .get()?.scope_key ||
  raw.groupWhitelistJids?.[0];

const nameMap = new Map();
for (const c of db.prepare(`SELECT jid, display_name FROM contact_profiles`).all()) {
  if (c.display_name) nameMap.set(c.jid, c.display_name);
}
for (const p of db
  .prepare(`SELECT user_jid, nickname FROM fun_user_profiles WHERE nickname != ''`)
  .all()) {
  if (p.nickname) nameMap.set(p.user_jid, p.nickname);
}

function nameOf(jid) {
  return nameMap.get(jid) || String(jid || '').split('@')[0]?.slice(-10) || '?';
}

const marriages = db
  .prepare(`SELECT user_jid, partner_jid FROM fun_marriages WHERE scope_key = ? LIMIT 20`)
  .all(scopeKey);

const seen = new Set();
const pairs = [];
for (const m of marriages) {
  const k = [m.user_jid, m.partner_jid].sort().join('|');
  if (seen.has(k)) continue;
  seen.add(k);
  pairs.push([m.user_jid, m.partner_jid]);
}

// Pick couple from real marriage, or top stats users
let aJid = pairs[0]?.[0];
let bJid = pairs[0]?.[1];
if (!aJid || !bJid) {
  const top = db
    .prepare(
      `SELECT user_jid FROM fun_user_stats WHERE scope_key = ? ORDER BY xp DESC LIMIT 2`
    )
    .all(scopeKey);
  aJid = top[0]?.user_jid;
  bJid = top[1]?.user_jid;
}

// Fallback any two named contacts
if (!aJid || !bJid) {
  const names = [...nameMap.keys()].slice(0, 2);
  aJid = names[0];
  bJid = names[1];
}

const me = nameOf(aJid);
const other = nameOf(bJid);
console.log({ scopeKey, me, other, aJid, bJid, pairs: pairs.length });

// Build lore like production (groupMemoryService shape)
const facts = db
  .prepare(
    `SELECT kind, summary, subjects_json, score, hits
     FROM fun_group_memories WHERE scope_key = ?
     ORDER BY score DESC, hits DESC LIMIT 24`
  )
  .all(scopeKey);

const persona = db
  .prepare(`SELECT persona_text FROM fun_group_persona WHERE scope_key = ?`)
  .get(scopeKey);

function parseSubjects(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function buildLore(userJids, limit = 8) {
  const want = new Set(userJids.map(String));
  const scored = facts
    .map((f) => {
      let boost = 0;
      for (const s of parseSubjects(f.subjects_json)) {
        if (want.has(s)) boost += 25;
      }
      return { f, rank: Number(f.score) + boost + Math.min(20, Number(f.hits) || 0) };
    })
    .sort((x, y) => y.rank - x.rank)
    .slice(0, limit);

  const lines = [
    '<group_lore>',
    'Regras: use só se encaixar; NUNCA troque autor; se não encaixar IGNORE.',
  ];
  if (persona?.persona_text) {
    lines.push('', `Clima: ${String(persona.persona_text).replace(/\n+/g, ' · ').slice(0, 450)}`);
  }
  if (scored.length) {
    lines.push('', 'Fatos:');
    for (const { f } of scored) {
      const who = parseSubjects(f.subjects_json).map(nameOf).filter(Boolean).slice(0, 3).join(', ');
      lines.push(`- [${f.kind}] (Autor: ${who || '?'}): ${f.summary}`);
    }
  }
  lines.push('</group_lore>');
  return lines.join('\n');
}

const lore = buildLore([aJid, bJid], 8);
console.log('\n--- lore (%d chars) ---\n%s\n', lore.length, lore.slice(0, 900));

const flavor = createFlavorService({
  getConfig: () => cfg,
  allowLiveLlm: true,
});

const scenarios = [
  {
    key: 'marry_propose',
    vars: { me, other },
  },
  {
    key: 'marry_accept',
    vars: { a: me, b: other },
  },
  {
    key: 'marry_mutual',
    vars: { a: me, b: other },
  },
];

// A/B: sem lore vs com lore (path de produção)
console.log('\n=== COMPARE no-lore vs with-lore ===\n');

for (const sc of scenarios) {
  for (const mode of ['no_lore', 'with_lore']) {
    const vars =
      mode === 'with_lore'
        ? withGroupLore(sc.vars, {
            scopeKey,
            // inject prebuilt lore (same shape as buildLoreContext)
          })
        : { ...sc.vars, scopeKey };
    if (mode === 'with_lore') vars.groupLore = lore;

    const t0 = Date.now();
    let text = '';
    try {
      text = await flavor.italicLine(sc.key, vars);
    } catch (e) {
      text = `ERR ${e.message}`;
    }
    const ms = Date.now() - t0;
    const provider = flavor.lastProvider?.() || '?';
    const t = String(text || '');
    const meta = /aqui vai|como pediu|as an AI/i.test(t);
    const nameHit =
      t.toLowerCase().includes(me.toLowerCase().slice(0, 4)) ||
      t.toLowerCase().includes(other.toLowerCase().slice(0, 4));
    const loreToks = facts
      .slice(0, 12)
      .flatMap((f) =>
        String(f.summary || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 6)
      );
    const uniq = [...new Set(loreToks)].slice(0, 30);
    const loreHits = uniq.filter((w) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(w)
    );

    console.log(
      `${meta ? '✗' : '✓'} ${sc.key.padEnd(14)} ${mode.padEnd(10)} ${String(provider).padEnd(8)} ${String(ms).padStart(5)}ms names=${nameHit} loreTok=${loreHits.length}`
    );
    if (loreHits.length) console.log(`   lore→ ${loreHits.slice(0, 5).join(', ')}`);
    console.log(`   ${t.replace(/\n/g, ' ⏎ ').slice(0, 360)}`);
    console.log('');
  }
}

// 3 samples propose with lore (variance)
console.log('=== marry_propose ×3 (variance + lore) ===\n');
for (let i = 0; i < 3; i += 1) {
  const t0 = Date.now();
  const text = await flavor.italicLine('marry_propose', {
    me,
    other,
    scopeKey,
    groupLore: lore,
  });
  console.log(
    `#${i + 1}`,
    flavor.lastProvider?.(),
    Date.now() - t0 + 'ms',
    '\n ',
    String(text).replace(/\n/g, ' ⏎ ').slice(0, 280),
    '\n'
  );
}

db.close();
console.log('DONE');
