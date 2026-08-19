/**
 * Protocolo fechado da persona agentiva.
 *
 * Modelos diferentes costumam inventar XML ou funções nativas. O Fun aceita
 * somente um objeto JSON completo, para que a camada de execução nunca dependa
 * de texto livre gerado pelo modelo.
 */

export const PERSONA_TOOL_NAMES = Object.freeze([
  'help',
  'group_status',
  'lore',
  'start_russian',
  'oracle',
  'illuminati',
  'gossip',
  'tarot',
  'ship',
  'cancel',
  'reaction',
]);

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = (fenced?.[1] || text).trim();
  if (!source.startsWith('{') || !source.endsWith('}')) return null;
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function parsePersonaEnvelope(raw, { maxChars = 1_000 } = {}) {
  const value = parseJsonObject(raw);
  if (!value) return { ok: false, reason: 'invalid-json' };

  if (value.type === 'reply') {
    const text = String(value.text || '').trim();
    if (!text) return { ok: false, reason: 'empty-reply' };
    return { ok: true, envelope: { type: 'reply', text: text.slice(0, maxChars) } };
  }

  if (value.type === 'tool_call') {
    const name = String(value.name || '').trim();
    if (!PERSONA_TOOL_NAMES.includes(name)) return { ok: false, reason: 'unknown-tool' };
    const args = value.arguments;
    if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
      return { ok: false, reason: 'invalid-arguments' };
    }
    return { ok: true, envelope: { type: 'tool_call', name, arguments: args || {} } };
  }

  return { ok: false, reason: 'invalid-type' };
}

export function buildPersonaToolManifest() {
  return [
    'Ferramentas disponíveis (no máximo UMA por resposta):',
    '- help {"topic":"opcional"}: mostra ajuda oficial de um tema/comando.',
    '- group_status {}: informa o estado seguro do grupo, inclusive horário do jornal; NUNCA publica jornal.',
    '- lore {"query":"opcional"}: consulta fatos persistidos deste grupo.',
    '- start_russian {}: abre roleta russa no grupo e eu faço um puxão virtual sem XP/coins.',
    '- oracle {"question":"texto"}: responde com o oráculo maluco.',
    '- illuminati {"target":"author|mentioned|quoted"}: cria teoria claramente fictícia.',
    '- gossip {"target":"author|mentioned|quoted"}: cria fofoca claramente fictícia.',
    '- tarot {"question":"opcional"}: faz uma tiragem de tarô para quem falou, respeitando o cooldown normal.',
    '- ship {"mode":"auto|author_and_mentioned|author_and_quoted|mentioned_pair"}: calcula afinidade sem alterar relacionamentos.',
    '- cancel {"target":"author|mentioned|quoted"}: faz um cancelamento absurdo, claramente brincadeira.',
    '- reaction {"action":"hug|kiss|pat|slap|cuddle|bite|lick|poke|handhold|highfive|wave|nom|happy|cry|laugh|bruh|sus","target":"author|mentioned|quoted"}: envia uma reação SFW.',
    'Nunca use XML, markdown ou texto fora do JSON. Formatos válidos:',
    '{"type":"reply","text":"..."}',
    '{"type":"tool_call","name":"help","arguments":{"topic":"jogos"}}',
  ].join('\n');
}
