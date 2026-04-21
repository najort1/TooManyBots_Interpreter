import fs from 'fs';
import readline from 'readline';

export function createFatalLifecycleController({
  fatalLogFile,
  flushCredsNow,
  closeReconnectController,
  releaseInstanceLock,
} = {}) {
  let exiting = false;
  let processHandlersRegistered = false;

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
      fs.appendFileSync(fatalLogFile, payload, 'utf-8');
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

  async function handleFatal(prefix, err) {
    if (exiting) return;
    exiting = true;

    flushCredsNow('fatal-error');
    closeReconnectController();
    releaseInstanceLock();

    appendFatalLog(prefix, err);
    console.error(`\nERROR: ${prefix}`);
    console.error(formatError(err));
    console.error(`\n(Log salvo em: ${fatalLogFile})\n`);
    await waitForEnter('Pressione Enter para sair...');
    process.exit(1);
  }

  function registerProcessHandlers() {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;

    process.on('unhandledRejection', reason => {
      void handleFatal('Unhandled Promise Rejection', reason);
    });

    process.on('uncaughtException', err => {
      void handleFatal('Uncaught Exception', err);
    });

    process.on('SIGINT', () => {
      flushCredsNow('sigint');
      closeReconnectController();
      releaseInstanceLock();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      flushCredsNow('sigterm');
      closeReconnectController();
      releaseInstanceLock();
      process.exit(0);
    });

    process.on('beforeExit', () => {
      flushCredsNow('before-exit');
      closeReconnectController();
      releaseInstanceLock();
    });

    process.on('exit', () => {
      flushCredsNow('exit');
      closeReconnectController();
      releaseInstanceLock();
    });
  }

  return {
    formatError,
    appendFatalLog,
    waitForEnter,
    handleFatal,
    registerProcessHandlers,
  };
}
