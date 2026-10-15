/**
 * Carregador e atualizador atômico de arquivos .env (zero dependências externas).
 *
 * - loadEnv: Carrega arquivos .env sem sobrescrever variáveis já definidas em process.env.
 * - parseEnv: Interpreta formato dotenv com suporte a aspas, comentários inline e escapes.
 * - updateEnvFile: Atualiza ou insere variáveis preservando comentários, linhas em branco e formatação.
 * - getEnvPaths: Localiza os arquivos .env raiz e específicos.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Retorna o caminho da raiz do projeto.
 * @returns {string}
 */
export function getProjectRootDir() {
  return PROJECT_ROOT;
}

/**
 * Retorna os caminhos candidatos para arquivos .env em ordem de precedência.
 * @param {string} [rootDir=PROJECT_ROOT]
 * @returns {string[]}
 */
export function getEnvPaths(rootDir = PROJECT_ROOT) {
  const root = path.resolve(rootDir);
  return [
    path.join(root, '.env'),
    path.join(root, '.env.local'),
    path.join(root, 'fun', '.env'),
  ];
}

/**
 * Interpreta o conteúdo de um arquivo .env em um objeto chave-valor.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseEnv(content) {
  const result = {};
  if (!content || typeof content !== 'string') return result;

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Ignora linhas vazias e comentários puros
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Remove prefixo "export " se houver
    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;

    const equalIndex = line.indexOf('=');
    if (equalIndex === -1) continue;

    const key = line.slice(0, equalIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(equalIndex + 1).trim();

    // Aspas duplas
    if (value.startsWith('"')) {
      const closingIndex = value.lastIndexOf('"');
      if (closingIndex > 0) {
        value = value.slice(1, closingIndex);
        // Processa escapes comuns
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      } else {
        value = value.slice(1);
      }
    } else if (value.startsWith("'")) {
      // Aspas simples
      const closingIndex = value.lastIndexOf("'");
      if (closingIndex > 0) {
        value = value.slice(1, closingIndex);
        value = value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      } else {
        value = value.slice(1);
      }
    } else {
      // Valor sem aspas: remove comentários inline (iniciados por espaço e # ou # direto)
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      } else if (value.startsWith('#')) {
        value = '';
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * Formata um valor para escrita segura no .env.
 * @param {any} val
 * @returns {string}
 */
function formatEnvValue(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s === '') return '';
  // Se contiver espaços, comentários, quebras de linha ou caracteres especiais, usa aspas duplas
  if (/[\s#"'\n\r\\]/.test(s)) {
    const escaped = s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  return s;
}

/**
 * Carrega variáveis de arquivos .env para process.env.
 * Por padrão NÃO sobrescreve variáveis que já existam em process.env (seguro).
 *
 * @param {object} [options]
 * @param {string[]} [options.paths] - Lista de caminhos para inspecionar
 * @param {string[]} [options.envPaths] - Alias para paths
 * @param {boolean} [options.override=false] - Se true, substitui process.env
 * @returns {{ loaded: Record<string, string>, pathsLoaded: string[] }}
 */
export function loadEnv(options = {}) {
  const candidatePaths = options.paths || options.envPaths || getEnvPaths();
  const override = Boolean(options.override);
  const loaded = {};
  const pathsLoaded = [];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const parsed = parseEnv(content);
      pathsLoaded.push(envPath);

      for (const [k, v] of Object.entries(parsed)) {
        if (override || process.env[k] === undefined) {
          process.env[k] = v;
        }
        loaded[k] = v;
      }
    } catch (err) {
      // Log discreto sem quebrar boot
      if (process.env.DEBUG_ENV) {
        console.warn(`[env] Falha ao ler ${envPath}:`, err?.message || err);
      }
    }
  }

  return { loaded, pathsLoaded };
}

/**
 * Atualiza ou insere variáveis em um arquivo .env preservando comentários,
 * linhas vazias e formatação original existente.
 *
 * Executa escrita atômica usando arquivo temporário com fallback direto.
 *
 * @param {string} [filePath] - Caminho do arquivo .env (padrão: raiz do projeto)
 * @param {Record<string, any>} updates - Chaves e valores a atualizar
 * @returns {{ ok: boolean, filePath: string, updatedKeys: string[] }}
 */
export function updateEnvFile(filePath = path.join(PROJECT_ROOT, '.env'), updates = {}) {
  const targetPath = path.resolve(filePath);
  const targetDir = path.dirname(targetPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const entriesToUpdate = { ...updates };
  const keysHandled = new Set();
  const updatedKeys = Object.keys(entriesToUpdate);

  let existingContent = '';
  if (fs.existsSync(targetPath)) {
    try {
      existingContent = fs.readFileSync(targetPath, 'utf-8');
    } catch {
      existingContent = '';
    }
  }

  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const outputLines = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const keyMatch = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);

    if (keyMatch) {
      const key = keyMatch[1];
      if (Object.prototype.hasOwnProperty.call(entriesToUpdate, key)) {
        const newVal = entriesToUpdate[key];
        outputLines.push(`${key}=${formatEnvValue(newVal)}`);
        keysHandled.add(key);
        continue;
      }
    }

    outputLines.push(rawLine);
  }

  // Chaves novas que não existiam no arquivo
  const remainingKeys = updatedKeys.filter((k) => !keysHandled.has(k));
  if (remainingKeys.length > 0) {
    if (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() !== '') {
      outputLines.push('');
    }
    for (const key of remainingKeys) {
      outputLines.push(`${key}=${formatEnvValue(entriesToUpdate[key])}`);
    }
  }

  const newContent = outputLines.join('\n') + '\n';

  // Escrita atômica: cria arquivo temporário e renomeia
  const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.writeFileSync(tempPath, newContent, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch {
    // Fallback direto se renameSync falhar
    try {
      fs.writeFileSync(targetPath, newContent, 'utf-8');
    } finally {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignora
        }
      }
    }
  }

  return { ok: true, filePath: targetPath, updatedKeys };
}

export default {
  loadEnv,
  parseEnv,
  updateEnvFile,
  getEnvPaths,
  getProjectRootDir,
};
