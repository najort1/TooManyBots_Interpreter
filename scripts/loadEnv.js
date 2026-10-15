/**
 * Shim raiz de carregamento de variáveis de ambiente.
 * Reexporta os utilitários de fun/env.js e executa loadEnv() automaticamente.
 */

import { loadEnv, parseEnv, updateEnvFile, getEnvPaths, getProjectRootDir } from '../fun/env.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Carrega variáveis com segurança no momento do import
loadEnv();

export { loadEnv, parseEnv, updateEnvFile, getEnvPaths, getProjectRootDir };
export default loadEnv;

// Execução direta via CLI para inspeção
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const result = loadEnv();
  const keys = Object.keys(result.loaded);
  console.log(`[loadEnv] Carregados ${keys.length} valores de: ${result.pathsLoaded.join(', ') || 'nenhum arquivo encontrado'}`);
}
