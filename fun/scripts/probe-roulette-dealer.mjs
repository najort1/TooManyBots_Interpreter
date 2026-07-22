import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveFunConfig } from '../config.js';
import { createFlavorService } from '../llm/flavorService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
const cfg = resolveFunConfig(raw);

console.log('='.repeat(60));
console.log('🎡 TESTE ROLETA DEALER — IA');
console.log('='.repeat(60));
console.log(`Zen: ${cfg.zenBaseUrl} / ${cfg.zenModel}`);
console.log(`Ollama: ${cfg.ollamaBaseUrl} / ${cfg.ollamaModel}`);
console.log(`zenEnabled: ${cfg.zenEnabled}`);
console.log(`ollamaEnabled: ${cfg.ollamaEnabled}`);
console.log(`flavorTimeoutMs: ${cfg.flavorTimeoutMs}`);
console.log('');

const flavor = createFlavorService({
  getConfig: () => cfg,
  getLogger: () => null,
  allowLiveLlm: true,
});

const scenarios = [
  {
    name: 'roulette_win',
    label: '✅ Vitória simples',
    vars: { pick: 'vermelho', ball: 7, color: 'red', payout: 20, stake: 10 },
  },
  {
    name: 'roulette_lose',
    label: '❌ Derrota',
    vars: { pick: 'preto', ball: 17, color: 'black', payout: 0, stake: 10 },
  },
  {
    name: 'roulette_bigwin',
    label: '🏆 Grande vitória (≥500)',
    vars: { pick: '17', ball: 17, color: 'black', payout: 3600, stake: 100 },
  },
  {
    name: 'roulette_zero',
    label: '🟢 Zero caiu',
    vars: { pick: 'vermelho', ball: 0, color: 'green', payout: 0, stake: 10 },
  },
  {
    name: 'roulette_lapartage',
    label: '🟡 Zero + La Partage',
    vars: { pick: 'vermelho', ball: 0, color: 'green', payout: 5, stake: 10, refund: 5 },
  },
];

let passed = 0;
let failed = 0;

for (const s of scenarios) {
  console.log('-'.repeat(60));
  console.log(`🎲 ${s.label}`);
  console.log(`   Cenário: "${s.name}"`);
  console.log(`   Vars: ${JSON.stringify(s.vars)}`);
  console.log('');

  const t0 = Date.now();
  let text;
  try {
    text = await flavor.italicLine(s.name, s.vars);
  } catch (err) {
    text = null;
    console.log(`   ❌ ERRO: ${err.message}`);
  }
  const elapsed = Date.now() - t0;
  const provider = flavor.lastProvider();
  const warm = flavor.isWarm ? flavor.isWarm() : '?';

  console.log(`   ⏱  ${elapsed}ms  |  Provider: ${provider}  |  Warm: ${warm}`);
  console.log(`   📝 ${text || '(vazio)'}`);
  console.log('');

  if (text && text.length > 0 && text !== '_(vazio)_') {
    passed++;
  } else {
    failed++;
    console.log(`   ⚠️  FALHA — sem output do cenário "${s.name}"`);
  }
}

console.log('='.repeat(60));
console.log(`📊 Resultado: ${passed}/${passed + failed} cenários OK`);
if (failed > 0) console.log(`⚠️  ${failed} falha(s)`);
console.log('='.repeat(60));
