/**
 * /grupo — escolhe o grupo whitelist usado como escopo nos DMs.
 */

function shortId(jid = '') {
  const s = String(jid || '');
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export async function handleGroupScopeCommand({
  userJid,
  funConfig,
  reply,
  args,
  sock,
  membershipService,
  prefsRepository,
  groups: groupsHint = null,
}) {
  const p = funConfig.prefix || '/';
  const whitelist = Array.isArray(funConfig.groupWhitelistJids)
    ? funConfig.groupWhitelistJids
    : [];

  let groups = Array.isArray(groupsHint) ? groupsHint : null;
  if (!groups) {
    if (!membershipService || !sock) {
      await reply('Não consegui listar seus grupos agora. Tente de novo em instantes.');
      return { handled: true };
    }
    groups = await membershipService.listUserMemberships({
      sock,
      userJid,
      whitelistJids: whitelist,
      funConfig,
    });
  }

  if (!groups.length) {
    await reply(
      [
        'Você não está em nenhum grupo liberado deste bot.',
        'Entre num grupo da whitelist e fale com o bot de novo.',
      ].join('\n')
    );
    return { handled: true, empty: true };
  }

  const sub = String(args[0] || '').trim();
  if (!sub) {
    const pref = prefsRepository?.get?.(userJid);
    const lines = [
      '🏠 *Seu grupo (escopo no privado)*',
      pref?.preferredScopeKey
        ? `Atual: *${shortId(pref.preferredScopeKey)}*`
        : 'Nenhum grupo preferido ainda.',
      '',
      'Grupos em que você está (whitelist):',
    ];
    groups.forEach((g, i) => {
      const mark =
        pref?.preferredScopeKey === g.jid || pref?.lastGroupJid === g.jid ? ' ←' : '';
      lines.push(`${i + 1}. *${g.name || 'Grupo'}*${mark}`);
      lines.push(`   \`${g.jid}\``);
    });
    lines.push('', `Escolha: \`${p}grupo 1\` ou \`${p}grupo <jid>\``);
    await reply(lines.join('\n'));
    return { handled: true, listed: true, groups };
  }

  let chosen = null;
  if (/^\d+$/.test(sub)) {
    const idx = Number(sub) - 1;
    chosen = groups[idx] || null;
  } else {
    const want = sub.toLowerCase();
    chosen =
      groups.find(g => g.jid === sub) ||
      groups.find(g => g.jid.toLowerCase().includes(want)) ||
      groups.find(g => String(g.name || '').toLowerCase().includes(want)) ||
      null;
  }

  if (!chosen) {
    await reply(`Grupo inválido. Use \`${p}grupo\` pra listar.`);
    return { handled: true, invalid: true };
  }

  prefsRepository?.setPreferredScope?.(userJid, chosen.jid);
  await reply(
    [
      '✅ Escopo de privado definido',
      `Grupo: *${chosen.name || chosen.jid}*`,
      '_Coins, rank e jogos no DM usam este grupo._',
    ].join('\n')
  );
  return { handled: true, scopeKey: chosen.jid };
}
