export function shortJid(jid: string) {
  return String(jid || "").split("@")[0] || jid;
}

export function displayPlayer(entry: {
  displayName?: string;
  userJid?: string;
  jid?: string;
}) {
  const name = String(entry.displayName || "").trim();
  if (name) return name;
  return shortJid(entry.userJid || entry.jid || "?");
}

export function formatNumber(n: number | undefined | null) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat("pt-BR").format(v);
}

export function formatMs(ms: number | undefined | null) {
  const v = Math.max(0, Math.floor(Number(ms) || 0));
  if (v < 1000) return `${v} ms`;
  if (v < 60_000) return `${Math.round(v / 1000)} s`;
  return `${Math.round(v / 60_000)} min`;
}

export function formatEndsIn(endsAt: number) {
  const left = Math.max(0, Number(endsAt) - Date.now());
  if (left <= 0) return "encerrado";
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s}s`;
}
