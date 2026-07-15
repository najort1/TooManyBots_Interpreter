import { progressInLevel } from '../services/levelCurve.js';
import { DAY_MS } from '../constants.js';

function shortJid(jid) {
  const raw = String(jid || '');
  const at = raw.indexOf('@');
  const local = at > 0 ? raw.slice(0, at) : raw;
  if (local.length <= 8) return local;
  return `${local.slice(0, 4)}…${local.slice(-4)}`;
}

function displayName(name, userJid) {
  const n = String(name || '').trim();
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

export function formatXpProfile({
  displayName: name,
  userJid,
  stats,
  rank,
  total,
  partnerName,
  activeBuffs = [],
}) {
  const xp = Number(stats?.xp) || 0;
  const progress = progressInLevel(xp);
  const level = Number(stats?.level) || progress.level;
  const streak = Number(stats?.dailyStreak) || 0;
  const coins = Number(stats?.coins) || 0;
  const title = String(stats?.title || '').trim();
  const pos = rank != null ? `#${rank}` : '—';
  const of = total > 0 ? `/${total}` : '';
  const who = title
    ? `${displayName(name, userJid)} · _${title}_`
    : displayName(name, userJid);

  const lines = [
    `📊 *Perfil* — ${who}`,
    `• Level *${level}* · XP *${xp}*`,
    `• Próximo: *${progress.xpIntoLevel}/${progress.xpForNext}* XP`,
    `• Rank *${pos}${of}* neste grupo`,
    `• Coins: *${coins}*  (loja: \`/loja\`)`,
  ];
  if (streak > 0) lines.push(`• Daily streak: *${streak}*`);
  if (partnerName) lines.push(`• Casado(a) com: *${partnerName}*`);
  if (activeBuffs?.length) {
    const bits = activeBuffs.map(e => {
      if (e.expiresAt > 0) return e.effectKey;
      if (e.charges > 0) return `${e.effectKey}×${e.charges}`;
      return e.effectKey;
    });
    lines.push(`• Buffs: ${bits.join(', ')}`);
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
    const label = displayName(entry.displayName, entry.userJid);
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
  return [
    `⬆ *Level up!*`,
    `${displayName(name, userJid)}: *${previousLevel}* → *${level}*`,
    `XP total: *${xp}*`,
  ].join('\n');
}

export function formatHelp(prefix = '/') {
  const p = String(prefix || '/');
  return [
    '🎮 *Comandos Fun*',
    '',
    '*Perfil & rank*',
    `• \`${p}xp\` / \`${p}perfil\` — nível e XP`,
    `• \`${p}rank\` — top XP · \`${p}rankcoins\` — top coins`,
    `• \`${p}topmsg\` — quem mais manda mensagem no grupo`,
    `• \`${p}daily\` · \`${p}coins\` / \`${p}saldo\``,
    `• \`${p}pay 50 @user\` — transferir coins`,
    '',
    '*Loja*',
    `• \`${p}loja\` · \`${p}comprar boost_xp\` · \`${p}titulo Lenda\``,
    '',
    '*Social*',
    `• \`${p}marry @user\` → \`${p}aceitar\` / \`${p}recusar\``,
    `• \`${p}divorce\` · \`${p}ship @a @b\``,
    '',
    '*Jogos*',
    `• \`${p}cf 20 cara\` — cara ou coroa`,
    `• \`${p}trabalhar\` · \`${p}sorte\``,
    `• \`${p}aposta @user 20 cara\` — duelo de moeda`,
    '',
    '*Cassino*',
    `• \`${p}roleta 20 vermelho\` · \`${p}slot 15\` · \`${p}jackpot\``,
    `• \`${p}crash 20\` → \`${p}sair\` (cashout)`,
    `• \`${p}bj 25\` → \`${p}hit\` / \`${p}stand\``,
    `• \`${p}desafio @user 30\` — duelo de dados (d20)`,
    `• \`${p}torneio 20\` · \`${p}rankcassino\``,
    `• \`${p}bingo 15\` · \`${p}bingo classico 15\` · \`${p}bingo solo 15\``,
    '',
    '*Facções*',
    `• \`${p}faccao criar|entrar|sair|doar|rank|info\``,
    `• \`${p}panelinha\` — placar · \`${p}comopanelinha\` — guia`,
    `• \`${p}ponte\` · \`${p}missao\` · \`${p}squad\``,
    `• \`${p}evento\` — status (trégua/happy hour o *bot* sorteia)`,
    '',
    '*Mídia*',
    `• \`${p}fig\` / \`${p}figurinha\` — imagem/GIF/vídeo → figurinha`,
    '  (legenda na mídia *ou* responda a mídia com o comando)',
    '',
    '*Privado*',
    `• Comandos solo no PV (se for membro de um grupo liberado)`,
    `• \`${p}grupo\` — escolhe o grupo usado no privado`,
    `• \`${p}ajuda\` / \`${p}help\``,
  ].join('\n');
}
