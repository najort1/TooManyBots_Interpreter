const QUEUE_LIMIT = 30;
const MAX_QUERY_LENGTH = 100;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function extractYouTubeVideoId(input) {
  const raw = cleanText(input, 500);
  if (VIDEO_ID_PATTERN.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') return VIDEO_ID_PATTERN.test(url.pathname.slice(1).split('/')[0] || '') ? url.pathname.slice(1).split('/')[0] : '';
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return '';
  const pathId = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
  const candidate = pathId || url.searchParams.get('v') || '';
  return VIDEO_ID_PATTERN.test(candidate) ? candidate : '';
}

function publicTrack(track) {
  if (!track) return null;
  return {
    id: track.id,
    provider: 'youtube',
    videoId: track.mediaId,
    url: track.sourceUrl,
    title: track.title,
    thumbnailUrl: track.thumbnailUrl,
    requestedBy: track.requestedByName || 'Morador',
    durationSeconds: track.durationSeconds,
    addedAt: track.addedAt,
    startedAt: track.startedAt,
  };
}

export function createSoundSystemService({ repository, fetchImpl = globalThis.fetch, now = Date.now, getYouTubeApiKey = () => process.env.YOUTUBE_API_KEY || '' } = {}) {
  if (!repository) throw new Error('[fun/sound-system] repository obrigatório');

  function startNext(scopeKey, timestamp) {
    const next = repository.nextQueued(scopeKey);
    return next ? repository.startTrack(scopeKey, next.id, timestamp) : null;
  }

  function settle(scopeKey, timestamp = now()) {
    return repository.transaction(() => {
      repository.ensureState(scopeKey, timestamp);
      const current = repository.getCurrent(scopeKey);
      if (current?.durationSeconds > 0 && timestamp >= current.startedAt + current.durationSeconds * 1000 + 1500) {
        repository.finishCurrent(scopeKey, current.id, timestamp);
        return startNext(scopeKey, timestamp);
      }
      if (!current) return startNext(scopeKey, timestamp);
      return current;
    });
  }

  function getState({ scopeKey, now: at = now() }) {
    settle(scopeKey, at);
    const state = repository.ensureState(scopeKey, at);
    const active = repository.listActive(scopeKey, QUEUE_LIMIT);
    const current = active.find((track) => track.status === 'playing') || null;
    return {
      ok: true,
      serverNow: at,
      revision: state.revision,
      current: publicTrack(current),
      queue: active.filter((track) => track.status === 'queued').map(publicTrack),
      searchEnabled: Boolean(cleanText(getYouTubeApiKey(), 300)),
    };
  }

  async function resolveMetadata(videoId) {
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const fallback = { title: 'Vídeo do YouTube', thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    if (typeof fetchImpl !== 'function') return fallback;
    try {
      const response = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return fallback;
      const body = await response.json();
      return {
        title: cleanText(body.title, 160) || fallback.title,
        thumbnailUrl: cleanText(body.thumbnail_url, 500) || fallback.thumbnailUrl,
      };
    } catch {
      return fallback;
    }
  }

  async function enqueue({ scopeKey, userJid, requestedByName, url, now: at = now() }) {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return { ok: false, reason: 'youtube-link-invalid' };
    if (repository.listActive(scopeKey, QUEUE_LIMIT + 1).length >= QUEUE_LIMIT) return { ok: false, reason: 'queue-full' };
    const metadata = await resolveMetadata(videoId);
    const track = repository.transaction(() => {
      const added = repository.appendTrack({
        scopeKey,
        mediaId: videoId,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: metadata.title,
        thumbnailUrl: metadata.thumbnailUrl,
        requestedByJid: userJid,
        requestedByName: cleanText(requestedByName, 50) || 'Morador',
        now: at,
      });
      repository.ensureState(scopeKey, at);
      if (!repository.getCurrent(scopeKey)) repository.startTrack(scopeKey, added.id, at);
      return added;
    });
    return { ok: true, track: publicTrack(track), state: getState({ scopeKey, now: at }) };
  }

  function reportDuration({ scopeKey, trackId, durationSeconds, now: at = now() }) {
    const current = repository.getCurrent(scopeKey);
    if (!current || current.id !== String(trackId || '')) return { ok: false, reason: 'stale-track' };
    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration < 1 || duration > 6 * 60 * 60) return { ok: false, reason: 'invalid-duration' };
    repository.setDuration(scopeKey, current.id, duration, at);
    return { ok: true, state: getState({ scopeKey, now: at }) };
  }

  function advance({ scopeKey, trackId, now: at = now() }) {
    const result = repository.transaction(() => {
      const current = repository.getCurrent(scopeKey);
      if (!current || current.id !== String(trackId || '')) return { ok: false, reason: 'stale-track' };
      const earliestEnd = current.startedAt + Math.max(10, current.durationSeconds || 30) * 1000 - 1500;
      if (at < earliestEnd) return { ok: false, reason: 'track-still-playing' };
      repository.finishCurrent(scopeKey, current.id, at);
      startNext(scopeKey, at);
      return { ok: true };
    });
    return result.ok ? { ok: true, state: getState({ scopeKey, now: at }) } : result;
  }

  async function search({ query }) {
    const q = cleanText(query, MAX_QUERY_LENGTH);
    if (q.length < 2) return { ok: false, reason: 'search-too-short' };
    const key = cleanText(getYouTubeApiKey(), 300);
    if (!key) return { ok: false, reason: 'youtube-search-not-configured' };
    const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', safeSearch: 'moderate', maxResults: '8', q, key });
    try {
      const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/search?${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
      if (!response.ok) return { ok: false, reason: 'youtube-search-unavailable' };
      const body = await response.json();
      const results = Array.isArray(body.items) ? body.items.map((item) => {
        const videoId = cleanText(item?.id?.videoId, 20);
        if (!VIDEO_ID_PATTERN.test(videoId)) return null;
        return {
          videoId,
          title: cleanText(item?.snippet?.title, 160) || 'Vídeo do YouTube',
          channelTitle: cleanText(item?.snippet?.channelTitle, 80),
          thumbnailUrl: cleanText(item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url, 500) || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }).filter(Boolean) : [];
      return { ok: true, results };
    } catch {
      return { ok: false, reason: 'youtube-search-unavailable' };
    }
  }

  return { getState, enqueue, reportDuration, advance, search };
}
