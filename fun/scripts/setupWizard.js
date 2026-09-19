#!/usr/bin/env node

/**
 * Assistente interativo de pré-boot do TooManyBots Fun.
 *
 * Configura o ambiente antes da primeira conexão do WhatsApp, permitindo
 * escolher entre o Modo Econômico (100% gratuito/offline com textos mockados)
 * e o Modo Inteligente com IA (Zen / OpenAI compatível).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import { loadFunUserConfig, saveFunUserConfig, FUN_USER_CONFIG_PATH } from '../config.js';
import { DEFAULT_FUN_CONFIG } from '../constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printBanner() {
  console.log('\n============================================================');
  console.log('       🎮 TooManyBots Fun - Assistente de Configuração      ');
  console.log('============================================================\n');
  console.log('Este assistente vai preparar o bot de entretenimento para o WhatsApp.\n');
}

export async function runSetupWizard(options = {}) {
  const force = Boolean(options.force || process.argv.includes('--force'));
  const configExists = fs.existsSync(FUN_USER_CONFIG_PATH);

  printBanner();

  if (configExists && !force) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'O arquivo fun/config.user.json já existe. Deseja reconfigurar do zero?',
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log('\n[setup] Configurações mantidas. Para iniciar o bot, execute:');
      console.log('   iniciar_fun.bat   ou   npm run fun\n');
      return { cancelled: true };
    }
  }

  // Pergunta 1: Modo de Inteligência Artificial
  const { aiMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'aiMode',
      message: 'Qual modo de inteligência artificial deseja utilizar?',
      choices: [
        {
          name: '1) Modo Econômico (100% Gratuito / Offline - Recomendado)',
          value: 'economic',
          short: 'Econômico',
        },
        {
          name: '2) Modo Inteligente com IA (OpenCode Zen / OpenAI compatível)',
          value: 'ai',
          short: 'IA (Zen/OpenAI)',
        },
      ],
      default: 'economic',
    },
  ]);

  let zenEnabled = false;
  let zenBaseUrl = DEFAULT_FUN_CONFIG.zenBaseUrl || 'http://localhost:20128/v1';
  let zenModel = DEFAULT_FUN_CONFIG.zenModel || 'bot-zap';
  let zenApiKey = '';

  if (aiMode === 'ai') {
    const aiAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'zenBaseUrl',
        message: 'URL base da API (OpenAI compatível):',
        default: 'http://localhost:20128/v1',
      },
      {
        type: 'input',
        name: 'zenModel',
        message: 'Nome do modelo:',
        default: 'bot-zap',
      },
      {
        type: 'password',
        name: 'zenApiKey',
        message: 'Chave de API (deixe em branco para proxy local sem chave):',
        mask: '*',
      },
    ]);

    zenEnabled = true;
    zenBaseUrl = String(aiAnswers.zenBaseUrl || '').trim() || zenBaseUrl;
    zenModel = String(aiAnswers.zenModel || '').trim() || zenModel;
    zenApiKey = String(aiAnswers.zenApiKey || '').trim();
  }

  // Pergunta 2: Prefixo dos comandos
  const { prefix } = await inquirer.prompt([
    {
      type: 'input',
      name: 'prefix',
      message: 'Qual prefixo deseja utilizar para os comandos do bot?',
      default: '/',
      validate: (input) => {
        if (!input || !input.trim()) return 'O prefixo não pode ser vazio.';
        return true;
      },
    },
  ]);

  // Pergunta 3: Dashboard Web 3D (Next.js)
  const { dashboardEnabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dashboardEnabled',
      message: 'Deseja habilitar o Dashboard Web 3D (http://127.0.0.1:3001)?',
      default: true,
    },
  ]);

  // Monta a configuração resultante
  const currentConfig = loadFunUserConfig();
  const newConfig = {
    ...currentConfig,
    prefix: prefix.trim(),
    dashboardEnabled: Boolean(dashboardEnabled),
    zenEnabled,
    zenBaseUrl,
    zenModel,
    zenApiKey,
    // Se econômico, desativa módulos que dependem de LLM para evitar chamadas vazias
    ...(zenEnabled
      ? {}
      : {
          imageGenEnabled: false,
          ollamaEnabled: false,
          selfHealEnabled: false,
          personaSocialHintsEnabled: false,
          groupEventsEnabled: false,
        }),
    // Garante groupWhitelistJids vazio para acionar o wizard pós-conexão do Baileys
    groupWhitelistJids: Array.isArray(currentConfig.groupWhitelistJids) && currentConfig.groupWhitelistJids.length
      ? currentConfig.groupWhitelistJids
      : [],
  };

  saveFunUserConfig(newConfig);

  console.log('\n============================================================');
  console.log('       ✅ Configuração concluída e salva com sucesso!       ');
  console.log('============================================================');
  console.log(`📁 Arquivo: fun/config.user.json`);
  console.log(`🤖 Modo: ${zenEnabled ? `IA Ativa (${zenModel})` : 'Modo Econômico (100% Mockado / Offline)'}`);
  console.log(`⚡ Prefixo: ${prefix.trim()}`);
  console.log(`🌐 Dashboard: ${dashboardEnabled ? 'Ativado (porta 3001 / 8790)' : 'Desativado'}`);
  console.log('------------------------------------------------------------');
  console.log('Próximo passo:');
  console.log('1. Execute: iniciar_fun.bat   (ou "npm run fun" no terminal)');
  console.log('2. O terminal exibirá um QR Code do WhatsApp para você escanear.');
  console.log('3. Logo após conectar, você poderá escolher os grupos onde o');
  console.log('   bot responderá usando a barra de espaço do teclado.\n');

  return { ok: true, config: newConfig };
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runSetupWizard().catch((error) => {
    console.error('\n[setup] Erro durante o assistente:', error?.message || error);
    process.exit(1);
  });
}
