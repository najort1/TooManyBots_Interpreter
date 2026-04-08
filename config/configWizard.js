import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

import { BOT_RUNTIME_MODE, RUNTIME_MODE } from './index.js';

function ensureBotsFolder(projectRoot) {
  const botsDir = path.join(projectRoot, 'bots');
  if (!fs.existsSync(botsDir)) {
    fs.mkdirSync(botsDir, { recursive: true });
  }
  return botsDir;
}

function ensureDefaultFlowInBots(projectRoot, botsDir) {
  const rootFlow = path.join(projectRoot, 'flow.tmb');
  const botsFlow = path.join(botsDir, 'flow.tmb');
  if (fs.existsSync(rootFlow) && !fs.existsSync(botsFlow)) {
    try {
      fs.copyFileSync(rootFlow, botsFlow);
    } catch {
      return;
    }
  }
}

function listBotFlows(botsDir) {
  if (!fs.existsSync(botsDir)) return [];
  return fs
    .readdirSync(botsDir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name)
    .filter(name => name.toLowerCase().endsWith('.tmb'))
    .sort((a, b) => a.localeCompare(b));
}

function readFlowBotType(flowPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
    const mode = String(raw?.flowRuntimeConfig?.conversationMode ?? 'conversation').trim().toLowerCase();
    return mode === 'command' ? 'command' : 'conversation';
  } catch {
    return 'conversation';
  }
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

function validateSelectedFlowTypes(flowMeta, selectedFlowFiles) {
  const selected = Array.isArray(selectedFlowFiles) ? selectedFlowFiles : [selectedFlowFiles];
  if (selected.length === 0) return 'Selecione ao menos 1 fluxo.';

  const selectedTypes = flowMeta
    .filter(meta => selected.includes(meta.fileName))
    .map(meta => meta.botType);
  const conversationCount = selectedTypes.filter(type => type === 'conversation').length;
  if (conversationCount > 1) {
    return 'Apenas 1 fluxo de conversa pode ficar ativo ao mesmo tempo.';
  }

  return true;
}

export async function runConfigWizard({
  projectRoot,
  defaults,
  hasSavedConfig,
  onUseSavedConfig,
}) {
  const botsDir = ensureBotsFolder(projectRoot);
  ensureDefaultFlowInBots(projectRoot, botsDir);
  const flowFiles = listBotFlows(botsDir);
  const flowMeta = flowFiles.map(fileName => {
    const absolutePath = path.join(botsDir, fileName);
    const botType = readFlowBotType(absolutePath);
    return {
      fileName,
      botType,
      label: `${fileName} (${botType === 'command' ? 'comando' : 'conversa'})`,
    };
  });

  if (flowFiles.length === 0) {
    console.error(`\nNenhum arquivo .tmb encontrado em "${path.relative(projectRoot, botsDir) || 'bots'}".`);
    console.error('Coloque seu fluxo dentro da pasta bots/ e rode novamente.\n');
    return null;
  }

  if (hasSavedConfig) {
    const { bootstrap } = await inquirer.prompt([
      {
        type: 'list',
        name: 'bootstrap',
        message: 'Como deseja iniciar o bot?',
        choices: [
          { name: '1 - iniciar bot (configurar novamente)', value: 'configure' },
          { name: '2 - iniciar bot (usar configuracao anterior)', value: 'use_last' },
          { name: '0 - sair', value: 'exit' },
        ],
      },
    ]);

    if (bootstrap === 'use_last') {
      const previous = typeof onUseSavedConfig === 'function' ? onUseSavedConfig() : null;
      return previous ? { ...previous, __startupChoice: 'use_previous' } : null;
    }
    if (bootstrap === 'exit') {
      return null;
    }
  }

  const initialFlow = String(defaults.flowPath ?? '').replace(/\\/g, '/');
  const initialName = initialFlow.split('/').pop();
  const initialFlowPaths = toStringArray(defaults.flowPaths).map(item => String(item).replace(/\\/g, '/'));
  const defaultBotRuntimeMode = String(defaults.botRuntimeMode ?? BOT_RUNTIME_MODE.SINGLE_FLOW);

  const { botRuntimeMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'botRuntimeMode',
      message: 'Arquitetura de bots ativos:',
      choices: [
        { name: 'Single-flow (legado, 1 bot ativo)', value: BOT_RUNTIME_MODE.SINGLE_FLOW },
        { name: 'Multi-bot (varios bots em paralelo)', value: BOT_RUNTIME_MODE.MULTI_BOT },
      ],
      default: defaultBotRuntimeMode,
    },
  ]);

  const flowSelectionQuestion = botRuntimeMode === BOT_RUNTIME_MODE.MULTI_BOT
    ? {
        type: 'checkbox',
        name: 'flowFiles',
        message: 'Selecione os bots (.tmb) ativos (ESPACO marca/desmarca, ENTER confirma):',
        choices: flowMeta.map(meta => ({
          name: meta.label,
          value: meta.fileName,
          checked: initialFlowPaths.includes(`./bots/${meta.fileName}`),
        })),
        pageSize: 20,
        validate: selected => validateSelectedFlowTypes(flowMeta, selected),
      }
    : {
        type: 'list',
        name: 'flowFiles',
        message: 'Escolha o bot (.tmb) da pasta bots/:',
        choices: flowMeta.map(meta => ({
          name: meta.label,
          value: meta.fileName,
        })),
        default: flowFiles.includes(initialName) ? initialName : flowFiles[0],
        validate: selected => validateSelectedFlowTypes(flowMeta, selected),
      };

  const { flowFiles: selectedFlowAnswer } = await inquirer.prompt([flowSelectionQuestion]);

  const { runtimeMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'runtimeMode',
      message: 'Modo de execucao:',
      choices: [
        { name: 'Producao', value: RUNTIME_MODE.PRODUCTION },
        { name: 'Desenvolvimento', value: RUNTIME_MODE.DEVELOPMENT },
        { name: 'Teste restrito', value: RUNTIME_MODE.RESTRICTED_TEST },
      ],
      default: String(defaults.runtimeMode ?? RUNTIME_MODE.PRODUCTION),
    },
  ]);

  const selectedFlowFiles = Array.isArray(selectedFlowAnswer) ? selectedFlowAnswer : [selectedFlowAnswer];
  const selectedFlowPaths = selectedFlowFiles.map(fileName => `./bots/${fileName}`);
  const selectedMeta = flowMeta.filter(meta => selectedFlowFiles.includes(meta.fileName));
  const conversationFlowFile = selectedMeta.find(meta => meta.botType === 'conversation')?.fileName;
  const primaryFlowPath = conversationFlowFile
    ? `./bots/${conversationFlowFile}`
    : selectedFlowPaths[0];

  const runtimeModeValue = String(runtimeMode ?? RUNTIME_MODE.PRODUCTION);
  const testMode = runtimeModeValue === RUNTIME_MODE.RESTRICTED_TEST;
  const normalizedBotRuntimeMode = String(botRuntimeMode ?? BOT_RUNTIME_MODE.SINGLE_FLOW);

  return {
    ...defaults,
    __startupChoice: 'reconfigure',
    botRuntimeMode: normalizedBotRuntimeMode,
    flowPath: primaryFlowPath,
    flowPaths:
      normalizedBotRuntimeMode === BOT_RUNTIME_MODE.MULTI_BOT
        ? selectedFlowPaths
        : [primaryFlowPath],
    runtimeMode: runtimeModeValue,
    testMode,
    testTargetMode: 'contacts-and-groups',
    testJid: testMode ? String(defaults.testJid ?? '').trim() : '',
    testJids: testMode ? toStringArray(defaults.testJids) : [],
    groupWhitelistJids: toStringArray(defaults.groupWhitelistJids),
  };
}
