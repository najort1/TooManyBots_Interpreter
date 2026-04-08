import fs from 'fs';
import path from 'path';
import readline from 'readline';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { initDb, addConversationEvent, onConversationEvent } from './db/index.js';
import { useSqliteAuthState } from './db/authState.js';
import { loadFlow } from './engine/flowLoader.js';
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
let currentFlow = null;
let currentSocket = null;
let runtimeSetupPromise = null;
let runtimeSetupDone = false;
let warnedMissingTestTargets = false;
let reloadInProgress = false;
let pendingReload = false;
let reloadDebounceTimer = null;
let flowWatcher = null;
let terminalCommandInterface = null;
let dashboardServer = null;
let removeConversationEventListener = null;
const contactCache = new Map();

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

function isDevelopmentMode(currentConfig) {
  return String(currentConfig?.runtimeMode ?? '').toLowerCase() === RUNTIME_MODE.DEVELOPMENT;
}

function currentFlowPathForLogs() {
  return currentFlow?.flowPath ?? String(config?.flowPath ?? '');
}

function logConversationEvent({
  eventType = 'message',
  direction = 'system',
  jid = 'unknown',
  messageText = '',
  metadata = {},
}) {
  addConversationEvent({
    occurredAt: Date.now(),
    eventType,
    direction,
    jid,
    flowPath: currentFlowPathForLogs(),
    messageText,
    metadata,
  });
}

function extractOutgoingMessageText(content) {
  if (!content || typeof content !== 'object') return '';
  if (typeof content.text === 'string' && content.text.trim()) return content.text;
  if (content.react?.text) return `[react] ${content.react.text}`;
  if (content.listMessage?.description) return content.listMessage.description;
  if (content.listMessage?.title) return content.listMessage.title;
  if (content.buttonsMessage?.contentText) return content.buttonsMessage.contentText;
  return '';
}

function extractOutgoingKind(content) {
  if (!content || typeof content !== 'object') return 'unknown';
  if (content.text) return 'text';
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

function attachOutgoingMessageLogger(sock) {
  if (!sock || sock.__tmbSendMessageWrapped) return;

  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const text = extractOutgoingMessageText(content);
    const kind = extractOutgoingKind(content);

    try {
      const result = await original(jid, content, options);
      logConversationEvent({
        eventType: 'message-outgoing',
        direction: 'outgoing',
        jid,
        messageText: text,
        metadata: { kind },
      });
      return result;
    } catch (err) {
      logConversationEvent({
        eventType: 'message-outgoing-error',
        direction: 'system',
        jid,
        messageText: text,
        metadata: {
          kind,
          error: formatError(err),
        },
      });
      throw err;
    }
  };

  sock.__tmbSendMessageWrapped = true;
}

function normalizeRuntimeInfo() {
  const flowFile = path.basename(String(config?.flowPath ?? ''));
  const runtimeMode = String(config?.runtimeMode ?? RUNTIME_MODE.PRODUCTION);
  const mode = currentFlow?.runtimeConfig?.conversationMode === 'command' ? 'command' : 'conversation';
  const flowPath = currentFlow?.flowPath ?? path.resolve(String(config?.flowPath ?? ''));
  return { flowFile, mode, runtimeMode, flowPath };
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
      apis: currentFlow?.blocks
        ?.filter(b => b.type === 'http-request')
        .map(b => ({
          name: extractApiHostFromTemplateUrl(b.config?.url),
          url: b.config?.url || 'Desconhecida',
        })) || []
    }),
    getFlowBlocks: () => currentFlow?.blocks ?? [],
    getContactName: (jid) => contactCache.get(jid)?.name || null,
    onReload: async () => await reloadFlow({ source: 'dashboard' }),
    onHumanSendMessage: async ({ jid, text, actor }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sock.sendMessage(jid, { text });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || 'send-failed') };
      }
    },
    onHumanResumeSession: async ({ jid, targetBlockIndex, targetBlockId, actor }) => {
      const sock = currentSocket;
      const flow = currentFlow;
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
      const flow = currentFlow;
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
  if (!flowWatcher) return;
  try {
    flowWatcher.close();
  } catch {
    // ignore
  }
  flowWatcher = null;
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

  const absoluteFlowPath = path.resolve(config.flowPath);
  const flowDir = path.dirname(absoluteFlowPath);
  const flowFile = path.basename(absoluteFlowPath).toLowerCase();

  try {
    flowWatcher = fs.watch(flowDir, { persistent: true }, (eventType, filename) => {
      const normalizedFilename = String(filename ?? '').trim().toLowerCase();
      if (normalizedFilename && normalizedFilename !== flowFile) return;
      scheduleFlowReload(`watch:${eventType || 'change'}`);
    });

    flowWatcher.on('error', err => {
      console.error('Falha no watcher de hot-reload:', err.message || err);
    });

    console.log(`Hot-reload ativo (dev mode) para: ${absoluteFlowPath}`);
  } catch (err) {
    console.error('Nao foi possivel iniciar hot-reload no dev mode:', err.message || err);
  }
}

async function reloadFlow({ source = 'manual' } = {}) {
  if (reloadInProgress) {
    pendingReload = true;
    return;
  }

  reloadInProgress = true;

  try {
    const nextFlow = loadFlow(config.flowPath);
    const endedSessions = await resetActiveSessions('flow-reload', currentFlow ?? nextFlow);

    currentFlow = nextFlow;
    warnedMissingTestTargets = false;

    if (currentSocket) {
      startSessionCleanup(currentSocket, currentFlow);
    }

    logConversationEvent({
      eventType: 'flow-reload',
      direction: 'system',
      jid: 'system',
      messageText: `Reload aplicado via ${source}`,
      metadata: {
        source,
        flowPath: currentFlow.flowPath,
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

  logger = pino(
    config.prettyLogs
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}
  );
  logger.level = config.logLevel;

  await initDb();
  console.log('Banco de dados inicializado (better-sqlite3 + WAL)');

  currentFlow = loadFlow(config.flowPath);
  console.log(`Fluxo carregado - ${currentFlow.blocks.length} bloco(s) ativo(s)\n`);
  currentFlow.blocks.forEach((b, i) => console.log(`   [${i}] ${b.type.padEnd(20)} id=${b.id}`));
  console.log('');

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
          config = await configureRuntimeAccessSelectors(sock, currentFlow, config, contactCache);
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

      startSessionCleanup(sock, currentFlow);
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

    const flow = currentFlow;
    if (!flow) return;

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

      const { id, jid, text, listId, isGroup, messageKey } = parsed;
      const actorJid = resolveIncomingActorJid(parsed);

      const interactionScope = normalizeInteractionScope(flow);
      const requiresGroupWhitelist = isGroupWhitelistScope(flow);
      const groupWhitelist = getGroupWhitelistJids(config);
      const allowedTestJids = getAllowedTestJids(config);

      if (!shouldProcessByInteractionScope(isGroup, flow)) continue;

      if (requiresGroupWhitelist && isGroup) {
        if (groupWhitelist.size === 0) continue;
        if (!groupWhitelist.has(jid)) continue;
      }

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

      if (config.debugMode) {
        console.log('Decision', {
          id,
          jid,
          actorJid: actorJid || null,
          textLength: String(text ?? '').length,
          listId,
          isGroup,
          interactionScope,
          requiresGroupWhitelist,
          groupWhitelistCount: groupWhitelist.size,
          testMode: config.testMode,
          testJidsCount: allowedTestJids.size,
          passesTestMode: !config.testMode || allowedTestJids.has(jid),
        });
      }

      logConversationEvent({
        eventType: 'message-incoming',
        direction: 'incoming',
        jid: actorJid || jid,
        messageText: text,
        metadata: {
          id,
          listId: listId ?? null,
          isGroup,
          actorJid: actorJid || null,
          chatJid: jid,
        },
      });

      console.log(`Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);

      try {
        await handleIncoming(sock, jid, text, listId, flow, id, messageKey);
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
