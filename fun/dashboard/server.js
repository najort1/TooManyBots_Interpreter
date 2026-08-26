/**
 * Fun Dashboard API — HTTP JSON only.
 * UI: Next.js em `fun_dashboard/` (não embute HTML monolítico).
 */

import http from 'http';
import { URL } from 'url';
import { getDefaultOutboundGuard } from '../../engine/outboundGuard.js';
import { normalizeFunConfig, saveFunUserConfig } from '../config.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { createHouseRealtimeHub } from '../services/houseRealtimeService.js';
import { getPublicBaseUrl } from '../utils/publicUrl.js';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-House-Token');
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
    marketRepository = null,
    houseRepository = null,
    houseService = null,
    houseLinkService = null,
    avatarService = null,
    visitService = null,
    giftService = null,
    robberyService = null,
  } = funModule._services;

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
    return jids.includes(scopeKey);
  }

  function houseServicesAvailable() {
    return Boolean(houseService && houseLinkService && avatarService && visitService && giftService && robberyService);
  }

  async function resolveHouseToken(token) {
    return houseLinkService?.resolve?.(String(token || '').trim()) || null;
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

  function requireAdmin(req, res) {
    if (!dashboardApiKey) return true;
    const headerKey = String(req.headers['x-api-key'] || '').trim();
    const cookieKey = String(req.headers.cookie || '').match(/(?:^|;\s*)fun_dash_key=([^;]+)/)?.[1] || '';
    if (headerKey === dashboardApiKey || decodeURIComponent(cookieKey) === dashboardApiKey) return true;
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }

  function selfHealConfig(cfg = getConfig()) {
    return {
      enabled: cfg.selfHealEnabled !== false,
      intervalMs: cfg.selfHealIntervalMs,
      dryRun: cfg.selfHealDryRun !== false,
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
        const owns = true;
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
          const authToken = String(req.headers['x-house-token'] || '').trim();
          const actor = authToken ? await resolveHouseToken(authToken) : null;
          if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
          if (actor.scopeKey !== target.scopeKey || actor.userJid !== target.userJid) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
          const body = await readBody(req);
          if (req.method === 'POST' && neighborMatch[2] === 'visit') {
            const result = visitService.visit({ scopeKey: target.scopeKey, ownerJid: neighbor.userJid, visitorJid: actor.userJid, note: body.note, funConfig: cfg });
            sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, visit: { note: result.visit.note, createdAt: result.visit.createdAt } } : { error: result.reason });
            return;
          }
          if (req.method === 'POST' && neighborMatch[2] === 'gifts') {
            const result = giftService.give({ scopeKey: target.scopeKey, giverJid: actor.userJid, recipientJid: neighbor.userJid, itemInstanceId: body.itemId, coins: body.coins, funConfig: cfg });
            sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, gift: { coins: result.gift.coins, itemId: result.gift.itemInstanceId } } : { error: result.reason });
            return;
          }
          if (req.method === 'POST' && neighborMatch[2] === 'rob') {
            const result = robberyService.rob({ scopeKey: target.scopeKey, robberJid: actor.userJid, ownerJid: neighbor.userJid, funConfig: cfg });
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
          if (!owns) { sendJson(res, 403, { error: 'house-token-required' }); return; }
          sendJson(res, 200, avatarService.get({ scopeKey: target.scopeKey, userJid: target.userJid }));
          return;
        }
        if (req.method === 'GET' && action === 'visits') {
          if (!owns) { sendJson(res, 403, { error: 'house-token-required' }); return; }
          const visits = visitService.mural({ scopeKey: target.scopeKey, ownerJid: target.userJid }).visits.map((visit) => ({ id: visit.id, note: visit.note, createdAt: visit.createdAt, nickname: getContactDisplayName(visit.visitorJid) || 'Visitante' }));
          sendJson(res, 200, { visits });
          return;
        }

        const authToken = String(req.headers['x-house-token'] || '').trim();
        const actor = authToken ? await resolveHouseToken(authToken) : null;
        if (!actor) { sendJson(res, 401, { error: 'house-token-required' }); return; }
        if (actor.scopeKey !== target.scopeKey) { sendJson(res, 403, { error: 'fora-do-bairro' }); return; }
        const body = await readBody(req);
        if (req.method === 'POST' && action === 'collect') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.collect({ scopeKey: target.scopeKey, userJid: target.userJid, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, coins: result.coins, reason: result.reason } : { error: result.reason, nextAt: result.nextAt });
          return;
        }
        if (req.method === 'PUT' && action === 'items/move') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.move({ scopeKey: target.scopeKey, userJid: target.userJid, itemInstanceId: body.itemId, x: body.x, y: body.y, rotation: body.rotation, rotated: body.rotated });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, item: publicHouseItem(result.item) } : { error: result.reason });
          return;
        }
        if (req.method === 'PUT' && action === 'styles/apply') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.applyStyle({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, house: result.house, coins: result.coins, purchased: result.purchased } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'POST' && action === 'items/place') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.place({ scopeKey: target.scopeKey, userJid: target.userJid, itemId: body.itemId, x: body.x, y: body.y, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, item: publicHouseItem(result.item), coins: result.coins } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'POST' && action === 'items/sell') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.sell({ scopeKey: target.scopeKey, userJid: target.userJid, itemInstanceId: body.itemId });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, coins: result.coins } : { error: result.reason });
          return;
        }
        if (req.method === 'POST' && action === 'security') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
          const result = houseService.upgradeSecurity({ scopeKey: target.scopeKey, userJid: target.userJid, funConfig: cfg });
          sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, house: result.house, coins: result.coins } : { error: result.reason, need: result.need, coins: result.coins });
          return;
        }
        if (req.method === 'PUT' && action === 'avatar') {
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
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
          if (!owns) { sendJson(res, 403, { error: 'somente-dono' }); return; }
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

      if (req.method === 'POST' && path === '/api/fun/chaos/trigger') {
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
          sendJson(res, 400, { error: started?.reason || 'nao-iniciado' });
          return;
        }
        
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
        saveFunUserConfig(next);
        sendJson(res, 200, { ok: true, config: selfHealConfig(next), persisted: true, appliesAfterConfigReload: true });
        return;
      }
      if (req.method === 'POST' && path === '/api/fun/selfheal/run') {
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
      resolve(server);
    });
  });
}
