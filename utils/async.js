export function delay(ms = 0) {
  const parsed = Number(ms);
  const timeoutMs = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}
