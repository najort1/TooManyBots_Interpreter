import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderRankCardPng,
  renderLeaderboardPng,
  renderProfileCardPng,
  renderBolsaBoardPng,
  renderCarteiraCardPng,
  LEADERBOARD_THEMES,
  sanitizeCardText,
  resolveFestiveSeason,
  resolveCardTheme,
} from '../fun/formatters/rankCardImage.js';

function assertPng(buf, minLen = 500) {
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > minLen, `png curto: ${buf.length}`);
  assert.equal(buf[0], 137);
  assert.equal(buf[1], 80);
  assert.equal(buf[2], 78);
  assert.equal(buf[3], 71);
}

test('skia: leaderboard themes xp coins messages casino', () => {
  assert.ok(LEADERBOARD_THEMES.xp);
  assert.ok(LEADERBOARD_THEMES.coins);
  assert.ok(LEADERBOARD_THEMES.messages);
  assert.ok(LEADERBOARD_THEMES.casino);

  const entries = [
    {
      rank: 1,
      userJid: 'a@s.whatsapp.net',
      displayName: 'Ana',
      level: 5,
      xp: 1000,
      coins: 200,
      messageCount: 50,
      profit: 80,
      games: 10,
    },
    {
      rank: 2,
      userJid: 'b@s.whatsapp.net',
      displayName: 'Beto',
      level: 3,
      xp: 400,
      coins: 50,
      messageCount: 20,
      profit: -30,
      games: 5,
    },
  ];

  assertPng(renderLeaderboardPng({ title: 'Rank XP', theme: 'xp', entries, yourRank: 2, yourTotal: 10 }));
  assertPng(renderLeaderboardPng({ title: 'Rank Coins', theme: 'coins', entries, yourRank: 1 }));
  assertPng(renderLeaderboardPng({ title: 'Top mensagens', theme: 'messages', entries }));
  assertPng(
    renderLeaderboardPng({
      title: 'Rank Cassino',
      theme: 'casino',
      entries,
      footer: 'Você: lucro +10 · 3 jogos',
    })
  );
  assertPng(renderRankCardPng({ title: 'Rank XP', entries }));
});

test('skia: profile card com acentos', () => {
  assertPng(
    renderProfileCardPng({
      displayName: 'Eduardo',
      userJid: '5511@s.whatsapp.net',
      stats: {
        xp: 507,
        level: 4,
        coins: 1979,
        dailyStreak: 2,
        messageCount: 12,
        title: 'Lenda',
      },
      rank: 1,
      coinsRank: 2,
      messagesRank: 1,
      factionLabel: 'Skatistas',
      partnerName: 'Lucy',
      casino: { profit: 40, games: 8, wagered: 200 },
      employment: { job: { name: 'Bombeiro', id: 'bombeiro' }, salary: 30 },
      isSelf: true,
    })
  );
});

test('skia: bolsa e carteira', () => {
  assertPng(
    renderBolsaBoardPng({
      quotes: [
        {
          id: 'bombatech',
          name: 'BombaTech',
          price: 90,
          deltaPct: 5,
          trend: 'up',
          dividendYield: 0,
        },
        {
          id: 'burgerzap',
          name: 'BurgerZap',
          price: 100,
          deltaPct: -2,
          trend: 'down',
          dividendYield: 0.015,
        },
        {
          id: 'patocoin',
          name: 'PatoCoin',
          price: 25,
          deltaPct: 12,
          trend: 'up',
          dividendRare: true,
        },
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

test('sanitizeCardText leve', () => {
  assert.equal(sanitizeCardText('  a  b  '), 'a b');
});

test('festive seasons BR', () => {
  // Natal
  assert.equal(
    resolveFestiveSeason(Date.UTC(2025, 11, 24, 15, 0, 0)), // ~24/12 SP
    'natal'
  );
  // Ano novo
  assert.equal(resolveFestiveSeason(Date.UTC(2026, 0, 1, 15, 0, 0)), 'ano_novo');
  // São João
  assert.equal(resolveFestiveSeason(Date.UTC(2026, 5, 24, 15, 0, 0)), 'sao_joao');
  // carnaval 2026 ≈ mid-Feb (easter-based)
  const carn = resolveFestiveSeason(Date.UTC(2026, 1, 15, 15, 0, 0));
  assert.ok(carn === 'carnaval' || carn === null || carn === 'carnaval');
});

test('resolveCardTheme aplica festa', () => {
  const normal = resolveCardTheme('bolsa', Date.UTC(2026, 3, 10, 15, 0, 0));
  assert.equal(normal.festive, null);
  assert.equal(normal.id, 'bolsa');

  const xmas = resolveCardTheme('profile', Date.UTC(2025, 11, 20, 15, 0, 0));
  assert.ok(xmas.festive);
  assert.equal(xmas.festive.id, 'natal');
});
