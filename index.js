import fs from 'fs';
import path from 'path';
import readline from 'readline';
import inquirer from 'inquirer';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { initDb, addConversationEvent, onConversationEvent, listConversationEvents } from './db/index.js';
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

function getMessageDebugInfo(msg, type) {
  const key = msg.key ?? {};
  const remoteJid = key.remoteJid ?? '';
  const senderPn = key.senderPn ?? '';
  const participant = key.participant ?? '';
  const fromMe = Boolean(key.fromMe);
  const hasMessage = Boolean(msg.message);
  const messageKeys = hasMessage ? Object.keys(msg.message) : [];
  let dropReason = '';
  if (fromMe) dropReason = 'fromMe';
  else if (!remoteJid) dropReason = 'missingRemoteJid';
  else if (remoteJid === 'status@broadcast') dropReason = 'statusBroadcast';
  else if (!hasMessage) dropReason = 'missingMessage';
  return {
    type,
    remoteJid,
    senderPn,
    participant,
    fromMe,
    hasMessage,
    messageKeys,
    dropReason,
  };
}

function normalizeInteractionScope(flow) {
  return String(flow?.runtimeConfig?.interactionScope ?? 'all').toLowerCase();
}

function isGroupWhitelistScope(flow) {
  const scope = normalizeInteractionScope(flow);
  return scope.includes('group-whitelist') || scope.includes('whitelist-group');
}

function shouldProcessByInteractionScope(isGroup, flow) {
  const scope = normalizeInteractionScope(flow);

  if (!scope || scope === 'all' || scope === 'any' || scope === 'all-users-groups') {
    return true;
  }

  const mentionsGroup = scope.includes('group');
  const mentionsUser = scope.includes('user') || scope.includes('private') || scope.includes('direct');

  if (mentionsGroup && !mentionsUser) return isGroup;
  if (mentionsUser && !mentionsGroup) return !isGroup;
  return true;
}

function toJidString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.remoteJid === 'string') return value.remoteJid.trim();
    if (typeof value.jid === 'string') return value.jid.trim();
    if (typeof value.id === 'string') return value.id.trim();
  }
  return '';
}

function extractPersonJidFromMessageKey(messageKey = {}) {
  const candidates = [
    messageKey.participantPn,
    messageKey.senderPn,
    messageKey.participant,
    messageKey.senderJid,
  ];

  for (const candidate of candidates) {
    const jid = toJidString(candidate);
    if (jid.endsWith('@s.whatsapp.net')) return jid;
  }

  return '';
}

function resolveIncomingActorJid(parsed) {
  const keyJid = extractPersonJidFromMessageKey(parsed?.messageKey ?? {});
  if (keyJid) return keyJid;

  const parsedJid = toJidString(parsed?.jid);
  if (!parsed?.isGroup && parsedJid) return parsedJid;

  return '';
}

function toJidSet(values = []) {
  const set = new Set();
  for (const value of values) {
    const jid = toJidString(value);
    if (jid) set.add(jid);
  }
  return set;
}

function isUserJid(jid) {
  return String(jid ?? '').endsWith('@s.whatsapp.net');
}

function isGroupJid(jid) {
  return String(jid ?? '').endsWith('@g.us');
}

function isSelectableTestTargetJid(jid) {
  return isUserJid(jid) || isGroupJid(jid);
}

function normalizeManualTargetJid(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === value.length - 1) return '';
  const local = value.slice(0, atIndex).trim();
  const domain = value.slice(atIndex + 1).trim().toLowerCase();
  if (!local) return '';
  if (domain !== 's.whatsapp.net' && domain !== 'g.us') return '';
  return `${local}@${domain}`;
}

function getAllowedTestJids(currentConfig) {
  const testJids = Array.isArray(currentConfig.testJids) ? currentConfig.testJids : [];
  const set = toJidSet(testJids);
  const legacy = toJidString(currentConfig.testJid);
  if (legacy) set.add(legacy);
  return set;
}

function getGroupWhitelistJids(currentConfig) {
  const list = Array.isArray(currentConfig.groupWhitelistJids) ? currentConfig.groupWhitelistJids : [];
  return toJidSet(list);
}

function formatNameOrFallback(primary, fallback) {
  const p = String(primary ?? '').trim();
  if (p) return p;
  return String(fallback ?? '').trim() || 'Sem nome';
}

function mergeContactCacheEntry(contactCache, input) {
  if (!input || typeof input !== 'object') return;

  const jid = toJidString(input.jid) || toJidString(input.id);
  if (!jid || !isUserJid(jid)) return;

  const existing = contactCache.get(jid) ?? { jid, name: jid };
  const nextName = formatNameOrFallback(
    input.name ??
    input.notify ??
    input.verifiedName ??
    input.pushName ??
    input.pushname,
    existing.name ?? jid
  );

  contactCache.set(jid, { jid, name: nextName });
}

function mergeContactList(contactCache, list) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    mergeContactCacheEntry(contactCache, item);
  }
}

function mergeChatsIntoContactCache(contactCache, chats) {
  if (!Array.isArray(chats)) return;
  for (const chat of chats) {
    const jid = toJidString(chat?.id) || toJidString(chat?.jid);
    if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;
    mergeContactCacheEntry(contactCache, {
      id: jid,
      name: chat?.name || chat?.notify || chat?.pushName || jid,
    });
  }
}

async function waitForContactCacheWarmup(contactCache, timeoutMs = 7000) {
  const started = Date.now();
  while (contactCache.size === 0 && (Date.now() - started) < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function fetchSelectableContacts(contactCache) {
  const contacts = Array.from(contactCache.values())
    .filter(item => isUserJid(item.jid))
    .sort((a, b) => a.name.localeCompare(b.name));
  return contacts;
}

async function fetchSelectableGroups(sock) {
  const raw = await sock.groupFetchAllParticipating();
  const groups = Object.entries(raw ?? {})
    .map(([jid, group]) => ({
      jid: String(jid ?? '').trim(),
      name: formatNameOrFallback(group?.subject, jid),
      participants: Array.isArray(group?.participants) ? group.participants.length : 0,
    }))
    .filter(group => isGroupJid(group.jid))
    .sort((a, b) => a.name.localeCompare(b.name));

  return groups;
}

function extractKnownJidsFromConversationEvent(event) {
  const result = new Set();
  const candidates = [
    toJidString(event?.jid),
    toJidString(event?.metadata?.actorJid),
    toJidString(event?.metadata?.chatJid),
  ];
  for (const candidate of candidates) {
    if (isSelectableTestTargetJid(candidate)) {
      result.add(candidate);
    }
  }
  return Array.from(result);
}

function fetchSavedTestTargetJidsFromDb(contactCache, limit = 2000) {
  const events = listConversationEvents(limit);
  const map = new Map();
  for (const event of events) {
    const knownJids = extractKnownJidsFromConversationEvent(event);
    for (const jid of knownJids) {
      const knownName = contactCache.get(jid)?.name || jid;
      map.set(jid, knownName);
    }
  }
  return Array.from(map.entries())
    .map(([jid, name]) => ({ jid, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractSelectableJidsFromMessage(msg) {
  const candidates = [
    toJidString(msg?.key?.remoteJid),
    toJidString(msg?.key?.senderPn),
    toJidString(msg?.key?.participant),
    toJidString(msg?.key?.participantPn),
  ];
  const result = new Set();
  for (const candidate of candidates) {
    if (isSelectableTestTargetJid(candidate)) {
      result.add(candidate);
    }
  }
  return Array.from(result);
}

function subscribeToRealtimeJidDiscovery({ sock, contactCache, onDiscoveredJid }) {
  if (!sock?.ev || typeof onDiscoveredJid !== 'function') return () => {};
  const unsubscribeFns = [];

  const listen = (eventName, handler) => {
    if (typeof sock.ev.on !== 'function') return;
    sock.ev.on(eventName, handler);
    unsubscribeFns.push(() => {
      if (typeof sock.ev.off === 'function') {
        sock.ev.off(eventName, handler);
        return;
      }
      if (typeof sock.ev.removeListener === 'function') {
        sock.ev.removeListener(eventName, handler);
      }
    });
  };

  const pushJid = jid => {
    const normalized = toJidString(jid);
    if (!isSelectableTestTargetJid(normalized)) return;
    onDiscoveredJid(normalized);
  };

  listen('messages.upsert', ({ messages }) => {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      const discovered = extractSelectableJidsFromMessage(msg);
      for (const jid of discovered) {
        if (isUserJid(jid)) {
          mergeContactCacheEntry(contactCache, {
            id: jid,
            notify: msg?.pushName,
            verifiedName: msg?.verifiedBizName,
          });
        }
        pushJid(jid);
      }
    }
  });

  listen('contacts.upsert', contacts => {
    if (!Array.isArray(contacts)) return;
    mergeContactList(contactCache, contacts);
    for (const contact of contacts) {
      pushJid(toJidString(contact?.id) || toJidString(contact?.jid));
    }
  });

  listen('contacts.update', contacts => {
    if (!Array.isArray(contacts)) return;
    mergeContactList(contactCache, contacts);
    for (const contact of contacts) {
      pushJid(toJidString(contact?.id) || toJidString(contact?.jid));
    }
  });

  listen('chats.upsert', chats => {
    if (!Array.isArray(chats)) return;
    mergeChatsIntoContactCache(contactCache, chats);
    for (const chat of chats) {
      pushJid(toJidString(chat?.id) || toJidString(chat?.jid));
    }
  });

  listen('chats.update', chats => {
    if (!Array.isArray(chats)) return;
    mergeChatsIntoContactCache(contactCache, chats);
    for (const chat of chats) {
      pushJid(toJidString(chat?.id) || toJidString(chat?.jid));
    }
  });

  const removeConversationListener = onConversationEvent(event => {
    const discovered = extractKnownJidsFromConversationEvent(event);
    for (const jid of discovered) {
      pushJid(jid);
    }
  });
  unsubscribeFns.push(removeConversationListener);

  return () => {
    while (unsubscribeFns.length > 0) {
      const fn = unsubscribeFns.pop();
      try {
        fn?.();
      } catch {
        // ignore cleanup errors
      }
    }
  };
}

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

async function configureRuntimeAccessSelectors(sock, flow, currentConfig, contactCache) {
  const nextConfig = { ...currentConfig };
  const startupChoice = String(currentConfig.__startupChoice ?? 'reconfigure');
  const shouldReconfigureNow = startupChoice !== 'use_previous';

  if (isGroupWhitelistScope(flow)) {
    const hasSavedWhitelist = getGroupWhitelistJids(currentConfig).size > 0;
    const shouldAskGroups = shouldReconfigureNow || !hasSavedWhitelist;

    if (shouldAskGroups) {
      const groups = await fetchSelectableGroups(sock);
      console.log(`[Setup] Grupos disponiveis para whitelist: ${groups.length}`);
      if (groups.length === 0) {
        console.warn('Nenhum grupo encontrado para configurar whitelist de grupos.');
        nextConfig.groupWhitelistJids = [];
      } else {
        const defaultSelections = Array.from(getGroupWhitelistJids(currentConfig));
        const { selectedGroups } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedGroups',
            message: 'Selecione os grupos em que o bot deve funcionar (whitelist):',
            choices: groups.map(group => ({
              name: `${group.name} (${group.participants} participantes) - ${group.jid}`,
              value: group.jid,
              checked: defaultSelections.includes(group.jid),
            })),
            pageSize: 20,
            validate: selected => (selected.length > 0 ? true : 'Selecione pelo menos 1 grupo.'),
          },
        ]);

        nextConfig.groupWhitelistJids = selectedGroups;
      }
    }
  }

  if (currentConfig.testMode) {
    const hasSavedTestTargets = getAllowedTestJids(currentConfig).size > 0;
    const shouldAskTestTargets = shouldReconfigureNow || !hasSavedTestTargets;

    if (shouldAskTestTargets) {
      const ACTION_REFRESH = '__refresh_realtime__';
      const ACTION_MANUAL = '__manual_jid_entry__';
      const selectedSet = getAllowedTestJids(currentConfig);
      const discoveredDuringSelection = new Set();

      const stopRealtimeDiscovery = subscribeToRealtimeJidDiscovery({
        sock,
        contactCache,
        onDiscoveredJid: jid => {
          if (isSelectableTestTargetJid(jid)) {
            discoveredDuringSelection.add(jid);
          }
        },
      });

      try {
        await waitForContactCacheWarmup(contactCache, 7000);

        while (true) {
          const contacts = await fetchSelectableContacts(contactCache);
          let groups = [];
          try {
            groups = await fetchSelectableGroups(sock);
          } catch {
            groups = [];
          }

          const savedFromDb = fetchSavedTestTargetJidsFromDb(contactCache);
          for (const item of savedFromDb) {
            discoveredDuringSelection.add(item.jid);
          }

          const knownContactJids = new Set(contacts.map(item => item.jid));
          const knownGroupJids = new Set(groups.map(item => item.jid));
          const additionalFromDbUsers = [];
          const additionalFromDbGroups = [];

          for (const entry of savedFromDb) {
            if (isUserJid(entry.jid) && !knownContactJids.has(entry.jid)) {
              additionalFromDbUsers.push({
                jid: entry.jid,
                name: entry.name || entry.jid,
              });
            } else if (isGroupJid(entry.jid) && !knownGroupJids.has(entry.jid)) {
              additionalFromDbGroups.push({
                jid: entry.jid,
                name: entry.name || entry.jid,
                participants: 0,
              });
            }
          }

          const additionalRealtimeUsers = [];
          const additionalRealtimeGroups = [];
          for (const jid of discoveredDuringSelection) {
            if (isUserJid(jid) && !knownContactJids.has(jid) && !additionalFromDbUsers.some(item => item.jid === jid)) {
              additionalRealtimeUsers.push({
                jid,
                name: contactCache.get(jid)?.name || jid,
              });
            } else if (isGroupJid(jid) && !knownGroupJids.has(jid) && !additionalFromDbGroups.some(item => item.jid === jid)) {
              additionalRealtimeGroups.push({
                jid,
                name: jid,
                participants: 0,
              });
            }
          }

          const allUsers = [...contacts, ...additionalFromDbUsers, ...additionalRealtimeUsers]
            .sort((a, b) => a.name.localeCompare(b.name));
          const allGroups = [...groups, ...additionalFromDbGroups, ...additionalRealtimeGroups]
            .sort((a, b) => a.name.localeCompare(b.name));

          console.log(
            `[Setup] Alvos de test mode: ${allUsers.length} contato(s), ${allGroups.length} grupo(s), ${savedFromDb.length} JID(s) recuperado(s) do banco`
          );

          const choices = [];
          if (allUsers.length > 0) {
            choices.push(new inquirer.Separator('--- Contatos ---'));
            for (const contact of allUsers) {
              choices.push({
                name: `${contact.name} - ${contact.jid}`,
                value: contact.jid,
                checked: selectedSet.has(contact.jid),
              });
            }
          }

          if (allGroups.length > 0) {
            choices.push(new inquirer.Separator('--- Grupos ---'));
            for (const group of allGroups) {
              const participantsLabel = Number(group.participants) > 0
                ? `${group.participants} participantes`
                : 'participantes desconhecidos';
              choices.push({
                name: `${group.name} (${participantsLabel}) - ${group.jid}`,
                value: group.jid,
                checked: selectedSet.has(group.jid),
              });
            }
          }

          choices.push(new inquirer.Separator('--- Acoes ---'));
          choices.push({
            name: 'Atualizar lista com JIDs detectados em tempo real',
            value: ACTION_REFRESH,
          });
          choices.push({
            name: 'Adicionar JID manualmente (fallback)',
            value: ACTION_MANUAL,
          });

          const { selectedTestTargets } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selectedTestTargets',
              message: 'Selecione contatos/grupos permitidos no modo Teste restrito:',
              choices,
              pageSize: 24,
              validate: selected => {
                const filtered = selected.filter(item => item !== ACTION_REFRESH && item !== ACTION_MANUAL);
                if (
                  filtered.length > 0 ||
                  selected.includes(ACTION_MANUAL) ||
                  selected.includes(ACTION_REFRESH)
                ) {
                  return true;
                }
                return 'Selecione pelo menos 1 alvo para teste, adicione manualmente, ou use Atualizar.';
              },
            },
          ]);

          const hasRefreshAction = selectedTestTargets.includes(ACTION_REFRESH);
          const hasManualAction = selectedTestTargets.includes(ACTION_MANUAL);
          const filteredSelection = selectedTestTargets.filter(item => item !== ACTION_REFRESH && item !== ACTION_MANUAL);

          // Em refresh puro, preserva selecao anterior e apenas remonta a lista.
          if (hasRefreshAction && !hasManualAction && filteredSelection.length === 0) {
            console.log(
              `[Setup] Atualizacao solicitada. JIDs observados em tempo real nesta tela: ${discoveredDuringSelection.size}`
            );
            continue;
          }

          selectedSet.clear();
          for (const jid of filteredSelection) {
            selectedSet.add(jid);
          }

          if (hasManualAction) {
            const { manualJidsRaw } = await inquirer.prompt([
              {
                type: 'input',
                name: 'manualJidsRaw',
                message:
                  'Digite 1+ JIDs (separados por virgula). Ex: 5511999999999@s.whatsapp.net, 120363025746111111@g.us',
                validate: raw => {
                  const parts = String(raw ?? '')
                    .split(/[,\s;]+/)
                    .map(item => item.trim())
                    .filter(Boolean);
                  if (parts.length === 0) return 'Informe pelo menos 1 JID.';
                  const invalid = parts.filter(item => !normalizeManualTargetJid(item));
                  if (invalid.length > 0) {
                    return `JID invalido: ${invalid[0]}. Use @s.whatsapp.net (contato) ou @g.us (grupo).`;
                  }
                  return true;
                },
              },
            ]);

            const manualJids = String(manualJidsRaw ?? '')
              .split(/[,\s;]+/)
              .map(item => normalizeManualTargetJid(item))
              .filter(Boolean);

            for (const jid of manualJids) {
              selectedSet.add(jid);
              discoveredDuringSelection.add(jid);
              if (isUserJid(jid)) {
                mergeContactCacheEntry(contactCache, { id: jid });
              }
            }
          }

          if (hasRefreshAction) {
            console.log(
              `[Setup] Atualizacao solicitada. JIDs observados em tempo real nesta tela: ${discoveredDuringSelection.size}`
            );
            continue;
          }

          if (selectedSet.size === 0) {
            console.warn('Nenhum alvo selecionado. Desativando test mode restrito.');
            nextConfig.testMode = false;
            nextConfig.testJid = '';
            nextConfig.testJids = [];
          } else {
            const finalTargets = Array.from(selectedSet);
            nextConfig.testJids = finalTargets;
            nextConfig.testJid = finalTargets[0] ?? '';
          }
          break;
        }
      } finally {
        stopRealtimeDiscovery();
      }
    }
  }

  delete nextConfig.__startupChoice;
  return nextConfig;
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
