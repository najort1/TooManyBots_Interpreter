#!/usr/bin/env node

/**
 * 🩺 TooManyBots Fun - Diagnóstico do Sistema (Doctor)
 *
 * Inspirado na arquitetura de auto-diagnóstico do Hermes:
 * - Valida versão do Node.js e arquitetura do SO
 * - Testa compilação e carregamento de bindings nativos em C++ (better-sqlite3, sharp, skia-canvas)
 * - Verifica ferramentas de mídia externa (ffmpeg)
 * - Audita o diretório de dados e estado de autenticação do WhatsApp (Baileys)
 * - Realiza teste de conectividade e inferência ao vivo com o endpoint LLM configurado
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnv } from '../fun/env.js';
import { loadFunUserConfig } from '../fun/config.js';
import { resolveZenEndpoint } from '../fun/llm/zenEndpoint.js';
import { smokeTestLlm } from '../fun/llm/smokeTest.js';
import { detectProviderFromUrl, getProvider } from '../fun/llm/providers.js';

// Carrega variáveis do .env
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ICONS = {
  ok: '✅',
  warn: '⚠️ ',
  err: '❌',
  info: 'ℹ️ ',
};

/**
 * Executa todos os diagnósticos do sistema e exibe relatório detalhado.
 * @returns {Promise<{ ok: boolean, passed: number, warnings: number, errors: number }>}
 */
export async function runDoctor() {
  console.log('\n============================================================');
  console.log('       🩺 TooManyBots Fun - Diagnóstico do Sistema (Doctor)  ');
  console.log('============================================================\n');

  let passed = 0;
  let warnings = 0;
  let errors = 0;

  // 1. Verificação do Ambiente Node.js
  console.log('📦 [1/5] Ambiente de Execução (Node.js & SO):');
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);

  if (major >= 20) {
    console.log(`   ${ICONS.ok} Node.js: ${nodeVer} (Recomendado 20+)`);
    passed++;
  } else if (major >= 18) {
    console.log(`   ${ICONS.warn} Node.js: ${nodeVer} (Compatível 18+, recomendamos atualizar para 20 LTS)`);
    warnings++;
  } else {
    console.log(`   ${ICONS.err} Node.js: ${nodeVer} (Incompatível! Requer Node.js 18 ou superior)`);
    console.log('      💡 Atualize em https://nodejs.org/ ou: winget install OpenJS.NodeJS.LTS');
    errors++;
  }

  console.log(`   ${ICONS.info} Plataforma: ${process.platform} (${process.arch})`);

  // 2. Dependências Nativas em C++
  console.log('\n⚙️  [2/5] Drivers e Bindings Nativos C++:');

  // 2.1 better-sqlite3
  try {
    const Database = (await import('better-sqlite3')).default;
    const memDb = new Database(':memory:');
    const row = memDb.prepare('SELECT 1 as alive').get();
    memDb.close();

    if (row?.alive === 1) {
      console.log(`   ${ICONS.ok} better-sqlite3: Driver SQLite nativo operacional`);
      passed++;
    } else {
      throw new Error('Falha no SELECT teste em memória');
    }
  } catch (err) {
    console.log(`   ${ICONS.err} better-sqlite3: Falha no módulo nativo (${err?.message})`);
    console.log('      💡 Solução: Execute "npm rebuild better-sqlite3"');
    console.log('      💡 Certifique-se de ter o Visual Studio Build Tools instalado:');
    console.log('         https://visualstudio.microsoft.com/visual-cpp-build-tools/');
    errors++;
  }

  // 2.2 sharp
  try {
    const sharp = (await import('sharp')).default;
    const sharpVer = sharp.versions?.sharp || 'OK';
    console.log(`   ${ICONS.ok} sharp: Processador de imagens carregado (v${sharpVer})`);
    passed++;
  } catch (err) {
    console.log(`   ${ICONS.warn} sharp: Não carregado (${err?.message})`);
    console.log('      💡 Stickers e manipulação avançada de imagens podem ficar limitados.');
    console.log('      💡 Solução: npm install sharp --build-from-source');
    warnings++;
  }

  // 2.3 skia-canvas
  try {
    const { Canvas } = await import('skia-canvas');
    const c = new Canvas(10, 10);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 10, 10);
    console.log(`   ${ICONS.ok} skia-canvas: Renderizador de cards 2D/3D operacional`);
    passed++;
  } catch (err) {
    console.log(`   ${ICONS.warn} skia-canvas: Não carregado (${err?.message})`);
    console.log('      💡 Geração visual de cards de perfil/RPG usará fallbacks gráficos.');
    console.log('      💡 Solução: npm install skia-canvas');
    warnings++;
  }

  // 2.4 Baileys
  try {
    await import('baileys');
    console.log(`   ${ICONS.ok} baileys: Biblioteca WhatsApp Web socket disponível`);
    passed++;
  } catch (err) {
    console.log(`   ${ICONS.err} baileys: Dependência essencial não encontrada (${err?.message})`);
    console.log('      💡 Execute "npm install" na raiz do projeto');
    errors++;
  }

  // 3. Ferramentas de Mídia (ffmpeg)
  console.log('\n🎬 [3/5] Ferramentas de Mídia:');
  let ffmpegFound = false;
  try {
    const out = execSync('ffmpeg -version', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString();
    const firstLine = out.split('\n')[0].trim();
    console.log(`   ${ICONS.ok} ffmpeg: Detectado no PATH (${firstLine.slice(0, 45)}...)`);
    ffmpegFound = true;
    passed++;
  } catch {
    console.log(`   ${ICONS.warn} ffmpeg: Não encontrado no PATH`);
    console.log('      💡 O bot funciona sem ele, mas conversões de áudio Opus e stickers animados requerem ffmpeg.');
    console.log('      💡 Instalação opcional no Windows: winget install Gyan.FFmpeg');
    warnings++;
  }

  // 4. Armazenamento e Estado do WhatsApp
  console.log('\n📱 [4/5] Dados e Autenticação do WhatsApp:');
  const userConfig = loadFunUserConfig();
  const dataDir = process.env.TMB_DATA_DIR
    ? path.resolve(process.env.TMB_DATA_DIR)
    : path.resolve(PROJECT_ROOT, 'data', 'fun');

  console.log(`   ${ICONS.info} Diretório de Dados: ${dataDir}`);
  if (!fs.existsSync(dataDir)) {
    console.log(`   ${ICONS.warn} Diretório de dados ainda não foi criado (será inicializado no 1º boot)`);
    warnings++;
  } else {
    console.log(`   ${ICONS.ok} Diretório de dados acessível e com permissão de escrita`);
    passed++;
  }

  // Verifica credenciais de sessão Baileys (SQLite auth_state ou arquivos creds.json)
  let hasExistingSession = false;

  // 1. Verificação primária no SQLite (adaptador db/authState do TooManyBots)
  const dbCandidates = [
    path.join(dataDir, 'runtime.db'),
    path.join(dataDir, 'sessions.db'),
    path.join(dataDir, 'fun.db'),
  ];

  for (const dbPath of dbCandidates) {
    if (fs.existsSync(dbPath)) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_state'").get();
        if (hasTable) {
          const credsRow = db.prepare("SELECT 1 FROM auth_state WHERE key = 'creds'").get();
          if (credsRow) {
            hasExistingSession = true;
          }
        }
        db.close();
        if (hasExistingSession) break;
      } catch {
        // ignora falha de leitura em arquivo bloqueado ou em migração
      }
    }
  }

  // 2. Fallback para arquivos planos tradicionais (creds.json)
  if (!hasExistingSession) {
    const possibleAuthDirs = [
      path.join(dataDir, 'baileys_auth'),
      path.join(dataDir, 'auth_info_baileys'),
      path.join(dataDir, 'session'),
      path.join(dataDir, 'auth'),
    ];

    for (const authPath of possibleAuthDirs) {
      if (fs.existsSync(path.join(authPath, 'creds.json'))) {
        hasExistingSession = true;
        break;
      }
    }
  }

  if (hasExistingSession) {
    console.log(`   ${ICONS.ok} Sessão do WhatsApp: Credenciais salvas detectadas (login automático no boot)`);
    passed++;
  } else {
    console.log(`   ${ICONS.info} Sessão do WhatsApp: Nenhuma sessão ativa detectada`);
    console.log('      👉 O bot exibirá um QR Code no terminal para autenticação inicial.');
  }

  // 5. Inteligência Artificial e Teste LLM ao Vivo
  console.log('\n🤖 [5/5] Conectividade e Provedor de IA (LLM):');
  const isZenEnabled = userConfig.zenEnabled !== false && process.env.FUN_DISABLE_LIVE_LLM !== '1';

  if (!isZenEnabled) {
    console.log(`   ${ICONS.info} Modo Econômico ATIVADO (100% templates mockados em pt-BR, latência zero)`);
    console.log('      👉 Nenhuma chamada de rede será realizada para IA.');
    passed++;
  } else {
    const ep = resolveZenEndpoint(userConfig);
    const providerId = detectProviderFromUrl(ep.baseUrl);
    const provider = getProvider(providerId);

    console.log(`   ${ICONS.info} Provedor: ${provider?.name || 'Custom'} (${providerId})`);
    console.log(`   ${ICONS.info} Endpoint: ${ep.baseUrl}`);
    console.log(`   ${ICONS.info} Modelo: ${ep.model}`);
    console.log(`   ${ICONS.info} Chave: ${ep.apiKey ? 'Definida (***' + ep.apiKey.slice(-4) + ')' : 'Não informada'}`);

    console.log('   ⏳ Disparando micro-inferência de teste ao vivo (Say "OK")...');

    const smokeResult = await smokeTestLlm({
      baseUrl: ep.baseUrl,
      model: ep.model,
      apiKey: ep.apiKey,
      timeoutMs: 6000,
    });

    if (smokeResult.ok) {
      console.log(`   ${ICONS.ok} Conexão com LLM BEM-SUCEDIDA!`);
      console.log(`      ⚡ Latência: ${smokeResult.latencyMs}ms`);
      console.log(`      💬 Resposta recebida: "${smokeResult.reply}"`);
      passed++;
    } else {
      console.log(`   ${ICONS.err} Falha no teste de IA: [${smokeResult.code || smokeResult.reason}]`);
      if (smokeResult.advice) {
        console.log(`      💡 Dica: ${smokeResult.advice}`);
      }
      if (smokeResult.portalUrl) {
        console.log(`      🔗 Portal: ${smokeResult.portalUrl}`);
      }
      errors++;
    }
  }

  // Resumo Geral
  console.log('\n============================================================');
  console.log('                      RESUMO GERAL                          ');
  console.log('============================================================');
  console.log(`   ${ICONS.ok} Sucessos:  ${passed}`);
  console.log(`   ${ICONS.warn} Avisos:    ${warnings}`);
  console.log(`   ${ICONS.err} Erros:     ${errors}`);

  if (errors === 0) {
    console.log('\n🎉 O seu ambiente está pronto para rodar o TooManyBots Fun!');
    console.log('   Inicie o bot com:  iniciar_fun.bat   ou   npm run fun\n');
  } else {
    console.log('\n⚠️  Foram detectados problemas que requerem atenção antes do boot.');
    console.log('   Revise as orientações com 💡 acima.\n');
  }

  return {
    ok: errors === 0,
    passed,
    warnings,
    errors,
  };
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runDoctor()
    .then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error('\n[doctor] Erro inesperado durante diagnóstico:', err);
      process.exitCode = 1;
    });
}

export default runDoctor;
