import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { buildFunUserConfig, runSetupWizard } from '../fun/scripts/setupWizard.js';
import { runDoctor } from '../scripts/doctor.mjs';

test('buildFunUserConfig: retrocompatibilidade total com chamadas legadas e defaults', () => {
  const cfgDefault = buildFunUserConfig({});
  assert.equal(cfgDefault.prefix, '/');
  assert.equal(cfgDefault.zenEnabled, false);
  assert.equal(cfgDefault.dashboardEnabled, true);
  assert.equal(cfgDefault.imageGenEnabled, false);
  assert.equal(cfgDefault.selfHealEnabled, false);

  const cfgZen = buildFunUserConfig({
    zenEnabled: true,
    zenBaseUrl: 'https://openrouter.ai/api/v1',
    zenModel: 'deepseek/deepseek-chat',
    zenApiKey: 'sk-or-test',
  });
  assert.equal(cfgZen.zenEnabled, true);
  assert.equal(cfgZen.zenBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(cfgZen.zenModel, 'deepseek/deepseek-chat');
  assert.equal(cfgZen.zenApiKey, 'sk-or-test');
  assert.equal(cfgZen.imageGenEnabled, true);
  assert.equal(cfgZen.selfHealEnabled, true);

  const cfgPreset = buildFunUserConfig({
    presetId: 'friends_chaos',
    zenEnabled: true,
  });
  assert.equal(cfgPreset.preset, 'friends_chaos');
  assert.equal(cfgPreset.zenEnabled, true);
});

test('runSetupWizard: lida graciosamente com ambiente sem TTY interativo', async () => {
  const result = await runSetupWizard();
  assert.equal(result.cancelled, true);
  assert.equal(result.reason, 'non-interactive-tty');
});

test('doctor: executa verificações de integridade com sucesso', async () => {
  const docResult = await runDoctor();
  assert.ok(docResult.passed >= 5);
  assert.equal(typeof docResult.ok, 'boolean');
});

test('batch scripts & package.json: estrutura e arquivos de onboarding íntegros', () => {
  const projectRoot = path.resolve();

  // setup.bat
  const setupBat = fs.readFileSync(path.join(projectRoot, 'setup.bat'), 'utf-8');
  assert.ok(setupBat.includes('setupWizard.js'));
  assert.ok(setupBat.includes('better-sqlite3'));

  // iniciar_fun.bat
  const iniciarBat = fs.readFileSync(path.join(projectRoot, 'iniciar_fun.bat'), 'utf-8');
  assert.ok(iniciarBat.includes('[4] Diagnostico do Sistema (Doctor)'));
  assert.ok(iniciarBat.includes('[5] Sair'));
  assert.ok(iniciarBat.includes(':doctor'));

  // package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts.setup, 'node fun/scripts/setupWizard.js');
  assert.equal(pkg.scripts.doctor, 'node scripts/doctor.mjs');
  assert.equal(pkg.scripts['fun:doctor'], 'node scripts/doctor.mjs');

  // .env.example
  const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf-8');
  assert.ok(envExample.includes('OPENROUTER_API_KEY'));
  assert.ok(envExample.includes('DEEPSEEK_API_KEY'));
  assert.ok(envExample.includes('OPENAI_API_KEY'));
  assert.ok(envExample.includes('ZEN_API_KEY'));
  assert.ok(envExample.includes('OLLAMA_API_KEY'));
  assert.ok(envExample.includes('LMSTUDIO_API_KEY'));
});
