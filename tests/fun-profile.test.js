/**
 * Perfil customizado por grupo: parse, repo, set manual, labels, niver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunProfileRepository } from '../fun/db/funProfileRepository.js';
import {
  createProfileService,
  parseBirthdayInput,
  formatBirthdayDisplay,
  sanitizeNickname,
  parseProfileManual,
  deriveExtras,
  todayBirthdayMd,
} from '../fun/services/profileService.js';
import { resolveFunConfig } from '../fun/index.js';
import { handleXpCommand } from '../fun/commands/handlers/xp.js';
import {
  createUserFormatter,
  displayNameOnly,
  runWithUserLabels,
} from '../fun/utils/userLabel.js';
import {
  formatXpProfile,
  formatProfileIdentityMessage,
  buildIdentityLines,
} from '../fun/formatters/rankCard.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseBirthdayInput BR e format', () => {
  assert.equal(parseBirthdayInput('15/03').birthdayMd, '03-15');
  assert.equal(parseBirthdayInput('12 de agosto').ok, true);
  assert.equal(parseBirthdayInput('12 de agosto').birthdayMd, '08-12');
  assert.equal(parseBirthdayInput('31/02').ok, false);
  assert.equal(formatBirthdayDisplay('08-12'), '12/08');
});

test('sanitizeNickname rejeita url e comando', () => {
  assert.equal(sanitizeNickname('Nina').ok, true);
  assert.equal(sanitizeNickname('http://x.com').ok, false);
  assert.equal(sanitizeNickname('/pay').ok, false);
  assert.equal(sanitizeNickname('a').ok, false);
});

test('parseProfileManual extrai campos', () => {
  const p = parseProfileManual(
    'me chamam de Nina, conhecido por mandar figurinha, niver 12/08'
  );
  assert.match(String(p.nickname || ''), /Nina/i);
  assert.ok(p.bio || p.birthday);
});

test('parseProfileManual + deriveExtras guarda o resto da fofoca', () => {
  const raw =
    'me chamam de dudu, sou um proano que nunca pisou no fabio e conhecido por adorar o cachorro chupetão faço aniversario 28/11 e sou negro';
  const p = parseProfileManual(raw);
  assert.match(String(p.nickname || ''), /dudu/i);
  assert.match(String(p.bio || ''), /chupet/i);
  assert.ok(p.birthday || p.birthdayMd);
  assert.ok(p.extras, JSON.stringify(p));
  assert.match(String(p.extras), /proano|fabio|negro/i);
  assert.ok(!/28\/11|anivers/i.test(p.extras));
  const only = deriveExtras(raw, {
    nickname: 'dudu',
    bio: 'adorar o cachorro chupetão',
    birthday: '28/11',
  });
  assert.match(only, /proano|negro/i);
});

test('profileRepository upsert merge e clear', () => {
  const repo = createFunProfileRepository({ getDatabase: getDb });
  const u = uniqueJid('5591');
  const g = uniqueGroup();

  const a = repo.upsertProfile({
    userJid: u,
    scopeKey: g,
    nickname: 'Nina',
    bio: 'manda figurinha no comprovante',
    birthdayMd: '08-12',
  });
  assert.equal(a.ok, true);
  assert.equal(a.profile.nickname, 'Nina');

  const b = repo.upsertProfile({
    userJid: u,
    scopeKey: g,
    title: 'Lenda',
  });
  assert.equal(b.profile.nickname, 'Nina');
  assert.equal(b.profile.title, 'Lenda');

  repo.clearProfile(u, g);
  const c = repo.getProfile(u, g);
  assert.equal(c.nickname, '');
  assert.equal(c.empty, true);
});

test('profileService applyFreeText com mock Zen', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunProfileRepository({ getDatabase: getDb });
    const stats = createFunStatsRepository({ getDatabase: getDb });
    const svc = createProfileService({
      profileRepository: repo,
      statsRepository: stats,
      generateZen: async () =>
        JSON.stringify({
          nickname: 'Zé',
          bio: 'chega atrasado no daily',
          birthday: '15/03',
          title: null,
          extras: 'torce pro time B e odeia café',
        }),
      generateOllama: async () => {
        throw new Error('no-ollama');
      },
    });
    const u = uniqueJid('5592');
    const g = uniqueGroup();
    const cfg = resolveFunConfig({ profileAiExtract: true, zenEnabled: true });

    const r = await svc.applyFreeText({
      userJid: u,
      scopeKey: g,
      text: 'me chamam de Ze e eu atraso o daily, niver 15 de marco',
      funConfig: cfg,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.profile.nickname, 'Zé');
    assert.equal(r.profile.birthdayMd, '03-15');
    assert.match(r.profile.bio, /atras/i);
    assert.match(String(r.profile.extras || ''), /café|time/i);
    assert.ok(r.changed.includes('extras'));
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('profileService descarta subject com nome: AI null fields + manual', async () => {
  const repo = createFunProfileRepository({ getDatabase: getDb });
  const svc = createProfileService({
    profileRepository: repo,
    generateZen: async () =>
      JSON.stringify({ nickname: null, bio: null, birthday: null, title: null }),
    generateOllama: async () => '{}',
  });
  const r = await svc.applyFreeText({
    userJid: uniqueJid(),
    scopeKey: uniqueGroup(),
    text: 'ok blz',
    funConfig: resolveFunConfig({ profileAiExtract: true }),
  });
  assert.equal(r.ok, false);
});

test('displayNameOnly prefere nick via ALS', () => {
  const repo = createFunProfileRepository({ getDatabase: getDb });
  const u = uniqueJid('5593');
  const g = uniqueGroup();
  repo.upsertProfile({ userJid: u, scopeKey: g, nickname: 'Capitão' });

  const svc = createProfileService({ profileRepository: repo });
  const fmt = createUserFormatter({
    getContactDisplayName: () => 'João WhatsApp',
    mentionUsers: false,
    resolveNickname: (jid) => svc.getNickname(jid, g),
  });

  const name = runWithUserLabels(fmt, () =>
    displayNameOnly(() => 'João WhatsApp', u)
  );
  assert.equal(name, 'Capitão');

  // menção continua @numero
  const fmtM = createUserFormatter({
    getContactDisplayName: () => 'João WhatsApp',
    mentionUsers: true,
    resolveNickname: (jid) => svc.getNickname(jid, g),
  });
  const tagged = fmtM.formatUser(u);
  assert.match(tagged, /^@\d+/);
});

test('formatXpProfile mostra identidade', () => {
  const text = formatXpProfile({
    displayName: '@5511',
    userJid: uniqueJid(),
    stats: { xp: 100, level: 2, coins: 10, title: '' },
    rank: 1,
    total: 5,
    isSelf: true,
    customProfile: {
      nickname: 'Nina',
      bio: 'figurinhas no comprovante',
      birthdayMd: '08-12',
      title: 'Lenda',
      extras: 'proano que nunca pisou no fabio e sou negro',
    },
  });
  assert.match(text, /Identidade|Nina|figurinhas|12\/08|Lenda/i);
  assert.match(text, /proano|negro/i);
});

test('formatProfileIdentityMessage não trunca extras', () => {
  const long =
    'sou um proano que nunca pisou no fabio, adoro o cachorro chupetão e sou negro, mais fofoca sem cortar no texto';
  const text = formatProfileIdentityMessage({
    isSelf: true,
    customProfile: {
      nickname: 'dudu',
      bio: 'adorar o cachorro chupetão',
      birthdayMd: '11-28',
      extras: long,
    },
  });
  assert.match(text, /Sua identidade/i);
  assert.match(text, /dudu/);
  assert.match(text, /28\/11/);
  assert.ok(text.includes(long), 'extras completo na mensagem');
  const lines = buildIdentityLines({ extras: long });
  assert.ok(lines.some((l) => l.includes(long)));
});

test('handlers: /perfil set e limpar', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  try {
    const repo = createFunProfileRepository({ getDatabase: getDb });
    const stats = createFunStatsRepository({ getDatabase: getDb });
    const svc = createProfileService({
      profileRepository: repo,
      statsRepository: stats,
      generateZen: async () => '[]',
      generateOllama: async () => '{}',
    });
    // força path manual (AI off)
    const cfg = resolveFunConfig({ profileAiExtract: false });
    const u = uniqueJid('5594');
    const g = uniqueGroup();
    const replies = [];

    await handleXpCommand({
      userJid: u,
      scopeKey: g,
      isGroup: true,
      profileService: svc,
      rankService: {
        getProfile: () => ({
          stats: { xp: 0, level: 1, coins: 0, title: '' },
          rank: 1,
          total: 1,
        }),
      },
      funConfig: cfg,
      reply: async (t) => replies.push(String(t)),
      args: ['set', 'apelido:', 'Mago', 'niver:', '01/01', 'bio:', 'rei do daily'],
    });

    const p = svc.getProfile(u, g);
    assert.equal(p.nickname, 'Mago');
    assert.equal(p.birthdayMd, '01-01');
    assert.ok(replies.some((r) => /atualizado|Anotando/i.test(r)));

    await handleXpCommand({
      userJid: u,
      scopeKey: g,
      isGroup: true,
      profileService: svc,
      rankService: {
        getProfile: () => ({
          stats: { xp: 0, level: 1, coins: 0 },
          rank: 1,
          total: 1,
        }),
      },
      funConfig: cfg,
      reply: async (t) => replies.push(String(t)),
      args: ['limpar'],
    });
    assert.equal(svc.getProfile(u, g).empty, true);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('birthday announce list + dedup', () => {
  const repo = createFunProfileRepository({ getDatabase: getDb });
  const svc = createProfileService({ profileRepository: repo });
  const g = uniqueGroup();
  const u = uniqueJid('5595');
  const md = todayBirthdayMd(Date.now(), 'America/Sao_Paulo');
  repo.upsertProfile({
    userJid: u,
    scopeKey: g,
    nickname: 'Aniversariante',
    birthdayMd: md,
  });

  const cfg = resolveFunConfig({ profileBirthdayAnnounce: true });
  const list1 = svc.listBirthdayAnnouncements(g, cfg, Date.now());
  assert.ok(list1.some((x) => x.userJid === u));

  const year = list1[0].year;
  svc.markBirthdayAnnounced(g, u, year);
  const list2 = svc.listBirthdayAnnouncements(g, cfg, Date.now());
  assert.equal(list2.some((x) => x.userJid === u), false);
});

test('buildIdentityBlock', () => {
  const repo = createFunProfileRepository({ getDatabase: getDb });
  const u = uniqueJid('5596');
  const g = uniqueGroup();
  repo.upsertProfile({
    userJid: u,
    scopeKey: g,
    nickname: 'Nina',
    bio: 'figurinhas',
  });
  const svc = createProfileService({
    profileRepository: repo,
    getContactDisplayName: () => 'Ana',
  });
  const block = svc.buildIdentityBlock(g, [u], {});
  assert.match(block, /user_identity|Nina|figurinhas/i);
});
