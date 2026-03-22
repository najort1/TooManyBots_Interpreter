import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const LOG_LEVELS = ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'];

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

function validateNumber(name, { min = 0 } = {}) {
  return value => {
    const raw = String(value ?? '').trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${name} deve ser um número.`;
    if (n < min) return `${name} deve ser >= ${min}.`;
    return true;
  };
}

function parseNumber(value, fallback) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
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
    console.error(`\n❌ Nenhum arquivo .tmb encontrado em "${path.relative(projectRoot, botsDir) || 'bots'}".`);
    console.error('Coloque seu fluxo dentro da pasta bots/ e rode novamente.\n');
    return null;
  }

  if (hasSavedConfig) {
    const { bootstrap } = await inquirer.prompt([
      {
        type: 'list',
        name: 'bootstrap',
        message: 'Configuração encontrada. O que você quer fazer?',
        choices: [
          { name: 'Usar a última configuração', value: 'use_last' },
          { name: 'Configurar novamente (passo a passo)', value: 'configure' },
          { name: 'Sair', value: 'exit' },
        ],
      },
    ]);

    if (bootstrap === 'use_last') {
      return typeof onUseSavedConfig === 'function' ? onUseSavedConfig() : null;
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
      message: 'Escolha o arquivo de fluxo (.tmb) em bots/:',
      choices: flowFiles,
      default: flowFiles.includes(initialName) ? initialName : flowFiles[0],
    },
    {
      type: 'list',
      name: 'logLevel',
      message: 'Nível de log:',
      choices: LOG_LEVELS,
      default: defaults.logLevel ?? 'silent',
    },
    {
      type: 'confirm',
      name: 'prettyLogs',
      message: 'Pretty logs (mais legível no terminal)?',
      default: Boolean(defaults.prettyLogs),
    },
    {
      type: 'confirm',
      name: 'ignoreGroups',
      message: 'Ignorar mensagens de grupo?',
      default: Boolean(defaults.ignoreGroups),
    },
    {
      type: 'confirm',
      name: 'debugMode',
      message: 'Ativar debug mode?',
      default: Boolean(defaults.debugMode),
    },
    {
      type: 'confirm',
      name: 'testMode',
      message: 'Ativar test mode (aceitar mensagens somente do testJid)?',
      default: Boolean(defaults.testMode),
    },
    {
      type: 'input',
      name: 'testJid',
      message: 'Qual o testJid? (ex: 5582...@s.whatsapp.net)',
      default: String(defaults.testJid ?? ''),
      when: a => Boolean(a.testMode),
      validate: value => {
        const v = String(value ?? '').trim();
        if (!v) return 'testJid não pode ser vazio quando testMode estiver ativo.';
        if (!v.endsWith('@s.whatsapp.net')) return 'testJid deve terminar com @s.whatsapp.net';
        return true;
      },
    },
    {
      type: 'input',
      name: 'typingDuration',
      message: 'Duração do “digitando...” (ms):',
      default: String(defaults.typingDuration ?? 800),
      validate: validateNumber('typingDuration', { min: 0 }),
      filter: value => parseNumber(value, defaults.typingDuration ?? 800),
    },
    {
      type: 'input',
      name: 'maxSteps',
      message: 'Máximo de passos do motor (evitar loop infinito):',
      default: String(defaults.maxSteps ?? 100),
      validate: validateNumber('maxSteps', { min: 1 }),
      filter: value => parseNumber(value, defaults.maxSteps ?? 100),
    },
    {
      type: 'input',
      name: 'sessionTimeoutSeconds',
      message: 'Tempo limite da sessão (segundos) (0 desativa):',
      default: String(defaults.sessionTimeoutSeconds ?? 86400),
      validate: validateNumber('sessionTimeoutSeconds', { min: 0 }),
      filter: value => parseNumber(value, defaults.sessionTimeoutSeconds ?? 86400),
    },
  ]);

  return {
    ...defaults,
    flowPath: `./bots/${answers.flowFile}`,
    logLevel: answers.logLevel,
    prettyLogs: Boolean(answers.prettyLogs),
    ignoreGroups: Boolean(answers.ignoreGroups),
    debugMode: Boolean(answers.debugMode),
    testMode: Boolean(answers.testMode),
    testJid: answers.testMode ? String(answers.testJid ?? '').trim() : String(defaults.testJid ?? '').trim(),
    typingDuration: answers.typingDuration,
    maxSteps: answers.maxSteps,
    sessionTimeoutSeconds: answers.sessionTimeoutSeconds,
  };
}
