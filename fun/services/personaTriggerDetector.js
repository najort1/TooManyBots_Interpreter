/**
 * Detector Avançado de Gatilhos e Continuação da Persona.
 *
 * Responsável por:
 * - Resolução e normalização de JIDs de identidade do bot.
 * - Detecção de gatilhos textuais: vocativos no início ("bot", "ei bot", "eae bot", "fala bot", "salve bot", "opa bot", "oi bot"),
 *   citações naturais no meio da frase ("fala aí bot", "o que você acha, bot?") e
 *   apelidos/aliases customizados (ex: "jarvis", "zezin").
 * - Detecção de menções diretas via @ (participantes mencionados).
 * - Verificação de âncoras de resposta para continuação de threads de conversa.
 */

/**
 * Chamadas textuais inequívocas e saudações comuns direcionadas ao bot no início da mensagem.
 * Exemplos aceitos:
 * - "bot...", "bot?", "bot me ajuda"
 * - "ei bot...", "ei, bot..."
 * - "eae bot", "eai bot", "e aí bot", "e ae bot"
 * - "fala bot", "fala ai bot", "fala aí bot"
 * - "opa bot", "salve bot", "coe bot", "coé bot", "qual foi bot"
 * - "oi bot", "ola bot", "olá bot"
 */
const VOCATIVE_START_RE = /^\s*(?:bot|(?:ei|e\s*a[eií]|fala(?:\s+a[íi])?|opa|salve|co[eé]|qual\s+foi|oi|ol[áa])\s*,?\s*bot)(?:\s|[?!,.:;]|$)/iu;

/** Menções naturais ao bot com limites de palavra em qualquer parte da frase. */
const WORD_BOT_RE = /(?:^|\s|[.,!?;:])bot(?=[.,!?;:]|\s|$)/iu;

/** IDs de mensagem do WhatsApp/Baileys (base64url) e UUIDs. */
const GENERIC_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * Normaliza JID do WhatsApp.
 */
export function normalizeJid(raw) {
  const jid = String(raw || '').trim();
  if (!jid) return '';
  const at = jid.indexOf('@');
  const user = at >= 0 ? jid.slice(0, at).split(':')[0] : jid.split(':')[0];
  const domain = at >= 0 ? jid.slice(at) : '@s.whatsapp.net';
  return user ? `${user}${domain}` : '';
}

/**
 * Resolve JID através do identityMap (ex: LID -> PN/JID canônico).
 */
export function resolveJid(raw, identityMap) {
  const jid = normalizeJid(raw);
  if (!jid) return '';
  const mapped = identityMap?.resolve ? normalizeJid(identityMap.resolve(jid)) : '';
  return mapped || jid;
}

/**
 * Coleta todos os JIDs e identidades conhecidas do bot.
 */
export function collectBotJids(sock, identityMap, extraJids = []) {
  const candidates = [
    sock?.user?.id, sock?.user?.lid, sock?.user?.pn, sock?.user?.jid,
    sock?.authState?.creds?.me?.id, sock?.authState?.creds?.me?.lid,
    sock?.authState?.creds?.me?.pn, sock?.authState?.creds?.me?.jid,
    ...extraJids,
  ];
  const identities = new Set();
  for (const candidate of candidates) {
    const raw = normalizeJid(candidate);
    const resolved = resolveJid(raw, identityMap);
    if (raw) identities.add(raw);
    if (resolved) identities.add(resolved);
  }
  return identities;
}

/**
 * Normaliza texto para comparação de âncora de resposta (fallback de reconciliação).
 */
export function normalizeAnchorText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifica se a mensagem é textual (texto simples ou extended-text).
 */
export function isTextMessage(messageType) {
  const type = String(messageType || 'text').toLowerCase();
  return type === 'text' || type === 'extended-text';
}

/**
 * Detecta se a mensagem aciona a persona (por vocativo, @menção ou apelido).
 */
export function detectTrigger({
  text = '',
  mentionedJids = [],
  botJid = '',
  botJids = [],
  identityMap = null,
  customAliases = [],
  allowNaturalMentions = false,
}) {
  const body = String(text || '').trim();
  let mention = false;

  if (body) {
    // 1. Vocativo e saudações padrão no início ("bot...", "ei bot...", "eae bot...", "fala bot...", "salve bot...")
    if (VOCATIVE_START_RE.test(body)) {
      mention = true;
    }

    // 2. Apelidos/aliases customizados configurados para o grupo/bot
    if (!mention && Array.isArray(customAliases) && customAliases.length > 0) {
      for (const alias of customAliases) {
        const cleanAlias = String(alias || '').trim();
        if (cleanAlias.length >= 3) {
          const aliasRe = new RegExp(`(?:^|\\s|[.,!?;:])${cleanAlias}(?=[.,!?;:]|\\s|$)`, 'iu');
          if (aliasRe.test(body)) {
            mention = true;
            break;
          }
        }
      }
    }

    // 3. Menção natural no meio da frase se ativada
    if (!mention && allowNaturalMentions && WORD_BOT_RE.test(body)) {
      mention = true;
    }
  }

  // 4. Detecção por @menção de JID
  const identities = collectBotJids(null, identityMap, [botJid, ...botJids]);
  const atMention = Array.isArray(mentionedJids) && mentionedJids.some((jid) => {
    const raw = normalizeJid(jid);
    return identities.has(raw) || identities.has(resolveJid(raw, identityMap));
  });

  return { mention, atMention };
}

/**
 * Verifica se a citação aponta com precisão para a âncora da conversa da persona.
 */
export function isThreadContinuation({
  quotedIsBot,
  thread,
  quotedMessageId,
  quotedText,
}) {
  if (!quotedIsBot || !thread) return false;

  const quotedId = String(quotedMessageId || '').trim();
  const anchorIds = Array.isArray(thread?.anchorMessageIds) && thread.anchorMessageIds.length
    ? thread.anchorMessageIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [String(thread?.anchorMessageId || '').trim()].filter(Boolean);
  const anchorText = String(thread?.anchorText || '').trim();
  const quotedTextNorm = normalizeAnchorText(quotedText);
  const anchorTextNorm = normalizeAnchorText(anchorText);
  const quotedIdIsReal = GENERIC_ID_RE.test(quotedId);
  const idMatches = quotedIdIsReal && anchorIds.includes(quotedId);
  const textMatches = Boolean(anchorTextNorm && quotedTextNorm && quotedTextNorm === anchorTextNorm);

  // Alguns clients fornecem só o texto citado. A igualdade com a âncora é
  // suficiente nesse fallback; um ID presente e diferente continua exigindo
  // esse texto exato para não capturar replies de comandos do bot.
  const quotePointsToAnchor = (idMatches || (!quotedId && !quotedTextNorm) || textMatches);
  return Boolean(quotePointsToAnchor);
}
