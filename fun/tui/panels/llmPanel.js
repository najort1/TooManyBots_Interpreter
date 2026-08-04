/**
 * Painel LLM — contadores por tarefa/provider, taxa invent (zen vs template),
 * alerta de templateRate alto e últimos eventos por tarefa.
 *
 * Contrato: contracts/audit-events.md §3 (panel 'llm')
 */

import { paint, FG, STYLE, truncate, repeat } from '../ansi.js';

const HEADER_TITLE = 'LLM — Provedores & Latência';

/**
 * @param {object} snapshot
 * @param {object} opts { width, height, scrollOffset, allow }
 */
export function renderLlmPanel(snapshot = {}, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : false;
  const width = Math.max(20, Math.floor(Number(opts.width) || 80));
  const height = Math.max(2, Math.floor(Number(opts.height) || 10));

  const llm = snapshot.llm || {};
  const byTask = llm.byTask || {};
  const invent = llm.invent || {};
  const alert = llm.alert;
  const lastByTask = llm.lastByTask || {};

  const out = [];
  out.push(paint(STYLE.bold, HEADER_TITLE, { allow }));
  out.push(repeat('─', width));

  // Alerta
  if (alert && (alert.templateRate || alert.message)) {
    const pct = alert.templateRate != null
      ? Math.round(alert.templateRate * 100)
      : null;
    const txt = pct != null
      ? `⚠ templateRate alta: ${pct}%`
      : `⚠ ${String(alert.message || 'alerta LLM')}`;
    out.push(paint(FG.brightRed, truncate(txt, width), { allow }));
  }

  // Linha invent
  const total = Number(invent.total) || 0;
  const zen = Number(invent.zen) || 0;
  const ollama = Number(invent.ollama) || 0;
  const template = Number(invent.template) || 0;
  if (total > 0) {
    const zenPct = Math.round((invent.zenRate || 0) * 100);
    const tmplPct = Math.round((invent.templateRate || 0) * 100);
    const line = `invent total ${total}: ${paint(FG.green, `zen ${zen} (${zenPct}%)`, { allow })} · ${paint(FG.gray, `ollama ${ollama}`, { allow })} · ${templatePctColor(tmplPct, allow)} template ${template} (${tmplPct}%)`;
    out.push(truncate(line, width));
  } else {
    out.push(paint(FG.gray, '— sem chamadas LLM registradas —', { allow }));
  }

  // Por tarefa
  const tasks = Object.keys(byTask);
  if (tasks.length > 0) {
    out.push('');
    out.push(paint(STYLE.bold, 'Por tarefa:', { allow }));
    const limit = Math.max(1, height - 6);
    const slice = tasks.slice(0, limit);
    for (const task of slice) {
      const cs = byTask[task] || {};
      const parts = Object.entries(cs).map(([prov, n]) => `${prov} ${n}`);
      const last = lastByTask[task];
      const lastProv = last?.provider ? ` · _últ ${truncate(String(last.provider), 10)}` : '';
      out.push(truncate(`- ${truncate(task, 16)}: ${parts.join(', ')}${lastProv}`, width));
    }
    if (tasks.length > limit) {
      out.push(paint(FG.gray, `… +${tasks.length - limit} tarefa(s)`, { allow }));
    }
  }

  // Limita pela altura
  const maxLines = Math.max(2, height);
  if (out.length > maxLines) return out.slice(0, maxLines);
  return out;
}

function templatePctColor(pct, allow) {
  if (pct >= 40) return paint(FG.brightRed, '⚠', { allow });
  if (pct >= 20) return paint(FG.yellow, '▲', { allow });
  return paint(FG.green, '✓', { allow });
}
