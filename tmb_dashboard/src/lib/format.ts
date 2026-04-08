export function fmtTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--:--';
  return new Date(timestamp).toLocaleTimeString('pt-BR');
}

export function fmtDuration(ms: number): string {
  const safeMs = Math.max(0, Number(ms) || 0);
  if (safeMs < 1000) return `${safeMs}ms`;
  const seconds = Math.round(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function fmtUptime(ms: number): string {
  const safeMs = Math.max(0, Number(ms) || 0);
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function formatJidPhone(jid: string): string {
  const normalized = String(jid ?? '').trim();
  return normalized.split('@')[0] || normalized;
}

export function isLikelyErrorMessage(message: string): boolean {
  return /^(erro|falha|exception|timeout)\b/i.test(String(message ?? '').trim());
}
