/**
 * Runtime standalone do bot Fun.
 * Reusa core TMB (Baileys auth/SQLite, parseMessage, sender, contact names)
 * sem carregar fluxos ou config.user.json do interpreter.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';

import { initDb, getContactDisplayName, upsertContactDisplayName } from '../db/index.js';
import { useSqliteAuthState } from '../db/authState.js';
import { parseMessage } from '../engine/messageParser.js';
import { sendTextMessage as sendTextMessageOriginal, sendImageMessage as sendImageMessageOriginal, sendStickerMessage as sendStickerMessageOriginal } from '../engine/sender.js';
import { createCommandQueueManager } from '../runtime/commandQueue.js';
import { createOutputQueue } from '../runtime/outputQueue.js';

let _outputQueueInstance = null;

export function setOutputQueue(q) { _outputQueueInstance = q; }

async function sendTextMessage(sock, jid, text, options = {}) {
  const opts = options && typeof options === 'object' ? { ...options } : {};
  if (_outputQueueInstance) {
    return new Promise((resolve) => {
      _outputQueueInstance.enqueue({
        jid,
        priority: opts.priority || 'reply',
        coalesceKey: opts.coalesceKey || '',
        send: async () => {
          try {
            const result = await sendTextMessageOriginal(sock, jid, text, { ...opts, skipGuard: true });
            resolve(result);
          } catch (err) {
            resolve({ skipped: true, reason: String(err?.message || err) });
          }
        },
      });
    });
  }
  return sendTextMessageOriginal(sock, jid, text, { ...opts, skipGuard: true });
}

async function sendImageMessage(sock, jid, payload, options = {}) {
  const opts = options && typeof options === 'object' ? { ...options } : {};
  if (_outputQueueInstance) {
    return new Promise((resolve) => {
      _outputQueueInstance.enqueue({
        jid,
        priority: opts.priority || 'reply',
        coalesceKey: opts.coalesceKey || '',
        send: async () => {
          try {
            const result = await sendImageMessageOriginal(sock, jid, payload, { ...opts, skipGuard: true });
            resolve(result);
          } catch (err) {
            resolve({ skipped: true, reason: String(err?.message || err) });
          }
        },
      });
    });
  }
  return sendImageMessageOriginal(sock, jid, payload, { ...opts, skipGuard: true });
}

async function sendStickerMessage(sock, jid, buffer, options = {}) {
  const opts = options && typeof options === 'object' ? { ...options } : {};
  if (_outputQueueInstance) {
    return new Promise((resolve) => {
      _outputQueueInstance.enqueue({
        jid,
        priority: opts.priority || 'reply',
        coalesceKey: opts.coalesceKey || '',
        send: async () => {
          try {
            const result = await sendStickerMessageOriginal(sock, jid, buffer, { ...opts, skipGuard: true });
            resolve(result);
          } catch (err) {
            resolve({ skipped: true, reason: String(err?.message || err) });
          }
        },
      });
    });
  }
  return sendStickerMessageOriginal(sock, jid, buffer, { ...opts, skipGuard: true });
}
import { resolveIncomingActorJid } from '../runtime/contactUtils.js';
import { createInstanceLock } from '../runtime/instanceLock.js';
import { createReconnectController } from '../runtime/reconnectController.js';
import { createFunModule } from './index.js';
import { loadFunUserConfig, FUN_DEFAULT_DATA_DIR } from './config.js';
import { runFunSetupWizard, shouldRunFunWizard } from './wizard.js';
import { startFunDashboardServer } from './dashboard/server.js';
import { extractMentionedJids } from './utils/mentions.js';
import { loadGroupIdentity } from './utils/identity.js';
import { createAuditBus } from './tui/auditBus.js';
import { createRenderer } from './tui/renderer.js';
import { createFunTui } from './tui/index.js';
import { renderAuditPanel } from './tui/panels/auditPanel.js';
import { renderHealthPanel } from './tui/panels/healthPanel.js';
import { renderEconomyPanel } from './tui/panels/economyPanel.js';
import { renderLlmPanel } from './tui/panels/llmPanel.js';
import { renderGroupsPanel } from './tui/panels/groupsPanel.js';
import { getFunCommandCountersByScope } from './commands/router.js';
import { getLlmMetrics, inventTemplateAlert } from './llm/llmMetrics.js';
import { resolveZenEndpoint } from './llm/zenEndpoint.js';

function resolveDisconnectReasonName(statusCode) {
  const entry = Object.entries(DisconnectReason).find(([, code]) => Number(code) === Number(statusCode));
  return entry?.[0] || String(statusCode ?? 'unknown');
}

function isLoggedOutDisconnect(statusCode) {
  return Number(statusCode) === DisconnectReason.loggedOut;
}

function extractQuotedMessageId(msg) {
  const queue = [msg?.message || {}]; const seen = new Set();
  while (queue.length) { const node = queue.shift(); if (!node || typeof node !== 'object' || seen.has(node)) continue; seen.add(node);
    const contexts = [node.contextInfo, node.extendedTextMessage?.contextInfo, node.imageMessage?.contextInfo, node.videoMessage?.contextInfo, node.documentMessage?.contextInfo];
    for (const context of contexts) { const id = String(context?.stanzaId || '').trim(); if (id) return id; }
    for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
  } return '';
}

export function extractQuotedText(msg) {
  const queue = [msg?.message || {}];
  const seen = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    const contexts = [
      node.contextInfo,
      node.extendedTextMessage?.contextInfo,
      node.imageMessage?.contextInfo,
      node.videoMessage?.contextInfo,
      node.documentMessage?.contextInfo,
      node.documentWithCaptionMessage?.message?.documentMessage?.contextInfo,
    ];
    for (const context of contexts) {
      const quoted = context?.quotedMessage;
      if (!quoted || typeof quoted !== 'object') continue;
      const text = [
        quoted.conversation,
        quoted.extendedTextMessage?.text,
        quoted.imageMessage?.caption,
        quoted.videoMessage?.caption,
        quoted.documentMessage?.caption,
        quoted.documentWithCaptionMessage?.message?.documentMessage?.caption,
      ].find((value) => String(value || '').trim());
      if (text) return String(text).replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return '';
}

function extractQuotedParticipant(msg) {
  const queue = [msg?.message || {}];
  const seen = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    const contexts = [
      node.contextInfo,
      node.extendedTextMessage?.contextInfo,
      node.imageMessage?.contextInfo,
      node.videoMessage?.contextInfo,
      node.documentMessage?.contextInfo,
      node.documentWithCaptionMessage?.message?.documentMessage?.contextInfo,
      node.buttonsResponseMessage?.contextInfo,
      node.templateButtonReplyMessage?.contextInfo,
      node.buttonsMessage?.contextInfo,
      node.listResponseMessage?.contextInfo,
      node.interactiveResponseMessage?.contextInfo,
    ];

    for (const ctx of contexts) {
      const p = String(ctx?.participantPn || ctx?.participant || '').trim();
      if (p) return p;
    }

    const nested = [
      node.ephemeralMessage?.message,
      node.viewOnceMessage?.message,
      node.viewOnceMessageV2?.message,
      node.viewOnceMessageV2Extension?.message,
      node.documentWithCaptionMessage?.message,
      node.editedMessage?.message,
    ];
    for (const child of nested) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }

  return '';
}

function isSocketReady(sock) {
  if (!sock) return false;
  if (sock.user?.id || sock.user?.lid || sock.authState?.creds?.me?.id) return true;
  return false;
}

/**
 * Espera conexão aberta com gate acoplado ao socket (sem race).
 * Baileys às vezes demora / falha em "init queries" sem derrubar a sessão.
 */
function createConnectionOpenGate({ timeoutMs = 5 * 60_000 } = {}) {
  let resolved = false;
  let resolveFn = () => {};
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });

  const signalOpen = (reason = 'open') => {
    if (resolved) return;
    resolved = true;
    resolveFn({ reason });
  };

  const wait = async (sock) => {
    if (isSocketReady(sock)) {
      signalOpen('already-ready');
      return promise;
    }

    const poll = setInterval(() => {
      if (isSocketReady(sock)) {
        clearInterval(poll);
        signalOpen('poll-ready');
      }
    }, 500);

    const timer = setTimeout(() => {
      clearInterval(poll);
      if (isSocketReady(sock)) {
        signalOpen('timeout-but-ready');
        return;
      }
      if (!resolved) {
        resolved = true;
        resolveFn({ reason: 'timeout', timedOut: true });
      }
    }, timeoutMs);

    const result = await promise;
    clearInterval(poll);
    clearTimeout(timer);
    return result;
  };

  return { signalOpen, wait };
}

/**
 * @param {{ config?: object, skipWizard?: boolean }} [options]
 */
export async function startFunBot(options = {}) {
  let config = options.config || loadFunUserConfig();
  const dataDir = String(config.dataDir || process.env.TMB_DATA_DIR || FUN_DEFAULT_DATA_DIR);
  const lockPath = path.join(dataDir, 'fun-runtime.lock');

  const instanceLock = createInstanceLock(lockPath);
  instanceLock.acquire();

  const releaseLock = () => {
    try {
      instanceLock.release();
    } catch {
      // ignore
    }
  };
  process.once('exit', releaseLock);
  process.once('SIGINT', () => {
    releaseLock();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    releaseLock();
    process.exit(0);
  });

  // Baileys no console polui o inquirer — só erros
  // Pino em stderr: evita corromper o painel da TUI no stdout (research.md §3)
  const baileysLogger = pino(
    { level: config.debugMode ? 'info' : 'error' },
    pino.destination(2)
  );
  const logger = baileysLogger;

  await initDb();
  console.log(`[fun] Banco isolado em: ${dataDir}`);
  console.log(
    `[fun] Respostas de comando: ${
      config.replyCommandsInPrivate !== false
        ? 'PRIVADO (exceções: aposta/panelinha/social)'
        : 'GRUPO'
    }`
  );

  const getConfig = () => config;

  let socketGeneration = 0;
  let currentSocket = null;

  const commandQueue = createCommandQueueManager({
    maxConcurrency: Number(config.commandMaxConcurrency ?? 8),
    fastConcurrency: Number(config.commandFastConcurrency ?? 4),
    stateConcurrency: Number(config.commandStateConcurrency ?? 2),
    heavyConcurrency: Number(config.commandHeavyConcurrency ?? 1),
    maxQueueSize: Number(config.commandQueueMax ?? 5000),
    warnThreshold: Number(config.commandQueueWarnThreshold ?? 1000),
  });

  const outputQueue = createOutputQueue({
    globalConcurrency: Number(config.outputConcurrency ?? 4),
    jidGapMs: Number(config.outputJidGapMs ?? 600),
    maxCoalesceDelayMs: Number(config.outputCoalesceDelayMs ?? 2000),
    maxQueueSize: Number(config.outputQueueMax ?? 2000),
  });
  setOutputQueue(outputQueue);

  const funModule = createFunModule({
    getConfig,
    getLogger: () => logger,
    sendText: sendTextMessage,
    sendImage: sendImageMessage,
    sendSticker: sendStickerMessage,
    getContactDisplayName,
    getSock: () => currentSocket,
  });
  funModule.init();
  let saveCreds = null;
  let dashboardStarted = false;
  let messagesEnabled = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let worldTickTimer = null;
  let worldTickRunning = false;
  /** @type {ReturnType<typeof createConnectionOpenGate> | null} */
  let openGate = null;

  // ─── TUI: estado de conexão + audit bus ───────────────────────
  let connectionState = 'offline';
  let connectionLastReason = null;
  let connectionLastStatusCode = null;
  let dashboardInfo = { enabled: config.dashboardEnabled !== false, started: false, url: null };

  /** Composição do snapshot de conexão consumido pelo renderer. */
  function getConnectionSnapshot() {
    const reconnect = reconnectController.getSnapshot?.() || {};
    return {
      state: connectionState,
      lastReason: connectionLastReason,
      lastStatusCode: connectionLastStatusCode,
      reconnect: {
        pending: Boolean(reconnect.pending),
        nextReconnectAt: reconnect.nextReconnectAt || null,
        currentAttempt: Number(reconnect.currentAttempt) || 0,
        lastDelayMs: reconnect.lastDelayMs || null,
      },
    };
  }
  function getQueuesSnapshot() {
    return {
      command: commandQueue.getSnapshot?.() || {
        totalQueued: 0, totalRunning: 0, totalAccepted: 0, totalRejected: 0, totalCompleted: 0, totalFailed: 0,
      },
      output: outputQueue.getSnapshot?.() || {
        queued: 0, running: 0, accepted: 0, sent: 0, coalesced: 0, failed: 0,
        avgWaitMs: 0, p95WaitMs: 0, acceptedPerSecond: 0,
      },
    };
  }
  function getLlmSnapshot() {
    const m = getLlmMetrics();
    const alert = inventTemplateAlert();
    return {
      byTask: groupByTask(m.counts),
      invent: m.invent,
      alert: alert ? { templateRate: alert.templateRate } : null,
      lastByTask: m.lastByTask,
    };
  }
  function groupByTask(counts) {
    const byTask = {};
    for (const [key, n] of Object.entries(counts || {})) {
      const [task, provider] = key.split(':');
      if (!task) continue;
      byTask[task] = byTask[task] || {};
      byTask[task][provider || 'unknown'] = (byTask[task][provider || 'unknown'] || 0) + n;
    }
    return byTask;
  }

  /**
   * Snapshot de grupos para o painel Grupos — não consulta DB a cada refresh.
   * Usa apenas a whitelist em memória + os contadores de comandos por escopo.
   * @returns {Array<{jid, name, memberCount, topCommands}>}
   */
  function getGroupsSnapshot() {
    const jids = Array.isArray(config.groupWhitelistJids) ? config.groupWhitelistJids : [];
    const counters = getFunCommandCountersByScope();
    return jids.map((jid) => ({
      jid: String(jid),
      name: null, // sem nome amigável aqui — renderer exibe JID truncado
      memberCount: 0,
      topCommands: (counters[jid] || []).slice(0, 5),
    }));
  }

  const auditBus = createAuditBus({
    maxHistory: Number(config.tuiMaxHistory) || 200,
    startedAt: Date.now(),
    sources: {
      getConnection: getConnectionSnapshot,
      getQueues: getQueuesSnapshot,
      getLlm: getLlmSnapshot,
      getDashboard: () => dashboardInfo,
      getGroups: getGroupsSnapshot,
    },
  });

  const tuiRenderer = createRenderer({
    audit: renderAuditPanel,
    health: renderHealthPanel,
    economy: renderEconomyPanel,
    llm: renderLlmPanel,
    groups: renderGroupsPanel,
  });
  const tui = createFunTui({
    bus: auditBus,
    renderer: tuiRenderer,
    funConfig: config,
  });

  /**
   * Relógio do mundo: mercado / happy hour / trégua / restock sem precisar de msg.
   */
  function startWorldClock() {
    stopWorldClock();
    if (config.worldAutonomous === false) {
      console.log('[fun] Relógio do mundo desligado (worldAutonomous=false)');
      return;
    }
    const ms = Math.max(15_000, Math.floor(Number(config.worldTickMs) || 45_000));
    console.log(`[fun] Relógio do mundo a cada ${Math.round(ms / 1000)}s (eventos sem depender de msg)`);

    const runTick = async () => {
      if (worldTickRunning) return;
      if (!messagesEnabled) return;
      const sock = currentSocket;
      if (!sock || !isSocketReady(sock)) return;

      worldTickRunning = true;
      const tickStartedAt = Date.now();
      try {
        // atualiza config em memória (whitelist etc.)
        try {
          config = loadFunUserConfig();
        } catch {
          // mantém config anterior
        }
        const result = await funModule.tickWorldEvents({
          sock,
          sendText: sendTextMessage,
          getContactDisplayName,
        });
        // Tempo de execução (milis) — alimentado no auditor (FR-003, FR-016)
        const tookMs = Date.now() - tickStartedAt;
        const enriched = {
          ...result,
          tookMs,
          skipped: result?.reason === 'quiet-hours' || result?.skipped === true,
        };
        try {
          auditBus.recordWorldTick(enriched, tickStartedAt);
        } catch {
          // erros de auditoria nunca podem derrubar o tick
        }
        if (result?.fired > 0) {
          console.log(
            `[fun] Mundo: ${result.fired} anúncio(s) autônomo(s) · ${result.results
              ?.filter((r) => r.ok)
              .map((r) => r.kind)
              .join(', ')}`
          );
        }
      } catch (err) {
        console.warn('[fun] World tick falhou:', String(err?.message || err));
        auditBus.emit({
          category: 'system',
          level: 'error',
          kind: 'world-tick-error',
          scope: null,
          ok: false,
          detail: { reason: String(err?.message || err) },
        });
      } finally {
        worldTickRunning = false;
      }
    };

    worldTickTimer = setInterval(() => {
      void runTick();
    }, ms);
    if (typeof worldTickTimer.unref === 'function') {
      worldTickTimer.unref();
    }
    // primeiro tick após 20s (dá tempo da sessão assentar)
    setTimeout(() => {
      void runTick();
    }, 20_000).unref?.();
  }

  function stopWorldClock() {
    if (worldTickTimer) {
      clearInterval(worldTickTimer);
      worldTickTimer = null;
    }
  }

  process.once('exit', () => {
    stopWorldClock();
  });

  /**
   * Dashboard API independente do WhatsApp (QR/ban/logout).
   * Dados vêm do SQLite; mensagens WA só depois da sessão aberta.
   */
  async function ensureDashboard() {
    if (dashboardStarted) return;
    if (!config.dashboardEnabled) {
      console.log('[fun] Dashboard desligado (dashboardEnabled=false)');
      return;
    }
    try {
      await startFunDashboardServer({
        getConfig,
        funModule,
        getContactDisplayName,
        getLogger: () => logger,
        getSock: () => currentSocket,
        sendText: sendTextMessage,
        isSocketReady: () => isSocketReady(currentSocket),
      });
      dashboardStarted = true;
      dashboardInfo = {
        enabled: true,
        started: true,
        url: `http://${config.dashboardHost || '127.0.0.1'}:${config.dashboardPort || 8790}`,
      };
      auditBus.emit({
        category: 'system',
        level: 'info',
        kind: 'dashboard',
        scope: null,
        ok: true,
        detail: { url: dashboardInfo.url },
      });
    } catch (err) {
      console.warn('[fun] Dashboard nao iniciou:', String(err?.message || err));
      auditBus.emit({
        category: 'system',
        level: 'warn',
        kind: 'dashboard',
        scope: null,
        ok: false,
        detail: { reason: String(err?.message || err) },
      });
    }
  }

  // API cedo — antes de WA (UI Next não precisa de QR)
  await ensureDashboard();

  // Flavor: Zen (principal). Ollama (fallback local) foi descontinuado.
  const zenOn = config.zenEnabled !== false;
  if (zenOn) {
    const zenEndpoint = resolveZenEndpoint(config);
    console.log(
      `[fun] Flavor LLM: Zen principal → ${zenEndpoint.baseUrl} · model=${zenEndpoint.model}${config.zenSendSamplingParams === false ? ' · sampling=off' : ''} · retries=${Number(config.zenMaxRetries ?? 3)}`
    );
  } else {
    console.log('[fun] Flavor LLM desligado — só templates estáticos');
  }

  process.once('exit', () => {
    try {
      funModule.stopLlmKeepAlive?.();
    } catch {
      // ignore
    }
  });

  const reconnectController = createReconnectController({
    minDelayMs: 3000,
    maxDelayMs: 60_000,
    backoffMultiplier: 2,
    jitterRatio: 0.2,
    attemptWindowMs: 10 * 60 * 1000,
    maxAttemptsPerWindow: 12,
    cooldownMs: 2 * 60 * 1000,
  });

  const dedupCache = new Map();
  const DEDUP_TTL_MS = 4000;
  const DEDUP_MAX_SIZE = 2000;

  function isDuplicateMessage(messageId, remoteJid) {
    const key = `${remoteJid}:${messageId}`;
    const now = Date.now();
    if (dedupCache.has(key)) return true;
    dedupCache.set(key, now);
    if (dedupCache.size > DEDUP_MAX_SIZE) {
      const cutoff = now - DEDUP_TTL_MS;
      for (const [k, ts] of dedupCache) {
        if (ts < cutoff) dedupCache.delete(k);
      }
    }
    return false;
  }

  function extractMessageId(msg) {
    const key = msg?.key && typeof msg.key === 'object' ? msg.key : {};
    return String(key.id ?? key.Id ?? '').trim();
  }

  function extractQueueJid(msg) {
    const key = msg?.key && typeof msg.key === 'object' ? msg.key : {};
    return String(key.remoteJid ?? key.remote_jid ?? '').trim();
  }

  function extractCommandText(msg) {
    const quick = msg?.message && typeof msg.message === 'object' ? msg.message : {};
    const conv = quick.conversationMessage || quick.conversation || '';
    const ext = quick.extendedTextMessage?.text || '';
    const btn = quick.buttonsResponseMessage?.selectedButtonId || '';
    const list = quick.listResponseMessage?.singleSelectReply?.selectedRowId || '';
    return String(conv || ext || btn || list || '').trim();
  }

  function extractMessageType(msg) {
    const quick = msg?.message && typeof msg.message === 'object' ? msg.message : {};
    if (quick.imageMessage) return 'image';
    if (quick.videoMessage) return 'video';
    if (quick.documentMessage) return 'document';
    if (quick.audioMessage) return 'audio';
    return 'text';
  }

  const reportDebug = (hypothesisId, location, msg, data = {}) => { void Promise.resolve().then(() => fetch(process.env.DEBUG_SERVER_URL || 'http://127.0.0.1:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: process.env.DEBUG_SESSION_ID || 'persona-runtime-signals', runId: 'pre-fix', hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }) })).catch(() => {}); };
  const jidDomain = (jid) => String(jid || '').includes('@') ? `@${String(jid).split('@').pop()}` : '';

  async function processIncoming({ sock, msg, type }) {
    if (!messagesEnabled) return;
    if (type !== 'notify') return;

    const parsed = parseMessage(msg);
    if (!parsed) return;

    const actorJid = resolveIncomingActorJid(parsed);
    const pushName = String(msg?.pushName || msg?.pushname || '').trim();
    if (actorJid && pushName) {
      try {
        upsertContactDisplayName({
          jid: actorJid,
          displayName: pushName,
          source: 'fun-runtime',
          updatedAt: Date.now(),
        });
      } catch {
        // non-fatal
      }
    }

    let mentionedJids = extractMentionedJids(msg);
    let quotedParticipant = extractQuotedParticipant(msg);
    const quotedMessageId = extractQuotedMessageId(msg);
    const quotedText = extractQuotedText(msg);
    const identityMap = funModule.identityMap;

    // #region debug-point persona-runtime-A
    reportDebug('A', 'runtime.processIncoming.before-loadGroupIdentity', 'sinais extraídos', { remoteDomain: jidDomain(parsed.jid), isGroup: Boolean(parsed.isGroup), messageType: parsed.messageType || extractMessageType(msg), mentionedCount: mentionedJids.length, mentionedDomains: [...new Set(mentionedJids.map(jidDomain).filter(Boolean))], hasQuotedParticipant: Boolean(quotedParticipant), quotedDomain: jidDomain(quotedParticipant), hasQuotedMessageId: Boolean(quotedMessageId), hasParticipantPn: Boolean(msg?.message?.extendedTextMessage?.contextInfo?.participantPn), hasParticipant: Boolean(msg?.message?.extendedTextMessage?.contextInfo?.participant) });
    // #endregion

    // Aprende lid→pn sempre que o actor real (PN) chega com key de participante LID.
    if (actorJid) {
      identityMap?.learnFromMessageKey?.(msg?.key || parsed.messageKey, actorJid);
    }

    const hasUnresolvedCandidate =
      mentionedJids.some((jid) => !identityMap?.resolve?.(jid)) ||
      Boolean(quotedParticipant && !identityMap?.resolve?.(quotedParticipant));
    if (parsed.isGroup && hasUnresolvedCandidate) {
      await loadGroupIdentity(sock, parsed.jid, identityMap);
    }

    mentionedJids = mentionedJids.map((jid) => identityMap?.resolve?.(jid) || jid);
    quotedParticipant = identityMap?.resolve?.(quotedParticipant) || quotedParticipant;

    // #region debug-point persona-runtime-B
    reportDebug('B', 'runtime.processIncoming.after-identity-resolution', 'identidades mapeadas', { mentionedCount: mentionedJids.length, mentionedDomains: [...new Set(mentionedJids.map(jidDomain).filter(Boolean))], quotedFormat: jidDomain(quotedParticipant), hasQuotedParticipant: Boolean(quotedParticipant), identityMapAvailable: Boolean(identityMap?.resolve) });
    // #endregion

    if (config.debugMode) {
      console.log('[fun] msg', {
        chatJid: parsed.jid,
        actorJid: actorJid || null,
        isGroup: parsed.isGroup,
        text: String(parsed.text || '').slice(0, 80),
        mentions: mentionedJids,
      });
    }

    await funModule.onIncomingMessage({
      sock,
      chatJid: parsed.jid,
      actorJid: actorJid || '',
      isGroup: Boolean(parsed.isGroup),
      text: parsed.text ?? '',
      messageType: parsed.messageType || '',
      mediaMimeType: parsed.mediaMimeType || '',
      messageId: parsed.id || '',
      messageKey: parsed.messageKey || msg?.key,
      mentionedJids,
      quotedParticipant,
      quotedMessageId,
      quotedText,
      parsed,
      rawMessage: msg,
    });
  }

  async function connectToWhatsApp({ isReconnect = false } = {}) {
    const currentGeneration = ++socketGeneration;
    const { state, saveCreds: persistCreds } = useSqliteAuthState();
    saveCreds = persistCreds;

    // Gate por geração de socket (reconnect cria novo gate)
    openGate = createConnectionOpenGate({ timeoutMs: 5 * 60_000 });

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      logger: baileysLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      browser: ['TMB Fun Bot', 'Chrome', '120.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    currentSocket = sock;

    sock.ev.on('creds.update', () => {
      if (currentGeneration !== socketGeneration) return;
      try {
        saveCreds?.();
      } catch (err) {
        console.error('[fun] Falha ao salvar creds:', String(err?.message || err));
      }
    });

    sock.ev.on('connection.update', (update) => {
      if (currentGeneration !== socketGeneration) return;
      const { connection, lastDisconnect, qr } = update || {};

      if (qr) {
        console.log('\n[fun] Escaneie este QR com o WhatsApp do bot de divertimento:\n');
        qrcode.generate(qr, { small: true });
        console.log('');
      }

      if (connection === 'connecting') {
        connectionState = 'connecting';
        if (!isReconnect) {
          console.log('[fun] Conectando…');
        }
        auditBus.emit({ category: 'connection', level: 'info', kind: 'connecting', scope: null, ok: null });
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const reasonName = resolveDisconnectReasonName(statusCode);
        const shouldReconnect = !isLoggedOutDisconnect(statusCode);

        if (currentSocket === sock) currentSocket = null;

        if (shouldReconnect) {
          connectionState = 'reconnecting';
          connectionLastReason = String(reasonName);
          connectionLastStatusCode = Number(statusCode) || 0;
          const scheduleResult = reconnectController.schedule({
            reason: reasonName,
            statusCode: Number(statusCode) || 0,
            connect: async () => {
              await connectToWhatsApp({ isReconnect: true });
            },
          });
          if (scheduleResult?.scheduled) {
            console.log(
              `[fun] Conexao fechada (${statusCode}/${reasonName}). Reconectando em ${scheduleResult.delayMs}ms.`
            );
          }
          auditBus.emit({
            category: 'connection',
            level: 'warn',
            kind: 'reconnect',
            scope: null,
            ok: false,
            detail: { reason: reasonName, statusCode: Number(statusCode) || 0, delayMs: scheduleResult?.delayMs || null },
          });
        } else {
          connectionState = 'logged-out';
          connectionLastReason = 'logged-out';
          reconnectController.close?.();
          console.log(
            '[fun] Desconectado (logged out). Apague data/fun/runtime.db (auth) para reautenticar.'
          );
          auditBus.emit({ category: 'connection', level: 'error', kind: 'logged-out', scope: null, ok: false });
        }
        return;
      }

      if (connection === 'open') {
        reconnectController.reset?.();
        connectionState = 'online';
        connectionLastReason = null;
        connectionLastStatusCode = null;
        console.log('[fun] Conectado ao WhatsApp.\n');
        messagesEnabled = true;
        openGate?.signalOpen('connection-open');
        auditBus.emit({ category: 'connection', level: 'ok', kind: 'open', scope: null, ok: true });
      }

      // Alguns estados multi-device marcam user sem emitir open de novo
      if (isSocketReady(sock)) {
        openGate?.signalOpen('user-ready');
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type: upsertType }) => {
      if (currentGeneration !== socketGeneration) return;
      if (upsertType !== 'notify') return;
      if (!Array.isArray(messages) || messages.length === 0) return;

      for (const msg of messages) {
        const msgId = extractMessageId(msg);
        const qJid = extractQueueJid(msg);
        if (msgId && qJid && isDuplicateMessage(msgId, qJid)) continue;

        const cmdText = extractCommandText(msg);
        const msgType = extractMessageType(msg);

        const enqResult = commandQueue.enqueue({
          key: qJid || 'unknown',
          commandText: cmdText,
          messageType: msgType,
          priority: msgType === 'image' || msgType === 'video' || msgType === 'document' ? 'low' : 'high',
          payload: { sock, msg, type: upsertType },
          handler: async () => {
            try {
              await processIncoming({ sock, msg, type: upsertType });
            } catch (err) {
              console.error('[fun] Command queue task falhou:', String(err?.message || err));
            }
          },
        });

        if (!enqResult.accepted && config.debugMode) {
          console.warn('[fun] Mensagem rejeitada pela fila:', enqResult.reason, enqResult.queueClass);
        }
      }
    });

    return sock;
  }

  console.log('[fun] Iniciando WhatsApp…');
  const sock = await connectToWhatsApp();
  const openResult = await openGate.wait(sock);

  if (openResult?.timedOut && !isSocketReady(sock) && !isSocketReady(currentSocket)) {
    console.warn(
      '[fun] Ainda sem sessao pronta apos timeout. Se o QR foi escaneado, aguarde ou rode de novo.'
    );
    // Nao mata o processo: deixa wizard manual + mensagens se reconectar
  } else if (openResult?.timedOut) {
    console.warn('[fun] Timeout parcial (init queries do Baileys). Seguindo com a sessao atual…');
  }

  // Pequena folga para group metadata / history
  await new Promise(r => setTimeout(r, 1500));

  // Wizard (primeira vez ou --setup) — sempre tenta se whitelist vazia
  const liveSock = currentSocket || sock;
  if (!options.skipWizard && shouldRunFunWizard(config, process.argv)) {
    console.log('\n========================================');
    console.log('  FUN BOT — setup de grupos');
    console.log('========================================\n');
    try {
      config = await runFunSetupWizard({
        sock: liveSock,
        currentConfig: config,
        force: process.argv.includes('--setup') || process.argv.includes('--wizard'),
      });
    } catch (err) {
      console.warn('[fun] Wizard interrompido:', String(err?.message || err));
      console.warn('[fun] Voce pode editar fun/config.user.json ou rodar: npm run fun -- --setup');
    }
  }

  const whitelist = config.groupWhitelistJids || [];
  console.log('[fun] Bot de divertimento (standalone)');
  console.log(`[fun] Grupos whitelist: ${whitelist.length}`);
  if (whitelist.length === 0 && config.requireGroupWhitelist) {
    console.warn(
      '[fun] Aviso: nenhum grupo selecionado. Rode: npm run fun -- --setup'
    );
  }

  // Dashboard já pode ter subido no boot; garante se falhou antes
  await ensureDashboard();
  messagesEnabled = isSocketReady(currentSocket || sock);
  if (!messagesEnabled) {
    console.warn(
      '[fun] WhatsApp offline (QR/ban/logout). Dashboard API no ar; msgs só após conectar.'
    );
    const poll = setInterval(() => {
      if (isSocketReady(currentSocket)) {
        messagesEnabled = true;
        clearInterval(poll);
        console.log('[fun] Sessao WhatsApp pronta — mensagens habilitadas.');
      }
    }, 3000);
    // para o poll se o processo ficar dias no ar sem sessão
    setTimeout(() => clearInterval(poll), 7 * 24 * 60 * 60 * 1000);
  }
  // Eventos do mundo sem “gatilho” de mensagem humana
  startWorldClock();

  // TUI: entra no alternate screen buffer quando TTY + tuiEnabled
  // (QR/wizard já terminaram; agora a tela é do painel)
  if (config.tuiEnabled !== false && process.stdout.isTTY) {
    try {
      tui.start();
      // SIGINT já restaurava o lock; adiciona stop da TUI antes do exit
      const stopTuiAndExit = () => {
        try { tui.stop(); } catch { /* ignore */ }
        releaseLock();
        process.exit(0);
      };
      process.prependOnceListener('SIGINT', stopTuiAndExit);
      process.prependOnceListener('SIGTERM', stopTuiAndExit);
      process.once('exit', () => { try { tui.stop(); } catch { /* ignore */ } });
    } catch (err) {
      console.warn('[fun] TUI não iniciou:', String(err?.message || err));
    }
  } else if (config.tuiEnabled === false) {
    console.log('[fun] TUI desligada (tuiEnabled=false) — fallback plain logs');
  }

  console.log(
    messagesEnabled
      ? '[fun] Pronto. /help · /cf · /bingo · /tarot · /loja · relógio do mundo ON\n'
      : '[fun] API dashboard ativa. Escaneie o QR quando o ban acabar.\n'
  );

  return { config, getSocket: () => currentSocket, funModule, stopWorldClock, tui, auditBus };
}
