/**
 * Testes do painel de economia (último economy-tick + totais).
 * FR-017 · US3 · in-memory · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEconomyPanel } from '../fun/tui/panels/economyPanel.js';

/** Simula um snapshot com as últimas entradas de economy-tick no histórico. */
function makeSnapshotWithEconHistory(entries) {
  const history = entries.map((e, i) => ({
    ts: 1700000000000 + i * 60_000,
    category: 'economy',
    level: e.ok === false ? 'warn' : 'ok',
    kind: 'economy-tick',
    scope: e.scope || 'Zoeira',
    ok: e.ok !== false,
    detail: {
      changed: e.changed || 0,
      stockChanged: e.stockChanged || 0,
      scheduledApplied: e.scheduledApplied || 0,
      reason: e.reason || null,
      nextInMs: e.nextInMs || null,
    },
  }));
  return {
    history,
    counters: {
      byCategory: new Map([['economy', entries.length]]),
      byKind: new Map([['economy-tick', entries.length]]),
    },
    config: { economyEnabled: true, propertiesEnabled: true, whitelistCount: 1, worldAutonomous: true },
  };
}

test('renderEconomyPanel: sem entradas mostra estado limpo', () => {
  const snap = { history: [], counters: { byCategory: new Map(), byKind: new Map() }, config: { economyEnabled: true } };
  const lines = renderEconomyPanel(snap, { width: 80, height: 12, allow: false });
  const joined = lines.join('\n');
  assert.ok(lines.length > 0);
  assert.ok(joined.toLowerCase().includes('economia') || joined.includes('—'));
});

test('renderEconomyPanel: mostra último tick com changed/stockChanged/scheduledApplied', () => {
  const snap = makeSnapshotWithEconHistory([
    { changed: 4, stockChanged: 2, scheduledApplied: 1, ok: true, scope: 'Zoeira Geral' },
    { changed: 0, stockChanged: 0, scheduledApplied: 0, ok: true, scope: 'Bot Crew' },
  ]);
  const joined = renderEconomyPanel(snap, { width: 90, height: 12, allow: false }).join('\n');
  // Entradas estão em ordem — a primeira do array é a mais recente
  assert.ok(joined.includes('4'), 'changed=4 deve aparecer (mais recente)');
  assert.ok(joined.includes('2'), 'stockChanged=2 deve aparecer');
  assert.ok(joined.includes('1'), 'scheduledApplied=1 deve aparecer');
  assert.ok(joined.includes('Zoeira Geral'));
});

test('renderEconomyPanel: total acumulado (counters.byKind[economy-tick]) aparece', () => {
  const snap = makeSnapshotWithEconHistory([
    { ok: true }, { ok: true }, { ok: true },
  ]);
  const joined = renderEconomyPanel(snap, { width: 90, height: 12, allow: false }).join('\n');
  assert.ok(joined.includes('3'), 'total economy-tick deve acumular em 3');
});

test('renderEconomyPanel: tick com reason "too-soon" exibe o motivo', () => {
  const snap = makeSnapshotWithEconHistory([
    { ok: false, reason: 'too-soon', nextInMs: 540_000 },
  ]);
  const joined = renderEconomyPanel(snap, { width: 90, height: 12, allow: false }).join('\n');
  assert.ok(joined.toLowerCase().includes('too-soon'), `deve mostrar reason too-soon: ${joined}`);
});

test('renderEconomyPanel: tick com ok=true é verde (ANSI) só quando allow=true', () => {
  const snap = makeSnapshotWithEconHistory([
    { ok: true, changed: 1 },
  ]);
  const noAnsi = renderEconomyPanel(snap, { width: 80, height: 8, allow: false }).join('\n');
  const withAnsi = renderEconomyPanel(snap, { width: 80, height: 8, allow: true }).join('\n');
  assert.ok(!noAnsi.includes('\u001b['), 'allow=false não emite ANSI');
  assert.ok(withAnsi.includes('\u001b['), 'allow=true emite ANSI');
});

test('renderEconomyPanel: limita linhas pela altura', () => {
  const snap = makeSnapshotWithEconHistory(Array.from({ length: 20 }, () => ({ ok: true, changed: 1 })));
  const lines = renderEconomyPanel(snap, { width: 80, height: 4, allow: false });
  assert.ok(lines.length <= 8, `height=4 não deve renderizar ${lines.length} linhas`);
});

test('renderEconomyPanel: economy desativada mostra mensagem clara', () => {
  const snap = { history: [], counters: { byCategory: new Map(), byKind: new Map() }, config: { economyEnabled: false } };
  const joined = renderEconomyPanel(snap, { width: 80, height: 8, allow: false }).join('\n');
  assert.ok(joined.toLowerCase().includes('off') || joined.toLowerCase().includes('desligado') || joined.includes('—'),
    `economy desativada deve indicar: ${joined}`);
});
