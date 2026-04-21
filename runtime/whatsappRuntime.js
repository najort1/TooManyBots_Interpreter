import makeWASocket, {
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';

function stringifyError(error, fallback = 'unknown-error') {
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function createWhatsAppRuntimeController({
  initializeReconnectPolicy,
  getReconnectController,
  getConfig,
  incrementSocketGeneration,
  getSocketGeneration,
  getLogger,
  setCurrentSocket,
  getCurrentSocket,
  attachOutgoingMessageLogger,
  noteSocketEvent,
  scheduleCredsSave,
  mergeContactList,
  mergeChatsIntoContactCache,
  getContactCache,
  flushCredsNow,
  resolveDisconnectReasonName,
  classifyDisconnectCategory,
  isLoggedOutDisconnect,
  getWhatsappHealthState,
  incrementObjectCounter,
  evaluateRuntimeGuardState,
  setRuntimeSetupDone,
  startSessionCleanup,
  getActiveFlows,
  initializeTerminalCommands,
  getAllowedTestJids,
  getGroupWhitelistJids,
  enqueueIncomingUpsertMessage,
  isReloadInProgress,
  getRuntimeSetupPromise,
  noteSocketCallbackDuration,
} = {}) {
  async function connectToWhatsApp({ state, version }) {
    if (!getReconnectController?.()) {
      initializeReconnectPolicy?.(getConfig?.() || {});
    }

    const currentGeneration = incrementSocketGeneration?.();
    const logger = getLogger?.();
    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ['WhatsApp Bot', 'Chrome', '120.0.0'],
      markOnlineOnConnect: false,
    });

    setCurrentSocket?.(sock);
    attachOutgoingMessageLogger?.(sock);

    sock.ev.on('creds.update', () => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      noteSocketEvent?.('creds.update');
      scheduleCredsSave?.('creds.update');
    });

    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      mergeContactList?.(getContactCache?.(), contacts);
      mergeChatsIntoContactCache?.(getContactCache?.(), chats);
    });

    sock.ev.on('contacts.upsert', contacts => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      mergeContactList?.(getContactCache?.(), contacts);
    });

    sock.ev.on('contacts.update', updates => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      mergeContactList?.(getContactCache?.(), updates);
    });

    sock.ev.on('chats.upsert', chats => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      mergeChatsIntoContactCache?.(getContactCache?.(), chats);
    });

    sock.ev.on('chats.update', chats => {
      if (currentGeneration !== getSocketGeneration?.()) return;
      mergeChatsIntoContactCache?.(getContactCache?.(), chats);
    });

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      noteSocketEvent?.('connection.update');
      if (currentGeneration !== getSocketGeneration?.()) return;

      if (qr) {
        console.log('\nEscaneie este codigo QR com o WhatsApp:\n');
        qrcode.generate(qr, { small: true });
        console.log('');
      }

      if (connection === 'close') {
        flushCredsNow?.('connection-close');

        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const reasonName = resolveDisconnectReasonName?.(statusCode);
        const category = classifyDisconnectCategory?.(statusCode);
        const shouldReconnect = !isLoggedOutDisconnect?.(statusCode);

        const whatsappHealthState = getWhatsappHealthState?.();
        whatsappHealthState.disconnectCount += 1;
        incrementObjectCounter?.(whatsappHealthState.disconnectByStatusCode, statusCode ?? 'unknown');
        incrementObjectCounter?.(whatsappHealthState.disconnectByCategory, category);

        if (whatsappHealthState.connectedSince > 0) {
          whatsappHealthState.totalConnectedMs += Math.max(0, Date.now() - whatsappHealthState.connectedSince);
          whatsappHealthState.connectedSince = 0;
        }
        whatsappHealthState.lastDisconnectedAt = Date.now();

        const reconnectController = getReconnectController?.();
        if (shouldReconnect) {
          const scheduleResult = reconnectController?.schedule?.({
            reason: `${category}:${reasonName}`,
            statusCode: Number(statusCode) || 0,
            connect: async () => {
              await connectToWhatsApp({ state, version });
            },
          });

          if (scheduleResult?.scheduled) {
            whatsappHealthState.reconnectHistory.push(Date.now());
            console.log(
              `Conexao fechada (codigo ${statusCode}, motivo ${reasonName}). Reconexao agendada em ${scheduleResult.delayMs}ms.`
            );
          } else {
            console.log(
              `Conexao fechada (codigo ${statusCode}, motivo ${reasonName}). Reconexao ja pendente.`
            );
          }
        } else {
          reconnectController?.close?.();
          console.log('Desconectado. Delete as entradas auth_state do banco de dados para reautenticar.');
        }

        if (getCurrentSocket?.() === sock) {
          setCurrentSocket?.(null);
        }
        evaluateRuntimeGuardState?.();
        return;
      }

      if (connection === 'open') {
        const nowTs = Date.now();
        const whatsappHealthState = getWhatsappHealthState?.();
        const hadPreviousConnection = whatsappHealthState.lastConnectedAt > 0;
        if (whatsappHealthState.lastDisconnectedAt > 0) {
          whatsappHealthState.lastDisconnectDurationMs = Math.max(0, nowTs - whatsappHealthState.lastDisconnectedAt);
        }
        whatsappHealthState.connectedSince = nowTs;
        whatsappHealthState.lastConnectedAt = nowTs;
        if (hadPreviousConnection) {
          whatsappHealthState.successfulReconnectHistory.push(nowTs);
        }
        getReconnectController?.()?.reset?.();
        evaluateRuntimeGuardState?.();

        console.log('Conectado ao WhatsApp!\n');
        setRuntimeSetupDone?.(true);

        startSessionCleanup?.(sock, getActiveFlows?.());
        initializeTerminalCommands?.();

        const config = getConfig?.();
        if (config?.debugMode) {
          const testJids = Array.from(getAllowedTestJids?.(config) || []);
          const groupWhitelist = Array.from(getGroupWhitelistJids?.(config) || []);
          console.log('Debug mode ativo', {
            runtimeMode: config.runtimeMode,
            testMode: config.testMode,
            testJidsCount: testJids.length,
            groupWhitelistCount: groupWhitelist.length,
          });
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      const callbackStartedAt = Date.now();
      noteSocketEvent?.('messages.upsert');

      try {
        if (currentGeneration !== getSocketGeneration?.()) return;
        if (type !== 'notify') return;
        if (isReloadInProgress?.()) return;
        if (!Array.isArray(messages) || messages.length === 0) return;

        const enqueueAll = () => {
          for (const msg of messages) {
            enqueueIncomingUpsertMessage?.({ sock, msg, type });
          }
        };

        const runtimeSetupPromise = getRuntimeSetupPromise?.();
        if (runtimeSetupPromise) {
          void runtimeSetupPromise
            .then(() => {
              if (currentGeneration !== getSocketGeneration?.()) return;
              enqueueAll();
            })
            .catch(err => {
              // runtimeSetupPromise rejection is already handled by handleFatal() inside
              // setupWhatsApp(). This catch suppresses the secondary unhandledRejection
              // that the Promise.then-chain would otherwise raise on the same failure.
              getLogger?.()?.debug?.(
                { error: stringifyError(err) },
                'messages.upsert: runtime setup race — secondary rejection suppressed'
              );
            });
          return;
        }

        enqueueAll();
      } finally {
        noteSocketCallbackDuration?.(Math.max(0, Date.now() - callbackStartedAt));
      }
    });

    return sock;
  }

  return {
    connectToWhatsApp,
  };
}
