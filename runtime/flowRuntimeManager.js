import fs from 'fs';
import path from 'path';
import readline from 'readline';

function stringifyError(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return String(error);
}

export function createFlowRuntimeManager({
  getConfig,
  isDevelopmentMode,
  getActiveFlows,
  resetActiveSessions,
  loadFlowRegistryFromConfig,
  applyFlowSessionTimeoutOverrides,
  setCurrentFlowRegistry,
  setWarnedMissingTestTargets,
  getCurrentSocket,
  startSessionCleanup,
  logConversationEvent,
  currentPrimaryFlowPathForLogs,
} = {}) {
  let reloadInProgress = false;
  let pendingReload = false;
  let reloadDebounceTimer = null;
  let flowWatchers = [];
  let terminalCommandInterface = null;

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

    const config = getConfig();
    if (!isDevelopmentMode(config) || config.autoReloadFlows === false) return;

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
          console.error('Falha no watcher de hot-reload:', stringifyError(err));
        });

        flowWatchers.push(watcher);
      } catch (err) {
        console.error('Nao foi possivel iniciar hot-reload no dev mode:', stringifyError(err));
      }
    }

    for (const flowPath of flowPaths) {
      console.log(`Hot-reload ativo (dev mode) para: ${flowPath}`);
    }
  }

  async function reloadFlow({ source = 'manual' } = {}) {
    if (reloadInProgress) {
      pendingReload = true;
      return { ok: false, pending: true, error: 'reload-already-in-progress' };
    }

    reloadInProgress = true;
    const normalizedSource = String(source || 'manual');

    try {
      const previousFlows = getActiveFlows();
      logConversationEvent({
        eventType: 'flow-reload-start',
        direction: 'system',
        jid: 'system',
        flowPath: currentPrimaryFlowPathForLogs(),
        messageText: `Reload iniciado via ${normalizedSource}`,
        metadata: {
          source: normalizedSource,
          flowPaths: previousFlows.map(flow => flow.flowPath),
        },
      });

      let endedSessions = 0;
      for (const flow of previousFlows) {
        endedSessions += await resetActiveSessions('flow-reload', flow);
      }

      const config = getConfig();
      const nextRegistry = loadFlowRegistryFromConfig(config);
      setCurrentFlowRegistry(applyFlowSessionTimeoutOverrides(nextRegistry, config));
      setWarnedMissingTestTargets(false);

      const currentSocket = getCurrentSocket();
      if (currentSocket) {
        startSessionCleanup(currentSocket, getActiveFlows());
      }

      logConversationEvent({
        eventType: 'flow-reload-success',
        direction: 'system',
        jid: 'system',
        flowPath: currentPrimaryFlowPathForLogs(),
        messageText: `Reload aplicado via ${normalizedSource}`,
        metadata: {
          source: normalizedSource,
          flowPaths: getActiveFlows().map(flow => flow.flowPath),
          endedSessions,
        },
      });

      console.log(`Reload concluido (${normalizedSource}). Sessoes reiniciadas: ${endedSessions}.`);
      return {
        ok: true,
        source: normalizedSource,
        endedSessions,
        flowPaths: getActiveFlows().map(flow => flow.flowPath),
      };
    } catch (err) {
      const errorMessage = stringifyError(err);
      logConversationEvent({
        eventType: 'flow-reload-error',
        direction: 'system',
        jid: 'system',
        flowPath: currentPrimaryFlowPathForLogs(),
        messageText: `Falha ao recarregar fluxo via ${normalizedSource}`,
        metadata: {
          source: normalizedSource,
          error: errorMessage,
        },
      });
      console.error(`Falha ao recarregar fluxo (${normalizedSource}):`, errorMessage);
      return {
        ok: false,
        source: normalizedSource,
        error: errorMessage,
      };
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
        console.error('Erro ao processar comando de terminal:', stringifyError(err));
      });
    });

    printTerminalCommandHelp();
  }

  function isReloadInProgress() {
    return reloadInProgress;
  }

  function resetState() {
    reloadInProgress = false;
    pendingReload = false;
    clearTimeout(reloadDebounceTimer);
    reloadDebounceTimer = null;
    stopFlowWatcher();
    if (terminalCommandInterface) {
      try {
        terminalCommandInterface.close();
      } catch {
        // ignore
      }
      terminalCommandInterface = null;
    }
  }

  return {
    stopFlowWatcher,
    setupFlowWatcher,
    reloadFlow,
    initializeTerminalCommands,
    isReloadInProgress,
    resetState,
  };
}
