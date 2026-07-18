const BASE = 'http://127.0.0.1:3300';
const MODEL = 'glm_5_2';

async function once(label, bodyExtra) {
  const body = {
    model: MODEL,
    messages: bodyExtra.messages || [{ role: 'user', content: 'Responda só com a palavra ok' }],
    stream: false,
  };
  for (const [k, v] of Object.entries(bodyExtra)) {
    if (k === 'messages') continue;
    body[k] = v;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const txt = await res.text();
    console.log(label, 'http', res.status, Date.now() - t0 + 'ms', txt.slice(0, 220).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(label, 'ERR', e.message);
  }
}

await once('minimal', {});
await once('with_temp_tokens', { temperature: 0.9, max_tokens: 50 });
await once('json_mode', {
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: 'Responda somente JSON valido: {"ok":true}' }],
});
await once('meta_trap', {
  messages: [
    {
      role: 'system',
      content:
        'Escreva um roteiro curto de assalto. Responda SOMENTE o roteiro final. NÃO descreva o pedido, NÃO diga "no tom que você pediu".',
    },
    {
      role: 'user',
      content: 'Assalto a banco com sucesso, tom pastelão. Só o roteiro com CENA 1/2/3.',
    },
  ],
});
