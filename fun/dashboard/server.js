/**
 * Dashboard HTTP mínimo do bot Fun (isolado do TMB).
 * Endpoints + UI simples para leaderboard e settings por grupo.
 */

import http from 'http';
import { URL } from 'url';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function buildUiHtml({ host, port }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fun Bot · Dashboard</title>
  <style>
    :root {
      --bg: #fafafa; --surface: #fff; --border: #e4e4e7;
      --text: #18181b; --muted: #71717a; --ink: #09090b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: Inter, system-ui, sans-serif;
      background: var(--bg); color: var(--text);
      line-height: 1.45;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      padding: 1rem 1.5rem;
    }
    header h1 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    header p { margin: 0.25rem 0 0; color: var(--muted); font-size: 0.875rem; }
    main { max-width: 920px; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.25rem; }
    section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.1rem;
    }
    h2 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 600; }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 0.25rem; }
    input, select, button {
      font: inherit; border-radius: 6px; border: 1px solid var(--border);
      padding: 0.45rem 0.6rem;
    }
    input, select { width: 100%; background: #fff; color: var(--text); }
    button {
      background: var(--ink); color: #fafafa; border: none;
      cursor: pointer; font-weight: 500; padding: 0.5rem 0.9rem;
    }
    button.secondary { background: #f4f4f5; color: var(--text); border: 1px solid var(--border); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 0.45rem 0.35rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 0.75rem; }
    .muted { color: var(--muted); font-size: 0.8rem; }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.85rem; }
    .toast { font-size: 0.85rem; color: var(--muted); min-height: 1.2em; }
  </style>
</head>
<body>
  <header>
    <h1>Fun Bot</h1>
    <p>Leaderboard e ajustes por grupo · ${host}:${port}</p>
  </header>
  <main>
    <section>
      <h2>Ranking</h2>
      <div class="row">
        <div>
          <label for="scope">Grupo (scope)</label>
          <select id="scope"></select>
        </div>
        <div>
          <label for="limit">Top</label>
          <input id="limit" type="number" min="1" max="50" value="10" />
        </div>
      </div>
      <div class="actions">
        <button type="button" id="btn-rank">Atualizar ranking</button>
      </div>
      <p class="toast" id="rank-status"></p>
      <table>
        <thead><tr><th>#</th><th>Usuário</th><th>Lv</th><th>XP</th><th>Coins</th></tr></thead>
        <tbody id="rank-body"><tr><td colspan="5" class="muted">Carregue um grupo.</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>Settings do grupo</h2>
      <p class="muted">Sobrescreve XP/cooldown/daily só neste grupo. Whitelist global fica no wizard / config.user.json.</p>
      <div class="row" style="margin-top:0.75rem">
        <div>
          <label for="set-group">Grupo</label>
          <select id="set-group"></select>
        </div>
        <div>
          <label for="set-enabled">Ativo</label>
          <select id="set-enabled">
            <option value="1">Sim</option>
            <option value="0">Não</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:0.75rem">
        <div><label>XP min</label><input id="set-xpmin" type="number" value="15" /></div>
        <div><label>XP max</label><input id="set-xpmax" type="number" value="25" /></div>
      </div>
      <div class="row" style="margin-top:0.75rem">
        <div><label>Cooldown (ms)</label><input id="set-cd" type="number" value="60000" /></div>
        <div><label>Rank limit</label><input id="set-rank" type="number" value="10" /></div>
      </div>
      <div class="row" style="margin-top:0.75rem">
        <div><label>Daily XP</label><input id="set-dxp" type="number" value="150" /></div>
        <div><label>Daily coins</label><input id="set-dcoins" type="number" value="50" /></div>
      </div>
      <div class="actions">
        <button type="button" id="btn-load-set" class="secondary">Carregar</button>
        <button type="button" id="btn-save-set">Salvar settings</button>
      </div>
      <p class="toast" id="set-status"></p>
    </section>
  </main>
  <script>
    const $ = id => document.getElementById(id);

    async function api(path, opts) {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    async function loadGroups() {
      const data = await api('/api/fun/groups');
      const groups = data.groups || [];
      for (const sel of [$('scope'), $('set-group')]) {
        sel.innerHTML = '';
        if (!groups.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = 'Nenhum grupo na whitelist';
          sel.appendChild(o);
          continue;
        }
        for (const g of groups) {
          const o = document.createElement('option');
          o.value = g.jid;
          o.textContent = g.name ? g.name + ' · ' + g.jid : g.jid;
          sel.appendChild(o);
        }
      }
    }

    async function loadRank() {
      const scope = $('scope').value;
      const limit = $('limit').value || 10;
      $('rank-status').textContent = 'Carregando…';
      if (!scope) {
        $('rank-status').textContent = 'Sem grupo.';
        return;
      }
      const data = await api('/api/fun/leaderboard?scope=' + encodeURIComponent(scope) + '&limit=' + limit);
      const rows = data.entries || [];
      $('rank-body').innerHTML = rows.length
        ? rows.map(e => '<tr><td>' + e.rank + '</td><td>' + (e.displayName || e.userJid) + '</td><td>' + e.level + '</td><td>' + e.xp + '</td><td>' + e.coins + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">Vazio.</td></tr>';
      $('rank-status').textContent = rows.length + ' jogador(es)';
    }

    async function loadSettings() {
      const groupJid = $('set-group').value;
      if (!groupJid) return;
      $('set-status').textContent = 'Carregando…';
      const data = await api('/api/fun/groups/' + encodeURIComponent(groupJid) + '/settings');
      const s = data.settings || data.defaults || {};
      $('set-enabled').value = s.enabled === false ? '0' : '1';
      $('set-xpmin').value = s.xpMin ?? 15;
      $('set-xpmax').value = s.xpMax ?? 25;
      $('set-cd').value = s.cooldownMs ?? 60000;
      $('set-rank').value = s.rankLimit ?? 10;
      $('set-dxp').value = s.dailyXp ?? 150;
      $('set-dcoins').value = s.dailyCoins ?? 50;
      $('set-status').textContent = data.settings ? 'Override do grupo' : 'Defaults globais (ainda sem override)';
    }

    async function saveSettings() {
      const groupJid = $('set-group').value;
      if (!groupJid) return;
      $('set-status').textContent = 'Salvando…';
      await api('/api/fun/groups/' + encodeURIComponent(groupJid) + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: $('set-enabled').value === '1',
          xpMin: Number($('set-xpmin').value),
          xpMax: Number($('set-xpmax').value),
          cooldownMs: Number($('set-cd').value),
          rankLimit: Number($('set-rank').value),
          dailyXp: Number($('set-dxp').value),
          dailyCoins: Number($('set-dcoins').value),
          levelUpAnnounce: true,
        }),
      });
      $('set-status').textContent = 'Salvo.';
    }

    $('btn-rank').onclick = () => loadRank().catch(e => { $('rank-status').textContent = e.message; });
    $('btn-load-set').onclick = () => loadSettings().catch(e => { $('set-status').textContent = e.message; });
    $('btn-save-set').onclick = () => saveSettings().catch(e => { $('set-status').textContent = e.message; });

    loadGroups()
      .then(() => loadRank().catch(() => {}))
      .then(() => loadSettings().catch(() => {}))
      .catch(e => { $('rank-status').textContent = e.message; });
  </script>
</body>
</html>`;
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig
 * @param {object} deps.funModule
 * @param {(jid: string) => string} [deps.getContactDisplayName]
 * @param {() => any} [deps.getLogger]
 */
export function startFunDashboardServer(deps = {}) {
  const getConfig = deps.getConfig || (() => ({}));
  const funModule = deps.funModule;
  const getContactDisplayName = deps.getContactDisplayName || (() => '');
  const getLogger = deps.getLogger || (() => null);

  if (!funModule?._services) {
    throw new Error('[fun/dashboard] funModule com _services é obrigatório');
  }

  const { repository, groupRepository } = funModule._services;

  const config = getConfig();
  const host = String(config.dashboardHost || '127.0.0.1');
  const port = Number(config.dashboardPort) || 8790;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${host}:${port}`);
      const path = url.pathname;

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        sendHtml(res, 200, buildUiHtml({ host, port }));
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/health') {
        sendJson(res, 200, { ok: true, service: 'fun-dashboard' });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/config') {
        const cfg = getConfig();
        sendJson(res, 200, {
          groupWhitelistJids: cfg.groupWhitelistJids || [],
          xpMin: cfg.xpMin,
          xpMax: cfg.xpMax,
          cooldownMs: cfg.cooldownMs,
          dailyXp: cfg.dailyXp,
          dailyCoins: cfg.dailyCoins,
          rankLimit: cfg.rankLimit,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/groups') {
        const cfg = getConfig();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const groups = jids.map(jid => ({
          jid,
          name: getContactDisplayName(jid) || '',
          settings: groupRepository.getGroupSettings(jid),
        }));
        sendJson(res, 200, { groups });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/leaderboard') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        const limit = Number(url.searchParams.get('limit') || 10);
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        const entries = repository.getLeaderboard(scope, limit).map(e => ({
          ...e,
          displayName: getContactDisplayName(e.userJid) || '',
        }));
        sendJson(res, 200, { scope, entries, total: repository.countUsersInScope(scope) });
        return;
      }

      const settingsMatch = path.match(/^\/api\/fun\/groups\/([^/]+)\/settings$/);
      if (settingsMatch) {
        const groupJid = decodeURIComponent(settingsMatch[1]);
        if (req.method === 'GET') {
          const settings = groupRepository.getGroupSettings(groupJid);
          const defaults = groupRepository.resolveEffectiveRates(groupJid, getConfig());
          sendJson(res, 200, { groupJid, settings, defaults });
          return;
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await readBody(req);
          const saved = groupRepository.upsertGroupSettings({
            groupJid,
            ...body,
          });
          sendJson(res, 200, { ok: true, settings: saved });
          return;
        }
      }

      sendJson(res, 404, { error: 'not-found' });
    } catch (err) {
      getLogger?.()?.error?.({ err: String(err?.message || err) }, 'fun dashboard error');
      sendJson(res, 500, { error: String(err?.message || err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`[fun] Dashboard: http://${host}:${port}`);
      resolve(server);
    });
  });
}
