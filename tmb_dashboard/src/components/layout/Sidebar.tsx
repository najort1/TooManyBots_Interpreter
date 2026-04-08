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
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">TMB</span>
          <span className="brand-text">OpsPanel</span>
          <button type="button" className="sidebar-close" onClick={onCloseMobile} aria-label="Fechar menu">
            X
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-section-label">Navegacao</p>
          {navItems.map(item => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-link ${currentView === item.id ? 'is-active' : ''}`}
              onClick={() => {
                onNavigate(item.id);
                onCloseMobile();
              }}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                <i className={item.iconClass} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          Dashboard React + Vite
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" type="button" onClick={onCloseMobile} aria-label="Fechar" />}
    </>
  );
}
