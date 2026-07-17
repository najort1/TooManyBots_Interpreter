import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodePngRgb,
  renderRankCardPng,
  renderLeaderboardPng,
  renderProfileCardPng,
  renderBolsaBoardPng,
  renderCarteiraCardPng,
  LEADERBOARD_THEMES,
  sanitizeCardText,
} from '../fun/formatters/rankCardImage.js';

function assertPng(buf, minLen = 50) {
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > minLen, `png curto: ${buf.length}`);
  assert.equal(buf[0], 137);
  assert.equal(buf[1], 80);
  assert.equal(buf[2], 78);
  assert.equal(buf[3], 71);
}

test('encodePngRgb basico', () => {
  const rgb = Buffer.alloc(2 * 2 * 3, 128);
  assertPng(encodePngRgb(2, 2, rgb), 40);
});

test('sanitizeCardText remove emoji e nao vira interrogacao', () => {
  assert.equal(sanitizeCardText('FACCAO: 🏴‍☠️ SKATISTAS'), 'FACCAO: SKATISTAS');
  assert.ok(!sanitizeCardText('FACCAO: 🏴‍☠️ SKATISTAS').includes('?'));
  assert.equal(sanitizeCardText('CASADO(A) COM: LUCY'), 'CASADO(A) COM: LUCY');
  assert.ok(sanitizeCardText('CASADO(A) COM: LUCY').includes('('));
  assert.equal(sanitizeCardText('XP · RANK'), 'XP RANK');
  assert.equal(sanitizeCardText('🔥💯'), '');
});

test('leaderboard themes: xp coins messages casino', () => {
  assert.ok(LEADERBOARD_THEMES.xp);
  assert.ok(LEADERBOARD_THEMES.coins);
  assert.ok(LEADERBOARD_THEMES.messages);
  assert.ok(LEADERBOARD_THEMES.casino);

  const entries = [
    { rank: 1, userJid: 'a@s.whatsapp.net', displayName: 'Ana', level: 5, xp: 1000, coins: 200, messageCount: 50, profit: 80, games: 10 },
    { rank: 2, userJid: 'b@s.whatsapp.net', displayName: 'Beto', level: 3, xp: 400, coins: 50, messageCount: 20, profit: -30, games: 5 },
  ];

  assertPng(renderLeaderboardPng({ title: 'RANK XP', theme: 'xp', entries, yourRank: 2, yourTotal: 10 }));
  assertPng(renderLeaderboardPng({ title: 'RANK COINS', theme: 'coins', entries, yourRank: 1 }));
  assertPng(renderLeaderboardPng({ title: 'TOP MSG', theme: 'messages', entries }));
  assertPng(
    renderLeaderboardPng({
      title: 'RANK CASSINO',
      theme: 'casino',
      entries,
      footer: 'VOCE: +10',
    })
  );
  assertPng(renderRankCardPng({ title: 'LEGACY', entries }));
});

test('profile card', () => {
  assertPng(
    renderProfileCardPng({
      displayName: 'Fulano',
      userJid: '5511@s.whatsapp.net',
      stats: { xp: 500, level: 4, coins: 120, dailyStreak: 3, messageCount: 40, title: 'Lenda' },
      rank: 2,
      coinsRank: 1,
      messagesRank: 3,
      factionLabel: 'Panelinha',
      partnerName: 'Ciclana',
      casino: { profit: 40, games: 8, wagered: 200 },
      employment: { job: { name: 'Bombeiro', id: 'bombeiro' }, salary: 30 },
      isSelf: true,
    })
  );
});

test('bolsa e carteira cards', () => {
  assertPng(
    renderBolsaBoardPng({
      quotes: [
        { id: 'bombatech', name: 'BombaTech', price: 90, deltaPct: 5, trend: 'up', dividendYield: 0 },
        { id: 'burgerzap', name: 'BurgerZap', price: 100, deltaPct: -2, trend: 'down', dividendYield: 0.015 },
        { id: 'patocoin', name: 'PatoCoin', price: 25, deltaPct: 12, trend: 'up', dividendRare: true },
      ],
    })
  );
  assertPng(
    renderCarteiraCardPng({
      positions: [
        {
          company: { id: 'bombatech', name: 'BombaTech' },
          qty: 3,
          price: 90,
          unrealized: 15,
        },
      ],
      totalValue: 270,
      unrealized: 15,
      dividendTotal: 5,
    })
  );
  assertPng(renderCarteiraCardPng({ positions: [], totalValue: 0, unrealized: 0 }));
});
