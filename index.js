/**
 * index.js — Interpretador de Bot WhatsApp
 *
 * Ponto de entrada. Conecta ao WhatsApp via Baileys, carrega o fluxo .tmb,
 * e roteia cada mensagem recebida através do motor de fluxo.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import { initDb } from './db/index.js';
import { useSqliteAuthState } from './db/authState.js';
import { loadFlow } from './engine/flowLoader.js';
import { parseMessage } from './engine/messageParser.js';
import { handleIncoming } from './engine/flowEngine.js';
import { getConfig } from './config/index.js';

// ─── Logger ───────────────────────────────────────────────────────────────────
let config;
let logger;

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

// ─── Inicialização ────────────────────────────────────────────────────────────────

async function start() {
  console.log('🤖 Iniciando Interpretador de Bot WhatsApp...\n');

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
      if (config.debugMode) {
        console.log('🐞 Debug mode ativo', {
          testMode: config.testMode,
          testJid: String(config.testJid ?? '').trim(),
          ignoreGroups: config.ignoreGroups,
        });
      }
    }
  });

  // ── Mensagens recebidas ──────────────────────────────────────────────────────

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
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

      const { id, jid, text, listId } = parsed;

      if (config.ignoreGroups && jid.endsWith('@g.us')) continue;

      if (config.testMode) {
        const allowedJid = String(config.testJid ?? '').trim();
        if (!allowedJid) {
          console.warn('⚠️ testMode ativo, mas testJid está vazio.');
          continue;
        }
        if (jid !== allowedJid) continue;
      }

      if (config.debugMode) {
        const allowedJid = String(config.testJid ?? '').trim();
        console.log('🐞 Decision', {
          id,
          jid,
          textLength: String(text ?? '').length,
          listId,
          isGroup: jid.endsWith('@g.us'),
          ignoreGroups: config.ignoreGroups,
          testMode: config.testMode,
          testJid: allowedJid,
          passesTestMode: !config.testMode || (allowedJid && jid === allowedJid),
        });
      }

      console.log(`📨 Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);

      try {
        await handleIncoming(sock, jid, text, listId, flow, id);
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
