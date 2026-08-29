export function soundSystemVisualStateKey(state) {
  if (!state) return "empty";
  const current = state.current;
  return JSON.stringify({
    current: current ? [current.id, current.videoId, current.startedAt, current.durationSeconds, current.title, current.requestedBy] : null,
    queue: (state.queue || []).map((track) => [track.id, track.videoId, track.durationSeconds, track.title, track.requestedBy]),
    searchEnabled: Boolean(state.searchEnabled),
  });
}
