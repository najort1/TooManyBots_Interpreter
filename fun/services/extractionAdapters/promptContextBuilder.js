/**
 * PromptContextBuilder: Construtor modular de contexto expandido para o System Prompt da Persona.
 *
 * Reúne de forma estruturada:
 * - Perfil e apelido do interlocutor atual (authorProfile)
 * - Perfis e fatos dos usuários MENCIONADOS na mensagem (mentionedUsers, targetProfiles)
 * - Tópicos quentes e dinâmicas recentes do grupo
 * - Clima ativo consolidado (lore e persona recente)
 *
 * NÃO impõe cortes artificiais rígidos de caracteres, permitindo que o modelo consuma todo o contexto disponível.
 */

import { isUsablePromptFact } from '../../utils/promptFactSanitizer.js';
import { resolveMentionedUsers, buildMentionedUsersContextBlock } from '../../utils/mentionResolver.js';
import { formatDatedFact } from '../../utils/factTemporalContext.js';

/**
 * Constrói o bloco de contexto de identidade e ambiente social do grupo.
 *
 * @param {object} params
 * @param {string} params.scopeKey Escopo do grupo (@g.us)
 * @param {string} [params.authorJid] JID do participante atual
 * @param {object} [params.authorProfile] Perfil do participante (nickname, bio, title, extras)
 * @param {object} [params.groupIdentity] Identidade observada do grupo (voiceStyle, groupLoreSummary, etc.)
 * @param {string} [params.activePersonaSummary] Clima ativo derivado pelo refreshPersona
 * @param {Array<string>} [params.recentTopics=[]] Tópicos ou palavras-chave frequentes recentes
 * @param {Array<string>} [params.confirmedFacts=[]] Fatos confirmados recentes
 * @returns {string} Bloco textual formatado para injeção no styleBlock/system prompt
 */
export function buildExpandedPromptContext({
  scopeKey = '',
  authorJid = '',
  authorProfile = null,
  groupIdentity = null,
  activePersonaSummary = '',
  recentTopics = [],
  confirmedFacts = [],
  mentionedJids = [],
  getDisplayName = null,
  getProfile = null,
  loreFacts = [],
  timeZone = 'America/Sao_Paulo',
} = {}) {
  const sections = [];

  // 1. Perfil do interlocutor direto
  if (authorProfile && typeof authorProfile === 'object') {
    const profileParts = [];
    if (authorProfile.nickname) profileParts.push(`Apelido no grupo: "${authorProfile.nickname}"`);
    if (authorProfile.title) profileParts.push(`Título/Cargo zoeira: ${authorProfile.title}`);
    if (authorProfile.bio) profileParts.push(`Bio/Descrição: ${authorProfile.bio}`);
    if (authorProfile.extras) profileParts.push(`Detalhes conhecidos: ${authorProfile.extras}`);

    if (profileParts.length) {
      sections.push(`Perfil de quem falou (${authorJid.split('@')[0]}):\n${profileParts.map((p) => `- ${p}`).join('\n')}`);
    }
  }

  // 2. Usuários mencionados na mensagem (via @menção)
  if (Array.isArray(mentionedJids) && mentionedJids.length && typeof getDisplayName === 'function' && typeof getProfile === 'function') {
    const mentionedUsersMap = resolveMentionedUsers(mentionedJids, getDisplayName, scopeKey);
    if (mentionedUsersMap.size > 0) {
      const mentionedBlock = buildMentionedUsersContextBlock(mentionedUsersMap, {
        getProfile,
        scopeKey,
        loreFacts,
        timeZone,
      });
      if (mentionedBlock) {
        sections.push(mentionedBlock);
      }
    }
  }

  // 2. Clima ativo e lore consolidada
  const activeClima = String(activePersonaSummary || groupIdentity?.groupLoreSummary || '').trim();
  if (activeClima) {
    sections.push(`Clima e Lore ativa do grupo:\n${activeClima}`);
  }

  // 3. Tópicos recentes e assuntos quentes das últimas horas
  if (Array.isArray(recentTopics) && recentTopics.length) {
    const validTopics = recentTopics.map((t) => String(t || '').trim()).filter(Boolean);
    if (validTopics.length) {
      sections.push(`Assuntos recentes comentados no grupo: ${validTopics.join(', ')}`);
    }
  }

  // 4. Fatos confirmados adicionais de lore recente
  if (Array.isArray(confirmedFacts) && confirmedFacts.length) {
    const usable = confirmedFacts
      .map((fact) => {
        const text = typeof fact === 'string' ? fact : fact?.summary || fact?.factText;
        if (!text || !isUsablePromptFact(text)) return '';
        return formatDatedFact(typeof fact === 'string' ? {} : fact, text, timeZone);
      })
      .filter(Boolean);

    if (usable.length) {
      sections.push(`Fatos recentes de lore do grupo:\n${usable.map((fact) => `- ${fact}`).join('\n')}`);
    }
  }

  return sections.filter(Boolean).join('\n\n');
}
