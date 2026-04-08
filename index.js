import fs from 'fs';
import path from 'path';
import readline from 'readline';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { initDb, addConversationEvent, getSession, onConversationEvent } from './db/index.js';
import { cleanupAuthSignalSessions, useSqliteAuthState } from './db/authState.js';
import { getFlowBotType, loadFlows } from './engine/flowLoader.js';
import { parseMessage } from './engine/messageParser.js';
import {
  handleIncoming,
  startSessionCleanup,
  resetActiveSessions,
  resumeSessionFromHumanHandoff,
  endSessionFromDashboard,
} from './engine/flowEngine.js';
import { getConfig, saveUserConfig, RUNTIME_MODE } from './config/index.js';
import { DashboardServer } from './dashboard/server.js';
import { configureRuntimeAccessSelectors } from './runtime/accessSelectors.js';
import {
  getAllowedTestJids,
  getGroupWhitelistJids,
  getMessageDebugInfo,
  isGroupWhitelistScope,
  mergeChatsIntoContactCache,
  mergeContactCacheEntry,
  mergeContactList,
  normalizeInteractionScope,
  resolveIncomingActorJid,
  shouldProcessByInteractionScope,
  toJidString,
} from './runtime/contactUtils.js';

let config;
let logger;
let currentFlowRegistry = {
  all: [],
  byPath: new Map(),
  byBotType: { conversation: [], command: [] },
  conversationFlow: null,
  commandFlows: [],
};
let currentSocket = null;
let runtimeSetupPromise = null;
let runtimeSetupDone = false;
let warnedMissingTestTargets = false;
let reloadInProgress = false;
let pendingReload = false;
let reloadDebounceTimer = null;
let flowWatchers = [];
let terminalCommandInterface = null;
let dashboardServer = null;
let removeConversationEventListener = null;
let authStateMaintenanceTimer = null;
const contactCache = new Map();
const HANDOFF_MEDIA_DIR = path.resolve('./data/handoff-media');
const ALLOWED_INCOMING_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const FATAL_LOG_FILE = path.resolve('./fatal-error.log');

function formatError(err) {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack ?? ''}`;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

function appendFatalLog(prefix, err) {
  const payload = [
    '============================================================',
    `[${new Date().toISOString()}] ${prefix}`,
    formatError(err),
    '',
  ].join('\n');
  try {
    fs.appendFileSync(FATAL_LOG_FILE, payload, 'utf-8');
  } catch {
    // ignore
  }
}

async function waitForEnter(message) {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question(message, () => resolve()));
  rl.close();
}

let exiting = false;
async function handleFatal(prefix, err) {
  if (exiting) return;
  exiting = true;

  appendFatalLog(prefix, err);
  console.error(`\nERROR: ${prefix}`);
  console.error(formatError(err));
  console.error(`\n(Log salvo em: ${FATAL_LOG_FILE})\n`);
  await waitForEnter('Pressione Enter para sair...');
  process.exit(1);
}

process.on('unhandledRejection', reason => {
  void handleFatal('Unhandled Promise Rejection', reason);
});

process.on('uncaughtException', err => {
  void handleFatal('Uncaught Exception', err);
});

const LIBSIGNAL_NOISE_PREFIXES = [
  'Failed to decrypt message with any known session',
  'Session error:',
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'Decrypted message with closed session.',
];

let libSignalNoiseFilterInstalled = false;

function shouldSuppressLibSignalConsoleNoise(args) {
  const firstText = args.find(arg => typeof arg === 'string');
  if (!firstText) return false;
  return LIBSIGNAL_NOISE_PREFIXES.some(prefix => firstText.startsWith(prefix));
}

function installLibSignalNoiseFilter(enabled) {
  if (!enabled || libSignalNoiseFilterInstalled) return;
  libSignalNoiseFilterInstalled = true;

  const original = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
  };

  console.error = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.error(...args);
  };

  console.warn = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.warn(...args);
  };

  console.info = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.info(...args);
  };
}

function shouldSuppressBaileysDecryptNoise(args) {
  const msg = [...args].reverse().find(arg => typeof arg === 'string') || '';
  if (msg !== 'failed to decrypt message') return false;

  const meta = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg));
  const err = meta?.err ?? {};
  const errName = String(err?.name ?? err?.type ?? '');
  const errMessage = String(err?.message ?? '');

  return errName === 'SessionError' && errMessage.includes('No matching sessions found for message');
}

function createRuntimeLogger(currentConfig) {
  const suppressDecryptNoise =
    currentConfig.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';

  const pinoOptions = currentConfig.prettyLogs
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {};

  if (suppressDecryptNoise) {
    pinoOptions.hooks = {
      logMethod(args, method) {
        if (shouldSuppressBaileysDecryptNoise(args)) return;
        method.apply(this, args);
      },
    };
  }

  const runtimeLogger = pino(pinoOptions);
  runtimeLogger.level = currentConfig.logLevel;
  return runtimeLogger;
}

function isDevelopmentMode(currentConfig) {
  return String(currentConfig?.runtimeMode ?? '').toLowerCase() === RUNTIME_MODE.DEVELOPMENT;
}

function getActiveFlows() {
  return Array.isArray(currentFlowRegistry?.all) ? currentFlowRegistry.all : [];
}

function getConversationFlow() {
  return currentFlowRegistry?.conversationFlow ?? null;
}

function getCommandFlows() {
  return Array.isArray(currentFlowRegistry?.commandFlows) ? currentFlowRegistry.commandFlows : [];
}

function getDashboardFlow() {
  const conversationFlow = getConversationFlow();
  if (conversationFlow) return conversationFlow;
  return getActiveFlows()[0] ?? null;
}

function currentPrimaryFlowPathForLogs() {
  return getDashboardFlow()?.flowPath ?? String(config?.flowPath ?? '');
}

function resolveConfiguredFlowPaths(currentConfig) {
  const selectedPaths = Array.isArray(currentConfig?.flowPaths) ? currentConfig.flowPaths : [];
  const fallback = String(currentConfig?.flowPath ?? '').trim();
  const unique = new Set();
  const result = [];

  for (const item of selectedPaths) {
    const value = String(item ?? '').trim();
    if (!value || unique.has(value)) continue;
    unique.add(value);
    result.push(value);
  }

  if (!result.length && fallback) {
    result.push(fallback);
  }

  return result;
}

function loadFlowRegistryFromConfig(currentConfig) {
  const flowPaths = resolveConfiguredFlowPaths(currentConfig);
  return loadFlows(flowPaths);
}

function logConversationEvent({
  eventType = 'message',
  direction = 'system',
  jid = 'unknown',
  flowPath = '',
  messageText = '',
  metadata = {},
}) {
  addConversationEvent({
    occurredAt: Date.now(),
    eventType,
    direction,
    jid,
    flowPath: String(flowPath || '').trim() || currentPrimaryFlowPathForLogs(),
    messageText,
    metadata,
  });
}

function extractOutgoingMessageText(content) {
  if (!content || typeof content !== 'object') return '';
  if (typeof content.text === 'string' && content.text.trim()) return content.text;
  if (content.image?.caption) return String(content.image.caption);
  if (content.image) return '[imagem]';
  if (content.react?.text) return `[react] ${content.react.text}`;
  if (content.listMessage?.description) return content.listMessage.description;
  if (content.listMessage?.title) return content.listMessage.title;
  if (content.buttonsMessage?.contentText) return content.buttonsMessage.contentText;
  return '';
}

function extractOutgoingKind(content) {
  if (!content || typeof content !== 'object') return 'unknown';
  if (content.text) return 'text';
  if (content.image) return 'image';
  if (content.react) return 'reaction';
  if (content.listMessage) return 'list';
  if (content.buttons) return 'buttons';
  return Object.keys(content)[0] || 'unknown';
}

function extractApiHostFromTemplateUrl(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) return 'host-desconhecido';

  const normalized = input.replace(/\{\{[^}]+\}\}/g, 'x');

  try {
    const parsed = new URL(normalized);
    return parsed.host || parsed.hostname || 'host-desconhecido';
  } catch {
    try {
      const parsedWithBase = new URL(normalized, 'http://localhost');
      if (parsedWithBase.host && parsedWithBase.host !== 'localhost') {
        return parsedWithBase.host;
      }
    } catch {
      // ignore
    }

    const match = normalized.match(/^(?:[a-z]+:\/\/)?([^\/\s?#]+)/i);
    return String(match?.[1] ?? 'host-desconhecido');
  }
}

function sanitizeMediaFileName(value) {
  return String(value ?? '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.bin';
}

function saveIncomingHandoffImage({ buffer, mimeType, fileName = '' }) {
  fs.mkdirSync(HANDOFF_MEDIA_DIR, { recursive: true });
  const ext = extensionFromMimeType(mimeType);
  const base = sanitizeMediaFileName(fileName).replace(/\.[^.]+$/, '') || 'incoming';
  const mediaId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}${ext}`;
  const mediaPath = path.resolve(HANDOFF_MEDIA_DIR, mediaId);
  fs.writeFileSync(mediaPath, buffer);
  return {
    mediaId,
    mediaPath,
    mediaUrl: `/api/handoff/media/${encodeURIComponent(mediaId)}`,
  };
}

async function captureIncomingImageForDashboard({ msg, sock, mimeType, fileName }) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (!ALLOWED_INCOMING_IMAGE_MIME.has(normalizedMime)) return null;

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock?.updateMediaMessage,
      }
    );

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return null;
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return null;
    }

    return saveIncomingHandoffImage({
      buffer,
      mimeType: normalizedMime,
      fileName,
    });
  } catch {
    return null;
  }
}

function cleanupSignalAuthState({ reason = 'manual', forceLog = false } = {}) {
  try {
    const summary = cleanupAuthSignalSessions();
    const shouldLog =
      forceLog ||
      summary.changedRows > 0 ||
      summary.deletedRows > 0 ||
      summary.removedSessions > 0;

    if (shouldLog) {
      console.log(
        `[AuthState] cleanup(${reason}) rows=${summary.scannedRows} changed=${summary.changedRows} deleted=${summary.deletedRows} removedSessions=${summary.removedSessions}`
      );
    }

    return summary;
  } catch (error) {
    console.error(`[AuthState] cleanup falhou (${reason}):`, error?.message || error);
    return null;
  }
}

function startAuthStateMaintenance() {
  if (authStateMaintenanceTimer) return;

  const intervalMs = Math.max(60_000, Number(process.env.TMB_AUTH_CLEANUP_INTERVAL_MS) || (10 * 60 * 1000));
  authStateMaintenanceTimer = setInterval(() => {
    cleanupSignalAuthState({ reason: 'interval' });
  }, intervalMs);

  if (typeof authStateMaintenanceTimer.unref === 'function') {
    authStateMaintenanceTimer.unref();
  }
}

function attachOutgoingMessageLogger(sock) {
  if (!sock || sock.__tmbSendMessageWrapped) return;

  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const safeOptions = options && typeof options === 'object' ? { ...options } : {};
    const skipConversationLog = safeOptions.__skipConversationLog === true;
    const flowPath = String(safeOptions.__flowPath || '').trim();
    delete safeOptions.__skipConversationLog;
    delete safeOptions.__flowPath;

    const text = extractOutgoingMessageText(content);
    const kind = extractOutgoingKind(content);

    try {
      const result = await original(jid, content, safeOptions);
      if (!skipConversationLog) {
        logConversationEvent({
          eventType: 'message-outgoing',
          direction: 'outgoing',
          jid,
          flowPath,
          messageText: text,
          metadata: { kind },
        });
      }
      return result;
    } catch (err) {
      if (!skipConversationLog) {
        logConversationEvent({
          eventType: 'message-outgoing-error',
          direction: 'system',
          jid,
          flowPath,
          messageText: text,
          metadata: {
            kind,
            error: formatError(err),
          },
        });
      }
      throw err;
    }
  };

  sock.__tmbSendMessageWrapped = true;
}

function normalizeRuntimeInfo() {
  const dashboardFlow = getDashboardFlow();
  const flowFile = path.basename(String(dashboardFlow?.flowPath ?? config?.flowPath ?? ''));
  const runtimeMode = String(config?.runtimeMode ?? RUNTIME_MODE.PRODUCTION);
  const conversationFlow = getConversationFlow();
  const commandFlows = getCommandFlows();
  const availableModes = [
    ...(conversationFlow ? ['conversation'] : []),
    ...(commandFlows.length > 0 ? ['command'] : []),
  ];
  const mode = conversationFlow ? 'conversation' : 'command';
  const flowPath = dashboardFlow?.flowPath ?? path.resolve(String(config?.flowPath ?? ''));
  return {
    flowFile,
    mode,
    runtimeMode,
    flowPath,
    flowPathsByMode: {
      conversation: conversationFlow ? [conversationFlow.flowPath] : [],
      command: commandFlows.map(flow => flow.flowPath),
    },
    availableModes,
  };
}

async function startDashboardServer() {
  if (dashboardServer) {
    await dashboardServer.stop();
    dashboardServer = null;
  }

  dashboardServer = new DashboardServer({
    host: config.dashboardHost,
    port: config.dashboardPort,
    getRuntimeInfo: () => ({
      ...normalizeRuntimeInfo(),
      apis: getActiveFlows()
        .flatMap(flow => flow.blocks || [])
        ?.filter(b => b.type === 'http-request')
        .map(b => ({
          name: extractApiHostFromTemplateUrl(b.config?.url),
          url: b.config?.url || 'Desconhecida',
        })) || []
    }),
    getFlowBlocks: () => getDashboardFlow()?.blocks ?? [],
    getContactName: (jid) => contactCache.get(jid)?.name || null,
    onReload: async () => await reloadFlow({ source: 'dashboard' }),
    onHumanSendMessage: async ({ jid, text, actor }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sock.sendMessage(jid, { text }, { __skipConversationLog: true });
        logConversationEvent({
          eventType: 'human-message-outgoing',
          direction: 'outgoing',
          jid,
          messageText: text,
          metadata: {
            kind: 'text',
            actor,
            source: 'dashboard-human-support',
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || 'send-failed') };
      }
    },
    onHumanSendImage: async ({ jid, actor, caption, imageBuffer, mimeType, mediaId, mediaUrl, fileName }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sock.sendMessage(
          jid,
          {
            image: imageBuffer,
            caption: String(caption || '').trim() || undefined,
            mimetype: mimeType,
          },
          { __skipConversationLog: true }
        );

        logConversationEvent({
          eventType: 'human-image-outgoing',
          direction: 'outgoing',
          jid,
          messageText: String(caption || '').trim() || `[Imagem] ${fileName || mediaId || ''}`.trim(),
          metadata: {
            kind: 'image',
            actor,
            source: 'dashboard-human-support',
            mediaId: mediaId || null,
            mediaUrl: mediaUrl || null,
            mediaType: mimeType || null,
            fileName: fileName || null,
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || 'send-image-failed') };
      }
    },
    onHumanResumeSession: async ({ jid, targetBlockIndex, targetBlockId, actor }) => {
      const sock = currentSocket;
      const flow = getDashboardFlow();
      if (!sock || !flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await resumeSessionFromHumanHandoff({
        sock,
        jid,
        flow,
        targetBlockIndex,
        actor,
      });

      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-resume-request',
        direction: 'system',
        jid,
        messageText: `Retomada solicitada para bloco ${targetBlockId || targetBlockIndex}`,
        metadata: {
          actor,
          targetBlockId: targetBlockId || null,
          targetBlockIndex,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },
    onHumanEndSession: async ({ jid, reason, actor }) => {
      const flow = getDashboardFlow();
      if (!flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await endSessionFromDashboard({ jid, flow, reason, actor });
      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-ended',
        direction: 'system',
        jid,
        messageText: 'Sessao encerrada manualmente pela equipe',
        metadata: {
          actor,
          reason,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },
  });

  await dashboardServer.start();

  if (removeConversationEventListener) {
    removeConversationEventListener();
  }
  removeConversationEventListener = onConversationEvent(event => {
    dashboardServer?.broadcast(event);
  });

  console.log(`Dashboard HTTP: ${dashboardServer.getUrl()}`);
}

function stopFlowWatcher() {
  if (!Array.isArray(flowWatchers) || flowWatchers.length === 0) return;
  for (const watcher of flowWatchers) {
    try {
      watcher?.close?.();
    } catch {
      // ignore
    }
  }
  flowWatchers = [];
}

function scheduleFlowReload(source) {
  clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(() => {
    void reloadFlow({ source });
  }, 350);
}

function setupFlowWatcher() {
  stopFlowWatcher();
  clearTimeout(reloadDebounceTimer);

  if (!isDevelopmentMode(config)) return;

  const flowPaths = getActiveFlows().map(flow => path.resolve(flow.flowPath));
  const byDirectory = new Map();

  for (const absoluteFlowPath of flowPaths) {
    const flowDir = path.dirname(absoluteFlowPath);
    const fileSet = byDirectory.get(flowDir) ?? new Set();
    fileSet.add(path.basename(absoluteFlowPath).toLowerCase());
    byDirectory.set(flowDir, fileSet);
  }

  for (const [flowDir, fileSet] of byDirectory.entries()) {
    try {
      const watcher = fs.watch(flowDir, { persistent: true }, (eventType, filename) => {
        const normalizedFilename = String(filename ?? '').trim().toLowerCase();
        if (normalizedFilename && !fileSet.has(normalizedFilename)) return;
        scheduleFlowReload(`watch:${eventType || 'change'}`);
      });

      watcher.on('error', err => {
        console.error('Falha no watcher de hot-reload:', err.message || err);
      });

      flowWatchers.push(watcher);
    } catch (err) {
      console.error('Nao foi possivel iniciar hot-reload no dev mode:', err.message || err);
    }
  }

  for (const flowPath of flowPaths) {
    console.log(`Hot-reload ativo (dev mode) para: ${flowPath}`);
  }
}

async function reloadFlow({ source = 'manual' } = {}) {
  if (reloadInProgress) {
    pendingReload = true;
    return;
  }

  reloadInProgress = true;

  try {
    const previousFlows = getActiveFlows();
    let endedSessions = 0;
    for (const flow of previousFlows) {
      endedSessions += await resetActiveSessions('flow-reload', flow);
    }

    const nextRegistry = loadFlowRegistryFromConfig(config);
    currentFlowRegistry = nextRegistry;
    warnedMissingTestTargets = false;

    if (currentSocket) {
      startSessionCleanup(currentSocket, getActiveFlows());
    }

    logConversationEvent({
      eventType: 'flow-reload',
      direction: 'system',
      jid: 'system',
      flowPath: currentPrimaryFlowPathForLogs(),
      messageText: `Reload aplicado via ${source}`,
      metadata: {
        source,
        flowPaths: getActiveFlows().map(flow => flow.flowPath),
        endedSessions,
      },
    });

    console.log(`Reload concluido (${source}). Sessoes reiniciadas: ${endedSessions}.`);
  } catch (err) {
    console.error(`Falha ao recarregar fluxo (${source}):`, err.message || err);
  } finally {
    reloadInProgress = false;
    if (pendingReload) {
      pendingReload = false;
      scheduleFlowReload('pending');
    }
  }
}

function printTerminalCommandHelp() {
  console.log('Comandos de terminal disponiveis:');
  console.log('  /reload   recarrega o .tmb atual sem reiniciar processo');
  console.log('  /help     mostra esta ajuda');
}

async function handleTerminalCommand(rawLine) {
  const input = String(rawLine ?? '').trim();
  if (!input) return;

  const command = input.toLowerCase();

  if (command === '/reload' || command === 'reload') {
    await reloadFlow({ source: 'terminal' });
    return;
  }

  if (command === '/help' || command === 'help') {
    printTerminalCommandHelp();
    return;
  }

  console.log(`Comando desconhecido: ${input}`);
  printTerminalCommandHelp();
}

function initializeTerminalCommands() {
  if (!process.stdin.isTTY) return;
  if (terminalCommandInterface) return;

  terminalCommandInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  terminalCommandInterface.on('line', line => {
    void handleTerminalCommand(line).catch(err => {
      console.error('Erro ao processar comando de terminal:', err.message || err);
    });
  });

  printTerminalCommandHelp();
}

async function start() {
  console.log('Iniciando Interpretador de Bot WhatsApp...\n');

  runtimeSetupPromise = null;
  runtimeSetupDone = false;
  warnedMissingTestTargets = false;

  config = await getConfig({ interactive: true });

  const suppressSignalNoise =
    config.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';
  installLibSignalNoiseFilter(suppressSignalNoise);

  logger = createRuntimeLogger(config);

  await initDb();
  console.log('Banco de dados inicializado (better-sqlite3 + WAL)');
  cleanupSignalAuthState({ reason: 'startup', forceLog: true });
  startAuthStateMaintenance();

  currentFlowRegistry = loadFlowRegistryFromConfig(config);
  const activeFlows = getActiveFlows();
  console.log(`Fluxos carregados - ${activeFlows.length} ativo(s)\n`);
  for (const flow of activeFlows) {
    const flowLabel = `${path.basename(flow.flowPath)} [${getFlowBotType(flow)}]`;
    console.log(`Fluxo: ${flowLabel} - ${flow.blocks.length} bloco(s) ativo(s)`);
    flow.blocks.forEach((b, i) => console.log(`   [${i}] ${b.type.padEnd(20)} id=${b.id}`));
    console.log('');
  }

  await startDashboardServer();
  setupFlowWatcher();

  const { state, saveCreds } = useSqliteAuthState();

  const { version } = await fetchLatestBaileysVersion();
  console.log(`Versao Baileys: ${version.join('.')}\n`);

  await connectToWhatsApp({ state, saveCreds, version });
}

async function connectToWhatsApp({ state, saveCreds, version }) {
  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ['WhatsApp Bot', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,
  });

  currentSocket = sock;
  attachOutgoingMessageLogger(sock);

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    mergeContactList(contactCache, contacts);
    mergeChatsIntoContactCache(contactCache, chats);
  });
  sock.ev.on('contacts.upsert', contacts => {
    mergeContactList(contactCache, contacts);
  });
  sock.ev.on('contacts.update', updates => {
    mergeContactList(contactCache, updates);
  });
  sock.ev.on('chats.upsert', chats => {
    mergeChatsIntoContactCache(contactCache, chats);
  });
  sock.ev.on('chats.update', chats => {
    mergeChatsIntoContactCache(contactCache, chats);
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nEscaneie este codigo QR com o WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        shouldReconnect
          ? `Conexao fechada (codigo ${statusCode}). Reconectando...`
          : 'Desconectado. Delete as entradas auth_state do banco de dados para reautenticar.'
      );

      if (shouldReconnect) {
        setTimeout(() => {
          void connectToWhatsApp({ state, saveCreds, version });
        }, 3000);
      }
    }

    if (connection === 'open') {
      console.log('Conectado ao WhatsApp!\n');

      if (!runtimeSetupDone && !runtimeSetupPromise) {
        runtimeSetupPromise = (async () => {
          config = await configureRuntimeAccessSelectors(sock, getDashboardFlow(), config, contactCache);
          saveUserConfig(config);
          runtimeSetupDone = true;
        })().catch(err => {
          console.error('Falha ao configurar contatos/grupos permitidos:', err);
          runtimeSetupDone = true;
        });
      }

      if (runtimeSetupPromise) {
        await runtimeSetupPromise;
      }

      startSessionCleanup(sock, getActiveFlows());
      initializeTerminalCommands();

      if (config.debugMode) {
        const testJids = Array.from(getAllowedTestJids(config));
        const groupWhitelist = Array.from(getGroupWhitelistJids(config));
        console.log('Debug mode ativo', {
          runtimeMode: config.runtimeMode,
          testMode: config.testMode,
          testJidsCount: testJids.length,
          groupWhitelistCount: groupWhitelist.length,
        });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    if (reloadInProgress) return;

    if (runtimeSetupPromise) {
      try {
        await runtimeSetupPromise;
      } catch {
        return;
      }
    }

    const activeFlows = getActiveFlows();
    if (activeFlows.length === 0) return;

    for (const msg of messages) {
      const rawRemoteJid = toJidString(msg?.key?.remoteJid);
      if (rawRemoteJid.endsWith('@s.whatsapp.net')) {
        mergeContactCacheEntry(contactCache, {
          id: rawRemoteJid,
          notify: msg?.pushName,
          verifiedName: msg?.verifiedBizName,
        });
      }
      const senderPnJid = toJidString(msg?.key?.senderPn);
      if (senderPnJid.endsWith('@s.whatsapp.net')) {
        mergeContactCacheEntry(contactCache, {
          id: senderPnJid,
          notify: msg?.pushName,
          verifiedName: msg?.verifiedBizName,
        });
      }
      const participantJid = toJidString(msg?.key?.participant);
      if (participantJid.endsWith('@s.whatsapp.net')) {
        mergeContactCacheEntry(contactCache, { id: participantJid });
      }
      const participantPnJid = toJidString(msg?.key?.participantPn);
      if (participantPnJid.endsWith('@s.whatsapp.net')) {
        mergeContactCacheEntry(contactCache, { id: participantPnJid });
      }

      if (config.debugMode) {
        console.log('Incoming raw', getMessageDebugInfo(msg, type));
      }

      const parsed = parseMessage(msg);
      if (!parsed) {
        if (config.debugMode) {
          console.log('Dropped by parser', getMessageDebugInfo(msg, type));
        }
        continue;
      }

      const { id, jid, text, listId, isGroup, messageKey, messageType, mediaMimeType, mediaFileName } = parsed;
      const actorJid = resolveIncomingActorJid(parsed);

      const groupWhitelist = getGroupWhitelistJids(config);
      const allowedTestJids = getAllowedTestJids(config);

      if (config.testMode) {
        if (allowedTestJids.size === 0) {
          if (!warnedMissingTestTargets) {
            console.warn('testMode ativo, mas nenhum contato/grupo permitido foi selecionado.');
            warnedMissingTestTargets = true;
          }
          continue;
        }
        if (!allowedTestJids.has(jid)) continue;
      }

      const incomingText = String(text ?? '').trim();
      const hasCommandPrefix = incomingText.startsWith('/');
      const dispatchFlows = [];

      for (const flow of activeFlows) {
        const interactionScope = normalizeInteractionScope(flow);
        const requiresGroupWhitelist = isGroupWhitelistScope(flow);
        if (!shouldProcessByInteractionScope(isGroup, flow)) {
          continue;
        }

        if (requiresGroupWhitelist && isGroup) {
          if (groupWhitelist.size === 0) continue;
          if (!groupWhitelist.has(jid)) continue;
        }

        const scope = { flowPath: flow.flowPath, botType: getFlowBotType(flow) };
        const existingSession = getSession(jid, scope);
        const hasActiveSession = existingSession?.status === 'active';
        const botType = getFlowBotType(flow);

        if (botType === 'command') {
          if (!hasActiveSession && !hasCommandPrefix) continue;
          dispatchFlows.push(flow);
          continue;
        }

        if (hasActiveSession || !hasCommandPrefix) {
          dispatchFlows.push(flow);
        }

        if (config.debugMode) {
          console.log('Decision', {
            id,
            jid,
            flowPath: flow.flowPath,
            botType,
            actorJid: actorJid || null,
            textLength: incomingText.length,
            listId,
            isGroup,
            interactionScope,
            requiresGroupWhitelist,
            hasActiveSession,
            groupWhitelistCount: groupWhitelist.size,
            testMode: config.testMode,
            testJidsCount: allowedTestJids.size,
            passesTestMode: !config.testMode || allowedTestJids.has(jid),
          });
        }
      }

      if (dispatchFlows.length === 0) continue;

      let incomingMedia = null;
      if (messageType === 'image') {
        incomingMedia = await captureIncomingImageForDashboard({
          msg,
          sock,
          mimeType: mediaMimeType,
          fileName: mediaFileName || `incoming-${id || Date.now()}`,
        });
      }

      const resolvedMessageText =
        incomingText ||
        (messageType === 'image' ? '[Imagem recebida]' : '');

      for (const flow of dispatchFlows) {
        logConversationEvent({
          eventType: 'message-incoming',
          direction: 'incoming',
          jid: actorJid || jid,
          flowPath: flow.flowPath,
          messageText: resolvedMessageText,
          metadata: {
            id,
            listId: listId ?? null,
            isGroup,
            actorJid: actorJid || null,
            chatJid: jid,
            kind: messageType || 'unknown',
            mediaType: messageType === 'image' ? mediaMimeType || null : null,
            mediaUrl: incomingMedia?.mediaUrl || null,
            mediaId: incomingMedia?.mediaId || null,
            routedFlowPath: flow.flowPath,
            routedFlowBotType: getFlowBotType(flow),
            routedFlowPaths: dispatchFlows.map(item => item.flowPath),
          },
        });
      }

      console.log(`Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);

      try {
        await Promise.all(
          dispatchFlows.map(flow => handleIncoming(sock, jid, text, listId, flow, id, messageKey))
        );
      } catch (err) {
        console.error(`Erro no motor para ${jid}:`, err);
        logConversationEvent({
          eventType: 'engine-error',
          direction: 'system',
          jid,
          messageText: 'Erro no motor ao processar mensagem',
          metadata: {
            id,
            actorJid: actorJid || null,
            chatJid: jid,
            error: formatError(err),
          },
        });
      }
    }
  });

  return sock;
}

start().catch(err => {
  void handleFatal('Erro fatal no start()', err);
});
