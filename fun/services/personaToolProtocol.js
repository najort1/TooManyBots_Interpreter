import { STICKER_SLUGS } from './personaStickerCatalog.js';

export const EMOJI_RE = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*$/u;
const TARGETS = ['author', 'mentioned', 'quoted'];
const REACTION_ACTIONS = ['hug', 'kiss', 'pat', 'slap', 'cuddle', 'bite', 'lick', 'poke', 'handhold', 'highfive', 'wave', 'nom', 'happy', 'cry', 'laugh', 'bruh', 'sus'];

/** A fonte única de verdade para manifesto, parser e políticas de tool. */
export const PERSONA_TOOL_DEFINITIONS = Object.freeze({
  help: { description: 'Mostra ajuda oficial.', schema: { topic: { type: 'string', max: 60 } }, readOnly: true },
  group_status: { description: 'Consulta o estado seguro do grupo.', schema: {}, readOnly: true },
  lore: { description: 'Consulta a lore persistida do grupo.', schema: { query: { type: 'string', max: 120 } }, readOnly: true },
  recent_conversation: { description: 'Consulta a conversa recente da persona.', schema: { query: { type: 'string', max: 120 } }, readOnly: true },
  group_identity: { description: 'Consulta minha identidade e lore ativa neste grupo.', schema: {}, readOnly: true },
  start_russian: { description: 'Abre uma roleta russa fictícia.', schema: {}, sideEffect: true },
  oracle: { description: 'Faz uma pergunta ao oráculo.', schema: { question: { type: 'string', max: 180 } } },
  illuminati: { description: 'Cria teoria fictícia.', schema: { target: { type: 'enum', values: TARGETS } } },
  gossip: { description: 'Cria fofoca fictícia.', schema: { target: { type: 'enum', values: TARGETS } } },
  tarot: { description: 'Faz uma tiragem de tarô.', schema: { question: { type: 'string', max: 500 } } },
  ship: { description: 'Calcula afinidade.', schema: { mode: { type: 'enum', values: ['auto', 'author_and_mentioned', 'author_and_quoted', 'mentioned_pair'] } } },
  cancel: { description: 'Faz um cancelamento de brincadeira.', schema: { target: { type: 'enum', values: TARGETS } } },
  reaction: { description: 'Envia GIF de ação anime/meme (hug, kiss, slap, pat, wave, etc.) direcionada a um membro, ou reage com emoji.', schema: { action: { type: 'string', max: 40 }, target: { type: 'enum', values: TARGETS }, emoji: { type: 'string', max: 10 } }, sideEffect: true },
  send_sticker: { description: 'Envia figurinha exclusiva.', schema: { slug: { type: 'enum', values: STICKER_SLUGS } }, sideEffect: true },
});

export const PERSONA_TOOL_NAMES = Object.freeze(Object.keys(PERSONA_TOOL_DEFINITIONS));

export function looksLikeRawJson(text) {
  const value = String(text || '').trim();
  if (!value || (!value.startsWith('{') && !value.startsWith('['))) return false;
  try { JSON.parse(value); return true; } catch { return false; }
}

function parseJsonPayload(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = (fenced?.[1] || text).trim();
  if (!source || (!source.startsWith('{') && !source.startsWith('['))) return null;
  try { const value = JSON.parse(source); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

function validateArguments(name, rawArguments) {
  const definition = PERSONA_TOOL_DEFINITIONS[name];
  const args = rawArguments == null ? {} : rawArguments;
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'invalid-arguments' };
  const schema = definition.schema || {};
  for (const key of Object.keys(args)) if (!Object.hasOwn(schema, key)) return { ok: false, reason: 'unknown-argument' };
  const sanitized = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = args[key];
    if (value == null) continue;
    if (rule.type === 'string') {
      if (typeof value !== 'string') return { ok: false, reason: `invalid-${key}` };
      sanitized[key] = value.trim().slice(0, rule.max || 500);
    } else if (rule.type === 'enum') {
      if (typeof value !== 'string' || !rule.values.includes(value)) return { ok: false, reason: `invalid-${key}` };
      sanitized[key] = value;
    }
  }
  return { ok: true, arguments: sanitized };
}

export function parseFollowupEnvelope(raw, { maxChars = 1_000, maxActions = 4, allowedReplyMessageIds = [] } = {}) {
  const value = parseJsonPayload(raw);
  if (!value || Array.isArray(value)) return { ok: false, reason: 'invalid-json' };
  const type = String(value.type || '').toLowerCase();
  if (type === 'ignore') return { ok: true, envelope: { type: 'ignore' } };
  if (type !== 'follow_up') return { ok: false, reason: 'invalid-type' };

  if (typeof value.replyToMessageId !== 'string') return { ok: false, reason: 'invalid-reply-target' };
  const targetId = value.replyToMessageId.trim();
  const allowedIds = new Set(Array.isArray(allowedReplyMessageIds) ? allowedReplyMessageIds.map(String) : []);
  if (!targetId || !allowedIds.has(targetId)) return { ok: false, reason: 'invalid-reply-target' };

  if (typeof value.text === 'string' && value.text.trim()) {
    return {
      ok: true,
      envelope: { type: 'follow_up', replyToMessageId: targetId, text: value.text.trim().slice(0, maxChars) },
    };
  }
  if (Array.isArray(value.actions)) {
    const actions = sanitizeActions(value.actions, maxChars, maxActions);
    if (!actions.ok) return actions;
    return {
      ok: true,
      envelope: { type: 'follow_up', replyToMessageId: targetId, actions: actions.envelope.actions },
    };
  }
  return { ok: false, reason: 'empty-follow-up' };
}

export function parsePersonaEnvelope(raw, { maxChars = 1_000, maxActions = 4 } = {}) {
  const value = parseJsonPayload(raw);
  if (!value) return { ok: false, reason: 'invalid-json' };
  if (Array.isArray(value)) return sanitizeActions(value, maxChars, maxActions);
  const type = String(value.type || '').toLowerCase();
  if (type === 'reply' || type === 'text') {
    const text = String(value.text || '').trim();
    return text ? { ok: true, envelope: { type: 'reply', text: text.slice(0, maxChars) } } : { ok: false, reason: 'empty-reply' };
  }
  if (type === 'actions' || Array.isArray(value.actions)) return sanitizeActions(Array.isArray(value.actions) ? value.actions : [], maxChars, maxActions);
  if (type === 'sticker' || type === 'send_sticker') return sanitizeActions([{ type: 'sticker', slug: value.slug || value.name }], maxChars, maxActions);
  if (type === 'react' || type === 'reaction_emoji') return sanitizeActions([{ type: 'react', emoji: value.emoji }], maxChars, maxActions);
  if (type === 'tool_call') {
    const name = String(value.name || '').trim().toLowerCase();
    if (!Object.hasOwn(PERSONA_TOOL_DEFINITIONS, name)) return { ok: false, reason: 'unknown-tool' };
    const args = validateArguments(name, value.arguments);
    if (!args.ok) return args;
    return { ok: true, envelope: { type: 'tool_call', name, arguments: args.arguments, callId: String(value.callId || '').trim().slice(0, 80) } };
  }
  return { ok: false, reason: 'invalid-type' };
}

function sanitizeActions(rawActions, maxChars, maxActions) {
  const actions = [];
  for (const item of rawActions.slice(0, maxActions)) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '').toLowerCase();
    if (type === 'text' || type === 'reply') {
      const text = String(item.text || '').trim();
      if (text) actions.push({ type: 'text', text: text.slice(0, maxChars) });
    } else if ((type === 'sticker' || type === 'send_sticker') && STICKER_SLUGS.includes(String(item.slug || item.name || '').trim())) {
      actions.push({ type: 'sticker', slug: String(item.slug || item.name).trim() });
    } else if ((type === 'react' || type === 'reaction_emoji') && EMOJI_RE.test(String(item.emoji || '').trim())) {
      actions.push({ type: 'react', emoji: String(item.emoji).trim() });
    }
  }
  return actions.length ? { ok: true, envelope: { type: 'actions', actions } } : { ok: false, reason: 'empty-actions' };
}

export function buildPersonaToolManifest() {
  const lines = [
    'Responda SOMENTE JSON.',
    'Resposta: {"type":"reply","text":"..."} ou {"type":"actions","actions":[{"type":"text","text":"..."},{"type":"sticker","slug":"..."},{"type":"react","emoji":"..."}]}',
    'Reações com EMOJI: Você pode reagir à mensagem usando QUALQUER emoji disponível (ex: 🔥, 😂, ❤️, 👍, 💀, 👀, 😮, 🎉, 👏, etc.) através de {"type":"actions","actions":[{"type":"react","emoji":"🔥"}]}. Pode enviar só a reação de emoji ou combiná-la com texto.',
    'Tool: {"type":"tool_call","name":"...","arguments":{},"callId":"opcional"}. Em cada mensagem, chame no máximo UMA tool; depois do resultado, finalize com reply/actions e não chame outra tool.',
    'Nunca diga que vai usar, tentar ou chamar uma tool no futuro: chame-a agora com tool_call ou responda sem mencioná-la.',
    'Quando pedirem para você realizar uma ação suportada por tool (como abraçar, beijar, bater/tapa, fazer carinho, acenar, tirar tarô, fofoca, teoria, ship), VOCÊ DEVE CHAMAR A TOOL com tool_call. NUNCA finja em texto que realizou a ação (por exemplo, nunca responda em texto "pronto, te abracei" ou "já te dei um abraço" — execute a tool reaction com action:"hug").',
    'Quando pedirem para testar, verificar ou demonstrar uma tool sem indicar uma brincadeira específica, chame group_status. Não use oracle/tarot sem pergunta ou pedido de leitura; não use ship sem duas pessoas; não use stickers ou start_russian apenas como teste.',
    'A tool "reaction" envia um GIF animado de ação anime/meme (hug, kiss, pat, slap, wave, etc.) direcionado a um membro. Mapeamento comum: abraçar/abraço -> hug, beijar/beijo -> kiss, bater/tapa -> slap, carinho/cafuné -> pat, acenar/oi -> wave. Para reagir à mensagem com emojis simples, prefira usar diretamente a ação de react no JSON acima.',
    `Ações de GIF/mídia SFW da tool reaction: ${REACTION_ACTIONS.join(', ')}.`,
    `Stickers: ${STICKER_SLUGS.join(', ')}.`,
    'Tools disponíveis:',
  ];
  for (const [name, definition] of Object.entries(PERSONA_TOOL_DEFINITIONS)) {
    const args = Object.entries(definition.schema || {}).map(([key, rule]) => `${key}:${rule.type === 'enum' ? rule.values.join('|') : 'texto'}`).join(', ');
    lines.push(`- ${name} {${args}}: ${definition.description}`);
  }
  return lines.join('\n');
}
