/**
 * Wizard mínimo do bot Fun (inquirer).
 * Lista grupos após conectar e grava fun/config.user.json.
 */

import inquirer from 'inquirer';
import { fetchSelectableGroups } from '../runtime/contactUtils.js';
import { saveFunUserConfig, loadFunUserConfig } from './config.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label = 'operacao') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout em ${label} (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadGroupsWithRetry(sock, contactCache, { attempts = 3, delayMs = 2000 } = {}) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      console.log(`[fun] Buscando grupos (tentativa ${i}/${attempts})…`);
      if (!sock) throw new Error('Socket WhatsApp indisponivel');
      const groups = await withTimeout(
        fetchSelectableGroups(sock, contactCache),
        45_000,
        'groupFetchAllParticipating'
      );
      if (Array.isArray(groups) && groups.length > 0) return groups;
      console.log('[fun] Nenhum grupo retornado ainda.');
    } catch (err) {
      lastError = err;
      console.warn(`[fun] Falha ao listar grupos: ${String(err?.message || err)}`);
    }
    if (i < attempts) await sleep(delayMs);
  }
  if (lastError) {
    console.warn('[fun] Seguindo sem lista automatica. Use entrada manual ou --setup depois.');
  }
  return [];
}

function parseGroupJidsInput(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(s => s.endsWith('@g.us'));
}

/**
 * @param {object} options
 * @param {import('@whiskeysockets/baileys').WASocket} options.sock
 * @param {object} [options.currentConfig]
 * @param {boolean} [options.force]
 * @param {Map|null} [options.contactCache]
 */
export async function runFunSetupWizard({
  sock,
  currentConfig,
  force = false,
  contactCache = null,
} = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn(
      '[fun] Terminal sem TTY interativo. Edite fun/config.user.json (groupWhitelistJids) ou rode num terminal normal (cmd/powershell/wt).'
    );
    return currentConfig || loadFunUserConfig();
  }

  const base = currentConfig || loadFunUserConfig();
  const hasWhitelist = Array.isArray(base.groupWhitelistJids) && base.groupWhitelistJids.length > 0;

  if (!force && hasWhitelist) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Config Fun encontrada. O que deseja fazer?',
        choices: [
          { name: 'Usar config atual e continuar', value: 'keep' },
          { name: 'Reconfigurar grupos e opcoes', value: 'setup' },
        ],
        default: 'keep',
      },
    ]);
    if (action === 'keep') return base;
  }

  let groups = await loadGroupsWithRetry(sock, contactCache);
  let groupWhitelistJids = [...(base.groupWhitelistJids || [])];

  // Loop: permitir re-tentar lista
  while (true) {
    if (groups.length > 0) {
      console.log(`\n[fun] ${groups.length} grupo(s) encontrado(s). Use ESPACO para marcar, ENTER para confirmar.\n`);
      const defaults = new Set(groupWhitelistJids);
      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: 'Selecione os grupos em que o Fun deve funcionar:',
          choices: groups.map(g => ({
            name: `${g.name} (${g.participants} membros)  ${g.jid}`,
            value: g.jid,
            checked: defaults.has(g.jid),
          })),
          pageSize: 15,
        },
      ]);

      if (selected.length > 0) {
        groupWhitelistJids = selected;
        break;
      }

      const { emptyAction } = await inquirer.prompt([
        {
          type: 'list',
          name: 'emptyAction',
          message: 'Nenhum grupo marcado. O que fazer?',
          choices: [
            { name: 'Selecionar de novo', value: 'again' },
            { name: 'Colar JIDs manualmente', value: 'manual' },
            { name: 'Continuar sem grupos (bot fica ocioso)', value: 'skip' },
          ],
        },
      ]);
      if (emptyAction === 'again') continue;
      if (emptyAction === 'skip') {
        groupWhitelistJids = [];
        break;
      }
      // manual fallthrough
    }

    const { mode } = groups.length === 0
      ? await inquirer.prompt([
          {
            type: 'list',
            name: 'mode',
            message: 'Nao foi possivel listar grupos automaticamente. Como prefere?',
            choices: [
              { name: 'Tentar listar grupos de novo', value: 'retry' },
              { name: 'Colar JIDs manualmente (@g.us)', value: 'manual' },
              { name: 'Continuar sem grupos por agora', value: 'skip' },
            ],
          },
        ])
      : { mode: 'manual' };

    if (mode === 'retry') {
      groups = await loadGroupsWithRetry(sock, contactCache, { attempts: 2, delayMs: 2500 });
      continue;
    }
    if (mode === 'skip') {
      groupWhitelistJids = [];
      break;
    }

    const { manual } = await inquirer.prompt([
      {
        type: 'input',
        name: 'manual',
        message: 'Cole o(s) JID(s) de grupo (@g.us), separados por virgula:',
        default: groupWhitelistJids.join(', '),
      },
    ]);
    groupWhitelistJids = parseGroupJidsInput(manual);
    break;
  }

  const extras = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'rankCardImage',
      message: 'Enviar /rank como imagem?',
      default: base.rankCardImage !== false,
    },
    {
      type: 'confirm',
      name: 'dashboardEnabled',
      message: 'Ativar dashboard local (http://127.0.0.1:8790)?',
      default: base.dashboardEnabled !== false,
    },
    {
      type: 'number',
      name: 'dashboardPort',
      message: 'Porta do dashboard Fun:',
      default: Number(base.dashboardPort) || 8790,
      when: (a) => a.dashboardEnabled,
    },
    {
      type: 'number',
      name: 'xpMin',
      message: 'XP minimo por mensagem:',
      default: Number(base.xpMin) || 15,
    },
    {
      type: 'number',
      name: 'xpMax',
      message: 'XP maximo por mensagem:',
      default: Number(base.xpMax) || 25,
    },
    {
      type: 'number',
      name: 'cooldownMs',
      message: 'Cooldown de XP (ms):',
      default: Number(base.cooldownMs) || 60_000,
    },
  ]);

  const next = {
    ...base,
    groupWhitelistJids,
    rankCardImage: extras.rankCardImage !== false,
    dashboardEnabled: extras.dashboardEnabled !== false,
    dashboardPort: Number(extras.dashboardPort) || 8790,
    xpMin: Number(extras.xpMin) || 15,
    xpMax: Number(extras.xpMax) || 25,
    cooldownMs: Math.max(0, Number(extras.cooldownMs) || 60_000),
  };

  const saved = saveFunUserConfig(next);
  console.log(`\n[fun] Config salva em fun/config.user.json (${saved.groupWhitelistJids.length} grupo(s)).\n`);
  if (saved.groupWhitelistJids.length === 0) {
    console.warn('[fun] Sem grupos: rode depois `npm run fun -- --setup` para escolher.');
  }
  return saved;
}

/**
 * Decide se deve abrir wizard no boot.
 */
export function shouldRunFunWizard(config, argv = process.argv) {
  if (argv.includes('--setup') || argv.includes('--wizard')) return true;
  const list = config?.groupWhitelistJids;
  return !Array.isArray(list) || list.length === 0;
}
