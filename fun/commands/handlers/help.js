import { formatHelp } from '../../formatters/helpGuide.js';

/**
 * Help — sempre no chat atual (grupo). Sem DM (anti-ban WhatsApp).
 * Índice curto: `/ajuda` · tema: `/ajuda economia`
 */
export async function handleHelpCommand({ funConfig, reply, args = [] }) {
  const topic = args.length ? args.join(' ') : '';
  const text = formatHelp(funConfig.prefix || '/', topic);
  await reply(text);
  return { handled: true, private: false };
}
