import type { DashboardMode } from '../../types';
import { fmtUptime } from '../../lib/format';
import projectFavicon from '../../assets/dhRt6-removebg-preview.png';

interface TopBarProps {
  mode: DashboardMode;
  availableModes: DashboardMode[];
  onModeChange: (mode: DashboardMode) => void;
  botName: string;
  uptimeMs: number;
  onOpenSidebar: () => void;
}

const ghostBtn =
  'inline-flex h-9 items-center gap-1 rounded-xl border border-[#d8e2ef] bg-white px-3 text-[0.82rem] font-semibold text-slate-700 transition hover:bg-slate-50';

export function TopBar({
  mode,
  availableModes,
  onModeChange,
  botName,
  uptimeMs,
  onOpenSidebar,
}: TopBarProps) {
  const showModeSwitch = availableModes.length > 1;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[#d8e2ef] bg-[rgba(255,255,255,0.92)] px-4 py-3 backdrop-blur-[10px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={`${ghostBtn} md:hidden`}
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
        >
          <i className="fa-solid fa-bars" aria-hidden="true" />
        </button>
        <img
          src={projectFavicon}
          alt="TooManyBots"
          className="h-9 w-9 shrink-0 rounded-xl border border-[#d8e2ef] bg-white object-contain p-1"
        />
        <div className="inline-flex items-center gap-2 rounded-full bg-[#ddfbe8] px-2.5 py-1 text-[0.74rem] font-bold tracking-[0.03em] text-[#0f5132]">
          <span className="h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_0_5px_rgba(34,197,94,0.2)]" />
          <span>ONLINE</span>
        </div>
        <span
          className={[
            'hidden rounded-full px-2.5 py-1 text-[0.74rem] font-bold tracking-[0.02em] md:inline-flex',
            mode === 'COMMAND' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-700',
          ].join(' ')}
        >
          {mode === 'COMMAND' ? 'Modo Comando' : 'Modo Conversacao'}
        </span>
        {showModeSwitch && (
          <div className="hidden items-center rounded-xl border border-[#d8e2ef] bg-white p-0.5 md:inline-flex">
            <button
              type="button"
              className={[
                'h-9 rounded-xl px-2.5 text-[0.74rem] font-bold transition',
                mode === 'CONVERSATION'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50',
              ].join(' ')}
              onClick={() => onModeChange('CONVERSATION')}
            >
              Conversa
            </button>
            <button
              type="button"
              className={[
                'h-9 rounded-xl px-2.5 text-[0.74rem] font-bold transition',
                mode === 'COMMAND'
                  ? 'bg-orange-100 text-orange-800'
                  : 'text-slate-600 hover:bg-slate-50',
              ].join(' ')}
              onClick={() => onModeChange('COMMAND')}
            >
              Comando
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-4 text-[0.82rem] text-slate-500 xl:flex">
          <span>Bot: <strong className="text-[#122033]">{botName || 'Desconhecido'}</strong></span>
          <span>Uptime: <strong className="text-[#122033]">{fmtUptime(uptimeMs)}</strong></span>
        </div>
      </div>
    </header>
  );
}
