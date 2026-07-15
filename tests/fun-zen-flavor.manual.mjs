import { openaiChatComplete } from '../fun/llm/openaiClient.js';
import { createFlavorService } from '../fun/llm/flavorService.js';
import { resolveFunConfig } from '../fun/config.js';

const system = [
  'Você é o narrador de um bot de WhatsApp em português brasileiro.',
  'Escreva UMA frase curta (max 120 caracteres), tom de grupo, irônico e leve.',
  'NÃO invente números de jogo. NÃO use markdown. Sem aspas. No máximo 2 emojis.',
  'Responda SOMENTE com a frase final em português.',
].join('\n');

for (const model of ['mimo-v2.5-free', 'deepseek-v4-flash-free', 'hy3-free']) {
  const t = Date.now();
  try {
    const r = await openaiChatComplete({
      baseUrl: 'http://127.0.0.1:3000',
      model,
      system,
      prompt: 'Comente ship 31% entre Eduardo e lucy. Clima: amizade. Frase:',
      timeoutMs: 30000,
      maxTokens: model.includes('deepseek') ? 220 : 100,
      temperature: 0.9,
    });
    console.log(model, `${Date.now() - t}ms`, JSON.stringify(r));
  } catch (e) {
    console.log(model, 'ERR', e.message);
  }
}

const svc = createFlavorService({
  getConfig: () =>
    resolveFunConfig({
      zenEnabled: true,
      zenBaseUrl: 'http://127.0.0.1:3000',
      zenModel: 'mimo-v2.5-free',
      zenMaxTokens: 100,
      ollamaEnabled: false,
    }),
});
const t2 = Date.now();
const line = await svc.line('ship', {
  a: 'Eduardo',
  b: 'lucy',
  percent: 31,
  label: 'Amizade talvez',
});
console.log('flavor', svc.lastProvider(), `${Date.now() - t2}ms`, JSON.stringify(line));
