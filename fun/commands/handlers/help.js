import { formatHelp } from '../../formatters/helpGuide.js';

/**
 * Help — sempre no chat atual (grupo). Sem DM (anti-ban WhatsApp).
 * Índice curto: `/ajuda` · tema: `/ajuda economia`
 */
export async function handleHelpCommand({ funConfig, reply, args = [], scopeKey, nsfwVoteRepository }) {
  const topic = args.length ? args.join(' ') : '';
  const nsfwPermitted = Boolean(nsfwVoteRepository?.getPermitirNsfw?.(scopeKey));
  const text = formatHelp(funConfig.prefix || '/', topic, nsfwPermitted);
  await reply(text);
  return { handled: true, private: false };
}
