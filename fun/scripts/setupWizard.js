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
import {
  FUN_PRESET_IDS,
  FUN_PRESETS,
  getFunPreset,
  getPresetInquirerChoices,
  applyFunPreset,
} from '../presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printBanner() {
  console.log('\n============================================================');
  console.log('       🎮 TooManyBots Fun - Assistente de Configuração      ');
  console.log('============================================================\n');
  console.log('Configure o seu bot de entretenimento com presets pré-calibrados');
  console.log('para o seu tipo de grupo no WhatsApp.\n');
}

/**
 * Monta e resolve a configuração resultante com base nas escolhas do assistente.
 * Garante que a transição entre Modo Econômico e Modo IA reative módulos dependentes de LLM.
 *
 * @param {object} params
 * @param {string} [params.presetId]
 * @param {object} [params.currentConfig]
 * @param {boolean} [params.zenEnabled]
 * @param {string} [params.zenBaseUrl]
 * @param {string} [params.zenModel]
 * @param {string} [params.zenApiKey]
 * @param {string} [params.prefix]
 * @param {boolean} [params.dashboardEnabled]
 * @param {object} [params.extraOverrides]
 * @returns {object}
 */
export function buildFunUserConfig({
  presetId = null,
  currentConfig = {},
  zenEnabled = false,
  zenBaseUrl = DEFAULT_FUN_CONFIG.zenBaseUrl || 'http://localhost:20128/v1',
  zenModel = DEFAULT_FUN_CONFIG.zenModel || 'bot-zap',
  zenApiKey = '',
  prefix = '/',
  dashboardEnabled = true,
  extraOverrides = {},
} = {}) {
  // Se for especificado um preset temático concreto, delega para applyFunPreset
  if (presetId && presetId !== FUN_PRESET_IDS.CUSTOM) {
    return applyFunPreset({
      presetId,
      currentConfig,
      zenEnabled,
      zenBaseUrl,
      zenModel,
      zenApiKey,
      prefix,
      dashboardEnabled,
      extraOverrides,
    });
  }

  // Modo Customizado ou chamadas legadas sem presetId
  const isZen = Boolean(zenEnabled);
  return {
    ...currentConfig,
    prefix: String(prefix || '/').trim(),
    dashboardEnabled: Boolean(dashboardEnabled),
    zenEnabled: isZen,
    zenBaseUrl: String(zenBaseUrl || '').trim() || 'http://localhost:20128/v1',
    zenModel: String(zenModel || '').trim() || 'bot-zap',
    zenApiKey: String(zenApiKey || '').trim(),
    // Se ativado IA: reativa os módulos de LLM desativados no modo econômico
    ...(isZen
      ? {
          imageGenEnabled: true,
          ollamaEnabled: false,
          selfHealEnabled: true,
          personaSocialHintsEnabled: true,
          groupEventsEnabled: true,
        }
      : {
          imageGenEnabled: false,
          ollamaEnabled: false,
          selfHealEnabled: false,
          personaSocialHintsEnabled: false,
          groupEventsEnabled: false,
        }),
    ...(presetId ? { preset: presetId } : {}),
    ...extraOverrides,
    groupWhitelistJids:
      Array.isArray(currentConfig.groupWhitelistJids) && currentConfig.groupWhitelistJids.length
        ? currentConfig.groupWhitelistJids
        : [],
  };
}

export async function runSetupWizard(options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn('[setup] Terminal sem TTY interativo. Mantendo configurações padrão.');
    return { cancelled: true, reason: 'non-interactive-tty' };
  }

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

  // Pergunta 1: Escolha do Perfil (Preset)
  const { presetId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'presetId',
      message: 'Qual perfil (preset) melhor descreve o seu bot no WhatsApp?',
      choices: getPresetInquirerChoices(),
      default: FUN_PRESET_IDS.FRIENDS_CHAOS,
    },
  ]);

  const selectedPreset = getFunPreset(presetId);
  console.log(`\n📌 Perfil selecionado: ${selectedPreset.name}`);
  console.log(`ℹ️  ${selectedPreset.description}`);
  if (Array.isArray(selectedPreset.highlights) && selectedPreset.highlights.length > 0) {
    console.log('   Destaques:');
    for (const h of selectedPreset.highlights) {
      console.log(`   • ${h}`);
    }
  }
  console.log('');

  // Pergunta 2: Modo de Inteligência Artificial
  let aiMode = selectedPreset.defaultAiMode;
  if (presetId === FUN_PRESET_IDS.OFFLINE_ESSENTIAL) {
    console.log('⚡ Modo Offline pré-definido: IA e chamadas externas desativadas para zero custo.\n');
    aiMode = 'economic';
  } else if (presetId === FUN_PRESET_IDS.FULL_AI_LIVING_MEMBER) {
    console.log('🤖 Modo Membro Vivo IA: Recursos completos de LLM, memória e TTS ativados.\n');
    aiMode = 'ai';
  } else {
    const aiPrompt = await inquirer.prompt([
      {
        type: 'list',
        name: 'aiMode',
        message: 'Deseja utilizar este perfil com Inteligência Artificial ou Modo Econômico?',
        choices: [
          {
            name: '1) Modo Inteligente com IA (OpenCode Zen / OpenAI compatível - Recomendado)',
            value: 'ai',
            short: 'IA (Zen/OpenAI)',
          },
          {
            name: '2) Modo Econômico (100% Gratuito / Offline - Sem necessidade de IA)',
            value: 'economic',
            short: 'Econômico',
          },
        ],
        default: selectedPreset.defaultAiMode || 'economic',
      },
    ]);
    aiMode = aiPrompt.aiMode;
  }

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

  // Pergunta 3: Prefixo dos comandos
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

  // Pergunta 4: Dashboard Web 3D (Next.js)
  const { dashboardEnabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dashboardEnabled',
      message: 'Deseja habilitar o Dashboard Web 3D (http://127.0.0.1:3001)?',
      default: true,
    },
  ]);

  // Monta a configuração resultante a partir do preset selecionado
  const currentConfig = loadFunUserConfig();
  const newConfig = buildFunUserConfig({
    presetId,
    currentConfig,
    zenEnabled,
    zenBaseUrl,
    zenModel,
    zenApiKey,
    prefix,
    dashboardEnabled,
  });

  saveFunUserConfig(newConfig);

  console.log('\n============================================================');
  console.log('       ✅ Configuração concluída e salva com sucesso!       ');
  console.log('============================================================');
  console.log(`📁 Arquivo: fun/config.user.json`);
  console.log(`🏷️  Perfil: ${selectedPreset.name} (${selectedPreset.shortName})`);
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
