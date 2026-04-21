import pino from 'pino';

const LIBSIGNAL_NOISE_PREFIXES = [
  'Failed to decrypt message with any known session',
  'Session error:',
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'Decrypted message with closed session.',
];

export function createRuntimeLoggingController({
  runtimeModeProduction,
} = {}) {
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
      currentConfig.runtimeMode === runtimeModeProduction &&
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

  return {
    shouldSuppressLibSignalConsoleNoise,
    installLibSignalNoiseFilter,
    shouldSuppressBaileysDecryptNoise,
    createRuntimeLogger,
  };
}
