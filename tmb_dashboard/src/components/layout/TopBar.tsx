import type { DashboardMode } from '../../types';
import { fmtUptime } from '../../lib/format';

interface TopBarProps {
  mode: DashboardMode;
  botName: string;
  uptimeMs: number;
  onReload: () => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
}

export function TopBar({
  mode,
  botName,
  uptimeMs,
  onReload,
  onOpenSettings,
  onOpenSidebar,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="ghost-btn mobile-only" onClick={onOpenSidebar} aria-label="Abrir menu">
          ☰
        </button>
        <div className="presence-pill">
          <span className="presence-dot" />
          <span>ONLINE</span>
        </div>
        <span className={`mode-pill ${mode === 'COMMAND' ? 'is-command' : 'is-conversation'}`}>
          {mode === 'COMMAND' ? 'Modo Comando' : 'Modo Conversação'}
        </span>
      </div>

      <div className="topbar-right">
        <div className="runtime-meta">
          <span>Bot: <strong>{botName || 'Desconhecido'}</strong></span>
          <span>Uptime: <strong>{fmtUptime(uptimeMs)}</strong></span>
        </div>
        <button type="button" className="ghost-btn" onClick={onReload}>Recarregar</button>
        <button type="button" className="ghost-btn" onClick={onOpenSettings}>Configurações</button>
      </div>
    </header>
  );
}
