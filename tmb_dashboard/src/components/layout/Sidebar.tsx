import type { DashboardView } from '../../types';
import projectFavicon from '../../assets/dhRt6-removebg-preview.png';

interface SidebarProps {
  currentView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const navItems: Array<{ id: DashboardView; label: string; iconClass: string }> = [
  { id: 'analytics', label: 'Dashboard', iconClass: 'fa-solid fa-chart-pie' },
  { id: 'handoff', label: 'Atendimento Humano', iconClass: 'fa-solid fa-headset' },
  { id: 'broadcast', label: 'Anuncios em Massa', iconClass: 'fa-solid fa-bullhorn' },
  { id: 'sessions', label: 'Gestao de Sessoes', iconClass: 'fa-solid fa-layer-group' },
  { id: 'settings', label: 'Configuracoes', iconClass: 'fa-solid fa-sliders' },
];

export function Sidebar({
  currentView,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-[276px] shrink-0 border-r border-[#d5e2f2] bg-gradient-to-b from-[#f7fbff] to-[#f2f7ff] text-[#24364d] shadow-[inset_-1px_0_0_rgba(116,150,190,0.08)] transition-transform duration-200 md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center gap-2.5 border-b border-[#dce8f6] px-4 py-4">
          <img
            src={projectFavicon}
            alt="TooManyBots"
            className="h-12 w-12 shrink-0 rounded-xl border border-[#cfe0f5] bg-white object-contain p-0.5 shadow-[0_8px_18px_rgba(30,99,201,0.16)]"
          />
          <div className="min-w-0">
            <p className="truncate text-[0.95rem] font-bold text-[#16365b]">TooManyBots</p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#6f8298]">OpsPanel</p>
          </div>
          <button
            type="button"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#5d6f85] hover:bg-[#e7effa] md:hidden"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-col gap-2 p-4">
          <p className="mb-1 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#6f8298]">Navegacao</p>
          {navItems.map(item => {
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={[
                  'flex items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left text-sm font-semibold transition-all',
                  active
                    ? 'border-[#9ebeee] bg-[#e3efff] text-[#173f78] shadow-[0_6px_14px_rgba(30,99,201,0.14)]'
                    : 'border-transparent text-[#2f4662] hover:border-[#d4e2f4] hover:bg-[#f1f6fd]',
                ].join(' ')}
                onClick={() => {
                  onNavigate(item.id);
                  onCloseMobile();
                }}
              >
                <span
                  className={[
                    'inline-flex h-9 w-9 items-center justify-center rounded-xl border text-[0.82rem]',
                    active
                      ? 'border-[#1e63c9] bg-[#1e63c9] text-white'
                      : 'border-[#d6e5f8] bg-[#edf4ff] text-[#2d5fa9]',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  <i className={item.iconClass} />
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {mobileOpen ? (
        <button
          className="fixed inset-0 z-40 border-0 bg-[rgba(23,39,61,0.34)] md:hidden"
          type="button"
          onClick={onCloseMobile}
          aria-label="Fechar"
        />
      ) : null}
    </>
  );
}
