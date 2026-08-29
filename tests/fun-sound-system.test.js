import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunSoundSystemRepository } from '../fun/db/funSoundSystemRepository.js';
import { createSoundSystemService, extractYouTubeVideoId } from '../fun/services/soundSystemService.js';
import { resolveFunConfig } from '../fun/config.js';

await initDb();
const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('paredão: reconhece formatos oficiais de link do YouTube', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
});

test('paredão: fila é compartilhada por grupo, persistente e inicia automaticamente', async () => {
  const repository = createFunSoundSystemRepository({ getDatabase: getDb });
  const service = createSoundSystemService({
    repository,
    now: () => 10_000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ title: 'Som do Beco', thumbnail_url: 'https://img.test/thumb.jpg' }) }),
    getYouTubeApiKey: () => '',
  });
  const scopeKey = unique('grupo') + '@g.us';
  const first = await service.enqueue({ scopeKey, userJid: 'a@s.whatsapp.net', requestedByName: 'Ana', url: 'https://youtu.be/dQw4w9WgXcQ' });
  const second = await service.enqueue({ scopeKey, userJid: 'b@s.whatsapp.net', requestedByName: 'Beto', url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', now: 11_000 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const state = service.getState({ scopeKey, now: 12_000 });
  assert.equal(state.current.videoId, 'dQw4w9WgXcQ');
  assert.equal(state.current.requestedBy, 'Ana');
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].videoId, 'M7lc1UVf-VE');
  assert.equal(createFunSoundSystemRepository({ getDatabase: getDb }).getCurrent(scopeKey).mediaId, 'dQw4w9WgXcQ');
});

test('paredão: duração e relógio do servidor avançam a fila sem pulo prematuro', async () => {
  const repository = createFunSoundSystemRepository({ getDatabase: getDb });
  const service = createSoundSystemService({ repository, fetchImpl: null, getYouTubeApiKey: () => '' });
  const scopeKey = unique('grupo') + '@g.us';
  await service.enqueue({ scopeKey, userJid: 'a@s.whatsapp.net', requestedByName: 'Ana', url: 'dQw4w9WgXcQ', now: 20_000 });
  await service.enqueue({ scopeKey, userJid: 'b@s.whatsapp.net', requestedByName: 'Beto', url: 'M7lc1UVf-VE', now: 21_000 });
  const currentId = service.getState({ scopeKey, now: 22_000 }).current.id;
  assert.equal(service.reportDuration({ scopeKey, trackId: currentId, durationSeconds: 60, now: 22_000 }).ok, true);
  assert.equal(service.advance({ scopeKey, trackId: currentId, now: 30_000 }).reason, 'track-still-playing');
  assert.equal(service.getState({ scopeKey, now: 82_000 }).current.videoId, 'M7lc1UVf-VE');
});

test('paredão: pesquisa oficial informa quando a chave não está configurada', async () => {
  const service = createSoundSystemService({ repository: createFunSoundSystemRepository({ getDatabase: getDb }), fetchImpl: null, getYouTubeApiKey: () => '' });
  assert.deepEqual(await service.search({ query: 'forró' }), { ok: false, reason: 'youtube-search-not-configured' });
});

test('paredão: configuração local preserva a chave de pesquisa no servidor', () => {
  const config = resolveFunConfig({ youtubeApiKey: 'youtube-key-for-test' });
  assert.equal(config.youtubeApiKey, 'youtube-key-for-test');
});
