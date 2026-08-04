/**
 * Testes do painel de grupos (membros + top comandos).
 * FR-017 · US5 · in-memory · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderGroupsPanel } from '../fun/tui/panels/groupsPanel.js';

function fakeSnapshot(overrides = {}) {
  return {
    groups: [
      {
        jid: '12345@g.us', name: 'Zoeira Geral', memberCount: 42,
        topPlayers: [{ name: 'Ana', xp: 1200, coins: 80 }, { name: 'Bob', xp: 900, coins: 60 }],
        topCommands: [{ command: 'rank', count: 30 }, { command: 'cf', count: 15 }, { command: 'loja', count: 8 }],
      },
      {
        jid: '67890@g.us', name: 'Bot Crew', memberCount: 7,
        topPlayers: [{ name: 'Zé', xp: 500, coins: 20 }],
        topCommands: [{ command: 'tarot', count: 12 }],
      },
    ],
    config: { whitelistCount: 2, worldAutonomous: true, economyEnabled: true, propertiesEnabled: true },
    ...overrides,
  };
}

test('renderGroupsPanel: lista nomes de grupos e membros', () => {
  const snap = fakeSnapshot();
  const joined = renderGroupsPanel(snap, { width: 90, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('Zoeira Geral'));
  assert.ok(joined.includes('Bot Crew'));
  assert.ok(joined.includes('42'), 'membros 42');
  assert.ok(joined.includes('7'), 'membros 7');
});

test('renderGroupsPanel: top comandos por grupo aparecem', () => {
  const snap = fakeSnapshot();
  const joined = renderGroupsPanel(snap, { width: 90, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('rank'), 'cmd rank');
  assert.ok(joined.includes('30'), 'count 30');
  assert.ok(joined.includes('cf'));
  assert.ok(joined.includes('tarot'));
});

test('renderGroupsPanel: top players por grupo aparecem (nome/XP/coins)', () => {
  const snap = fakeSnapshot();
  const joined = renderGroupsPanel(snap, { width: 90, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('Ana'));
  assert.ok(joined.includes('1200'), 'xp ana 1200');
  assert.ok(joined.includes('Zé'));
});

test('renderGroupsPanel: sem grupos mostra estado vazio amigável', () => {
  const snap = { groups: [], config: { whitelistCount: 0 } };
  const joined = renderGroupsPanel(snap, { width: 80, height: 6, allow: false }).join('\n');
  assert.ok(joined.toLowerCase().includes('sem') || joined.includes('—') || joined.toLowerCase().includes('vazio'));
});

test('renderGroupsPanel: limita linhas pela altura', () => {
  const snap = fakeSnapshot();
  const lines = renderGroupsPanel(snap, { width: 80, height: 4, allow: false });
  assert.ok(lines.length <= 8, `height=4 não deve renderizar ${lines.length} linhas`);
});

test('renderGroupsPanel: JID truncado quando exibido (sem JID completo)', () => {
  const snap = {
    groups: [{
      jid: '120363abcABCDEFGHIJKLMNOPQRSTUV1234567890@g.us',
      name: 'Grupo Sem Nome Magico',
      memberCount: 5,
      topPlayers: [],
      topCommands: [],
    }],
    config: { whitelistCount: 1 },
  };
  const joined = renderGroupsPanel(snap, { width: 80, height: 12, allow: false }).join('\n');
  assert.ok(!joined.includes('abcABCDEFGHIJKLMNOPQRSTUV1234567890'), 'JID completo não deve aparecer');
});

test('renderGroupsPanel: cores ANSI só quando allow=true', () => {
  const snap = fakeSnapshot();
  const noAnsi = renderGroupsPanel(snap, { width: 90, height: 12, allow: false }).join('\n');
  const withAnsi = renderGroupsPanel(snap, { width: 90, height: 12, allow: true }).join('\n');
  assert.ok(!noAnsi.includes('\u001b['), 'allow=false não emite ANSI');
  assert.ok(withAnsi.includes('\u001b['), 'allow=true emite ANSI');
});
