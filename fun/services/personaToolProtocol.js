/**
 * Protocolo fechado da persona agentiva.
 *
 * Suporta formatos flexíveis e seguros de retorno do modelo:
 * 1. Resposta direta simples: {"type":"reply","text":"..."} ou {"type":"text","text":"..."}
 * 2. Sequência multi-ação (multi-bubble / sticker / reação):
 *    {"type":"actions","actions":[{"type":"text","text":"..."},{"type":"sticker","slug":"parabens"}]}
 *    ou array direto: [{"type":"text","text":"..."},{"type":"sticker","slug":"..."}]
 * 3. Ação única direta de figurinha / reação:
 *    {"type":"sticker","slug":"entendi_nada"} ou {"type":"send_sticker","slug":"..."}
 * 4. Chamada a ferramenta controlada: {"type":"tool_call","name":"...","arguments":{...}}
 */

import { STICKER_SLUGS } from './personaStickerCatalog.js';

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
  'send_sticker',
]);

const EMOJI_RE = /^\p{Extended_Pictographic}+$/u;

/**
 * Verifica se um texto tem formato/aparência de JSON cru.
 */
export function looksLikeRawJson(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function parseJsonPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = (fenced?.[1] || text).trim();
  if (!source.startsWith('{') && !source.startsWith('[')) return null;
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function parsePersonaEnvelope(raw, { maxChars = 1_000, maxActions = 4 } = {}) {
  const value = parseJsonPayload(raw);
  if (!value) return { ok: false, reason: 'invalid-json' };

  // Caso A: Array de ações diretamente no topo
  if (Array.isArray(value)) {
    return sanitizeActions(value, maxChars, maxActions);
  }

  const type = String(value.type || '').toLowerCase();

  // Caso B: Reply / Texto Simples
  if (type === 'reply' || type === 'text') {
    const text = String(value.text || '').trim();
    if (!text) return { ok: false, reason: 'empty-reply' };
    return { ok: true, envelope: { type: 'reply', text: text.slice(0, maxChars) } };
  }

  // Caso C: Sequência Multi-Ação
  if (type === 'actions' || Array.isArray(value.actions)) {
    const rawActions = Array.isArray(value.actions) ? value.actions : [];
    return sanitizeActions(rawActions, maxChars, maxActions);
  }

  // Caso D: Ação única direta de figurinha (ex: {"type":"sticker","slug":"entendi_nada"})
  if (type === 'sticker' || type === 'send_sticker') {
    const slug = String(value.slug || value.name || '').trim();
    if (slug && STICKER_SLUGS.includes(slug)) {
      return { ok: true, envelope: { type: 'actions', actions: [{ type: 'sticker', slug }] } };
    }
    return { ok: false, reason: 'invalid-sticker-slug' };
  }

  // Caso E: Ação única direta de reação (ex: {"type":"react","emoji":"🎉"})
  if (type === 'react' || type === 'reaction_emoji') {
    const emoji = String(value.emoji || '').trim();
    if (emoji && (EMOJI_RE.test(emoji) || emoji.length <= 4)) {
      return { ok: true, envelope: { type: 'actions', actions: [{ type: 'react', emoji }] } };
    }
    return { ok: false, reason: 'invalid-emoji' };
  }

  // Caso F: Chamada de Ferramenta
  if (type === 'tool_call') {
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

function sanitizeActions(rawActions, maxChars, maxActions) {
  const sanitized = [];

  for (const item of rawActions.slice(0, maxActions)) {
    if (!item || typeof item !== 'object') continue;
    const aType = String(item.type || '').toLowerCase();

    if (aType === 'text' || aType === 'reply') {
      const text = String(item.text || '').trim();
      if (text) {
        sanitized.push({ type: 'text', text: text.slice(0, maxChars) });
      }
    } else if (aType === 'sticker' || aType === 'send_sticker') {
      const slug = String(item.slug || item.name || '').trim();
      if (slug && STICKER_SLUGS.includes(slug)) {
        sanitized.push({ type: 'sticker', slug });
      }
    } else if (aType === 'react' || aType === 'reaction_emoji') {
      const emoji = String(item.emoji || '').trim();
      if (emoji && (EMOJI_RE.test(emoji) || emoji.length <= 4)) {
        sanitized.push({ type: 'react', emoji });
      }
    }
  }

  if (!sanitized.length) return { ok: false, reason: 'empty-actions' };
  return { ok: true, envelope: { type: 'actions', actions: sanitized } };
}

export function buildPersonaToolManifest() {
  return [
    'Formatos de resposta permitidos (escolha o mais natural para o momento):',
    '',
    '1. SEQUÊNCIA MULTI-AÇÃO (RECOMENDADO para conversas dinâmicas, zoeira, comemorações e reações):',
    'Permite enviar múltiplos balões curtos, stickers exclusivos e/ou reagir com emoji:',
    '{"type":"actions","actions":[',
    '  {"type":"text","text":"Aeeeee parabéns fulano! 🎉"},',
    '  {"type":"sticker","slug":"parabens"},',
    '  {"type":"text","text":"Mais um ano aguentando você kkkk"}',
    ']}',
    'Tipos de ação válidos dentro de "actions":',
    '- {"type":"text","text":"..."} -> Envia um balão de fala',
    '- {"type":"sticker","slug":"<slug>"} -> Envia uma figurinha exclusiva sua',
    '- {"type":"react","emoji":"🎉"} -> Reage com um emoji na mensagem citada',
    '',
    'Slugs de figurinhas disponíveis para "sticker":',
    'rindo_muito, cara_de_pau, deboche, discordo, joinha, legal, seila, indo_embora, sono, curioso, pedindo, triste, muito_triste, vai_melhorar, pensativo, entendi_nada, chocado, que_absurdo, isso_e_demais, meu_deus, que_situacao, confiante, to_por_dentro, pode_deixar, mandando_ver, ja_sabia, dando_conselho, parabens, ganhamos, sextou, feriado, aniversario, piscadinha, malicioso, charmoso, corado, cansado, madrugada, sumindo, voltei.',
    '',
    '2. ENVIAR APENAS UMA FIGURINHA:',
    '{"type":"sticker","slug":"entendi_nada"}',
    '',
    '3. RESPOSTA DIRETA SIMPLES:',
    '{"type":"reply","text":"..."}',
    '',
    '4. CONSULTAS E FERRAMENTAS ESPECIAIS (no máximo UMA se precisar de dados):',
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
    '- reaction {"action":"hug|kiss|pat|slap|cuddle|bite|lick|poke|handhold|highfive|wave|nom|happy|cry|laugh|bruh|sus","target":"author|mentioned|quoted"}: envia uma reação SFW com imagem/gif.',
    '- send_sticker {"slug":"<slug>"}: envia diretamente uma figurinha exclusiva.',
    '',
    'Nunca use XML, markdown ou texto fora do JSON.',
  ].join('\n');
}
