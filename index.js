/**
 * index.js — Interpretador de Bot WhatsApp
 *
 * Ponto de entrada. Conecta ao WhatsApp via Baileys, carrega o fluxo .tmb,
 * e roteia cada mensagem recebida através do motor de fluxo.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import inquirer from 'inquirer';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { initDb } from './db/index.js';
import { useSqliteAuthState } from './db/authState.js';
import { loadFlow } from './engine/flowLoader.js';
import { parseMessage } from './engine/messageParser.js';
import { handleIncoming, startSessionCleanup } from './engine/flowEngine.js';
import { getConfig, saveUserConfig } from './config/index.js';

// ─── Logger ───────────────────────────────────────────────────────────────────
let config;
let logger;
let runtimeSetupPromise = null;
let runtimeSetupDone = false;
let warnedMissingTestTargets = false;

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
  console.error(`\n❌ ${prefix}`);
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

function toJidSet(values = []) {
  const set = new Set();
  for (const value of values) {
    const jid = toJidString(value);
    if (jid) set.add(jid);
  }
  return set;
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
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return;

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
    .filter(item => item.jid.endsWith('@s.whatsapp.net'))
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
    .filter(group => group.jid.endsWith('@g.us'))
    .sort((a, b) => a.name.localeCompare(b.name));

  return groups;
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

  if (currentConfig.testMode && String(currentConfig.testTargetMode ?? 'contacts') !== 'manual') {
    const hasSavedTestTargets = getAllowedTestJids(currentConfig).size > 0;
    const shouldAskContacts = shouldReconfigureNow || !hasSavedTestTargets;

    if (shouldAskContacts) {
      await waitForContactCacheWarmup(contactCache, 7000);
      const contacts = await fetchSelectableContacts(contactCache);
      console.log(`[Setup] Contatos disponiveis para test mode: ${contacts.length}`);
      if (contacts.length === 0) {
        console.warn('Nenhum contato encontrado para configurar test mode por contato.');
        nextConfig.testMode = false;
        nextConfig.testJid = '';
        nextConfig.testJids = [];
      } else {
        const defaultSelections = Array.from(getAllowedTestJids(currentConfig));
        const { selectedContacts } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedContacts',
            message: 'Selecione os contatos permitidos para test mode:',
            choices: contacts.map(contact => ({
              name: `${contact.name} - ${contact.jid}`,
              value: contact.jid,
              checked: defaultSelections.includes(contact.jid),
            })),
            pageSize: 20,
            validate: selected => (selected.length > 0 ? true : 'Selecione pelo menos 1 contato.'),
          },
        ]);

        nextConfig.testJids = selectedContacts;
        nextConfig.testJid = selectedContacts[0] ?? '';
      }
    }
  }

  delete nextConfig.__startupChoice;
  return nextConfig;
}

// ─── Inicialização ────────────────────────────────────────────────────────────────

async function start() {
  console.log('🤖 Iniciando Interpretador de Bot WhatsApp...\n');

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

  // 1. Banco de dados (better-sqlite3 com WAL mode)
  await initDb();
  console.log('✅ Banco de dados inicializado (better-sqlite3 + WAL)');

  // 2. Fluxo
  const flow = loadFlow(config.flowPath);
  console.log(`✅ Fluxo carregado — ${flow.blocks.length} bloco(s) ativo(s)\n`);
  flow.blocks.forEach((b, i) => console.log(`   [${i}] ${b.type.padEnd(20)} id=${b.id}`));
  console.log('');

  // 3. Estado de autenticação (baseado em SQLite)
  const { state, saveCreds } = useSqliteAuthState();

  // 4. Versão Baileys
  const { version } = await fetchLatestBaileysVersion();
  console.log(`✅ Versão Baileys: ${version.join('.')}\n`);

  await connectToWhatsApp({ state, saveCreds, flow, version });
}

// ─── Conexão WhatsApp ──────────────────────────────────────────────────────

async function connectToWhatsApp({ state, saveCreds, flow, version }) {
  const contactCache = new Map();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false, // nós lidamos com o QR nós mesmos
    browser: ['WhatsApp Bot', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,
  });

  // ── Eventos de autenticação ────────────────────────────────────────────────────────────

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
      console.log('\n📱 Escaneie este código QR com o WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        shouldReconnect
          ? `🔁 Conexão fechada (código ${statusCode}). Reconectando...`
          : '🚪 Desconectado. Delete as entradas auth_state do banco de dados para reautenticar.'
      );

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp({ state, saveCreds, flow, version }), 3000);
      }
    }

    if (connection === 'open') {
      console.log('✅ Conectado ao WhatsApp!\n');

      if (!runtimeSetupDone && !runtimeSetupPromise) {
        runtimeSetupPromise = (async () => {
          config = await configureRuntimeAccessSelectors(sock, flow, config, contactCache);
          saveUserConfig(config);
          runtimeSetupDone = true;
        })().catch(err => {
          console.error('❌ Falha ao configurar contatos/grupos permitidos:', err);
          runtimeSetupDone = true;
        });
      }

      if (runtimeSetupPromise) {
        await runtimeSetupPromise;
      }

      startSessionCleanup(sock, flow);
      if (config.debugMode) {
        const testJids = Array.from(getAllowedTestJids(config));
        const groupWhitelist = Array.from(getGroupWhitelistJids(config));
        console.log('🐞 Debug mode ativo', {
          testMode: config.testMode,
          testTargetMode: config.testTargetMode,
          testJidsCount: testJids.length,
          groupWhitelistCount: groupWhitelist.length,
          ignoreGroups: config.ignoreGroups,
        });
      }
    }
  });

  // ── Mensagens recebidas ──────────────────────────────────────────────────────

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    if (runtimeSetupPromise) {
      try {
        await runtimeSetupPromise;
      } catch {
        return;
      }
    }

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
      if (config.debugMode) {
        console.log('🐞 Incoming raw', getMessageDebugInfo(msg, type));
      }
      const parsed = parseMessage(msg);
      if (!parsed) {
        if (config.debugMode) {
          console.log('🐞 Dropped by parser', getMessageDebugInfo(msg, type));
        }
        continue;
      }

      const { id, jid, text, listId, isGroup, messageKey } = parsed;

      const interactionScope = normalizeInteractionScope(flow);
      const scopeAllowsGroups = interactionScope.includes('group');
      const requiresGroupWhitelist = isGroupWhitelistScope(flow);
      const groupWhitelist = getGroupWhitelistJids(config);
      const allowedTestJids = getAllowedTestJids(config);

      if (config.ignoreGroups && isGroup && !scopeAllowsGroups) continue;
      if (!shouldProcessByInteractionScope(isGroup, flow)) continue;

      if (requiresGroupWhitelist && isGroup) {
        if (groupWhitelist.size === 0) continue;
        if (!groupWhitelist.has(jid)) continue;
      }

      if (config.testMode) {
        if (allowedTestJids.size === 0) {
          if (!warnedMissingTestTargets) {
            console.warn('⚠️ testMode ativo, mas nenhum contato permitido foi selecionado.');
            warnedMissingTestTargets = true;
          }
          continue;
        }
        if (!allowedTestJids.has(jid)) continue;
      }

      if (config.debugMode) {
        console.log('🐞 Decision', {
          id,
          jid,
          textLength: String(text ?? '').length,
          listId,
          isGroup,
          interactionScope,
          ignoreGroups: config.ignoreGroups,
          requiresGroupWhitelist,
          groupWhitelistCount: groupWhitelist.size,
          testMode: config.testMode,
          testJidsCount: allowedTestJids.size,
          passesTestMode: !config.testMode || allowedTestJids.has(jid),
        });
      }

      console.log(`📨 Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);

      try {
        await handleIncoming(sock, jid, text, listId, flow, id, messageKey);
      } catch (err) {
        console.error(`❌ Erro no motor para ${jid}:`, err);
      }
    }
  });

  return sock;
}

// ─── Executar ──────────────────────────────────────────────────────────────────────

start().catch(err => {
  void handleFatal('Erro fatal no start()', err);
});
