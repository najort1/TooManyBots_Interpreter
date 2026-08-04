/**
 * Testes do painel LLM (contadores por tarefa/provider, alertas).
 * FR-017 · US4 · in-memory · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLlmPanel } from '../fun/tui/panels/llmPanel.js';

function fakeSnapshot(overrides = {}) {
  return {
    llm: {
      byTask: {
        invent: { zen: 7, template: 3, ollama: 2 },
        flavor: { template: 1 },
      },
      invent: { zen: 7, ollama: 2, template: 3, total: 12, zenRate: 7 / 12, templateRate: 3 / 12 },
      alert: null,
      lastByTask: {
        invent: { provider: 'zen', at: 1700000000000, task: 'invent' },
        flavor: { provider: 'template', at: 1700000010000, task: 'flavor' },
      },
    },
    ...overrides,
  };
}

test('renderLlmPanel: contadores por tarefa e provider exibidos', () => {
  const snap = fakeSnapshot();
  const joined = renderLlmPanel(snap, { width: 90, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('invent'), 'task invent deve aparecer');
  assert.ok(joined.includes('zen'));
  assert.ok(joined.includes('template'));
  assert.ok(joined.includes('7'), 'count zen=7');
  assert.ok(joined.includes('3'), 'count template=3');
  assert.ok(joined.includes('2'), 'count ollama=2');
});

test('renderLlmPanel: invent total e taxa zen exibidos', () => {
  const snap = fakeSnapshot();
  const joined = renderLlmPanel(snap, { width: 90, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('12'), 'total=12 deve aparecer');
  // taxa zen = 7/12 ≈ 58% — verificar exibição de %
  assert.ok(joined.includes('58') || joined.includes('%'), `deve mostrar taxa zen%: ${joined}`);
});

test('renderLlmPanel: alerta invent template alto destacado em vermelho (allow=true)', () => {
  const snap = fakeSnapshot({
    llm: {
      byTask: { invent: { zen: 2, template: 8 } },
      invent: { zen: 2, ollama: 0, template: 8, total: 10, zenRate: 0.2, templateRate: 0.8 },
      alert: { templateRate: 0.8, message: 'invent templateRate=80%' },
      lastByTask: {},
    },
  });
  const joined = renderLlmPanel(snap, { width: 90, height: 20, allow: true }).join('\n');
  // Alerta — vermelho é código 31 ou 91 (bright)
  assert.ok(joined.includes('\u001b[31m') || joined.includes('\u001b[91m'), 'alerta deve estar em vermelho');
  assert.ok(joined.includes('80%') || joined.includes('0.8') || joined.toLowerCase().includes('alerta'));
});

test('renderLlmPanel: sem alerta não mostra trecho vermelho de alerta', () => {
  const snap = fakeSnapshot();
  const joined = renderLlmPanel(snap, { width: 90, height: 20, allow: true }).join('\n');
  assert.ok(!/alerta\s*\b/i.test(joined) || !joined.toLowerCase().includes('alerta'),
    'sem alerta não deve renderizar mensagem de alerta');
});

test('renderLlmPanel: estado vazio (sem chamadas) não trava', () => {
  const snap = { llm: { byTask: {}, invent: { total: 0, zen: 0, template: 0, ollama: 0, zenRate: 0, templateRate: 0 }, alert: null, lastByTask: {} } };
  const lines = renderLlmPanel(snap, { width: 80, height: 8, allow: false });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  const joined = lines.join('\n');
  assert.ok(joined.includes('0') || joined.toLowerCase().includes('sem') || joined.includes('—'));
});

test('renderLlmPanel: limita linhas pela altura', () => {
  const snap = fakeSnapshot({
    llm: {
      byTask: {
        invent: { zen: 1, template: 1, ollama: 1 },
        flavor: { template: 1 },
        news: { zen: 2 },
        profile: { template: 3 },
        bazaar: { zen: 1 },
      },
      invent: { total: 3, zen: 1, template: 1, ollama: 1, zenRate: 1/3, templateRate: 1/3 },
      alert: null, lastByTask: {},
    },
  });
  const lines = renderLlmPanel(snap, { width: 80, height: 4, allow: false });
  assert.ok(lines.length <= 8, `height=4 não deve renderizar ${lines.length} linhas`);
});
