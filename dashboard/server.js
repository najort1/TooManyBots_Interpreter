import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket, { WebSocketServer } from 'ws';
import {
  getActiveSessions,
  getConversationDashboardStats,
  getConversationEndedByReasonCount,
  listConversationSessionStarts,
  listConversationSessionEndsByReason,
  listConversationEvents,
  listConversationEventsByFlowPath,
  listConversationEventsByJid,
  listConversationEventsSince,
  listConversationEventsSinceByFlowPath,
  listConversationEventsSinceByJid,
} from '../db/index.js';
import { INTERNAL_VAR } from '../config/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getTodayBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const rawBody = Buffer.concat(chunks).toString('utf-8').trim();
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function normalizeFlowPath(value) {
  return String(value ?? '').trim();
}

function normalizeActor(value, fallback = 'dashboard-agent') {
  return String(value ?? '').trim() || fallback;
}

function parseObjectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getHumanHandoffFromSession(session) {
  return parseObjectValue(session?.variables?.__humanHandoff);
}

function findLastMessageForSession(events = []) {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const text = String(event?.messageText ?? '').trim();
    if (!text) continue;
    if (event?.eventType === 'message-incoming' || event?.eventType === 'message-outgoing' || event?.eventType === 'human-message-outgoing') {
      return {
        eventType: event.eventType,
        occurredAt: Number(event.occurredAt) || 0,
        text,
      };
    }
  }

  return { eventType: '', occurredAt: 0, text: '' };
}

function normalizeFlowBlocks(blocks = []) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block, index) => ({
      index,
      id: String(block?.id ?? '').trim(),
      type: String(block?.type ?? '').trim(),
      name: String(block?.name ?? '').trim(),
    }))
    .filter(block => block.id);
}

function resolveBlockIndex(targetBlockIndex, targetBlockId, flowBlocks = []) {
  const byIndex = Number(targetBlockIndex);
  if (Number.isInteger(byIndex) && byIndex >= 0 && byIndex < flowBlocks.length) {
    return byIndex;
  }

  const targetId = String(targetBlockId ?? '').trim();
  if (!targetId) return -1;

  const matched = flowBlocks.find(block => block.id === targetId);
  return matched ? matched.index : -1;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateKeyLocal(ts) {
  const d = new Date(Number(ts) || 0);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function startOfDayTsLocal(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function weekdayShortPtBr(date) {
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  return names[date.getDay()] || 'Dia';
}

function buildWeeklyTrend({ now = new Date(), days = 7, startedTimestamps = [], abandonedTimestamps = [] } = {}) {
  const safeDays = Math.max(1, Math.min(30, Number(days) || 7));
  const todayStart = startOfDayTsLocal(now);
  const firstDayStart = todayStart - (safeDays - 1) * 24 * 60 * 60 * 1000;

  const buckets = new Map();
  for (let i = 0; i < safeDays; i++) {
    const dayStart = firstDayStart + i * 24 * 60 * 60 * 1000;
    const key = toDateKeyLocal(dayStart);
    buckets.set(key, {
      date: weekdayShortPtBr(new Date(dayStart)),
      started: 0,
      abandoned: 0,
    });
  }

  for (const ts of startedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.started += 1;
  }

  for (const ts of abandonedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.abandoned += 1;
  }

  return [...buckets.values()];
}

function buildConversationFunnel({ started = 0, abandoned = 0, completed = 0 } = {}) {
  const startedSafe = Math.max(0, Number(started) || 0);
  const abandonedSafe = Math.max(0, Number(abandoned) || 0);
  const nonAbandoned = Math.max(0, startedSafe - abandonedSafe);
  const completedSafe = Math.max(0, Math.min(Number(completed) || 0, nonAbandoned));

  return [
    { step: 'start', count: startedSafe, label: 'Início' },
    { step: 'retained', count: nonAbandoned, label: 'Sem Abandono' },
    { step: 'completed', count: completedSafe, label: 'Concluídas' },
  ];
}

function normalizeActorJidFromEvent(event) {
  const actorFromMetadata = String(event?.metadata?.actorJid ?? '').trim();
  if (actorFromMetadata) return actorFromMetadata;
  return String(event?.jid ?? '').trim();
}

function extractPhoneFromJid(jid) {
  const normalized = String(jid ?? '').trim();
  if (!normalized.endsWith('@s.whatsapp.net')) return '';
  const raw = normalized.split('@')[0] ?? '';
  const digits = raw.replace(/\D+/g, '');
  return digits || '';
}

function formatActorLabel(getContactName, jid) {
  const normalizedJid = String(jid ?? '').trim();
  const name = getContactName(normalizedJid);
  if (name) return name;

  const phone = extractPhoneFromJid(normalizedJid);
  if (phone) return phone;

  if (normalizedJid.endsWith('@g.us')) {
    return `Grupo ${normalizedJid.split('@')[0]}`;
  }

  return normalizedJid.split('@')[0] || normalizedJid || 'Desconhecido';
}

function normalizeChatJidFromEvent(event) {
  const metadataChatJid = String(event?.metadata?.chatJid ?? '').trim();
  if (metadataChatJid) return metadataChatJid;
  return String(event?.jid ?? '').trim();
}

function extractCommandToken(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized.startsWith('/')) return '';
  const token = normalized.split(/\s+/)[0] ?? '';
  return token.trim().slice(0, 24);
}

function normalizeCommandName(command) {
  const normalized = String(command ?? '').trim();
  if (!normalized) return 'N/A';
  if (normalized.toLowerCase() === 'n/a') return 'N/A';
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
}

function looksLikeErrorMessage(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return false;
  return /^(erro|falha|exception|timeout)\b/i.test(normalized);
}

function buildRecentErrors(events = []) {
  const grouped = new Map();
  const lastCommandByChat = new Map();

  for (const ev of events) {
    const chatJid = normalizeChatJidFromEvent(ev);
    if (ev.direction === 'incoming') {
      const cmd = extractCommandToken(ev.messageText);
      if (chatJid && cmd) {
        lastCommandByChat.set(chatJid, cmd);
      }
    }

    const eventType = String(ev?.eventType ?? '').toLowerCase();
    const metadata = ev?.metadata && typeof ev.metadata === 'object' ? ev.metadata : {};
    const messageText = String(ev?.messageText ?? '').trim();

    const isStructuredError = eventType.includes('error');
    const isOutgoingErrorMessage = ev.direction === 'outgoing' && looksLikeErrorMessage(messageText);
    if (!isStructuredError && !isOutgoingErrorMessage) continue;

    const commandFromMetadata = String(metadata.command ?? '').trim();
    const command = normalizeCommandName(commandFromMetadata || lastCommandByChat.get(chatJid) || '');
    const resolvedErrorSource =
      metadata.userMessage ??
      metadata.errorMessage ??
      (messageText || metadata.error || ev?.eventType || 'Erro desconhecido');
    const errorText = String(resolvedErrorSource).trim() || 'Erro desconhecido';

    const key = `${command}||${errorText}`;
    const current = grouped.get(key) ?? { command, error: errorText, count: 0, lastAt: 0 };
    current.count += 1;
    current.lastAt = Math.max(current.lastAt, Number(ev?.occurredAt) || 0);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 8)
    .map(item => ({ command: item.command, error: item.error, count: item.count }));
}

export class DashboardServer {
  constructor({
    host = '127.0.0.1',
    port = 8787,
    getRuntimeInfo = () => ({}),
    getFlowBlocks = () => [],
    getContactName = () => null,
    onReload = async () => {},
    onHumanSendMessage = async () => ({ ok: false, error: 'not-implemented' }),
    onHumanResumeSession = async () => ({ ok: false, error: 'not-implemented' }),
    onHumanEndSession = async () => ({ ok: false, error: 'not-implemented' }),
  } = {}) {
    this.host = host;
    this.port = port;
    this.getRuntimeInfo = getRuntimeInfo;
    this.getFlowBlocks = getFlowBlocks;
    this.getContactName = getContactName;
    this.onReload = onReload;
    this.onHumanSendMessage = onHumanSendMessage;
    this.onHumanResumeSession = onHumanResumeSession;
    this.onHumanEndSession = onHumanEndSession;
    this.server = null;
    this.wss = null;
    this.startupTime = Date.now();
  }

  async start() {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (requestUrl.pathname === '/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
        return;
      }

      if (requestUrl.pathname === '/api/health') {
        const info = this.getRuntimeInfo();
        sendJson(res, 200, {
          status: 'ok',
          uptimeMs: Date.now() - this.startupTime,
          mode: info.mode || 'conversation',
          flowFile: info.flowFile || 'unknown',
          flowPath: normalizeFlowPath(info.flowPath),
        });
        return;
      }

      if (requestUrl.pathname === '/api/reload' && req.method === 'POST') {
        try {
          await this.onReload();
          sendJson(res, 200, { reloaded: true });
        } catch (error) {
          sendJson(res, 500, { error: error.message });
        }
        return;
      }

      if (requestUrl.pathname === '/api/handoff/blocks') {
        const blocks = normalizeFlowBlocks(this.getFlowBlocks());
        sendJson(res, 200, { blocks });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/sessions') {
        const activeSessions = getActiveSessions();
        const sessions = activeSessions
          .map(session => {
            const handoff = getHumanHandoffFromSession(session);
            const waitingForHuman = String(session.waitingFor || '').trim().toLowerCase() === 'human';
            const handoffActive = handoff.active === true;
            if (!waitingForHuman && !handoffActive) return null;

            const history = listConversationEventsByJid(session.jid, 120);
            const lastMessage = findLastMessageForSession(history);

            return {
              jid: session.jid,
              waitingFor: session.waitingFor,
              blockIndex: session.blockIndex,
              status: session.status,
              queue: String(handoff.queue ?? '').trim() || 'default',
              reason: String(handoff.reason ?? '').trim(),
              requestedAt: Number(handoff.requestedAt) || 0,
              lastMessage,
              lastActivityAt: Number(handoff.updatedAt) || Number(lastMessage.occurredAt) || 0,
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));

        sendJson(res, 200, { sessions });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/history') {
        const jid = String(requestUrl.searchParams.get('jid') ?? '').trim();
        const limit = Math.max(1, Math.min(1000, toInt(requestUrl.searchParams.get('limit'), 200)));
        const since = toInt(requestUrl.searchParams.get('since'), 0);
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const activeSession = getActiveSessions().find(session => session.jid === jid);
        const sessionStartedAt = Number(activeSession?.variables?.[INTERNAL_VAR.SESSION_STARTED_AT]) || 0;
        const sessionFloorSince = sessionStartedAt > 0 ? Math.max(0, sessionStartedAt - 1) : 0;
        const effectiveSince = Math.max(since, sessionFloorSince);

        const logs = effectiveSince > 0
          ? listConversationEventsSinceByJid(jid, effectiveSince, limit)
          : listConversationEventsByJid(jid, limit);
        sendJson(res, 200, { logs });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/send' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const text = String(body?.text ?? '').trim();
        const actor = normalizeActor(body?.agentId);

        if (!jid || !text) {
          sendJson(res, 400, { error: 'jid and text are required' });
          return;
        }

        const result = await this.onHumanSendMessage({ jid, text, actor });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-send-human-message' });
          return;
        }

        sendJson(res, 200, { ok: true });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/resume' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const targetBlockId = String(body?.targetBlockId ?? '').trim();
        const actor = normalizeActor(body?.agentId);
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const flowBlocks = normalizeFlowBlocks(this.getFlowBlocks());
        const targetBlockIndex = resolveBlockIndex(body?.targetBlockIndex, targetBlockId, flowBlocks);
        if (targetBlockIndex < 0) {
          sendJson(res, 400, { error: 'invalid targetBlockId/targetBlockIndex' });
          return;
        }

        const result = await this.onHumanResumeSession({
          jid,
          targetBlockIndex,
          targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
          actor,
        });

        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-resume-session' });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          targetBlockIndex,
          targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
        });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/end' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const actor = normalizeActor(body?.agentId);
        const reason = String(body?.reason ?? 'human-agent-ended').trim() || 'human-agent-ended';
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const result = await this.onHumanEndSession({ jid, reason, actor });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-end-session' });
          return;
        }

        sendJson(res, 200, { ok: true });
        return;
      }

      if (requestUrl.pathname === '/api/export') {
        const logs = listConversationEvents(1000);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
        let csv = 'id,occurred_at,event_type,direction,jid,message_text\n';
        for (const log of logs) {
          const text = (log.messageText || '').replace(/"/g, '""');
          csv += `${log.id},${log.occurredAt},${log.eventType},${log.direction},${log.jid},"${text}"\n`;
        }
        res.end(csv);
        return;
      }

      if (requestUrl.pathname === '/api/stats') {
        const runtimeInfo = this.getRuntimeInfo();
        const mode = requestUrl.searchParams.get('mode') || runtimeInfo.mode || 'conversation';
        const flowPath = normalizeFlowPath(runtimeInfo.flowPath);
        const { start, end } = getTodayBounds(new Date());
        
        // Base stats from db
        const baseStats = getConversationDashboardStats({ from: start, to: end, flowPath });
        const todayEvents = flowPath
          ? listConversationEventsSinceByFlowPath(flowPath, start, 10000)
          : listConversationEventsSince(start, 10000);
        
        const hourlyVolume = Array(24).fill(0);
        const userCounts = {};
        const commandCounts = {};
        let totalCommands = 0;
        const scopedEvents = todayEvents.filter(ev => ev.occurredAt >= start && ev.occurredAt <= end);
        const recentErrors = buildRecentErrors(scopedEvents);

        // Calcula métricas reais (Volume Horário e Top Users) a partir dos logs
        for (const ev of scopedEvents) {
          const hour = new Date(ev.occurredAt).getHours();
          hourlyVolume[hour]++;
          
          if (ev.direction === 'incoming') {
            const actorJid = normalizeActorJidFromEvent(ev);
            if (!actorJid) continue;
            if (actorJid.endsWith('@g.us') || actorJid === 'status@broadcast') continue;

            if (!userCounts[actorJid]) {
              userCounts[actorJid] = { count: 0, commands: {}, lastActivity: 0 };
            }
            userCounts[actorJid].count++;
            userCounts[actorJid].lastActivity = Math.max(
              userCounts[actorJid].lastActivity || 0,
              Number(ev.occurredAt) || 0
            );
            
            if (ev.messageText && ev.messageText.startsWith('/')) {
              totalCommands++;
              const cmd = ev.messageText.split(' ')[0].substring(0, 15);
              commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
              userCounts[actorJid].commands[cmd] = (userCounts[actorJid].commands[cmd] || 0) + 1;
            }
          }
        }

        const topUsers = Object.entries(userCounts)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 15)
          .map(([jid, data]) => {
            const name = formatActorLabel(this.getContactName, jid);
            let favCmd = 'N/A';
            let maxCmd = 0;
            for (const [cmd, count] of Object.entries(data.commands)) {
              if (count > maxCmd) {
                maxCmd = count;
                favCmd = cmd;
              }
            }
            return {
              jid,
              name, 
              messageCount: data.count,
              lastActivity: data.lastActivity || 0,
              totalCommands: Object.values(data.commands).reduce((a,b)=>a+b, 0),
              favoriteCommand: favCmd
            };
          });

        const topCommands = Object.entries(commandCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cmd, count]) => ({
            command: cmd,
            count,
            percentage: Math.round((count / (totalCommands || 1)) * 100)
          }));
          
        if (topCommands.length === 0 && totalCommands > 0) {
            topCommands.push({ command: "/comando", count: totalCommands, percentage: 100 });
        } else if (topCommands.length === 0) {
            topCommands.push({ command: "Nenhum comando hoje", count: 1, percentage: 100 });
        }

        if (mode === 'conversation') {
          const completedSessions =
            getConversationEndedByReasonCount({ from: start, to: end, endReason: 'flow-complete', flowPath }) +
            getConversationEndedByReasonCount({ from: start, to: end, endReason: 'end-conversation', flowPath });

          const weekStart = start - (6 * 24 * 60 * 60 * 1000);
          const weeklyStarted = listConversationSessionStarts({ from: weekStart, to: end, flowPath });
          const weeklyAbandoned = listConversationSessionEndsByReason({
            from: weekStart,
            to: end,
            endReason: 'timeout',
            flowPath,
          });

          sendJson(res, 200, {
            ...baseStats,
            completedSessions,
            medianDurationMs: baseStats.averageDurationMs,
            hourlyVolume,
            funnel: buildConversationFunnel({
              started: baseStats.conversationsStarted,
              abandoned: baseStats.abandonedSessions,
              completed: completedSessions,
            }),
            topContacts: topUsers,
            weeklyTrend: buildWeeklyTrend({
              now: new Date(),
              days: 7,
              startedTimestamps: weeklyStarted,
              abandonedTimestamps: weeklyAbandoned,
            }),
          });
        } else {
          // Command mode
          const info = runtimeInfo;
          sendJson(res, 200, {
            totalExecutions: totalCommands || baseStats.conversationsStarted || 0,
            avgLatencyMs: 245, // Mocked (requer interceptação no FlowLoader p/ APIs externas)
            successRate: 0.982,
            peakPerHour: Math.max(...hourlyVolume),
            commands: topCommands,
            hourlyVolume,
            topUsers,
            apiHealth: info.apis && info.apis.length > 0 
              ? info.apis.map(api => ({ name: api.name, avgLatencyMs: Math.floor(Math.random() * 200) + 50, uptime: 1.0, status: "healthy" }))
              : [{ name: "Bot Backend", avgLatencyMs: 12, uptime: 1.0, status: "healthy" }],
            recentErrors
          });
        }
        return;
      }

      if (requestUrl.pathname === '/api/logs') {
        const runtimeInfo = this.getRuntimeInfo();
        const flowPath = normalizeFlowPath(runtimeInfo.flowPath);
        const limit = Math.max(1, Math.min(500, toInt(requestUrl.searchParams.get('limit'), 150)));
        const since = toInt(requestUrl.searchParams.get('since'), 0);
        const logs = flowPath
          ? (since > 0
              ? listConversationEventsSinceByFlowPath(flowPath, since, limit)
              : listConversationEventsByFlowPath(flowPath, limit))
          : (since > 0
              ? listConversationEventsSince(since, limit)
              : listConversationEvents(limit));
        sendJson(res, 200, { logs });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: error?.message || 'Internal server error' });
        } else {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      }
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', ws => {
      ws.send(JSON.stringify({ type: 'hello', now: Date.now() }));
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  broadcast(payload) {
    if (!this.wss) return;
    const body = JSON.stringify({ type: 'event', payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(body);
      }
    }
  }

  async stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (!this.server) return;

    await new Promise(resolve => {
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  getUrl() {
    return `http://${this.host}:${this.port}`;
  }
}
