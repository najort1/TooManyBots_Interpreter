import { choiceLabel } from './rouletteParser.js';
import { formatStatsLine, formatRecentLine } from './rouletteStats.js';

const COLOR_EMOJI = { red: '🔴', black: '⚫', green: '🟢' };
const COLOR_LABEL = { red: 'VERMELHO', black: 'PRETO', green: 'ZERO' };

function ballText(ball, color) {
  return `${COLOR_EMOJI[color]} ${ball} ${COLOR_LABEL[color]}`;
}

export function buildRollingSequence(ball, color) {
  const steps = [
    { text: '🎡 Girando a roleta...', delay: 600 },
    { text: `⚪ A bola quica nos diamantes...`, delay: 700 },
    { text: `➡️ Caiu no... ${ballText(ball, color)}!`, delay: 0 },
  ];
  return steps;
}

const DEALER_PREFIX = {};

export function buildResultMessage({
  result,
  dealer,
  dealerPhrase,
  stats,
}) {
  const { ball, color, choice, win, stake, payout, profit, coins, laPartage, laPartageRefund, happy, usedCharm } = result;
  const pick = choiceLabel(choice);
  const ballStr = ballText(ball, color);

  const lines = [];

  lines.push(`${dealer?.title || '🎡'} *${dealer?.name || 'Roleta'}*`);

  lines.push('');
  lines.push(`Aposta: *${stake}* em *${pick}*`);
  lines.push(`Bola: ${ballStr}`);

  if (win) {
    const mult = result.payoutMult || (payout > 0 ? Math.round(payout / stake) : 0);
    lines.push(`✅ *GANHOU* +${payout} moedas (×${mult})`);
  } else if (laPartage) {
    lines.push(`🟡 *ZERO* — Devolvemos *${laPartageRefund}* (La Partage)`);
  } else {
    lines.push(`❌ *PERDEU* −${stake} moedas`);
  }

  if (dealerPhrase) {
    lines.push(`*${dealer.name}:* "${dealerPhrase}"`);
  }

  if (usedCharm) {
    lines.push('🔮 Ficha da roleta usada.');
  }
  if (happy > 1) {
    lines.push(`🍸 Happy hour ×${happy}`);
  }
  if (result.jackpotHit) {
    lines.push(`💰 *JACKPOT!* +${result.jackpotHit} moedas`);
  }

  lines.push('');
  lines.push(`Saldo: *${coins}*`);

  if (result.jackpotCut > 0) {
    lines.push(`Jackpot do grupo: *${result.pot}*`);
  }

  const statsLine = formatStatsLine(stats);
  if (statsLine) {
    lines.push('');
    lines.push(statsLine);
  }

  const recentLine = formatRecentLine(stats);
  if (recentLine) {
    lines.push(recentLine);
  }

  return lines.join('\n');
}

export function buildHelpMessage(funConfig) {
  return [
    '🎡 *Roleta*',
    'Uso: `/roleta <valor> <palpite>`',
    '',
    '🎨 *Cores*: `vermelho` · `preto`',
    '🔢 *Números*: `0` a `36`',
    '🔁 *Paridade*: `par` · `impar`',
    '↕️ *Metades*: `baixo` (1-18) · `alto` (19-36)',
    '📦 *Dúzias*: `d1` (1-12) · `d2` (13-24) · `d3` (25-36)',
    '📊 *Colunas*: `col1` · `col2` · `col3`',
    '',
    `Mín *${funConfig.casinoMin || 5}* · Máx *${funConfig.casinoMax || 100}*`,
    'Roleta europeia · 1 zero · La Partage ativo',
  ].join('\n');
}

export function buildBigWinAnnouncement(result, dealer) {
  const profit = result.payout - result.stake;
  if (profit < 500) return null;
  if (profit >= 20000) {
    return `🚨 *A MESA PAROU!* O dealer ${dealer.name} está chocado! Acerto de *+${result.payout}* moedas!`;
  }
  if (profit >= 5000) {
    return `💰 *MEGA ACERTO!* ${result.payout} moedas pagas!`;
  }
  return `🎉 *Grande vitória!* +${result.payout} moedas!`;
}
