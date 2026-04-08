import type { DashboardView } from '../../types';

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
          <span className="rounded-lg border border-[#2a72db] bg-gradient-to-br from-[#1e63c9] to-[#2f7ef1] px-2.5 py-1 font-mono text-xs tracking-[0.08em] text-white shadow-[0_6px_16px_rgba(30,99,201,0.25)]">
            TMB
          </span>
          <span className="text-base font-bold text-[#16365b]">OpsPanel</span>
          <button
            type="button"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5d6f85] hover:bg-[#e7effa] md:hidden"
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
                    'inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border text-[0.82rem]',
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
