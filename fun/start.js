/**
 * Iniciador do bot Fun (processo independente do TooManyBots Interpreter).
 *
 * Uso:
 *   npm run fun
 *   npm run fun:dev
 *   npm run fun -- --setup   # força wizard de grupos
 *
 * - Config própria: fun/config.user.json (NÃO usa config.user.json do TMB)
 * - Dados/auth isolados: data/fun/ (via TMB_DATA_DIR)
 * - Dashboard local: http://127.0.0.1:8790 (se habilitado)
 * - Sem fluxos .tmb, sem config dos bots de atendimento
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUN_USER_CONFIG_PATH = path.join(__dirname, 'config.user.json');
const FUN_DEFAULT_DATA_DIR = path.resolve(__dirname, '..', 'data', 'fun');

function resolveDataDir() {
  if (process.env.TMB_DATA_DIR) {
    return path.resolve(String(process.env.TMB_DATA_DIR).trim());
  }
  if (fs.existsSync(FUN_USER_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(FUN_USER_CONFIG_PATH, 'utf-8'));
      const custom = String(parsed?.dataDir ?? '').trim();
      if (custom) return path.resolve(custom);
    } catch {
      // ignore
    }
  }
  return FUN_DEFAULT_DATA_DIR;
}

// OBRIGATÓRIO: data dir isolado ANTES de importar db/* (DATA_DIR é fixado no load do módulo)
const dataDir = resolveDataDir();
process.env.TMB_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const { startFunBot } = await import('./runtime.js');

startFunBot().catch(err => {
  console.error('[fun] Erro fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
