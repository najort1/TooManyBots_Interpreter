/**
 * Fun Dashboard API — HTTP JSON only.
 * UI: Next.js em `fun_dashboard/` (não embute HTML monolítico).
 */

import http from 'http';
import { URL } from 'url';
import { getDefaultOutboundGuard } from '../../engine/outboundGuard.js';
import { normalizeFunConfig, saveFunUserConfig } from '../config.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { getLlmFeaturesStatus, normalizeLlmFeatures } from '../llm/llmGovernance.js';
import { createHouseRealtimeHub } from '../services/houseRealtimeService.js';
import { getPublicBaseUrl } from '../utils/publicUrl.js';
import { createGameRoutes, DEFAULT_GAME_TEST_KEY } from '../games/routes.js';
import { GAME_TYPES } from '../games/gameManager.js';
import {
  COMMAND_CATEGORIES,
  COMMAND_CATALOG,
  getDefaultDisabledCommandIds,
} from '../commands/catalog.js';
import { createFunLlmRepository } from '../db/funLlmRepository.js';
import { getLlmMetrics } from '../llm/llmMetrics.js';
import { openaiPing } from '../llm/openaiClient.js';
import { getLogBuffer } from './logBuffer.js';
import {
  computeGini,
  defaultRegulatorKnobs,
  clampKnobs,
  computeAvgAbsDelta,
} from '../economy/regulator.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-House-Token, X-Car-Token, X-Idempotency-Key');
  res.writeHead(status);
  res.end(payload);
}

class HttpBodyError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function readBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new HttpBodyError(413, 'body-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        settled = true;
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        settled = true;
        reject(new HttpBodyError(400, 'invalid-json'));
      }
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
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
  const updateConfig = typeof deps.updateConfig === 'function' ? deps.updateConfig : null;
  const saveConfig = typeof deps.saveConfig === 'function' ? deps.saveConfig : saveFunUserConfig;
  const funModule = deps.funModule;
  const getContactDisplayName = deps.getContactDisplayName || (() => '');
  const getLogger = deps.getLogger || (() => null);
  const getSock = typeof deps.getSock === 'function' ? deps.getSock : () => null;
  const sendText = deps.sendText || null;
  const isSocketReady =
    typeof deps.isSocketReady === 'function'
      ? deps.isSocketReady
      : () => Boolean(getSock()?.user?.id || getSock()?.authState?.creds?.me?.id);

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
    stockService = null,
    stockRepository = null,
    marketRepository = null,
    marketService = null,
    houseRepository = null,
    houseService = null,
    houseLinkService = null,
    avatarService = null,
    carRepository = null,
    carService = null,
    carLinkService = null,
    visitService = null,
    giftService = null,
    robberyService = null,
    soundSystemService = null,
    llmRepository = null,
    gameManager = null,
    gameAuthService = null,
  } = funModule._services;

  const effectiveLlmRepo = llmRepository || createFunLlmRepository();

  const resolvedGameRoutes = funModule._services?.gameRoutes || (
    gameManager && gameAuthService
      ? createGameRoutes({
          gameManager,
          authService: gameAuthService,
          authorizeCreateRoom: (req) => {
            const remoteAddress = String(req.socket?.remoteAddress || '');
            const isLocalRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
            const expectedKey = String(process.env.FUN_GAME_TEST_KEY || DEFAULT_GAME_TEST_KEY).trim();
            const providedKey = String(req.headers['x-game-test-key'] || '').trim();
            return isLocalRequest && Boolean(expectedKey) && providedKey === expectedKey;
          },
        })
      : null
  );

  /** Normaliza scope do path/query: aceita JID completo ou só o número do grupo. */
  function resolveScopeKey(raw) {
    let s = String(raw || '').trim();
    try {
      s = decodeURIComponent(s);
    } catch {
      // keep raw
    }
    s = s.trim();
    if (!s) return '';
    if (s.includes('@')) return s;
    if (/^\d{8,}$/.test(s)) return `${s}@g.us`;
    return s;
  }

  // Hub legado preservado; novas sessões usam salas canônicas scope+cena.
  const roomStreams = new Map();
  const realtimeHub = createHouseRealtimeHub();

  function broadcastRoomEvent(token, eventType, data) {
    const clients = roomStreams.get(token);
    if (!clients || !clients.size) return;
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const clientRes of clients) {
      try {
        clientRes.write(payload);
      } catch {
        clients.delete(clientRes);
      }
    }
  }
  function isScopeAllowed(scopeKey) {
    const cfg = getConfig();
    const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
    if (!scopeKey) return false;
    if (!jids.length) return true; // dev local sem whitelist
    if (jids.includes(scopeKey)) return true;
    try {
      const all = groupRepository?.listAll?.();
      if (Array.isArray(all) && all.some((g) => g.jid === scopeKey)) return true;
    } catch {
      // ignore
    }
    return false;
  }

  function houseServicesAvailable() {
    return Boolean(houseService && houseLinkService && avatarService && visitService && giftService && robberyService);
  }

  async function resolveHouseToken(token) {
    return houseLinkService?.resolve?.(String(token || '').trim()) || null;
  }

  async function resolveCarToken(token) {
    return carLinkService?.resolve?.(String(token || '').trim()) || houseLinkService?.resolve?.(String(token || '').trim()) || null;
  }

  function publicHouseItem(item) {
    return {
      id: item.id,
      itemId: item.itemId,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      rotated: item.rotated,
      placed: item.placed,
      stolen: item.stolen,
    };
  }

  function publicAvatar(state) {
    return avatarService?.publicAvatar?.(state) || {
      schemaVersion: Number(state?.schemaVersion) || 2,
      revision: Number(state?.revision) || 1,
      catalogRevision: Number(state?.catalogRevision) || 1,
      slots: state?.slots || {},
      legacySlots: state?.legacySlots || {},
      level: Number(state?.level) || 1,
    };
  }


  const config = getConfig();
  const host = String(config.dashboardHost || '127.0.0.1');
  const configuredPort = deps.port ?? config.dashboardPort;
  const port = Number.isInteger(Number(configuredPort)) && Number(configuredPort) >= 0
    ? Number(configuredPort)
    : 8790;
  const uiPort = Number(process.env.FUN_DASHBOARD_UI_PORT || 3001);
  const dashboardApiKey = String(process.env.FUN_DASHBOARD_API_KEY || '').trim();
  const configuredOrigins = Array.isArray(config.dashboardAllowedOrigins)
    ? config.dashboardAllowedOrigins
    : String(process.env.FUN_DASHBOARD_ALLOWED_ORIGINS || '').split(',');
  const allowedOrigins = new Set(configuredOrigins.map((value) => String(value).trim()).filter(Boolean));
  allowedOrigins.add(`http://127.0.0.1:${uiPort}`);
  allowedOrigins.add(`http://localhost:${uiPort}`);

  /** Wildcard origin patterns (e.g. "*.trycloudflare.com") compiled from dashboardAllowedOrigins. */
  const wildcardSuffixes = [...allowedOrigins]
    .filter((entry) => entry.startsWith('*.'))
    .map((entry) => entry.slice(1));  // "*.trycloudflare.com" → ".trycloudflare.com"

  function isOriginAllowed(origin) {
    if (allowedOrigins.has(origin)) return true;

    // Dynamic match: publicBaseUrl from config.public.json (hot-reloaded)
    try {
      const publicUrl = getPublicBaseUrl(getConfig());
      if (publicUrl && origin === publicUrl) return true;
      // Also match if origin hostname ends with .trycloudflare.com (Cloudflare Quick Tunnels)
      const publicHost = new URL(publicUrl).hostname;
      const originHost = new URL(origin).hostname;
      if (publicHost && originHost === publicHost) return true;
    } catch { /* ignore parse errors */ }

    // Wildcard suffix match (e.g. "*.trycloudflare.com" matches "https://abc.trycloudflare.com")
    if (wildcardSuffixes.length) {
      try {
        const hostname = new URL(origin).hostname;
        if (wildcardSuffixes.some((suffix) => hostname.endsWith(suffix))) return true;
      } catch { /* ignore parse errors */ }
    }

    return false;
  }

  function allowRequestOrigin(req, res) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return true;
    if (!isOriginAllowed(origin)) {
      sendJson(res, 403, { error: 'origin-not-allowed' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return true;
  }

  function hasAdminAccess(req) {
    if (!dashboardApiKey) return true;
    const headerKey = String(req.headers['x-api-key'] || '').trim();
    const encodedCookieKey = String(req.headers.cookie || '').match(/(?:^|;\s*)fun_dash_key=([^;]+)/)?.[1] || '';
    let cookieKey = '';
    try {
      cookieKey = decodeURIComponent(encodedCookieKey);
    } catch {
      cookieKey = '';
    }
    return headerKey === dashboardApiKey || cookieKey === dashboardApiKey;
  }

  function requireAdmin(req, res) {
    if (hasAdminAccess(req)) return true;
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }

  function maskUserJid(jid) {
    const raw = String(jid || '').trim();
    if (!raw) return '';
    const [userPart] = raw.split('@');
    const digits = String(userPart || '').replace(/\D/g, '');
    if (digits.length >= 4) {
      return `user_****${digits.slice(-4)}`;
    }
    const safeTail = String(userPart || '').slice(-4);
    return `user_****${safeTail.padStart(4, '*')}`;
  }

  function publicLeaderboardEntry(entry) {
    if (!entry) return entry;
    return {
      ...entry,
      userJid: maskUserJid(entry.userJid),
    };
  }

  function publicGroupJid(jid) {
    const raw = String(jid || '').trim();
    if (!raw) return '';
    if (raw.endsWith('@g.us')) return raw;
    return maskUserJid(raw);
  }

  function selfHealConfig(cfg = getConfig()) {
    return {
      enabled: Boolean(cfg.selfHealEnabled),
      intervalMs: cfg.selfHealIntervalMs,
      dryRun: Boolean(cfg.selfHealDryRun),
      evidenceRetentionDays: cfg.selfHealEvidenceRetentionDays,
      maxItemsPerRun: cfg.selfHealMaxItemsPerRun,
      maxCallsPerRun: cfg.selfHealMaxCallsPerRun,
      quietHoursRespected: true,
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowRequestOrigin(req, res)) return;
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-House-Token');
        res.writeHead(204);
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

      if (req.method === 'POST' && path === '/api/fun/games/spawn') {
        if (!requireAdmin(req, res)) return;
        if (!gameManager) {
          sendJson(res, 503, { ok: false, error: 'games-indisponivel', message: 'Gerenciador de jogos não disponível.' });
          return;
        }

        const body = await readBody(req);
        const rawScope = body.scope || body.scopeKey || '';
        const scope = resolveScopeKey(rawScope);
        if (!scope) {
          sendJson(res, 400, { ok: false, error: 'scope-obrigatorio', message: 'Grupo (scope) é obrigatório.' });
          return;
        }

        if (!isScopeAllowed(scope)) {
          sendJson(res, 403, { ok: false, error: 'scope-not-allowed', message: 'Grupo não permitido pela whitelist.' });
          return;
        }

        const validGameTypes = Object.values(GAME_TYPES);
        const gameType = String(body.gameType || '').trim();
        if (!validGameTypes.includes(gameType)) {
          sendJson(res, 400, {
            ok: false,
            error: 'invalid-game-type',
            message: `Tipo de jogo inválido. Válidos: ${validGameTypes.join(', ')}`,
            validTypes: validGameTypes,
          });
          return;
        }

        const prize = Number.isFinite(Number(body.prize)) ? Math.max(100, Math.floor(Number(body.prize))) : 1000;
        const startInMinutes = Number.isInteger(Number(body.startInMinutes))
          ? Math.max(1, Math.min(15, Number(body.startInMinutes)))
          : 3;
        const announce = body.announce !== false;
        const force = Boolean(body.force);

        try {
          const result = await gameManager.createRoom({
            scopeKey: scope,
            gameType,
            prize,
            startInMinutes,
            announce,
            isTest: false,
            force,
          });

          if (!result.ok) {
            getLogBuffer().add({
              level: 'warn',
              domain: 'games',
              message: `Falha ao spawnar jogo ${gameType}: ${result.reason || 'create-room-failed'}`,
              scope,
              details: { gameType, reason: result.reason },
            });
            sendJson(res, 400, {
              ok: false,
              error: result.reason || 'create-room-failed',
              reason: result.reason,
              room: result.room,
              message: result.reason === 'room_already_active'
                ? 'Já existe uma sala de jogo ativa para este grupo.'
                : 'Falha ao criar sala de jogo.',
            });
            return;
          }

          getLogBuffer().add({
            level: 'info',
            domain: 'games',
            message: `Jogo ${gameType} spawnado com sucesso (${result.room?.id || 'sala'})`,
            scope,
            details: { gameType, roomId: result.room?.id, prize, startInMinutes, announce },
          });

          sendJson(res, 200, {
            ok: true,
            room: result.room,
            gameLink: result.gameLink,
            announcementText: result.announcementText,
          });
          return;
        } catch (err) {
          getLogBuffer().add({
            level: 'error',
            domain: 'games',
            message: `Erro interno ao spawnar jogo ${gameType}: ${err?.message || err}`,
            scope,
          });
          getLogger?.()?.error?.({ err }, 'Erro ao spawnar jogo de panelinha via dashboard');
          sendJson(res, 500, {
            ok: false,
            error: 'internal-error',
            message: err?.message || 'Erro interno ao criar sala de jogo.',
          });
          return;
        }
      }

      if (req.method === 'GET' && path === '/api/fun/games/active') {
        const rawScope = url.searchParams.get('scope') || '';
        const scope = resolveScopeKey(rawScope);
        if (!scope) {
          sendJson(res, 400, { ok: false, error: 'scope-obrigatorio' });
          return;
        }
        if (!gameManager) {
          sendJson(res, 200, { ok: true, active: false, room: null });
          return;
        }
        const activeRoom = gameManager.getActiveRoomByScope?.(scope);
        if (!activeRoom) {
          sendJson(res, 200, { ok: true, active: false, room: null });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          active: true,
          room: gameManager.publicRoomState ? gameManager.publicRoomState(activeRoom) : activeRoom,
          gameLink: `/jogos/${activeRoom.id}`,
        });
        return;
      }

      if (path.startsWith('/api/fun/games/')) {
        if (!resolvedGameRoutes) {
          sendJson(res, 503, { error: 'games-indisponivel' });
          return;
        }
        if (await resolvedGameRoutes.handleRequest(req, res, url)) {
          return;
        }
      }

      if (req.method === 'GET' && path === '/api/fun/health') {
        let llm = null;
        try {
          const { getLlmMetrics, inventTemplateAlert } = await import('../llm/llmMetrics.js');
          llm = {
            ...getLlmMetrics(),
            inventAlert: inventTemplateAlert(0.4, 5),
          };
        } catch {
          llm = null;
        }
        sendJson(res, 200, {
          ok: true,
          service: 'fun-dashboard-api',
          ts: Date.now(),
          llm,
        });
        return;
      }

      if (path.startsWith('/api/fun/houses/')) {
        if (!houseServicesAvailable()) {
          sendJson(res, 503, { error: 'houses-indisponivel' });
          return;
        }
        const match = path.match(/^\/api\/fun\/houses\/([^/]+)(?:\/(.*))?$/);
        const targetToken = match?.[1] ? decodeURIComponent(match[1]) : '';
        const action = String(match?.[2] || '');
        const target = await resolveHouseToken(targetToken);
        if (!target) {
          sendJson(res, 404, { error: 'casa-nao-encontrada' });
          return;
        }
        const cfg = getConfig();
        const authToken = String(req.headers['x-house-token'] || '').trim();
        const caller = authToken ? await resolveHouseToken(authToken) : null;
        const owns = Boolean(
          caller &&
          caller.scopeKey === target.scopeKey &&
          caller.userJid === target.userJid
        );
        const neighborMatch = action.match(/^neighbors\/([^/]+)(?:\/(visit|gifts|rob))?$/);

        if (neighborMatch) {
          const neighbor = houseRepository?.getHouseByPublicId?.(target.scopeKey, decodeURIComponent(neighborMatch[1]));
          if (!neighbor || neighbor.userJid === target.userJid) {
            sendJson(res, 404, { error: 'vizinho-nao-encontrado' });
            return;
          }
          if (req.method === 'GET' && !neighborMatch[2]) {
            const current = houseService.getHouse({ scopeKey: target.scopeKey, userJid: neighbor.userJid });
            const avatar = avatarService.get({ scopeKey: target.scopeKey, userJid: neighbor.userJid });
            const mural = visitService.mural({ scopeKey: target.scopeKey, ownerJid: neighbor.userJid }).visits.map((visit) => ({ note: visit.note, createdAt: visit.createdAt }));
            sendJson(res, 200, { owns: false, house: current.house, items: current.items.filter((item) => item.placed).map(publicHouseItem), avatar: publicAvatar(avatar), host: { nickname: getContactDisplayName(neighbor.userJid) || 'Morador' }, mural });
            return;
          }
          if (!caller) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (!owns) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
          const body = await readBody(req);
          if (req.method === 'POST' && neighborMatch[2] === 'visit') {
            const result = visitService.visit({ scopeKey: target.scopeKey, ownerJid: neighbor.userJid, visitorJid: caller.userJid, note: body.note, funConfig: cfg });
            sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, visit: { note: result.visit.note, createdAt: result.visit.createdAt } } : { error: result.reason });
            return;
          }
          if (req.method === 'POST' && neighborMatch[2] === 'gifts') {
            const result = giftService.give({ scopeKey: target.scopeKey, giverJid: caller.userJid, recipientJid: neighbor.userJid, itemInstanceId: body.itemId, coins: body.coins, funConfig: cfg });
            sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, gift: { coins: result.gift.coins, itemId: result.gift.itemInstanceId } } : { error: result.reason });
            return;
          }
          if (req.method === 'POST' && neighborMatch[2] === 'rob') {
            const result = robberyService.rob({ scopeKey: target.scopeKey, robberJid: caller.userJid, ownerJid: neighbor.userJid, funConfig: cfg });
            sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, result: result.result, item: result.item ? publicHouseItem(result.item) : null, fine: result.fine || 0, wantedDelta: result.wantedDelta || 0 } : { error: result.reason, result: result.result });
            return;
          }
          sendJson(res, 404, { error: 'neighbor-route-not-found' });
          return;
        }

        if (req.method === 'GET' && !action) {
          const current = houseService.getHouse({ scopeKey: target.scopeKey, userJid: target.userJid });
          const avatar = avatarService.get({ scopeKey: target.scopeKey, userJid: target.userJid });
          const mural = visitService.mural({ scopeKey: target.scopeKey, ownerJid: target.userJid }).visits.map((visit) => ({ note: visit.note, createdAt: visit.createdAt }));
          if (owns) {
            const coins = repository.getUserStats(target.userJid, target.scopeKey)?.coins || 0;
            const gifts = houseRepository?.listGiftsReceived?.(target.scopeKey, target.userJid) || [];
            sendJson(res, 200, { owns: true, house: current.house, items: current.items.map(publicHouseItem), avatar: publicAvatar(avatar), cleanliness: current.house.cleanliness, security: current.house.securityLevel, coins, mural, gifts });
          } else {
            sendJson(res, 200, { owns: false, house: current.house, items: current.items.filter((item) => item.placed).map(publicHouseItem), avatar: publicAvatar(avatar), host: { nickname: getContactDisplayName(target.userJid) || 'Morador' }, mural });
          }
          return;
        }

        if (action === 'sound-system' && req.method === 'GET') {
          if (!soundSystemService) { sendJson(res, 503, { error: 'paredao-indisponivel' }); return; }
          sendJson(res, 200, soundSystemService.getState({ scopeKey: target.scopeKey }));
          return;
        }

        if (action === 'sound-system/search' && req.method === 'GET') {
          if (!soundSystemService) { sendJson(res, 503, { error: 'paredao-indisponivel' }); return; }
          const authToken = String(req.headers['x-house-token'] || '').trim();
          const actor = authToken ? await resolveHouseToken(authToken) : null;
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (actor.scopeKey !== target.scopeKey) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
          const result = await soundSystemService.search({ query: url.searchParams.get('q') });
          const status = result.ok ? 200 : result.reason === 'youtube-search-not-configured' ? 503 : result.reason === 'search-too-short' ? 400 : 502;
          sendJson(res, status, result.ok ? result : { error: result.reason });
          return;
        }

        if (['sound-system/queue', 'sound-system/current/advance', 'sound-system/current/duration'].includes(action)) {
          if (!soundSystemService) { sendJson(res, 503, { error: 'paredao-indisponivel' }); return; }
          const authToken = String(req.headers['x-house-token'] || '').trim();
          const actor = authToken ? await resolveHouseToken(authToken) : null;
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (actor.scopeKey !== target.scopeKey) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
          const body = await readBody(req);
          let result;
          if (action === 'sound-system/queue' && req.method === 'POST') {
            result = await soundSystemService.enqueue({
              scopeKey: target.scopeKey,
              userJid: actor.userJid,
              requestedByName: getContactDisplayName(actor.userJid) || 'Morador',
              url: body.url,
            });
          } else if (action === 'sound-system/current/duration' && req.method === 'PUT') {
            result = soundSystemService.reportDuration({ scopeKey: target.scopeKey, trackId: body.trackId, durationSeconds: body.durationSeconds });
          } else if (action === 'sound-system/current/advance' && req.method === 'POST') {
            result = soundSystemService.advance({ scopeKey: target.scopeKey, trackId: body.trackId });
          } else {
            sendJson(res, 405, { error: 'method-not-allowed' });
            return;
          }
          sendJson(res, result.ok ? 200 : result.reason === 'youtube-link-invalid' ? 400 : 409, result.ok ? result : { error: result.reason });
          return;
        }

        // Transporte realtime v1; endpoints legados abaixo permanecem compatíveis.
        if (req.method === 'POST' && action === 'session') {
          const authToken = String(req.headers['x-house-token'] || '').trim();
          const actor = authToken ? await resolveHouseToken(authToken) : null;
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (actor.scopeKey !== target.scopeKey) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
          const body = await readBody(req);
          const scene = body.scene === 'street' ? 'street' : 'house';
          const sceneId = scene === 'street' ? target.scopeKey : (body.sceneId || targetToken);
          const actorAvatar = publicAvatar(avatarService?.get?.({ scopeKey: actor.scopeKey, userJid: actor.userJid }));
          const { session } = realtimeHub.open({
            actor,
            scopeKey: actor.scopeKey,
            scene,
            sceneId,
            nickname: getContactDisplayName(actor.userJid) || 'VIZINHO',
            avatar: actorAvatar,
          });
          const streamTicket = realtimeHub.issueStreamTicket(session);
          sendJson(res, 201, { sessionId: session.id, streamTicket, roomId: session.roomId, self: { id: session.participantId }, nextClientSeq: session.clientSeq + 1 });
          return;
        }

        if (req.method === 'GET' && action === 'realtime/stream') {
          const streamTicket = String(url.searchParams.get('ticket') || '');
          const session = realtimeHub.consumeStreamTicket(streamTicket);
          if (!session) { sendJson(res, 401, { error: 'invalid-or-expired-stream-ticket' }); return; }
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.writeHead(200);
          const detach = realtimeHub.attach(session, res);
          const ping = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { clearInterval(ping); } }, 15000);
          req.on('close', () => { clearInterval(ping); detach(); realtimeHub.close(session); });
          return;
        }

        if (req.method === 'POST' && ['realtime/snapshot', 'realtime/poll', 'realtime/move', 'realtime/chat', 'realtime/signal', 'realtime/avatar', 'realtime/leave'].includes(action)) {
          const authToken = String(req.headers['x-house-token'] || '').trim();
          const actor = authToken ? await resolveHouseToken(authToken) : null;
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          const body = await readBody(req);
          const session = realtimeHub.authorize(body.sessionId, actor);
          if (!session) { sendJson(res, 403, { error: 'invalid-session' }); return; }
          if (action === 'realtime/snapshot') { sendJson(res, 200, realtimeHub.snapshot(session)); return; }
          if (action === 'realtime/poll') { sendJson(res, 200, realtimeHub.poll(session, body)); return; }
          if (action === 'realtime/leave') { realtimeHub.close(session); sendJson(res, 200, { ok: true }); return; }
          const method = action === 'realtime/avatar' ? 'updateAvatar' : action.slice('realtime/'.length);
          const result = realtimeHub[method](session, action === 'realtime/avatar' ? body.avatar : body);
          sendJson(res, result.status || (result.ok ? 200 : 400), result.ok ? { ok: true, event: result.event } : { error: result.error });
          return;
        }

        if (req.method === 'GET' && action === 'stream') {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.writeHead(200);
          res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

          if (!roomStreams.has(targetToken)) {
            roomStreams.set(targetToken, new Set());
          }
          const clients = roomStreams.get(targetToken);
          clients.add(res);

          // Keep-alive ping a cada 15s para evitar timeout do proxy Next.js
          const keepAliveInterval = setInterval(() => {
            try {
              res.write(': keepalive\n\n');
            } catch {
              clearInterval(keepAliveInterval);
            }
          }, 15000);

          // Anuncia entrada de novo visitante
          broadcastRoomEvent(targetToken, 'presence', {
            type: 'join',
            userJid: target.userJid,
            nickname: getContactDisplayName(target.userJid) || 'Visitante',
            count: clients.size,
          });

          req.on('close', () => {
            clearInterval(keepAliveInterval);
            clients.delete(res);
            if (clients.size === 0) {
              roomStreams.delete(targetToken);
            } else {
              broadcastRoomEvent(targetToken, 'presence', {
                type: 'leave',
                userJid: target.userJid,
                count: clients.size,
              });
            }
          });
          return;
        }

        if (req.method === 'POST' && action === 'chat') {
          const body = await readBody(req);
          const text = String(body.text || '').trim();
          if (!text) {
            sendJson(res, 400, { error: 'texto-obrigatorio' });
            return;
          }
          const senderNickname = getContactDisplayName(target.userJid) || 'Morador';
          const msgPayload = {
            id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            senderJid: target.userJid,
            nickname: senderNickname,
            text,
            isNpc: false,
            createdAt: Date.now(),
          };

          // Transmite para todos no SSE da casa
          broadcastRoomEvent(targetToken, 'chat', msgPayload);

          sendJson(res, 200, { ok: true, message: msgPayload });

          // Se a mensagem mencionar "mordomo", "bot", "sindico" ou perguntar algo, o NPC da Persona AI responde automaticamente!
          const lowerText = text.toLowerCase();
          if (lowerText.includes('mordomo') || lowerText.includes('sindico') || lowerText.includes('bot') || lowerText.includes('ajuda') || lowerText.includes('ola') || lowerText.includes('olá')) {
            setTimeout(() => {
              const npcResponses = [
                `Olá, ${senderNickname}! Sou o Mordomo do Beco. Como posso servir sua casa hoje?`,
                `Fiscalizando o cômodo! Lembre-se de manter a casa limpa (🧹) e a segurança em dia (🛡️).`,
                `Que bom ver você por aqui, ${senderNickname}! Aceita um suco de caju gelado? 🍹`,
                `Tudo em ordem no beco! Se precisar arrumar a casa, use a Mala de Mobis. 🛋️`,
              ];
              const npcMsg = {
                id: 'npc_' + Date.now(),
                senderJid: 'npc_mordomo@bot',
                nickname: 'Mordomo do Beco',
                text: npcResponses[Math.floor(Math.random() * npcResponses.length)],
                isNpc: true,
                createdAt: Date.now(),
              };
              broadcastRoomEvent(targetToken, 'chat', npcMsg);
            }, 1200);
          }
          return;
        }

        if (req.method === 'GET' && action === 'ice-servers') {
          const meteredApiKey = cfg.meteredApiKey || process.env.METERED_API_KEY || '';
          const meteredDomain = cfg.meteredDomain || process.env.METERED_DOMAIN || 'chupebot.metered.live';
          const DEFAULT_STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

          if (!meteredApiKey) {
            sendJson(res, 200, { iceServers: DEFAULT_STUN });
            return;
          }

          try {
            const meteredUrl = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`;
            const upstream = await fetch(meteredUrl, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(4000),
            });
            if (!upstream.ok) throw new Error(`metered-${upstream.status}`);
            const data = await upstream.json();
            if (Array.isArray(data) && data.length > 0) {
              sendJson(res, 200, { iceServers: data });
              return;
            }
          } catch (err) {
            // Fallback para STUN
          }
          sendJson(res, 200, { iceServers: DEFAULT_STUN });
          return;
        }

        if (req.method === 'GET' && action === 'neighborhood') {
          const houses = (houseRepository?.listHouses?.(target.scopeKey) || []).filter((house) => house.userJid !== target.userJid).map((house) => ({ id: house.publicId, nickname: getContactDisplayName(house.userJid) || 'Morador', cleanliness: house.cleanliness, securityLevel: house.securityLevel }));
          sendJson(res, 200, { houses });
          return;
        }

        if (req.method === 'GET' && action === 'shop') {
          if (!owns) { sendJson(res, 403, { error: 'house-token-required' }); return; }
          sendJson(res, 200, { shop: houseService.listShop({ scopeKey: target.scopeKey, userJid: target.userJid }), coins: repository.getUserStats(target.userJid, target.scopeKey)?.coins || 0 });
          return;
        }
        if (req.method === 'GET' && action === 'avatar') {
          const avatar = avatarService.get({ scopeKey: target.scopeKey, userJid: target.userJid });
          sendJson(res, 200, owns ? avatar : publicAvatar(avatar));
          return;
        }
        if (req.method === 'GET' && action === 'visits') {
          if (!owns) { sendJson(res, 403, { error: 'house-token-required' }); return; }
          const visits = visitService.mural({ scopeKey: target.scopeKey, ownerJid: target.userJid }).visits.map((visit) => ({ id: visit.id, note: visit.note, createdAt: visit.createdAt, nickname: getContactDisplayName(visit.visitorJid) || 'Visitante' }));
          sendJson(res, 200, { visits });
          return;
        }

        if (['collect', 'items/move', 'styles/apply', 'items/place', 'items/sell', 'security', 'avatar/shop'].includes(action) || (req.method === 'PUT' && action === 'avatar')) {
          if (!caller) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
        }

        const actor = caller;
        if (['visit', 'gifts', 'rob'].includes(action)) {
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (actor.scopeKey !== target.scopeKey) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
        }
        const body = await readBody(req);
        if (req.method === 'POST' && action === 'collect') {
          const result = houseService.collect({ scopeKey: target.scopeKey, userJid: target.userJid, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, coins: result.coins, reason: result.reason } : { error: result.reason, nextAt: result.nextAt });
          return;
        }
        if (req.method === 'PUT' && action === 'items/move') {
          const result = houseService.move({ scopeKey: target.scopeKey, userJid: target.userJid, itemInstanceId: body.itemId, x: body.x, y: body.y, rotation: body.rotation, rotated: body.rotated });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, item: publicHouseItem(result.item) } : { error: result.reason });
          return;
        }
        if (req.method === 'PUT' && action === 'styles/apply') {
          const result = houseService.applyStyle({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, house: result.house, coins: result.coins, purchased: result.purchased } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'POST' && action === 'items/place') {
          const result = houseService.place({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, x: body.x, y: body.y, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, item: publicHouseItem(result.item), coins: result.coins } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'POST' && action === 'items/sell') {
          const result = houseService.sell({ scopeKey: target.scopeKey, userJid: target.userJid, itemInstanceId: body.itemId });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, coins: result.coins } : { error: result.reason });
          return;
        }
        if (req.method === 'POST' && action === 'security') {
          const result = houseService.upgradeSecurity({ scopeKey: target.scopeKey, userJid: target.userJid, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, house: result.house, coins: result.coins } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'PUT' && action === 'avatar') {
          const result = body.slots
            ? avatarService.apply({
                scopeKey: target.scopeKey,
                userJid: target.userJid,
                slots: body.slots,
                expectedRevision: body.expectedRevision,
                catalogRevision: body.catalogRevision,
                idempotencyKey: body.idempotencyKey,
                confirmedPurchase: body.confirmedPurchase,
                funConfig: cfg,
              })
            : avatarService.equip({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, funConfig: cfg });
          const status = result.ok ? 200 : ['purchase-confirmation-required', 'appearance-revision-conflict', 'catalog-revision-conflict'].includes(result.reason) ? 409 : 400;
          if (result.ok) {
            const avatar = publicAvatar(result.state);
            realtimeHub.updateActorAvatar(actor, avatar);
            sendJson(res, status, { ok: true, avatar, state: result.state, coins: result.coins, purchased: result.purchased, replayed: result.replayed });
          } else {
            sendJson(res, status, { error: result.reason, reason: result.reason, errors: result.errors, quote: result.quote, current: result.current, need: result.need, coins: result.coins });
          }
          return;
        }
        if (req.method === 'POST' && action === 'avatar/shop') {
          const result = avatarService.buy({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, avatar: publicAvatar(result.state), coins: result.coins } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'POST' && action === 'visit') {
          const result = visitService.visit({ scopeKey: target.scopeKey, ownerJid: target.userJid, visitorJid: actor.userJid, note: body.note, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, visit: { note: result.visit.note, createdAt: result.visit.createdAt } } : { error: result.reason });
          return;
        }
        if (req.method === 'POST' && action === 'gifts') {
          const result = giftService.give({ scopeKey: target.scopeKey, giverJid: actor.userJid, recipientJid: target.userJid, itemInstanceId: body.itemId, coins: body.coins, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, gift: { coins: result.gift.coins, itemId: result.gift.itemInstanceId } } : { error: result.reason });
          return;
        }
        if (req.method === 'POST' && action === 'rob') {
          const result = robberyService.rob({ scopeKey: target.scopeKey, robberJid: actor.userJid, ownerJid: target.userJid, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, result: result.result, item: result.item ? publicHouseItem(result.item) : null, fine: result.fine || 0, wantedDelta: result.wantedDelta || 0 } : { error: result.reason, result: result.result });
          return;
        }
        sendJson(res, 404, { error: 'house-route-not-found' });
        return;
      }

      if (path.startsWith('/api/fun/cars/')) {
        if (!carService || !carLinkService) {
          sendJson(res, 503, { error: 'cars-indisponivel' });
          return;
        }
        const match = path.match(/^\/api\/fun\/cars\/([^/]+)(?:\/(.*))?$/);
        const targetToken = match?.[1] ? decodeURIComponent(match[1]) : '';
        const action = String(match?.[2] || '');
        const target = await resolveCarToken(targetToken);
        if (!target) {
          sendJson(res, 404, { error: 'carro-nao-encontrado' });
          return;
        }

        const cfg = getConfig();
        const authToken = String(req.headers['x-car-token'] || req.headers['x-house-token'] || '').trim();
        const caller = authToken ? await resolveCarToken(authToken) : target;
        const owns = Boolean(
          caller &&
          caller.scopeKey === target.scopeKey &&
          caller.userJid === target.userJid
        );

        if (!owns) {
          sendJson(res, 403, { error: 'acesso-nao-autorizado' });
          return;
        }

        // Endpoint de renderização da imagem / screenshot via sharp
        if (req.method === 'GET' && (action === 'image' || action === 'render')) {
          const ownerName = getContactDisplayName(target.userJid) || 'Piloto';
          const renderResult = await carService.renderCarScreenshot({
            scopeKey: target.scopeKey,
            userJid: target.userJid,
            ownerName,
          });
          if (!renderResult?.ok || !renderResult.buffer) {
            sendJson(res, 400, { error: renderResult?.reason || 'render-failed' });
            return;
          }
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Length', renderResult.buffer.length);
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.writeHead(200);
          res.end(renderResult.buffer);
          return;
        }

        // GET /api/fun/cars/:token
        if (req.method === 'GET' && !action) {
          const carInfo = carService.getCarState({ scopeKey: target.scopeKey, userJid: target.userJid });
          sendJson(res, 200, {
            ok: true,
            owns: true,
            ownsCar: carInfo.ownsCar,
            state: carInfo.state,
            catalog: carInfo.catalog,
            coins: carInfo.coins,
            level: carInfo.level,
            owner: {
              nickname: getContactDisplayName(target.userJid) || 'Piloto',
            },
          });
          return;
        }

        // PUT /api/fun/cars/:token (aplicar customizações)
        if (req.method === 'PUT' && !action) {
          const body = await readBody(req);
          const result = carService.applyCustomization({
            scopeKey: target.scopeKey,
            userJid: target.userJid,
            customizations: body.customizations || body,
            idempotencyKey: body.idempotencyKey || req.headers['x-idempotency-key'] || '',
            funConfig: cfg,
          });
          if (!result.ok) {
            const status = result.reason === 'insufficient-coins' ? 402 : result.reason === 'car-not-owned' ? 403 : 400;
            sendJson(res, status, { error: result.reason, need: result.need, coins: result.coins, errors: result.errors });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            state: result.state,
            coins: result.coins,
            debited: result.debited,
            purchased: result.purchased,
            replayed: result.replayed,
          });
          return;
        }

        sendJson(res, 404, { error: 'car-route-not-found' });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/config') {
        const cfg = getConfig();
        const zenEndpoint = resolveZenEndpoint(cfg);
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
          mentionUsers: cfg.mentionUsers !== false,
          replyQuoted: cfg.replyQuoted !== false,
          replyCommandsInPrivate: cfg.replyCommandsInPrivate !== false,
          zenEnabled: cfg.zenEnabled !== false,
          llmFeatures: normalizeLlmFeatures(cfg.llmFeatures),
          zenBaseUrl: zenEndpoint.baseUrl,
          zenModel: zenEndpoint.model,
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
          qmpEnabled: cfg.qmpEnabled !== false,
          qmpAutoTriggerChance: cfg.qmpAutoTriggerChance ?? 0.02,
          qmpAutoTriggerCooldownMs: cfg.qmpAutoTriggerCooldownMs ?? 30 * 60_000,
          qmpRoundDurationMs: cfg.qmpRoundDurationMs ?? 10 * 60_000,
          qmpCooldownMs: cfg.qmpCooldownMs ?? 45_000,
          qmpHeavyEnabled: cfg.qmpHeavyEnabled !== false,
          qmpHeavyEvery: cfg.qmpHeavyEvery ?? 5,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/llm/analytics') {
        const urlObj = new URL(req.url, 'http://localhost');
        const daysParam = urlObj.searchParams.get('days');
        const scopeParam = urlObj.searchParams.get('scope') || '';
        const days = daysParam !== null && daysParam !== '' ? Math.max(0, parseInt(daysParam, 10) || 7) : 7;
        const now = Date.now();
        const fromTimestamp = days > 0 ? now - (days * 86_400_000) : 0;

        const stats = effectiveLlmRepo.getStats({
          scopeKey: scopeParam,
          fromTimestamp,
          toTimestamp: now,
          limitRecent: 100,
        });

        // Enriquecer nomes legíveis de grupos e usuários
        const groups = groupRepository?.listAllGroups ? groupRepository.listAllGroups() : [];
        const groupMap = new Map();
        for (const g of groups) {
          if (g?.jid) groupMap.set(g.jid, g.name || g.subject || g.jid);
        }

        const byGroupEnriched = stats.byGroup.map((g) => ({
          ...g,
          groupName: groupMap.get(g.scopeKey) || g.scopeKey,
        }));

        const topUsersEnriched = stats.topUsers.map((u) => ({
          ...u,
          userName: getContactDisplayName(u.userJid) || u.userJid,
        }));

        const isAdmin = hasAdminAccess(req);
        const recentCallsEnriched = stats.recentCalls.map((c) => ({
          ...c,
          groupName: c.scopeKey ? (groupMap.get(c.scopeKey) || c.scopeKey) : '',
          userName: c.userJid ? (getContactDisplayName(c.userJid) || c.userJid) : '',
          promptPreview: isAdmin ? c.promptPreview : (c.promptPreview ? '(visível para admin)' : ''),
          responsePreview: isAdmin ? c.responsePreview : (c.responsePreview ? '(visível para admin)' : ''),
        }));

        const cfg = getConfig();
        const zenEndpoint = resolveZenEndpoint(cfg);
        const memMetrics = getLlmMetrics();

        sendJson(res, 200, {
          ok: true,
          period: {
            days,
            fromTimestamp,
            toTimestamp: now,
          },
          summary: {
            ...stats.summary,
            activeProvider: 'zen',
            activeModel: zenEndpoint.model,
            masterEnabled: cfg.zenEnabled !== false,
          },
          daily: stats.daily,
          byTask: stats.byTask,
          byProvider: stats.byProvider,
          byModel: stats.byModel,
          byHour: stats.byHour,
          byGroup: byGroupEnriched,
          topUsers: topUsersEnriched,
          recentCalls: recentCallsEnriched,
          realtime: memMetrics,
          zenHealth: {
            ok: cfg.zenEnabled !== false,
            baseUrl: zenEndpoint.baseUrl,
            model: zenEndpoint.model,
          },
        });
        return;
      }

      if (req.method === 'POST' && path === '/api/fun/llm/prune') {
        if (!requireAdmin(req, res)) return;
        const body = await readBody(req).catch(() => ({}));
        const pruneDays = Math.max(1, parseInt(body?.days, 10) || 90);
        const result = effectiveLlmRepo.pruneOldCalls(pruneDays);
        getLogBuffer().add({
          level: 'info',
          domain: 'llm',
          message: `Limpeza de histórico de chamadas de LLM executada (${result.deleted} registros removidos)`,
          details: { days: pruneDays, deleted: result.deleted },
        });
        sendJson(res, 200, { ok: true, days: pruneDays, deleted: result.deleted });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/llm/config') {
        const cfg = getConfig();
        const zenEndpoint = resolveZenEndpoint(cfg);
        const status = getLlmFeaturesStatus(cfg);
        sendJson(res, 200, {
          ok: true,
          zenEnabled: cfg.zenEnabled !== false,
          zenBaseUrl: zenEndpoint.baseUrl,
          zenModel: zenEndpoint.model,
          llmFeatures: status.features,
          items: status.items,
          masterEnabled: status.masterEnabled,
        });
        return;
      }

      if ((req.method === 'POST' || req.method === 'PUT') && path === '/api/fun/llm/config') {
        if (!requireAdmin(req, res)) return;
        const body = await readBody(req);
        const current = getConfig();
        const nextFeatures = body.llmFeatures && typeof body.llmFeatures === 'object'
          ? { ...(current.llmFeatures || {}), ...body.llmFeatures }
          : current.llmFeatures;

        const next = normalizeFunConfig({
          ...current,
          ...(Object.hasOwn(body, 'zenEnabled') ? { zenEnabled: Boolean(body.zenEnabled) } : {}),
          llmFeatures: nextFeatures,
        });

        saveConfig(next);
        if (typeof updateConfig === 'function') {
          updateConfig(next);
        }

        getLogBuffer().add({
          level: 'info',
          domain: 'llm',
          message: `Configurações de IA & LLM atualizadas (mestre: ${next.zenEnabled !== false ? 'ativo' : 'inativo'})`,
          details: { zenEnabled: next.zenEnabled },
        });

        const zenEndpoint = resolveZenEndpoint(next);
        const status = getLlmFeaturesStatus(next);
        sendJson(res, 200, {
          ok: true,
          zenEnabled: next.zenEnabled !== false,
          zenBaseUrl: zenEndpoint.baseUrl,
          zenModel: zenEndpoint.model,
          llmFeatures: status.features,
          items: status.items,
          masterEnabled: status.masterEnabled,
          persisted: true,
          appliedImmediately: true,
        });
        return;
      }

      if ((req.method === 'POST' || req.method === 'PUT') && path === '/api/fun/config') {
        if (!requireAdmin(req, res)) return;
        const body = await readBody(req);
        const current = getConfig();
        const next = normalizeFunConfig({
          ...current,
          ...body,
          ...(body.llmFeatures && typeof body.llmFeatures === 'object'
            ? { llmFeatures: { ...(current.llmFeatures || {}), ...body.llmFeatures } }
            : {}),
        });
        saveConfig(next);
        if (typeof updateConfig === 'function') {
          updateConfig(next);
        }
        getLogBuffer().add({
          level: 'info',
          domain: 'system',
          message: 'Configuração geral do bot atualizada via dashboard',
        });
        sendJson(res, 200, { ok: true, config: next, persisted: true, appliedImmediately: true });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/commands/catalog') {
        sendJson(res, 200, {
          categories: COMMAND_CATEGORIES,
          commands: COMMAND_CATALOG,
          defaultDisabled: getDefaultDisabledCommandIds(),
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/groups') {
        const isAdmin = hasAdminAccess(req);
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
            jid: isAdmin ? jid : publicGroupJid(jid),
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
        const isAdmin = hasAdminAccess(req);
        const cfg = getConfig();
        const rawScope = String(url.searchParams.get('scope') || '').trim();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const scopeKey = resolveScopeKey(rawScope) || jids[0] || '';

        if (scopeKey && !isScopeAllowed(scopeKey)) {
          sendJson(res, 403, { error: 'scope-not-allowed' });
          return;
        }

        let players = 0;
        let jackpot = 0;
        let event = null;
        let factions = 0;
        let topXp = [];
        let topCoins = [];
        let circulatingCoins = 0;
        let baselineCoins = 1;
        let gini = 0;
        let healthStatus = 'stable';
        let healthLabel = 'Estável';
        let activePlayers24h = 0;
        let totalMembers = 0;
        let economicPlayers = 0;
        let passiveMembers = 0;
        let participationRate = 1;

        if (scopeKey) {
          try {
            players = repository.countUsersInScope(scopeKey);
          } catch {
            players = 0;
          }
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
          try {
            topXp = (repository.getLeaderboard(scopeKey, 5) || []).map((e) =>
              withDisplayName(getContactDisplayName, e)
            );
          } catch {
            topXp = [];
          }
          try {
            topCoins = (repository.getCoinsLeaderboard?.(scopeKey, 5) || []).map((e) =>
              withDisplayName(getContactDisplayName, e)
            );
          } catch {
            topCoins = [];
          }
          if (!isAdmin) {
            topXp = topXp.map(publicLeaderboardEntry);
            topCoins = topCoins.map(publicLeaderboardEntry);
          }

          let balances = [];
          try {
            if (typeof repository.listScopeCoinBalances === 'function') {
              balances = repository.listScopeCoinBalances(scopeKey, 2000);
            } else if (typeof repository.getCoinsLeaderboard === 'function') {
              balances = (repository.getCoinsLeaderboard(scopeKey, 2000) || []).map(
                (r) => Number(r.coins) || 0
              );
            }
          } catch {
            balances = [];
          }
          // Gini/saúde calculados só sobre participantes econômicos (saldo > 0);
          // membros passivos com saldo 0 não distorcem o índice.
          const economicBalances = balances.filter((c) => c > 0);
          economicPlayers = economicBalances.length;
          totalMembers = Math.max(economicPlayers, players);
          passiveMembers = Math.max(0, totalMembers - economicPlayers);
          participationRate =
            totalMembers > 0 ? Number((economicPlayers / totalMembers).toFixed(4)) : 1;
          circulatingCoins = economicBalances.reduce((a, b) => a + b, 0);
          baselineCoins = Math.max(circulatingCoins, 1);
          try {
            const meta = marketRepository?.getMeta?.(scopeKey);
            if (meta?.economy?.baselineCoins) {
              baselineCoins = Number(meta.economy.baselineCoins) || baselineCoins;
            }
          } catch {
            // keep fallback
          }

          const rawGini =
            economicBalances.length >= 2 ? computeGini(economicBalances) : 0;
          gini = Math.round(rawGini * 1000) / 1000;

          if (economicBalances.length > 0 && circulatingCoins > 0) {
            if (gini > 0.55) {
              healthStatus = 'high_inequality';
              healthLabel = 'Alta Desigualdade';
            } else if (circulatingCoins > baselineCoins * 1.3) {
              healthStatus = 'inflationary';
              healthLabel = 'Pressão Inflacionária';
            } else if (circulatingCoins < baselineCoins * 0.7) {
              healthStatus = 'deflationary';
              healthLabel = 'Contração Monetária';
            } else {
              healthStatus = 'stable';
              healthLabel = 'Estável';
            }
          }

          try {
            if (typeof repository.countActiveUsersInScope === 'function') {
              activePlayers24h = repository.countActiveUsersInScope(scopeKey);
            } else if (typeof repository.getDatabase === 'function') {
              const db = repository.getDatabase();
              const since = Date.now() - 24 * 60 * 60 * 1000;
              const row = db
                ?.prepare(
                  `SELECT COUNT(*) AS total FROM analytics.fun_user_stats WHERE scope_key = ? AND (updated_at >= ? OR last_xp_at >= ?)`
                )
                ?.get(scopeKey, since, since);
              activePlayers24h = Number(row?.total) || 0;
            }
          } catch {
            activePlayers24h = 0;
          }
        }

        let outbound = null;
        try {
          outbound = getDefaultOutboundGuard().stats();
        } catch {
          outbound = null;
        }

        sendJson(res, 200, {
          scope: isAdmin ? scopeKey : publicGroupJid(scopeKey),
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
          economy: {
            circulatingCoins,
            baselineCoins,
            healthStatus,
            healthLabel,
            gini,
            totalMembers,
            economicPlayers,
            passiveMembers,
            participationRate,
          },
          activity: {
            activePlayers24h,
          },
          botStatus: {
            uptimeSeconds: Math.floor(process.uptime()),
            socketReady: Boolean(isSocketReady()),
          },
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
        const isAdmin = hasAdminAccess(req);
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
        if (!isAdmin) {
          entries = entries.map(publicLeaderboardEntry);
        }
        sendJson(res, 200, {
          scope: isAdmin ? scope : publicGroupJid(scope),
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

      if (req.method === 'POST' && path === '/api/fun/chaos/trigger') {
        if (!requireAdmin(req, res)) return;
        const body = await readBody(req);
        const scope = String(body.scope || '').trim();
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        const cfg = getConfig();
        if (!funModule?._services?.chaosEventService?.tryStartEvent) {
          sendJson(res, 503, { error: 'servico-indisponivel' });
          return;
        }

        const started = funModule._services.chaosEventService.tryStartEvent(scope, cfg, Date.now(), { force: true });
        if (!started?.ok) {
          getLogBuffer().add({
            level: 'error',
            domain: 'casino',
            message: `Falha ao iniciar evento de Caos / PURGA: ${started?.reason || 'nao-iniciado'}`,
            scope,
          });
          sendJson(res, 400, { error: started?.reason || 'nao-iniciado' });
          return;
        }

        getLogBuffer().add({
          level: 'warn',
          domain: 'casino',
          message: 'Evento de Caos / PURGA disparado manualmente para o grupo',
          scope,
          details: { eventType: 'crime_chaos', force: true },
        });

        // Disparar anúncio de início (opcionalmente) se houver sendText / WhatsApp conectado
        const msg = funModule._services.chaosEventService.formatStartAnnouncement(started, cfg);
        if (msg && getSock?.()) {
          try {
             await sendText(getSock(), scope, msg);
          } catch (e) {
             getLogger?.()?.warn?.({ err: e }, 'falha ao enviar aviso de PURGA manual');
          }
        }
        
        sendJson(res, 200, { ok: true, eventType: 'crime_chaos' });
        return;
      }

      // --- Bolsa (read-only · público) — sem compra/venda ---
      if (req.method === 'GET' && path === '/api/fun/bolsa') {
        const scope = resolveScopeKey(url.searchParams.get('scope') || '');
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio', hint: 'use ?scope=ID_DO_GRUPO' });
          return;
        }
        if (!isScopeAllowed(scope)) {
          sendJson(res, 404, { error: 'grupo-nao-encontrado' });
          return;
        }
        if (!stockService?.publicBoard) {
          sendJson(res, 503, { error: 'bolsa-indisponivel' });
          return;
        }
        const cfg = getConfig();
        if (cfg.bolsaEnabled === false) {
          sendJson(res, 200, {
            // sem JID no payload público
            enabled: false,
            quotes: [],
            summary: { count: 0, advancing: 0, declining: 0, unchanged: 0, avgDeltaPct: 0, atHighCount: 0 },
            movers: { topGainers: [], topLosers: [], nearAth: [] },
            groupName: getContactDisplayName(scope) || '',
            tradeHint: {
              channel: 'whatsapp',
              buy: '/bolsa comprar <ticker> <qtd>',
              sell: '/bolsa vender <ticker> <qtd>',
              portfolio: '/carteira',
            },
            readOnly: true,
          });
          return;
        }
        const board = stockService.publicBoard(scope, cfg);
        // não ecoa scope/JID — o link já carrega o grupo
        const { scope: _omitScope, ...publicBoard } = board;
        sendJson(res, 200, {
          ...publicBoard,
          groupName: getContactDisplayName(scope) || '',
          readOnly: true,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/bolsa/history') {
        const scope = resolveScopeKey(url.searchParams.get('scope') || '');
        const company = String(
          url.searchParams.get('company') || url.searchParams.get('ticker') || ''
        ).trim();
        if (!scope || !company) {
          sendJson(res, 400, { error: 'scope-e-company-obrigatorios' });
          return;
        }
        if (!isScopeAllowed(scope)) {
          sendJson(res, 404, { error: 'grupo-nao-encontrado' });
          return;
        }
        if (!stockService?.publicHistory) {
          sendJson(res, 503, { error: 'bolsa-indisponivel' });
          return;
        }
        const cfg = getConfig();
        const hist = stockService.publicHistory(
          scope,
          company,
          {
            range: url.searchParams.get('range') || '',
            from: url.searchParams.get('from') || 0,
            to: url.searchParams.get('to') || 0,
            limit: url.searchParams.get('limit') || 500,
          },
          cfg
        );
        if (!hist.ok) {
          sendJson(res, 404, { error: hist.reason || 'ticker-nao-encontrado' });
          return;
        }
        // strip quote excess (sem dados sensíveis de holding)
        const quote = hist.quote
          ? {
              price: hist.quote.price,
              previousPrice: hist.quote.previousPrice,
              highPrice: hist.quote.highPrice,
              atHigh: hist.quote.atHigh,
              trend: hist.quote.trend,
              deltaPct: hist.quote.deltaPct,
              dividendYield: hist.quote.dividendYield,
            }
          : null;
        const { scope: _omitScope, quote: _q, ...publicHist } = hist;
        sendJson(res, 200, {
          ...publicHist,
          quote,
          readOnly: true,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/bolsa/events') {
        const scope = resolveScopeKey(url.searchParams.get('scope') || '');
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        if (!isScopeAllowed(scope)) {
          sendJson(res, 404, { error: 'grupo-nao-encontrado' });
          return;
        }
        const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') || 14)));
        const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') || 1)));
        const mapPublic = (e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          category: e.category,
          impactPct: e.impactPct,
          companyId: e.companyId || '',
          archetype: e.archetype || '',
          createdAt: e.createdAt,
        });
        if (typeof marketRepository?.listEventsPage === 'function') {
          const result = marketRepository.listEventsPage(scope, { page, limit });
          sendJson(res, 200, {
            events: (result.events || []).map(mapPublic),
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
            readOnly: true,
          });
          return;
        }
        // fallback legado
        const events = (marketRepository?.listRecentEvents?.(scope, limit) || []).map(mapPublic);
        sendJson(res, 200, {
          events,
          page: 1,
          limit,
          total: events.length,
          totalPages: events.length ? 1 : 0,
          readOnly: true,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/fun/economy/metrics') {
        const rawScope = url.searchParams.get('scope') || '';
        const cfg = getConfig();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const scope = resolveScopeKey(rawScope) || jids[0] || '';
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        if (!isScopeAllowed(scope)) {
          sendJson(res, 404, { error: 'grupo-nao-encontrado' });
          return;
        }

        let balances = [];
        try {
          if (typeof repository?.listScopeCoinBalances === 'function') {
            balances = repository.listScopeCoinBalances(scope, 2000) || [];
          } else if (typeof repository?.getCoinsLeaderboard === 'function') {
            balances = (repository.getCoinsLeaderboard(scope, 2000) || []).map((r) =>
              Math.max(0, Number(r.coins) || 0)
            );
          }
        } catch {
          balances = [];
        }

        // Participantes reais da economia: membros com saldo > 0.
        // Membros passivos (saldo 0, só conversam) não distorcem Gini/brackets.
        const economicBalances = balances.filter((c) => c > 0);
        const economicPlayers = economicBalances.length;
        const circulatingCoins = economicBalances.reduce((a, b) => a + b, 0);
        const gini = economicBalances.length >= 2 ? computeGini(economicBalances) : 0;

        let totalMembers = economicPlayers;
        try {
          if (typeof repository?.countUsersInScope === 'function') {
            totalMembers = Math.max(economicPlayers, repository.countUsersInScope(scope));
          }
        } catch {}
        const passiveMembers = Math.max(0, totalMembers - economicPlayers);
        const participationRate =
          totalMembers > 0 ? Number((economicPlayers / totalMembers).toFixed(4)) : 1;
        const activePlayers = economicPlayers;

        let jackpot = 0;
        try {
          jackpot = casinoRepository?.getJackpot?.(scope)?.pot || 0;
        } catch {
          jackpot = 0;
        }

        let factionsList = [];
        try {
          factionsList = factionRepository?.listByScope?.(scope) || [];
        } catch {
          factionsList = [];
        }
        const factionsCount = factionsList.length;
        const factionsVaultTotal = factionsList.reduce(
          (acc, f) => acc + (Number(f.vaultCoins) || 0),
          0
        );

        let meta = null;
        try {
          meta = marketRepository?.getMeta?.(scope);
        } catch {}
        const reg = clampKnobs({ ...defaultRegulatorKnobs(), ...(meta?.economy || {}) });
        const baselineCoins = Number(reg.baselineCoins) || Math.max(circulatingCoins, 1);

        let investedValue = 0;
        try {
          const inv = marketRepository?.listAllInventoryInScope?.(scope) || [];
          for (const row of inv) {
            const p = marketRepository?.getPrice?.(scope, row.itemId)?.price || 0;
            investedValue += p;
          }
        } catch {}

        let prices = [];
        try {
          prices = marketRepository?.listPrices?.(scope) || [];
        } catch {}
        const avgAbsDeltaPct = computeAvgAbsDelta(prices);

        let eventsLast24h = 0;
        try {
          const recent = marketRepository?.listRecentEvents?.(scope, 50) || [];
          const dayAgo = Date.now() - 24 * 60 * 60_000;
          eventsLast24h = recent.filter((e) => (e.createdAt || 0) >= dayAgo).length;
        } catch {}

        let minted = 0;
        let sunk = 0;
        const PEER_TRANSFER_REASONS = new Set(['pay', 'transfer', 'gift', 'escrow', 'marriage', 'divorce', 'trade']);
        try {
          if (typeof repository?.sumLedgerByReason === 'function') {
            const ledger = repository.sumLedgerByReason({
              scopeKey: scope,
              since: Date.now() - 24 * 60 * 60_000,
            });
            for (const row of ledger) {
              const r = String(row.reason || '').toLowerCase();
              if (!PEER_TRANSFER_REASONS.has(r)) {
                minted += Number(row.gained) || 0;
                sunk += Number(row.lost) || 0;
              }
            }
          }
        } catch {}
        const net = minted - sunk;

        const M = Math.max(1, circulatingCoins);
        const baseline = Math.max(1, baselineCoins);
        const netRatio = net / M;
        let inflationState = 'stable';
        let inflationLabel = 'Estável';

        if (M > baseline * 2.0 || (netRatio > 0.4 && M > baseline * 1.5)) {
          inflationState = 'hyperinflation';
          inflationLabel = 'Hiperinflação';
        } else if (M > baseline * 1.25 || netRatio > 0.15) {
          inflationState = 'inflationary';
          inflationLabel = 'Inflação';
        } else if (M < baseline * 0.75 || netRatio < -0.15) {
          inflationState = 'deflationary';
          inflationLabel = 'Deflação';
        } else if (gini > 0.55) {
          inflationState = 'high_inequality';
          inflationLabel = 'Alta Desigualdade';
        } else {
          inflationState = 'stable';
          inflationLabel = 'Estável';
        }

        const sorted = [...economicBalances].sort((a, b) => b - a);
        const n = sorted.length;
        const totalCoins = sorted.reduce((sum, b) => sum + b, 0);

        let top1Percent = 0;
        let top10Percent = 0;
        let bottom50Percent = 0;
        let brackets = [];

        if (n > 0 && totalCoins > 0) {
          const top1Count = Math.max(1, Math.ceil(n * 0.01));
          const top1Coins = sorted.slice(0, top1Count).reduce((a, b) => a + b, 0);
          top1Percent = Number(((top1Coins / totalCoins) * 100).toFixed(2));

          const top10Count = Math.max(1, Math.ceil(n * 0.10));
          const top10Coins = sorted.slice(0, top10Count).reduce((a, b) => a + b, 0);
          top10Percent = Number(((top10Coins / totalCoins) * 100).toFixed(2));

          const bottom50Count = n >= 2 ? Math.floor(n * 0.50) : 0;
          const bottom50Coins =
            bottom50Count > 0 ? sorted.slice(n - bottom50Count).reduce((a, b) => a + b, 0) : 0;
          bottom50Percent =
            bottom50Count > 0 ? Number(((bottom50Coins / totalCoins) * 100).toFixed(2)) : 0;

          const next9Count = Math.max(0, top10Count - top1Count);
          const next9Coins = Math.max(0, top10Coins - top1Coins);
          const next9Pct = Number(((next9Coins / totalCoins) * 100).toFixed(2));

          const middle40Count = Math.max(0, n - bottom50Count - top10Count);
          const middle40Coins = Math.max(0, totalCoins - top10Coins - bottom50Coins);
          const middle40Pct = Number(((middle40Coins / totalCoins) * 100).toFixed(2));

          brackets = [
            {
              bracket: 'Top 1%',
              players: top1Count,
              totalCoins: top1Coins,
              percentage: Number.isFinite(top1Percent) ? top1Percent : 0,
            },
            {
              bracket: 'Top 2-10%',
              players: next9Count,
              totalCoins: next9Coins,
              percentage: Number.isFinite(next9Pct) ? next9Pct : 0,
            },
            {
              bracket: 'Intermediário (10-50%)',
              players: middle40Count,
              totalCoins: middle40Coins,
              percentage: Number.isFinite(middle40Pct) ? middle40Pct : 0,
            },
            {
              bracket: 'Base 50%',
              players: bottom50Count,
              totalCoins: bottom50Coins,
              percentage: Number.isFinite(bottom50Percent) ? bottom50Percent : 0,
            },
          ];
        } else {
          brackets = [
            { bracket: 'Top 1%', players: 0, totalCoins: 0, percentage: 0 },
            { bracket: 'Top 2-10%', players: 0, totalCoins: 0, percentage: 0 },
            { bracket: 'Intermediário (10-50%)', players: 0, totalCoins: 0, percentage: 0 },
            { bracket: 'Base 50%', players: 0, totalCoins: 0, percentage: 0 },
          ];
        }

        sendJson(res, 200, {
          ok: true,
          scope,
          groupName: getContactDisplayName(scope) || '',
          circulatingCoins,
          baselineCoins,
          gini,
          activePlayers,
          totalMembers,
          economicPlayers,
          passiveMembers,
          participationRate,
          investedValue,
          avgAbsDeltaPct,
          eventsLast24h,
          inflationState,
          inflationLabel,
          mintSink24h: {
            minted,
            sunk,
            net,
          },
          jackpot,
          factionsCount,
          factionsVaultTotal,
          regulator: {
            volMult: reg.volMult ?? 1,
            eventImpactMult: reg.eventImpactMult ?? 1,
            eventFreqMult: reg.eventFreqMult ?? 1,
            rewardMult: reg.rewardMult ?? 1,
            restockMult: reg.restockMult ?? 1,
            flowScale: reg.flowScale ?? 500,
            baseNoisePct: reg.baseNoisePct ?? 0.012,
            deceptionRate: reg.deceptionRate ?? 0.12,
            shockDecay: reg.shockDecay ?? 0.85,
            volumeDecay: reg.volumeDecay ?? 0.72,
            lastRegulateAt: reg.lastRegulateAt ?? 0,
            narrativeSeeds: Array.isArray(reg.narrativeSeeds) ? reg.narrativeSeeds : [],
          },
          wealthDistribution: {
            top1Percent,
            top10Percent,
            bottom50Percent,
            brackets,
          },
        });
        return;
      }

      if (req.method === 'POST' && path === '/api/fun/economy/intervene') {
        if (!requireAdmin(req, res)) return;
        const body = await readBody(req);
        const scope = resolveScopeKey(body.scope);
        if (!scope) {
          sendJson(res, 400, { error: 'scope obrigatorio' });
          return;
        }
        if (!isScopeAllowed(scope)) {
          sendJson(res, 404, { error: 'grupo-nao-encontrado' });
          return;
        }
        const action = String(body.action || '').trim();
        if (!action) {
          sendJson(res, 400, { error: 'action obrigatoria' });
          return;
        }

        if (action === 'inject_jackpot') {
          const amount = Math.floor(Number(body.amount) || 0);
          if (amount <= 0) {
            sendJson(res, 400, { error: 'amount deve ser maior que zero' });
            return;
          }
          const prevPot = casinoRepository?.getJackpot?.(scope)?.pot || 0;
          const updated = casinoRepository?.addJackpot?.(scope, amount);
          const newPot = updated?.pot ?? (prevPot + amount);
          sendJson(res, 200, {
            ok: true,
            action,
            message: `Injetados ${amount} coins no Jackpot com sucesso.`,
            previousValue: prevPot,
            newValue: newPot,
          });
          return;
        }

        if (action === 'burn_jackpot') {
          const prevPot = casinoRepository?.getJackpot?.(scope)?.pot || 0;
          const rawAmount =
            body.amount !== undefined && body.amount !== null ? Math.floor(Number(body.amount)) : null;
          const toBurn =
            rawAmount === null || isNaN(rawAmount) || rawAmount <= 0
              ? prevPot
              : Math.min(prevPot, rawAmount);
          let newPot = Math.max(0, prevPot - toBurn);
          if (typeof casinoRepository?.burnJackpot === 'function') {
            const resBurn = casinoRepository.burnJackpot(scope, toBurn);
            newPot = resBurn?.pot ?? newPot;
          } else if (typeof casinoRepository?.takeJackpot === 'function') {
            if (toBurn >= prevPot) {
              casinoRepository.takeJackpot(scope);
              newPot = 0;
            } else {
              casinoRepository.takeJackpot(scope);
              if (newPot > 0 && typeof casinoRepository?.addJackpot === 'function') {
                casinoRepository.addJackpot(scope, newPot);
              }
            }
          }
          sendJson(res, 200, {
            ok: true,
            action,
            message: `Queimados ${toBurn} coins do Jackpot com sucesso.`,
            previousValue: prevPot,
            newValue: newPot,
          });
          return;
        }

        if (action === 'set_baseline') {
          const amount = Math.floor(Number(body.amount));
          if (isNaN(amount) || amount <= 0 || amount > 100_000_000_000) {
            sendJson(res, 400, {
              error: 'amount deve ser um numero valido entre 1 e 100.000.000.000',
            });
            return;
          }
          const meta = marketRepository?.getMeta?.(scope) || {};
          const reg = clampKnobs({ ...defaultRegulatorKnobs(), ...(meta.economy || {}) });
          const prevBaseline = Number(reg.baselineCoins) || 0;
          reg.baselineCoins = amount;
          const clamped = clampKnobs(reg);
          clamped.baselineCoins = amount;
          marketRepository?.setMeta?.(scope, { economy: clamped });
          sendJson(res, 200, {
            ok: true,
            action,
            message: `Baseline monetário ajustado para ${amount} coins com sucesso.`,
            previousValue: prevBaseline,
            newValue: amount,
          });
          return;
        }

        if (action === 'trigger_seed') {
          const rawSeed = String(body.seed || '').trim().toLowerCase();
          const seed = rawSeed.replace(/[^a-z0-9_-]/g, '_').slice(0, 32);
          if (!seed) {
            sendJson(res, 400, { error: 'seed obrigatoria e deve conter caracteres validos' });
            return;
          }
          const meta = marketRepository?.getMeta?.(scope) || {};
          const reg = clampKnobs({ ...defaultRegulatorKnobs(), ...(meta.economy || {}) });
          const prevSeeds = [...(reg.narrativeSeeds || [])];
          if (!reg.narrativeSeeds) reg.narrativeSeeds = [];
          if (!reg.narrativeSeeds.includes(seed)) {
            reg.narrativeSeeds.push(seed);
          }
          reg.narrativeSeeds = reg.narrativeSeeds.slice(-6);
          const clamped = clampKnobs(reg);
          if (reg.baselineCoins) clamped.baselineCoins = reg.baselineCoins;
          marketRepository?.setMeta?.(scope, { economy: clamped });
          sendJson(res, 200, {
            ok: true,
            action,
            message: `Semente narrativa '${seed}' ativada com sucesso no Regulador Invisível.`,
            previousValue: prevSeeds,
            newValue: clamped.narrativeSeeds,
          });
          return;
        }

        if (action === 'adjust_knobs') {
          const knobs = body.knobs;
          if (!knobs || typeof knobs !== 'object') {
            sendJson(res, 400, { error: 'knobs obrigatorio' });
            return;
          }
          const meta = marketRepository?.getMeta?.(scope) || {};
          const reg = { ...defaultRegulatorKnobs(), ...(meta.economy || {}) };
          const allowedKnobs = [
            'volMult',
            'eventImpactMult',
            'eventFreqMult',
            'rewardMult',
            'restockMult',
            'flowScale',
            'baseNoisePct',
            'deceptionRate',
            'shockDecay',
            'volumeDecay',
          ];
          const prevKnobs = {};
          for (const k of allowedKnobs) {
            prevKnobs[k] = reg[k];
          }
          for (const [k, v] of Object.entries(knobs)) {
            if (allowedKnobs.includes(k) && typeof v === 'number' && !Number.isNaN(v)) {
              reg[k] = v;
            }
          }
          const clamped = clampKnobs(reg);
          if (reg.baselineCoins) clamped.baselineCoins = reg.baselineCoins;
          marketRepository?.setMeta?.(scope, { economy: clamped });
          const newKnobs = {};
          for (const k of allowedKnobs) {
            newKnobs[k] = clamped[k];
          }
          sendJson(res, 200, {
            ok: true,
            action,
            message: 'Knobs do Regulador Invisível ajustados com sucesso.',
            previousValue: prevKnobs,
            newValue: newKnobs,
          });
          return;
        }

        sendJson(res, 400, { error: `acao-desconhecida: ${action}` });
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
          practiceAvailable: opened.practiceAvailable !== false,
          practiceUsed: Boolean(opened.practiceUsed),
          practiceScore: Number(opened.practiceScore) || 0,
        });
        return;
      }

      // Reserva treino grátis (1× por attempt — banco, não localStorage)
      if (req.method === 'POST' && path === '/api/fun/job/practice/claim') {
        if (!jobService) {
          sendJson(res, 503, { error: 'job-service-unavailable' });
          return;
        }
        const body = await readBody(req);
        const cfg = getConfig();
        const claimed = jobService.claimPractice({
          attemptId: body.attemptId || '',
          token: body.token || '',
          funConfig: cfg,
        });
        if (!claimed.ok) {
          sendJson(res, 400, {
            ok: false,
            reason: claimed.reason,
            practiceAvailable: false,
            practiceUsed: true,
            practiceScore: Number(claimed.practiceScore) || 0,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          practiceAvailable: false,
          practiceUsed: true,
          attemptId: claimed.attempt?.id,
        });
        return;
      }

      // Pontuação do treino (não contrata, não aplica CD)
      if (req.method === 'POST' && path === '/api/fun/job/practice/finish') {
        if (!jobService) {
          sendJson(res, 503, { error: 'job-service-unavailable' });
          return;
        }
        const body = await readBody(req);
        const cfg = getConfig();
        const finished = jobService.finishPractice({
          attemptId: body.attemptId || '',
          token: body.token || '',
          score: body.score,
          metrics: body.metrics || {},
          funConfig: cfg,
        });
        if (!finished.ok) {
          sendJson(res, 400, { ok: false, reason: finished.reason });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          practice: true,
          practiceUsed: true,
          practiceAvailable: false,
          score: finished.score,
          jobId: finished.job?.id,
          jobName: finished.job?.name,
          emoji: finished.job?.emoji,
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
          if (!requireAdmin(req, res)) return;
          const body = await readBody(req);
          const saved = groupRepository.upsertGroupSettings({
            groupJid,
            ...body,
          });
          sendJson(res, 200, { ok: true, settings: saved });
          return;
        }
      }

      // --- Changelog admin (broadcast em todos os grupos whitelist) ---
      if (req.method === 'GET' && path === '/api/fun/changelog') {
        const limit = Number(url.searchParams.get('limit') || 20);
        const history =
          typeof funModule.listChangelogHistory === 'function'
            ? funModule.listChangelogHistory({ limit })
            : [];
        const cfg = getConfig();
        const jids = Array.isArray(cfg.groupWhitelistJids) ? cfg.groupWhitelistJids : [];
        const groups = jids
          .filter((j) => String(j).endsWith('@g.us'))
          .map((jid) => ({
            jid,
            name: getContactDisplayName(jid) || '',
          }));
        sendJson(res, 200, {
          whatsappReady: Boolean(isSocketReady()),
          groups,
          history,
        });
        return;
      }

      if (req.method === 'POST' && path === '/api/fun/daily-challenge/launch-all') {
        if (!requireAdmin(req, res)) return;
        if (typeof funModule.launchDailyChallengeForWhitelist !== 'function') {
          sendJson(res, 503, { error: 'daily-challenge-unavailable' });
          return;
        }
        if (!isSocketReady()) {
          sendJson(res, 503, { error: 'whatsapp-offline', reason: 'whatsapp-offline' });
          return;
        }
        const body = await readBody(req);
        const result = await funModule.launchDailyChallengeForWhitelist({
          type: body.type,
          sock: getSock?.(),
          sendText,
        });
        getLogBuffer().add({
          level: result.ok ? 'info' : 'warn',
          domain: 'games',
          message: `Lançamento de desafios diários (${body.type || 'aleatório'}): ${result.okCount || 0} criados, ${result.failCount || 0} falhas`,
          details: { type: body.type, okCount: result.okCount, failCount: result.failCount },
        });
        if (!result.ok && ['invalid-type', 'no-groups'].includes(result.reason)) {
          sendJson(res, 400, { error: result.reason, ...result });
          return;
        }
        if (!result.ok && ['whatsapp-offline', 'daily-challenge-disabled', 'daily-challenge-unavailable'].includes(result.reason)) {
          sendJson(res, 503, { error: result.reason, ...result });
          return;
        }
        sendJson(res, result.ok ? 200 : 207, result);
        return;
      }

      if (req.method === 'POST' && path === '/api/fun/changelog') {
        if (!requireAdmin(req, res)) return;
        if (typeof funModule.broadcastChangelog !== 'function') {
          sendJson(res, 503, { error: 'changelog-indisponivel' });
          return;
        }
        const body = await readBody(req);
        const dryRun = body.dryRun === true || body.preview === true;
        const result = await funModule.broadcastChangelog({
          title: body.title,
          version: body.version,
          body: body.body || body.message || body.text,
          lines: body.lines,
          groupJids: body.groupJids || body.groups,
          dryRun,
          sock: getSock?.(),
          sendText,
        });
        getLogBuffer().add({
          level: result.ok || dryRun ? 'info' : 'warn',
          domain: 'whatsapp',
          message: dryRun
            ? `Simulação de broadcast de changelog: ${body.version || 'v?'}`
            : `Broadcast de changelog disparado: ${result.okCount || 0} enviados, ${result.failCount || 0} falhas`,
          details: { dryRun, version: body.version, okCount: result.okCount, failCount: result.failCount },
        });
        if (!result.ok && result.reason === 'empty-body') {
          sendJson(res, 400, { error: 'body-obrigatorio', ...result });
          return;
        }
        if (!result.ok && result.reason === 'no-groups') {
          sendJson(res, 400, { error: 'nenhum-grupo-na-whitelist', ...result });
          return;
        }
        if (!result.ok && result.reason === 'whatsapp-offline') {
          sendJson(res, 503, {
            error: 'whatsapp-offline',
            message: 'Sessão WhatsApp não está pronta. Abra o bot e escaneie o QR se precisar.',
            ...result,
          });
          return;
        }
        if (!result.ok && result.reason === 'too-long') {
          sendJson(res, 400, { error: 'mensagem-muito-longa', ...result });
          return;
        }
        sendJson(res, result.ok || dryRun ? 200 : 207, result);
        return;
      }

      // --- Logs Operacionais em Tempo Real ---
      if (req.method === 'GET' && path === '/api/fun/logs') {
        const since = Number(url.searchParams.get('since') || 0);
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam !== null && limitParam !== '' ? Math.max(1, parseInt(limitParam, 10) || 100) : 100;
        const level = url.searchParams.get('level') || 'all';
        const domain = url.searchParams.get('domain') || 'all';
        const search = url.searchParams.get('search') || '';
        const rawScope = url.searchParams.get('scope') || '';
        const scope = resolveScopeKey(rawScope);

        const buffer = getLogBuffer();
        const data = buffer.getLogs({
          since,
          limit,
          level,
          domain,
          search,
          scope,
        });

        sendJson(res, 200, {
          ok: true,
          ...data,
        });
        return;
      }

      if (path.startsWith('/api/fun/selfheal/') && !requireAdmin(req, res)) return;

      const selfHealService = funModule._services.selfHealingService;
      const selfHealRepository = funModule._services.selfHealRepository;
      const evidenceRepository = funModule._services.evidenceRepository;
      if (req.method === 'GET' && path === '/api/fun/selfheal/config') {
        sendJson(res, 200, selfHealConfig());
        return;
      }
      if (req.method === 'POST' && path === '/api/fun/selfheal/config') {
        const body = await readBody(req);
        const current = getConfig();
        const next = normalizeFunConfig({
          ...current,
          ...(Object.hasOwn(body, 'enabled') ? { selfHealEnabled: body.enabled } : {}),
          ...(Object.hasOwn(body, 'dryRun') ? { selfHealDryRun: body.dryRun } : {}),
          ...(Object.hasOwn(body, 'intervalMs') ? { selfHealIntervalMs: body.intervalMs } : {}),
          ...(Object.hasOwn(body, 'evidenceRetentionDays') ? { selfHealEvidenceRetentionDays: body.evidenceRetentionDays } : {}),
          ...(Object.hasOwn(body, 'maxItemsPerRun') ? { selfHealMaxItemsPerRun: body.maxItemsPerRun } : {}),
          ...(Object.hasOwn(body, 'maxCallsPerRun') ? { selfHealMaxCallsPerRun: body.maxCallsPerRun } : {}),
        });
        saveConfig(next);
        sendJson(res, 200, { ok: true, config: selfHealConfig(next), persisted: true, appliesAfterConfigReload: true });
        return;
      }
      if (req.method === 'POST' && path === '/api/fun/selfheal/run') {
        const currentCfg = getConfig();
        if (currentCfg.selfHealEnabled === false) {
          sendJson(res, 400, { ok: false, error: 'selfheal-desativado', reason: 'self-heal-disabled' });
          return;
        }
        if (!selfHealService?.runSweep) {
          sendJson(res, 503, { error: 'selfheal-indisponivel' });
          return;
        }
        const body = await readBody(req);
        const domain = body.domain ? String(body.domain) : 'memory_lore';
        const requestedScope = resolveScopeKey(body.scopeKey);
        if (requestedScope && !isScopeAllowed(requestedScope)) {
          sendJson(res, 403, { error: 'scope-not-allowed' });
          return;
        }
        const scopes = requestedScope ? [requestedScope] : (getConfig().groupWhitelistJids || []);
        if (!scopes.length) {
          sendJson(res, 400, { error: 'scope-obrigatorio-ou-whitelist-vazia' });
          return;
        }
        const results = [];
        for (const scopeKey of scopes) results.push(await selfHealService.runSweep({ scopeKey, domain, ...(typeof body.dryRun === 'boolean' ? { dryRun: body.dryRun } : {}) }));
        const first = results[0] || {};
        getLogBuffer().add({
          level: 'info',
          domain: 'system',
          message: `Motor de auto-aprimoramento disparado: ${domain}`,
          details: { domain, scopesCount: scopes.length, ok: results.every((r) => r.ok) },
        });
        sendJson(res, first.ok ? 200 : 409, { ok: results.every(result => result.ok), runId: first.runId, mode: first.mode, results, reason: first.reason });
        return;
      }
      if (req.method === 'GET' && path === '/api/fun/selfheal/runs') {
        const runs = selfHealRepository?.listRuns?.({ domain: url.searchParams.get('domain'), scopeKey: resolveScopeKey(url.searchParams.get('scope')), from: url.searchParams.get('from'), to: url.searchParams.get('to') }) || [];
        sendJson(res, 200, { runs });
        return;
      }
      if (req.method === 'GET' && path === '/api/fun/selfheal/audit') {
        const entries = selfHealRepository?.listAudit?.({ runId: url.searchParams.get('runId'), scopeKey: resolveScopeKey(url.searchParams.get('scope')), status: url.searchParams.get('status'), domain: url.searchParams.get('domain'), action: url.searchParams.get('action') }) || [];
        const includeBeforeAfter = url.searchParams.get('includeBeforeAfter') === 'true';
        sendJson(res, 200, { entries: entries.map(({ before, after, ...entry }) => includeBeforeAfter ? { ...entry, before, after } : entry) });
        return;
      }
      if (req.method === 'POST' && path === '/api/fun/selfheal/review') {
        const body = await readBody(req);
        const result = selfHealRepository?.reviewFinding?.(body.findingId, { decision: body.decision, adminJid: String(req.headers['x-admin-jid'] || 'dashboard') }) || { ok: false, reason: 'selfheal-indisponivel' };
        sendJson(res, result.ok ? 200 : result.reason === 'already-decided' ? 409 : 400, result.ok ? { ok: true, entry: result.finding } : result);
        return;
      }
      if (req.method === 'GET' && path === '/api/fun/selfheal/summary') {
        const rows = selfHealRepository?.getSummary?.() || [];
        const totals = { runs: selfHealRepository?.listRuns?.().length || 0, applied: 0, pendingReview: 0, rejected: 0, simulated: 0, errors: 0 };
        const byDomain = {};
        for (const row of rows) {
          const key = row.status === 'pending_review' ? 'pendingReview' : row.status === 'error' ? 'errors' : row.status;
          if (Object.hasOwn(totals, key)) totals[key] += Number(row.count) || 0;
          if (!byDomain[row.domain]) byDomain[row.domain] = {};
          if (Object.hasOwn(totals, key)) byDomain[row.domain][key] = Number(row.count) || 0;
        }
        const evidenceRows = (getConfig().groupWhitelistJids || []).reduce((total, scopeKey) => total + (evidenceRepository?.countByScope?.(scopeKey) || 0), 0);
        sendJson(res, 200, { totals, byDomain, evidence: { rows: evidenceRows, retentionDays: getConfig().selfHealEvidenceRetentionDays } });
        return;
      }

      sendJson(res, 404, { error: 'not-found' });
    } catch (err) {
      const status = Number(err?.status) || 500;
      const code = err?.code || String(err?.message || err);
      if (status >= 500) {
        getLogger?.()?.error?.({ err: code }, 'fun dashboard error');
      }
      if (!res.headersSent) sendJson(res, status, { error: code });
      else if (!res.writableEnded) res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`[fun] Dashboard API: http://${host}:${port}`);
      console.log(`[fun] Dashboard UI (Next): http://127.0.0.1:${uiPort}  → npm run fun:dashboard`);
      getLogBuffer().add({
        level: 'info',
        domain: 'system',
        message: `Servidor HTTP do Fun Dashboard operacional em http://${host}:${port}`,
      });
      resolve(server);
    });
  });
}
