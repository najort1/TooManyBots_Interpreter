import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.user.json'),
  path.resolve(__dirname, '..', '..', 'config.user.json'),
  path.resolve(process.cwd(), 'fun', 'config.user.json'),
  path.resolve(process.cwd(), 'config.user.json'),
];

const configCache = new Map();

/**
 * Verifica se um arquivo JSON específico tem modo debug habilitado.
 * Usa mtimeMs para evitar I/O redundante em chamadas consecutivas.
 */
function isFileDebugEnabled(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    const cached = configCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.isDebug;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const isDebug = Boolean(
      parsed &&
        typeof parsed === 'object' &&
        (parsed.debugMode === true ||
          parsed.debug === true ||
          String(parsed.logLevel || '').toLowerCase() === 'debug' ||
          String(parsed.runtimeMode || '').toLowerCase() === 'development')
    );
    configCache.set(filePath, { mtime: stat.mtimeMs, isDebug });
    return isDebug;
  } catch {
    return false;
  }
}

/**
 * Limpa o cache de leitura de arquivos de config (útil para testes unitários).
 */
export function clearLlmDebugConfigCache() {
  configCache.clear();
}

/**
 * Avalia se o modo debug está ativo para chamadas de LLM.
 * Ordem de precedência:
 * 1. options.debugMode / options.debug (override explícito)
 * 2. options.config?.debugMode / options.funConfig?.debugMode
 * 3. options.configPath (caminho específico se fornecido)
 * 4. Variável de ambiente LLM_DEBUG
 * 5. config.user.json (em fun/ ou na raiz do projeto)
 */
export function isLlmDebugActive(options = {}) {
  if (options && typeof options === 'object') {
    if (options.debugMode !== undefined) return Boolean(options.debugMode);
    if (options.debug !== undefined) return Boolean(options.debug);
    if (options.config?.debugMode !== undefined) return Boolean(options.config.debugMode);
    if (options.funConfig?.debugMode !== undefined) return Boolean(options.funConfig.debugMode);
    if (options.configPath) {
      return isFileDebugEnabled(options.configPath);
    }
  }

  if (process.env.LLM_DEBUG === '1' || process.env.LLM_DEBUG === 'true') {
    return true;
  }

  for (const p of CONFIG_PATHS) {
    if (isFileDebugEnabled(p)) {
      return true;
    }
  }
  return false;
}

/**
 * Trunca texto longo para visualização concisa no log.
 */
export function formatLlmPreview(text, maxLen = 140) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}... (${s.length} chars)`;
}

/**
 * Emite log de início de chamada a LLM.
 */
export function logLlmCallStart({
  provider = 'openai',
  model = '',
  url = '',
  task = '',
  prompt = '',
  system = '',
  maxTokens,
  temperature,
  imagesCount = 0,
  audiosCount = 0,
  jsonMode = false,
  logFn = null,
  logger = null,
} = {}) {
  const parts = [`[LLM:DEBUG] [${provider}] Chamada iniciada`];
  if (task) parts.push(`[task: ${task}]`);
  parts.push(`| model: ${model || 'default'}`);
  if (url) parts.push(`| url: ${url}`);
  if (system) parts.push(`| system: "${formatLlmPreview(system, 80)}"`);
  if (prompt) parts.push(`| prompt: "${formatLlmPreview(prompt, 140)}"`);
  if (maxTokens !== undefined && maxTokens !== null) parts.push(`| maxTokens: ${maxTokens}`);
  if (temperature !== undefined && temperature !== null) parts.push(`| temp: ${temperature}`);
  if (imagesCount > 0) parts.push(`| images: ${imagesCount}`);
  if (audiosCount > 0) parts.push(`| audios: ${audiosCount}`);
  if (jsonMode) parts.push('| jsonMode: true');

  const line = parts.join(' ');
  const meta = { type: 'start', provider, model, task, url };

  if (typeof logFn === 'function') {
    logFn(line, meta);
  } else {
    console.log(line);
  }

  if (logger && typeof logger.info === 'function') {
    try {
      logger.info(meta, line);
    } catch {
      // ignore
    }
  }
}

/**
 * Emite log de sucesso de chamada a LLM com duração e resumo da resposta.
 */
export function logLlmCallSuccess({
  provider = 'openai',
  model = '',
  task = '',
  durationMs = 0,
  status = 200,
  output = '',
  logFn = null,
  logger = null,
} = {}) {
  const parts = [`[LLM:DEBUG] [${provider}] Resposta recebida`];
  if (task) parts.push(`[task: ${task}]`);
  parts.push(`(${durationMs}ms)`);
  parts.push(`| model: ${model || 'default'}`);
  parts.push(`| status: ${status}`);
  if (output) parts.push(`| resposta: "${formatLlmPreview(output, 140)}"`);

  const line = parts.join(' ');
  const meta = { type: 'success', provider, model, task, durationMs, status };

  if (typeof logFn === 'function') {
    logFn(line, meta);
  } else {
    console.log(line);
  }

  if (logger && typeof logger.info === 'function') {
    try {
      logger.info(meta, line);
    } catch {
      // ignore
    }
  }
}

/**
 * Emite log de falha de chamada a LLM com duração e motivo do erro.
 */
export function logLlmCallError({
  provider = 'openai',
  model = '',
  task = '',
  durationMs = 0,
  error = null,
  logFn = null,
  logger = null,
} = {}) {
  const errMsg = error?.message || String(error || 'unknown error');
  const parts = [`[LLM:DEBUG] [${provider}] Falha na chamada`];
  if (task) parts.push(`[task: ${task}]`);
  parts.push(`(${durationMs}ms)`);
  parts.push(`| model: ${model || 'default'}`);
  parts.push(`| erro: ${errMsg}`);

  const line = parts.join(' ');
  const meta = { type: 'error', provider, model, task, durationMs, error: errMsg };

  if (typeof logFn === 'function') {
    logFn(line, meta);
  } else {
    console.log(line);
  }

  if (logger && typeof logger.warn === 'function') {
    try {
      logger.warn(meta, line);
    } catch {
      // ignore
    }
  }
}
