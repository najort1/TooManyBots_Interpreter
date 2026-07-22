import { getDealerPhrase, evolveMood } from './rouletteDealer.js';

export function checkBigWin(payout, stake) {
  const profit = payout - stake;
  return {
    isBig: profit >= 500,
    isMega: profit >= 5000,
    isTableStopper: profit >= 20000,
    profit,
  };
}

export function getEventForResult(result, dealer, mood) {
  const events = [];

  if (result.win) {
    const { isBig, isMega, isTableStopper } = checkBigWin(result.payout, result.stake);
    if (isTableStopper) {
      events.push({ type: 'shocked', phrase: getDealerPhrase(dealer, mood, 'shocked') });
      events.push({ type: 'bigWin', phrase: getDealerPhrase(dealer, mood, 'bigWin') });
    } else if (isMega || isBig) {
      events.push({ type: 'bigWin', phrase: getDealerPhrase(dealer, mood, 'bigWin') });
    } else {
      events.push({ type: 'win', phrase: getDealerPhrase(dealer, mood, 'win') });
    }
  } else if (result.laPartage) {
    events.push({ type: 'zero', phrase: getDealerPhrase(dealer, mood, 'zero') });
  } else {
    events.push({ type: 'lose', phrase: getDealerPhrase(dealer, mood, 'lose') });
  }

  return events;
}

export function pickMoodEvent(eventType) {
  const moodMap = {
    shocked: 'shocked',
    bigWin: 'excited',
    win: 'neutral',
    zero: 'neutral',
    lose: 'sarcastic',
  };
  return moodMap[eventType] || 'neutral';
}
