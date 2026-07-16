/**
 * Fun Dashboard API — HTTP JSON only.
 * UI: Next.js em `fun_dashboard/` (não embute HTML monolítico).
 */

import http from 'http';
import { URL } from 'url';
import { getDefaultOutboundGuard } from '../../engine/outboundGuard.js';

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
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

function withDisplayName(getContactDisplayName, entry) {
  return {
    ...entry,
    displayName: getContactDisplayName(entry.userJid) || entry.displayName || '',
  };
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

  const {
    repository,
    groupRepository,
    casinoRepository = null,
    eventRepository = null,
    factionRepository = null,
    jobService = null,
  } = funModule._services;

  const config = getConfig();
  const host = String(config.dashboardHost || '127.0.0.1');
  const port = Number(config.dashboardPort) || 8790;
  const uiPort = Number(process.env.FUN_DASHBOARD_UI_PORT || 3001);

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

      // UI vive no Next — API só aponta o endereço
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        sendJson(res, 200, {
          ok: true,
          service: 'fun-dashboard-api',
          message: 'UI Next.js em fun_dashboard',
          ui: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${uiPort}`,
          api: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/fun/health`,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'fun-dashboard-api',
          ts: Date.now(),
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/config') {
        const cfg = getConfig();
        sendJson(res, 200, {
          prefix: cfg.prefix || '/',
          groupWhitelistJids: cfg.groupWhitelistJids || [],
          xpMin: cfg.xpMin,
          xpMax: cfg.xpMax,
          cooldownMs: cfg.cooldownMs,
          dailyXp: cfg.dailyXp,
          dailyCoins: cfg.dailyCoins,
          rankLimit: cfg.rankLimit,
          allowDm: cfg.allowDm !== false,
          replyCommandsInPrivate: cfg.replyCommandsInPrivate !== false,
          zenEnabled: cfg.zenEnabled !== false,
          zenBaseUrl: cfg.zenBaseUrl || '',
          zenModel: cfg.zenModel || '',
          ollamaEnabled: cfg.ollamaEnabled !== false,
          ollamaModel: cfg.ollamaModel || '',
          tarotEnabled: cfg.tarotEnabled !== false,
          tarotCooldownMs: cfg.tarotCooldownMs,
          bingoMin: cfg.bingoMin,
          bingoMax: cfg.bingoMax,
          casinoMin: cfg.casinoMin,
          casinoMax: cfg.casinoMax,
          dashboardHost: cfg.dashboardHost,
          dashboardPort: cfg.dashboardPort,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/groups') {
        const cfg = getConfig();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const groups = jids.map((jid) => {
          const settings = groupRepository.getGroupSettings(jid);
          const players = repository.countUsersInScope(jid);
          let jackpot = 0;
          try {
            jackpot = casinoRepository?.getJackpot?.(jid)?.pot || 0;
          } catch {
            jackpot = 0;
          }
          let event = null;
          try {
            event = eventRepository?.get?.(jid) || null;
          } catch {
            event = null;
          }
          return {
            jid,
            name: getContactDisplayName(jid) || '',
            settings,
            players,
            jackpot,
            eventType: event?.eventType || 'none',
            eventEndsAt: event?.endsAt || 0,
          };
        });
        sendJson(res, 200, { groups });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/overview') {
        const cfg = getConfig();
        const scope = String(url.searchParams.get('scope') || '').trim();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const scopeKey = scope || jids[0] || '';

        let players = 0;
        let jackpot = 0;
        let event = null;
        let factions = 0;
        let topXp = [];
        let topCoins = [];

        if (scopeKey) {
          players = repository.countUsersInScope(scopeKey);
          try {
            jackpot = casinoRepository?.getJackpot?.(scopeKey)?.pot || 0;
          } catch {
            jackpot = 0;
          }
          try {
            event = eventRepository?.get?.(scopeKey) || null;
          } catch {
            event = null;
          }
          try {
            factions = factionRepository?.listByScope?.(scopeKey)?.length || 0;
          } catch {
            factions = 0;
          }
          topXp = (repository.getLeaderboard(scopeKey, 5) || []).map((e) =>
            withDisplayName(getContactDisplayName, e)
          );
          topCoins = (repository.getCoinsLeaderboard?.(scopeKey, 5) || []).map((e) =>
            withDisplayName(getContactDisplayName, e)
          );
        }

        let outbound = null;
        try {
          outbound = getDefaultOutboundGuard().stats();
        } catch {
          outbound = null;
        }

        sendJson(res, 200, {
          scope: scopeKey,
          groups: jids.length,
          players,
          jackpot,
          factions,
          event: event
            ? {
                eventType: event.eventType,
                multiplier: event.multiplier,
                endsAt: event.endsAt,
                active:
                  event.eventType &&
                  event.eventType !== 'none' &&
                  Number(event.endsAt) > Date.now(),
              }
            : null,
          topXp,
          topCoins,
          outbound: outbound
            ? {
                globalLastMinute: outbound.globalLastMinute,
                globalLastHour: outbound.globalLastHour,
                dropped: outbound.dropped,
                maxPerMinute: outbound.config?.maxPerMinute,
                maxPerHour: outbound.config?.maxPerHour,
              }
            : null,
          features: {
            zen: cfg.zenEnabled !== false,
            ollama: cfg.ollamaEnabled !== false,
            tarot: cfg.tarotEnabled !== false,
            privateReplies: cfg.replyCommandsInPrivate !== false,
          },
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/leaderboard') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        const limit = Number(url.searchParams.get('limit') || 10);
        const kind = String(url.searchParams.get('kind') || 'xp').trim().toLowerCase();
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        let entries = [];
        if (kind === 'coins') {
          entries = repository.getCoinsLeaderboard?.(scope, limit) || [];
        } else if (kind === 'messages' || kind === 'msg') {
          entries = repository.getMessagesLeaderboard?.(scope, limit) || [];
        } else {
          entries = repository.getLeaderboard(scope, limit) || [];
        }
        entries = entries.map((e) => withDisplayName(getContactDisplayName, e));
        sendJson(res, 200, {
          scope,
          kind,
          entries,
          total: repository.countUsersInScope(scope),
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/casino') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        const limit = Number(url.searchParams.get('limit') || 10);
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        if (!casinoRepository) {
          sendJson(res, 200, {
            scope,
            jackpot: 0,
            board: [],
            tournament: null,
          });
          return;
        }
        const jackpot = casinoRepository.getJackpot(scope);
        const board = (casinoRepository.getLeaderboard(scope, limit) || []).map((e) =>
          withDisplayName(getContactDisplayName, e)
        );
        const tournament = casinoRepository.getOpenTournament?.(scope) || null;
        sendJson(res, 200, {
          scope,
          jackpot: jackpot?.pot || 0,
          jackpotUpdatedAt: jackpot?.updatedAt || 0,
          board,
          tournament,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/factions') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        const list = factionRepository?.listByScope?.(scope) || [];
        sendJson(res, 200, {
          scope,
          factions: list.map((f) => ({
            ...f,
            leaderName: getContactDisplayName(f.leaderJid) || '',
          })),
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/event') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        const event = eventRepository?.get?.(scope) || null;
        sendJson(res, 200, { scope, event });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/outbound') {
        try {
          sendJson(res, 200, getDefaultOutboundGuard().stats());
        } catch (err) {
          sendJson(res, 200, { error: String(err?.message || err) });
        }
        return;
      }

      // --- Profissões / teste web ---
      if (req.method === 'POST' && path === '/api/fun/job/open') {
        if (!jobService) {
          sendJson(res, 503, { error: 'job-service-unavailable' });
          return;
        }
        const body = await readBody(req);
        const cfg = getConfig();
        const opened = jobService.openAttempt({
          token: body.token || url.searchParams.get('t') || '',
          code: body.code || '',
          funConfig: cfg,
        });
        if (!opened.ok) {
          sendJson(res, 400, { ok: false, reason: opened.reason });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          attemptId: opened.attempt.id,
          jobId: opened.job?.id,
          jobName: opened.job?.name,
          emoji: opened.job?.emoji,
          game: opened.game,
          gameConfig: opened.gameConfig,
          status: opened.attempt.status,
          expiresAt: opened.attempt.expiresAt,
        });
        return;
      }

      if (req.method === 'POST' && path === '/api/fun/job/finish') {
        if (!jobService) {
          sendJson(res, 503, { error: 'job-service-unavailable' });
          return;
        }
        const body = await readBody(req);
        const cfg = getConfig();
        const finished = jobService.finishAttempt({
          attemptId: body.attemptId || '',
          token: body.token || '',
          score: body.score,
          durationMs: body.durationMs,
          metrics: body.metrics || {},
          funConfig: cfg,
        });
        if (!finished.ok) {
          sendJson(res, 400, { ok: false, reason: finished.reason });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          passed: finished.passed,
          reason: finished.reason || null,
          jobId: finished.job?.id,
          jobName: finished.job?.name,
          emoji: finished.job?.emoji,
          salary: finished.salary ?? null,
          workers: finished.workers ?? null,
          score: finished.attempt?.score,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/job/catalog') {
        const scope = String(url.searchParams.get('scope') || '').trim();
        if (!jobService) {
          sendJson(res, 200, { jobs: [] });
          return;
        }
        sendJson(res, 200, {
          jobs: scope ? jobService.listWithMarket(scope) : jobService.listJobs(),
        });
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
      console.log(`[fun] Dashboard API: http://${host}:${port}`);
      console.log(`[fun] Dashboard UI (Next): http://127.0.0.1:${uiPort}  → npm run fun:dashboard`);
      resolve(server);
    });
  });
}
