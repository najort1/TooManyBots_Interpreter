import { formatHelp } from '../../formatters/rankCard.js';

/**
 * Help — sempre no chat atual (grupo). Sem DM (anti-ban WhatsApp).
 */
export async function handleHelpCommand({ funConfig, reply }) {
  const text = formatHelp(funConfig.prefix || '/');
  await reply(text);
  return { handled: true, private: false };
}
