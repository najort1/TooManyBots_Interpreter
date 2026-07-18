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
import { sendTextMessage, sendImageMessage, sendStickerMessage } from '../engine/sender.js';
import { resolveIncomingActorJid } from '../runtime/contactUtils.js';
import { createInstanceLock } from '../runtime/instanceLock.js';
import { createReconnectController } from '../runtime/reconnectController.js';
import { createFunModule } from './index.js';
import { loadFunUserConfig, FUN_DEFAULT_DATA_DIR } from './config.js';
import { runFunSetupWizard, shouldRunFunWizard } from './wizard.js';
import { startFunDashboardServer } from './dashboard/server.js';
import { extractMentionedJids } from './utils/mentions.js';

function resolveDisconnectReasonName(statusCode) {
  const entry = Object.entries(DisconnectReason).find(([, code]) => Number(code) === Number(statusCode));
  return entry?.[0] || String(statusCode ?? 'unknown');
}

function isLoggedOutDisconnect(statusCode) {
  return Number(statusCode) === DisconnectReason.loggedOut;
}

function extractQuotedParticipant(msg) {
  const content = msg?.message || {};
  const layers = [
    content.extendedTextMessage?.contextInfo,
    content.imageMessage?.contextInfo,
    content.ephemeralMessage?.message?.extendedTextMessage?.contextInfo,
  ];
  for (const ctx of layers) {
    const p = String(ctx?.participant || ctx?.participantPn || '').trim();
    if (p) return p;
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
  const baileysLogger = pino({ level: config.debugMode ? 'info' : 'error' });
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

  const funModule = createFunModule({
    getConfig,
    getLogger: () => logger,
    sendText: sendTextMessage,
    sendImage: sendImageMessage,
    sendSticker: sendStickerMessage,
    getContactDisplayName,
  });
  funModule.init();

  let socketGeneration = 0;
  let currentSocket = null;
  let saveCreds = null;
  let dashboardStarted = false;
  let messagesEnabled = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let worldTickTimer = null;
  let worldTickRunning = false;
  /** @type {ReturnType<typeof createConnectionOpenGate> | null} */
  let openGate = null;

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
      });
      dashboardStarted = true;
    } catch (err) {
      console.warn('[fun] Dashboard nao iniciou:', String(err?.message || err));
    }
  }

  // API cedo — antes de Ollama/WA (UI Next não precisa de QR)
  await ensureDashboard();

  // Flavor: Zen (principal) + Ollama (fallback local)
  const zenOn = config.zenEnabled !== false;
  const ollamaOn = config.ollamaEnabled !== false;
  if (zenOn) {
    console.log(
      `[fun] Flavor LLM: Zen principal → ${config.zenBaseUrl || 'http://127.0.0.1:3000'} · model=${config.zenModel || 'deepseek-v4-flash-free'}`
    );
  }
  if (ollamaOn && config.ollamaWarmupOnBoot !== false) {
    const model = config.ollamaModel || 'gemma4:latest';
    console.log(`[fun] Aquecendo Ollama fallback (${model})…`);
    try {
      const warm = await funModule.warmupLlm();
      if (warm?.ok) {
        console.log(`[fun] Ollama pronto em ${warm.ms}ms — fallback residente`);
      } else {
        console.warn(
          `[fun] Ollama warmup falhou (${warm?.reason || 'erro'}). Fallback local sob demanda / template.`
        );
      }
    } catch (err) {
      console.warn(`[fun] Ollama warmup erro: ${err?.message || err}`);
    }
  } else if (!zenOn && !ollamaOn) {
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

    const mentionedJids = extractMentionedJids(msg);
    let quotedParticipant = extractQuotedParticipant(msg);

    // Aprende lid→pn sempre que o actor real (PN) chega com key de participante LID
    if (actorJid) {
      funModule.identityMap?.learnFromMessageKey?.(msg?.key || parsed.messageKey, actorJid);
      // se o reply veio como lid, tenta mapear
      if (quotedParticipant && !quotedParticipant.endsWith('@s.whatsapp.net')) {
        const mapped = funModule.identityMap?.resolve?.(quotedParticipant);
        if (mapped) quotedParticipant = mapped;
      }
    }

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
        if (!isReconnect) {
          console.log('[fun] Conectando…');
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const reasonName = resolveDisconnectReasonName(statusCode);
        const shouldReconnect = !isLoggedOutDisconnect(statusCode);

        if (currentSocket === sock) currentSocket = null;

        if (shouldReconnect) {
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
        } else {
          reconnectController.close?.();
          console.log(
            '[fun] Desconectado (logged out). Apague data/fun/runtime.db (auth) para reautenticar.'
          );
        }
        return;
      }

      if (connection === 'open') {
        reconnectController.reset?.();
        console.log('[fun] Conectado ao WhatsApp.\n');
        messagesEnabled = true;
        openGate?.signalOpen('connection-open');
      }

      // Alguns estados multi-device marcam user sem emitir open de novo
      if (isSocketReady(sock)) {
        openGate?.signalOpen('user-ready');
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (currentGeneration !== socketGeneration) return;
      if (type !== 'notify') return;
      if (!Array.isArray(messages) || messages.length === 0) return;

      for (const msg of messages) {
        void processIncoming({ sock, msg, type }).catch(err => {
          console.error('[fun] Erro ao processar mensagem:', String(err?.message || err));
        });
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

  console.log(
    messagesEnabled
      ? '[fun] Pronto. /help · /cf · /bingo · /tarot · /loja · relógio do mundo ON\n'
      : '[fun] API dashboard ativa. Escaneie o QR quando o ban acabar.\n'
  );

  return { config, getSocket: () => currentSocket, funModule, stopWorldClock };
}
