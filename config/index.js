/**
 * config/index.js
 *
 * Configuração central. Edite estes valores para personalizar o bot.
 */

import fs from 'fs';
import path from 'path';

export const config = {
  // Caminho para o arquivo de fluxo .tmb (relativo à raiz do projeto)
  flowPath: './bots/flow.tmb',

  // Nível de log: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  logLevel: 'silent',

  // Imprimir logs de forma legível em desenvolvimento
  prettyLogs: true,

  // Duração do indicador de digitação (ms) antes de enviar uma mensagem
  typingDuration: 800,

  // Número máximo de passos do motor antes de abortar (previne loops infinitos)
  maxSteps: 100,

  // Ignorar mensagens de grupo (recomendado: true)
  ignoreGroups: true,

  testMode: true,

  testTargetMode: 'contacts',

  testJid: '551111111111@s.whatsapp.net',

  testJids: [],

  groupWhitelistJids: [],

  debugMode: true,

  // Tempo limite da sessão em segundos — sessões mais antigas que isso serão reiniciadas (0 = desativado)
  sessionTimeoutSeconds: 60 * 60 * 24, // 24 hours
};

const USER_CONFIG_FILE = path.resolve('./config.user.json');

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

function normalizeConfigShape(input) {
  const normalized = { ...input };

  normalized.testMode = Boolean(normalized.testMode);
  normalized.testTargetMode = String(normalized.testTargetMode ?? 'contacts');
  normalized.testJid = String(normalized.testJid ?? '').trim();
  normalized.testJids = toStringArray(normalized.testJids);
  normalized.groupWhitelistJids = toStringArray(normalized.groupWhitelistJids);

  if (normalized.testMode && normalized.testJid && !normalized.testJids.includes(normalized.testJid)) {
    normalized.testJids = [normalized.testJid, ...normalized.testJids];
  }

  if (!normalized.testMode) {
    normalized.testJids = [];
  }

  return normalized;
}

function sanitizeConfigForSave(input) {
  const { __startupChoice, ...rest } = input;
  return normalizeConfigShape(rest);
}

export function loadSavedUserConfig() {
  if (!fs.existsSync(USER_CONFIG_FILE)) return null;
  try {
    const raw = fs.readFileSync(USER_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeConfigShape(parsed);
  } catch {
    return null;
  }
}

export function saveUserConfig(userConfig) {
  const payload = sanitizeConfigForSave(userConfig);
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function getConfig({ interactive = true } = {}) {
  const saved = loadSavedUserConfig();
  if (saved && !interactive) {
    return normalizeConfigShape({ ...config, ...saved });
  }

  if (!interactive) {
    return normalizeConfigShape({ ...config });
  }

  try {
    const { runConfigWizard } = await import('./configWizard.js');
    const projectRoot = path.resolve('.');

    const chosen = await runConfigWizard({
      projectRoot,
      defaults: normalizeConfigShape({ ...config, ...(saved ?? {}) }),
      hasSavedConfig: Boolean(saved),
      onUseSavedConfig: () => normalizeConfigShape({ ...config, ...saved, __startupChoice: 'use_previous' }),
    });

    if (!chosen) {
      throw new Error('Configuração cancelada pelo usuário.');
    }

    saveUserConfig(chosen);
    return normalizeConfigShape(chosen);
  } catch (err) {
    console.error('❌ Falha ao obter configuração interativa:', err);
    throw err;
  }
}
