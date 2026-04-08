import type { DashboardView } from '../../types';

interface SidebarProps {
  currentView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const navItems: Array<{ id: DashboardView; label: string; icon: string }> = [
  { id: 'analytics', label: 'Dashboard', icon: 'DB' },
  { id: 'handoff', label: 'Atendimento Humano', icon: 'AT' },
  { id: 'settings', label: 'Configuracoes', icon: 'CF' },
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
              <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
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
