/**
 * /lore · /esquecelore
 */

import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import { fmt } from '../../messages/index.js';

export async function handleLoreCommand({
  scopeKey,
  isGroup,
  groupMemoryService,
  funConfig,
  reply,
}) {
  if (!isGroup) {
    await reply('Lore é do *grupo*. Abre no chat da panelinha.');
    return { handled: true };
  }
  if (!groupMemoryService) {
    await reply(fmt.notAvailable({ command: 'lore' }));
    return { handled: true };
  }
  if (funConfig.memoryEnabled === false) {
    await reply('Memória desligada neste bot.');
    return { handled: true };
  }

  const text = groupMemoryService.formatLoreList(scopeKey, { limit: 12, funConfig });
  await reply(text);
  return { handled: true };
}

export async function handleForgetLoreCommand({
  userJid,
  scopeKey,
  isGroup,
  groupMemoryService,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
}) {
  if (!isGroup) {
    await reply('Limpar lore só no *grupo*.');
    return { handled: true };
  }
  if (!groupMemoryService) {
    await reply(fmt.notAvailable({ command: 'esquecelore' }));
    return { handled: true };
  }

  const joined = (args || []).map((a) => String(a || '').toLowerCase()).join(' ');
  const wipeAll =
    /\b(tudo|all|grupo|limpar)\b/.test(joined) && /\b(sim|confirma|confirm)\b/.test(joined);

  if (wipeAll) {
    const n = groupMemoryService.forgetAll(scopeKey);
    await reply(
      [
        '🧠 *Lore apagada*',
        n > 0 ? `Removi *${n}* fato(s) deste grupo.` : 'Já estava vazia.',
        '_Memória do grupo limpa._',
      ].join('\n')
    );
    return { handled: true, wiped: n };
  }

  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const resolved = await resolveUserTarget({
    args,
    mentionedJids,
    quotedParticipant,
    excludeJid: '',
    identityMap,
    sock,
    groupJid: scopeKey,
    contacts,
  });

  if (resolved?.jid && isCanonicalUserJid(resolved.jid)) {
    const name = nameOf(getContactDisplayName, resolved.jid);
    const n = groupMemoryService.forgetSubject(scopeKey, resolved.jid);
    await reply(
      n > 0
        ? `Apaguei *${n}* fato(s) centrados em *${name}*.`
        : `Nada na lore sobre *${name}*.`
    );
    return { handled: true, wiped: n, target: resolved.jid };
  }

  const query = (args || []).map((a) => String(a || '').trim()).join(' ').trim();
  if (query && typeof groupMemoryService.forgetByQuery === 'function') {
    const res = groupMemoryService.forgetByQuery(scopeKey, query);
    if (res.ok) {
      if (res.removed === 1 && res.matches?.[0]) {
        await reply(`🧠 *Fato esquecido:*\n"${res.matches[0].summary}"`);
      } else {
        await reply(`🧠 *Lore atualizada:*\nApaguei *${res.removed}* fatos sobre "${query}".`);
      }
      return { handled: true, wiped: res.removed, query };
    }
    if (res.reason === 'too-broad') {
      const examples = (res.matches || [])
        .slice(0, 3)
        .map((m) => `• _${m.summary}_`)
        .join('\n');
      await reply(
        [
          `⚠️ Encontrei *${res.count}* fatos que combinam com "${query}".`,
          'Para não apagar coisa demais sem querer, seja mais específico:',
          examples,
        ].join('\n')
      );
      return { handled: true, reason: 'too-broad' };
    }
    await reply(`Não encontrei nenhum fato sobre "${query}" na lore deste grupo.`);
    return { handled: true, reason: 'not-found' };
  }

  await reply(
    [
      '🧠 *Esquecer lore*',
      '• `/esquecelore <termo>` — remove fatos sobre um assunto (ex.: `/esquecelore celta`)',
      '• `/esquecelore @pessoa` — tira fatos da pessoa',
      '• `/esquecelore tudo sim` — zera a memória do *grupo*',
      '',
      '_Sem “sim” não apago o grupo inteiro._',
    ].join('\n')
  );
  return { handled: true, reason: 'help' };
}
