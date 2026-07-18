import { progressInLevel } from '../services/levelCurve.js';
import { DAY_MS } from '../constants.js';
import { nameOf, displayNameOnly, jidLocalPart } from '../utils/userLabel.js';

function shortJid(jid) {
  const local = jidLocalPart(jid);
  if (!local) return '…';
  if (local.length <= 8) return local;
  return `${local.slice(0, 4)}…${local.slice(-4)}`;
}

/**
 * Label no chat: @menção se mentionUsers (ALS / config).
 * Se name já veio formatado (@num), reutiliza.
 */
function displayName(name, userJid) {
  const n = String(name || '').trim();
  if (n.startsWith('@') && /^\@\d{8,20}$/.test(n)) return n;
  if (userJid) return nameOf(() => n, userJid);
  if (n) return n;
  return shortJid(userJid);
}

function formatMsRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function progressBar(ratio, width = 10) {
  const r = Math.min(1, Math.max(0, Number(ratio) || 0));
  const filled = Math.round(r * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function formatRelative(ts) {
  const t = Number(ts) || 0;
  if (t <= 0) return 'nunca';
  const diff = Date.now() - t;
  if (diff < 0) return 'em breve';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `há ${d}d`;
  return `há ${Math.floor(d / 30)} mês(es)`;
}

function rankLabel(rank, total) {
  if (rank == null || rank <= 0) return '—';
  const of = total > 0 ? `/${total}` : '';
  return `#${rank}${of}`;
}

/**
 * Perfil rico (próprio ou de outro).
 * @param {object} opts
 * @param {boolean} [opts.isSelf]
 * @param {string} [opts.viewerName] — quem pediu (quando vendo outro)
 * @param {object|null} [opts.casino] — { profit, wagered, won, lost, games }
 * @param {string} [opts.factionLabel]
 * @param {number|null} [opts.coinsRank]
 * @param {number|null} [opts.messagesRank]
 * @param {number} [opts.coinsTotal]
 * @param {number} [opts.messagesTotal]
 */
export function formatXpProfile({
  displayName: name,
  userJid,
  stats,
  rank,
  total,
  partnerName,
  activeBuffs = [],
  isSelf = true,
  viewerName = '',
  casino = null,
  factionLabel = '',
  coinsRank = null,
  coinsTotal = 0,
  messagesRank = null,
  messagesTotal = 0,
  employment = null,
  customProfile = null,
}) {
  const xp = Number(stats?.xp) || 0;
  const progress = progressInLevel(xp);
  const level = Number(stats?.level) || progress.level;
  const streak = Number(stats?.dailyStreak) || 0;
  const coins = Number(stats?.coins) || 0;
  const title = String(customProfile?.title || stats?.title || '').trim();
  const messages = Number(stats?.messageCount) || 0;
  const xpAwards = Number(stats?.xpAwardedCount) || 0;
  const who = title
    ? `${displayName(name, userJid)} · _${title}_`
    : displayName(name, userJid);

  const ratio =
    progress.xpForNext > 0 ? progress.xpIntoLevel / progress.xpForNext : 0;
  const bar = progressBar(ratio);

  const header = isSelf
    ? `📊 *Seu perfil* — ${who}`
    : `📊 *Perfil de* ${who}`;

  const lines = [
    header,
    !isSelf && viewerName
      ? `_pedido por ${viewerName}_`
      : null,
    '',
    '*Nível*',
    `• Lv *${level}* · *${xp}* XP`,
    `• ${bar} *${progress.xpIntoLevel}/${progress.xpForNext}*`,
    `• Rank XP *${rankLabel(rank, total)}*`,
    '',
    '*Economia*',
    `• Coins: *${coins}* · rank *${rankLabel(coinsRank, coinsTotal || total)}*`,
    streak > 0
      ? `• Daily streak: *${streak}* · último ${formatRelative(stats?.lastDailyAt)}`
      : `• Daily: ainda sem streak (use \`/daily\`)`,
    employment?.job
      ? `• 💼 ${employment.job.emoji} *${employment.job.name}* · ~*${employment.salary}*c/dia (${employment.workers} no cargo)`
      : isSelf
        ? `• 💼 Sem emprego · \`/emprego\``
        : null,
    '',
    '*Atividade*',
    `• Mensagens: *${messages}* · rank *${rankLabel(messagesRank, messagesTotal || total)}*`,
    `• XP creditado: *${xpAwards}*×`,
    stats?.createdAt
      ? `• No grupo desde: ${formatRelative(stats.createdAt)}`
      : null,
    stats?.lastXpAt
      ? `• Último XP: ${formatRelative(stats.lastXpAt)}`
      : null,
  ].filter((l) => l != null);

  if (casino && (casino.games > 0 || casino.wagered > 0)) {
    const profit = Number(casino.profit) || 0;
    const sign = profit > 0 ? '+' : '';
    lines.push(
      '',
      '*Cassino*',
      `• Lucro *${sign}${profit}* · jogos *${Number(casino.games) || 0}*`,
      `• Apostado *${Number(casino.wagered) || 0}* · ganho *${Number(casino.won) || 0}*`
    );
  }

  const identity = [];
  if (customProfile?.nickname) identity.push(`• Apelido: *${customProfile.nickname}*`);
  if (customProfile?.bio) identity.push(`• Conhecido por: ${customProfile.bio}`);
  if (customProfile?.birthdayMd) {
    const md = String(customProfile.birthdayMd);
    const m = md.match(/^(\d{2})-(\d{2})$/);
    const pretty = m ? `${m[2]}/${m[1]}` : md;
    identity.push(`• Aniversário: *${pretty}*`);
  }
  if (identity.length) {
    lines.push('', '*Identidade*', ...identity);
  } else if (isSelf) {
    lines.push(
      '',
      '*Identidade*',
      '• Ainda vazio · `/perfil set me chamam de …, niver DD/MM`'
    );
  }

  const social = [];
  if (partnerName) social.push(`• Casado(a) com: *${partnerName}*`);
  if (factionLabel) social.push(`• Panelinha: *${factionLabel}*`);
  if (social.length) {
    lines.push('', '*Social*', ...social);
  }

  if (activeBuffs?.length) {
    const labelEffect = (key) => {
      if (key === 'xp_morto') return '☠️ morto (sem XP)';
      if (key === 'xp_boost') return '⚡ boost XP';
      if (key === 'weapons_license') return '🔑 chave armas';
      if (key === 'daily_double') return '🎁 daily 2x';
      if (key === 'flip_lucky') return '🔮 amuleto flip';
      if (key === 'bet_shield') return '🛡️ escudo aposta';
      if (key === 'title') return '🏷️ título';
      return key;
    };
    const bits = activeBuffs.map((e) => {
      const lab = labelEffect(e.effectKey);
      if (e.expiresAt > 0) {
        const left = formatMsRemaining(e.expiresAt - Date.now());
        return `${lab} (${left})`;
      }
      if (e.charges > 0) return `${lab}×${e.charges}`;
      return lab;
    });
    lines.push('', '*Buffs / status*', `• ${bits.join(', ')}`);
  }

  if (isSelf) {
    lines.push('', `_Ver outro: \`/perfil @pessoa\` ou responda a msg_`);
  }

  return lines.join('\n');
}

export function formatLeaderboard({ entries, yourRank, yourTotal, limit = 10 }) {
  const lines = [`🏆 *Ranking do grupo* (top ${limit})`, ''];

  if (!entries || entries.length === 0) {
    lines.push('Ainda não há ninguém no ranking.');
    lines.push('Mande mensagens no grupo para ganhar XP!');
    return lines.join('\n');
  }

  for (const entry of entries) {
    const medal =
      entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
    // chat: menção; displayName pré-preenchido só como fallback de nome
    const label = nameOf((j) => entry.displayName || displayNameOnly(null, j), entry.userJid);
    const title = String(entry.title || '').trim();
    const labelWithTitle = title ? `${label} · ${title}` : label;
    lines.push(
      `${medal} *${labelWithTitle}* — Lv ${entry.level} · ${entry.xp} XP`
    );
  }

  if (yourRank != null) {
    lines.push('');
    lines.push(`Sua posição: *#${yourRank}*${yourTotal ? `/${yourTotal}` : ''}`);
  }

  return lines.join('\n');
}

export function formatDailyResult(result) {
  if (!result?.claimed) {
    if (result?.reason === 'already-claimed') {
      const remaining = Math.max(0, (Number(result.nextClaimAt) || 0) - Date.now());
      return [
        '🎁 *Daily*',
        `Você já resgatou hoje.`,
        `Próximo em *${formatMsRemaining(remaining || DAY_MS)}*.`,
        result.dailyStreak > 0 ? `Streak atual: *${result.dailyStreak}*` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }
    return 'Não foi possível resgatar o daily. Tente de novo.';
  }

  const lines = [
    '🎁 *Daily resgatado!*',
    `+*${result.xpGained}* XP${result.coinsGained ? ` · +*${result.coinsGained}* coins` : ''}`,
    `Streak: *${result.dailyStreak}*`,
    `Total: Lv *${result.level}* · *${result.xp}* XP`,
  ];
  if (result.leveledUp) {
    lines.push(`⬆ Level up! *${result.previousLevel}* → *${result.level}*`);
  }
  return lines.join('\n');
}

export function formatLevelUp({ displayName: name, userJid, previousLevel, level, xp }) {
  const who = nameOf((j) => name || displayNameOnly(null, j), userJid);
  return [
    `⬆ *Level up!*`,
    `${who}: *${previousLevel}* → *${level}*`,
    `XP total: *${xp}*`,
  ].join('\n');
}

/** @deprecated use formatHelp de helpGuide.js — reexport p/ imports legados */
export { formatHelp } from './helpGuide.js';
