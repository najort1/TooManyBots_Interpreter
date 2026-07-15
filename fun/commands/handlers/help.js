import { formatHelp } from '../../formatters/rankCard.js';

export async function handleHelpCommand({ funConfig, reply }) {
  await reply(formatHelp(funConfig.prefix || '/'));
  return { handled: true };
}
