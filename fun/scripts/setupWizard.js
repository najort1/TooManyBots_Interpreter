#!/usr/bin/env node

/**
 * 🎮 TooManyBots Fun - Assistente Interativo de Configuração (Setup Wizard)
 *
 * Funcionalidades:
 * - Seleção multi-modo (Configuração Rápida de LLM, Setup Completo, Presets Temáticos, Doctor)
 * - Registro unificado de provedores (OpenRouter, DeepSeek, OpenAI, Ollama, LM Studio, Zen Proxy, Custom)
 * - Detecção e mascaramento inteligente de chaves de API existentes (.env / config)
 * - Descoberta dinâmica de modelos para Ollama (/api/tags) e LM Studio (/v1/models)
 * - Teste de latência e micro-inferência em tempo real com orientações acionáveis
 * - Salvamento atômico dual: sincroniza fun/config.user.json e .env
 * - Totalmente retrocompatível com buildFunUserConfig
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';

import { loadFunUserConfig, saveFunUserConfig, FUN_USER_CONFIG_PATH } from '../config.js';
import { DEFAULT_FUN_CONFIG } from '../constants.js';
import {
  FUN_PRESET_IDS,
  getFunPreset,
  getPresetInquirerChoices,
  applyFunPreset,
} from '../presets.js';
import {
  listProviders,
  getProvider,
  detectProviderFromUrl,
  resolveProviderApiKey,
  PROVIDER_IDS,
} from '../llm/providers.js';
import { smokeTestLlm } from '../llm/smokeTest.js';
import { loadEnv, updateEnvFile, getProjectRootDir } from '../env.js';

// Carrega .env para detectar chaves existentes
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = getProjectRootDir();
const ROOT_ENV_PATH = path.join(PROJECT_ROOT, '.env');

function printBanner() {
  console.log('\n============================================================');
  console.log('       🎮 TooManyBots Fun - Assistente de Configuração      ');
  console.log('============================================================\n');
  console.log('Configure seu bot de entretenimento para WhatsApp com presets,');
  console.log('IA generativa (OpenRouter, DeepSeek, Ollama, Zen) ou Modo Econômico.\n');
}

/**
 * Mascara uma chave de API para exibição segura no terminal.
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '';
  const s = key.trim();
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/**
 * Consulta modelos instalados no Ollama via endpoint nativo /api/tags.
 * @param {string} baseUrl
 * @returns {Promise<string[]>}
 */
async function discoverOllamaModels(baseUrl) {
  try {
    let clean = String(baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    if (clean.endsWith('/v1')) clean = clean.slice(0, -3);
    const tagsUrl = `${clean}/api/tags`;
    const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data?.models)) {
      return data.models.map((m) => m.name || m.model).filter(Boolean);
    }
  } catch {
    // ignora falha de conexão silenciosamente
  }
  return [];
}

/**
 * Consulta modelos via endpoint OpenAI /v1/models (LM Studio ou custom).
 * @param {string} baseUrl
 * @param {string} [apiKey='']
 * @returns {Promise<string[]>}
 */
async function discoverV1Models(baseUrl, apiKey = '') {
  try {
    let clean = String(baseUrl || '').replace(/\/+$/, '');
    if (!clean.endsWith('/v1')) clean = `${clean}/v1`;
    const modelsUrl = `${clean}/models`;
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data?.data)) {
      return data.data.map((m) => m.id).filter(Boolean);
    }
  } catch {
    // ignora falha de rede
  }
  return [];
}

/**
 * Monta e resolve a configuração resultante com base nas escolhas do assistente.
 * Garante que a transição entre Modo Econômico e Modo IA reative módulos dependentes de LLM.
 *
 * NOTA: Assinatura mantida 100% retrocompatível com chamadas legadas e testes unitários.
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
          personaSocialHintsEnabled: false,
          personaChemistryEnabled: true,
          groupEventsEnabled: true,
        }
      : {
          imageGenEnabled: false,
          ollamaEnabled: false,
          selfHealEnabled: false,
          personaSocialHintsEnabled: false,
          personaChemistryEnabled: false,
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

/**
 * Fluxo interativo de seleção e calibração de Provedor LLM.
 * @param {object} currentConfig
 * @returns {Promise<{
 *   zenEnabled: boolean,
 *   zenBaseUrl: string,
 *   zenModel: string,
 *   zenApiKey: string,
 *   providerId: string,
 *   envKey?: string
 * }>}
 */
async function promptLlmProviderConfig(currentConfig = {}) {
  const currentProviderId = detectProviderFromUrl(currentConfig.zenBaseUrl);
  const providers = listProviders();

  const providerChoices = [
    {
      name: '1) OpenRouter (Recomendado - Acesso unificado a DeepSeek, Claude, Llama, etc.)',
      value: PROVIDER_IDS.OPENROUTER,
      short: 'OpenRouter',
    },
    {
      name: '2) DeepSeek (API Oficial - Baixíssimo custo e raciocínio de ponta)',
      value: PROVIDER_IDS.DEEPSEEK,
      short: 'DeepSeek',
    },
    {
      name: '3) OpenAI (Modelos GPT-4o e GPT-4o-mini)',
      value: PROVIDER_IDS.OPENAI,
      short: 'OpenAI',
    },
    {
      name: '4) Ollama (Local no Computador - 100% Gratuito e Offline)',
      value: PROVIDER_IDS.OLLAMA,
      short: 'Ollama (Local)',
    },
    {
      name: '5) LM Studio (Local com Interface Visual - Gratuito e Offline)',
      value: PROVIDER_IDS.LMSTUDIO,
      short: 'LM Studio (Local)',
    },
    {
      name: '6) Zen Proxy / TooManyBots (Proxy local na porta 20128)',
      value: PROVIDER_IDS.ZEN,
      short: 'Zen Proxy',
    },
    {
      name: '7) Endpoint Personalizado (Qualquer API compatível com OpenAI)',
      value: PROVIDER_IDS.CUSTOM,
      short: 'Custom',
    },
    new inquirer.Separator(),
    {
      name: '8) Modo Econômico (Sem IA / 100% Textos Mockados / Zero Latência e Custo)',
      value: 'economic',
      short: 'Modo Econômico',
    },
  ];

  const { selectedProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedProvider',
      message: 'Escolha o provedor de Inteligência Artificial para o bot:',
      choices: providerChoices,
      default: currentConfig.zenEnabled === false ? 'economic' : currentProviderId || PROVIDER_IDS.OPENROUTER,
    },
  ]);

  if (selectedProvider === 'economic') {
    console.log('\n⚡ Modo Econômico selecionado: todas as funções de IA usarão respostas offline instantâneas.\n');
    return {
      zenEnabled: false,
      zenBaseUrl: currentConfig.zenBaseUrl || 'http://localhost:20128/v1',
      zenModel: currentConfig.zenModel || 'bot-zap',
      zenApiKey: '',
      providerId: 'economic',
    };
  }

  const prov = getProvider(selectedProvider) || getProvider(PROVIDER_IDS.CUSTOM);

  // 1. URL Base
  const defaultUrl =
    (currentConfig.zenBaseUrl && detectProviderFromUrl(currentConfig.zenBaseUrl) === prov.id)
      ? currentConfig.zenBaseUrl
      : prov.defaultBaseUrl || 'http://localhost:20128/v1';

  const { baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: `URL base da API (${prov.name}):`,
      default: defaultUrl,
      validate: (input) => (input && input.trim() ? true : 'A URL não pode ser vazia.'),
    },
  ]);

  const cleanBaseUrl = baseUrl.trim();

  // 2. Modelo
  let modelChoices = [];
  let isDynamicDiscovery = false;

  if (prov.id === PROVIDER_IDS.OLLAMA) {
    console.log('   🔎 Buscando modelos instalados no Ollama...');
    const discovered = await discoverOllamaModels(cleanBaseUrl);
    if (discovered.length > 0) {
      isDynamicDiscovery = true;
      modelChoices = discovered.map((m) => ({ name: `🦙 ${m}`, value: m }));
    }
  } else if (prov.id === PROVIDER_IDS.LMSTUDIO) {
    console.log('   🔎 Buscando modelos ativos no LM Studio...');
    const discovered = await discoverV1Models(cleanBaseUrl);
    if (discovered.length > 0) {
      isDynamicDiscovery = true;
      modelChoices = discovered.map((m) => ({ name: `🖥️  ${m}`, value: m }));
    }
  }

  if (!isDynamicDiscovery && Array.isArray(prov.curatedModels) && prov.curatedModels.length > 0) {
    modelChoices = prov.curatedModels.map((m) => ({
      name: `${m.name} (${m.id})`,
      value: m.id,
    }));
  }

  modelChoices.push({
    name: '✏️  Digitar outro modelo manualmente',
    value: '__custom__',
  });

  let selectedModel = prov.defaultModel || 'bot-zap';

  if (modelChoices.length > 1) {
    const defaultModelVal =
      currentConfig.zenModel && modelChoices.some((c) => c.value === currentConfig.zenModel)
        ? currentConfig.zenModel
        : prov.defaultModel || modelChoices[0].value;

    const modelPrompt = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelChoice',
        message: 'Selecione o modelo desejado:',
        choices: modelChoices,
        default: defaultModelVal,
      },
    ]);

    if (modelPrompt.modelChoice === '__custom__') {
      const manualModel = await inquirer.prompt([
        {
          type: 'input',
          name: 'model',
          message: 'Digite o identificador exato do modelo:',
          default: currentConfig.zenModel || prov.defaultModel || 'bot-zap',
          validate: (val) => (val && val.trim() ? true : 'O nome do modelo não pode ser vazio.'),
        },
      ]);
      selectedModel = manualModel.model.trim();
    } else {
      selectedModel = modelPrompt.modelChoice;
    }
  } else {
    const manualModel = await inquirer.prompt([
      {
        type: 'input',
        name: 'model',
        message: 'Nome do modelo:',
        default: currentConfig.zenModel || prov.defaultModel || 'bot-zap',
        validate: (val) => (val && val.trim() ? true : 'O nome do modelo não pode ser vazio.'),
      },
    ]);
    selectedModel = manualModel.model.trim();
  }

  // 3. Chave de API (Smart Detection & Masking)
  let apiKey = '';
  const detectedKey = resolveProviderApiKey(prov.id, process.env) || currentConfig.zenApiKey || '';

  if (prov.requiresApiKey || prov.envKey) {
    const keyPromptMessage = detectedKey
      ? `Chave de API ${prov.name} (detectada: ${maskKey(detectedKey)} - pressione Enter para mantê-la):`
      : `Chave de API ${prov.name} (${prov.requiresApiKey ? 'obrigatória' : 'opcional se local'}):`;

    if (prov.portalUrl && !detectedKey) {
      console.log(`   💡 Obtenha sua chave em: ${prov.portalUrl}`);
    }

    const { inputKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'inputKey',
        message: keyPromptMessage,
        mask: '*',
      },
    ]);

    const trimmedInput = String(inputKey || '').trim();
    apiKey = trimmedInput || detectedKey;
  }

  // 4. Teste ao Vivo de Conectividade e Latência (Micro-completion ping)
  console.log(`\n⏳ Testando micro-inferência ao vivo com ${selectedModel}...`);

  const smoke = await smokeTestLlm({
    baseUrl: cleanBaseUrl,
    model: selectedModel,
    apiKey,
    timeoutMs: 6000,
  });

  if (smoke.ok) {
    console.log(`\n✅ Conexão BEM-SUCEDIDA!`);
    console.log(`   ⚡ Latência: ${smoke.latencyMs}ms`);
    console.log(`   💬 Resposta do modelo: "${smoke.reply}"\n`);
  } else {
    console.log(`\n⚠️  Falha no teste de conexão: [${smoke.code || smoke.reason}]`);
    if (smoke.advice) {
      console.log(`   💡 Dica: ${smoke.advice}`);
    }
    if (smoke.portalUrl) {
      console.log(`   🔗 Portal: ${smoke.portalUrl}`);
    }

    const { continueAnyway } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continueAnyway',
        message: 'Deseja salvar esta configuração mesmo com o teste offline/falhando?',
        default: true,
      },
    ]);

    if (!continueAnyway) {
      console.log('Operação cancelada pelo usuário. Reconfigurando...');
      return promptLlmProviderConfig(currentConfig);
    }
  }

  return {
    zenEnabled: true,
    zenBaseUrl: cleanBaseUrl,
    zenModel: selectedModel,
    zenApiKey: apiKey,
    providerId: prov.id,
    envKey: prov.envKey,
  };
}

/**
 * Salva atomicamente no arquivo .env e em fun/config.user.json.
 * @param {object} config
 * @param {object} [extraEnvUpdates={}]
 */
function dualSaveConfig(config, extraEnvUpdates = {}) {
  // 1. Salva em fun/config.user.json
  saveFunUserConfig(config);

  // 2. Salva variáveis correspondentes no .env raiz
  const envUpdates = { ...extraEnvUpdates };

  if (config.zenApiKey) {
    envUpdates.ZEN_API_KEY = config.zenApiKey;
    if (config.zenBaseUrl) {
      const provId = detectProviderFromUrl(config.zenBaseUrl);
      const prov = getProvider(provId);
      if (prov?.envKey) {
        envUpdates[prov.envKey] = config.zenApiKey;
      }
    }
  }

  try {
    updateEnvFile(ROOT_ENV_PATH, envUpdates);
    // Atualiza process.env em memória para a sessão atual
    for (const [k, v] of Object.entries(envUpdates)) {
      if (v) process.env[k] = v;
    }
  } catch (err) {
    console.warn('[setup] Aviso: falha ao atualizar .env raiz:', err?.message || err);
  }
}

/**
 * Ponto de entrada do assistente interativo.
 *
 * @param {object} [options]
 * @param {boolean} [options.force]
 * @param {string} [options.mode] - 'quick_llm' | 'full_setup' | 'presets' | 'doctor'
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, config?: object }>}
 */
export async function runSetupWizard(options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn('[setup] Terminal sem TTY interativo. Mantendo configurações padrão.');
    return { cancelled: true, reason: 'non-interactive-tty' };
  }

  const currentConfig = loadFunUserConfig();
  const configExists = fs.existsSync(FUN_USER_CONFIG_PATH);

  printBanner();

  // Verifica parâmetros de linha de comando para saltar diretamente para modo específico
  let requestedMode = options.mode;
  if (!requestedMode) {
    if (process.argv.includes('--doctor')) requestedMode = 'doctor';
    else if (process.argv.includes('--llm') || process.argv.includes('--quick-llm')) requestedMode = 'quick_llm';
    else if (process.argv.includes('--presets') || process.argv.includes('--preset')) requestedMode = 'presets';
    else if (process.argv.includes('--full')) requestedMode = 'full_setup';
  }

  // Menu principal de modos
  if (!requestedMode) {
    const modePrompt = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'O que você deseja configurar agora?',
        choices: [
          {
            name: '1) ⚡ Configuração Rápida de IA / LLM (Provedor, Modelo, Chave & Teste de Conexão)',
            value: 'quick_llm',
            short: 'Rápido LLM',
          },
          {
            name: '2) 🛠️  Configuração Completa (Perfil, IA, Prefixo, Dashboard, etc.)',
            value: 'full_setup',
            short: 'Setup Completo',
          },
          {
            name: '3) 🎭 Trocar Perfil / Preset do Bot (Chaos, Caixinha, Membro Vivo, etc.)',
            value: 'presets',
            short: 'Presets',
          },
          {
            name: '4) 🩺 Diagnóstico do Sistema (Doctor - Verifica Node, SQLite, C++, WhatsApp & LLM)',
            value: 'doctor',
            short: 'Doctor',
          },
          new inquirer.Separator(),
          {
            name: '5) ❌ Sair sem alterar',
            value: 'exit',
            short: 'Sair',
          },
        ],
        default: configExists ? 'quick_llm' : 'full_setup',
      },
    ]);
    requestedMode = modePrompt.mode;
  }

  if (requestedMode === 'exit') {
    console.log('\n[setup] Nenhuma alteração realizada.\n');
    return { cancelled: true };
  }

  // Modo Doctor
  if (requestedMode === 'doctor') {
    const { runDoctor } = await import('../../scripts/doctor.mjs');
    await runDoctor();
    return { ok: true };
  }

  // MODO 1: Quick LLM
  if (requestedMode === 'quick_llm') {
    console.log('\n⚡ Modo Configuração Rápida de IA / LLM\n');
    const llm = await promptLlmProviderConfig(currentConfig);

    const newConfig = buildFunUserConfig({
      presetId: currentConfig.preset || null,
      currentConfig,
      zenEnabled: llm.zenEnabled,
      zenBaseUrl: llm.zenBaseUrl,
      zenModel: llm.zenModel,
      zenApiKey: llm.zenApiKey,
      prefix: currentConfig.prefix || '/',
      dashboardEnabled: currentConfig.dashboardEnabled !== false,
    });

    const envUpdates = {};
    if (llm.envKey && llm.zenApiKey) {
      envUpdates[llm.envKey] = llm.zenApiKey;
    }

    dualSaveConfig(newConfig, envUpdates);

    console.log('\n============================================================');
    console.log('       ✅ Configuração de IA salva com sucesso!             ');
    console.log('============================================================');
    console.log(`📁 Arquivos atualizados: fun/config.user.json e .env`);
    console.log(`🤖 Modo: ${llm.zenEnabled ? `IA Ativa (${llm.zenModel})` : 'Modo Econômico (Offline)'}`);
    console.log(`🌐 Endpoint: ${llm.zenBaseUrl}`);
    console.log('------------------------------------------------------------\n');

    return { ok: true, config: newConfig };
  }

  // MODO 3: Presets
  if (requestedMode === 'presets') {
    const { presetId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'presetId',
        message: 'Qual perfil (preset) melhor descreve o seu bot no WhatsApp?',
        choices: getPresetInquirerChoices(),
        default: currentConfig.preset || FUN_PRESET_IDS.FRIENDS_CHAOS,
      },
    ]);

    const selectedPreset = getFunPreset(presetId);
    console.log(`\n📌 Perfil selecionado: ${selectedPreset.name}`);
    console.log(`ℹ️  ${selectedPreset.description}\n`);

    const newConfig = buildFunUserConfig({
      presetId,
      currentConfig,
      zenEnabled: currentConfig.zenEnabled,
      zenBaseUrl: currentConfig.zenBaseUrl,
      zenModel: currentConfig.zenModel,
      zenApiKey: currentConfig.zenApiKey,
      prefix: currentConfig.prefix || '/',
      dashboardEnabled: currentConfig.dashboardEnabled !== false,
    });

    dualSaveConfig(newConfig);

    console.log('\n✅ Perfil atualizado para:', selectedPreset.name);
    return { ok: true, config: newConfig };
  }

  // MODO 2: Full Setup
  const { presetId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'presetId',
      message: 'Qual perfil (preset) melhor descreve o seu bot no WhatsApp?',
      choices: getPresetInquirerChoices(),
      default: currentConfig.preset || FUN_PRESET_IDS.FRIENDS_CHAOS,
    },
  ]);

  const selectedPreset = getFunPreset(presetId);
  console.log(`\n📌 Perfil selecionado: ${selectedPreset.name}`);
  console.log(`ℹ️  ${selectedPreset.description}\n`);

  // Calibra Provedor LLM
  const llm = await promptLlmProviderConfig(currentConfig);

  // Prefixo de comandos
  const { prefix } = await inquirer.prompt([
    {
      type: 'input',
      name: 'prefix',
      message: 'Qual prefixo deseja utilizar para os comandos do bot?',
      default: currentConfig.prefix || '/',
      validate: (input) => (input && input.trim() ? true : 'O prefixo não pode ser vazio.'),
    },
  ]);

  // Dashboard Web 3D
  const { dashboardEnabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dashboardEnabled',
      message: 'Deseja habilitar o Dashboard Web 3D (http://127.0.0.1:3001)?',
      default: currentConfig.dashboardEnabled !== false,
    },
  ]);

  const newConfig = buildFunUserConfig({
    presetId,
    currentConfig,
    zenEnabled: llm.zenEnabled,
    zenBaseUrl: llm.zenBaseUrl,
    zenModel: llm.zenModel,
    zenApiKey: llm.zenApiKey,
    prefix,
    dashboardEnabled,
  });

  const envUpdates = {};
  if (llm.envKey && llm.zenApiKey) {
    envUpdates[llm.envKey] = llm.zenApiKey;
  }

  dualSaveConfig(newConfig, envUpdates);

  console.log('\n============================================================');
  console.log('       ✅ Configuração completa salva com sucesso!          ');
  console.log('============================================================');
  console.log(`📁 Arquivos sincronizados: fun/config.user.json e .env`);
  console.log(`🏷️  Perfil: ${selectedPreset.name}`);
  console.log(`🤖 IA: ${llm.zenEnabled ? `Ativa (${llm.zenModel})` : 'Modo Econômico (Offline)'}`);
  console.log(`⚡ Prefixo: ${prefix.trim()}`);
  console.log(`🌐 Dashboard: ${dashboardEnabled ? 'Ativado (porta 3001 / 8790)' : 'Desativado'}`);
  console.log('------------------------------------------------------------');
  console.log('Próximo passo:');
  console.log('1. Execute: iniciar_fun.bat   (ou "npm run fun" no terminal)');
  console.log('2. O terminal exibirá um QR Code do WhatsApp para você escanear.\n');

  return { ok: true, config: newConfig };
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runSetupWizard()
    .then((result) => {
      process.exitCode = result?.ok ? 0 : 0;
    })
    .catch((error) => {
      console.error('\n[setup] Erro durante o assistente:', error?.message || error);
      process.exitCode = 1;
    });
}

export default runSetupWizard;
