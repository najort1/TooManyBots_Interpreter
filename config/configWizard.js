import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

import { RUNTIME_MODE } from './index.js';

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

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
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

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'flowFile',
      message: 'Escolha o bot (.tmb) da pasta bots/:',
      choices: flowFiles,
      default: flowFiles.includes(initialName) ? initialName : flowFiles[0],
    },
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

  const runtimeMode = String(answers.runtimeMode ?? RUNTIME_MODE.PRODUCTION);
  const testMode = runtimeMode === RUNTIME_MODE.RESTRICTED_TEST;

  return {
    ...defaults,
    __startupChoice: 'reconfigure',
    flowPath: `./bots/${answers.flowFile}`,
    runtimeMode,
    testMode,
    testTargetMode: 'contacts-and-groups',
    testJid: testMode ? String(defaults.testJid ?? '').trim() : '',
    testJids: testMode ? toStringArray(defaults.testJids) : [],
    groupWhitelistJids: toStringArray(defaults.groupWhitelistJids),
  };
}
