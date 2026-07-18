import { formatXpProfile } from '../../formatters/rankCard.js';
import { renderProfileCardPng } from '../../formatters/rankCardImage.js';
import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf, displayNameOnly } from '../../utils/userLabel.js';
import { isGroupAdmin } from '../../utils/groupMembership.js';
import { formatBirthdayDisplay } from '../../services/profileService.js';

function normSub(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatSetConfirm(profile, changed = []) {
  const lines = ['✅ *Perfil atualizado*'];
  if (changed.includes('nickname') || profile.nickname) {
    lines.push(`• Apelido: *${profile.nickname || '—'}*`);
  }
  if (changed.includes('bio') || profile.bio) {
    lines.push(`• Conhecido por: ${profile.bio || '—'}`);
  }
  if (changed.includes('birthday') || profile.birthdayMd) {
    lines.push(
      `• Aniversário: *${formatBirthdayDisplay(profile.birthdayMd) || '—'}*`
    );
  }
  if (changed.includes('title') || profile.title) {
    lines.push(`• Título: _${profile.title || '—'}_`);
  }
  if (changed.length) {
    lines.push('', `_Campos: ${changed.join(', ')}_`);
  }
  return lines.join('\n');
}

/**
 * /xp · /perfil [@pessoa | set | limpar | reset]
 * Perfil próprio ou de outro no mesmo grupo (scope).
 */
export async function handleXpCommand({
  userJid,
  scopeKey,
  isGroup = true,
  rankService,
  relationshipService,
  effectsRepository,
  casinoService,
  factionService,
  jobService,
  profileService,
  getContactDisplayName,
  listContacts,
  reply,
  replyImage,
  funConfig = {},
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
}) {
  const p = funConfig.prefix || '/';
  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const sub = normSub(args[0]);
  const restArgs = args.slice(1);

  // ── /perfil set|setar|editar|configurar <texto livre> ──
  if (
    sub === 'set' ||
    sub === 'setar' ||
    sub === 'editar' ||
    sub === 'configurar' ||
    sub === 'definir'
  ) {
    if (!isGroup) {
      await reply('Perfil customizado é *por grupo*. Use no chat do grupo.');
      return { handled: true, reason: 'dm' };
    }
    if (funConfig.profileEnabled === false) {
      await reply('Perfil customizado desligado neste bot.');
      return { handled: true };
    }
    if (!profileService) {
      await reply('Perfil offline.');
      return { handled: true };
    }
    const freeText = restArgs.join(' ').trim();
    if (!freeText) {
      await reply(
        [
          '📝 *Montar perfil*',
          `Manda tudo de uma vez: \`${p}perfil set me chamam de Nina, sou a das figurinhas, niver 12/08\``,
          '',
          'Campos: *apelido* · *conhecido por* · *aniversário* (dia/mês)',
          `Ver: \`${p}perfil\` · limpar: \`${p}perfil limpar\``,
        ].join('\n')
      );
      return { handled: true, reason: 'usage' };
    }

    await reply('_Anotando seu perfil…_');
    const result = await profileService.applyFreeText({
      userJid,
      scopeKey,
      text: freeText,
      funConfig,
    });
    if (!result.ok) {
      await reply(
        [
          'Não entendi o que salvar.',
          result.hint || `Tenta: \`${p}perfil set apelido Nina, niver 15/03, conhecido por chegar atrasado\``,
          result.errors?.length ? `Detalhe: ${result.errors.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
      return { handled: true, reason: result.reason };
    }
    await reply(formatSetConfirm(result.profile, result.changed));
    return { handled: true, result };
  }

  // ── /perfil limpar|clear ──
  if (sub === 'limpar' || sub === 'clear' || sub === 'apagar') {
    if (!isGroup) {
      await reply('Limpar perfil só no *grupo*.');
      return { handled: true };
    }
    if (!profileService) {
      await reply('Perfil offline.');
      return { handled: true };
    }
    profileService.clearOwn({ userJid, scopeKey });
    await reply('🧹 Perfil customizado *zerado* neste grupo (apelido, bio, niver, título).');
    return { handled: true, cleared: true };
  }

  // ── /perfil reset @user (admin) ──
  if (sub === 'reset' || sub === 'resetar') {
    if (!isGroup) {
      await reply('Reset de perfil só no *grupo*.');
      return { handled: true };
    }
    if (!profileService) {
      await reply('Perfil offline.');
      return { handled: true };
    }
    const admin = await isGroupAdmin(sock, scopeKey, userJid);
    if (!admin) {
      await reply('Só *admin do grupo* pode resetar perfil de outra pessoa.');
      return { handled: true, reason: 'not-admin' };
    }
    const resolved = await resolveUserTarget({
      args: restArgs,
      mentionedJids,
      quotedParticipant,
      excludeJid: '',
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    if (!resolved?.jid || !isCanonicalUserJid(resolved.jid)) {
      await reply(`Uso: \`${p}perfil reset @pessoa\``);
      return { handled: true, reason: 'target-unresolved' };
    }
    profileService.adminReset({ userJid: resolved.jid, scopeKey });
    const who = nameOf(getContactDisplayName, resolved.jid);
    await reply(`🧹 Perfil de ${who} foi *limpo* por um admin.`);
    return { handled: true, reset: resolved.jid };
  }

  // ── Ver perfil (próprio ou outro) ──
  // Se o 1º arg é subcomando desconhecido e não parece target, ajuda
  const PROFILE_SUBS = new Set([
    'set',
    'setar',
    'editar',
    'configurar',
    'definir',
    'limpar',
    'clear',
    'apagar',
    'reset',
    'resetar',
    'ajuda',
    'help',
  ]);
  if (sub === 'ajuda' || sub === 'help') {
    await reply(
      [
        '👤 *Perfil*',
        `\`${p}perfil\` — ver o seu`,
        `\`${p}perfil @user\` — ver o de alguém`,
        `\`${p}perfil set <texto livre>\` — IA extrai apelido/bio/niver`,
        `\`${p}perfil limpar\` — zera o seu`,
        `\`${p}perfil reset @user\` — admin limpa ofensivo`,
      ].join('\n')
    );
    return { handled: true };
  }

  let targetJid = userJid;
  const wantsOther =
    (Array.isArray(mentionedJids) && mentionedJids.length > 0) ||
    Boolean(String(quotedParticipant || '').trim()) ||
    (Array.isArray(args) &&
      args.some((a) => {
        const t = String(a || '').trim();
        if (!t) return false;
        return !PROFILE_SUBS.has(normSub(t));
      }));

  if (wantsOther) {
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
      targetJid = resolved.jid;
    } else {
      await reply(
        [
          'Não achei essa pessoa.',
          'Use `/perfil @pessoa`, responda a mensagem dela + `/perfil`, ou o nome/número.',
        ].join('\n')
      );
      return { handled: true, reason: 'target-unresolved' };
    }
  }

  const isSelf = targetJid === userJid;
  const listActiveEffects = effectsRepository
    ? (u, s) => effectsRepository.listActiveEffects(u, s)
    : null;

  const profile = rankService.getProfile(targetJid, scopeKey);
  const name = nameOf(getContactDisplayName, targetJid);
  const viewerName = isSelf ? '' : nameOf(getContactDisplayName, userJid);

  let partnerName = '';
  let partnerNamePlain = '';
  if (relationshipService) {
    const marriage = relationshipService.getMarriage(targetJid, scopeKey);
    if (marriage?.partnerJid) {
      partnerName = nameOf(getContactDisplayName, marriage.partnerJid);
      partnerNamePlain = displayNameOnly(getContactDisplayName, marriage.partnerJid);
    }
  }

  let factionLabel = '';
  if (factionService?.getUserFaction) {
    try {
      const uf = factionService.getUserFaction(scopeKey, targetJid);
      const fac = uf?.faction || uf;
      if (fac?.name) {
        factionLabel = `${fac.emoji || '🏴‍☠️'} ${fac.name}`;
      }
    } catch {
      // ignore
    }
  }

  let casino = null;
  if (casinoService?.getUserCasinoStats) {
    try {
      const c = casinoService.getUserCasinoStats(targetJid, scopeKey);
      if (c && (c.games > 0 || c.wagered > 0 || c.won > 0 || c.lost > 0)) {
        casino = {
          profit: Number(c.profit) || 0,
          wagered: Number(c.wagered) || 0,
          won: Number(c.won) || 0,
          lost: Number(c.lost) || 0,
          games: Number(c.games) || 0,
        };
      }
    } catch {
      // ignore
    }
  }

  const stats = { ...(profile.stats || {
    xp: 0,
    level: 1,
    dailyStreak: 0,
    coins: 0,
    title: '',
    messageCount: 0,
    xpAwardedCount: 0,
  }) };

  let customProfile = null;
  if (profileService?.getProfile) {
    try {
      customProfile = profileService.getProfile(targetJid, scopeKey);
      if (customProfile?.title) stats.title = customProfile.title;
      else if (!stats.title && customProfile?.title === '') {
        // keep stats title as fallback already in getProfile
      }
    } catch {
      customProfile = null;
    }
  }

  let activeBuffs = [];
  if (typeof listActiveEffects === 'function') {
    activeBuffs = listActiveEffects(targetJid, scopeKey) || [];
  }

  let employment = null;
  try {
    if (jobService?.getEmployment) {
      employment = jobService.getEmployment(targetJid, scopeKey);
    }
  } catch {
    employment = null;
  }

  const plainName = displayNameOnly(getContactDisplayName, targetJid);
  const profileOpts = {
    displayName: name,
    plainDisplayName: plainName,
    userJid: targetJid,
    stats,
    rank: profile.rank,
    total: profile.total,
    coinsRank: profile.coinsRank,
    coinsTotal: profile.coinsTotal,
    messagesRank: profile.messagesRank,
    messagesTotal: profile.messagesTotal,
    partnerName,
    activeBuffs,
    isSelf,
    viewerName,
    casino,
    factionLabel,
    employment,
    customProfile,
  };

  if (funConfig.rankCardImage !== false && typeof replyImage === 'function') {
    try {
      const png = renderProfileCardPng({
        displayName: plainName,
        userJid: targetJid,
        stats,
        rank: profile.rank,
        total: profile.total,
        coinsRank: profile.coinsRank,
        messagesRank: profile.messagesRank,
        partnerName: partnerNamePlain || '',
        factionLabel: factionLabel
          ? String(factionLabel)
              .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+/u, '')
              .trim() || factionLabel
          : '',
        casino,
        employment,
        isSelf,
        customProfile,
      });
      await replyImage(png, isSelf ? '📊 Seu perfil' : `📊 Perfil`);
      return { handled: true, targetJid, isSelf, image: true };
    } catch {
      // fallback texto
    }
  }

  await reply(formatXpProfile(profileOpts));
  return { handled: true, targetJid, isSelf };
}
