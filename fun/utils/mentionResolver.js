/**
 * Resolvedor de menções no texto do prompt para a Persona.
 *
 * Substitui @JID/numero no texto por @NomeLegivel ou @Apelido,
 * e retorna metadados dos usuários mencionados para injeção no prompt.
 */

import { jidLocalPart, normalizeMentionJid } from './userLabel.js';
import { formatDatedFact } from './factTemporalContext.js';

/**
 * Resolve nomes legíveis de JIDs mencionados.
 *
 * @param {Array<string>} mentionedJids - JIDs mencionados na mensagem
 * @param {Function} getDisplayName - Função que recebe (jid, scopeKey) e retorna string
 * @param {string} scopeKey - Escopo do grupo
 * @returns {Map<string, object>} Map de jid -> { jid, localPart, displayName, nickname }
 */
export function resolveMentionedUsers(mentionedJids = [], getDisplayName, scopeKey) {
  const map = new Map();
  if (!Array.isArray(mentionedJids) || !mentionedJids.length) return map;

  for (const jid of mentionedJids) {
    const normalized = normalizeMentionJid(jid);
    if (!normalized) continue;
    if (map.has(normalized)) continue;

    const local = jidLocalPart(normalized) || '';
    let displayName = '';
    let nickname = '';

    try {
      if (typeof getDisplayName === 'function') {
        const fullName = String(getDisplayName(normalized, scopeKey) || '').trim();
        // Se getDisplayName retornar "Apelido (Nome)", separamos
        if (fullName.includes('(') && fullName.includes(')')) {
          const match = fullName.match(/^(.+?)\s*\((.+)\)$/);
          if (match) {
            nickname = match[1].trim();
            displayName = match[2].trim();
          } else {
            displayName = fullName;
          }
        } else {
          displayName = fullName;
        }
      }
    } catch {
      // ignore
    }

    // Fallback: parte local do JID
    if (!displayName && !nickname) {
      displayName = local || 'alguém';
    }

    map.set(normalized, {
      jid: normalized,
      localPart: local,
      displayName: displayName || local || 'alguém',
      nickname: nickname || '',
    });
  }

  return map;
}

/**
 * Substitui @JIDLocalPart no texto por @NomeLegivel/@Apelido.
 *
 * Ex: "oi @551199999999" -> "oi @Eduardo" (se Eduardo for o displayName)
 *
 * @param {string} text - Texto original da mensagem
 * @param {Map<string, object>} mentionedUsersMap - Map retornado por resolveMentionedUsers
 * @returns {string} Texto com menções resolvidas
 */
export function resolveMentionsInText(text, mentionedUsersMap) {
  if (!text || !mentionedUsersMap?.size) return text;

  let result = String(text);

  // Padrão: @ + parte local do JID (números/LID)
  // Ex: @551199999999, @123456789012345678
  for (const [jid, info] of mentionedUsersMap) {
    const local = info.localPart;
    if (!local) continue;

    // Escapa caracteres especiais para regex
    const escapedLocal = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Substitui @551199999999 -> @Eduardo (ou @Apelido se houver)
    const replacement = info.nickname ? `@${info.nickname}` : `@${info.displayName}`;

    // Regex que captura @localPart como palavra inteira (boundary)
    const regex = new RegExp(`@${escapedLocal}\\b`, 'g');
    result = result.replace(regex, replacement);
  }

  return result;
}

/**
 * Constrói bloco de contexto dos usuários mencionados para o prompt.
 *
 * @param {Map<string, object>} mentionedUsersMap
 * @param {object} options
 * @param {Function} options.getProfile - Função (jid, scopeKey) -> profile
 * @param {string} options.scopeKey
 * @param {Array<object>} options.loreFacts - Fatos de lore do grupo (opcional, para filtrar por subject)
 * @returns {string} Bloco formatado
 */
export function buildMentionedUsersContextBlock(
  mentionedUsersMap,
  { getProfile, scopeKey, loreFacts = [], timeZone } = {}
) {
  if (!mentionedUsersMap?.size) return '';

  const sections = [];
  const mentionedJids = Array.from(mentionedUsersMap.keys());

  // Filtrar fatos de lore relevantes para cada usuário mencionado
  const factsBySubject = new Map();
  if (Array.isArray(loreFacts) && loreFacts.length) {
    for (const fact of loreFacts) {
      const subjects = Array.isArray(fact.subjects)
        ? fact.subjects
        : fact.subjectUserJid
          ? [fact.subjectUserJid]
          : [];
      for (const sj of subjects) {
        const key = String(sj).trim();
        if (!factsBySubject.has(key)) factsBySubject.set(key, []);
        factsBySubject.get(key).push(fact);
      }
    }
  }

  for (const jid of mentionedJids) {
    const info = mentionedUsersMap.get(jid);
    if (!info) continue;

    const profile = typeof getProfile === 'function' ? getProfile(jid, scopeKey) : null;
    const hasProfile = profile && !profile.empty;

    const lines = [`Membro mencionado: ${info.displayName}${info.nickname ? ` (${info.nickname})` : ''} [JID: ${info.localPart}]`];

    if (hasProfile) {
      const bits = [];
      if (profile.nickname && profile.nickname !== info.displayName) bits.push(`Apelido no grupo: "${profile.nickname}"`);
      if (profile.title) bits.push(`Título/Cargo zoeira: ${profile.title}`);
      if (profile.bio) bits.push(`Bio/Descrição: ${profile.bio}`);
      if (profile.extras) bits.push(`Detalhes conhecidos: ${profile.extras}`);
      if (bits.length) lines.push(...bits.map((b) => `  - ${b}`));
    } else {
      lines.push('  - Sem perfil preenchido no grupo (nome via WhatsApp)');
    }

    // Adicionar fatos de lore específicos deste usuário
    const userFacts = factsBySubject.get(jid) || factsBySubject.get(info.localPart) || [];
    if (userFacts.length) {
      const factLines = userFacts
        .slice(0, 5)
        .map((f) => `  - ${formatDatedFact(f, `[${f.kind}] ${f.summary}`, timeZone)}`);
      lines.push('Fatos de Lore sobre este membro:');
      lines.push(...factLines);
    }

    sections.push(lines.join('\n'));
  }

  if (!sections.length) return '';

  return [
    '<mentioned_users>',
    'Usuários citados na mensagem atual (use para saber DE QUEM a pessoa está falando):',
    ...sections,
    '</mentioned_users>',
  ].join('\n');
}