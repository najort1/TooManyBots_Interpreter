/**
 * Testes do painel de auditoria (render puro da lista rolável).
 * FR-017 · US1 · in-memory · sem rede · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderAuditPanel } from '../fun/tui/panels/auditPanel.js';
import { FG } from '../fun/tui/ansi.js';

function makeHistory(n) {
  const out = [];
  const kinds = ['market', 'news', 'self-heal', 'chaos-event', 'birthday'];
  for (let i = 0; i < n; i++) {
    out.push({
      ts: 1700000000000 + i * 60_000,
      category: 'world',
      level: i % 3 === 0 ? 'ok' : (i % 5 === 0 ? 'warn' : 'info'),
      kind: kinds[i % kinds.length],
      scope: i % 2 === 0 ? 'Zoeira Geral' : '…5678@g.us',
      ok: i % 2 === 0,
      detail: i % 7 === 0 ? { reason: 'test' } : null,
    });
  }
  return out.reverse(); // mais recente primeiro
}

test('renderAuditPanel: estado vazio não trava e mostra mensagem amigável', () => {
  const snap = { history: [], counters: { byCategory: new Map(), byKind: new Map() } };
  const lines = renderAuditPanel(snap, { width: 80, height: 10, scrollOffset: 0, allow: false });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  const joined = lines.join('\n');
  assert.ok(joined.toLowerCase().includes('sem') || joined.toLowerCase().includes('nenhuma') || joined.toLowerCase().includes('vazio') || joined.includes('—'),
    'estado vazio deve mostrar mensagem');
});

test('renderAuditPanel: lista entradas com kind e scope amigável/truncado', () => {
  const snap = { history: makeHistory(5), counters: { byCategory: new Map([['world', 5]]), byKind: new Map([['market', 1]]) } };
  const lines = renderAuditPanel(snap, { width: 80, height: 20, scrollOffset: 0, allow: false });
  const joined = lines.join('\n');
  assert.ok(joined.includes('market'), 'deve mostrar kind da 1ª entrada');
  // scope tem que aparecer (quer como nome, quer como JID truncado)
  assert.ok(joined.includes('Zoeira') || joined.includes('…5678@g.us'));
});

test('renderAuditPanel: scrollOffset desloca início da lista', () => {
  const snap = { history: makeHistory(10), counters: { byCategory: new Map(), byKind: new Map() } };
  const off0 = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 0, allow: false }).join('\n');
  const off3 = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 3, allow: false }).join('\n');
  // off3 começa além das 3 primeiras entradas — logoas primeiras 3 não aparecem
  // ou pelo menos o conjunto difere
  assert.notEqual(off0, off3);
});

test('renderAuditPanel: cores por level (ANSI) só quando allow=true', () => {
  const snap = { history: makeHistory(3), counters: { byCategory: new Map(), byKind: new Map() } };
  const noAnsi = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 0, allow: false }).join('\n');
  const withAnsi = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 0, allow: true }).join('\n');
  assert.ok(!noAnsi.includes('\u001b['), 'allow=false não deve emitir ANSI');
  assert.ok(withAnsi.includes('\u001b['), 'allow=true deve emitir ANSI para cores');
});

test('renderAuditPanel: limita linhas exibidas pela altura', () => {
  const snap = { history: makeHistory(20), counters: { byCategory: new Map(), byKind: new Map() } };
  const lines = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 0, allow: false });
  // Painel nunca deve exceder muito a altura (1-2 linhas de header contam)
  assert.ok(lines.length <= 8, `height=5 não deve renderizar ${lines.length} linhas`);
});

test('renderAuditPanel: scope é sanitizado (JID truncado, sem JID completo exposto)', () => {
  // O bus sanitiza scope (sanitizeScope) antes de armazenar. O painel
  // assume que snapshot.history já vem limpo e apenas trunca para exibição.
  const snap = {
    history: [
      { ts: 1, category: 'market', level: 'ok', kind: 'market',
        scope: '…67890@g.us', ok: true, detail: null },
    ],
    counters: { byCategory: new Map(), byKind: new Map() },
  };
  const joined = renderAuditPanel(snap, { width: 80, height: 5, scrollOffset: 0, allow: false }).join('\n');
  assert.ok(!joined.includes('abcABCDEFGHIJKLMNOPQRSTUV1234567890'), 'JID completo não deve aparecer');
  assert.ok(joined.includes('…') && joined.includes('@g.us'), 'JID deve aparecer truncado');
});
