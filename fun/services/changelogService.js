/**
 * Changelog admin — formata e dispara resumo de novidades nos grupos do bot.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { delay } from '../../utils/async.js';
import { getFunGroupWhitelistSet } from '../config.js';

const ANALYTICS = 'analytics';
const MAX_BODY = 3500;
const MAX_TITLE = 80;
const MAX_VERSION = 32;
const INTER_GROUP_GAP_MS = 1200;

function toText(v, fb = '') {
  const s = String(v ?? '').trim();
  return s || fb;
}

/**
 * Converte Markdown leve → marcação do WhatsApp e normaliza listas.
 * NÃO força bullet em toda linha — parágrafos e explicações longas ficam intactos.
 *
 * Suporta no corpo:
 * - **negrito** ou __negrito__ → *negrito*
 * - *itálico* (md) já conflita com WA; use _itálico_ ou toolbar
 * - ~~riscado~~ → ~riscado~
 * - `código` → ```código``` (inline vira monoespaçado WA)
 * - linhas `- item` ou `• item` → `• item`
 * - `*negrito*` no WhatsApp NÃO vira lista (asterisco sem espaço = formatação)
 * - `## Título` → *Título* (linha de seção)
 * - linhas em branco preservadas (máx. 2 seguidas)
 * - parágrafos normais NUNCA ganham bullet automático
 */
export function formatChangelogBody(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return '';

  // blocos ```code``` — protege antes de outras trocas
  const fences = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const i = fences.length;
    fences.push(String(code || '').replace(/^\n+|\n+$/g, ''));
    return `\u0000FENCE${i}\u0000`;
  });

  // **bold** / __bold__ → *bold* (WhatsApp)
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  text = text.replace(/__([^_\n]+)__/g, '*$1*');
  // ~~strike~~ → ~strike~
  text = text.replace(/~~([^~\n]+)~~/g, '~$1~');
  // `inline code` → monoespaçado WA (bloco curto)
  text = text.replace(/`([^`\n]+)`/g, '```$1```');

  const lines = text.split('\n');
  const out = [];
  let blankRun = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const core = trimmed.trim();
    if (!core) {
      blankRun += 1;
      if (blankRun <= 2) out.push('');
      continue;
    }
    blankRun = 0;

    // headings markdown → negrito WA
    const heading = core.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      out.push(`*${heading[1].trim()}*`);
      continue;
    }

    // Lista intencional: APENAS "- " ou "• " no começo.
    // NÃO usar "*" — no WhatsApp *texto* é negrito e o usuário escreve assim no editor.
    const bullet = core.match(/^[-•]\s+(.+)$/);
    if (bullet) {
      out.push(`• ${bullet[1].trim()}`);
      continue;
    }

    // lista numerada: mantém
    if (/^\d+[\).]\s+/.test(core)) {
      out.push(core);
      continue;
    }

    // parágrafo / negrito WA / explicação — SEM bullet automático
    out.push(core);
  }

  let body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // restaura fences
  body = body.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => {
    const code = fences[Number(i)] || '';
    return `\`\`\`${code}\`\`\``;
  });

  return body.slice(0, MAX_BODY);
}

/**
 * Monta a mensagem de zap a partir do input do admin.
 * @param {{ title?: string, version?: string, body?: string, lines?: string[] }} input
 */
export function formatChangelogMessage(input = {}) {
  const title = toText(input.title, 'Novidades do bot').slice(0, MAX_TITLE);
  const version = toText(input.version, '').slice(0, MAX_VERSION);
  let body = toText(input.body, '');
  if (!body && Array.isArray(input.lines)) {
    body = input.lines
      .map((l) => String(l || '').trim())
      .filter(Boolean)
      .join('\n');
  }
  body = formatChangelogBody(body);
  if (!body) return { ok: false, reason: 'empty-body', text: '' };

  const now = new Date();
  const dateLabel = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const headerBits = [version ? `v${version.replace(/^v/i, '')}` : null, dateLabel].filter(Boolean);

  const text = [
    '📢 *Atualização*',
    `*${title}*`,
    headerBits.length ? `_${headerBits.join(' · ')}_` : null,
    '',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n')
    .trim();

  if (text.length > 4000) {
    return { ok: false, reason: 'too-long', text: text.slice(0, 4000) };
  }

  return {
    ok: true,
    text,
    title,
    version: version.replace(/^v/i, ''),
    body,
  };
}

export function createChangelogService({
  getDatabase = getDb,
  getConfig = () => ({}),
  getSock = () => null,
  sendText = null,
  getContactDisplayName = () => '',
  getLogger = () => null,
  randomId = () => randomUUID(),
  sleep = delay,
} = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function resolveTargets(funConfig, requestedJids = null) {
    const whitelist = [...getFunGroupWhitelistSet(funConfig || {})].filter((j) =>
      String(j).endsWith('@g.us')
    );
    if (!requestedJids || !Array.isArray(requestedJids) || !requestedJids.length) {
      return whitelist;
    }
    const want = new Set(
      requestedJids
        .map((j) => String(j || '').trim())
        .filter((j) => j.endsWith('@g.us'))
    );
    // só grupos na whitelist (segurança)
    return whitelist.filter((j) => want.has(j));
  }

  function insertLog(row) {
    ensureSchema();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS}.fun_changelog_broadcasts
         (id, title, version, body, message_text, target_count, ok_count, fail_count, dry_run, results_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.title,
        row.version,
        row.body,
        row.messageText,
        row.targetCount,
        row.okCount,
        row.failCount,
        row.dryRun ? 1 : 0,
        JSON.stringify(row.results || []),
        row.createdAt
      );
  }

  function listHistory({ limit = 20 } = {}) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS}.fun_changelog_broadcasts
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(100, Number(limit) || 20)));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      version: r.version,
      body: r.body,
      messageText: r.message_text,
      targetCount: Number(r.target_count) || 0,
      okCount: Number(r.ok_count) || 0,
      failCount: Number(r.fail_count) || 0,
      dryRun: Boolean(r.dry_run),
      results: (() => {
        try {
          return JSON.parse(r.results_json || '[]');
        } catch {
          return [];
        }
      })(),
      createdAt: Number(r.created_at) || 0,
    }));
  }

  /**
   * @param {{
   *   title?: string,
   *   version?: string,
   *   body?: string,
   *   lines?: string[],
   *   groupJids?: string[],
   *   dryRun?: boolean,
   *   funConfig?: object,
   *   sock?: any,
   *   sendText?: function,
   * }} opts
   */
  async function broadcast(opts = {}) {
    const funConfig = opts.funConfig || getConfig() || {};
    const formatted = formatChangelogMessage(opts);
    if (!formatted.ok) {
      return { ok: false, reason: formatted.reason, text: formatted.text || '' };
    }

    const targets = resolveTargets(funConfig, opts.groupJids);
    if (!targets.length) {
      return {
        ok: false,
        reason: 'no-groups',
        text: formatted.text,
        targets: [],
      };
    }

    const dryRun = opts.dryRun === true;
    const sock = opts.sock || getSock?.();
    const post = opts.sendText || sendText;

    if (!dryRun && (!sock || typeof post !== 'function')) {
      return {
        ok: false,
        reason: 'whatsapp-offline',
        text: formatted.text,
        targets,
        preview: targets.map((jid) => ({
          jid,
          name: getContactDisplayName(jid) || '',
        })),
      };
    }

    const results = [];
    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i += 1) {
      const jid = targets[i];
      const name = getContactDisplayName(jid) || '';
      if (dryRun) {
        results.push({ jid, name, ok: true, dryRun: true });
        okCount += 1;
        continue;
      }
      try {
        await post(sock, jid, formatted.text);
        results.push({ jid, name, ok: true });
        okCount += 1;
      } catch (err) {
        failCount += 1;
        results.push({
          jid,
          name,
          ok: false,
          reason: err?.message || 'send-failed',
        });
        getLogger?.()?.warn?.(
          { jid, err: String(err?.message || err) },
          'fun changelog send failed'
        );
      }
      // espaça entre grupos (rate limit outbound)
      if (i < targets.length - 1) {
        await sleep(INTER_GROUP_GAP_MS);
      }
    }

    const id = randomId();
    const createdAt = Date.now();
    try {
      insertLog({
        id,
        title: formatted.title,
        version: formatted.version,
        body: formatted.body,
        messageText: formatted.text,
        targetCount: targets.length,
        okCount,
        failCount,
        dryRun,
        results,
        createdAt,
      });
    } catch (err) {
      getLogger?.()?.warn?.(
        { err: String(err?.message || err) },
        'fun changelog log insert failed'
      );
    }

    return {
      ok: failCount === 0,
      id,
      dryRun,
      text: formatted.text,
      title: formatted.title,
      version: formatted.version,
      targetCount: targets.length,
      okCount,
      failCount,
      results,
      createdAt,
    };
  }

  return {
    formatChangelogMessage,
    formatChangelogBody,
    resolveTargets,
    broadcast,
    listHistory,
  };
}
